import koffi from 'koffi';
import { nativeImage } from 'electron';

/**
 * Explorer-grade icon extraction.
 *
 * Electron's `app.getFileIcon()` answers with a generic "application window"
 * glyph for several modern exes (Tauri / Electron apps such as Clash Verge and
 * CC Switch), while Explorer shows their real logo. Explorer resolves icons via
 * SHGetFileInfoW *without* SHGFI_USEFILEATTRIBUTES, so we do the same through
 * koffi and render the HICON into a PNG ourselves.
 *
 * Verified on this machine: shell lookup returns the genuine Clash Verge cat
 * and QQ penguin where app.getFileIcon returned placeholders.
 */

const SHGFI_ICON = 0x100;
const SHGFI_LARGEICON = 0x0;

let fns: ShellIconFns | null = null;
let loadFailed = false;

interface ShellIconFns {
  SHGetFileInfoW: (path: string, attrs: number, sfi: object, cb: number, flags: number) => number;
  sizeofSHFILEINFOW: number;
  GetIconInfo: (hicon: unknown, ii: object) => number;
  sizeofICONINFO: number;
  GetObjectW: (obj: unknown, cb: number, bm: object) => number;
  sizeofBITMAP: number;
  sizeofBITMAPINFOHEADER: number;
  CreateCompatibleDC: (hdc: unknown) => unknown;
  DeleteDC: (hdc: unknown) => number;
  DeleteObject: (obj: unknown) => number;
  GetDIBits: (
    hdc: unknown,
    hbm: unknown,
    start: number,
    lines: number,
    bits: Buffer,
    bi: object,
    usage: number
  ) => number;
  DestroyIcon: (hicon: unknown) => number;
  ExtractIconExW: (
    file: string,
    index: number,
    largeOut: unknown,
    smallOut: unknown,
    count: number
  ) => number;
  regOpen: (hkey: number | bigint, sub: string, opts: number, sam: number, hkOut: Buffer) => number;
  regQuery: (
    hk: number | bigint,
    name: string | null,
    reserved: null,
    typeOut: Buffer,
    data: Buffer,
    sizeOut: Buffer
  ) => number;
  regClose: (hk: number | bigint) => number;
}

function load(): ShellIconFns | null {
  if (fns) return fns;
  if (loadFailed || process.platform !== 'win32') return null;
  try {
    const user32 = koffi.load('user32.dll');
    const gdi32 = koffi.load('gdi32.dll');
    const shell32 = koffi.load('shell32.dll');
    const advapi32 = koffi.load('advapi32.dll');

    koffi.struct('SHFILEINFOW', {
      hIcon: 'void*',
      iIcon: 'int32',
      dwAttributes: 'uint32',
      szDisplayName: koffi.array('char16', 260),
      szTypeName: koffi.array('char16', 80)
    });
    koffi.struct('SI_ICONINFO', {
      fIcon: 'int32',
      xHotspot: 'uint32',
      yHotspot: 'uint32',
      hbmMask: 'void*',
      hbmColor: 'void*'
    });
    koffi.struct('SI_BITMAP', {
      bmType: 'int32',
      bmWidth: 'int32',
      bmHeight: 'int32',
      bmWidthBytes: 'int32',
      bmPlanes: 'uint16',
      bmBitsPixel: 'uint16',
      bmBits: 'void*'
    });
    koffi.struct('SI_BITMAPINFOHEADER', {
      biSize: 'uint32',
      biWidth: 'int32',
      biHeight: 'int32',
      biPlanes: 'uint16',
      biBitCount: 'uint16',
      biCompression: 'uint32',
      biSizeImage: 'uint32',
      biXPelsPerMeter: 'int32',
      biYPelsPerMeter: 'int32',
      biClrUsed: 'uint32',
      biClrImportant: 'uint32'
    });

    fns = {
      sizeofSHFILEINFOW: koffi.sizeof('SHFILEINFOW'),
      sizeofICONINFO: koffi.sizeof('SI_ICONINFO'),
      sizeofBITMAP: koffi.sizeof('SI_BITMAP'),
      sizeofBITMAPINFOHEADER: koffi.sizeof('SI_BITMAPINFOHEADER'),
      SHGetFileInfoW: shell32.func(
        'intptr_t __stdcall SHGetFileInfoW(str16 pszPath, uint32_t dwFileAttributes, _Out_ SHFILEINFOW *psfi, uint32_t cbFileInfo, uint32_t uFlags)'
      ),
      GetIconInfo: user32.func('int32_t __stdcall GetIconInfo(void* hIcon, _Out_ SI_ICONINFO *piconinfo)'),
      GetObjectW: gdi32.func('int32_t __stdcall GetObjectW(void* h, int32_t c, _Out_ SI_BITMAP *pv)'),
      CreateCompatibleDC: gdi32.func('void* __stdcall CreateCompatibleDC(void* hdc)'),
      DeleteDC: gdi32.func('int32_t __stdcall DeleteDC(void* hdc)'),
      DeleteObject: gdi32.func('int32_t __stdcall DeleteObject(void* ho)'),
      GetDIBits: gdi32.func(
        'int32_t __stdcall GetDIBits(void* hdc, void* hbm, uint32_t start, uint32_t cLines, void* lpvBits, SI_BITMAPINFOHEADER *lpbi, uint32_t usage)'
      ),
      DestroyIcon: user32.func('int32_t __stdcall DestroyIcon(void* hIcon)'),
      ExtractIconExW: shell32.func(
        'uint32_t __stdcall ExtractIconExW(str16 lpszFile, int32_t nIconIndex, void* phiconLarge, void* phiconSmall, uint32_t nIcons)'
      ),
      regOpen: advapi32.func(
        'int32_t __stdcall RegOpenKeyExW(intptr_t hKey, str16 lpSubKey, uint32_t ulOptions, uint32_t samDesired, void* phkResult)'
      ),
      regQuery: advapi32.func(
        'int32_t __stdcall RegQueryValueExW(intptr_t hKey, str16 lpValueName, void* lpReserved, void* lpType, void* lpData, void* lpcbData)'
      ),
      regClose: advapi32.func('int32_t __stdcall RegCloseKey(intptr_t hKey)')
    };
    return fns;
  } catch (e) {
    console.error('[shellIcon] koffi init failed', e);
    loadFailed = true;
    return null;
  }
}

