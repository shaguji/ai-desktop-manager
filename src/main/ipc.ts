import { ipcMain, app, shell, BrowserWindow, dialog, Notification } from 'electron';
import { execFile } from 'node:child_process';
import { unlinkSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, patchConfig, DEFAULT_CONFIG } from './config';
import { isPathInside } from './pathGuard';
import {
  scanDesktop,
  applyOrganize,
  undoOrganize,
  isOrganized
} from './organizer';
import * as win32 from './native/win32';
import * as sysIcons from './native/sysIcons';
import * as wp from './wallpaper';
import { listBuiltinWallpapers } from './wallpapers';
import { getFileIconDataURL } from './native/fileIcon';
import {
  readNotesState,
  writeNotesState,
  readAIConfigSafe,
  writeAIConfigSafe,
  readAIKey,
  readASRKey,
  getStickyItems,
  setStickyStatus,
  upsertStickyItem,
  syncStickyItems,
  saveNoteImage,
  saveNoteMedia,
  saveFlowSidecar,
  loadFlowSidecar,
  getMediaDir,
  setMediaDir,
  openNotesWindow,
  openNotesHome,
  broadcastSticky
} from './notes';
import {
  prepareOfficeOCR,
  prepareOfficeText,
  readOfficeOCRResult,
  readOfficeTextResult,
  openOfficeAIWindow,
  officeAIUrl,
  closeOfficeAIWindow,
  runOfficeAutoTask,
  cancelOfficeAutoTask,
  readOfficeSite,
  writeOfficeSite
} from './officeAI';

export interface IpcContext {
  getDesktopWindow: () => BrowserWindow | null;
  openSettings: () => void;
  restartSchedule: () => void;
}

function broadcast(ctx: IpcContext, channel: string, ...args: any[]) {
  const win = ctx.getDesktopWindow();
  // The desktop layer may be mid-reload (or gone after a renderer crash);
  // sending to a dead webContents throws and kills the whole IPC handler.
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
    try {
      win.webContents.send(channel, ...args);
    } catch (e: any) {
      console.warn('[ipc] broadcast failed', channel, e?.message ?? e);
    }
  }
}

/** 便签「详情」待处理的跳转目标（笔记窗口加载完成后取走） */
let pendingTrackFocus: string | null = null;

const notesJsonPath = (): string => join(app.getPath('userData'), 'notes.json');

