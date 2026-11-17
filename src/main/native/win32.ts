import { execFileSync } from 'node:child_process';
import { getWin32, isWindows, SW_HIDE, SW_SHOW, GWL_STYLE, WS_VISIBLE } from './ffi';

const SPI_SETDESKWALLPAPER = 0x0014;
const SPI_GETDESKWALLPAPER = 0x0073;
const SPIF_UPDATEINIFILE = 0x01;
const SPIF_SENDCHANGE = 0x02;
const MAX_PATH = 260;

/** Last diagnostic message from findFolderView — exposed for error reporting. */
export let lastFindError: string | null = null;

/**
 * Locate the desktop icon list view (SysListView32 under SHELLDLL_DefView).
 *
 * Window hierarchy on modern Windows:
 *   Progman (root)
 *     └─ SHELLDLL_DefView
 *         └─ SysListView32   ← this is the icon list we hide/show
 *
 * On multi-monitor or after toggling icons, a WorkerW window may host the
 * DefView instead. There can be MULTIPLE WorkerW windows — we must enumerate
 * them all because only one (or none) actually hosts DefView.
 */
function findFolderView(): any {
  const api = getWin32();
  if (!api) {
    lastFindError = 'getWin32() returned null (not Windows or koffi load failed)';
    console.error('[win32]', lastFindError);
    return null;
  }

  lastFindError = null;

  // Walk: root → SHELLDLL_DefView → SysListView32
  const tryChain = (root: any, rootLabel: string): any => {
    if (!root) {
      console.log(`[win32] ${rootLabel}: root is null/zero, skipping`);
      return null;
    }
    console.log(`[win32] ${rootLabel}: root hwnd =`, root);

    const def = api.FindWindowExW(root, null, 'SHELLDLL_DefView', null);
    console.log(`[win32] ${rootLabel}: FindWindowExW(DefView) =`, def);
    if (!def) return null;

    const lv = api.FindWindowExW(def, null, 'SysListView32', null);
    console.log(`[win32] ${rootLabel}: FindWindowExW(SysListView32) =`, lv);
    return lv;
  };

  /**
   * Enumerate ALL top-level windows matching a class name.
   * FindWindowW only returns the first match; we need every WorkerW.
   */
  const findAllWindows = (cls: string): any[] => {
    const results: any[] = [];
    let prev: any = null;
    for (let i = 0; i < 64; i++) {
      // safety cap: don't loop forever
      const hwnd = api.FindWindowExW(null, prev, cls, null);
      if (!hwnd) break;
      results.push(hwnd);
      prev = hwnd;
    }
    return results;
  };

  try {
    // Attempt 1: Standard Progman chain
    const progman = api.FindWindowW('Progman', null);
    console.log('[win32] FindWindowW(Progman) =', progman);

    let fv = tryChain(progman, 'Progman-chain');
    if (fv) {
      console.log('[win32] found folder view via Progman chain');
      return fv;
    }

    // Attempt 2: Enumerate ALL WorkerW windows and try each one
    const workerWindows = findAllWindows('WorkerW');
    console.log(`[win32] found ${workerWindows.length} WorkerW window(s)`);
    for (let i = 0; i < workerWindows.length; i++) {
      fv = tryChain(workerWindows[i], `WorkerW[${i}]`);
      if (fv) {
        console.log(`[win32] found folder view via WorkerW[${i}]`);
        return fv;
      }
    }

    // Attempt 3: Send toggle message to Progman to force creation of
    // a WorkerW that hosts DefView. This is the standard technique used by
    // every desktop-icon-hider tool since Vista.
    //
    // CRITICAL FIX: lpdwResult must be a Buffer (native pointer), NOT a JS object.
    // koffi's void* expects a Buffer/ArrayBuffer that it can pass as a memory address.
    if (progman) {
      console.log('[win32] sending toggle message (0x058C) to Progman...');
      const resultBuf = Buffer.alloc(8); // PDWORD_PTR = 8 bytes on 64-bit
      resultBuf.writeBigInt64LE(BigInt(0), 0);
      try {
        api.SendMessageTimeoutW(
          progman,
          0x058C, // WM_TOGGLEICONWORKER (undocumented but stable)
          0,
          0,
          0x0000, // SMTO_NORMAL
          1000,   // timeout ms
          resultBuf
        );
        const resultVal = resultBuf.readBigInt64LE(0);
        console.log('[win32] toggle sent, result =', resultVal.toString());
      } catch (toggleErr) {
        console.warn('[win32] SendMessageTimeoutW threw (non-fatal):', toggleErr);
        // Don't give up — the message may still have been delivered
      }

      // After toggle, re-enumerate everything (windows may have changed)
      const progman2 = api.FindWindowW('Progman', null);
      console.log('[win32] post-toggle FindWindowW(Progman) =', progman2);

      fv = tryChain(progman2, 'Progman-post-toggle');
      if (fv) {
        console.log('[win32] found folder view after toggle via Progman');
        return fv;
      }

      // Re-enumerate ALL WorkerW windows post-toggle
      const workerWindows2 = findAllWindows('WorkerW');
      console.log(`[win32] post-toggle: found ${workerWindows2.length} WorkerW window(s)`);
      for (let i = 0; i < workerWindows2.length; i++) {
        fv = tryChain(workerWindows2[i], `WorkerW-post[${i}]`);
        if (fv) {
          console.log(`[win32] found folder view after toggle via WorkerW-post[${i}]`);
          return fv;
        }
      }
    }

    lastFindError =
      'Cannot find SHELLDLL_DefView/SysListView32 in any desktop window chain. ' +
      `Tried: Progman direct, ${findAllWindows('WorkerW').length} WorkerW(s), post-toggle Progman + ${findAllWindows('WorkerW').length} WorkerW(s). ` +
      'Your Windows configuration may not expose a standard desktop icon list.';
    console.error('[win32]', lastFindError);
    return null;
  } catch (e) {
    lastFindError = `Exception in findFolderView: ${e instanceof Error ? e.message : String(e)}`;
    console.error('[win32]', lastFindError);
    return null;
  }
}

