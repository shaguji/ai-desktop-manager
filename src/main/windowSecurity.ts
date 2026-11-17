import { shell } from 'electron';
import type { BrowserWindow } from 'electron';

/**
 * 窗口导航加固。所有窗口默认：
 *  · window.open / target=_blank → 拒绝开新窗口（http(s) 交给系统浏览器）
 *  · 页内跳转 → 只允许「回到当前页面本身」，http(s) 交给系统浏览器，
 *    其余（file:// 其它文件、自定义协议）一律拦截。
 *
 * 主进程 loadFile/loadURL 不会触发 will-navigate（Electron 只在渲染层发起
 * 导航时发这个事件），所以初始加载不受影响。
 */
export function hardenWindow(win: BrowserWindow): void {
  const wc = win.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url).catch(() => { /* 用户可能取消 */ });
    }
    /* file:// 或自定义协议一律不开新窗口 —— 新窗口会继承完整 preload */
    return { action: 'deny' };
  });

  wc.on('will-navigate', (e, url) => {
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault();
      void shell.openExternal(url).catch(() => { /* ignore */ });
      return;
    }
    /* 允许「刷新到当前页」；其它 file:// 路径与自定义协议全部拦截 */
    let current = '';
    try { current = wc.getURL().split('#')[0]; } catch { /* ignore */ }
    const bare = url.split('#')[0];
    if (current && bare === current) return;
    e.preventDefault();
  });
}