/** Render one HICON handle into PNG bytes and release it. */
function renderHicon(f: ShellIconFns, hicon: unknown): Buffer | null {
  const ii: any = {};
  try {
    if (!hicon || !f.GetIconInfo(hicon, ii) || !ii.hbmColor) return null;
    const bm: any = {};
    if (!f.GetObjectW(ii.hbmColor, f.sizeofBITMAP, bm)) return null;
    const w = bm.bmWidth;
    const h = Math.abs(bm.bmHeight);
    if (!w || !h || w > 256 || h > 256) return null;

    const bi = {
      biSize: f.sizeofBITMAPINFOHEADER,
      biWidth: w,
      biHeight: -h, // top-down rows
      biPlanes: 1,
      biBitCount: 32,
      biCompression: 0, // BI_RGB
      biSizeImage: 0,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0
    };
    const buf = Buffer.alloc(w * h * 4);
    const hdc = f.CreateCompatibleDC(null);
    let ok = false;
    try {
      ok = !!f.GetDIBits(hdc, ii.hbmColor, 0, h, buf, bi, 0); // DIB_RGB_COLORS
    } finally {
      f.DeleteDC(hdc);
    }
    if (!ok) return null;

    // Icon bitmaps come premultiplied-BGRA, exactly what createFromBitmap wants.
    const img = nativeImage.createFromBitmap(buf, { width: w, height: h });
    return img.isEmpty() ? null : img.toPNG();
  } catch (e) {
    console.warn('[shellIcon] render failed', e);
    return null;
  } finally {
    try {
      if (ii.hbmColor) f.DeleteObject(ii.hbmColor);
      if (ii.hbmMask) f.DeleteObject(ii.hbmMask);
      if (hicon) f.DestroyIcon(hicon);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Render a file's shell icon exactly the way Explorer does. Returns PNG bytes
 * or null when the icon cannot be extracted.
 */
export function shellIconPng(filePath: string): Buffer | null {
  const f = load();
  if (!f) return null;

  const sfi: any = {};
  try {
    const r = f.SHGetFileInfoW(filePath, 0, sfi, f.sizeofSHFILEINFOW, SHGFI_ICON | SHGFI_LARGEICON);
    if (!r || !sfi.hIcon) return null;
  } catch (e) {
    console.warn('[shellIcon] SHGetFileInfoW failed for', filePath, e);
    return null;
  }
  return renderHicon(f, sfi.hIcon);
}

/**
 * Extract one specific icon resource from an exe/dll by index.
 *
 * A shortcut's IconLocation is usually "C:\path\app.dll,3". SHGetFileInfoW
 * only ever returns the DLL's first icon, so several shortcuts that share a
 * DLL but use different indices all collapsed onto one glyph. Passing the
 * index straight to ExtractIconExW keeps them distinct. A negative index is
 * a resource id (ExtractIconExW treats it as abs(value)).
 */
export function indexedIconPng(filePath: string, index: number): Buffer | null {
  const f = load();
  if (!f) return null;
  const large = Buffer.alloc(8);
  try {
    const n = f.ExtractIconExW(filePath, index, large, null, 1);
    if (n === 0) return null;
    const hicon = koffi.decode(large, 'void*');
    return renderHicon(f, hicon);
  } catch (e) {
    console.warn('[shellIcon] indexed extract failed', filePath, index, e instanceof Error ? e.message : e);
    return null;
  }
}

/** Read one string value out of the registry (REG_SZ / REG_EXPAND_SZ). */
function regGetString(f: ShellIconFns, hkeyRoot: bigint, subKey: string): string | null {
  const hkBuf = Buffer.alloc(8);
  try {
    const rc = f.regOpen(hkeyRoot, subKey, 0, 0x20019 /* KEY_READ */, hkBuf);
    if (rc !== 0) return null;
    const hk = hkBuf.readBigUInt64LE(0);
    const typeBuf = Buffer.alloc(4);
    const data = Buffer.alloc(2048);
    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(data.length);
    const rc2 = f.regQuery(hk, null, null, typeBuf, data, sizeBuf);
    if (rc2 !== 0) return null;
    const len = Math.min(sizeBuf.readUInt32LE(0), data.length);
    const text = data.toString('utf16le', 0, len).split('\0')[0];
    return text.trim() || null;
  } catch (e) {
    console.warn('[shellIcon] regGetString threw', e);
    return null;
  } finally {
    const hk = hkBuf.readBigUInt64LE(0);
    if (hk) f.regClose(hk);
  }
}

/**
 * Icons for shell namespace entries ("::{CLSID}", e.g. 此电脑 / 回收站).
 * SHGetFileInfoW answers those with a generic folder glyph, so the real icon
 * resource is read from HKCR\CLSID\{clsid}\DefaultIcon (e.g.
 * "%SystemRoot%\System32\imageres.dll,-109") and extracted directly.
 */
export function namespaceIconPng(target: string): Buffer | null {
  if (!target.startsWith('::')) return null;
  const f = load();
  if (!f) return null;

  const clsid = target.slice(2).split('/')[0];
  if (!clsid) return null;

  let value = regGetString(f, 0x80000000n /* HKCR */, `CLSID\\${clsid}\\DefaultIcon`);
  if (!value) value = regGetString(f, 0x80000000n, `CLSID\\${clsid}\\DefaultIcon\\empty`);
  if (!value) {
    console.warn('[shellIcon] no DefaultIcon for', clsid);
    return null;
  }

  // Formats: "C:\path\icon.dll,-109" | "%SystemRoot%\System32\imageres.dll,-109" | '"C:\x\a.exe",0'
  const m = value.match(/^(.*?)(?:\s*,\s*(-?\d+))?$/)!;
  const rawPath = m[1].replace(/^"(.*)"$/, '$1').trim();
  const iconId = m[2] ? parseInt(m[2], 10) : 0;
  if (!rawPath) return null;

  const expanded = rawPath.replace(/%([^%]+)%/g, (_s, name) => process.env[name] ?? _s);
  if (!existsSyncSafe(expanded)) {
    console.warn('[shellIcon] DefaultIcon file missing:', expanded);
    return null;
  }

  // Negative nIconIndex means "resource identifier = abs(nIconIndex)".
  const largeBuf = Buffer.alloc(8);
  const n = f.ExtractIconExW(expanded, iconId, largeBuf, null, 1);
  if (n === 0) {
    console.warn('[shellIcon] ExtractIconExW found no icon in', expanded, 'id', iconId);
    return null;
  }
  const hicon = koffi.decode(largeBuf, 'void*');
  return renderHicon(f, hicon);
}

function existsSyncSafe(p: string): boolean {
  try {
    return require('node:fs').existsSync(p);
  } catch {
    return false;
  }
}
