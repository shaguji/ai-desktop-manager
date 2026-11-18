import { BrowserWindow, clipboard, dialog, nativeImage, app } from 'electron';
import { NOTES_ICON_BASE64 } from './icon';
import { readAIConfigSafe, writeAIConfigSafe } from './notes';

/**
 * 办公网图片识别（内网 AI 工作台等站点）。
 *
 * 办公电脑访问不了外部模型 API，识别只能在内网 AI 工作台网页上完成。
 * 这里不做网页 DOM 自动化（内部站点结构随时会变，也有合规风险），
 * 而是把流程里重复的部分自动化：
 *   1. 把要识别的图片写入系统剪贴板；
 *   2. 唤起专属「办公 AI 工作台」窗口（登录态持久化，见 persist:office 分区）；
 *   3. 用户在窗口里 Ctrl+V 发送，识别完成后复制回复；
 *   4. 回到笔记点「回填」，从剪贴板读文本插入图片下方。
 *
 * 网络不通时不能只留一张 Chromium 空白错误页：加载失败要立刻捕获，
 * 弹出可读的原因（域名解析 / 超时 / 证书），用户确认后关闭窗口。
 *
 * 安全边界：这是专用浏览器窗口 —— 没有 preload、没有 nodeIntegration、
 * 沙箱开启；允许 http(s) 页内跳转（内网 SSO 认证会跨主机重定向），
 * window.open 一律在本窗口内打开而不是放出新窗口。
 */

/**
 * 工作台地址完全由用户配置（设置 → 笔记 → 办公网工作台），
 * 代码里不预置任何内网域名：一来各家内网地址不同，二来这类地址不该进公开仓库。
 */
const DEFAULT_OFFICE_URL = '';
const LOAD_TIMEOUT_MS = 25000;

type LoadResult = { ok: boolean; error?: string };

let officeWindow: BrowserWindow | null = null;
let officeLoadedOk = false;
/** 当前正在等待的那次加载的结束回调（供证书错误等旁路事件提前收口） */
let settlePending: ((r: LoadResult) => void) | null = null;

export function officeAIUrl(): string {
  /* 调试用：DM_OFFICE_URL 可临时指向本机服务器，不影响正式配置 */
  const envUrl = String(process.env.DM_OFFICE_URL || '').trim();
  if (/^https?:\/\//i.test(envUrl)) return envUrl;
  /* 惰性读配置：工作台地址由用户在设置里填写，未填时返回空串 */
  try {
    const cfg = readAIConfigSafe() || {};
    const url = String(cfg.officeUrl || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
  } catch (e) {
    console.warn('[officeAI] read office url failed', e);
  }
  return DEFAULT_OFFICE_URL;
}

export function getOfficeAIWindow(): BrowserWindow | null {
  if (officeWindow && !officeWindow.isDestroyed()) return officeWindow;
  return null;
}

function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url; }
}

const FAIL_HINTS: Array<[RegExp, string]> = [
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED/i, '域名解析失败：这台电脑可能不在办公网，或工作台地址写错了'],
  [/ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT/i, '连接超时：内网没有连通（检查网线 / 内网 WiFi）'],
  [/ERR_CONNECTION_REFUSED/i, '服务器拒绝连接：地址或端口不对'],
  [/ERR_INTERNET_DISCONNECTED/i, '本机没有网络连接'],
  [/ERR_ADDRESS_UNREACHABLE/i, '网络不可达：当前网络到不了这个内网地址'],
  [/ERR_CERT|ERR_SSL/i, '证书不受信任：需要 IT 安装企业根证书，或改用 http 地址']
];

function explainFail(code: number, desc: string): string {
  const raw = String(desc || `错误码 ${code}`);
  const hit = FAIL_HINTS.find(([re]) => re.test(raw));
  return hit ? `${hit[1]}（${raw}）` : `加载失败：${raw}`;
}

