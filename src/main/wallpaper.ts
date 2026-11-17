import { readdirSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import * as win32 from './native/win32';

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif', 'tiff', 'heic'];

export function setWallpaper(path: string): boolean {
  return win32.setWallpaper(path);
}

export function getWallpaper(): string {
  return win32.getWallpaper();
}

export function setWallpaperMode(mode: string): boolean {
  return win32.setWallpaperStyle(mode);
}

export function listWallpapers(dir: string): string[] {
  if (!dir || !existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((f) => IMG_EXTS.includes(extname(f).toLowerCase().replace(/^\./, '')))
      .map((f) => join(dir, f));
  } catch {
    return [];
  }
}

/** Pick the next wallpaper from a directory (sequential or random). */
export function pickNext(dir: string, random: boolean, previous: string | null = null): string | null {
  const list = listWallpapers(dir);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  if (random) {
    let pick = previous;
    while (pick === previous) {
      pick = list[Math.floor(Math.random() * list.length)];
    }
    return pick;
  }
  const idx = previous ? list.indexOf(previous) : -1;
  return list[(idx + 1) % list.length];
}
