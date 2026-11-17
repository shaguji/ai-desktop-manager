import { app, BrowserWindow, nativeImage, safeStorage } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig, patchConfig } from './config';
import type { NoteItem, NoteStatus } from '../shared/types';
import { NOTES_ICON_BASE64 } from './icon';
import { isPathInside } from './pathGuard';
import { hardenWindow } from './windowSecurity';

/**
 * 归墨 · 工作笔记 —— 与桌面管家共用的数据层。
 * 笔记窗口读写 userData/notes.json；便签状态在 config.json 的
 * widgets.note.items 里，两侧通过这里的同步函数互相同步。
 */

let notesWindow: BrowserWindow | null = null;

function notesStatePath(): string {
  return join(app.getPath('userData'), 'notes.json');
}

function aiConfigPath(): string {
  return join(app.getPath('userData'), 'ai-config.json');
}

/** 笔记应用的静态入口（resources/notes-app，由 scripts/sync-notes.cjs 同步） */
export function notesAppIndexPath(): string {
  return join(app.getAppPath(), 'resources', 'notes-app', 'index.html');
}

/* ───────── 笔记状态 ───────── */

export function readNotesState(): string | null {
  try {
    if (existsSync(notesStatePath())) return readFileSync(notesStatePath(), 'utf-8');
  } catch (e) {
    console.error('[notes] read failed', e);
  }
  return null;
}

export function writeNotesState(json: string): { ok: boolean; error?: string } {
  const file = notesStatePath();
  try {
    const tmp = file + '.tmp';
    writeFileSync(tmp, json, 'utf-8');
    /* 轮转保留最近 3 份成功快照：新写入把上一次成功内容留档，
       万一写坏 / 误清空可以手工从 notes.json.bak.1~3 还原。 */
    try {
      if (existsSync(file)) {
        for (let i = 3; i >= 2; i -= 1) {
          const src = file + `.bak.${i - 1}`;
          if (existsSync(src)) copyFileSync(src, file + `.bak.${i}`);
        }
        copyFileSync(file, file + '.bak.1');
      }
    } catch (e) {
      console.warn('[notes] backup rotation failed (main write continues)', e);
    }
    renameSync(tmp, file); // 原子替换，避免写一半损坏
    return { ok: true };
  } catch (e: any) {
    /* 写失败时 notes.json 保持上一次成功内容，tmp 可能残留但不影响旧数据 */
    console.error('[notes] write failed', e);
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 读取磁盘上的原始 AI 配置（含密文，仅供主进程内部使用） */
function readAIRaw(): any {
  try {
    if (existsSync(aiConfigPath())) return JSON.parse(readFileSync(aiConfigPath(), 'utf-8'));
  } catch (e) {
    console.error('[notes] read ai config failed', e);
  }
  return null;
}

function encryptSecret(value: string): string | null {
  if (!value) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null; // 降级：保持明文
    return safeStorage.encryptString(value).toString('base64');
  } catch (e) {
    console.warn('[notes] encrypt secret failed', e);
    return null;
  }
}

function decryptSecret(enc: string): string {
  if (!enc) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(enc, 'base64'));
  } catch (e) {
    console.warn('[notes] decrypt secret failed', e);
    return '';
  }
}

/**
 * 渲染层拿到的 AI 配置：密钥一律脱敏成 hasApiKey / hasAsrKey 布尔量，
 * 明文与密文都不出主进程。首次调用时顺便把历史明文 Key 加密迁移。
 */
export function readAIConfigSafe(): any {
  const raw = readAIRaw() || {};
  /* 迁移：老版本明文 Key → safeStorage 密文 */
  let migrated = false;
  for (const field of ['apiKey', 'asrApiKey'] as const) {
    const plain = String(raw[field] || '');
    if (plain) {
      const enc = encryptSecret(plain);
      if (enc) {
        raw[field + 'Enc'] = enc;
        delete raw[field];
        migrated = true;
      }
    }
  }
  if (migrated) writeAIRaw(raw);

  const out: any = { ...raw };
  delete out.apiKeyEnc;
  delete out.asrApiKeyEnc;
  out.apiKey = '';
  out.asrApiKey = '';
  out.hasApiKey = !!(raw.apiKey || raw.apiKeyEnc);
  out.hasAsrKey = !!(raw.asrApiKey || raw.asrApiKeyEnc);
  return out;
}