/** 证书错误：只处理工作台窗口，拦下并当作加载失败上报 */
app.on('certificate-error', (event, wc, _url, error, _cert, callback) => {
  const win = getOfficeAIWindow();
  if (!win || wc !== win.webContents) return;
  event.preventDefault();
  callback(false);
  if (settlePending) {
    settlePending({
      ok: false,
      error: `证书不受信任：${error || '证书校验失败'}（需要 IT 安装企业根证书，或改用 http 地址）`
    });
  }
});

function createOfficeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    title: '办公 AI 工作台',
    autoHideMenuBar: true,
    icon: nativeImage.createFromBuffer(Buffer.from(NOTES_ICON_BASE64, 'base64')),
    show: false,
    webPreferences: {
      /* 专用浏览窗口：不注入任何 preload，渲染层拿不到桌面能力 */
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      /* 独立分区：内网站点的登录态（Cookie）持久化在这里，
         与笔记窗口的 persist:notes 隔离，互不污染 */
      partition: 'persist:office'
    }
  });
  const wc = win.webContents;

  /* 不放出新窗口：window.open / target=_blank 一律在当前窗口内打开 */
  wc.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//i.test(target)) {
      wc.loadURL(target).catch(() => { /* ignore */ });
    }
    return { action: 'deny' };
  });

  /* 内网 SSO 登录可能要跨多个内部主机重定向：本窗口内允许 http(s) 跳转，
     其余协议（file: 等本地内容）仍然拦截 */
  wc.on('will-navigate', (e, target) => {
    if (/^https?:\/\//i.test(target)) return;
    e.preventDefault();
  });

  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    win.show();
    win.focus();
  });

  win.on('closed', () => {
    officeWindow = null;
    officeLoadedOk = false;
  });
  return win;
}

/** 等一次主框架加载：成功 / 失败 / 超时 / 窗口被关，四种结果都收口 */
function waitForLoad(win: BrowserWindow): Promise<LoadResult> {
  return new Promise((resolve) => {
    const wc = win.webContents;
    let done = false;

    const finish = (r: LoadResult) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      wc.off('did-finish-load', onOk);
      wc.off('did-fail-load', onFail);
      win.off('closed', onClosed);
      settlePending = null;
      resolve(r);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, error: `打开超时（${Math.round(LOAD_TIMEOUT_MS / 1000)} 秒无响应），请确认内网是否连通` });
    }, LOAD_TIMEOUT_MS);

    const onOk = () => {
      /* 加载失败时 Chromium 会渲染一张空白错误页并触发 did-finish-load，
         这里用 chrome-error 前缀排除，避免把白屏当成成功 */
      try {
        if (wc.getURL().startsWith('chrome-error')) return;
      } catch { /* ignore */ }
      /* 留一点余量：did-fail-load 若晚到，仍然以失败为准 */
      setTimeout(() => finish({ ok: true }), 80);
    };

    const onFail = (_e: Electron.Event, code: number, desc: string, _url: string, isMainFrame: boolean) => {
      if (!isMainFrame || code === -3) return; /* -3 = ERR_ABORTED，重定向时常见 */
      finish({ ok: false, error: explainFail(code, desc) });
    };

    const onClosed = () => finish({ ok: false, error: '工作台窗口被关闭' });

    settlePending = finish;
    wc.on('did-finish-load', onOk);
    wc.on('did-fail-load', onFail);
    win.on('closed', onClosed);
  });
}

function destroyOfficeWindow(): void {
  officeLoadedOk = false;
  if (officeWindow && !officeWindow.isDestroyed()) {
    try { officeWindow.destroy(); } catch { /* ignore */ }
  }
  officeWindow = null;
}

