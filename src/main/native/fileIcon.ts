import { app, shell } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { indexedIconPng, namespaceIconPng, shellIconPng } from './shellIcon';

/**
 * Icon resolution.
 *
 * `app.getFileIcon()` asks the shell for the icon of a *path*. For a `.lnk`
 * Windows answers with the generic shortcut icon, so every desktop shortcut
 * looked identical. We therefore resolve the shortcut first and fetch the icon
 * of the program it points at.
 */

const cache = new Map<string, string>();

/** A resolved icon source: a file path plus an optional resource index (",N"). */
interface IconRef {
  path: string;
  index: number | null;
}

/** Expand %SystemRoot%-style variables that appear in shortcut icon fields. */
function expandEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (m, name) => {
    const v = process.env[name];
    return v === undefined ? m : v;
  }).trim();
}

function usableFile(p: string): boolean {
  if (!p) return false;
  const clean = p.split(',')[0].trim(); // "C:\x\y.dll,0" -> path
  if (!clean || !isAbsolute(clean)) return false;
  try {
    return existsSync(clean);
  } catch {
    return false;
  }
}

/**
 * Split an IconLocation into path + resource index.
 * "C:\a\b.dll,3"    -> { path: "C:\a\b.dll", index: 3 }
 * "%SystemRoot%\a.dll,-109" -> { path: <expanded>, index: -109 }
 * The index is significant: a single DLL can hold many icons and shortcuts
 * to the same app family differ only by this number.
 */
function parseIconRef(raw: string): IconRef | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/^"?([^",]+)"?(?:\s*,\s*(-?\d+))?\s*$/);
  const path = expandEnv(m ? m[1] : s).replace(/^"(.*)"$/, '$1').trim();
  if (!path) return null;
  const index = m && m[2] !== undefined ? parseInt(m[2], 10) : null;
  return { path, index };
}

/**
 * Fallback for shortcuts that `shell.readShortcutLink` refuses to parse
 * (Store / MSIX-style links often carry no LinkInfo block). We scrape the
 * binary for printable path-like strings and keep the ones that really exist.
 *
 * Segment names are stored separately from the directory, e.g.
 * "D:\installSoft\Microsoft VS Code" + "Code.exe", so full paths as well as
 * directory/executable combinations are tried.
 */
