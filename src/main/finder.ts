import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { hardenWindow } from './windowSecurity';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { existsSync } from 'node:fs';

/**
 * 本地文件查找：移植自 D:\ChatGPT\localFinder（Python / tkinter）。
 * 保留它的扫描策略、跳过的系统目录、评分规则和筛选语法，
 * 界面换成桌面管家统一的毛玻璃面板，快捷键沿用 Ctrl+Shift+F。
 */

type Entry = {
  name: string;
  /** 小写文件名，搜索时直接比对，省掉几十万次 toLowerCase */
  nameLower: string;
  path: string;
  /** 只在需要按路径匹配时才计算（惰性） */
  pathLower?: string;
};

export type FinderStatus = {
  indexing: boolean;
  count: number;
  dirs: number;
  /** 索引完成时间戳，0 表示还没建完 */
  indexedAt: number;
  /** 扫描耗时（毫秒） */
  elapsed: number;
};

export type FinderHit = {
  name: string;
  path: string;
  dir: string;
  ext: string;
  size: number;
  modified: number;
  sizeText: string;
  modifiedText: string;
};

export type FinderResult = {
  hits: FinderHit[];
  total: number;
  truncated: boolean;
  took: number;
  status: FinderStatus;
};

/** 与 localFinder 一致：这些目录名整个跳过，不然全盘扫描会陷进系统目录 */
const SKIP_DIRS = new Set([
  '$recycle.bin',
  'system volume information',
  'windows',
  'windows.old',
  'program files',
  'program files (x86)',
  'programdata',
  'appdata',
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  '__pycache__',
  'recovery',
  '$winreagent',
  'perflogs',
  'msocache',
  'config.msi'
]);

/** 上限：太小搜不到深目录，太大吃内存（每条约 150–250 字节） */
const MAX_ENTRIES = 700_000;
const WORKERS = 8;
/** 打分阶段最多保留的候选，避免全盘几十万条都进排序 */
const MAX_CANDIDATES = 6000;

let entries: Entry[] = [];
let indexing = false;
let indexedAt = 0;
let scannedDirs = 0;
let elapsed = 0;
let finderWindow: BrowserWindow | null = null;
let pushTimer: NodeJS.Timeout | null = null;

function normalize(text: string): string {
  return (text || '').toLowerCase();
}

function listRoots(): string[] {
  const roots: string[] = [];
  for (let i = 65; i <= 90; i += 1) {
    const drive = `${String.fromCharCode(i)}:\\`;
    if (existsSync(drive)) roots.push(drive);
  }
  /* 用户自己的目录先扫，打开面板时更快出现有意义的结果 */
  const home = process.env.USERPROFILE;
  if (home) {
    const prio = ['Desktop', 'Downloads', 'Documents'].map((d) => path.join(home, d));
    for (const p of prio.reverse()) {
      if (existsSync(p)) roots.unshift(p);
    }
  }
  return roots;
}

function shouldSkipDir(name: string): boolean {
  const n = name.toLowerCase();
  if (SKIP_DIRS.has(n)) return true;
  /* $Recycle.Bin / System Volume Information 之类的隐藏系统目录 */
  if (n.startsWith('$')) return true;
  return false;
}

function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return i === 0 ? `${Math.round(value)} ${units[i]}` : `${value.toFixed(1)} ${units[i]}`;
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function finderStatus(): FinderStatus {
  return { indexing, count: entries.length, dirs: scannedDirs, indexedAt, elapsed };
}

function pushStatus(force = false): void {
  if (!finderWindow || finderWindow.isDestroyed()) return;
  if (!force && pushTimer) return;
  if (!pushTimer) {
    pushTimer = setTimeout(() => {
      pushTimer = null;
      if (finderWindow && !finderWindow.isDestroyed()) {
        finderWindow.webContents.send('finder:status', finderStatus());
      }
    }, 400);
  }
}