/** 打开（或聚焦）办公 AI 工作台窗口；返回实际加载的地址 */
export function openOfficeAIWindow(): string {
  const url = officeAIUrl();
  /* 没配地址就不开窗，避免弹出一个空白浏览器 */
  if (!url) return '';
  if (officeWindow && !officeWindow.isDestroyed()) {
    if (officeWindow.isMinimized()) officeWindow.restore();
    officeWindow.show();
    officeWindow.focus();
    const cur = officeWindow.webContents.getURL();
    if (!officeLoadedOk || !cur || cur.split('#')[0] !== url) {
      officeWindow.webContents.loadURL(url).catch(() => { /* 失败由窗口内页面体现 */ });
    }
    return url;
  }
  officeWindow = createOfficeWindow();
  officeWindow.webContents.loadURL(url).catch(() => { /* ignore */ });
  return url;
}

/**
 * 打开工作台窗口并等它真的加载出来。
 *
 * 剪贴板内容由调用方在调用前写好（图片或提示词），这里只管窗口：
 * 加载失败立刻收口，弹出可读原因后关窗，绝不留下 Chromium 空白错误页。
 *
 * opts.silent 仅供自检脚本使用：不弹提示框，失败时直接关窗。
 */
async function ensureOfficeWindow(
  opts?: { silent?: boolean; action?: string }
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const url = officeAIUrl();
  if (!url) {
    return {
      ok: false,
      error: '还没有配置内网工作台地址：请在 笔记 → 设置 → 办公网工作台 里填写后再试'
    };
  }
  const host = hostOf(url);
  const action = (opts && opts.action) || '办公网识别';

  for (let attempt = 0; attempt < 5; attempt++) {
    if (!officeWindow || officeWindow.isDestroyed()) {
      officeWindow = createOfficeWindow();
      officeLoadedOk = false;
    }
    const win = officeWindow;

    /* 已经稳定打开过同一地址：直接复用，不重新加载 */
    let cur = '';
    try { cur = win.webContents.getURL(); } catch { /* ignore */ }
    if (officeLoadedOk && cur && cur.split('#')[0] === url) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return { ok: true, url };
    }

    const wait = waitForLoad(win);
    win.webContents.loadURL(url).catch(() => { /* 事件里已处理 */ });
    const r = await wait;

    if (r.ok) {
      officeLoadedOk = true;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return { ok: true, url };
    }

    /* 失败：先把窗口显出来（否则对话框没有锚点），提示清楚再决定重试或退出 */
    if (win.isDestroyed()) return { ok: false, error: r.error };
    win.show();

    if (opts && opts.silent) {
      destroyOfficeWindow();
      return { ok: false, error: r.error };
    }

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      title: action,
      message: '打不开办公 AI 工作台',
      detail: `${r.error}\n\n地址：${url}\n\n请确认这台电脑已连接办公内网（网线 / 内网 WiFi）；如果地址不对，可在「笔记 → 设置 → AI 模型 → 办公网识别」里修改。`,
      buttons: ['重试', '关闭'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    });
    if (response !== 0) {
      destroyOfficeWindow();
      return { ok: false, error: r.error };
    }
    /* 点「重试」：再走一遍加载 */
  }

  destroyOfficeWindow();
  return { ok: false, error: `多次重试仍打不开 ${host}` };
}

/**
 * 图片版第一步：把图片放进系统剪贴板并唤起工作台窗口。
 * dataUrl 必须是 data:image/*;base64 格式（渲染层 fileToDataURL 的产物）。
 */
export async function prepareOfficeOCR(
  dataUrl: string,
  opts?: { silent?: boolean }
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const s = String(dataUrl || '');
  if (!/^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.test(s)) {
    return { ok: false, error: '不是可识别的图片数据' };
  }
  let img;
  try { img = nativeImage.createFromDataURL(s); } catch { img = null; }
  if (!img || img.isEmpty()) return { ok: false, error: '图片解码失败' };

  clipboard.writeImage(img);
  return ensureOfficeWindow({ ...(opts || {}), action: '办公网识别' });
}

