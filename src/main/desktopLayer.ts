import { BrowserWindow } from 'electron';
import { isWindows } from './native/ffi';

/**
 * Turn a window into a "desktop layer":
 *  - always on bottom (sits above the wallpaper, below normal windows)
 *  - skipped from the taskbar
 *  - transparent background with mouse events forwarded to the desktop,
 *    so only interactive widgets/fences capture clicks.
 */
export function makeDesktopWindow(win: BrowserWindow): void {
  // `alwaysOnBottom` is already set in the BrowserWindow constructor; the
  // setter exists on most Electron builds but guard it for safety.
  const anyWin = win as unknown as Record<string, any>;
  if (typeof anyWin.setAlwaysOnBottom === 'function') anyWin.setAlwaysOnBottom(true);
  if (typeof anyWin.setSkipTaskbar === 'function') anyWin.setSkipTaskbar(true);
  if (isWindows) {
    // On Windows the always-on-bottom + transparent combination is enough;
    // deeper WorkerW embedding is intentionally avoided to keep the app robust.
  }
  if (typeof anyWin.setIgnoreMouseEvents === 'function') {
    anyWin.setIgnoreMouseEvents(true, { forward: true });
  }
}

export function setWindowMousePassthrough(win: BrowserWindow, ignore: boolean): void {
  win.setIgnoreMouseEvents(ignore, { forward: true });
}