async function scanAll(): Promise<void> {
  const stack: string[] = listRoots();
  const started = Date.now();
  let workers: Promise<void>[] = [];

  const consume = async () => {
    while (stack.length) {
      if (entries.length >= MAX_ENTRIES) {
        stack.length = 0;
        return;
      }
      const dir = stack.pop();
      if (!dir) return;
      let dirents;
      try {
        dirents = await fsp.readdir(dir, { withFileTypes: true });
        scannedDirs += 1;
      } catch {
        continue;
      }
      for (const d of dirents) {
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (!shouldSkipDir(d.name)) stack.push(full);
        } else if (d.isFile()) {
          const lower = d.name.toLowerCase();
          entries.push({ name: d.name, nameLower: lower, path: full });
          if (entries.length >= MAX_ENTRIES) {
            stack.length = 0;
            break;
          }
        }
      }
      if (scannedDirs % 800 === 0) pushStatus();
    }
  };

  workers = Array.from({ length: WORKERS }, () => consume());
  await Promise.all(workers);
  elapsed = Date.now() - started;
  indexedAt = Date.now();
  indexing = false;
  pushStatus(true);
}

export function rebuildIndex(): FinderStatus {
  if (indexing) return finderStatus();
  entries = [];
  scannedDirs = 0;
  elapsed = 0;
  indexedAt = 0;
  indexing = true;
  void scanAll().catch((e) => {
    console.error('[finder] index failed', e);
    indexing = false;
    pushStatus(true);
  });
  pushStatus(true);
  return finderStatus();
}

/* ═══════════ 搜索：沿用 localFinder 的语法与评分 ═══════════ */

const SIZE_RE = /^([<>]=?|=)?\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb|tb)$/;
const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 };
const DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/;

type SizeRule = { op: string; size: number };
type Clause = { required: string[]; excluded: string[]; sizes: SizeRule[]; dates: string[] };

function parseClause(clause: string): Clause {
  const required: string[] = [];
  const excluded: string[] = [];
  const sizes: SizeRule[] = [];
  const dates: string[] = [];
  for (const raw of clause.trim().toLowerCase().split(/\s+/)) {
    if (!raw) continue;
    if (raw.startsWith('size:')) {
      const m = SIZE_RE.exec(raw.slice(5));
      if (m) sizes.push({ op: m[1] || '=', size: parseFloat(m[2]) * SIZE_UNITS[m[3]] });
    } else if (raw.startsWith('datemodified:')) {
      dates.push(raw.slice(13));
    } else if (raw.startsWith('!') && raw.length > 1) {
      excluded.push(raw.slice(1));
    } else {
      required.push(raw);
    }
  }
  return { required, excluded, sizes, dates };
}

function fuzzyScore(query: string, text: string): number {
  let position = -1;
  let gaps = 0;
  for (const ch of query) {
    const next = text.indexOf(ch, position + 1);
    if (next < 0) return -1;
    gaps += next - position - 1;
    position = next;
  }
  return 400 - gaps - position;
}

