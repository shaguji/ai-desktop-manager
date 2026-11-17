/* ═══════════════════════════════════════════════════
   桌面便签 → 笔记 双向同步
   · 便签事项写进一篇「便签同步 · 每日事项」笔记（受管区块）
   · 在笔记里切换三态，状态回写到便签
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const NOTE_ID = 'note-sticky-sync';
  const TITLE = '便签同步 · 每日事项';
  const BEGIN = '<!--sticky:begin-->';
  const END = '<!--sticky:end-->';
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  let busy = false;
  let listener = null;
  /** 最近一次从便签读到的原始事项（null = 尚未加载） */
  let latest = null;
  /** 最近一次推给便签的负载，用来避免无意义的重复写入 */
  let lastPushed = '';
  /** 最近一次推送成功的时间：早于它的本地改动还没落地，别被便签的旧值顶回去 */
  let lastPushedAt = 0;
  let pushTimer = null;
  const subs = new Set();

  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function dayLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t1 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((t0 - t1) / 86400000);
    if (diff === 0) return '今天';
    if (diff === 1) return '昨天';
    if (diff === 2) return '前天';
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  const CH = { todo: ' ', doing: '/', done: 'x' };

  /**
   * 事项按「天」分组：今天 / 昨天 / 前天 / M月D日，组内未完成在前。
   * 供便签同步笔记与「待办事项」视图共用，保证两处顺序一致。
   */
  function groupByDay(items) {
    const groups = new Map();
    (items || [])
      .filter((it) => it && String(it.text || '').trim())
      .forEach((it) => {
        const ts = Number.isFinite(it.at) && it.at > 0 ? it.at : 0;
        const key = ts ? dayKey(ts) : 'earlier';
        if (!groups.has(key)) {
          groups.set(key, {
            key,
            stamp: ts ? new Date(ts).setHours(0, 0, 0, 0) : 0,
            label: ts ? dayLabel(ts) : '更早',
            weekday: ts ? WEEK[new Date(ts).getDay()] : '',
            items: []
          });
        }
        groups.get(key).items.push(it);
      });

    const list = Array.from(groups.values()).sort((a, b) => b.stamp - a.stamp);
    list.forEach((g) => {
      g.items.sort((a, b) => {
        const ra = a.status === 'done' ? 1 : 0;
        const rb = b.status === 'done' ? 1 : 0;
        if (ra !== rb) return ra - rb;
        return (a.at || 0) - (b.at || 0);
      });
    });
    return list;
  }

  function buildBlock(items) {
    const list = groupByDay(items);
    const lines = [BEGIN, '> 由桌面便签自动同步；切换状态会回写便签。'];
    list.forEach((g) => {
      lines.push('');
      if (g.stamp) {
        const d = new Date(g.stamp);
        const rel = g.label === '今天' || g.label === '昨天' || g.label === '前天' ? `（${g.label}）` : '';
        lines.push(`### ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${g.weekday}${rel}`);
      } else {
        lines.push('### 更早');
      }
      g.items.forEach((it) => {
        const status = it.status === 'doing' ? 'doing' : it.status === 'done' ? 'done' : 'todo';
        const text = String(it.text).replace(/<!--.*?-->/g, '').trim();
        lines.push(`- [${CH[status]}] ${text} <!--s:${it.id}-->`);
      });
    });
    if (!list.length) {
      lines.push('');
      lines.push('*便签里还没有事项，去桌面便签添加一条试试。*');
    }
    lines.push('');
    lines.push(END);
    return lines.join('\n');
  }

  function ensureNote() {
    let note = Store.getNote(NOTE_ID);
    const nb = Store.state.notebooks.find((b) => b.name === '每日工作') || Store.state.notebooks[0];
    if (!note) {
      return Store.createNote({
        id: NOTE_ID,
        notebookId: nb.id,
        title: TITLE,
        content: `# ${TITLE}\n\n${BEGIN}\n${END}\n`,
        silent: true
      });
    }
    if (note.deletedAt) {
      note.deletedAt = null;
    }
    return note;
  }

  /** 一次性清理历史版本的冗余内容：旧引导语、空待办占位、空补充标题 */
  function cleanLegacy(note) {
    if (!note) return false;
    const before = note.content || '';
    let c = before;
    c = c.replace(/^> 桌面便签里的事项会自动同步到这里.*\n?/gm, '');
    c = c.replace(/^## 我补充的事项\s*(?=\n\s*(?:##|#|$))/gm, '');
    c = c.replace(/^- \[[ xX/]\]\s*$/gm, '');
    c = c.replace(/\n{3,}/g, '\n\n').trim();
    if (c !== before.trim()) {
      note.content = c ? c + '\n' : '';
      return true;
    }
    return false;
  }

  function mergeContent(note, block) {
    const content = note.content || '';
    const bi = content.indexOf(BEGIN);
    const ei = content.indexOf(END);
    if (bi >= 0 && ei > bi) {
      return content.slice(0, bi) + block + content.slice(ei + END.length);
    }
    const header = `# ${note.title || TITLE}\n\n`;
    return header + block + '\n\n' + content;
  }

  function notifySubs(note) {
    subs.forEach((fn) => {
      try { fn(note); } catch (e) { /* ignore */ }
    });
  }

  const inShell = () => !!(global.NoteBridge && global.NoteBridge.inShell);

  function newStickyId() {
    return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  }

  /**
   * 便签镜像全部待办：未完成在前（创建时间升序），已完成的垫底。
   * 已完成的由桌面便签折叠展示（「已收起 N 项」），不在便签里删掉。
   */
  function buildPayload() {
    const all = Store.trackItems().slice().sort((a, b) => {
      const da = a.status === 'done' ? 1 : 0;
      const db = b.status === 'done' ? 1 : 0;
      if (da !== db) return da - db;
      if (da) return (b.closedAt || 0) - (a.closedAt || 0);
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
    return all.map((t) => {
      if (!t.stickyId) {
        t.stickyId = newStickyId();
        Store.linkSticky(t.id, t.stickyId);
      }
      return {
        id: t.stickyId,
        text: String(t.title || '').trim() || '未命名待办',
        status: t.status,
        at: t.createdAt
      };
    });
  }

  /**
   * 笔记 → 便签：整体校准。
   * managedIds 里包含已删除待办的便签 id，主进程会把它们从便签上摘掉。
   */
  async function pushAll(force) {
    if (!inShell() || typeof global.NoteBridge.syncSticky !== 'function') return null;
    const items = buildPayload();
    const json = JSON.stringify(items);
    if (!force && json === lastPushed) return null;
    const managedIds = Store.trackItems().map((t) => t.stickyId).filter(Boolean)
      .concat(Array.isArray(Store.state.stickyGone) ? Store.state.stickyGone : []);
    const res = await global.NoteBridge.syncSticky({ items, managedIds });
    if (!res || !Array.isArray(res.items)) return null;
    latest = res.items;
    lastPushed = json;
    lastPushedAt = Date.now();
    const present = new Set(res.items.map((x) => x.id));
    Store.markStickySynced(items.filter((x) => present.has(x.id)));
    Store.clearStickyGone();
    return res;
  }

  /**
   * 双向对齐：便签 ⇄ 待办（便签是唯一事实来源）。
   * 1. 便签上新增的 → 导入成待办（幂等）
   * 2. 便签上的标题 / 状态 → 一律回写待办
   * 3. 便签上被删掉的 → 待办一并删除
   * 4. 待办 → 推回便签（未完成在前，已完成垫底）
   */
  async function reconcile(opts) {
    const o = opts || {};
    if (!inShell() || busy) return null;
    busy = true;
    const dirty = new Set();
    const goneDates = new Set();
    try {
      const items = await global.NoteBridge.getSticky();
      if (!Array.isArray(items)) return null;
      latest = items;
      const byId = new Map(items.map((x) => [x.id, x]));

      /* 1) 便签新增 → 待办 */
      Store.linkStickyTracks(items);
      const created = Store.importTrackItems(items);
      if (created) Store.trackItems()
        .filter((t) => t.stickyId && !t.stickyAt)
        .forEach((t) => dirty.add(t.id));

      /* 2) 便签是唯一事实来源：标题 / 状态一律听便签的。
         唯一例外是「本地刚改、这轮还没推过去」的待办，等推送覆盖便签，避免把用户刚做的操作顶回去 */
      items.forEach((raw) => {
        const it = Store.trackBySticky(raw.id);
        if (!it) return;
        if (lastPushedAt && it.updatedAt > lastPushedAt) return;
        const text = String(raw.text || '').replace(/<!--.*?-->/g, '').trim();
        const st = raw.status === 'doing' || raw.status === 'done' ? raw.status : 'todo';
        if (text && text !== String(it.title || '').trim()) {
          Store.updateTrackItem(it.id, { title: text });
          dirty.add(it.id);
        }
        if (st !== it.status) {
          Store.setTrackStatus(it.id, st);
          dirty.add(it.id);
        }
      });

      /* 3) 便签删除 → 待办删除（便签清空视为异常，不做级联，防止配置被重置时丢数据） */
      const stickyEmpty = items.length === 0;
      Store.trackItems().slice().forEach((it) => {
        if (!it.stickyId || !it.stickyAt) return;
        if (byId.has(it.stickyId)) return;
        if (stickyEmpty) return;
        const dates = new Set([dayKey(it.createdAt)]);
        (it.progress || []).forEach((p) => dates.add(dayKey(p.at)));
        (it.risks || []).forEach((r) => dates.add(dayKey(r.at)));
        if (it.closedAt) dates.add(dayKey(it.closedAt));
        Store.deleteTrackItem(it.id);
        dates.forEach((d) => goneDates.add(d));
      });

      /* 4) 待办 → 便签 */
      const pushed = await pushAll();
      if (pushed && pushed.changed) {
        Store.trackItems().forEach((t) => { if (!t.stickyAt) dirty.add(t.id); });
      }

      /* 便签那份「每日事项」汇总笔记 */
      const note = ensureNote();
      cleanLegacy(note);
      const block = buildBlock(latest || []);
      const merged = mergeContent(note, block);
      if (merged !== note.content) {
        Store.updateNote(NOTE_ID, { content: merged }, { touch: false });
      }
      const fresh = Store.getNote(NOTE_ID);
      if (fresh) notifySubs(fresh);

      /* 待办有回写 → 当日工作日志跟着刷新 */
      if (global.Track) {
        dirty.forEach((id) => global.Track.syncItem(Store.trackItem(id)));
        goneDates.forEach((d) => global.Track.syncDailyNote(d));
      }
      if (o.toast && typeof o.toast === 'function' && (created || dirty.size)) {
        o.toast(`已与桌面便签对齐：${created ? `新增 ${created} 条，` : ''}更新 ${dirty.size} 条`, '🔄');
      }
      return fresh;
    } catch (e) {
      console.warn('[sticky] 同步失败', e);
      return null;
    } finally {
      busy = false;
    }
  }

  /** 兼容旧调用：只做一次完整对齐 */
  function pull(opts) {
    return reconcile(opts);
  }

  /** 待办有任何变化 → 防抖后推一次，保证桌面便签与笔记本一致 */
  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void pushAll();
    }, 500);
  }

  /** 笔记里切换了某个受管待办的状态 → 回写便签 */
  async function pushStatus(stickyId, status) {
    if (!global.NoteBridge || !global.NoteBridge.inShell || !stickyId) return;
    // 先本地乐观更新，界面立刻有反馈；随后以主进程广播的数据为准
    if (Array.isArray(latest)) {
      const it = latest.find((x) => x.id === stickyId);
      if (it) {
        it.status = status;
        notifySubs(Store.getNote(NOTE_ID));
      }
    }
    lastPushed = '';
    await global.NoteBridge.setStickyStatus(stickyId, status);
  }

  /**
   * 笔记里新建待办 → 写进桌面便签，返回便签条目（含 id）。
   * 主进程按 id 幂等写入，重复调用不会产生两条。
   */
  async function addItem(item) {
    if (!global.NoteBridge || !global.NoteBridge.inShell) return null;
    const text = String((item && item.text) || '').trim();
    if (!text) return null;
    const payload = {
      text,
      status: item.status === 'doing' || item.status === 'done' ? item.status : 'todo',
      at: Number.isFinite(item.at) && item.at > 0 ? item.at : Date.now()
    };
    if (item.id) payload.id = String(item.id);
    const saved = await global.NoteBridge.addSticky(payload);
    if (saved && saved.id) {
      if (Array.isArray(latest) && !latest.some((x) => x.id === saved.id)) latest.push(saved);
      const it = Store.trackBySticky(saved.id);
      if (it) Store.markStickySynced([{ id: saved.id, text: saved.text, status: saved.status }]);
    }
    lastPushed = '';
    lastPushedAt = Date.now();
    return saved || null;
  }

  function start() {
    if (!inShell()) return;
    void reconcile({ force: true });
    listener = global.NoteBridge.onStickyChanged(() => {
      void reconcile();
    });
    /* 待办被新增 / 改状态 / 写进展 / 删除后，自动推给桌面便签 */
    if (typeof Store.subscribe === 'function') {
      Store.subscribe(() => schedulePush());
    }
  }

  function stop() {
    if (listener) listener();
    listener = null;
  }

  global.StickySync = {
    NOTE_ID,
    TITLE,
    pull,
    reconcile,
    pushAll,
    schedulePush,
    start,
    stop,
    pushStatus,
    addItem,
    groupByDay,
    /** 便签原始事项；null 表示还没读到 */
    getItems() { return latest; },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); }
  };
})(window);