function guessFromLnkBinary(lnk: string): string | null {
  let buf: Buffer;
  try {
    buf = readFileSync(lnk);
  } catch {
    return null;
  }

  const found = new Set<string>();
  const collect = (offset: number) => {
    let run: number[] = [];
    const flush = () => {
      if (run.length >= 4) found.add(String.fromCharCode(...run));
      run = [];
    };
    for (let i = offset; i + 1 < buf.length; i += 2) {
      const c = buf.readUInt16LE(i);
      if (c >= 0x20 && c < 0x7f) run.push(c);
      else flush();
    }
    flush();
  };
  collect(0);
  collect(1); // UTF-16 runs are not always 2-byte aligned from byte 0

  const clean = (s: string) => s.trim().replace(/^["'`\s]+|["'`\s]+$/g, '');

  const dirs: string[] = [];
  const names: string[] = [];
  const fullPaths: string[] = [];

  for (const raw of found) {
    const s = clean(raw);
    if (!s) continue;
    if (/^[a-zA-Z]:\\/.test(s)) {
      const d = s.replace(/[\\"`' ]+$/, '');
      if (/\.(exe|ico)$/i.test(d)) fullPaths.push(d);
      else if (d.length > 3) dirs.push(d);
      continue;
    }
    if (/^[^\\/:*?"<>|]+\.(exe|ico)$/i.test(s)) names.push(s);
  }

  // 1) Complete paths first.
  let best: string | null = null;
  for (const p of fullPaths) {
    if (usableFile(p) && (!best || p.length > best.length)) best = p;
  }
  if (best) return best;

  // 2) Rebuild "directory + executable" and keep what exists on disk.
  for (const dir of dirs) {
    for (const name of names) {
      const guess = `${dir}\\${name}`;
      if (usableFile(guess)) return guess;
    }
  }
  return null;
}

/**
 * Resolve a `.lnk` to the icon Windows actually displays for it.
 *
 * Windows draws a shortcut with the icon named in its IconLocation field
 * ("C:\x\app.dll,3"), NOT the target program's default icon. The old code
 * preferred `target`, so every shortcut showed its exe's generic icon even
 * when Explorer showed a bespoke one. Worse, the resource index was dropped,
 * so shortcuts sharing one DLL with different indices all collided.
 *
 * Preference now: IconLocation (with index) -> target program -> binary guess.
 */
function iconSourceForLnk(lnk: string): IconRef | null {
  try {
    const sc = shell.readShortcutLink(lnk);
    const custom = parseIconRef(String(sc.icon || ''));
    const target = expandEnv(String(sc.target || '')).replace(/^"(.*)"$/, '$1');

    /* The shortcut's own icon location is authoritative — keep its index. */
    if (custom && usableFile(custom.path)) return custom;
    if (target && usableFile(target) && extname(target).toLowerCase() !== '.lnk') {
      return { path: target, index: null };
    }
  } catch (e) {
    // Store / MSIX-style links, broken links, network paths, ...
    console.warn('[fileIcon] readShortcutLink failed for', lnk, e instanceof Error ? e.message : e);
    const guessed = guessFromLnkBinary(lnk);
    if (guessed) {
      console.log('[fileIcon] recovered target from binary:', lnk, '->', guessed);
      return { path: guessed, index: null };
    }
  }
  return null;
}

/** A `.url` internet shortcut stores its icon in an INI field, not in the target. */
function iconSourceForUrl(urlFile: string): IconRef | null {
  try {
    const text = readFileSync(urlFile, 'utf-8');
    const m = text.match(/^\s*IconFile\s*=\s*(.+)$/im);
    if (!m) return null;
    const ref = parseIconRef(m[1]);
    return ref && usableFile(ref.path) ? ref : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort icon source for a path. Returns the path itself for normal files
 * and the resolved icon location (path + index) for shortcuts.
 */
export function resolveIconSource(filePath: string): IconRef {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.lnk') return iconSourceForLnk(filePath) ?? { path: filePath, index: null };
  if (ext === '.url') return iconSourceForUrl(filePath) ?? { path: filePath, index: null };
  return { path: filePath, index: null };
}

/** Simple concurrency guard: shell icon lookups are native and not free. */
let active = 0;
const waiting: (() => void)[] = [];
const MAX_CONCURRENT = 4;

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

/**
 * A shortcut may point its icon at a real image file. `app.getFileIcon()` would
 * answer with the *file-type* icon (the generic "ICO file" glyph), so image
 * files are read and inlined instead — Chromium renders .ico natively.
 */
const IMAGE_MIME: Record<string, string> = {
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

function inlineImageDataUrl(p: string): string | null {
  const mime = IMAGE_MIME[extname(p).toLowerCase()];
  if (!mime) return null;
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size === 0 || st.size > 4 * 1024 * 1024) return null;
    return `data:${mime};base64,${readFileSync(p).toString('base64')}`;
  } catch {
    return null;
  }
}

/**
 * Extract the largest PNG-compressed frame out of an `.ico` container.
 *
 * Some icon files (e.g. Feishu's) carry BMP frames with an all-transparent
 * AND mask. Explorer ignores the mask when an alpha channel exists, but
 * Chromium's ICO decoder honors it and composites the icon to full
 * transparency — the image "loads" yet paints nothing. Standalone PNG frames
 * have no mask, so serving one directly sidesteps the bug entirely.
 */
function pngFrameFromIco(p: string): string | null {
  try {
    const buf = readFileSync(p);
    // ICO header: reserved(2)=0, type(2)=1, count(2)
    if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) return null;
    const count = buf.readUInt16LE(4);
    let best: Buffer | null = null;
    let bestW = -1;
    for (let i = 0; i < count; i++) {
      const o = 6 + i * 16;
      if (o + 16 > buf.length) break;
      const w = buf[o] || 256; // 0 means 256
      const len = buf.readUInt32LE(o + 8);
      const off = buf.readUInt32LE(o + 12);
      if (len === 0 || off + len > buf.length) continue;
      if (buf.readUInt32BE(off) !== 0x89504e47) continue; // not a PNG frame
      if (w > bestW) {
        best = buf.subarray(off, off + len);
        bestW = w;
      }
    }
    return best ? 'data:image/png;base64,' + best.toString('base64') : null;
  } catch {
    return null;
  }
}

/**
 * Get a file/folder icon as a data URL.
 * For shortcuts the icon named by their IconLocation is used (including the
 * resource index), matching what Windows Explorer shows. Falls back to the
 * target program / shell answer when the link cannot be resolved.
 */
export async function getFileIconDataURL(filePath: string, size = 32): Promise<string> {
  const key = `${filePath}|${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const ref = resolveIconSource(filePath);
  const source = ref.path;
  let out = '';

  // An explicit resource index (",3" / ",-109") points at one icon inside an
  // exe/dll. SHGetFileInfoW cannot target it, so extract by index directly —
  // this is what keeps sibling shortcuts from sharing one glyph.
  if (ref.index !== null) {
    try {
      const png = await withSlot(() => Promise.resolve(indexedIconPng(source, ref.index!)));
      if (png) {
        out = 'data:image/png;base64,' + png.toString('base64');
        cache.set(key, out);
        return out;
      }
    } catch (e) {
      console.warn('[fileIcon] indexed icon failed', source, ref.index, e instanceof Error ? e.message : e);
    }
  }

  // Image-backed icons are inlined as-is (.png/.jpg sources).
  if (extname(source).toLowerCase() !== '.ico') {
    const inline = inlineImageDataUrl(source);
    if (inline) {
      cache.set(key, inline);
      return inline;
    }
  } else {
    // .ico containers: prefer an embedded PNG frame, then the native shell
    // extraction — Chromium's ICO decoder can composite broken-mask BMP
    // frames to full transparency (Feishu's icon.ico), so raw bytes are the
    // last resort only.
    const pngFrame = pngFrameFromIco(source);
    if (pngFrame) {
      cache.set(key, pngFrame);
      return pngFrame;
    }
    try {
      const png = await withSlot(() => Promise.resolve(shellIconPng(source)));
      if (png) {
        out = 'data:image/png;base64,' + png.toString('base64');
        cache.set(key, out);
        return out;
      }
    } catch (e) {
      console.warn('[fileIcon] ico shell extraction failed', source, e instanceof Error ? e.message : e);
    }
    const inline = inlineImageDataUrl(source);
    if (inline) {
      cache.set(key, inline);
      return inline;
    }
  }

  const fetchIcon = async (p: string): Promise<string> => {
    const img = await app.getFileIcon(p, { size: size as any });
    return img.toDataURL();
  };

  // Shell namespace entries (此电脑 / 回收站): read the real icon resource
  // from the registry — SHGetFileInfoW only answers with a generic folder.
  if (source.startsWith('::')) {
    try {
      out = await withSlot(async () => {
        const png = namespaceIconPng(source);
        return png ? 'data:image/png;base64,' + png.toString('base64') : '';
      });
    } catch (e) {
      console.warn('[fileIcon] namespace icon failed', source, e instanceof Error ? e.message : e);
    }
    if (out) {
      cache.set(key, out);
      return out;
    }
  }

  // Explorer-grade extraction first: app.getFileIcon returns a generic
  // "application window" glyph for several modern exes (Tauri / Electron apps).
  try {
    out = await withSlot(async () => {
      const png = shellIconPng(source);
      return png ? 'data:image/png;base64,' + png.toString('base64') : '';
    });
  } catch (e) {
    console.warn('[fileIcon] shell icon failed', source, e instanceof Error ? e.message : e);
  }

  if (!out) {
    try {
      out = await withSlot(() => fetchIcon(source));
    } catch (e) {
      console.warn('[fileIcon] icon lookup failed', source, e instanceof Error ? e.message : e);
    }
  }

  if (!out && source !== filePath) {
    try {
      out = await withSlot(() => fetchIcon(filePath));
    } catch {
      /* ignore */
    }
  }

  cache.set(key, out);
  return out;
}