function writeAIRaw(cfg: any): void {
  writeFileSync(aiConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

/**
 * 接收渲染层提交的 AI 配置并落盘。
 * 密钥语义：apiKey / asrApiKey 非空 → 加密覆盖；为空 → 保留原有密钥不动
 * （设置界面回显时密钥是空的，用户没填新 Key 就不能把旧的冲掉）。
 */
export function writeAIConfigSafe(input: any): boolean {
  try {
    const prev = readAIRaw() || {};
    const next: any = { ...prev, ...(input || {}) };
    delete next.hasApiKey;
    delete next.hasAsrKey;
    for (const field of ['apiKey', 'asrApiKey'] as const) {
      const incoming = String(next[field] ?? '');
      delete next[field];
      if (incoming) {
        const enc = encryptSecret(incoming);
        if (enc) {
          next[field + 'Enc'] = enc;
        } else {
          next[field] = incoming; // safeStorage 不可用：明文兜底
        }
      } else {
        /* 空值 = 用户没填新 Key，保留原有密钥（密文或迁移前的明文） */
        if (prev[field + 'Enc']) next[field + 'Enc'] = prev[field + 'Enc'];
        else if (prev[field]) next[field] = prev[field];
      }
    }
    writeAIRaw(next);
    return true;
  } catch (e) {
    console.error('[notes] write ai config failed', e);
    return false;
  }
}

/** 主进程内部取真实 Key（发请求用） */
export function readAIKey(): string {
  const raw = readAIRaw() || {};
  return decryptSecret(String(raw.apiKeyEnc || '')) || String(raw.apiKey || '');
}

export function readASRKey(): string {
  const raw = readAIRaw() || {};
  return decryptSecret(String(raw.asrApiKeyEnc || '')) || String(raw.asrApiKey || '') || readAIKey();
}

/* ───────── 便签同步 ───────── */

export function getStickyItems(): NoteItem[] {
  const cfg = loadConfig();
  const items = cfg.widgets?.note?.items;
  return Array.isArray(items) ? items : [];
}

/**
 * 笔记里新建待办 → 反向写进桌面便签（同 id 覆盖，幂等）。
 * 这样在「归墨」里通过分类「＋」新增的待办，会立刻出现在桌面便签列表中。
 */
export function upsertStickyItem(input: { id?: string; text?: string; status?: NoteStatus; at?: number }): {
  items: NoteItem[];
  item: NoteItem | null;
} {
  const cfg = loadConfig();
  const items: NoteItem[] = Array.isArray((cfg.widgets as any)?.note?.items)
    ? ((cfg.widgets as any).note.items as NoteItem[]).slice()
    : [];
  const text = String(input?.text || '').trim();
  if (!text) return { items, item: null };

  const id = String(input.id || `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`);
  const status: NoteStatus = input.status === 'doing' || input.status === 'done' ? input.status : 'todo';
  const at = Number.isFinite(input.at) && (input.at as number) > 0 ? (input.at as number) : Date.now();

  const exist = items.find((i) => i.id === id);
  let item: NoteItem;
  if (exist) {
    exist.text = text;
    exist.status = status;
    item = exist;
  } else {
    item = { id, text, status, at };
    items.push(item);
  }
  patchConfig({ widgets: { note: { ...(cfg.widgets as any).note, items } } } as any);
  return { items, item };
}

/** 便签是三态（todo/doing/done），笔记里的 - [ ] / - [/] / - [x] 与之对应 */
export function setStickyStatus(id: string, status: NoteStatus): NoteItem[] | null {
  const cfg = loadConfig();
  const items = cfg.widgets?.note?.items;
  if (!Array.isArray(items)) return null;
  const item = items.find((i: NoteItem) => i.id === id);
  if (!item) return null;
  item.status = status;
  patchConfig({ widgets: { note: { items } } } as any);
  return items;
}

/**
 * 用笔记里的待办列表整体校准桌面便签（单一事实来源）。
 * · items：笔记里的全部待办（未完成在前，已完成的垫底，由便签折叠展示）
 * · managedIds：笔记接管过的便签 id（含刚删除的），不在 items 里的会被摘掉
 * · 其余便签条目（用户直接在桌面便签上加的、还没导入笔记的）原样保留
 */
export function syncStickyItems(input: { items?: any[]; managedIds?: string[] }): {
  items: NoteItem[];
  changed: boolean;
} {
  const cfg = loadConfig();
  const note = (cfg.widgets as any)?.note || {};
  const current: NoteItem[] = Array.isArray(note.items) ? note.items.slice() : [];
  const managed = new Set<string>((input?.managedIds || []).map((x) => String(x)));
  const byId = new Map(current.map((i) => [i.id, i]));

  const next: NoteItem[] = [];
  (Array.isArray(input?.items) ? input.items : []).forEach((raw: any) => {
    const id = String(raw?.id || '').trim();
    const text = String(raw?.text || '').trim();
    if (!id || !text) return;
    const status: NoteStatus = raw.status === 'doing' || raw.status === 'done' ? raw.status : 'todo';
    const exist = byId.get(id);
    const at = exist && Number.isFinite(exist.at) && exist.at > 0
      ? exist.at
      : (Number.isFinite(raw.at) && raw.at > 0 ? Number(raw.at) : Date.now());
    next.push({ id, text, status, at });
  });

  /* 未接管的条目保留，避免抹掉便签里手工添加、还没来得及导入的事项 */
  current.forEach((i) => {
    if (managed.has(i.id)) return;
    if (next.some((n) => n.id === i.id)) return;
    next.push(i);
  });

  const changed = JSON.stringify(next) !== JSON.stringify(current);
  if (changed) {
    patchConfig({ widgets: { note: { ...note, items: next } } } as any);
  }
  return { items: changed ? next : current, changed };
}

/* ───────── 图片落盘 ───────── */

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav'
};

function mediaConfigPath(): string {
  return join(app.getPath('userData'), 'media-config.json');
}

/** 默认附件目录：userData/note-media */
function defaultMediaDir(): string {
  return join(app.getPath('userData'), 'note-media');
}

/** 当前附件目录（用户可在「设置与数据」里改） */
export function getMediaDir(): string {
  try {
    if (existsSync(mediaConfigPath())) {
      const cfg = JSON.parse(readFileSync(mediaConfigPath(), 'utf-8'));
      const dir = String((cfg && cfg.dir) || '').trim();
      if (dir) return dir;
    }
  } catch (e) {
    console.error('[notes] read media config failed', e);
  }
  return defaultMediaDir();
}

/** 设置附件目录，返回实际生效的目录；空字符串表示恢复默认 */
export function setMediaDir(dir: string): string {
  const next = String(dir || '').trim();
  const target = next || defaultMediaDir();
  try {
    if (!existsSync(target)) mkdirSync(target, { recursive: true });
    /* 试写一个探针文件，确认目录真的可写 */
    const probe = join(target, `.guimo-write-test-${Date.now().toString(36)}`);
    writeFileSync(probe, 'ok', 'utf-8');
    try { unlinkSync(probe); } catch (e) { /* ignore */ }
  } catch (e) {
    throw new Error('这个目录不可写：' + target);
  }
  try {
    writeFileSync(mediaConfigPath(), JSON.stringify({ dir: next }, null, 2), 'utf-8');
  } catch (e) {
    console.error('[notes] write media config failed', e);
    throw new Error('保存附件目录设置失败');
  }
  return target;
}

/** 保存 dataURL 图片 / 录音，返回可放进 Markdown 的 file:// URL */
export function saveNoteMedia(dataUrl: string): { url: string; path: string } {
  /* 录音的 MIME 常带参数（audio/webm;codecs=opus），这里要把参数一起吃掉 */
  const m = /^data:((?:image|audio)\/[a-z0-9.+-]+)(?:;[^,;]*)*;base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('不是合法的 dataURL 附件');
  const mime = m[1].toLowerCase();
  const ext = EXT_BY_MIME[mime] || (mime.indexOf('audio/') === 0 ? 'webm' : 'png');
  const dir = getMediaDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  const file = join(dir, name);
  writeFileSync(file, Buffer.from(m[2], 'base64'));
  const url = 'file:///' + file.replace(/\\/g, '/');
  return { url, path: file };
}

/** 保存 dataURL 图片，返回可放进 Markdown 的 file:// URL */
export function saveNoteImage(dataUrl: string): { url: string; path: string } {
  const m = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(String(dataUrl || ''));
  if (!m) throw new Error('不是合法的 dataURL 图片');
  return saveNoteMedia(dataUrl);
}

/**
 * 流程图连线数据的 sidecar 文件：图片 m-xxx.png 旁边放 m-xxx.flow.json。
 * 有了它，笔记里的流程图图片随时可以重新打开编辑（节点 / 连线原样恢复）。
 */
function flowSidecarPath(url: string): string | null {
  const m = /^file:\/\/\/(.+)\.(png|jpe?g|webp|gif|bmp)$/i.exec(String(url || '').trim());
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]) + '.flow.json';
  } catch {
    return m[1] + '.flow.json';
  }
}

