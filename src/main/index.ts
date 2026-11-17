import './bootLog'; // MUST stay first: captures load-time crashes into main.log
import { app, BrowserWindow, Tray, Menu, nativeImage, screen, globalShortcut } from 'electron';
import * as path from 'node:path';
import { makeDesktopWindow } from './desktopLayer';
import { registerIpc } from './ipc';
import { loadConfig, patchConfig } from './config';
import { isOrganized, applyOrganize, hideOrgFolder } from './organizer';
import { openNotesWindow, openNotesHome, migrateInlineMedia } from './notes';
import { closeOfficeAIWindow, prepareOfficeOCR, getOfficeAIWindow } from './officeAI';
import { hardenWindow } from './windowSecurity';
import {
  registerFinderIpc,
  warmUpFinder,
  toggleFinder,
  openFinder,
  stopFinder
} from './finder';
import * as win32 from './native/win32';
import * as sysIcons from './native/sysIcons';
import * as wp from './wallpaper';
import { ICON_BASE64 } from './icon';

let desktopWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let scheduleTimer: NodeJS.Timeout | null = null;

const RENDERER_URL = process.env.ELECTRON_RENDERER_URL;

// Windows needs an explicit AppUserModelID before any toast can be shown;
// must match build.appId so the notification is attributed to the app.
app.setAppUserModelId('com.workbuddy.desktopmanager');

app.on('child-process-gone', (_e, d) => {
  console.error('[crash] child-process-gone', JSON.stringify(d));
});
process.on('exit', (code) => {
  console.error('[exit] main process exiting, code =', code);
});

/**
 * Only one desktop layer may exist. Without this, launching the app twice
 * (shortcut + tray, or after a silent crash) stacked two transparent windows
 * and made the panels flicker/disappear while dragging.
 */
const isPrimaryInstance = app.requestSingleInstanceLock();
if (!isPrimaryInstance) {
  console.error('[boot] another instance is already running — quitting this one');
  app.quit();
} else {
  app.on('second-instance', () => {
    // Bring the existing instance forward instead of starting a second layer.
    openSettingsWindow();
  });
}

function rendererUrl(hash = ''): string {
  if (RENDERER_URL) return RENDERER_URL + hash;
  return path.join(__dirname, '../renderer/index.html') + hash;
}

