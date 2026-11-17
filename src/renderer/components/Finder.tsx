import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { applyTheme } from '../theme';

type Hit = {
  name: string;
  path: string;
  dir: string;
  ext: string;
  sizeText: string;
  modifiedText: string;
};

type Status = {
  indexing: boolean;
  count: number;
  dirs: number;
  indexedAt: number;
  elapsed: number;
};

const EMPTY_STATUS: Status = { indexing: false, count: 0, dirs: 0, indexedAt: 0, elapsed: 0 };

/** 扩展名 → 徽标配色，和桌面整理的分类色系保持一致 */
const EXT_STYLE: Record<string, { bg: string; fg: string; label?: string }> = {
  doc: { bg: 'rgba(70, 130, 220, 0.22)', fg: '#7fb2ff' },
  docx: { bg: 'rgba(70, 130, 220, 0.22)', fg: '#7fb2ff' },
  pdf: { bg: 'rgba(226, 86, 86, 0.22)', fg: '#ff9a9a' },
  xls: { bg: 'rgba(60, 170, 110, 0.22)', fg: '#7fd9ab' },
  xlsx: { bg: 'rgba(60, 170, 110, 0.22)', fg: '#7fd9ab' },
  csv: { bg: 'rgba(60, 170, 110, 0.22)', fg: '#7fd9ab' },
  ppt: { bg: 'rgba(220, 140, 60, 0.22)', fg: '#f5b877' },
  pptx: { bg: 'rgba(220, 140, 60, 0.22)', fg: '#f5b877' },
  png: { bg: 'rgba(150, 110, 220, 0.22)', fg: '#c3a6ff' },
  jpg: { bg: 'rgba(150, 110, 220, 0.22)', fg: '#c3a6ff' },
  jpeg: { bg: 'rgba(150, 110, 220, 0.22)', fg: '#c3a6ff' },
  gif: { bg: 'rgba(150, 110, 220, 0.22)', fg: '#c3a6ff' },
  webp: { bg: 'rgba(150, 110, 220, 0.22)', fg: '#c3a6ff' },
  mp4: { bg: 'rgba(210, 90, 160, 0.22)', fg: '#f3a3d2' },
  mov: { bg: 'rgba(210, 90, 160, 0.22)', fg: '#f3a3d2' },
  mp3: { bg: 'rgba(210, 90, 160, 0.22)', fg: '#f3a3d2' },
  wav: { bg: 'rgba(210, 90, 160, 0.22)', fg: '#f3a3d2' },
  zip: { bg: 'rgba(180, 160, 90, 0.22)', fg: '#e2cf8a' },
  rar: { bg: 'rgba(180, 160, 90, 0.22)', fg: '#e2cf8a' },
  '7z': { bg: 'rgba(180, 160, 90, 0.22)', fg: '#e2cf8a' },
  js: { bg: 'rgba(200, 180, 60, 0.2)', fg: '#e8d878' },
  ts: { bg: 'rgba(70, 140, 210, 0.22)', fg: '#8ec4ff' },
  tsx: { bg: 'rgba(70, 140, 210, 0.22)', fg: '#8ec4ff' },
  jsx: { bg: 'rgba(70, 140, 210, 0.22)', fg: '#8ec4ff' },
  json: { bg: 'rgba(180, 180, 190, 0.18)', fg: '#cfd3dc' },
  md: { bg: 'rgba(120, 140, 180, 0.2)', fg: '#b7c4dc' },
  txt: { bg: 'rgba(120, 140, 180, 0.2)', fg: '#b7c4dc' },
  exe: { bg: 'rgba(110, 200, 170, 0.2)', fg: '#8fe0c6' }
};

function extBadge(ext: string) {
  const key = (ext || '').toLowerCase();
  const style = EXT_STYLE[key] || { bg: 'rgba(140, 150, 170, 0.18)', fg: '#aab4c6' };
  return { ...style, label: (key || '文件').slice(0, 4).toUpperCase() };
}