export function saveFlowSidecar(url: string, json: string): boolean {
  try {
    const p = flowSidecarPath(url);
    if (!p) return false;
    const dir = getMediaDir();
    /* 防目录穿越：url 由渲染层传入（正文可被注入），必须用 resolve+relative
       判断真实位置，而不是 startsWith 前缀（会被 ..\..\ 绕过） */
    if (!isPathInside(dir, p)) {
      console.warn('[notes] flow sidecar outside media dir, blocked:', p);
      return false;
    }
    writeFileSync(p, String(json ?? '{}'), 'utf-8');
    return true;
  } catch (e) {
    console.error('[notes] flow sidecar save failed', e);
    return false;
  }
}

export function loadFlowSidecar(url: string): string | null {
  try {
    const p = flowSidecarPath(url);
    if (!p || !existsSync(p)) return null;
    if (!isPathInside(getMediaDir(), p)) return null; // 读同样要防越界
    return readFileSync(p, 'utf-8');
  } catch (e) {
    return null;
  }
}

/* ───────── 笔记窗口 ───────── */

/**
 * 一次性迁移：把历史笔记正文里的 base64 附件（图片 / 录音）落盘成文件，
 * 正文只留 file:// 路径。旧版本 bug 会把整段录音 base64 塞进笔记，
 * 让 notes.json 膨胀到几 MB。幂等：跑过一遍后正文不再有 data: 链接。
 */