function createDesktopWindow(): BrowserWindow {
  const { width, height, x, y } = screen.getPrimaryDisplay().bounds;
  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    hasShadow: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // The alarm ringtone is Web Audio: it must be allowed to start without
      // a prior click, otherwise the alarm fires silently.
      autoplayPolicy: 'no-user-gesture-required'
    }
  });
  makeDesktopWindow(win);
  hardenWindow(win);
  // Crash forensics: a renderer that dies takes the whole UI with it, and the
  // packaged build has no console, so record why before anything else.
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error('[crash] renderer gone:', JSON.stringify(details));
    // Self-heal: reload the layer instead of leaving the user with an empty
    // desktop and a dead-looking app. Restarting by hand is not acceptable UX.
    if (details.reason !== 'clean-exit' && !win.isDestroyed()) {
      setTimeout(() => {
        if (!win.isDestroyed()) win.reload();
      }, 600);
    }
  });
  win.webContents.on('unresponsive', () => console.error('[crash] renderer unresponsive'));
  win.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error('[crash] did-fail-load', code, desc, url)
  );
  // Dev aid: DM_LOG_RENDERER=1 forwards renderer console output to the terminal,
  // which is otherwise invisible for a frameless background window.
  if (process.env.DM_LOG_RENDERER) {
    win.webContents.on('console-message', (_e, _level, message) => {
      if (message.startsWith('[passthrough]')) console.log('[renderer]', message);
    });
  }
  // Dev aid: DM_SNAPSHOT=<file> captures the desktop layer after it settles.
  if (process.env.DM_SNAPSHOT) {
    const file = process.env.DM_SNAPSHOT;
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await win.webContents.capturePage();
          const { writeFileSync, mkdirSync } = await import('node:fs');
          const { dirname } = await import('node:path');
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, img.toPNG());
          console.log('[snapshot] saved', file, img.getSize());
        } catch (e) {
          console.error('[snapshot] failed', e);
        }
      }, 15000);
    });
  }
  // Dev aid: DM_WP_SHOT=<file> opens the wallpaper picker, then captures the desktop layer.
  if (process.env.DM_WP_SHOT) {
    const file = process.env.DM_WP_SHOT;
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await win.webContents.executeJavaScript(
            "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '换壁纸')?.click()",
            true
          );
          await new Promise((r) => setTimeout(r, 1200));
          const img = await win.webContents.capturePage();
          const { writeFileSync, mkdirSync } = await import('node:fs');
          const { dirname } = await import('node:path');
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, img.toPNG());
          console.log('[wp-snapshot] saved', file, img.getSize());
        } catch (e) {
          console.error('[wp-snapshot] failed', e);
        } finally {
          app.exit(0);
        }
      }, 6000);
    });
  }
  // Dev aid: DM_DESK_JS=<js> runs in the desktop window, then DM_DESK_SHOT=<file>
  // captures the result. Handy for driving widget interactions that have no UI hook.
  if (process.env.DM_DESK_JS) {
    const script = process.env.DM_DESK_JS;
    const file = process.env.DM_DESK_SHOT;
    win.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const out = await win.webContents.executeJavaScript(script, true);
          console.log('[desk-js]', typeof out === 'object' ? JSON.stringify(out) : out);
          if (file) {
            await new Promise((r) => setTimeout(r, 400));
            const img = await win.webContents.capturePage();
            const { writeFileSync, mkdirSync } = await import('node:fs');
            const { dirname } = await import('node:path');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, img.toPNG());
            console.log('[desk-snapshot] saved', file, img.getSize());
          }
        } catch (e) {
          console.error('[desk-js] failed', e);
        } finally {
          app.exit(0);
        }
      }, 4500);
    });
  }
  win.loadURL(rendererUrl());
  return win;
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 960,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    title: '桌面管家 - 设置',
    autoHideMenuBar: true,
    // ICON_BASE64 is a bare base64 string — createFromDataURL would yield a
    // 0x0 empty image (same trap as the tray icon).
    icon: nativeImage.createFromBuffer(Buffer.from(ICON_BASE64, 'base64')),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  settingsWindow.loadURL(rendererUrl('#settings'));
  hardenWindow(settingsWindow);
  // Crash forensics + self-heal: a blank settings window used to be a dead
  // renderer with no trace. Log why and reload instead of staying blank.
  settingsWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[crash] settings renderer gone:', JSON.stringify(details));
    if (details.reason !== 'clean-exit' && !settingsWindow!.isDestroyed()) {
      setTimeout(() => {
        if (!settingsWindow!.isDestroyed()) settingsWindow!.reload();
      }, 600);
    }
  });
  settingsWindow.webContents.on('did-fail-load', (_e, code, desc, url) =>
    console.error('[crash] settings did-fail-load', code, desc, url)
  );
  settingsWindow.webContents.on(
    'preload-error',
    (_e, p, err) => console.error('[crash] settings preload-error', p, err)
  );
  // Dev aid: DM_SETTINGS_SHOT=<file> scrolls the theme card into view and captures it.
  if (process.env.DM_SETTINGS_SHOT) {
    const file = process.env.DM_SETTINGS_SHOT;
    settingsWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await settingsWindow!.webContents.executeJavaScript(
            "document.querySelector('.theme-presets')?.scrollIntoView({ block: 'center' }); true",
            true
          );
          await new Promise((r) => setTimeout(r, 700));
          const img = await settingsWindow!.webContents.capturePage();
          const { writeFileSync, mkdirSync } = await import('node:fs');
          const { dirname } = await import('node:path');
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, img.toPNG());
          console.log('[settings-snapshot] saved', file, img.getSize());
        } catch (e) {
          console.error('[settings-snapshot] failed', e);
        }
      }, 1800);
    });
  }
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
}