/** 从查询里取出真正用于高亮的词（去掉 size:/datemodified:/! 和通配符） */
function highlightTerms(query: string): string[] {
  return query
    .split(/[\s|]+/)
    .map((t) => t.trim())
    .filter((t) => t && !t.startsWith('size:') && !t.startsWith('datemodified:') && t !== '!' && !t.startsWith('!'))
    .map((t) => t.replace(/[*?]/g, ''))
    .filter((t) => t.length > 0)
    .slice(0, 4);
}

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const lower = text.toLowerCase();
  const marks: Array<[number, number]> = [];
  for (const term of terms) {
    let from = 0;
    while (from < lower.length) {
      const at = lower.indexOf(term, from);
      if (at < 0) break;
      marks.push([at, at + term.length]);
      from = at + term.length;
      if (marks.length > 24) break;
    }
  }
  if (!marks.length) return <>{text}</>;
  marks.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [];
  for (const m of marks) {
    const last = merged[merged.length - 1];
    if (last && m[0] <= last[1]) last[1] = Math.max(last[1], m[1]);
    else merged.push([m[0], m[1]]);
  }
  const out: React.ReactNode[] = [];
  let cursor = 0;
  merged.forEach(([start, end], i) => {
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push(<mark key={i}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return <>{out}</>;
}

function shortDir(dir: string): string {
  /* C:\Users\surface\Documents\项目\资料 → C:\Users\surface\…\项目\资料 */
  const parts = dir.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 4) return dir;
  const head = parts.slice(0, 2).join('\\');
  const tail = parts.slice(-2).join('\\');
  return `${head}\\…\\${tail}`;
}

function statusText(status: Status): string {
  if (status.indexing) {
    return `正在建立索引 · 已收录 ${status.count.toLocaleString()} 个文件`;
  }
  if (!status.indexedAt) return '索引未就绪';
  return `已收录 ${status.count.toLocaleString()} 个文件 · 用时 ${(status.elapsed / 1000).toFixed(1)}s`;
}

export function Finder() {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [total, setTotal] = useState(0);
  const [took, setTook] = useState(0);
  const [status, setStatus] = useState<Status>(EMPTY_STATUS);
  const [sel, setSel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const seqRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const terms = useMemo(() => highlightTerms(query), [query]);

  /* 主题：和桌面管家同一套变量，面板观感一致 */
  useEffect(() => {
    void (async () => {
      try {
        const cfg = await api.getConfig();
        applyTheme((cfg as any)?.theme);
      } catch {
        applyTheme(null);
      }
      try {
        const st = await (window as any).electronAPI.finderReady();
        if (st) setStatus(st);
      } catch {
        /* ignore */
      }
      inputRef.current?.focus();
    })();
  }, []);

  useEffect(() => {
    const apiAny = (window as any).electronAPI;
    const offStatus = apiAny.finderOnStatus((st: Status) => setStatus(st));
    const offFocus = apiAny.finderOnFocus(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      offStatus && offStatus();
      offFocus && offFocus();
    };
  }, []);

  const run = useCallback(async (text: string) => {
    const seq = ++seqRef.current;
    setBusy(true);
    try {
      const r = await (window as any).electronAPI.finderSearch(text, 120);
      if (seq !== seqRef.current) return;
      setHits(r.hits || []);
      setTotal(r.total || 0);
      setTook(r.took || 0);
      setSel(0);
      if (r.status) setStatus(r.status);
    } catch (e) {
      if (seq === seqRef.current) setHits([]);
    } finally {
      if (seq === seqRef.current) setBusy(false);
    }
  }, []);

  /* 输入去抖：连打时只算最后一次，避免主进程被几十次全盘匹配压住 */
  useEffect(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void run(query), 90);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [query, run]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.finder-row.on');
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const open = async (reveal = false) => {
    const hit = hits[sel];
    if (!hit) return;
    const apiAny = (window as any).electronAPI;
    if (reveal) {
      await apiAny.finderReveal(hit.path);
      await apiAny.finderHide();
      return;
    }
    const err = await apiAny.finderOpen(hit.path);
    if (err) {
      setToast(String(err));
      window.setTimeout(() => setToast(''), 2600);
      return;
    }
    await apiAny.finderHide();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      void (window as any).electronAPI.finderHide();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSel((s) => Math.min(hits.length - 1, s + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void open(e.ctrlKey || e.metaKey);
      return;
    }
    if (e.key === 'F5') {
      e.preventDefault();
      void (window as any).electronAPI.finderRebuild().then((st: Status) => setStatus(st));
    }
  };

  return (
    <div className="finder" data-busy={busy ? '1' : undefined}>
      <div className="finder-bar">
        <svg className="finder-glass" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="10.6" cy="10.6" r="6.2" stroke="currentColor" strokeWidth="1.7" />
          <path d="m15.4 15.4 4.2 4.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          className="finder-input"
          value={query}
          spellCheck={false}
          placeholder="搜索本机文件：文件名、*.pdf、路径，或 size:>100mb"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button
            className="finder-clear"
            title="清空"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
          >
            ✕
          </button>
        ) : (
          <span className="finder-hint">Ctrl+Shift+F</span>
        )}
      </div>

      <div className="finder-body" ref={listRef}>
        {hits.length === 0 && (
          <div className="finder-empty">
            {busy ? (
              '正在搜索…'
            ) : query.trim() ? (
              <>
                <p className="finder-empty-title">没有匹配「{query.trim()}」的文件</p>
                <p className="finder-empty-tip">
                  支持 <code>*.pdf</code> 类型、<code>D:\ work</code> 路径、空格 = 同时满足、
                  <code>|</code> = 任一、<code>!缓存</code> 排除、<code>size:&gt;100mb</code>、
                  <code>datemodified:本月</code>
                </p>
              </>
            ) : (
              <>
                <p className="finder-empty-title">输入关键字，立刻在这台电脑里找文件</p>
                <p className="finder-empty-tip">
                  ↑↓ 选择 · Enter 打开 · Ctrl+Enter 打开所在文件夹 · Esc 收起
                </p>
              </>
            )}
          </div>
        )}

        {hits.map((hit, i) => {
          const badge = extBadge(hit.ext);
          return (
            <div
              key={hit.path}
              className={`finder-row${i === sel ? ' on' : ''}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                setSel(i);
                void open(false);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                void (window as any).electronAPI.finderReveal(hit.path);
              }}
            >
              <span className="finder-ext" style={{ background: badge.bg, color: badge.fg }}>
                {badge.label}
              </span>
              <span className="finder-text">
                <span className="finder-name">
                  <Highlight text={hit.name} terms={terms} />
                </span>
                <span className="finder-dir">{shortDir(hit.dir)}</span>
              </span>
              <span className="finder-meta">
                <span>{hit.sizeText}</span>
                <span>{hit.modifiedText}</span>
              </span>
            </div>
          );
        })}
      </div>

      <div className="finder-foot">
        <span className="finder-status">
          <i className={`finder-dot${status.indexing ? ' indexing' : ''}`} />
          {statusText(status)}
        </span>
        <span className="finder-count">
          {toast ? (
            <span className="finder-toast">{toast}</span>
          ) : query.trim() ? (
            total > hits.length
              ? `${hits.length} / ${total.toLocaleString()} 条 · ${took}ms`
              : `${total.toLocaleString()} 条 · ${took}ms`
          ) : (
            'F5 重建索引'
          )}
        </span>
      </div>
    </div>
  );
}