export function migrateInlineMedia(): { notes: number; files: number; beforeBytes: number; afterBytes: number } {
  const raw = readNotesState();
  const beforeBytes = raw ? Buffer.byteLength(raw, 'utf-8') : 0;
  if (!raw) return { notes: 0, files: 0, beforeBytes, afterBytes: beforeBytes };
  if (raw.indexOf('(data:image') < 0 && raw.indexOf('(data:audio') < 0) {
    return { notes: 0, files: 0, beforeBytes, afterBytes: beforeBytes };
  }

  /* 迁移前先备份一份，出问题可整体还原 */
  try {
    writeFileSync(notesStatePath() + '.bak-migrate', raw, 'utf-8');
  } catch (e) { /* ignore */ }

  let files = 0;
  let touched = 0;
  let state: any;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    return { notes: 0, files: 0, beforeBytes, afterBytes: beforeBytes };
  }
  const list: any[] = Array.isArray(state?.notes) ? state.notes : [];
  const re = /\]\(data:((?:image|audio)\/[a-z0-9.+-]+)(?:;[^,;]*)*;base64,([A-Za-z0-9+/=]+)\)/gi;
  for (const note of list) {
    const content = typeof note?.content === 'string' ? note.content : '';
    if (!content || (content.indexOf('(data:image') < 0 && content.indexOf('(data:audio') < 0)) continue;
    const next = content.replace(re, (full: string, mime: string, b64: string) => {
      try {
        const saved = saveNoteMedia(`data:${mime};base64,${b64}`);
        files += 1;
        return `](${saved.url})`;
      } catch (e) {
        return full; /* 单个失败不影响其它 */
      }
    });
    if (next !== content) {
      note.content = next;
      touched += 1;
    }
  }
  const afterRaw = JSON.stringify(state, null, 2);
  if (touched > 0) writeNotesState(afterRaw);
  const afterBytes = Buffer.byteLength(afterRaw, 'utf-8');
  if (touched > 0) {
    console.log(`[notes] migrated inline media: ${touched} note(s), ${files} file(s), ${(beforeBytes / 1048576).toFixed(2)}MB -> ${(afterBytes / 1048576).toFixed(2)}MB`);
  }
  return { notes: touched, files, beforeBytes, afterBytes };
}

export function getNotesWindow(): BrowserWindow | null {
  if (notesWindow && !notesWindow.isDestroyed()) return notesWindow;
  return null;
}