function restartSchedule(): void {
  if (scheduleTimer) {
    clearInterval(scheduleTimer);
    scheduleTimer = null;
  }
  const s = loadConfig().wallpaper.schedule;
  if (s.enabled && s.dir) {
    scheduleTimer = setInterval(
      () => {
        const next = wp.pickNext(s.dir, s.random, loadConfig().wallpaper.lastWallpaper);
        if (next) {
          wp.setWallpaper(next);
          patchConfig({ wallpaper: { lastWallpaper: next } } as any);
        }
      },
      Math.max(1, s.intervalMin) * 60 * 1000
    );
  }
}

function buildTrayMenu(): Menu {
  const cfg = loadConfig();
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: '打开设置', click: () => openSettingsWindow() },
    { label: '随手记', click: () => openNotesHome() },
    { label: '本地查找（Ctrl+Shift+F）', click: () => openFinder(rendererUrl) },
    { type: 'separator' },
    {
      label: '一键整理桌面',
      click: () => {
        const r = applyOrganize(app.getPath('desktop'));
        // Same contract as the toolbar button: files move into the fence and
        // the native desktop goes blank.
        if (!win32.isIconsHidden() && win32.hideIcons()) {
          desktopWindow?.webContents.send('icons:changed', true);
        }
        desktopWindow?.webContents.send('organizer:changed');
        if (!r.ok) console.error('[tray] organize failed', r.error);
      }
    },
    {
      label: '换一张壁纸',
      click: () => {
        const c = loadConfig();
        const next = wp.pickNext(c.wallpaper.schedule.dir, c.wallpaper.schedule.random, c.wallpaper.lastWallpaper);
        if (next) {
          wp.setWallpaper(next);
          patchConfig({ wallpaper: { lastWallpaper: next } } as any);
          desktopWindow?.webContents.send('wallpaper:changed', next);
        }
      }
    },
    { type: 'separator' },
    {
      label: '开机自动启动',
      type: 'checkbox',
      checked: cfg.settings.loginItem,
      click: () => {
        const enabled = !cfg.settings.loginItem;
        app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args: [] });
        patchConfig({ settings: { loginItem: enabled } } as any);
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ];
  return Menu.buildFromTemplate(template);
}

function createTray(): void {
  try {
    // ICON_BASE64 是裸 base64（无 data: 前缀），必须用 createFromBuffer；
    // 用 createFromDataURL 会得到 0x0 空图，托盘注册成功但图标不可见。
    const icon = nativeImage.createFromBuffer(Buffer.from(ICON_BASE64, 'base64'));
    console.log('[tray] icon empty?', icon.isEmpty(), 'size', icon.getSize().width + 'x' + icon.getSize().height);
    tray = new Tray(icon);
    tray.setToolTip('桌面管家');
    tray.setContextMenu(buildTrayMenu());
    tray.on('click', () => openSettingsWindow());
    setTimeout(() => {
      try {
        const b = tray!.getBounds();
        console.log('[tray] bounds', JSON.stringify(b));
      } catch (e) {
        console.error('[tray] getBounds failed', e);
      }
    }, 3000);
    console.log('[tray] created ok');
  } catch (e) {
    console.error('[tray] create failed', e);
  }
}