export function registerIpc(ctx: IpcContext): void {
  const desktop = () => ctx.getDesktopWindow();

  // ---- window mouse passthrough (per-element) ----
  ipcMain.handle('window:setIgnoreMouseEvents', (_e, ignore: boolean, options?: any) => {
    desktop()?.setIgnoreMouseEvents(ignore, options ?? { forward: true });
  });
  // Cursor position fallback for the hit test (physical screen pixels).
  ipcMain.handle('window:getCursorPos', () => win32.getCursorPos());

  // ---- desktop path + icons ----
  ipcMain.handle('app:getDesktopPath', () => app.getPath('desktop'));
  /**
   * Repaint the desktop icon list. Called after anything that adds/removes
   * files while the list view was hidden — ShowWindow alone keeps the old
   * (stale) item list, which is why 撤销整理 used to show only 此电脑/回收站
   * until a second refresh.
   */
  const repaintDesktop = (): void => {
    const desktop = app.getPath('desktop');
    sysIcons.refreshDesktop(desktop);
    // The shell finishes applying the file moves a beat later; retry so the
    // rebuilt list includes them.
    setTimeout(() => sysIcons.refreshDesktop(desktop), 350);
    setTimeout(() => sysIcons.refreshDesktop(desktop), 900);
  };
  ipcMain.handle('app:hideIcons', () => {
    const ok = win32.hideIcons();
    return { ok, error: ok ? undefined : win32.lastFindError };
  });
  ipcMain.handle('app:showIcons', () => {
    const ok = win32.showIcons();
    if (ok) repaintDesktop();
    return { ok, error: ok ? undefined : win32.lastFindError };
  });
  ipcMain.handle('app:isIconsHidden', () => win32.isIconsHidden());
  ipcMain.handle('app:isSysIconsHidden', () => sysIcons.isSystemIconsHidden());
  ipcMain.handle('app:setSysIconsHidden', (_e, hidden: boolean) =>
    sysIcons.setSystemIconsHidden(!!hidden, app.getPath('desktop'))
  );
  ipcMain.handle('app:getFileIcon', (_e, filePath: string, size?: number) =>
    getFileIconDataURL(filePath, size ?? 32)
  );

  // ---- organizer ----
  ipcMain.handle('organizer:scan', () => scanDesktop(app.getPath('desktop')));
  ipcMain.handle('organizer:apply', () => {
    try {
      const r = applyOrganize(app.getPath('desktop'));
      console.log('[organizer] apply:', JSON.stringify(r));
      broadcast(ctx, 'organizer:changed');
      return r;
    } catch (e: any) {
      // A bare "{}" in the log is useless — record the stack.
      console.error('[organizer] apply failed:', e?.stack || e?.message || String(e));
      return { ok: false, moved: 0, blocked: 0, error: String(e?.message || e) };
    }
  });
  ipcMain.handle('organizer:undo', () => {
    try {
      const r = undoOrganize(app.getPath('desktop'));
      console.log('[organizer] undo:', JSON.stringify(r));
      if (r.ok) repaintDesktop();
      broadcast(ctx, 'organizer:changed');
      return r;
    } catch (e: any) {
      console.error('[organizer] undo failed:', e?.stack || e?.message || String(e));
      return { ok: false, restored: 0, blocked: 0 };
    }
  });
  ipcMain.handle('organizer:hasManifest', () => isOrganized(app.getPath('desktop')));

  // ---- wallpaper ----
  ipcMain.handle('wallpaper:set', (_e, p: string) => wp.setWallpaper(p));
  ipcMain.handle('wallpaper:get', () => wp.getWallpaper());
  ipcMain.handle('wallpaper:list', (_e, dir: string) => wp.listWallpapers(dir));
  ipcMain.handle('wallpaper:setMode', (_e, mode: string) => wp.setWallpaperMode(mode));
  ipcMain.handle('wallpaper:getSchedule', () => loadConfig().wallpaper.schedule);
  ipcMain.handle('wallpaper:setSchedule', (_e, s) => {
    const cfg = patchConfig({ wallpaper: { schedule: s } } as any);
    ctx.restartSchedule();
    broadcast(ctx, 'wallpaper:schedule', cfg.wallpaper.schedule);
    return cfg.wallpaper.schedule;
  });
  ipcMain.handle('wallpaper:next', () => {
    const cfg = loadConfig();
    const dir = cfg.wallpaper.schedule.dir;
    const next = wp.pickNext(dir, cfg.wallpaper.schedule.random, cfg.wallpaper.lastWallpaper);
    if (!next) return null;
    wp.setWallpaper(next);
    patchConfig({ wallpaper: { lastWallpaper: next } } as any);
    broadcast(ctx, 'wallpaper:changed', next);
    return next;
  });
  ipcMain.handle('wallpaper:builtin', () => listBuiltinWallpapers(loadConfig().wallpaper.lastWallpaper));

  // ---- shell ----
  ipcMain.handle('shell:openPath', (_e, p: string) => {
    // Shell namespace paths (此电脑 / 回收站, "::{CLSID}") are not files —
    // hand them to Explorer directly.
    if (typeof p === 'string' && p.startsWith('::')) {
      execFile('explorer.exe', [p], () => {
        /* explorer returns non-zero exit codes even on success */
      });
      return '';
    }
    return shell.openPath(p);
  });
  ipcMain.handle('shell:showItemInFolder', (_e, p: string) => shell.showItemInFolder(p));

  // ---- config ----
  ipcMain.handle('config:get', () => loadConfig());
  ipcMain.handle('config:set', (_e, partial) => {
    const cfg = patchConfig(partial);
    broadcast(ctx, 'config:changed', cfg);
    return cfg;
  });
  ipcMain.handle('config:reset', () => {
    const cfg = patchConfig(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    broadcast(ctx, 'config:changed', cfg);
    return cfg;
  });

  // ---- widgets ----
  ipcMain.handle('widgets:getState', () => loadConfig().widgets);
  ipcMain.handle('widgets:setState', (_e, partial) => {
    const cfg = patchConfig({ widgets: partial } as any);
    broadcast(ctx, 'widgets:changed', cfg.widgets);
    // 便签变化同步给笔记窗口
    broadcastSticky(cfg.widgets?.note?.items ?? []);
    return cfg.widgets;
  });

  // ---- 工作笔记（归墨） ----
  /**
   * 返回 { raw } 或 { corrupt, error }：解析失败时归档损坏文件并明确告知渲染层，
   * 让笔记端进入只读模式，而不是把示例数据当"首次运行"写回覆盖原文件。
   */
  ipcMain.handle('notes:load', () => {
    const raw = readNotesState();
    if (!raw) return null;
    try {
      JSON.parse(raw);
      return { raw };
    } catch (e: any) {
      try {
        const archive = notesJsonPath() + `.corrupt-${Date.now().toString(36)}`;
        renameSync(notesJsonPath(), archive);
        console.error('[notes] notes.json corrupted, archived to', archive);
      } catch (err) {
        console.error('[notes] notes.json corrupted and archive failed', err);
      }
      return { corrupt: true, error: String(e?.message || e) };
    }
  });
  /* 结构化保存结果：失败时渲染层会走 localStorage 兜底并提示，不再静默丢数据 */
  ipcMain.handle('notes:save', (_e, json: string) => writeNotesState(String(json ?? '{}')));
  ipcMain.handle('notes:open', () => {
    openNotesWindow();
    return true;
  });

  /** 桌面「随手记」：打开笔记窗口并直接进全部笔记 */
  ipcMain.handle('notes:openHome', () => {
    openNotesHome();
    return true;
  });

  /**
   * 便签的「详情」按钮：打开笔记窗口并定位到该便签对应的事项跟踪记录。
   * 记下 pending，离线时笔记窗口启动后可主动取走，避免消息丢在加载过程中。
   */
  ipcMain.handle('notes:openTrack', (_e, stickyId: string) => {
    const id = String(stickyId || '');
    if (!id) return false;
    pendingTrackFocus = id;
    const win = openNotesWindow();
    const send = () => {
      if (!win || win.isDestroyed()) return;
      try { win.webContents.send('notes:focusTrack', { stickyId: id }); } catch (_) { /* ignore */ }
    };
    /* 窗口刚创建时脚本还没注册监听，等加载完成后再发一次 */
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', () => setTimeout(send, 1500));
    } else {
      setTimeout(send, 120);
    }
    return true;
  });

  ipcMain.handle('notes:takeTrackFocus', () => {
    const id = pendingTrackFocus;
    pendingTrackFocus = null;
    return id;
  });

  ipcMain.handle('notes:sticky:get', () => getStickyItems());
  /* 笔记里新建待办 → 同步到桌面便签列表 */
  ipcMain.handle('notes:sticky:add', (_e, item: any) => {
    const { items, item: saved } = upsertStickyItem(item || {});
    if (saved) {
      broadcast(ctx, 'widgets:changed', loadConfig().widgets);
      broadcastSticky(items);
    }
    return saved;
  });
  ipcMain.handle('notes:sticky:status', (_e, id: string, status: string) => {
    const items = setStickyStatus(id, status as any);
    if (items) {
      broadcast(ctx, 'widgets:changed', loadConfig().widgets);
      broadcastSticky(items);
    }
    return items ?? [];
  });
  /* 笔记里的待办列表 → 整体校准桌面便签（只广播有变化时，避免来回抖动） */
  ipcMain.handle('notes:sticky:sync', (_e, payload: any) => {
    const res = syncStickyItems(payload || {});
    if (res.changed) {
      broadcast(ctx, 'widgets:changed', loadConfig().widgets);
      broadcastSticky(res.items);
    }
    return res;
  });
  ipcMain.handle('notes:image:save', (_e, dataUrl: string) => saveNoteImage(dataUrl));
  ipcMain.handle('notes:media:save', (_e, dataUrl: string) => saveNoteMedia(dataUrl));

  /* 附件（图片 / 录音 / 手写）保存目录：可读、可改、可选 */
  ipcMain.handle('notes:media:dir:get', () => getMediaDir());
  ipcMain.handle('notes:media:dir:set', (_e, dir: string) => setMediaDir(dir));
  ipcMain.handle('notes:media:dir:pick', async (e, current?: string) => {
    const owner = BrowserWindow.fromWebContents(e.sender) || undefined;
    const res = await dialog.showOpenDialog(owner as any, {
      title: '选择附件保存目录',
      defaultPath: String(current || getMediaDir()),
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '用这个目录'
    });
    if (res.canceled || !res.filePaths[0]) return null;
    return setMediaDir(res.filePaths[0]);
  });
  /* 丢弃刚写入的附件（只允许删附件目录里的文件；resolve+relative 防目录穿越） */
  ipcMain.handle('notes:media:remove', (_e, url: string) => {
    try {
      const raw = String(url || '').replace(/^file:\/\//i, '');
      const target = decodeURIComponent(raw).replace(/\//g, '\\');
      if (!target || !isPathInside(getMediaDir(), target)) return false;
      unlinkSync(target);
      /* 流程图 sidecar 一并清掉，避免留下孤儿数据（同样校验在目录内） */
      try {
        const sidecar = target.replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '.flow.json');
        if (sidecar !== target && existsSync(sidecar) && isPathInside(getMediaDir(), sidecar)) {
          unlinkSync(sidecar);
        }
      } catch { /* best effort */ }
      return true;
    } catch (e) {
      return false;
    }
  });

  /* 流程图连线数据 sidecar（节点/连线原样落盘，之后可重开编辑） */
  ipcMain.handle('notes:flow:save', (_e, url: string, json: string) => saveFlowSidecar(url, String(json ?? '{}')));
  ipcMain.handle('notes:flow:load', (_e, url: string) => loadFlowSidecar(url));

  /* AI 配置：密钥脱敏下发（只有 hasApiKey 布尔量），明文/密文都不出主进程 */
  ipcMain.handle('notes:ai:getConfig', () => readAIConfigSafe());
  ipcMain.handle('notes:ai:setConfig', (_e, cfg: any) => writeAIConfigSafe(cfg || {}));
  ipcMain.handle('notes:ai:chat', async (_e, messages: any[], opts?: any) => {
    const cfg = readAIConfigSafe() || {};
    const baseUrl = String(cfg.baseUrl || '').replace(/\/+$/, '');
    if (!baseUrl) return { ok: false, error: '尚未配置 AI 接口地址' };
    const key = readAIKey();
    const isLocal = /127\.0\.0\.1|localhost/.test(baseUrl);
    if (!key && !isLocal && !cfg.hasApiKey) return { ok: false, error: '尚未配置 API Key' };
    const ctrl = new AbortController();
    /* 季/年总结的素材长，渲染层可传更长的等待时间（钳制在 10s ~ 300s） */
    const rawTimeout = Number(opts?.timeoutMs);
    const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0
      ? Math.min(300000, Math.max(10000, Math.round(rawTimeout)))
      : 180000;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(baseUrl + '/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(key ? { Authorization: 'Bearer ' + key } : {})
        },
        body: JSON.stringify({
          model: opts?.model || cfg.model || '',
          temperature: opts?.temperature ?? 0.4,
          max_tokens: opts?.maxTokens ?? 2600,
          messages
        }),
        signal: ctrl.signal
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}：${text.slice(0, 300)}` };
      const data = JSON.parse(text);
      return { ok: true, content: data.choices?.[0]?.message?.content ?? '' };
    } catch (err: any) {
      const reason = String(err?.cause?.code || err?.cause?.message || err?.message || err);
      const msg = err?.name === 'AbortError'
        ? `请求超时（${Math.round(timeoutMs / 1000)} 秒内模型没有返回）。办公电脑建议改用「办公网生成」，或缩小时间范围后重试`
        : /fetch failed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|certificate/i.test(reason)
        ? `模型服务连不上（${reason}）。办公电脑访问不了外部网络时，请改用「办公网生成」`
        : String(err?.message || err);
      return { ok: false, error: msg };
    } finally {
      clearTimeout(timer);
    }
  });

  /* 语音转文字：录音 dataURL → OpenAI 兼容的 /audio/transcriptions */
  ipcMain.handle('notes:asr', async (_e, dataUrl: string, mime?: string) => {
    const cfg = readAIConfigSafe() || {};
    const baseUrl = String(cfg.asrBaseUrl || '').replace(/\/+$/, '');
    const model = String(cfg.asrModel || '');
    const key = readASRKey();
    if (!baseUrl || !model) {
      return { ok: false, error: '尚未配置语音识别模型（设置 → AI 模型 → 语音识别）' };
    }
    /* 录音 dataURL 常带 codecs 参数（audio/webm;codecs=opus），参数要一起吃掉 */
    const m = /^data:(audio\/[a-z0-9.+-]+)(?:;[^,;]*)*;base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!m) return { ok: false, error: '录音数据格式不支持' };
    const mimeType = mime || m[1].toLowerCase();
    const ext = (mimeType.split('/')[1] || 'webm').split(';')[0].replace('mpeg', 'mp3');
    try {
      const form = new FormData();
      form.append('file', new Blob([Buffer.from(m[2], 'base64')], { type: mimeType }), `voice.${ext}`);
      form.append('model', model);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 120000);
      try {
        const res = await fetch(baseUrl + '/audio/transcriptions', {
          method: 'POST',
          headers: key ? { Authorization: 'Bearer ' + key } : {},
          body: form as any,
          signal: ctrl.signal
        });
        const text = await res.text();
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}：${text.slice(0, 300)}` };
        let out = text;
        try {
          const j = JSON.parse(text);
          out = String(j.text || '');
        } catch (e) { /* 有的服务直接返回纯文本 */ }
        return { ok: true, text: out.trim() };
      } finally {
        clearTimeout(timer);
      }
    } catch (err: any) {
      const msg = err?.name === 'AbortError' ? '转写超时' : String(err?.message || err);
      return { ok: false, error: msg };
    }
  });

  /* ── 办公网识别 / 办公网生成（内网 AI 工作台）：剪贴板接力 + 专属窗口 ── */
  ipcMain.handle('notes:office:prepare', (_e, dataUrl: string) => prepareOfficeOCR(String(dataUrl ?? '')));
  ipcMain.handle('notes:office:read', () => readOfficeOCRResult());
  /* 文本版（生成总结）：提示词进剪贴板 + 唤窗，结果同样从剪贴板取回 */
  ipcMain.handle('notes:office:prepareText', (_e, text: string) => prepareOfficeText(String(text ?? '')));
  ipcMain.handle('notes:office:readText', () => readOfficeTextResult());
  ipcMain.handle('notes:office:open', () => ({ ok: true, url: openOfficeAIWindow() }));
  ipcMain.handle('notes:office:url', () => officeAIUrl());
  /* 自动执行：粘贴→发送→等回复→读文本；站点适配器读写 */
  ipcMain.handle('notes:office:auto', (_e, prep: any, siteOverride?: any, opts?: any) =>
    runOfficeAutoTask(prep, siteOverride, opts));
  ipcMain.handle('notes:office:autoCancel', () => cancelOfficeAutoTask());
  ipcMain.handle('notes:office:getSite', () => readOfficeSite());
  ipcMain.handle('notes:office:setSite', (_e, patch: any) => writeOfficeSite(patch || {}));
  /* 回填成功后由渲染层主动关窗（失败/取消时不关，留给手动接力） */
  ipcMain.handle('notes:office:close', () => { closeOfficeAIWindow(); return { ok: true }; });

  // ---- app ----
  ipcMain.handle('app:setLoginItem', (_e, enabled: boolean) => {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: []
    });
    patchConfig({ settings: { loginItem: enabled } } as any);
    return enabled;
  });
  ipcMain.handle('app:openSettings', () => ctx.openSettings());
  ipcMain.handle('app:quit', () => app.quit());

  /**
   * Alarm notification. The ringtone is synthesised in the renderer, so the
   * toast itself stays silent; clicking it opens settings (the only real
   * window we own) so the user lands somewhere familiar.
   */
  ipcMain.handle('app:notify', (_e, title: string, body: string) => {
    try {
      if (!Notification.isSupported()) return false;
      const n = new Notification({
        title: String(title ?? '桌面管家'),
        body: String(body ?? ''),
        silent: true,
        urgency: 'critical'
      });
      n.on('click', () => ctx.openSettings());
      n.show();
      return true;
    } catch (e) {
      console.error('[notify] failed', e);
      return false;
    }
  });

  // ---- dialogs ----
  ipcMain.handle('dialog:openDirectory', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif'] }]
    });
    return r.canceled ? null : r.filePaths[0];
  });
}