function globToRe(term: string): RegExp {
  const escaped = term.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

const globCache = new Map<string, RegExp>();

function termScore(term: string, entry: Entry): number {
  if (term.includes('*') || term.includes('?')) {
    let re = globCache.get(term);
    if (!re) {
      re = globToRe(term);
      globCache.set(term, re);
    }
    return re.test(entry.name) ? 800 : -1;
  }
  if (term.includes(':\\') || term.includes('/') || term.includes('\\')) {
    if (entry.pathLower === undefined) entry.pathLower = entry.path.toLowerCase();
    return entry.pathLower.includes(term) ? 900 : -1;
  }
  const byName = entry.nameLower.indexOf(term);
  if (byName >= 0) return 2000 - byName;
  if (entry.pathLower === undefined) entry.pathLower = entry.path.toLowerCase();
  const byPath = entry.pathLower.indexOf(term);
  if (byPath >= 0) return 1000 - byPath;
  return fuzzyScore(term, entry.nameLower);
}

function matchesSize(size: number, rule: SizeRule): boolean {
  switch (rule.op) {
    case '>': return size > rule.size;
    case '>=': return size >= rule.size;
    case '<': return size < rule.size;
    case '<=': return size <= rule.size;
    default: return size === rule.size;
  }
}

function matchesDate(mtime: number, value: string): boolean {
  const d = new Date(mtime);
  if (value === '本月' || value === 'thismonth') {
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = m[3] ? Number(m[3]) : null;
  if (d.getFullYear() !== year || d.getMonth() + 1 !== month) return false;
  return day === null || d.getDate() === day;
}

let searchSeq = 0;

export async function finderSearch(query: string, limit = 120): Promise<FinderResult> {
  const started = Date.now();
  const seq = ++searchSeq;
  const text = (query || '').trim();
  const clauses = text
    ? text.split('|').map(parseClause).filter((c) => c.required.length || c.excluded.length || c.sizes.length || c.dates.length)
    : [];
  const effective: Clause[] = clauses.length ? clauses : [{ required: [], excluded: [], sizes: [], dates: [] }];
  const needsStat = effective.some((c) => c.sizes.length || c.dates.length);

  type Cand = { score: number; entry: Entry };
  const candidates: Cand[] = [];
  let total = 0;
  const snapshot = entries;

  for (const entry of snapshot) {
    let best = -1;
    for (const clause of effective) {
      let ok = true;
      for (const term of clause.excluded) {
        if (termScore(term, entry) >= 0) { ok = false; break; }
      }
      if (!ok) continue;

      let score = 0;
      for (const term of clause.required) {
        const s = termScore(term, entry);
        if (s < 0) { ok = false; break; }
        score += s;
      }
      if (!ok) continue;
      if (!clause.required.length) score = 1;

      if (needsStat && (clause.sizes.length || clause.dates.length)) {
        let st;
        try {
          st = await fsp.stat(entry.path);
        } catch {
          continue;
        }
        if (clause.sizes.some((r) => !matchesSize(st.size, r))) continue;
        if (clause.dates.some((d) => !matchesDate(st.mtimeMs, d))) continue;
      }
      best = Math.max(best, score);
    }
    if (best < 0) continue;
    total += 1;
    candidates.push({ score: best, entry });
    /* 宽泛查询（比如单个字母）会命中几十万条：定期裁剪，避免内存和排序一起爆 */
    if (candidates.length >= MAX_CANDIDATES * 2) {
      candidates.sort((a, b) => b.score - a.score);
      candidates.length = MAX_CANDIDATES;
    }
    /* 查询已被新的输入取代就别再算下去 */
    if (seq !== searchSeq) return { hits: [], total: 0, truncated: false, took: 0, status: finderStatus() };
  }

  candidates.sort((a, b) => (b.score - a.score) || a.entry.nameLower.localeCompare(b.entry.nameLower));
  const picked = candidates.slice(0, limit);
  const hits: FinderHit[] = [];
  for (const c of picked) {
    let size = 0;
    let modified = 0;
    try {
      const st = await fsp.stat(c.entry.path);
      size = st.size;
      modified = st.mtimeMs;
    } catch {
      /* 扫描后又被删掉的文件：保留但标注为不可用 */
    }
    hits.push({
      name: c.entry.name,
      path: c.entry.path,
      dir: path.dirname(c.entry.path),
      ext: path.extname(c.entry.name).replace(/^\./, '').toLowerCase(),
      size,
      modified,
      sizeText: modified ? formatSize(size) : '不可用',
      modifiedText: modified ? formatTime(modified) : '不可用'
    });
  }

  return {
    hits,
    total,
    truncated: total > hits.length,
    took: Date.now() - started,
    status: finderStatus()
  };
}

/* ═══════════ 窗口 ═══════════ */

export function openFinder(rendererUrl: (hash: string) => string): void {
  if (finderWindow && !finderWindow.isDestroyed()) {
    finderWindow.show();
    finderWindow.focus();
    finderWindow.webContents.send('finder:focus');
    return;
  }
  const display = screen.getPrimaryDisplay().workArea;
  const width = 760;
  const height = 540;
  finderWindow = new BrowserWindow({
    width,
    height,
    x: Math.round(display.x + (display.width - width) / 2),
    y: Math.round(display.y + Math.max(60, display.height * 0.16)),
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  finderWindow.setAlwaysOnTop(true, 'floating');
  finderWindow.loadURL(rendererUrl('#finder'));
  hardenWindow(finderWindow);
  finderWindow.once('ready-to-show', () => {
    finderWindow?.show();
    finderWindow?.focus();
  });
  finderWindow.on('blur', () => {
    /* 点别处就收起，和本地查找的悬浮框一致 */
    setTimeout(() => {
      if (finderWindow && !finderWindow.isDestroyed() && !finderWindow.isFocused()) {
        finderWindow.hide();
      }
    }, 120);
  });
  finderWindow.on('closed', () => {
    finderWindow = null;
  });
  /* 调试：DM_FINDER_JS=<js> 在面板里执行；配合 DM_FINDER_SHOT=<file> 截图后退出 */
  if (process.env.DM_FINDER_JS) {
    const script = process.env.DM_FINDER_JS;
    const file = process.env.DM_FINDER_SHOT;
    finderWindow.webContents.once('did-finish-load', () => {
      setTimeout(async () => {
        try {
          const out = await finderWindow!.webContents.executeJavaScript(
            `(async () => { ${script} })()`,
            true
          );
          console.log('[finder-js]', JSON.stringify(out));
          if (file) {
            await new Promise((r) => setTimeout(r, 350));
            const img = await finderWindow!.webContents.capturePage();
            const { writeFileSync, mkdirSync } = await import('node:fs');
            const { dirname } = await import('node:path');
            mkdirSync(dirname(file), { recursive: true });
            writeFileSync(file, img.toPNG());
            console.log('[finder-shot] saved', file, img.getSize());
          }
        } catch (e) {
          console.error('[finder-js] failed', e);
        } finally {
          app.exit(0);
        }
      }, Number(process.env.DM_FINDER_DELAY || 5000));
    });
  }
  /* 首次打开就把索引跑起来（后台，不挡输入） */
  if (!indexing && !indexedAt) rebuildIndex();
}

export function toggleFinder(rendererUrl: (hash: string) => string): void {
  if (finderWindow && !finderWindow.isDestroyed() && finderWindow.isVisible()) {
    finderWindow.hide();
    return;
  }
  openFinder(rendererUrl);
}

export function hideFinder(): void {
  if (finderWindow && !finderWindow.isDestroyed()) finderWindow.hide();
}

export function registerFinderIpc(): void {
  ipcMain.handle('finder:search', (_e, query: string, limit?: number) => finderSearch(query, limit));
  ipcMain.handle('finder:status', () => finderStatus());
  ipcMain.handle('finder:rebuild', () => rebuildIndex());
  ipcMain.handle('finder:open', async (_e, target: string) => {
    const err = await shell.openPath(target);
    return err || '';
  });
  ipcMain.handle('finder:reveal', (_e, target: string) => {
    shell.showItemInFolder(target);
    return true;
  });
  ipcMain.handle('finder:hide', () => {
    hideFinder();
    return true;
  });
  /* 面板打开时立刻把当前索引状态给它 */
  ipcMain.handle('finder:ready', () => {
    pushStatus(true);
    return finderStatus();
  });
}

/** 应用启动时预热索引：面板第一次打开就已经能搜到东西 */
export function warmUpFinder(): void {
  setTimeout(() => {
    if (!indexing && !indexedAt) rebuildIndex();
  }, 2500);
}

export function stopFinder(): void {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = null;
}