app.whenReady().then(() => {
  // A second launch must never build a second transparent layer.
  if (!isPrimaryInstance) return;
  desktopWindow = createDesktopWindow();
  registerIpc({
    getDesktopWindow: () => desktopWindow,
    openSettings: openSettingsWindow,
    restartSchedule
  });
  createTray();
  restartSchedule();

  /* 本地查找：Ctrl+Shift+F 随时唤起（索引在后台预热，不挡输入） */
  registerFinderIpc();
  const finderHotkey = 'Control+Shift+F';
  if (!globalShortcut.register(finderHotkey, () => toggleFinder(rendererUrl))) {
    console.error('[finder] 快捷键注册失败，可能被其它程序占用：', finderHotkey);
  }
  warmUpFinder();

  const cfg = loadConfig();
  if (cfg.settings.hideIconsOnStart) win32.hideIcons();
  if (cfg.settings.sysIconsHidden) {
    sysIcons.setSystemIconsHidden(true, app.getPath('desktop'));
  }
  // The 整理 container is infrastructure — always keep it off the desktop view.
  hideOrgFolder(app.getPath('desktop'));
  // 上次处于分组显示 / 开启了开机自动整理：补上开关即可。
  // 原位分组不移动任何文件，所以这里不需要（也不应该）做「清扫归档」。
  if (cfg.settings.autoOrganizeOnStart || isOrganized(app.getPath('desktop'))) {
    applyOrganize(app.getPath('desktop'));
    desktopWindow?.webContents.send('organizer:changed');
  }

  // 把历史笔记正文里的 base64 附件落盘（旧 bug 会把录音整段塞进正文），要在窗口加载前完成
  try { migrateInlineMedia(); } catch (e) { console.error('[notes] migrate failed', e); }

  // Dev convenience: DM_OPEN_SETTINGS=1 pops the settings window on launch so
  // the app is immediately visible (the desktop layer sits below all windows).
  if (process.env.DM_OPEN_SETTINGS === '1') openSettingsWindow();
  // Dev convenience: DM_OPEN_NOTES=1 opens the 归墨 notes window on launch.
  if (process.env.DM_OPEN_NOTES === '1') openNotesWindow();
  // Dev convenience: DM_OPEN_FINDER=1 opens the local search panel on launch.
  if (process.env.DM_OPEN_FINDER === '1') openFinder(rendererUrl);
  // Dev aid: DM_OFFICE_TEST=1 触发一次静默的办公网识别准备（1x1 PNG），
  // 用于验证「网络不通 → 提示并关窗」链路是否正常收口；
  // DM_OFFICE_TEST=show 走带提示框的正式路径（用于人工确认弹窗文案）。
  if (process.env.DM_OFFICE_TEST) {
    const silent = process.env.DM_OFFICE_TEST !== 'show';
    setTimeout(() => {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      void prepareOfficeOCR(png, { silent }).then((r) => {
        console.log('[office-test] result=' + JSON.stringify(r));
        console.log('[office-test] window=' + (getOfficeAIWindow() ? 'alive' : 'closed'));
      }).catch((e) => console.error('[office-test] failed', e));
    }, 2500);
  }
  // Dev aid: DM_SEND_HOTKEY=1 presses Ctrl+Shift+F via SendInput after 6s,
  // so the global shortcut path is exercised end-to-end in headless runs.
  if (process.env.DM_SEND_HOTKEY === '1') {
    setTimeout(() => {
      try {
        const koffi = require('koffi');
        const user32 = koffi.load('user32.dll');
        const SendInput = user32.func('int SendInput(int, uint8_t*, int)');
        /* INPUT 结构（x64，40 字节）：type 在 0，KEYBDINPUT 从 8 开始 */
        const press = (vk: number, up = false) => {
          const buf = Buffer.alloc(40);
          buf.writeUInt32LE(1, 0); // INPUT_KEYBOARD
          buf.writeUInt16LE(vk, 8);
          buf.writeUInt32LE(up ? 0x0002 : 0, 12); // KEYEVENTF_KEYUP
          const r = SendInput(1, buf, 40);
          if (r !== 1) throw new Error('SendInput returned ' + r);
        };
        press(0x11); press(0x10); press(0x46);
        setTimeout(() => { press(0x46, true); press(0x10, true); press(0x11, true); }, 60);
        console.log('[finder] hotkey injected');
      } catch (e) {
        console.error('[finder] hotkey inject failed', e);
      }
    }, 6000);
  }
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  stopFinder();
  closeOfficeAIWindow();
});

app.on('window-all-closed', () => {
  // Keep running in the tray even if all windows close.
});