export function openNotesWindow(): BrowserWindow {
  if (notesWindow && !notesWindow.isDestroyed()) {
    if (notesWindow.isMinimized()) notesWindow.restore();
    notesWindow.show();
    notesWindow.focus();
    /* 窗口已经开着，但焦点可能停在上次点过的搜索框 / 侧栏上：
       让渲染进程把光标还给正文，唤起后立刻就能接着写。 */
    try { notesWindow.webContents.focus(); } catch (_) { /* ignore */ }
    setTimeout(() => {
      if (!notesWindow || notesWindow.isDestroyed()) return;
      try { notesWindow.webContents.send('notes:focusEdit'); } catch (_) { /* ignore */ }
    }, 120);
    return notesWindow;
  }
  notesWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1060,
    minHeight: 660,
    title: '归墨 · 工作笔记',
    autoHideMenuBar: true,
    icon: nativeImage.createFromBuffer(Buffer.from(NOTES_ICON_BASE64, 'base64')),
    show: false,
    webPreferences: {
      /* 受限 preload：只暴露笔记 / 便签 / 附件 / AI 转写，不给 openPath 等桌面能力 */
      preload: join(__dirname, '../preload/notes.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      /* 独立 session：localStorage、缓存、权限都与主窗口隔离 */
      partition: 'persist:notes'
    }
  });
  /* 正文可被注入任意内容：默认拒绝新窗口与远程/本地跳转（http(s) 交给系统浏览器） */
  hardenWindow(notesWindow);
  notesWindow.loadFile(notesAppIndexPath());
  notesWindow.once('ready-to-show', () => {
    if (!notesWindow || notesWindow.isDestroyed()) return;
    notesWindow.show();
    /* 显式抢一次焦点：从桌面层/托盘拉起时 Windows 可能不给前台，键盘输入就落空了 */
    notesWindow.focus();
    try { notesWindow.webContents.focus(); } catch (_) { /* ignore */ }
  });

  /* 语音输入需要麦克风权限，默认会被 Chromium 拦掉。
     只放行音频（不给摄像头），并且只对笔记应用自身的页面生效。 */
  const ses = notesWindow.webContents.session;
  const MEDIA_OK = new Set<string>(['media', 'audioCapture']);
  const isNotesPage = (wc: any): boolean => {
    try {
      const url = String(wc?.getURL?.() || '');
      return url.startsWith('file://') && url.replace(/\\/g, '/').includes('/resources/notes-app/index.html');
    } catch {
      return false;
    }
  };
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (!MEDIA_OK.has(permission) || !isNotesPage(wc)) {
      callback(false);
      return;
    }
    /* media 权限会带具体设备类型：只放行麦克风，拒绝摄像头 */
    const types: string[] = (details as any)?.mediaTypes || [];
    callback(types.length === 0 || types.every((t) => t === 'audio'));
  });
  ses.setPermissionCheckHandler((wc, permission) => MEDIA_OK.has(permission) && isNotesPage(wc));

  // 调试：DM_SNAPSHOT_NOTES=<file> 在窗口稳定后截图
  if (process.env.DM_SNAPSHOT_NOTES) {
    const file = process.env.DM_SNAPSHOT_NOTES;
    notesWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const img = await notesWindow!.webContents.capturePage();
          writeFileSync(file, img.toPNG());
          console.log('[notes] snapshot saved', file);
        } catch (e) {
          console.error('[notes] snapshot failed', e);
        }
      }, 9000);
    });
  }

  // 调试：DM_TPL_SHOT=<file> 打开模板库并切到「业务」分类后截图
  if (process.env.DM_TPL_SHOT) {
    const file = process.env.DM_TPL_SHOT;
    notesWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          await notesWindow!.webContents.executeJavaScript(
            `(() => {
              const btn = document.getElementById('btnTemplates');
              if (btn) btn.click();
              setTimeout(() => {
                const f = document.querySelector('.tpl-filter button[data-filter="biz"]');
                if (f) f.click();
                setTimeout(() => {
                  const it = document.querySelector('[data-tpl="tpl-credit"]');
                  if (it) it.click();
                }, 150);
              }, 180);
              return 'tpl-opened';
            })()`,
            true
          );
          setTimeout(async () => {
            const img = await notesWindow!.webContents.capturePage();
            writeFileSync(file, img.toPNG());
            console.log('[notes] tpl snapshot saved', file);
          }, 1600);
        } catch (e) {
          console.error('[notes] tpl shot failed', e);
        }
      }, 2500);
    });
  }

  // 调试：DM_TODO_SHOT=<file> 切到「待办事项」视图后截图
  if (process.env.DM_TODO_SHOT) {
    const file = process.env.DM_TODO_SHOT;
    notesWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const info = await notesWindow!.webContents.executeJavaScript(
            `(() => {
              const btn = document.querySelector('.side-item[data-view="todo"]');
              if (btn) btn.click();
              return 'todo-view';
            })()`,
            true
          );
          console.log('[notes] todo view:', info);
          setTimeout(async () => {
            const img = await notesWindow!.webContents.capturePage();
            writeFileSync(file, img.toPNG());
            console.log('[notes] todo snapshot saved', file);
          }, 1400);
        } catch (e) {
          console.error('[notes] todo shot failed', e);
        }
      }, 3000);
    });
  }

  // 调试：DM_NOTES_JS=<js> 在笔记窗口里执行脚本；配合 DM_NOTES_SHOT=<file> 截图
  if (process.env.DM_NOTES_JS) {
    const script = process.env.DM_NOTES_JS;
    const file = process.env.DM_NOTES_SHOT;
    notesWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const r = await notesWindow!.webContents.executeJavaScript(`(async () => { ${script} })()`, true);
          console.log('[notes-js]', JSON.stringify(r));
          if (file) {
            setTimeout(async () => {
              const img = await notesWindow!.webContents.capturePage();
              writeFileSync(file, img.toPNG());
              console.log('[notes-js] snapshot saved', file);
            }, 2000);
          }
        } catch (e) {
          console.error('[notes-js] failed', e);
        }
      }, 3000);
    });
  }

  // 调试：DM_NOTES_TEST=1 验证便签 ⇄ 笔记同步链路
  if (process.env.DM_NOTES_TEST) {
    notesWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const r = await notesWindow!.webContents.executeJavaScript(
            `(async () => {
              const out = {
                bridge: !!(window.NoteBridge && window.NoteBridge.inShell),
                store: !!window.Store,
                sync: !!window.StickySync,
                ai: !!window.AI
              };
              if (!out.sync) return out;
              const note = await window.StickySync.pull({ force: true });
              out.syncNoteId = note ? note.id : null;
              out.content = note ? note.content.slice(0, 600) : '';
              const lines = (note ? note.content : '').split('\\n');
              const idx = lines.findIndex((l) => l.includes('<!--s:n1-->'));
              if (idx >= 0) {
                const next = window.Store.cycleTask(window.StickySync.NOTE_ID, idx);
                await window.StickySync.pushStatus('n1', next);
                out.toggled = { line: lines[idx], next };
              }
              return out;
            })()`,
            true
          );
          console.log('[notes-test]', JSON.stringify(r, null, 2));
          if (process.env.DM_AI_SHOT) {
            await notesWindow!.webContents.executeJavaScript(
              'window.__guimo && window.__guimo.openAISettings()',
              true
            );
          }
          // DM_AI_PANEL=<range>：注入演示配置并打开 AI 总结面板指定页签（截图用）
          if (process.env.DM_AI_PANEL) {
            await notesWindow!.webContents.executeJavaScript(
              `(async () => {
                try {
                  localStorage.setItem('guimo.ai.v1', JSON.stringify({
                    provider: 'custom', baseUrl: 'https://demo.local/v1', apiKey: 'demo',
                    model: 'demo-model', visionModel: '', temperature: 0.4
                  }));
                } catch (e) { /* ignore */ }
                window.__guimo && window.__guimo.openAISummary(${JSON.stringify(process.env.DM_AI_PANEL)});
                return 'panel-opened';
              })()`,
              true
            );
          }
          setTimeout(() => {
            console.log('[notes-test] config items now:', JSON.stringify(getStickyItems()));
          }, 2500);
        } catch (e) {
          console.error('[notes-test] failed', e);
        }
      }, 8000);
    });
  }

  notesWindow.on('closed', () => {
    notesWindow = null;
  });
  return notesWindow;
}

/** 便签变化时通知笔记窗口（由 config / IPC 层调用） */
export function broadcastSticky(items: NoteItem[]): void {
  const win = getNotesWindow();
  if (win) win.webContents.send('notes:sticky', items);
}

/** 打开笔记窗口并落到「全部笔记」（桌面「随手记」入口，已无首页） */
export function openNotesHome(): BrowserWindow {
  const win = openNotesWindow();
  const send = () => {
    if (!win || win.isDestroyed()) return;
    try { win.webContents.send('notes:home'); } catch (e) { /* ignore */ }
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => setTimeout(send, 1200));
  else setTimeout(send, 120);
  return win;
}
