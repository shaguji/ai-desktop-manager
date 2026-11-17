import { app, shell } from 'electron';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute } from 'node:path';
import { namespaceIconPng, shellIconPng } from './shellIcon';

/**
 * Icon resolution.
 *
 * `app.getFileIcon()` asks the shell for the icon of a *path*. For a `.lnk`
 * Windows answers with the generic shortcut icon, so every desktop shortcut
 * looked identical. We therefore resolve the shortcut first and fetch the icon
 * of the program it points at.
 */

const cache = new Map<string, string>();

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

/** Split "C:\a\b.dll,3" into its path (the index cannot be used by getFileIcon). */
function stripIconIndex(p: string): string {
  const m = p.match(/^"?([^",]+)"?(?:,-?\d+)?$/);
  return (m ? m[1] : p).trim();
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
 * Resolve a `.lnk` to the file whose icon Windows would display for it.
 * Preference: a real .ico -> the target program -> any custom icon source.
 */
function iconSourceForLnk(lnk: string): string | null {
  try {
    const sc = shell.readShortcutLink(lnk);
    const customRaw = expandEnv(String(sc.icon || ''));
    const custom = stripIconIndex(customRaw);
    const target = expandEnv(String(sc.target || '')).replace(/^"(.*)"$/, '$1');

    if (custom && extname(custom).toLowerCase() === '.ico' && usableFile(custom)) return custom;
    if (target && usableFile(target) && extname(target).toLowerCase() !== '.lnk') return target;
    if (custom && usableFile(custom)) return custom;
  } catch (e) {
    // Store / MSIX-style links, broken links, network paths, ...
    console.warn('[fileIcon] readShortcutLink failed for', lnk, e instanceof Error ? e.message : e);
    const guessed = guessFromLnkBinary(lnk);
    if (guessed) {
      console.log('[fileIcon] recovered target from binary:', lnk, '->', guessed);
      return guessed;
    }
  }
  return null;
}

/** A `.url` internet shortcut stores its icon in an INI field, not in the target. */
function iconSourceForUrl(urlFile: string): string | null {
  try {
    const text = readFileSync(urlFile, 'utf-8');
    const m = text.match(/^\s*IconFile\s*=\s*(.+)$/im);
    if (!m) return null;
    const p = stripIconIndex(expandEnv(m[1]));
    return usableFile(p) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort icon source for a path. Returns the path itself for normal files
 * and the resolved program for shortcuts.
 */
export function resolveIconSource(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.lnk') return iconSourceForLnk(filePath) ?? filePath;
  if (ext === '.url') return iconSourceForUrl(filePath) ?? filePath;
  return filePath;
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
 * For shortcuts the icon of the linked program is used, falling back to the
 * shell's own answer when the link cannot be resolved.
 */
export async function getFileIconDataURL(filePath: string, size = 32): Promise<string> {
  const key = `${filePath}|${size}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  const source = resolveIconSource(filePath);
  let out = '';

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