/**
 * 文本版第一步（生成总结用）：把提示词写进剪贴板并唤起工作台窗口。
 * 内网站点没有 API，只能由用户把提示词粘进对话再取回结果。
 */
export async function prepareOfficeText(
  text: string,
  opts?: { silent?: boolean }
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const t = String(text || '');
  if (!t.trim()) return { ok: false, error: '没有可复制的提示词' };
  /* 先清掉可能残留的图片，避免工作台里 Ctrl+V 粘出上一次的截图 */
  try { clipboard.clear(); } catch { /* ignore */ }
  clipboard.writeText(t);
  return ensureOfficeWindow({ ...(opts || {}), action: '办公网生成' });
}

function readClipboardText(label: string): { ok: boolean; text?: string; error?: string } {
  try {
    if (!clipboard.readImage().isEmpty()) {
      return { ok: false, error: `剪贴板里还是图片，请先复制工作台回复的${label}文字` };
    }
    const text = clipboard.readText().trim();
    if (!text) return { ok: false, error: `剪贴板是空的，请先复制${label}` };
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 图片版第三步：识别完成后，从剪贴板读取复制好的回复文本 */
export function readOfficeOCRResult(): { ok: boolean; text?: string; error?: string } {
  return readClipboardText('识别结果');
}

/** 文本版第三步：生成完成后，从剪贴板读取复制好的总结正文 */
export function readOfficeTextResult(): { ok: boolean; text?: string; error?: string } {
  const r = readClipboardText('生成结果');
  if (!r.ok || !r.text) return r;
  /* 手动复制也可能多框进前后的页面文字：同样按起止标记裁一遍（幂等） */
  const site = readOfficeSite();
  const text = extractMarkedText(r.text, site.resultStartText || '', site.resultEndText || '');
  if (text) return { ok: true, text };
  return r; /* 标记把内容裁空了说明复制的就是别的东西，保留原文让上层判断 */
}

/** 应用退出时把工作台窗口一起带走，避免托盘退出后残留进程 */
export function closeOfficeAIWindow(): void {
  destroyOfficeWindow();
}

/* ═════════════════════════════════════════════════════════════════
 * 自动执行引擎：粘贴 → 发送 → 等回复 → 读回文本
 *
 * 剪贴板接力是「每一步都要人」，这里把能自动的都自动掉：
 *   1. 输入框聚焦 + 系统级粘贴（等价用户 Ctrl+V）；
 *   2. 图片任务自动补发送指令（如「提取图片中的文字」）；
 *   3. 点发送按钮（找不到按钮就回车）；
 *   4. 轮询读取回复：优先用站点适配器配置的选择器，未配置时用
 *      「发送前后 body 文本差分」启发式；连续两次采样一致且达到最小
 *      字数才算完成（流式输出会边生成边变）。
 *
 * 任何一步失败都不销毁窗口 —— 降级为手动接力（窗口留在原地，
 * 渲染层切回三步引导），这是设计底线：自动是加速，手动是兜底。
 * 站点适配器（选择器/指令/超时）存在 AI 配置里，设置页可改。
 * ═════════════════════════════════════════════════════════════════ */

export interface OfficeSite {
  /** 输入框选择器（textarea / contenteditable），空 = 自动探测 */
  inputSel?: string;
  /** 发送按钮选择器，空 = 按钮文字「发送/send/提交」探测，再不行回车 */
  sendSel?: string;
  /** 回复条目选择器，空 = 用文本差分启发式 */
  responseSel?: string;
  /** 图片任务自动附带的发送指令 */
  imagePrompt?: string;
  /** 等回复超时（毫秒） */
  resultTimeoutMs?: number;
  /** 认为回复有效所需的最小字符数 */
  resultMinChars?: number;
  /** 回答起始标记：读到该标记后只取其后内容（空 = 不裁） */
  resultStartText?: string;
  /** 回答结束标记：只取该标记之前的内容（空 = 不裁） */
  resultEndText?: string;
}

export const DEFAULT_OFFICE_SITE: OfficeSite = {
  inputSel: '',
  sendSel: '',
  responseSel: '',
  imagePrompt: '提取图片中的文字',
  resultTimeoutMs: 180000,
  resultMinChars: 4,
  /* 整页差分/选择器读回的文本会混入页面 UI 文案和提问回显：默认按这对标记
     截出回答正文（发送状态「执行完成」之后、生成声明「以上内容由…」之前）。
     站点不同可在设置里改写或清空（清空 = 不裁）。 */
  resultStartText: '执行完成',
  resultEndText: '以上内容由AI工作室通过人工智能技术生成'
};

/** 读站点适配器配置（AI 配置 JSON 的 officeSite 字段），坏字段一律回落默认 */
export function readOfficeSite(): OfficeSite {
  const site: OfficeSite = { ...DEFAULT_OFFICE_SITE };
  try {
    const raw = (readAIConfigSafe() || {}).officeSite;
    if (raw && typeof raw === 'object') {
      for (const k of ['inputSel', 'sendSel', 'responseSel', 'imagePrompt'] as const) {
        const v = String((raw as any)[k] ?? '').trim();
        if (v) (site as any)[k] = v;
      }
      const t = Number((raw as any).resultTimeoutMs);
      if (Number.isFinite(t) && t >= 15000 && t <= 900000) site.resultTimeoutMs = t;
      const m = Number((raw as any).resultMinChars);
      if (Number.isFinite(m) && m >= 1 && m <= 5000) site.resultMinChars = m;
      /* 起止标记允许显式清空（等于关闭截取），只有字段缺失时才落默认值 */
      for (const k of ['resultStartText', 'resultEndText'] as const) {
        if (Object.prototype.hasOwnProperty.call(raw, k)) {
          (site as any)[k] = String((raw as any)[k] ?? '').trim();
        }
      }
    }
  } catch (e) {
    console.warn('[officeAI] read site adapter failed', e);
  }
  return site;
}

/** 合并写回站点适配器配置 */
export function writeOfficeSite(patch: Partial<OfficeSite>): { ok: boolean; site?: OfficeSite; error?: string } {
  try {
    const merged = { ...readOfficeSite(), ...(patch || {}) };
    const ok = writeAIConfigSafe({ officeSite: merged });
    if (!ok) return { ok: false, error: '写入配置失败' };
    return { ok: true, site: merged };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/* ---- 自动任务运行状态 ---- */

type AutoPrep =
  | { type: 'image'; dataUrl: string }
  | { type: 'text'; text: string }
  | { type: 'file'; dataUrl: string; mime: string; name: string; prompt?: string };

export type AutoTaskResult =
  | { ok: true; text: string; via: 'selector' | 'diff'; url?: string }
  | { ok: false; error: string; /** true = 已尽量推进，降级为手动接力（窗口保持打开） */ manual?: boolean; url?: string };

let autoRunning = false;
let autoCancelled = false;

export function cancelOfficeAutoTask(): boolean {
  if (!autoRunning) return false;
  autoCancelled = true;
  return true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 阶段日志：DM_OFFICE_DEBUG=1 时输出，现场排查自动执行卡在哪一步 */
function dbg(stage: string, extra?: any): void {
  if (process.env.DM_OFFICE_DEBUG !== '1') return;
  try {
    console.log('[officeAI] ' + stage + (extra === undefined ? '' : ' ' + JSON.stringify(extra)));
  } catch {
    console.log('[officeAI] ' + stage);
  }
}

/** 在页面里安全执行一段 JS：窗口没了/执行失败都返回 null，不抛 */
async function evalJs<T>(win: BrowserWindow, code: string): Promise<T | null> {
  try {
    if (!win || win.isDestroyed()) return null;
    const r = await win.webContents.executeJavaScript(code, true);
    return (r === undefined ? null : r) as T;
  } catch (e) {
    console.warn('[officeAI] evalJs failed:', String(e).slice(0, 200));
    return null;
  }
}

const FIND_INPUT_JS = `(sel) => {
  const vis = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  };
  let el = null;
  if (sel) { try { el = document.querySelector(sel); } catch (e) {} }
  if (!el) {
    const cands = Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).filter(vis);
    el = cands.length ? cands[cands.length - 1] : null;
  }
  if (!el || !vis(el)) return null;
  el.focus();
  try { el.dispatchEvent(new Event('focus', { bubbles: true })); } catch (e) {}
  return el.tagName.toLowerCase() === 'textarea' || el.getAttribute('contenteditable') === 'true' ? 'ok' : 'ok';
}`;

const CLICK_SEND_JS = `(sel) => {
  const norm = (s) => String(s || '').replace(/\\s+/g, '');
  let el = null;
  if (sel) { try { el = document.querySelector(sel); } catch (e) {} }
  if (!el) {
    const btns = Array.from(document.querySelectorAll('button, [role="button"], a, [class*="send"], [class*="submit"]'))
      .filter((b) => !b.disabled && b.offsetParent !== null);
    el = btns.find((b) => /发送|提交|send|submit/i.test(norm(b.innerText) + norm(b.title) + norm(b.getAttribute && b.getAttribute('aria-label')))) || null;
  }
  if (el) {
    el.click();
    return 'clicked';
  }
  const active = document.activeElement;
  if (active) {
    for (const type of ['keydown', 'keypress', 'keyup']) {
      active.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    }
    return 'enter';
  }
  return 'none';
}`;

const INSERT_TEXT_JS = `(text) => {
  const el = document.activeElement;
  if (!el) return false;
  el.focus();
  let ok = false;
  try { ok = document.execCommand('insertText', false, text); } catch (e) { ok = false; }
  if (!ok) {
    try {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        el.value = (el.value || '') + text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        ok = true;
      } else {
        el.textContent = (el.textContent || '') + text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        ok = true;
      }
    } catch (e) { ok = false; }
  }
  return ok;
}`;

/** 语音等文件任务：把文件以 paste 事件注入输入框（实验性，站点不认就走手动） */
function filePasteJs(dataUrl: string, mime: string, name: string): string {
  const b64 = dataUrl.split(',')[1] || '';
  return `(async () => {
    const el = document.activeElement || document.querySelector('textarea, [contenteditable="true"]');
    if (!el) return 'no-input';
    el.focus();
    const bin = atob(${JSON.stringify(b64)});
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} });
    const dt = new DataTransfer();
    dt.items.add(file);
    let target = el;
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const host = el.closest('[class*="input"],[class*="editor"],[class*="chat"],form') || el.parentElement;
      if (host) target = host;
    }
    for (const type of ['paste', 'drop']) {
      try {
        const ev = new ClipboardEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, 'clipboardData', { value: dt });
        target.dispatchEvent(ev);
      } catch (e) {}
    }
    return 'dispatched';
  })()`;
}

/** 读当前页面文本快照（回复选择器模式 / 整页差分模式） */
function snapshotJs(responseSel: string): string {
  if (responseSel) {
    return `(() => {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(${JSON.stringify(responseSel)})); } catch (e) {}
      return nodes.map((n) => String(n.innerText || '').trim()).filter((t) => t.length > 0).join('\\n---\\n');
    })()`;
  }
  return `document.body ? document.body.innerText : ''`;
}

/** 最长公共前缀长度（差分启发式的核心） */
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function stripEcho(suffix: string, prompts: string[]): string {
  let t = suffix;
  for (const p of prompts) {
    const head = p.trim().slice(0, 48);
    if (head && t.includes(head)) {
      const idx = t.indexOf(head) + p.trim().length;
      if (idx > 0 && idx < t.length) t = t.slice(idx);
      break;
    }
  }
  return t.trim();
}

/** 差分模式会把页面 UI 文案（发送/复制/停止生成…）一起带进来：按行剔除纯按钮文字 */
const UI_LABEL_RE = /^(发送|发送消息|提交|确定|取消|复制|复制代码|重新生成|停止|停止生成|停止输出|编辑|分享|点赞|踩|send|submit|copy|regenerate|stop)$/i;
function cleanDiffText(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !UI_LABEL_RE.test(l))
    .join('\n')
    .trim();
}

/**
 * 按起止标记截出回答正文：读回的文本会带页面 UI 文案与提问回显，
 * 标记在设置里可改可清空；找不到标记就原样返回（宁可多带，不误删正文）。
 */
function extractMarkedText(text: string, startMark: string, endMark: string): string {
  let t = text;
  if (startMark) {
    const i = t.indexOf(startMark);
    if (i >= 0) t = t.slice(i + startMark.length);
  }
  if (endMark) {
    const j = t.lastIndexOf(endMark);
    if (j >= 0) t = t.slice(0, j);
  }
  return t.trim();
}

/**
 * 自动执行一次办公网任务。
 * 失败不销毁窗口：返回 manual=true 让渲染层切回手动接力引导。
 */
export async function runOfficeAutoTask(
  prep: AutoPrep,
  siteOverride?: Partial<OfficeSite>,
  opts?: { silent?: boolean; action?: string }
): Promise<AutoTaskResult> {
  const site: OfficeSite = { ...readOfficeSite(), ...(siteOverride || {}) };
  const action = (opts && opts.action) || '办公网任务';
  autoRunning = true;
  autoCancelled = false;
  try {
    /* 1. 唤起并确保窗口加载成功（失败时本函数已弹窗/关窗，直接收口） */
    if (prep.type === 'image') {
      const pr = await prepareOfficeOCR(prep.dataUrl, { silent: opts?.silent });
      if (!pr.ok) return { ok: false, error: pr.error || '打不开工作台' };
    } else if (prep.type === 'text') {
      const pr = await prepareOfficeText(prep.text, { silent: opts?.silent });
      if (!pr.ok) return { ok: false, error: pr.error || '打不开工作台' };
    } else {
      const pr = await ensureOfficeWindow({ silent: opts?.silent, action });
      if (!pr.ok) return { ok: false, error: pr.error || '打不开工作台' };
    }

    const win = getOfficeAIWindow();
    if (!win) return { ok: false, error: '工作台窗口没有打开' };
    await sleep(600); /* 等页面脚本稳定 */

    /* 2. 发送前的基线：输入框存在性 + 回复区/文本快照 */
    const focused = await evalJs<string>(win, `(${FIND_INPUT_JS})(${JSON.stringify(site.inputSel || '')})`);
    dbg('input', { found: !!focused });
    if (!focused) {
      return {
        ok: false, manual: true,
        error: '找不到工作台输入框（可能需要先登录，或站点结构特殊）——已切回手动模式',
        url: officeAIUrl()
      };
    }
    const baselineSel = site.responseSel
      ? await evalJs<string>(win, snapshotJs(site.responseSel))
      : null;
    const baselineBody = site.responseSel ? null : await evalJs<string>(win, snapshotJs(''));

    /* 3. 注入内容 */
    let prompts: string[] = [];
    if (prep.type === 'image') {
      let img;
      try { img = nativeImage.createFromDataURL(prep.dataUrl); } catch { img = null; }
      if (!img || img.isEmpty()) return { ok: false, manual: true, error: '图片解码失败' };
      clipboard.writeImage(img);
      await win.webContents.paste();
      await sleep(500);
      const prompt = site.imagePrompt || DEFAULT_OFFICE_SITE.imagePrompt!;
      prompts = [prompt];
      await evalJs<boolean>(win, `(${INSERT_TEXT_JS})(${JSON.stringify(prompt)})`);
    } else if (prep.type === 'text') {
      prompts = [prep.text];
      await win.webContents.paste();
    } else {
      prompts = prep.prompt ? [prep.prompt] : [];
      await evalJs<string>(win, filePasteJs(prep.dataUrl, prep.mime, prep.name));
      if (prep.prompt) {
        await sleep(400);
        await evalJs<boolean>(win, `(${INSERT_TEXT_JS})(${JSON.stringify(prep.prompt)})`);
      }
    }
    await sleep(500);

    /* 4. 点发送 */
    const sendMode = await evalJs<string>(win, `(${CLICK_SEND_JS})(${JSON.stringify(site.sendSel || '')})`);
    dbg('send', { mode: sendMode });
    if (!sendMode || sendMode === 'none') {
      return { ok: false, manual: true, error: '找不到发送按钮（输入框已填好，请手动点发送）', url: officeAIUrl() };
    }

    /* 5. 轮询等回复 */
    const timeout = Math.max(15000, site.resultTimeoutMs || DEFAULT_OFFICE_SITE.resultTimeoutMs!);
    const minChars = site.resultMinChars || 4;
    const pollMs = 2000;
    const deadline = Date.now() + timeout;
    let lastText = '';
    let stableCount = 0;
    let lastErr: string | null = null;

    while (Date.now() < deadline) {
      if (autoCancelled) return { ok: false, manual: true, error: '已取消自动执行，窗口保留，可手动接力', url: officeAIUrl() };
      await sleep(pollMs);
      if (!getOfficeAIWindow()) return { ok: false, error: '工作台窗口被关闭' };

      if (site.responseSel) {
        const snap = await evalJs<string>(win, snapshotJs(site.responseSel));
        if (snap === null) { lastErr = '读取页面失败'; continue; }
        /* 选择器模式：取基线之后新增的整段 */
        const base = baselineSel || '';
        let text = snap;
        if (base && snap.startsWith(base)) text = snap.slice(base.length);
        text = extractMarkedText(stripEcho(text, prompts), site.resultStartText || '', site.resultEndText || '');
        if (text.length >= minChars && text === lastText) {
          stableCount++;
          if (stableCount >= 2) {
            dbg('done', { via: 'selector', chars: text.length });
            return { ok: true, text, via: 'selector', url: officeAIUrl() };
          }
        } else {
          stableCount = text.length >= minChars ? 1 : 0;
          lastText = text;
          dbg('poll-selector', { chars: text.length });
        }
      } else {
        const cur = await evalJs<string>(win, snapshotJs(''));
        if (cur === null) { lastErr = '读取页面失败'; continue; }
        const base = baselineBody || '';
        const pl = commonPrefixLen(base, cur);
        const suffix = extractMarkedText(
          cleanDiffText(stripEcho(cur.slice(pl), prompts)),
          site.resultStartText || '',
          site.resultEndText || ''
        );
        if (suffix.length >= minChars && suffix === lastText) {
          stableCount++;
          if (stableCount >= 2) {
            dbg('done', { via: 'diff', chars: suffix.length });
            return { ok: true, text: suffix, via: 'diff', url: officeAIUrl() };
          }
        } else {
          stableCount = suffix.length >= minChars ? 1 : 0;
          lastText = suffix;
          dbg('poll-diff', { chars: suffix.length });
        }
      }
    }

    /* 超时：若页面里有半截文本也带回去，但不自动回填，交给渲染层判断 */
    const partial = lastText;
    return {
      ok: false, manual: true,
      error: lastErr
        ? `读取回复失败：${lastErr}`
        : partial && partial.length >= minChars
          ? `等待回复超时（${Math.round(timeout / 1000)} 秒）——内容可能还在生成，请稍后手动复制`
          : `等待回复超时（${Math.round(timeout / 1000)} 秒）`,
      url: officeAIUrl()
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    autoRunning = false;
  }
}
