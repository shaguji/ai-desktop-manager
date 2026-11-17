import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { app, nativeImage } from 'electron';

const IMG_EXTS = ['.png', '.jpg', '.jpeg'];

/** Where built-in wallpapers ship inside the app bundle. */
function bundledDir(): string {
  // dev: <project>/resources/wallpapers ; packaged: <resources>/app.asar/resources/wallpapers
  return join(app.getAppPath(), 'resources', 'wallpapers');
}

/** Real-folder copy the app serves from (SystemParametersInfoW needs a real path). */
export function userWallpaperDir(): string {
  const dir = join(app.getPath('userData'), 'wallpapers');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** One-time copy of bundled wallpapers into userData so they survive updates. */
export function ensureBuiltinWallpapers(): string {
  const dest = userWallpaperDir();
  try {
    const src = bundledDir();
    if (existsSync(src)) {
      for (const f of readdirSync(src)) {
        if (!IMG_EXTS.includes(extname(f).toLowerCase())) continue;
        const target = join(dest, f);
        if (!existsSync(target)) copyFileSync(join(src, f), target);
      }
    }
  } catch (e) {
    console.warn('[wallpapers] ensure failed', e);
  }
  return dest;
}

export interface BuiltinWallpaper {
  name: string;
  path: string;
  /** Small JPEG data URL for the picker grid. */
  thumb: string;
  /** True when this path is the current wallpaper. */
  current: boolean;
}

export function listBuiltinWallpapers(current: string | null): BuiltinWallpaper[] {
  const dir = ensureBuiltinWallpapers();
  const out: BuiltinWallpaper[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!IMG_EXTS.includes(extname(f).toLowerCase())) continue;
    const full = join(dir, f);
    let thumb = '';
    try {
      const img = nativeImage.createFromPath(full);
      if (!img.isEmpty()) {
        thumb =
          'data:image/jpeg;base64,' +
          img.resize({ width: 420 }).toJPEG(70).toString('base64');
      }
    } catch {
      /* skip broken image */
    }
    if (thumb) out.push({ name: basename(f, extname(f)), path: full, thumb, current: full === current });
  }
  return out;
}