export function hideIcons(): boolean {
  const fv = findFolderView();
  if (!fv) return false;
  try {
    const ret = getWin32()!.ShowWindow(fv, SW_HIDE);
    console.log('[win32] ShowWindow(HIDE) returned:', ret);
    return true; // If we got here without exception, consider it done
  } catch (e) {
    console.error('[win32] ShowWindow(HIDE) threw:', e);
    return false;
  }
}

export function showIcons(): boolean {
  const fv = findFolderView();
  if (!fv) return false;
  try {
    const ret = getWin32()!.ShowWindow(fv, SW_SHOW);
    console.log('[win32] ShowWindow(SHOW) returned:', ret);
    return true;
  } catch (e) {
    console.error('[win32] ShowWindow(SHOW) threw:', e);
    return false;
  }
}

export function isIconsHidden(): boolean {
  const fv = findFolderView();
  if (!fv) return false;
  try {
    const style = getWin32()!.GetWindowLongW(fv, GWL_STYLE);
    return (style & WS_VISIBLE) === 0;
  } catch {
    return false;
  }
}

/**
 * Force the desktop icon view to rebuild itself (equivalent to pressing F5 on
 * the desktop). Attribute/policy-only changes are NOT picked up by
 * SHChangeNotify(UPDATEDIR) — a real F5 posted to the SysListView32 is the
 * only reliable way we found to make them visible immediately.
 */
export function refreshDesktopView(): boolean {
  const api = getWin32();
  if (!api) return false;
  try {
    const WM_KEYDOWN = 0x0100;
    const WM_KEYUP = 0x0101;
    const VK_F5 = 0x74;
    let defview = api.FindWindowExW(api.FindWindowW('Progman', null), null, 'SHELLDLL_DefView', null);
    if (!defview) {
      let worker = null;
      for (let i = 0; i < 40 && !defview; i++) {
        worker = api.FindWindowExW(null, worker, 'WorkerW', null);
        if (!worker) break;
        defview = api.FindWindowExW(worker, null, 'SHELLDLL_DefView', null);
      }
    }
    if (!defview) return false;
    const list = api.FindWindowExW(defview, null, 'SysListView32', 'FolderView');
    const target = list || defview;
    api.PostMessageW(target, WM_KEYDOWN, VK_F5, 0);
    api.PostMessageW(target, WM_KEYUP, VK_F5, 0);
    return true;
  } catch (e) {
    console.warn('[win32] refreshDesktopView failed', e);
    return false;
  }
}

/**
 * Current cursor position in **physical screen pixels**.
 *
 * The renderer hit test needs this because a click-through layered window does
 * not always receive forwarded mouse-move messages on Windows; polling the
 * cursor is the only dependable way to know where the pointer is while the
 * layer is transparent.
 */
export function getCursorPos(): { x: number; y: number } | null {
  const api = getWin32();
  if (!api) return null;
  try {
    const pt: any = {};
    if (!api.GetCursorPos(pt)) return null;
    return { x: pt.x, y: pt.y };
  } catch {
    return null;
  }
}

export function setWallpaper(path: string): boolean {
  const api = getWin32();
  if (!api) return false;
  try {
    const buf = Buffer.from(path + '\0', 'utf16le');
    const ok = !!api.SystemParametersInfoW(
      SPI_SETDESKWALLPAPER,
      0,
      buf,
      SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
    );
    console.log('[win32] SystemParametersInfoW(set wallpaper) returned:', ok);
    return ok;
  } catch (e) {
    console.error('[win32] setWallpaper failed', e);
    return false;
  }
}

export function getWallpaper(): string {
  const api = getWin32();
  if (!api) return '';
  try {
    const buf = Buffer.alloc(MAX_PATH * 2);
    const ok = api.SystemParametersInfoW(SPI_GETDESKWALLPAPER, MAX_PATH, buf, 0);
    if (!ok) return '';
    return buf.toString('utf16le').replace(/\0.*/s, '').trim();
  } catch {
    return '';
  }
}

const STYLE_MAP: Record<string, { wallpaperStyle: string; tile: string }> = {
  fill: { wallpaperStyle: '10', tile: '0' },
  fit: { wallpaperStyle: '6', tile: '0' },
  stretch: { wallpaperStyle: '2', tile: '0' },
  tile: { wallpaperStyle: '0', tile: '1' },
  center: { wallpaperStyle: '0', tile: '0' }
};

/** Set the Windows wallpaper fit style via the registry, then re-apply. */
export function setWallpaperStyle(mode: string): boolean {
  const map = STYLE_MAP[mode];
  if (!map || !isWindows) return false;
  try {
    execFileSync(
      'reg',
      [
        'add',
        'HKCU\\Control Panel\\Desktop',
        '/v',
        'WallpaperStyle',
        '/t',
        'REG_SZ',
        '/d',
        map.wallpaperStyle,
        '/f'
      ],
      { stdio: 'ignore' }
    );
    execFileSync(
      'reg',
      [
        'add',
        'HKCU\\Control Panel\\Desktop',
        '/v',
        'TileWallpaper',
        '/t',
        'REG_SZ',
        '/d',
        map.tile,
        '/f'
      ],
      { stdio: 'ignore' }
    );
    // Re-apply current wallpaper so the new style takes effect immediately.
    const current = getWallpaper();
    if (current) setWallpaper(current);
    return true;
  } catch (e) {
    console.error('[win32] setWallpaperStyle failed', e);
    return false;
  }
}
