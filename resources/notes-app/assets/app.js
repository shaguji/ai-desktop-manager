/* ═══════════════════════════════════════════════════
   归墨 · 工作笔记  —  应用逻辑
   ═══════════════════════════════════════════════════ */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => MD.esc(s == null ? '' : s);
  const pad = (n) => String(n).padStart(2, '0');
  const DAY = 86400000;

  const NB_COLORS = ['#00a82d', '#2f74d0', '#7c5cd6', '#d99a00', '#0f9d9d', '#e05252', '#8d968f'];

  /* ───────── DOM ───────── */
  const dom = {
    app: $('app'),
    sidebar: $('sidebar'),
    search: $('searchInput'),
    searchClear: $('searchClear'),
    countVault: $('countVault'),
    listTitle: $('listTitle'),
    listSub: $('listSub'),
    btnDaySummary: $('btnDaySummary'),
    noteList: $('noteList'),
    empty: $('emptyState'),
    editor: $('editor'),
    listPane: $('listPane'),
    editorPane: $('editorPane'),
    homePane: $('homePane'),
    vaultPane: $('vaultPane'),
    lookupBar: $('lookupBar'),
    lookupInput: $('lkInput'),
    lookupBack: $('lkBack'),
    lookupNew: $('lkNew'),
    lookupChips: $('lkChips'),
    trackDetail: $('trackDetail'),
    title: $('noteTitle'),
    content: $('noteContent'),
    preview: $('notePreview'),
    body: $('editorBody'),
    meta: $('noteMeta'),
    crumbDot: $('crumbDot'),
    crumbTime: $('crumbTime'),
    noteNotebook: $('noteNotebook'),
    saveState: $('saveState'),
    saveText: $('saveText'),
    wordCount: $('wordCount'),
    lineCount: $('lineCount'),
    tplBadge: $('tplBadge'),
    sort: $('sortSelect'),
    modalRoot: $('modalRoot'),
    modalBox: $('modalBox'),
    toastWrap: $('toastWrap'),
    storageFill: $('storageFill'),
    storageText: $('storageText')
  };

  let s = Store.state;
  let saveTimer = null;  let previewTimer = null;
  let searchTimer = null;
  let currentId = null;
  /* 事项跟踪视图里当前选中的事项 id（右侧详情联动） */
  let trackSel = null;
  let tplState = { filter: 'all', selected: null };
  let menuEl = null;

  /* ═══════════════ 工具 ═══════════════ */
  function toast(msg, icon) {
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = `<span class="t-ic">${icon || '✓'}</span><span>${esc(msg)}</span>`;
    dom.toastWrap.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .2s, transform .2s';
      d.style.opacity = '0';
      d.style.transform = 'translateY(6px)';
      setTimeout(() => d.remove(), 220);
    }, 2100);
  }

  function relTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const t = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (t === today) return hm;
    if (t === today - DAY) return '昨天';
    if (t === today - 2 * DAY) return '前天';
    if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`;
    return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
  }

  function fullTime(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function countWords(text) {
    const t = String(text || '');
    return {
      words: t.replace(/\s/g, '').length,
      lines: t ? t.split('\n').length : 0
    };
  }

  function highlight(text, q) {
    const safe = esc(text);
    if (!q || !q.trim()) return safe;
    try {
      const re = new RegExp(q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      return safe.replace(re, (m) => `<b>${m}</b>`);
    } catch (e) { return safe; }
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function safeName(name) {
    return String(name || '笔记').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
  }

  /* ═══════════════ 主题 ═══════════════ */
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  }

  /* ═══════════════ 渲染：侧栏 ═══════════════ */
  function renderSidebar() {
    const c = Store.counts();
    const ui = s.ui;

    const setNum = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    setNum('countAll', c.all);
    setNum('countToday', c.today);
    setNum('countTrack', c.track);
    setNum('countTrash', c.trash);
    /* 密码箱计数：只有解锁后才显示条数，锁定时用「—」避免泄露 */
    if (dom.countVault && window.VaultUI) dom.countVault.textContent = VaultUI.count();

    document.querySelectorAll('.nb-item[data-view], .side-item[data-view]').forEach((btn) => {
      const v = btn.dataset.view;
      btn.classList.toggle('active', ui.view === v && v !== 'trash');
    });

    renderNotebookTree();
    renderTags();

    if (dom.storageText && dom.storageFill) {
      const bytes = Store.storageSize();
      const kb = bytes / 1024;
      dom.storageText.textContent = kb > 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(1) + ' KB';
      dom.storageFill.style.width = Math.min(100, Math.max(2, (bytes / (5 * 1024 * 1024)) * 100)) + '%';
    }
  }

  /* 笔记本树：分组默认收拢，点 ＋ 展开 */
  /** 笔记本图标的字：中文取首字，英文取首字母大写 */
  function nbInitial(name) {
    const txt = String(name || '').trim();
    if (!txt) return '·';
    const ch = txt[0];
    return /[a-z]/i.test(ch) ? ch.toUpperCase() : ch;
  }

  function renderNotebookTree() {
    const box = $('nbTree');
    if (!box) return;
    const ui = s.ui;
    const c = Store.counts();
    const exp = ui.nbExpanded || {};

    const rowHtml = (b, kids, isSub, open) => {
      const isGroup = !!b.group || kids.length > 0;
      const total = isGroup
        ? (c.perNotebook[b.id] || 0) + kids.reduce((n, k) => n + (c.perNotebook[k.id] || 0), 0)
        : (c.perNotebook[b.id] || 0);
      const on = ui.view === 'notebook' && ui.notebookId === b.id;
      const caret = isGroup
        ? `<button class="nb-caret${open ? ' open' : ''}" data-nb-caret="${esc(b.id)}" title="${open ? '收起' : '展开'}">›</button>`
        : '<span class="nb-caret-ph"></span>';
      return `<button class="nb-item${isSub ? ' nb-sub' : ''}${on ? ' active' : ''}${isGroup ? ' nb-has-kids' : ''}" data-nb="${esc(b.id)}" style="--nb-color:${esc(b.color || '#8d968f')}">
        ${caret}
        <span class="nb-ic${isSub ? ' nb-ic-sm' : ''}">${esc(nbInitial(b.name))}</span>
        <span class="nb-name">${esc(b.name)}</span>
        <span class="nb-count">${total}</span>
      </button>`;
    };

    /* 待办事项：占用原「收集箱」的位置，作为独立入口（不走笔记本） */
    const trackOn = ui.view === 'track';
    const trackRow = `<button class="nb-item nb-track${trackOn ? ' active' : ''}" data-view="track" title="待办事项" style="--nb-color:#e0891c">
        <span class="nb-caret-ph"></span>
        <span class="nb-ic">✓</span>
        <span class="nb-name">待办事项</span>
        <span class="nb-count">${c.track}</span>
      </button>`;

    const roots = s.notebooks.filter((b) => !b.parentId);
    box.innerHTML = trackRow + roots.map((b) => {
      const kids = Store.notebookKids(b.id);
      /* 选中的子笔记本所属分组自动展开 */
      const open = exp[b.id] === true || (ui.view === 'notebook' && kids.some((k) => k.id === ui.notebookId));
      let html = rowHtml(b, kids, false, open);
      if (kids.length && open) {
        html += kids.map((k) => rowHtml(k, [], true, false)).join('');
      }
      return html;
    }).join('');
  }

  function renderTags() {
    const box = $('tagCloud');
    if (!box) return;
    const ui = s.ui;
    const live = Store.activeNotes();
    const used = (s.tags || [])
      .map((t) => ({ id: t.id, name: t.name, n: live.filter((x) => (x.tags || []).includes(t.name)).length }))
      .filter((t) => t.n > 0)
      .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, 'zh'));
    if (!used.length) { box.innerHTML = '<span class="tag-empty">还没有标签</span>'; return; }
    box.innerHTML = used.map((t) => `<button class="tag-chip${ui.view === 'tag' && ui.tagId === t.id ? ' active' : ''}" data-tag="${esc(t.id)}">#${esc(t.name)}<i>${t.n}</i></button>`).join('');
  }

  /* ───────────── 当前笔记的标签（编辑区标题下方） ───────────── */

  function renderNoteTags(note) {
    const box = $('noteTagRow');
    if (!box) return;
    const tags = (note && note.tags) || [];
    box.innerHTML = tags.map((t) => (
      `<span class="nt-chip">#${esc(t)}<i class="nt-x" data-untag="${esc(t)}" title="从本篇移除">×</i></span>`
    )).join('') + '<button class="nt-add" id="btnNoteTagAdd">＋ 标签</button>';
    box.querySelectorAll('[data-untag]').forEach((el) => {
      el.onclick = () => detachTag(el.dataset.untag);
    });
    const add = $('btnNoteTagAdd');
    if (add) add.onclick = (e) => openTagPicker(e.currentTarget);
  }

  let tagPopEl = null;
  function closeTagPicker(keepFocus) {
    if (tagPopEl) {
      tagPopEl.remove();
      tagPopEl = null;
      /* 标签面板关掉后把焦点还给正文；如果紧接着又要打开别的东西就不抢 */
      if (!keepFocus) {
        setTimeout(() => {
          if (document.activeElement === document.body || !document.activeElement) focusEditor();
        }, 0);
      }
    }
  }

  function openTagPicker(anchor) {
    if (!currentId) return;
    closeTagPicker(true);
    const note = Store.getNote(currentId);
    if (!note || !anchor) return;
    const have = new Set(note.tags || []);
    const avail = (s.tags || []).filter((t) => !have.has(t.name));
    const el = document.createElement('div');
    el.className = 'tag-pop';
    el.innerHTML = `
      <input class="tp-input" id="tpInput" type="text" maxlength="24" placeholder="输入标签名，回车新建">
      <div class="tp-list">
        ${avail.length
    ? avail.map((t) => `<button class="tp-item" data-tp="${esc(t.name)}">#${esc(t.name)}</button>`).join('')
    : '<div class="tp-empty">还没有其他标签，直接在上面输入新建</div>'}
      </div>`;
    document.body.appendChild(el);
    tagPopEl = el;

    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = Math.max(10, Math.min(r.left, window.innerWidth - w - 12)) + 'px';
    el.style.top = (r.bottom + 6 + h > window.innerHeight - 12 ? Math.max(10, r.top - h - 6) : r.bottom + 6) + 'px';

    const input = el.querySelector('#tpInput');
    input.focus();
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); attachTag(input.value); }
      else if (e.key === 'Escape') { closeTagPicker(); }
    };
    el.querySelectorAll('[data-tp]').forEach((b) => {
      b.onclick = () => attachTag(b.dataset.tp);
    });
  }

  function attachTag(raw) {
    const name = String(raw || '').trim().replace(/^#+/, '').trim();
    if (!name) { closeTagPicker(); return; }
    if (!currentId) return;
    Store.addTag(name);
    Store.setTagOnNote(currentId, name, true);
    closeTagPicker();
    renderNoteTags(Store.getNote(currentId));
    renderSidebar();
    renderList();
    toast(`已加上标签 #${name}`, '#');
  }

  function detachTag(name) {
    if (!currentId) return;
    Store.setTagOnNote(currentId, name, false);
    renderNoteTags(Store.getNote(currentId));
    renderSidebar();
    renderList();
    toast(`已移除标签 #${name}`, '✓');
  }

  /* ═══════════════ 渲染：列表 ═══════════════ */
  function viewMeta() {
    const ui = s.ui;
    if (ui.view === 'notebook') {
      const nb = Store.notebookOf(ui.notebookId);
      return { title: nb ? nb.name : '笔记本', emoji: '' };
    }
    if (ui.view === 'tag') return { title: '#' + Store.tagName(ui.tagId) };
    if (ui.view === 'today') return { title: '今日更新' };
    if (ui.view === 'track') return { title: '待办事项' };
    if (ui.view === 'vault') return { title: '密码箱' };
    if (ui.view === 'trash') return { title: '回收站' };
    if (ui.view === 'lookup') return { title: '随手查' };
    return { title: '全部笔记' };
  }

  /** 密码箱占满列表 + 编辑区；其它视图恢复正常列表 + 编辑器 */
  function applyViewLayout() {
    const v = s.ui.view;
    const isVault = v === 'vault';
    if (dom.listPane) dom.listPane.hidden = isVault;
    if (dom.editorPane) dom.editorPane.hidden = isVault;
    if (dom.vaultPane) dom.vaultPane.hidden = !isVault;
    if (isVault && window.VaultUI) VaultUI.mount();
  }

  /**
   * 列表摘要：跳过模板骨架（表格 / 标题 / 空待办 / 只有字段名的行），
   * 只取第一段有信息量的正文，避免同类笔记的摘要全是「项目 内容 会议名称…」。
   */
  function noteSnippet(note) {
    const raw = String((note && note.content) || '');
    if (!raw.trim()) return '空白笔记';
    const title = String(note.title || '').trim();

    const skipLine = (ln) => {
      const t = ln.trim();
      if (!t) return true;
      if (/^(#{1,6}\s|>|\||```|<!--|-{3,}|\*\*\*)/.test(t)) return true;          // 标题 / 引用 / 表格 / 代码 / 分隔线
      if (/^[-*+]\s*\[[ xX]?\]?\s*$/.test(t)) return true;                        // 空待办
      /* 只有字段名、没有内容的行（结尾是冒号），如「- **现状 / 数据**：」「2. **执行步骤**（含命令）：」 */
      const item = t.replace(/^([-*+]|\d+\.)\s+/, '').replace(/\*\*/g, '').trim();
      if (/[:：]$/.test(item) && item.length <= 40) return true;
      if (/^\d+\.\s*$/.test(t)) return true;                                        // 空有序列表
      return false;
    };

    const picked = [];
    for (const ln of raw.split(/\r?\n/)) {
      if (skipLine(ln)) continue;
      const text = MD.plain(ln, 160).replace(/^\[.\]\s*/, '');
      if (!text || text === title) continue;
      picked.push(text);
      if (picked.join(' ').length >= 64) break;
    }

    const out = picked.join(' · ').replace(/\s+/g, ' ').trim();
    if (!out) return '待填写';
    return out.length > 90 ? out.slice(0, 90) + '…' : out;
  }

  function renderList() {
    const ui = s.ui;
    applyViewLayout();
    if (ui.view === 'vault') return;
    const meta = viewMeta();
    dom.listTitle.textContent = meta.title;
    dom.sort.value = ui.sort;
    dom.sort.style.visibility = ui.view === 'track' || ui.view === 'trash' ? 'hidden' : 'visible';
    /* 列表头唯一的「＋」：在待办视图里新建待办；在某个分类下就在该分类新建 */
    const newBtn = $('btnListNew');
    if (newBtn) {
      const nb = ui.view === 'notebook' ? Store.notebookOf(ui.notebookId) : null;
      newBtn.title = ui.view === 'track' ? '新建待办'
        : nb ? `在「${nb.name}」新建笔记`
          : ui.view === 'tag' ? '在标签下新建笔记' : '新建笔记';
      newBtn.classList.toggle('is-ctx', ui.view === 'notebook' || ui.view === 'track');
    }

    /* 随手查：顶部搜索条 + 类型筛选，隐藏常规标题行 */
    const isLookup = ui.view === 'lookup';
    const head = dom.listPane.querySelector('.list-head');
    if (head) head.classList.toggle('is-lookup', isLookup);
    if (dom.lookupBar) dom.lookupBar.hidden = !isLookup;
    if (dom.lookupChips) dom.lookupChips.hidden = !isLookup;
    if (isLookup && window.HomeUI) HomeUI.renderLookupChips();
    if (isLookup && dom.lookupInput) dom.lookupInput.value = ui.search || '';

    /* 每日工作页：显示「生成总结」入口（可选取时间段出周/月/季/年总结） */
    if (dom.btnDaySummary) {
      const nb = ui.view === 'notebook' ? Store.notebookOf(ui.notebookId) : null;
      dom.btnDaySummary.hidden = !(nb && (nb.id === 'nb-daily' || nb.name === '每日工作'));
    }

    if (ui.view === 'track') return renderTrackList();
    /* 随手查里选中「待办」：直接呈现待办事项列表（与事项跟踪同一份数据） */
    if (isLookup && ui.kindId === 'kind-todo') return renderTrackList();
    hideTrackDetail();
    /* 从待办列表切回笔记列表时，右栏要恢复成编辑器 / 空态 */
    const alive = currentId ? Store.getNote(currentId) : null;
    if (alive && !alive.deletedAt) {
      dom.empty.hidden = true;
      dom.editor.hidden = false;
    } else if (dom.trackDetail && dom.trackDetail.innerHTML) {
      dom.editor.hidden = true;
      dom.empty.hidden = false;
    }

    const list = Store.filteredNotes();
    dom.listSub.textContent = ui.view === 'trash'
      ? `回收站内 ${list.length} 篇 · 内容保留在本机`
      : `共 ${list.length} 篇`;

    if (!list.length) {
      dom.noteList.innerHTML = `<div class="list-empty">
        <span class="le-ic">${ui.search ? '🔍' : (ui.view === 'trash' ? '🗑️' : '📭')}</span>
        ${ui.search ? `没有匹配「${esc(ui.search)}」的笔记` : (ui.view === 'trash' ? '回收站是空的' : '这里还没有笔记<br>点上方 ＋ 写一笔')}
      </div>`;
      return;
    }

    const q = ui.search;
    dom.noteList.innerHTML = list.map((n) => {
      const nb = Store.notebookOf(n.notebookId);
      const snippet = noteSnippet(n);
      const tags = (n.tags || []).slice(0, 3).map((t) => `<span class="nc-tag">#${esc(t)}</span>`).join('');
      const active = n.id === currentId && ui.view !== 'trash';
      const actions = ui.view === 'trash'
        ? `<div class="trash-actions">
             <button class="btn btn-sm btn-ghost" data-restore="${n.id}">恢复</button>
             <button class="btn btn-sm" data-purge="${n.id}">彻底删除</button>
           </div>` : '';
      return `<div class="note-card${active ? ' active' : ''}" data-note="${n.id}">
        <div class="nc-top">
          <div class="nc-title">
            ${n.pinned ? '<span class="nc-pin">📌</span>' : ''}${n.starred ? '<span class="nc-star">★</span>' : ''}
            <span>${highlight(n.title || '无标题笔记', q)}</span>
          </div>
          <span class="nc-date">${relTime(n.updatedAt)}</span>
        </div>
        <div class="nc-snippet">${highlight(snippet, q)}</div>
        ${tags || (ui.view === 'all' && nb) ? `<div class="nc-tags">${nb ? `<span class="nc-tag" style="color:${nb.color}">${esc(nb.name)}</span>` : ''}${tags}</div>` : ''}
        ${actions}
      </div>`;
    }).join('');
  }

  /* ── 事项跟踪：全生命周期 + 每日进展 + 右侧详情联动 ── */
  const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const TRACK_STEPS = [['todo', '未开始', '○'], ['doing', '进行中', '◐'], ['done', '已完成', '●']];

  function showTrackDetail() {
    if (!dom.trackDetail) return;
    dom.trackDetail.hidden = false;
    dom.empty.hidden = true;
    dom.editor.hidden = true;
  }

  function hideTrackDetail() {
    if (dom.trackDetail) dom.trackDetail.hidden = true;
  }

  function renderTrackPlaceholder(icon, text) {
    if (!dom.trackDetail) return;
    dom.trackDetail.innerHTML = `<div class="tdk-scroll"><div class="tdk-blank">
      <div class="tdk-blank-ic">${icon}</div><p>${text}</p></div></div>`;
    showTrackDetail();
  }

  function trackDayText(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`;
  }

  function trackAgoText(ts) {
    const d = new Date(ts);
    const days = Math.round((new Date().setHours(0, 0, 0, 0) -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / DAY);
    if (days <= 0) return '今天';
    if (days === 1) return '昨天';
    if (days <= 7) return `${days} 天前`;
    return trackDayText(ts);
  }

  /** 截止日期 → 展示文案与紧急度（逾期 / 今天 / 明天 / 日期） */
  function dueInfo(due) {
    if (!due) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(String(due).replace(/-/g, '/'));
    if (isNaN(d.getTime())) return null;
    const days = Math.round((today.getTime() - d.getTime()) / DAY);
    if (days > 0) return { text: days === 1 ? '逾期 1 天' : `逾期 ${days} 天`, cls: 'late', days };
    if (days === 0) return { text: '今天到期', cls: 'today', days };
    if (days === -1) return { text: '明天到期', cls: 'soon', days };
    return { text: `${d.getMonth() + 1}月${d.getDate()}日到期`, cls: 'normal', days };
  }

  /** 列表排序：进行中 → 未开始 → 已完成；组内按截止日期（早的在前），无期限靠后，再按最近动态 */
  function sortTrackItems(items) {
    const rank = (it) => (it.status === 'doing' ? 0 : it.status === 'todo' ? 1 : 2);
    const dueKey = (it) => (it.due ? new Date(it.due.replace(/-/g, '/')).getTime() : Infinity);
    return items.slice().sort((a, b) =>
      rank(a) - rank(b) || dueKey(a) - dueKey(b) || (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function trackMatches(it, q) {
    if (!q) return true;
    const bag = [it.title, it.detail]
      .concat((it.progress || []).map((p) => p.text))
      .concat((it.risks || []).map((r) => r.text))
      .join('\n')
      .toLowerCase();
    return bag.includes(String(q).toLowerCase());
  }

  function renderTrackList() {
    const q = String(s.ui.search || '').trim();
    const all = Store.trackItems();
    const items = q ? all.filter((it) => trackMatches(it, q)) : all;
    const open = items.filter((t) => t.status !== 'done').length;
    dom.sort.style.visibility = 'hidden';
    dom.listSub.textContent = q
      ? `找到 ${items.length} 项`
      : items.length
        ? `${open} 项未办结 · 共 ${items.length} 项 · 进展自动同步到「每日工作」`
        : '还没有待办 · 点右上角「＋」记下第一件事';

    if (!items.length) {
      const ic = q ? '🔍' : '✅';
      dom.noteList.innerHTML = `<div class="list-empty">
        <span class="le-ic">${ic}</span>
        ${q ? '没有匹配的待办<br>换个关键词试试' : '还没有待办<br>点右上角「＋」，记下要做的事'}
      </div>`;
      renderTrackPlaceholder(ic, q ? '没有匹配的待办<br>换个关键词试试' : '左侧还没有待办<br>点右上角「＋」记下第一件事');
      return;
    }

    const groups = [
      { key: 'doing', label: '进行中', icon: '◐' },
      { key: 'todo', label: '未开始', icon: '○' },
      { key: 'done', label: '已完成', icon: '●' }
    ];
    /* 默认选中展示顺序里的第一条（进行中优先），而不是数据里的第一条 */
    const ordered = [];
    groups.forEach((g) => ordered.push(...sortTrackItems(items.filter((t) => t.status === g.key))));
    const sel = ordered.find((t) => t.id === trackSel) || ordered[0];
    trackSel = sel.id;

    dom.noteList.innerHTML = `
      ${groups.map((g) => {
        const list = sortTrackItems(items.filter((t) => t.status === g.key));
        if (!list.length) return '';
        return `<div class="todo-group">
          <div class="todo-day">
            <span class="td-label">${g.icon} ${g.label}</span>
            <span class="td-line"></span>
            <span class="td-count">${list.length}</span>
          </div>
          ${list.map((it) => {
            const todayKey = Track.dayKey(Date.now());
            const touchedToday = (it.progress || []).some((p) => Track.dayKey(p.at) === todayKey) ||
              Track.dayKey(it.createdAt) === todayKey;
            const lastEntry = (it.progress || []).length
              ? it.progress[it.progress.length - 1] : null;
            const sub = touchedToday
              ? (lastEntry && Track.dayKey(lastEntry.at) === todayKey
                ? `今日进展：${esc(lastEntry.text.slice(0, 24))}`
                : '今日已更新')
              : `更新于 ${trackAgoText(it.updatedAt || it.createdAt)}`;
            const di = g.key === 'done' ? null : dueInfo(it.due);
            return `<div class="todo-line trk-line state-${g.key}${it.id === trackSel ? ' active' : ''}" data-track-id="${esc(it.id)}" role="button" tabindex="0">
              <span class="tl-text">${esc(it.title)}</span>
              ${di ? `<span class="tl-due ${di.cls}" title="截止 ${esc(it.due)}">${di.text}</span>` : ''}
              ${touchedToday ? '<span class="tl-badge doing">今日</span>' : ''}
              <span class="trk-sub">${sub}</span>
              <span class="tl-arrow">›</span>
            </div>`;
          }).join('')}
        </div>`;
      }).join('')}`;

    renderTrackDetail(sel);
  }

  function trackDetailHtml(it) {
    const st = it.status === 'doing' ? 'doing' : it.status === 'done' ? 'done' : 'todo';
    const stText = Track.statusText(st);
    const created = `${trackDayText(it.createdAt)} ${WEEKDAYS[new Date(it.createdAt).getDay()]} ${fullTime(it.createdAt).slice(11, 16)}`;
    const updated = `${trackAgoText(it.updatedAt || it.createdAt)} ${fullTime(it.updatedAt || it.createdAt).slice(11, 16)}`;
    const closed = it.closedAt ? `${trackDayText(it.closedAt)} ${fullTime(it.closedAt).slice(11, 16)}` : '';

    /* 进展按天分组，倒序 */
    const byDay = new Map();
    (it.progress || []).slice().sort((a, b) => b.at - a.at).forEach((p) => {
      const k = Track.dayKey(p.at);
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k).push(p);
    });

    const timeline = byDay.size
      ? Array.from(byDay.entries()).map(([k, list]) => {
        const d = new Date(k.replace(/-/g, '/'));
        const label = k === Track.dayKey(Date.now()) ? '今天' : k === Track.dayKey(Date.now() - DAY) ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日`;
        return `<div class="trk-day"><span>${label}</span><i>${WEEKDAYS[d.getDay()]}</i><span class="td-line"></span></div>
          ${list.map((p) => `<div class="trk-entry">
            <span class="trk-entry-time">${fullTime(p.at).slice(11, 16)}</span>
            <p>${esc(p.text)}</p>
          </div>`).join('')}`;
      }).join('')
      : '<div class="tdk-empty">还没有进展记录。在上方写下今天的动态，它会自动同步到「每日工作」的当天表格里。</div>';

    /* 风险 / 困难，倒序展示 */
    const risks = (it.risks || []).slice().sort((a, b) => b.at - a.at);
    const riskOpen = risks.filter((r) => !r.resolved).length;
    const riskList = risks.length
      ? risks.map((r) => `<div class="trk-risk${r.resolved ? ' resolved' : ''}">
          <span class="trk-risk-ic">${r.resolved ? '✓' : '⚠'}</span>
          <div class="trk-risk-body">
            <p>${esc(r.text)}</p>
            <i>${trackDayText(r.at)} ${fullTime(r.at).slice(11, 16)}${r.resolved ? ' · 已解决' : ''}</i>
          </div>
          <button type="button" class="trk-risk-btn" data-risk-toggle="${esc(r.id)}" title="${r.resolved ? '标记为未解决' : '标记为已解决'}">${r.resolved ? '重新打开' : '已解决'}</button>
        </div>`).join('')
      : '<div class="tdk-empty">还没有记录风险。遇到阻塞、依赖、资源不足等问题时记在这里，方便复盘与升级。</div>';

    return `<div class="tdk-scroll">
      <input class="trk-title-input" id="trkTitleInput" value="${esc(it.title)}" maxlength="120" spellcheck="false" title="点击可修改名称">
      ${it.detail ? `<p class="tdk-note">${esc(it.detail)}</p>` : ''}

      <div class="tdk-sec tdk-sec-first">记录今日进展</div>
      <div class="trk-add">
        <textarea id="trkAddText" placeholder="这件待办今天有什么进展？Ctrl+Enter 快速保存" rows="2"></textarea>
        <button type="button" class="btn btn-primary btn-sm" id="trkAddBtn">添加进展</button>
      </div>

      <div class="tdk-sec tdk-sec-risk">风险及困难</div>
      <div class="trk-add trk-add-risk">
        <textarea id="trkRiskText" placeholder="记录当前的风险、困难或阻塞，例如：联调环境不稳定，影响进度" rows="2"></textarea>
        <button type="button" class="btn btn-sm trk-risk-save" id="trkRiskBtn">记录风险</button>
      </div>
      <div class="trk-risk-list">${riskList}</div>

      <div class="tdk-sec">切换状态</div>
      <div class="tdk-states">
        ${TRACK_STEPS.map(([k, label, ic]) => `<button type="button" class="tdk-state-btn${st === k ? ' on' : ''}" data-track-set="${k}">${ic} ${label}</button>`).join('')}
      </div>

      <div class="tdk-sec">进展时间线</div>
      <div class="trk-timeline">${timeline}</div>

      <div class="tdk-sec">待办信息</div>
      <div class="tdk-card">
        <div class="tdk-row"><span class="tdk-k">状态</span><span class="tdk-v"><b class="tdk-st state-${st}">${stText}</b></span></div>
        <div class="tdk-row"><span class="tdk-k">截止日期</span><span class="tdk-v"><input type="date" class="tdk-due" id="trkDueInput" value="${esc(it.due || '')}"></span></div>
        <div class="tdk-row"><span class="tdk-k">创建时间</span><span class="tdk-v">${created}</span></div>
        <div class="tdk-row"><span class="tdk-k">最近动态</span><span class="tdk-v">${updated}</span></div>
        ${closed ? `<div class="tdk-row"><span class="tdk-k">办结时间</span><span class="tdk-v">${closed}</span></div>` : ''}
        <div class="tdk-row"><span class="tdk-k">进展记录</span><span class="tdk-v">${(it.progress || []).length} 条 · 自动同步到「每日工作」</span></div>
        <div class="tdk-row"><span class="tdk-k">风险 / 困难</span><span class="tdk-v">${risks.length ? `${risks.length} 条${riskOpen ? ` · <b class="tdk-risk-open">${riskOpen} 项未解决</b>` : ' · 全部已解决'}` : '暂无'}</span></div>
      </div>
    </div>`;
  }

  function renderTrackDetail(it) {
    if (!dom.trackDetail) return;
    if (!it) {
      renderTrackPlaceholder('✅', '左侧选择一条待办，这里会显示它的全部进展');
      return;
    }
    dom.trackDetail.innerHTML = trackDetailHtml(it);
    showTrackDetail();

    const ta = $('trkAddText');
    if (ta) {
      ta.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submitTrackProgress();
        }
      };
    }
    const rta = $('trkRiskText');
    if (rta) {
      rta.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          submitTrackRisk();
        }
      };
    }
    const dueInput = $('trkDueInput');
    if (dueInput) {
      dueInput.onchange = () => {
        Store.updateTrackItem(it.id, { due: dueInput.value || null });
        renderSidebar();
        renderList();
        toast(dueInput.value ? '截止日期已更新' : '已取消截止日期', '📅');
      };
    }
    const titleInput = $('trkTitleInput');
    if (titleInput) {
      titleInput.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); titleInput.blur(); } };
      titleInput.onchange = () => {
        const title = titleInput.value.trim();
        if (!title || title === it.title) { titleInput.value = it.title; return; }
        Store.updateTrackItem(it.id, { title });
        Track.syncItem(Store.trackItem(it.id));
        renderSidebar();
        renderList();
        toast('名称已更新，当日表格同步刷新', '✓');
      };
    }
  }

  function submitTrackProgress() {
    const it = Store.trackItem(trackSel);
    const ta = $('trkAddText');
    if (!it || !ta) return;
    const text = ta.value.trim();
    if (!text) { toast('先写一点进展再保存', '!'); return; }
    Store.addTrackProgress(it.id, text);
    Track.syncItem(Store.trackItem(it.id));
    renderSidebar();
    renderList();
    toast('进展已记录，并同步到当日「每日工作」', '📈');
  }

  function submitTrackRisk() {
    const it = Store.trackItem(trackSel);
    const rta = $('trkRiskText');
    if (!it || !rta) return;
    const text = rta.value.trim();
    if (!text) { toast('先描述一下风险或困难', '!'); return; }
    Store.addTrackRisk(it.id, text);
    Track.syncItem(Store.trackItem(it.id));
    renderSidebar();
    renderList();
    toast('风险已记录，并同步到当日「每日工作」', '⚠');
  }

  function openTrackDialog() {
    openModal(`
      <div class="modal-head">
        <div><h3>新建待办</h3><p>记下一件要做的事，进展会按天同步进「每日工作」</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>待办名称</label>
          <input type="text" id="trkNewTitle" placeholder="例如：核心系统批处理窗口调整" maxlength="120">
        </div>
        <div class="field">
          <label>截止日期（可选）</label>
          <input type="date" id="trkNewDue">
        </div>
        <div class="field">
          <label>背景 / 目标（可选）</label>
          <textarea id="trkNewDetail" style="min-height:70px;font-family:inherit" placeholder="为什么要做这件事，做到什么程度算办结"></textarea>
        </div>
        <div class="field">
          <label>已知风险 / 困难（可选）</label>
          <textarea id="trkNewRisk" style="min-height:52px;font-family:inherit" placeholder="立项时就已知的阻塞或隐患，之后可在详情中继续补充"></textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="trkCreateBtn">创建待办</button>
      </div>`, { size: 'mid' });

    $('trkNewTitle').focus();
    $('trkNewTitle').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); $('trkCreateBtn').click(); } };
    $('trkCreateBtn').onclick = () => {
      const title = $('trkNewTitle').value.trim();
      if (!title) { toast('先给待办起个名字', '!'); return; }
      const riskText = $('trkNewRisk').value.trim();
      /* 在桌面管家内运行时，同一条待办也要落到桌面便签列表里 */
      const toSticky = !!(window.StickySync && window.NoteBridge && NoteBridge.inShell);
      const stickyId = toSticky
        ? `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
        : null;
      const item = Store.addTrackItem({
        title,
        due: $('trkNewDue') ? ($('trkNewDue').value || null) : null,
        detail: $('trkNewDetail').value,
        stickyId,
        risks: riskText ? [{ id: 'r-new', at: Date.now(), text: riskText, resolved: false }] : []
      });
      closeModal();
      trackSel = item.id;
      if (s.ui.view !== 'track') Store.setUI({ view: 'track', notebookId: null, tagId: null });
      Track.syncItem(item);
      renderSidebar();
      renderList();
      if (toSticky) {
        void StickySync.addItem({ id: stickyId, text: title, status: item.status, at: item.createdAt })
          .then((saved) => {
            if (!saved) Store.updateTrackItem(item.id, { stickyId: null });
          });
      }
      toast(toSticky
        ? '待办已创建，已同步到桌面便签与「每日工作」'
        : '待办已创建，当日「每日工作」已加入进展表', '✅');
    };
  }

  /** 待办状态变化 → 回写桌面便签（只有来自便签的才有 stickyId） */
  function pushStickyStatus(it) {
    if (!it || !it.stickyId || !window.StickySync || !StickySync.pushStatus) return;
    const st = it.status === 'done' ? 'done' : it.status === 'doing' ? 'doing' : 'todo';
    void StickySync.pushStatus(it.stickyId, st);
  }

  /**
   * 把桌面便签的事项同步进「事项跟踪」。
   * 幂等：已导入过的便签（同 stickyId）会跳过，所以便签每次变化都能安全调用。
   */
  function maybeImportSticky(opts) {
    const o = opts || {};
    const items = window.StickySync ? StickySync.getItems() : null;
    if (!Array.isArray(items) || !items.length) return;
    /* 老数据：之前导入过但没有 stickyId，先按标题重新对上号 */
    Store.linkStickyTracks(items);
    const created = Store.importTrackItems(items);
    if (!created) return;
    s.trackImported = true;
    Store.save(true);
    const todayKey = Track.dayKey(Date.now());
    Store.trackItems()
      .filter((t) => t.stickyId && Track.dayKey(t.createdAt) === todayKey)
      .forEach((t) => Track.syncItem(t));
    Track.syncDailyNote(todayKey);
    renderSidebar();
    renderList();
    if (!o.silent) toast(`已把 ${created} 条便签待办同步进来`, '✅');
  }

  /**
   * 从桌面便签「详情」跳过来：按 stickyId 找到（找不到就补建）事项跟踪记录，
   * 切到事项跟踪视图并选中它，右侧直接显示全生命周期。
   */
  async function focusTrackBySticky(stickyId) {
    if (!stickyId) return false;
    let it = Store.trackBySticky(stickyId);
    if (!it) {
      let items = window.StickySync ? StickySync.getItems() : null;
      if (!Array.isArray(items) && window.StickySync) {
        try { await StickySync.pull({ force: true }); } catch (e) { /* ignore */ }
        items = StickySync.getItems();
      }
      const raw = Array.isArray(items) ? items.find((x) => x.id === stickyId) : null;
      if (raw) {
        Store.importTrackItems([raw]);
        it = Store.trackBySticky(stickyId);
        if (it) Track.syncItem(it);
      }
    }
    if (!it) {
      toast('没有找到对应的待办记录，请稍后重试', '!');
      return false;
    }
    if (s.ui.view === 'vault') VaultUI.reset();
    trackSel = it.id;
    Store.setUI({ view: 'track', notebookId: null, tagId: null, search: '' });
    if (dom.search) dom.search.value = '';
    renderSidebar();
    renderList();
    requestAnimationFrame(() => {
      const el = dom.noteList.querySelector(`[data-track-id="${it.id}"]`);
      if (el) {
        el.scrollIntoView({ block: 'center' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1200);
      }
    });
    toast(`已定位到「${it.title}」的跟踪记录`, '🎯');
    return true;
  }

  /* ═══════════════ 渲染：编辑器 ═══════════════ */
  function showEmpty() {
    currentId = null;
    hideTrackDetail();
    dom.editor.hidden = true;
    dom.empty.hidden = false;
  }

  function renderNotebookSelect(selectedId) {
    /* 只列可存放笔记的笔记本；分组容器不出现，子笔记本缩进显示 */
    dom.noteNotebook.innerHTML = s.notebooks
      .filter((b) => !(b.group || Store.notebookKids(b.id).length))
      .map((b) => {
        const parent = b.parentId ? Store.notebookOf(b.parentId) : null;
        const label = parent ? `　└ ${b.name}` : b.name;
        return `<option value="${b.id}"${b.id === selectedId ? ' selected' : ''}>${esc(label)}</option>`;
      })
      .join('');
  }

  function openNote(id, opts) {
    const o = opts || {};
    const note = Store.getNote(id);
    if (!note || note.deletedAt) { showEmpty(); return; }
    const prevId = currentId;
    /* 同一条笔记被「再打开」一次（搜索/便签同步/状态刷新都会走 renderAll → openNote）：
       这时用户可能正把光标停在正文中间打字，绝不能把输入框重灌一遍让光标跳到末尾。 */
    const sameNote = prevId === id && !dom.editor.hidden;
    const editingContent = sameNote && document.activeElement === dom.content;
    const editingTitle = sameNote && document.activeElement === dom.title;
    const keepSel = editingContent ? [dom.content.selectionStart, dom.content.selectionEnd] : null;

    currentId = id;
    s.ui.activeNoteId = id;
    Store.save();

    dom.empty.hidden = true;
    dom.editor.hidden = false;
    hideTrackDetail();
    hideImageAsk();
    closeTagPicker();

    if (!editingTitle) dom.title.value = note.title || '';
    /* 正在打字就保留输入框里的内容（稍后由保存流程并回 store），别中途换掉 */
    if (!editingContent && !(sameNote && dom.content.value === (note.content || ''))) {
      dom.content.value = note.content || '';
    }
    if (keepSel && dom.content.value.length >= keepSel[0]) {
      dom.content.setSelectionRange(keepSel[0], Math.min(keepSel[1], dom.content.value.length));
    }
    renderNotebookSelect(note.notebookId);
    const nb = Store.notebookOf(note.notebookId);
    dom.crumbDot.style.background = nb ? nb.color : 'var(--green)';
    dom.crumbTime.textContent = '更新于 ' + relTime(note.updatedAt) + ' · ' + fullTime(note.createdAt).slice(0, 10);

    $('btnPin').classList.toggle('on', !!note.pinned);

    dom.tplBadge.hidden = !note.templateId;
    if (note.templateId) {
      const tpl = allTemplates().find((t) => t.id === note.templateId);
      dom.tplBadge.textContent = tpl ? `${tpl.icon} ${tpl.name}` : '模板笔记';
    }

    renderMeta(note);
    renderNoteTags(note);
    renderPreview(dom.content.value);
    setMode(s.ui.editorMode || 'edit');
    updateCounts(dom.content.value);
    /* 正在正文里打字时连高度都别碰：renderAll → openNote 会被便签同步、状态刷新
       反复触发，重排一次就可能把滚动位置和输入法组合打乱。 */
    if (!editingContent) autoGrow(true);
    if (!editingContent) markSaved();

    if (editingContent) {
      /* 正在正文里打字：焦点和光标都留在原处，别的什么都不动 */
    } else if (o.focus) {
      if (o.focus === 'title') { dom.title.focus(); dom.title.select(); }
      else if (s.ui.editorMode !== 'preview') dom.content.focus();
    } else if (o.focus === undefined && s.ui.editorMode !== 'preview') {
      /* 默认把光标放进正文：点开笔记就能直接输入（传 null 表示刻意不抢焦点） */
      dom.content.focus();
      const atEnd = dom.content.value.length;
      dom.content.setSelectionRange(atEnd, atEnd);
    }
    if (window.innerWidth > 900) {
      document.querySelectorAll('.note-card').forEach((c) => {
        c.classList.toggle('active', c.dataset.note === id);
      });
    }
    if (prevId !== id) dom.editor.querySelector('.editor-scroll').scrollTop = 0;
  }

  /** 元信息下沉到状态栏，编辑器顶部只留标题，减少一行视觉噪声 */
  function renderMeta(note) {
    const el = $('footMeta');
    if (!el) return;
    el.textContent = `创建 ${fullTime(note.createdAt).slice(0, 10)} · 更新 ${relTime(note.updatedAt)}`;
  }

  function renderPreview(content) {
    const html = MD.toHtml(content);
    dom.preview.innerHTML = html || '<p class="md-empty">暂无内容，开始输入吧…</p>';
  }

  function updateCounts(content) {
    const c = countWords(content);
    dom.wordCount.textContent = `${c.words} 字`;
    dom.lineCount.textContent = `${c.lines} 行`;
  }

  function setMode(mode) {
    s.ui.editorMode = mode;
    dom.body.dataset.mode = mode;
    document.querySelectorAll('#viewSeg button').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === mode);
    });
    Store.save();
    if (mode !== 'edit') renderPreview(dom.content.value);
  }

  function markSaving() {
    dom.saveState.classList.add('saving');
    dom.saveState.classList.remove('error');
    dom.saveText.textContent = '正在保存…';
  }

  function markSaved() {
    dom.saveState.classList.remove('saving', 'error');
    dom.saveText.textContent = '已保存到本机';
  }

  /**
   * 正文高度自适应。
   *
   * 这里绝对不能再用 `height='auto'` 去「探」内容高度：那一下会让输入框塌成
   * 两行高，外层 .editor-scroll 的 scrollHeight 骤减，浏览器顺手把 scrollTop
   * 夹到 0 —— 长文档滚到中段打字，视口就直接弹回开头；输入法上屏时布局连续
   * 抖动还会把组合输入打断（表现成失焦）。
   *
   * 改为「只增高不塌缩」：内容溢出时 scrollHeight 就是真实内容高度；想收缩
   * 得显式调 relax（失焦 / 切笔记时才做），且中途把滚动位置原样放回去。
   */
  function autoGrow(relax) {
    const t = dom.content;
    if (!t || dom.editor.hidden) return;
    const box = t.closest('.editor-scroll');

    /* 正文下方那段空白也要落在输入框里：点上去浏览器才知道该把光标放哪，
       否则 mousedown 落在容器上，光标会留在上一次的位置。 */
    let room = 420;
    if (box) {
      const br = box.getBoundingClientRect();
      const tr = t.getBoundingClientRect();
      room = Math.max(room, Math.round(br.height - (tr.top - br.top) - 4));
    }

    if (!relax) {
      /* 输入过程中的常态：只增不减。
         注意不能写成「取 scrollHeight」——高度刚好等于内容高度时
         scrollHeight === clientHeight，看不出内容到底多高，那样会误判成
         内容变矮而把高度缩回可视区，长文档就被塞进输入框内部滚动了。
         高度只涨不跌也不会夹 scrollTop，所以这里完全不碰滚动位置。 */
      const cur = parseFloat(t.style.height) || 0;
      let target = Math.max(room, cur);
      if (t.scrollHeight > t.clientHeight + 2) target = Math.max(target, t.scrollHeight);
      if (Math.abs(target - cur) >= 1) t.style.height = target + 'px';
      return;
    }

    /* 收缩只在「没人正在打字」时做（失焦 / 切笔记）：这时才允许塌一下量真实
       内容高度，量完立刻长回去，并把滚动位置原样放回，避免视口跳到开头。 */
    const keepBox = box ? box.scrollTop : 0;
    const keepTa = t.scrollTop;
    t.style.height = 'auto';
    const target = Math.max(room, t.scrollHeight);
    t.style.height = target + 'px';
    if (box && box.scrollTop !== keepBox) box.scrollTop = keepBox;
    if (t.scrollTop !== keepTa) t.scrollTop = keepTa;
  }

  function scheduleSave() {
    if (!currentId) return;
    markSaving();
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (s.ui.editorMode !== 'edit') renderPreview(dom.content.value);
    }, 160);

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(commitSave, 480);
  }

  function commitSave() {
    if (!currentId) return;
    const note = Store.getNote(currentId);
    if (!note) return;
    Store.updateNote(currentId, {
      title: dom.title.value.trim() || '无标题笔记',
      content: dom.content.value
    });
    renderMeta(note);
    renderSidebar();
    renderList();
    markSaved();
  }

  /* ═══════════════ 便签同步 / 图片 / AI ═══════════════ */

  /** 三态切换，并回写便签（如果这行来自便签同步区块） */
  function cycleTaskAt(noteId, line) {
    const note = Store.getNote(noteId);
    const raw = note ? (note.content.split('\n')[line] || '') : '';
    const sm = raw.match(/<!--\s*s:([\w-]+)\s*-->/);
    const next = Store.cycleTask(noteId, line);
    if (sm && next && window.StickySync) {
      void StickySync.pushStatus(sm[1], next);
    }
    return next;
  }

  function insertAtCursor(text) {
    const ta = dom.content;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.setRangeText(text, start, end, 'end');
    afterEdit();
  }

  /**
   * 把焦点交回正文输入框（光标留在原处，opt.end 时移到末尾）。
   * 弹窗 / 手写板 / 语音胶囊关闭后都调它，避免焦点落回 body 后键盘输入没反应。
   */
  function focusEditor(opt) {
    if (!currentId || dom.editor.hidden) return false;
    if (s.ui.editorMode === 'preview') return false;
    const ta = dom.content;
    try { ta.focus({ preventScroll: true }); } catch (e) { ta.focus(); }
    if (opt && opt.end) {
      const n = ta.value.length;
      ta.setSelectionRange(n, n);
    }
    return document.activeElement === ta;
  }

  /**
   * 正文区「点哪都能输入」：编辑器里的左右留白、正文末尾下方的空白都不是
   * textarea，点上去焦点会掉到 body，接着敲键盘就等于没输入。这里在
   * mousedown 阶段拦下来，直接把焦点交给正文输入框（并阻止默认的失焦）。
   *
   * 光标必须跟着点击位置走：之前只要 textarea 已经聚焦就直接 return，
   * 长文档滚到下半段后点正文下方的空白，光标留在上面原来的位置，
   * 接着敲的字就插进了别处（用户看到的「光标跳到其他地方」）。
   */
  const KEEP_FOCUS_SEL = 'input, textarea, select, button, a, label, summary, [contenteditable="true"], .md-preview, .tag-chip, .tag-add, .tb, .notebook-select';

  function focusEditorFromBlank(e) {
    if (e.button !== 0) return;
    if (!currentId || dom.editor.hidden) return;
    if (s.ui.editorMode === 'preview') return;
    const t = e.target;
    if (!t || !t.closest) return;
    if (t !== dom.editor && !dom.editor.contains(t)) return;
    if (t.closest(KEEP_FOCUS_SEL)) return;
    /* 原生滚动条也在元素上派发 mousedown，别把拖动滚动条当成点击留白 */
    const box = t.nodeType === 1 ? t : t.parentElement;
    if (box && box.scrollHeight > box.clientHeight) {
      const br = box.getBoundingClientRect();
      if (e.clientX > br.left + box.clientWidth) return;
    }
    e.preventDefault();
    const ta = dom.content;
    const scrollBox = ta.closest('.editor-scroll');
    focusEditor();

    /* 点击位置 → 正文里的字符位置：用透明镜像层让浏览器自己算。
       直接把光标甩到末尾会在「点正文中间偏下」时插错地方，也会在滚动状态下
       把视口抢回顶部，所以这里做一次几何映射。 */
    const hit = caretFromPoint(ta, e.clientX, e.clientY);
    if (hit) {
      ta.setSelectionRange(hit.offset, hit.offset);
      scrollCaretIntoView(ta, scrollBox, hit.top);
      return;
    }
    /* 兜底：落在正文最后一行之下 = 想接着往下写 */
    const r = ta.getBoundingClientRect();
    if (e.clientY > r.bottom - 2) {
      const n = ta.value.length;
      ta.setSelectionRange(n, n);
      scrollCaretIntoView(ta, scrollBox, r.bottom);
    }
  }

  /**
   * 造一个和正文输入框同宽、同字体、同换行规则的透明镜像层，用来做几何测量。
   * 调用方负责在 finally 里 mirror.remove()。
   */
  function makeMirror(ta) {
    const cs = getComputedStyle(ta);
    const rect = ta.getBoundingClientRect();
    const mirror = document.createElement('div');
    const s = mirror.style;
    s.position = 'fixed';
    s.left = rect.left + 'px';
    s.top = rect.top + 'px';
    s.width = ta.clientWidth + 'px';
    s.height = 'auto';
    s.margin = '0';
    s.border = '0';
    s.boxSizing = 'content-box';
    s.paddingTop = cs.paddingTop;
    s.paddingBottom = cs.paddingBottom;
    s.paddingLeft = cs.paddingLeft;
    s.paddingRight = cs.paddingRight;
    s.fontFamily = cs.fontFamily;
    s.fontSize = cs.fontSize;
    s.fontWeight = cs.fontWeight;
    s.fontStyle = cs.fontStyle;
    s.letterSpacing = cs.letterSpacing;
    s.lineHeight = cs.lineHeight;
    s.tabSize = cs.tabSize;
    s.whiteSpace = 'pre-wrap';
    s.overflowWrap = 'break-word';
    s.wordBreak = cs.wordBreak;
    s.color = 'transparent';
    s.background = 'transparent';
    s.pointerEvents = 'none';
    s.zIndex = '-1';
    s.opacity = '0';
    /* 末尾补一个换行：文本最后一行没有换行符时，Range 量不到它的高度 */
    mirror.textContent = (ta.value || '') + '\n';
    document.body.appendChild(mirror);
    return { mirror, node: mirror.firstChild, rect };
  }

  /** 光标所在字符在视口里的 y（镜像层测得，已扣掉输入框自身的内部滚动） */
  function caretViewportTop(ta, offset) {
    if (!ta.value) return ta.getBoundingClientRect().top;
    const { mirror, node, rect } = makeMirror(ta);
    try {
      const range = document.createRange();
      const i = Math.max(0, Math.min(offset, node.length - 1));
      range.setStart(node, i);
      range.setEnd(node, Math.min(i + 1, node.length));
      const r = range.getBoundingClientRect();
      return r.height ? r.top - (ta.scrollTop || 0) : rect.top;
    } catch (e) {
      return null;
    } finally {
      mirror.remove();
    }
  }

  /**
   * 让光标留在可视区里。
   *
   * 输入框高度已经撑满内容，滚动发生在外面那层 .editor-scroll 上，浏览器只在
   * 输入框自己可滚时才自动跟随光标 —— 撑满之后它不会再替外层容器滚动，于是
   * 打到屏幕底部时新字就落到视口外面（看起来还是「光标不跟随」）。所以每次
   * 输入后显式把外层容器滚到光标所在行。
   */
  function ensureCaretVisible() {
    const ta = dom.content;
    if (!ta || dom.editor.hidden || s.ui.editorMode === 'preview') return;
    const box = ta.closest('.editor-scroll');
    if (!box) return;
    const br = box.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const y = caretViewportTop(ta, ta.selectionStart);
    if (y == null) return;
    const pad = lineH * 1.5;
    if (y + lineH > br.bottom - 2) {
      box.scrollTop += Math.ceil(y + lineH - br.bottom + pad);
    } else if (y < br.top + 2) {
      box.scrollTop -= Math.ceil(br.top + pad - y);
    }
  }

  /**
   * 把屏幕坐标映射成 textarea 里的字符偏移：临时造一个和输入框同宽、同字体、
   * 同换行规则的透明镜像 div，用 Range 逐字二分出「这一行、这一个字符」。
   * 返回 { offset, top }（top 是该字符在视口里的 y），算不出来时返回 null。
   */
  function caretFromPoint(ta, clientX, clientY) {
    const value = ta.value;
    const rect = ta.getBoundingClientRect();
    if (!value) return { offset: 0, top: rect.top };
    const { mirror, node } = makeMirror(ta);
    try {
      const range = document.createRange();
      const rectAt = (i) => {
        range.setStart(node, i);
        range.setEnd(node, Math.min(i + 1, node.length));
        const r = range.getBoundingClientRect();
        return r.height ? r : null;
      };
      /* 1) 按 y 二分定位行：找最后一个 top <= clientY 的字符 */
      let lo = 0;
      let hi = value.length - 1;
      let lineStart = 0;
      if (clientY >= rect.top) {
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const r = rectAt(mid);
          if (!r) { hi = mid - 1; continue; }
          if (r.top <= clientY) { lineStart = mid; lo = mid + 1; }
          else hi = mid - 1;
        }
      }
      /* 2) 再在这一行里按 x 找最近的字符 */
      const lineRect = rectAt(lineStart);
      if (!lineRect) return { offset: Math.min(lineStart, value.length), top: rect.top };
      if (clientX <= lineRect.left) return { offset: lineStart, top: lineRect.top };
      let best = lineStart;
      let bestTop = lineRect.top;
      for (let i = lineStart; i < node.length; i += 1) {
        const r = rectAt(i);
        if (!r) break;
        if (r.top > lineRect.top + lineRect.height / 2) break;
        bestTop = r.top;
        if (r.left + r.width / 2 <= clientX) best = Math.min(i + 1, value.length);
        else break;
      }
      return { offset: best, top: bestTop };
    } catch (err) {
      return null;
    } finally {
      mirror.remove();
    }
  }

  /** 让光标那一行落在可视区域里（点在下半屏时不要把视口抢回顶部） */
  function scrollCaretIntoView(ta, scrollBox, caretTop) {
    if (!scrollBox) return;
    const boxRect = scrollBox.getBoundingClientRect();
    const lineH = parseFloat(getComputedStyle(ta).lineHeight) || 24;
    const y = scrollBox.scrollTop + (caretTop - boxRect.top);
    const margin = lineH * 2;
    if (y < scrollBox.scrollTop + 4) {
      scrollBox.scrollTop = Math.max(0, y - margin);
    } else if (y > scrollBox.scrollTop + scrollBox.clientHeight - margin) {
      scrollBox.scrollTop = y - scrollBox.clientHeight + margin;
    }
  }

  /** 从剪贴板 / 拖拽数据里挑出图片文件（包含从资源管理器复制的图片） */
  function pickImageFiles(dt) {
    const out = [];
    if (!dt) return out;
    Array.from(dt.items || []).forEach((i) => {
      if (i.kind === 'file' && i.type && i.type.indexOf('image/') === 0) {
        const f = i.getAsFile();
        if (f) out.push(f);
      }
    });
    if (!out.length) {
      Array.from(dt.files || []).forEach((f) => {
        if (f && f.type && f.type.indexOf('image/') === 0) out.push(f);
      });
    }
    return out;
  }

  function onPaste(e) {
    const dt = e.clipboardData;
    if (!dt) return;
    const files = pickImageFiles(dt);
    if (!files.length) {
      setTimeout(() => { autoGrow(); ensureCaretVisible(); updateCounts(dom.content.value); }, 0);
      return;
    }
    e.preventDefault();
    void handleImageFiles(files);
  }

  /** 图片落盘 → 插入 Markdown → 询问是否用 AI 识别（绝不自动调用） */
  async function handleImageFiles(files) {
    if (!currentId) { toast('先打开一篇笔记再粘贴图片', '!'); return; }
    const added = [];
    for (const file of files) {
      let dataUrl;
      try {
        dataUrl = await AI.fileToDataURL(file, 1600);
      } catch (err) {
        toast('图片处理失败：' + (err && err.message ? err.message : err), '!');
        continue;
      }
      /* 桌面版存到本地磁盘，笔记里只留路径，绝不把 base64 塞进正文 */
      let url = '';
      if (window.NoteBridge && NoteBridge.inShell) {
        const saved = await NoteBridge.saveImage(dataUrl);
        if (saved && saved.url) url = saved.url;
        else { toast('图片保存失败，请检查「附件保存位置」设置', '!'); continue; }
      } else {
        url = dataUrl;
      }
      insertAtCursor(`\n\n![图片](${url})\n`);
      added.push({ url, dataUrl, noteId: currentId });
    }
    if (!added.length) return;
    toast(added.length > 1 ? `已插入 ${added.length} 张图片` : '图片已保存到笔记', '🖼️');
    askImageAI(added);
  }

  /* ── 粘贴后的 AI 询问条 ── */
  let imgAskItems = [];
  let imgAskEl = null;

  function hideImageAsk() {
    imgAskItems = [];
    if (imgAskEl) { imgAskEl.remove(); imgAskEl = null; }
  }

  function askImageAI(items) {
    hideImageAsk();
    imgAskItems = items;
    const pane = dom.editorPane;
    if (!pane) return;
    const first = items[0];
    const officeOk = !!(window.NoteBridge && NoteBridge.officeSupported && NoteBridge.officeSupported());
    const boxHtml = `
      <img class="ia-thumb" src="${esc(first.url)}" alt="">
      <div class="ia-body">
        <b>${items.length > 1 ? `已插入 ${items.length} 张图片` : '图片已保存到这篇笔记'}</b>
        <span>要用 AI 识别图中的文字吗？不点就不上传</span>
      </div>
      <div class="ia-acts">
        <button class="ia-btn ia-yes" data-act="ai">AI 识别</button>
        ${officeOk ? '<button class="ia-btn ia-office" data-act="office">办公网识别</button>' : ''}
        <button class="ia-btn" data-act="skip">不用</button>
      </div>`;
    const box = document.createElement('div');
    box.className = 'img-ask';
    box.innerHTML = boxHtml;
    pane.appendChild(box);
    imgAskEl = box;
    box.querySelector('[data-act="skip"]').onclick = () => {
      hideImageAsk();
      toast('已保留图片，未使用 AI', '✓');
    };
    box.querySelector('[data-act="ai"]').onclick = () => { void runImageAI(); };
    const officeBtn = box.querySelector('[data-act="office"]');
    if (officeBtn) officeBtn.onclick = () => { void startOfficeAI(); };
  }

  /** 把 AI 结果插到对应图片后面（按图片地址定位，用户删掉图片则跳过） */
  function insertAIBlockAfterImage(item, text) {
    const anchor = `![图片](${item.url})`;
    const block = '\n> **AI 识别**\n'
      + text.split('\n').map((l) => (l.trim() ? '> ' + l : '>')).join('\n') + '\n';

    if (item.noteId === currentId && dom.content) {
      const pos = dom.content.value.indexOf(anchor);
      if (pos < 0) return false;
      const lineEnd = dom.content.value.indexOf('\n', pos);
      const at = lineEnd < 0 ? dom.content.value.length : lineEnd + 1;
      dom.content.setRangeText(block, at, at, 'end');
      afterEdit();
      return true;
    }
    const note = Store.getNote(item.noteId);
    if (!note) return false;
    const idx = (note.content || '').indexOf(anchor);
    if (idx < 0) return false;
    const lineEnd = note.content.indexOf('\n', idx);
    const at = lineEnd < 0 ? note.content.length : lineEnd + 1;
    Store.updateNote(note.id, { content: note.content.slice(0, at) + block + note.content.slice(at) });
    return true;
  }

  async function runImageAI() {
    const items = imgAskItems.slice();
    hideImageAsk();
    if (!items.length) return;
    const cfg = await AI.getConfig();
    if (!AI.isReady(cfg)) {
      toast('先配置 AI 模型：设置 → AI 模型', '⚙');
      return;
    }
    let ok = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      dom.saveState.classList.add('saving');
      dom.saveText.textContent = items.length > 1
        ? `正在识别图片 ${i + 1}/${items.length}…`
        : '正在识别图片…';
      try {
        const text = await AI.describeImage(it.dataUrl);
        if (!text) { toast('这张图片没有识别到文字', '!'); continue; }
        if (insertAIBlockAfterImage(it, text)) ok++;
      } catch (err) {
        toast('图片识别失败：' + (err && err.message ? err.message : err), '!');
        break;
      }
    }
    markSaved();
    if (ok) toast(ok > 1 ? `${ok} 张图片已识别并写入笔记` : 'AI 识别结果已插入图片下方', '✨');
  }

  /* ── 办公网识别（内网 AI 工作台）：剪贴板接力 + 三步引导 ──
     办公电脑连不上外部模型时，识别在内网 AI 工作台网页上完成：
     ① 工具把图片复制进剪贴板并唤起工作台窗口；
     ② 你在窗口里 Ctrl+V 发送，等识别完成后复制回复文字；
     ③ 回笔记点「回填」，结果自动插到图片下方。 */
  let officeItems = [];
  let officeIdx = 0;
  let officeEl = null;

  function hideOfficeFlow() {
    officeItems = [];
    officeIdx = 0;
    if (officeEl) { officeEl.remove(); officeEl = null; }
  }

  function officeStepHtml() {
    const total = officeItems.length;
    const prog = total > 1 ? `（第 ${officeIdx + 1}/${total} 张）` : '';
    return `
      <div class="of-steps">
        <div class="of-step done"><i>1</i><span>图片已复制到剪贴板，工作台窗口已打开</span></div>
        <div class="of-step"><i>2</i><span>在「办公 AI 工作台」窗口里按 <b>Ctrl+V</b> 粘贴图片，发送「提取图片中的文字」，等识别完成后<b>复制回复文字</b></span></div>
        <div class="of-step"><i>3</i><span>回到这里点「回填识别结果」${prog}</span></div>
      </div>`;
  }

  function renderOfficeFlow() {
    if (!officeEl) return;
    const cur = officeItems[officeIdx];
    if (!cur) { hideOfficeFlow(); return; }
    const total = officeItems.length;
    const multi = total > 1;
    officeEl.innerHTML = `
      ${cur.url ? `<img class="ia-thumb" src="${esc(cur.url)}" alt="">` : ''}
      <div class="ia-body">
        <b>办公网识别进行中${total > 1 ? `（第 ${officeIdx + 1}/${total} 张）` : ''}</b>
        ${officeStepHtml()}
      </div>
      <div class="ia-acts">
        <button class="ia-btn" data-act="recopy">重新复制图片</button>
        <button class="ia-btn ia-yes" data-act="fill">回填识别结果</button>
        ${multi ? '<button class="ia-btn" data-act="next">跳过这张</button>' : ''}
        <button class="ia-btn" data-act="close">收起</button>
      </div>`;
    officeEl.querySelector('[data-act="recopy"]').onclick = () => { void recopyOffice(); };
    officeEl.querySelector('[data-act="fill"]').onclick = () => { void finishOfficeAI(); };
    const nextBtn = officeEl.querySelector('[data-act="next"]');
    if (nextBtn) nextBtn.onclick = () => { void advanceOffice(); };
    officeEl.querySelector('[data-act="close"]').onclick = () => {
      hideOfficeFlow();
      toast('已收起，图片仍在笔记里', '✓');
    };
  }

  function showOfficeFlow() {
    const pane = dom.editorPane;
    if (!pane) return;
    if (!officeEl) {
      officeEl = document.createElement('div');
      officeEl.className = 'img-ask of-flow';
      pane.appendChild(officeEl);
    }
    renderOfficeFlow();
    /* 收起再展开时确保可见 */
    try { officeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { /* ignore */ }
  }

  async function prepareOfficeItem() {
    const cur = officeItems[officeIdx];
    if (!cur) return false;
    const r = await NoteBridge.officePrepare(cur.dataUrl);
    if (!r || r.ok === false) {
      /* 主进程已经弹窗说明原因（域名解析 / 超时 / 证书）并关掉了空白窗口 */
      toast('打不开办公 AI 工作台：' + ((r && r.error) || '网络不通'), '!');
      return false;
    }
    return true;
  }

  /** 询问条「办公网识别」入口：自动执行优先，失败降级三步手动 */
  async function startOfficeAI() {
    const items = imgAskItems.slice();
    if (!items.length) return;
    if (!(window.NoteBridge && NoteBridge.officeSupported && NoteBridge.officeSupported())) {
      toast('办公网识别要在桌面管家的笔记窗口里使用', '!');
      return;
    }
    hideImageAsk();
    officeItems = items;
    officeIdx = 0;
    if (NoteBridge.officeAutoSupported && NoteBridge.officeAutoSupported()) {
      void officeAutoQueue();
      return;
    }
    if (!await prepareOfficeItem()) return;
    showOfficeFlow();
  }

  async function recopyOffice() {
    if (!officeItems.length) return;
    if (await prepareOfficeItem()) toast('图片已重新复制，切到工作台粘贴即可', '📋');
  }

  /** 多张图片时跳到下一张并自动复制 */
  async function advanceOffice() {
    if (officeIdx + 1 >= officeItems.length) { hideOfficeFlow(); return; }
    officeIdx += 1;
    if (await prepareOfficeItem()) showOfficeFlow();
  }

  /** 第三步：读剪贴板文本，插到当前这张图片下方 */
  async function finishOfficeAI() {
    const it = officeItems[officeIdx];
    if (!it) { hideOfficeFlow(); return; }
    const r = await NoteBridge.officeRead();
    if (!r || r.ok === false) {
      toast((r && r.error) || '没有读到识别结果', '!');
      return;
    }
    if (!insertAIBlockAfterImage(it, r.text)) {
      toast('在笔记里找不到这张图片了，结果没有写入', '!');
      return;
    }
    markSaved();
    toast(`识别结果已插入图片下方${officeItems.length > 1 ? `（${officeIdx + 1}/${officeItems.length}）` : ''}`, '✨');
    if (officeIdx + 1 < officeItems.length) {
      officeIdx += 1;
      if (await prepareOfficeItem()) showOfficeFlow();
      return;
    }
    /* 最后一张也回填完了，工作台窗口关掉 */
    if (window.NoteBridge && NoteBridge.officeClose) {
      try { NoteBridge.officeClose(); } catch (e) { /* ignore */ }
    }
    hideOfficeFlow();
  }

  /* ═══════════════ 办公网技能注册表 ═══════════════
   * 内网工作台没有 API，所有技能共用同一条自动链路：
   *   buildPrep(ctx) → 准备注入内容（图片 / 提示词 / 音频文件）
   *   apply(text, ctx) → 把工作台返回的文本回填到笔记
   * 引擎在主进程（officeAI.ts）：粘贴 → 发送 → 轮询读回复；失败降级手动。
   * 新增技能（如会议纪要、代码评审）只需要 registerOfficeSkill 一条，
   * 自动执行 UI、取消、降级逻辑全部复用，不用碰引擎。 */
  const OFFICE_SKILLS = {};

  function registerOfficeSkill(id, def) { OFFICE_SKILLS[id] = def; }

  registerOfficeSkill('image-ocr', {
    title: '图片识别',
    /* 队列逐张复用同一个工作台窗口，跑完最后一张由 officeAutoQueue 统一关闭 */
    autoClose: false,
    buildPrep(ctx) { return { type: 'image', dataUrl: ctx.item.dataUrl }; },
    async apply(text, ctx) {
      if (!text || !text.trim()) throw new Error('工作台没有返回文字');
      if (!insertAIBlockAfterImage(ctx.item, text.trim())) throw new Error('在笔记里找不到这张图片了');
      markSaved();
      return '识别结果已插入图片下方';
    }
  });

  registerOfficeSkill('summary', {
    title: '工作总结',
    buildPrep(ctx) {
      const p = AI.prepareSummary(ctx.opts);
      return { type: 'text', text: p.prompt };
    },
    async apply(text, ctx) {
      if (!text || !text.trim()) throw new Error('工作台没有返回内容');
      return AI.applySummaryResult(ctx.opts, text.trim());
    }
  });

  /**
   * 统一自动执行器。
   * hooks = { ctx, stage(text), fallback(err), onDone(desc) }
   * stage: 更新进度文案；fallback: 降级（含手动接力）；onDone: 成功收口。
   * 返回 true=成功回填；false=已降级/失败，调用方不用再管。
   */
  async function officeAutoRun(skill, prep, hooks) {
    if (!(window.NoteBridge && NoteBridge.officeAutoSupported && NoteBridge.officeAutoSupported())) {
      hooks.fallback({ manual: true, error: '当前版本不支持自动执行' });
      return false;
    }
    let sec = 0;
    const t = setInterval(() => { sec += 1; hooks.stage(`${skill.title}已发送，等待工作台回复…（${sec} 秒，可点取消转手动）`); }, 1000);
    const r = await NoteBridge.officeAuto(prep);
    clearInterval(t);
    if (r && r.ok) {
      try {
        const desc = await skill.apply(r.text, hooks);
        /* 回填成功：关掉工作台窗口（图片队列标记 autoClose=false，跑完统一关） */
        if (skill.autoClose !== false && window.NoteBridge && NoteBridge.officeClose) {
          try { NoteBridge.officeClose(); } catch (e) { /* ignore */ }
        }
        hooks.onDone(desc);
        return true;
      } catch (err) {
        hooks.fallback({ manual: true, error: '回填失败：' + ((err && err.message) || err) });
        return false;
      }
    }
    hooks.fallback(r || { error: '自动执行失败' });
    return false;
  }

  /** 图片任务：自动执行整队（多张逐张接力），失败降级现有三步手动 */
  async function officeAutoQueue() {
    const skill = OFFICE_SKILLS['image-ocr'];
    while (officeIdx < officeItems.length) {
      const cur = officeItems[officeIdx];
      const total = officeItems.length;
      if (!officeEl) {
        const pane = dom.editorPane;
        if (!pane) return;
        officeEl = document.createElement('div');
        officeEl.className = 'img-ask of-flow';
        pane.appendChild(officeEl);
      }
      const el = officeEl;
      el.innerHTML = `
        ${cur.url ? `<img class="ia-thumb" src="${esc(cur.url)}" alt="">` : ''}
        <div class="ia-body">
          <b>办公网自动识别中${total > 1 ? `（第 ${officeIdx + 1}/${total} 张）` : ''}</b>
          <div class="of-auto"><span class="of-spin"></span><span id="ofAutoStage">正在打开工作台并粘贴图片…</span></div>
        </div>
        <div class="ia-acts">
          <button class="ia-btn" data-act="cancel">取消（转手动）</button>
        </div>`;
      el.querySelector('[data-act="cancel"]').onclick = () => { void NoteBridge.officeAutoCancel(); };
      const stage = (t) => {
        const s = el.querySelector('#ofAutoStage');
        if (s) s.textContent = t;
      };
      let done = false;
      const ok = await officeAutoRun(skill, skill.buildPrep({ item: cur }), {
        stage,
        onDone(desc) {
          done = true;
          toast(`${desc}${total > 1 ? `（${officeIdx + 1}/${total}）` : ''}`, '✨');
        },
        fallback(err) {
          /* 降级：窗口保持打开，切回三步手动接力 */
          void (async () => {
            if (err && err.error) toast(err.error, err.manual ? 'ℹ' : '!');
            if (err && err.manual) {
              if (await prepareOfficeItem()) showOfficeFlow();
            } else {
              hideOfficeFlow();
            }
          })();
        }
      });
      if (!ok) return; /* fallback 已接管 */
      officeIdx += 1;
    }
    /* 队列全部成功：工作台窗口已经没用了，关掉 */
    if (window.NoteBridge && NoteBridge.officeClose) {
      try { NoteBridge.officeClose(); } catch (e) { /* ignore */ }
    }
    hideOfficeFlow();
  }

  /** 拖拽图片进来也走同一条链路 */
  function bindEditorDrop() {
    const pane = dom.editorPane;
    if (!pane) return;
    pane.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes('Files')) return;
      e.preventDefault();
      pane.classList.add('drop-hot');
    });
    pane.addEventListener('dragleave', (e) => {
      if (e.target === pane) pane.classList.remove('drop-hot');
    });
    pane.addEventListener('drop', (e) => {
      const files = pickImageFiles(e.dataTransfer);
      pane.classList.remove('drop-hot');
      if (!files.length) return;
      e.preventDefault();
      void handleImageFiles(files);
    });
  }

  async function openAISettings() {
    const cfg = await AI.getConfig();
    const site = (window.NoteBridge && NoteBridge.officeGetSite)
      ? ((await NoteBridge.officeGetSite()) || {})
      : {};
    const opts = Object.keys(AI.PRESETS).map((k) => {
      const p = AI.PRESETS[k];
      return `<option value="${k}"${cfg.provider === k ? ' selected' : ''}>${p.label}</option>`;
    }).join('');

    openModal(`
      <div class="modal-head">
        <div><h3>AI 模型</h3><p>用于图片识别与周报 / 月报自动总结，兼容 OpenAI Chat Completions 协议</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field">
            <label>服务商</label>
            <select id="aiProvider">${opts}</select>
            <div class="hint" id="aiHint"></div>
          </div>
          <div class="field">
            <label>对话模型</label>
            <select id="aiModel"></select>
            <input type="text" id="aiModelCustom" placeholder="填写模型 ID" style="margin-top:6px" hidden>
          </div>
        </div>
        <div class="field">
          <label>接口地址（Base URL）</label>
          <input type="text" id="aiBase" value="${esc(cfg.baseUrl)}" placeholder="https://api.openai.com/v1">
        </div>
        <div class="field">
          <label>API Key</label>
          <input type="password" id="aiKey" value="" placeholder="${cfg.hasApiKey ? '已配置（留空保持不变，输入新 Key 可覆盖）' : 'sk-…（本地 Ollama 可留空）'}">
          <div class="hint">Key 由桌面管家加密保存在本机配置目录，不会随笔记备份导出</div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>图片识别模型（视觉模型）</label>
            <input type="text" id="aiVision" value="${esc(cfg.visionModel)}" placeholder="gpt-4o-mini / qwen-vl-max">
          </div>
          <div class="field">
            <label>温度（0–1，越低越稳定）</label>
            <input type="text" id="aiTemp" value="${cfg.temperature}" placeholder="0.4">
          </div>
        </div>
        <div class="ai-sect">语音输入转文字</div>
        <div class="field-row">
          <div class="field">
            <label>语音识别服务</label>
            <select id="asrProvider">
              ${Object.keys(AI.ASR_PRESETS).map((k) => `<option value="${k}"${(cfg.asrProvider || 'siliconflow') === k ? ' selected' : ''}>${AI.ASR_PRESETS[k].label}</option>`).join('')}
            </select>
            <div class="hint" id="asrHint"></div>
          </div>
          <div class="field">
            <label>识别模型</label>
            <input type="text" id="asrModel" value="${esc(cfg.asrModel || '')}" placeholder="FunAudioLLM/SenseVoiceSmall">
          </div>
        </div>
        <div class="field">
          <label>识别接口地址（Base URL）</label>
          <input type="text" id="asrBase" value="${esc(cfg.asrBaseUrl || '')}" placeholder="https://api.siliconflow.cn/v1">
        </div>
        <div class="field">
          <label>识别 API Key（留空则复用上面的 Key）</label>
          <input type="password" id="asrKey" value="" placeholder="${cfg.hasAsrKey ? '已配置（留空保持不变）' : (cfg.hasApiKey ? '已复用主 Key（留空保持不变）' : 'sk-…')}">
        </div>
        <div class="ai-note">
          <span class="ain-ic">🎙️</span>
          <span>语音输入会先录音，再调用这里的服务转成文字；服务需要兼容 POST /audio/transcriptions。留空或失败时，录音会作为附件插入笔记。</span>
        </div>
        <div class="ai-note">
          <span class="ain-ic">🖼️</span>
          <span>粘贴图片只做本地保存。每次插入后会给一个提示条，由你决定要不要用 AI 识别（识别会把图片发给上面的模型服务）。办公网连不上外部模型时，用「办公网识别」走内网 AI 工作台。</span>
        </div>
        <div class="ai-sect">办公网识别（内网 AI 工作台）</div>
        <div class="field">
          <label>工作台地址</label>
          <input type="text" id="officeUrl" value="${esc(cfg.officeUrl || '')}" placeholder="http://内网工作台地址">
          <div class="hint">粘贴图片后点「办公网识别」即可全自动：图片自动粘贴进工作台并发送，回复自动读回插入笔记。登录态会记在应用里，不用每次重登。自动失败时会自动退回手动三步接力。</div>
        </div>
        <div class="field">
          <details class="of-site">
            <summary>站点适配器（自动识别高级设置）</summary>
            <div class="of-site-grid">
              <label>输入框选择器<textarea id="officeInputSel" rows="2" placeholder="留空自动探测 textarea / contenteditable">${esc(site.inputSel || '')}</textarea></label>
              <label>发送按钮选择器<textarea id="officeSendSel" rows="2" placeholder="留空按「发送/send/提交」文字探测">${esc(site.sendSel || '')}</textarea></label>
              <label>回复区选择器<textarea id="officeRespSel" rows="2" placeholder="留空用整页文本差分启发式">${esc(site.responseSel || '')}</textarea></label>
              <label>图片任务发送指令<input type="text" id="officeImagePrompt" value="${esc(site.imagePrompt || '提取图片中的文字')}"></label>
              <label>回答起始标记<input type="text" id="officeStartMark" value="${esc(site.resultStartText || '')}" placeholder="如：执行完成（留空 = 不裁）"></label>
              <label>回答结束标记<input type="text" id="officeEndMark" value="${esc(site.resultEndText || '')}" placeholder="如：以上内容由AI工作室…生成（留空 = 不裁）"></label>
              <label>等回复超时（秒）<input type="number" id="officeTimeout" min="15" max="900" value="${Math.round((site.resultTimeoutMs || 180000) / 1000)}"></label>
            </div>
            <div class="hint">工作台页面结构特殊、自动识别不准时，在这里填 CSS 选择器。回答起止标记用来从整页文本里截出回答正文（取「起始标记」之后、「结束标记」之前的内容），生成结果带出页面按钮文案时调它。查看方法：工作台窗口里右键 → 检查（如果被禁用则按 F12）。改完保存后生效。</div>
          </details>
        </div>
        <div class="ai-status" id="aiStatus"></div>
      </div>
      <div class="modal-foot">
        <div class="left"><button class="btn btn-ghost btn-sm" id="btnAITest">测试连接</button></div>
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="btnAISave">保存配置</button>
      </div>`, { size: 'mid' });

    /* 模型下拉：列出该服务商的常用模型，最后一个选项切到自由输入 */
    const fillModels = (key, current) => {
      const p = AI.PRESETS[key] || AI.PRESETS.custom;
      const list = (p.models || []).slice();
      const sel = $('aiModel');
      const box = $('aiModelCustom');
      const known = list.some((m) => m.id === current);
      sel.innerHTML = list
        .map((m) => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('')
        + '<option value="__custom__">自定义模型…</option>';
      sel.value = known ? current : '__custom__';
      box.hidden = known;
      box.value = known ? '' : (current || '');
    };
    const pickModel = () => ($('aiModel').value === '__custom__'
      ? $('aiModelCustom').value.trim()
      : $('aiModel').value);

    const setPreset = (key, preferModel) => {
      const p = AI.PRESETS[key] || AI.PRESETS.custom;
      if (key !== 'custom') {
        $('aiBase').value = p.baseUrl;
        $('aiVision').value = p.visionModel;
      }
      fillModels(key, preferModel || p.model);
      $('aiHint').textContent = p.hint || '';
    };
    setPreset($('aiProvider').value, cfg.model);
    $('aiProvider').onchange = () => setPreset($('aiProvider').value);
    $('aiModel').onchange = () => {
      const isCustom = $('aiModel').value === '__custom__';
      $('aiModelCustom').hidden = !isCustom;
      if (isCustom) $('aiModelCustom').focus();
    };

    /* 语音识别服务：切换时带出对应的地址与模型 */
    const setAsrPreset = (key) => {
      const p = AI.ASR_PRESETS[key] || AI.ASR_PRESETS.custom;
      if (key !== 'custom') {
        $('asrBase').value = p.baseUrl;
        $('asrModel').value = p.model;
      }
      $('asrHint').textContent = p.hint || '';
    };
    const asrP0 = AI.ASR_PRESETS[$('asrProvider').value] || AI.ASR_PRESETS.custom;
    $('asrHint').textContent = asrP0.hint || '';
    $('asrProvider').onchange = () => setAsrPreset($('asrProvider').value);

    $('btnAISave').onclick = async () => {
      const model = pickModel();
      if (!model) { toast('请选择或填写模型', '⚠'); return; }
      await AI.setConfig({
        provider: $('aiProvider').value,
        baseUrl: $('aiBase').value.trim(),
        apiKey: $('aiKey').value.trim(),
        model,
        visionModel: $('aiVision').value.trim(),
        temperature: Math.min(1, Math.max(0, parseFloat($('aiTemp').value) || 0.4)),
        asrProvider: $('asrProvider').value,
        asrBaseUrl: $('asrBase').value.trim(),
        asrModel: $('asrModel').value.trim(),
        asrApiKey: $('asrKey').value.trim(),
        officeUrl: $('officeUrl').value.trim(),
        enabled: true
      });
      /* 站点适配器（仅壳模式有写入通道）：选择器/指令/超时单独落盘 */
      if (window.NoteBridge && NoteBridge.officeSetSite) {
        try {
          await NoteBridge.officeSetSite({
            inputSel: $('officeInputSel').value.trim(),
            sendSel: $('officeSendSel').value.trim(),
            responseSel: $('officeRespSel').value.trim(),
            imagePrompt: $('officeImagePrompt').value.trim() || '提取图片中的文字',
            resultStartText: $('officeStartMark').value.trim(),
            resultEndText: $('officeEndMark').value.trim(),
            resultTimeoutMs: Math.max(15, Math.min(900, parseInt($('officeTimeout').value, 10) || 180)) * 1000
          });
        } catch (e) { /* 非壳环境忽略 */ }
      }
      closeModal();
      renderSidebar();
      toast('AI 配置已保存', '✓');
    };

    $('btnAITest').onclick = async () => {
      const box = $('aiStatus');
      const btn = $('btnAITest');
      const model = pickModel();
      if (!model) { toast('请选择或填写模型', '⚠'); return; }
      box.className = 'ai-status';
      box.textContent = '正在连接…';
      btn.disabled = true;
      await AI.setConfig({
        provider: $('aiProvider').value,
        baseUrl: $('aiBase').value.trim(),
        apiKey: $('aiKey').value.trim(),
        model,
        visionModel: $('aiVision').value.trim(),
        temperature: Math.min(1, Math.max(0, parseFloat($('aiTemp').value) || 0.4))
      });
      try {
        const reply = await AI.testConnection();
        box.className = 'ai-status ok';
        box.textContent = '连接成功，模型回复：' + reply.slice(0, 40);
      } catch (err) {
        box.className = 'ai-status err';
        box.textContent = '连接失败：' + (err && err.message ? err.message : err);
      } finally {
        btn.disabled = false;
      }
    };
  }

  async function openAISummary(initialKind) {
    const cfg = await AI.getConfig();
    const modelReady = AI.isReady(cfg);
    const officeOk = !!(window.NoteBridge && NoteBridge.officeTextSupported && NoteBridge.officeTextSupported());
    if (!modelReady && !officeOk) {
      toast('先配置一个 AI 模型，再生成总结', '✨');
      openAISettings();
      return;
    }

    const nbChecks = s.notebooks.map((b) => `
      <label class="chk-pill">
        <input type="checkbox" value="${b.id}" checked>
        <span>${esc(b.name)}</span>
      </label>`).join('');

    openModal(`
      <div class="modal-head">
        <div><h3>AI 工作总结</h3><p>周报 / 月报汇总笔记，年报基于「每月总结」里的月报</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>时间范围</label>
          <div class="range-tabs" id="aiRange">
            <button data-range="thisWeek" class="active">本周</button>
            <button data-range="lastWeek">上周</button>
            <button data-range="thisMonth">本月</button>
            <button data-range="lastMonth">上月</button>
            <button data-range="last7">最近 7 天</button>
            <button data-range="thisYear">本年</button>
            <button data-range="lastYear">去年</button>
          </div>
          <div class="hint" id="aiRangeInfo"></div>
        </div>
        <div class="field">
          <label>包含的笔记本</label>
          <div class="chk-pills" id="aiNbs">${nbChecks}</div>
          <div class="hint" id="aiNbsHint"></div>
        </div>
        <div class="field">
          <label>额外要求（可选）</label>
          <textarea id="aiExtra" style="min-height:70px;font-family:inherit" placeholder="例如：重点写埋点方案落地情况，语气正式一些"></textarea>
        </div>
        <div class="ai-status" id="aiSumStatus"></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close">取消</button>
        ${officeOk ? '<button class="btn btn-ghost" id="btnAIOffice">办公网生成</button>' : ''}
        <button class="btn btn-primary" id="btnAIGo">开始生成</button>
      </div>`, { size: 'mid' });

    let kind = 'thisWeek';
    const selectedNbs = () => Array.from(document.querySelectorAll('#aiNbs input:checked')).map((x) => x.value);
    const isYear = () => kind === 'thisYear' || kind === 'lastYear';

    const refreshInfo = () => {
      const range = AI.rangeOf(kind);
      const go = $('btnAIGo');
      if (isYear()) {
        const ms = AI.monthlyNotes(range.year);
        const months = Array.from(new Set(ms.map((x) => x.month))).sort((a, b) => a - b);
        $('aiRangeInfo').textContent = `${range.label} · 已收录 ${months.length}/12 份月报` +
          (months.length ? `（${months.join('、')} 月）` : '');
        $('aiNbsHint').textContent = months.length
          ? '年度总结只使用「每月总结」中的月报，上面勾选不生效；缺失月份会自动标注'
          : '还没有月报：先去「每月总结」用月度模板或 AI 生成月报，再来汇总年报';
        $('aiNbs').style.opacity = '.45';
        $('aiNbs').style.pointerEvents = 'none';
        go.disabled = !modelReady || months.length === 0;
        go.textContent = !modelReady
          ? '未配置模型（可用办公网生成）'
          : months.length === 12 ? '生成年度总结' : `用 ${months.length} 份月报生成`;
        return;
      }
      const list = AI.collectNotes(range, selectedNbs());
      $('aiRangeInfo').textContent = `${range.label} · 将分析 ${list.length} 篇笔记`;
      $('aiNbsHint').textContent = '';
      $('aiNbs').style.opacity = '';
      $('aiNbs').style.pointerEvents = '';
      go.disabled = !modelReady || list.length === 0;
      go.textContent = !modelReady ? '未配置模型（可用办公网生成）' : '开始生成';
    };
    refreshInfo();

    document.querySelectorAll('#aiRange button').forEach((b) => {
      b.onclick = () => {
        kind = b.dataset.range;
        document.querySelectorAll('#aiRange button').forEach((x) => x.classList.toggle('active', x === b));
        refreshInfo();
      };
    });
    $('aiNbs').onchange = refreshInfo;

    // 支持 ?aisum=thisYear / DM_AI_PANEL 直达某个页签（需在绑定完成后触发）
    if (initialKind) {
      const b0 = document.querySelector(`#aiRange button[data-range="${initialKind}"]`);
      if (b0) b0.click();
    }

    $('btnAIGo').onclick = async () => {
      const btn = $('btnAIGo');
      const box = $('aiSumStatus');
      btn.disabled = true;
      btn.textContent = '生成中…';
      box.className = 'ai-status';
      box.textContent = isYear()
        ? '正在逐月读取月报并提炼年度主线，通常需要 30–90 秒…'
        : '正在阅读笔记并整理结构，通常需要 20–60 秒…';
      try {
        const result = await AI.summarize({
          kind,
          notebookIds: selectedNbs(),
          extra: $('aiExtra').value.trim()
        });
        closeModal();
        renderSidebar();
        renderList();
        openNote(result.note.id);
        if (isYear()) {
          toast(
            result.missing && result.missing.length
              ? `已生成年度总结，${result.missing.join('、')} 缺失`
              : `已用 ${result.count} 份月报生成年度总结`,
            '🏆'
          );
        } else {
          toast(`已根据 ${result.count} 篇笔记生成总结`, '✨');
        }
      } catch (err) {
        box.className = 'ai-status err';
        box.textContent = '生成失败：' + (err && err.message ? err.message : err);
        btn.disabled = false;
        btn.textContent = '重新生成';
      }
    };

    /* 办公网生成：自动执行优先（粘贴→发送→读回复），失败降级三步手动 */
    const officeBtn = $('btnAIOffice');
    if (officeBtn) officeBtn.onclick = async () => {
      const box = $('aiSumStatus');
      const opts = { kind, notebookIds: selectedNbs(), extra: $('aiExtra').value.trim() };
      let prep;
      try {
        prep = AI.prepareSummary(opts);
      } catch (err) {
        box.className = 'ai-status err';
        box.textContent = '准备素材失败：' + (err && err.message ? err.message : err);
        return;
      }
      const go = $('btnAIGo');
      if (go) { go.disabled = true; go.textContent = '办公网生成中…'; }
      const restore = () => {
        officeBtn.disabled = false;
        officeBtn.textContent = '办公网生成';
        if (go) { go.disabled = false; go.textContent = '开始生成'; }
      };
      const ok = await officeAutoRun(OFFICE_SKILLS.summary, { type: 'text', text: prep.prompt }, {
        opts,
        stage: (t) => { box.className = 'ai-status'; box.textContent = t; },
        onDone(result) {
          closeModal();
          renderSidebar();
          renderList();
          openNote(result.note.id);
          const kname = PERIOD_KINDS[result.kind] ? PERIOD_KINDS[result.kind].name : '总结';
          toast(`已用 ${result.count} 篇素材生成${kname}`, '✨');
        },
        fallback: async (err) => {
          restore();
          if (err && err.error) box.textContent = err.error;
          box.className = 'ai-status';
          const r = await NoteBridge.officeCopy(prep.prompt);
          if (!r || r.ok === false) {
            box.className = 'ai-status err';
            box.textContent = '打不开办公 AI 工作台：' + ((r && r.error) || '网络不通');
            return;
          }
          if (go) { go.disabled = true; go.textContent = '已完成办公网生成'; }
          mountOfficeSummaryGuide(box, prep, opts, r.url || '', (result) => {
            closeModal();
            renderSidebar();
            renderList();
            openNote(result.note.id);
            const kname = PERIOD_KINDS[result.kind] ? PERIOD_KINDS[result.kind].name : '总结';
            toast(`已用 ${result.count} 篇素材生成${kname}`, '✨');
          });
        }
      });
      if (ok) officeBtn.disabled = false;
    };
  }

  /* ═══════════════ 工作总结（选取时间段生成） ═══════════════ */
  const PERIOD_KINDS = {
    week: { name: '周报', nb: '每周总结' },
    month: { name: '月报', nb: '每月总结' },
    quarter: { name: '季度总结', nb: '季度总结' },
    year: { name: '年度总结', nb: '年度总结' }
  };

  /** 计算某个类型的本周期 / 上一周期起止（本地日期，yyyy-mm-dd） */
  function periodBounds(kind, offset) {
    const off = offset || 0;
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    let s;
    let e;
    if (kind === 'week') {
      s = new Date(y, m, now.getDate());
      s.setDate(s.getDate() - ((s.getDay() + 6) % 7) + off * 7);
      e = new Date(s);
      e.setDate(e.getDate() + 6);
    } else if (kind === 'month') {
      s = new Date(y, m + off, 1);
      e = new Date(y, m + off + 1, 0);
    } else if (kind === 'quarter') {
      const q = Math.floor(m / 3) + off;
      s = new Date(y, q * 3, 1);
      e = new Date(y, q * 3 + 3, 0);
    } else {
      s = new Date(y + off, 0, 1);
      e = new Date(y + off, 11, 31);
    }
    const f = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { start: f(s), end: f(e) };
  }

  function openPeriodSummary() {
    AI.getConfig().then((cfg) => {
      const modelReady = AI.isReady(cfg);
      const officeOk = !!(window.NoteBridge && NoteBridge.officeTextSupported && NoteBridge.officeTextSupported());
      /* 办公电脑连不上外部模型时，仍然要能进这个弹窗走「办公网生成」 */
      if (!modelReady && !officeOk) {
        toast('先配置一个 AI 模型，再生成总结', '✨');
        openAISettings();
        return;
      }

      openModal(`
        <div class="modal-head">
          <div><h3>生成工作总结</h3><p>选取时间段，把这段时间的工作记录整理成周 / 月 / 季 / 年总结</p></div>
          <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
        </div>
        <div class="modal-body">
          ${modelReady ? '' : `<div class="ai-note"><span class="ain-ic">🏢</span><span>未配置外部模型：可以用「办公网生成」，把整理好的提示词粘到内网 AI 工作台，生成后把结果贴回来。</span></div>`}
          <div class="field">
            <label>总结类型</label>
            <div class="range-tabs" id="pkTabs">
              <button data-pkind="week" class="active">周报</button>
              <button data-pkind="month">月报</button>
              <button data-pkind="quarter">季度总结</button>
              <button data-pkind="year">年度总结</button>
            </div>
          </div>
          <div class="field">
            <label>时间段</label>
            <div class="date-range">
              <input type="date" id="pkStart">
              <span class="dr-sep">至</span>
              <input type="date" id="pkEnd">
            </div>
            <div class="dr-quick">
              <button type="button" data-po="0" class="active">本周期</button>
              <button type="button" data-po="-1">上一周期</button>
            </div>
            <div class="hint" id="pkInfo"></div>
          </div>
          <div class="field">
            <label>总结模板</label>
            <select id="pkTpl">
              <option value="">默认模板（按总结类型自动选择结构）</option>
              ${summaryTemplates().map((t) => `<option value="${t.id}">${esc(t.icon || '📄')} ${esc(t.name)}${t.builtin ? '' : '（自定义）'}</option>`).join('')}
            </select>
            <div class="hint" id="pkTplHint">默认模板按类型给出通用章节；选具体模板则按该模板的章节与表格结构生成</div>
          </div>
          <div class="field">
            <label>额外要求（可选）</label>
            <textarea id="pkExtra" style="min-height:64px;font-family:inherit" placeholder="例如：重点写埋点方案落地和数据，语气正式一些"></textarea>
          </div>
          <div class="ai-status" id="pkStatus"></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-action="close">取消</button>
          ${officeOk ? '<button class="btn btn-ghost" id="pkOffice">办公网生成</button>' : ''}
          <button class="btn btn-primary" id="pkGo">开始生成</button>
        </div>`, { size: 'mid' });

      let pkind = 'week';
      const fillDates = (off) => {
        const b = periodBounds(pkind, off);
        $('pkStart').value = b.start;
        $('pkEnd').value = b.end;
      };
      fillDates(0);

      const currentRange = () => AI.rangeFromDates($('pkStart').value, $('pkEnd').value, pkind);

      const refresh = () => {
        const go = $('pkGo');
        let range;
        try {
          range = currentRange();
        } catch (err) {
          $('pkInfo').textContent = String(err.message || err);
          go.disabled = true;
          return;
        }
        const list = AI.collectNotes(range, null);
        const isYear = pkind === 'year';
        const months = isYear ? AI.monthlyNotes(range.year).length : 0;
        $('pkInfo').textContent = `${range.label} · 将分析 ${list.length} 篇笔记` +
          (isYear ? `（该年度已有 ${months} 份月报，年报会优先用月报汇总）` : '');
        go.disabled = !modelReady || list.length === 0;
        go.textContent = !modelReady
          ? '未配置模型'
          : list.length ? `生成${PERIOD_KINDS[pkind].name}` : '该时间段没有笔记';
      };
      refresh();

      document.querySelectorAll('#pkTabs button').forEach((b) => {
        b.onclick = () => {
          pkind = b.dataset.pkind;
          document.querySelectorAll('#pkTabs button').forEach((x) => x.classList.toggle('active', x === b));
          /* 已选的是别的类型的内置模板 → 回到默认模板，避免周报模板套月报 */
          const cur = $('pkTpl');
          const tplKind = TPL_KIND[cur.value];
          if (tplKind && tplKind !== pkind) {
            cur.value = '';
            updateTplHint();
          }
          fillDates(0);
          document.querySelectorAll('.dr-quick button').forEach((x) => x.classList.toggle('active', x.dataset.po === '0'));
          refresh();
        };
      });

      /* 模板选择：给出说明，并允许「默认模板」 */
      const updateTplHint = () => {
        const id = $('pkTpl').value;
        const t = id ? allTemplates().find((x) => x.id === id) : null;
        $('pkTplHint').textContent = t
          ? `${t.desc || t.name} · 生成时按这个模板的章节与表格结构填充`
          : '默认模板：按总结类型自动套用「概览 / 明细 / 问题与风险 / 下期计划」结构';
      };
      $('pkTpl').onchange = updateTplHint;
      updateTplHint();
      document.querySelectorAll('.dr-quick button').forEach((b) => {
        b.onclick = () => {
          document.querySelectorAll('.dr-quick button').forEach((x) => x.classList.toggle('active', x === b));
          fillDates(Number(b.dataset.po));
          refresh();
        };
      });
      $('pkStart').onchange = refresh;
      $('pkEnd').onchange = refresh;

      /* 统一的生成参数：直连模型与办公网生成共用，避免两条路口径不一致 */
      const collectOpts = () => {
        const range = currentRange();
        const tplId = $('pkTpl').value;
        const tplDef = tplId ? allTemplates().find((x) => x.id === tplId) : null;
        const template = tplDef
          ? { id: tplDef.id, name: tplDef.name, content: TPL.render(tplDef.content || '', tplVarsFor(range)) }
          : null;
        return { range, extra: $('pkExtra').value.trim(), template };
      };

      const finishSummary = (result) => {
        closeModal();
        /* 生成结果放在「工作总结」组下，自动展开并打开 */
        Store.setNotebookExpanded('nb-summary', true);
        Store.setUI({ view: 'notebook', notebookId: result.note.notebookId, tagId: null });
        renderSidebar();
        renderList();
        openNote(result.note.id);
        toast(`已生成${PERIOD_KINDS[result.kind || 'week'].name}，共 ${result.count} 篇素材`, '✨');
      };

      $('pkGo').onclick = async () => {
        const btn = $('pkGo');
        const box = $('pkStatus');
        let opts;
        try { opts = collectOpts(); } catch (err) { box.className = 'ai-status err'; box.textContent = err.message; return; }
        btn.disabled = true;
        btn.textContent = '生成中…';
        box.className = 'ai-status';
        /* 长文本总结可能跑 1–3 分钟：给一个走动的秒数，避免误以为卡死 */
        const started = Date.now();
        const tick = () => {
          const sec = Math.round((Date.now() - started) / 1000);
          box.textContent = `正在阅读这段时间的记录并整理结构，已等待 ${sec} 秒` +
            (sec >= 45 ? '（季度 / 年度素材较多，通常需要 1–3 分钟）' : '') + '…';
        };
        tick();
        const timer = setInterval(tick, 1000);
        try {
          const result = await AI.summarize(opts);
          clearInterval(timer);
          finishSummary(result);
        } catch (err) {
          clearInterval(timer);
          box.className = 'ai-status err';
          box.textContent = '生成失败：' + (err && err.message ? err.message : err);
          btn.disabled = false;
          btn.textContent = '重新生成';
        }
      };

      /* ── 办公网生成：自动执行优先（粘贴→发送→读回复），失败降级三步手动 ── */
      const officeBtn = $('pkOffice');
      if (officeBtn) officeBtn.onclick = async () => {
        const box = $('pkStatus');
        let opts;
        try { opts = collectOpts(); } catch (err) { box.className = 'ai-status err'; box.textContent = err.message; return; }
        let prep;
        try {
          prep = AI.prepareSummary(opts);
        } catch (err) {
          box.className = 'ai-status err';
          box.textContent = '准备素材失败：' + (err && err.message ? err.message : err);
          return;
        }

        const go = $('pkGo');
        const restore = () => {
          officeBtn.disabled = false;
          officeBtn.textContent = '办公网生成';
          if (go) { go.disabled = false; go.textContent = '开始生成'; }
        };
        const ok = await officeAutoRun(OFFICE_SKILLS.summary, { type: 'text', text: prep.prompt }, {
          opts,
          stage: (t) => { box.className = 'ai-status'; box.textContent = t; },
          onDone: finishSummary,
          fallback: async (err) => {
            restore();
            if (err && err.error && !err.manual) {
              box.className = 'ai-status err';
              box.textContent = err.error;
              return;
            }
            if (err && err.error) box.textContent = err.error;
            box.className = 'ai-status';
            const r = await NoteBridge.officeCopy(prep.prompt);
            if (!r || r.ok === false) {
              box.className = 'ai-status err';
              box.textContent = '打不开办公 AI 工作台：' + ((r && r.error) || '网络不通');
              return;
            }
            showOfficeGuide(prep, opts, r.url || '');
          }
        });
        if (ok) officeBtn.disabled = false;
      };

      function showOfficeGuide(prep, opts, url) {
        mountOfficeSummaryGuide($('pkStatus'), prep, opts, url, finishSummary);
        const go = $('pkGo');
        if (go) { go.disabled = true; go.textContent = '已完成办公网生成'; }
      }
    });
  }

  /**
   * 办公网生成的三步引导（各总结弹窗共用）。
   * 提示词已经复制进剪贴板、工作台窗口已打开；
   * 用户在工作台里生成并复制结果后，点「读取结果并生成」把正文变成笔记。
   */
  function mountOfficeSummaryGuide(box, prep, opts, url, onDone) {
    if (!box) return;
    const kChars = Math.max(1, Math.round(prep.chars / 1000));
    box.className = 'ai-status of-guide';
    box.innerHTML = `
      <div class="of-steps">
        <div class="of-step done"><i>1</i><span>提示词已复制到剪贴板（约 ${kChars}k 字，含 ${prep.count} 篇素材），工作台窗口已打开</span></div>
        <div class="of-step"><i>2</i><span>在「办公 AI 工作台」里新建对话，按 <b>Ctrl+V</b> 粘贴后发送，等它输出完整总结</span></div>
        <div class="of-step"><i>3</i><span>把回复<b>整段复制</b>，回到这里点「读取结果并生成」</span></div>
      </div>
      <div class="of-acts">
        <button class="btn btn-ghost" id="ofRecopy">重新复制提示词</button>
        <button class="btn btn-primary" id="ofFill">读取结果并生成</button>
      </div>
      ${url ? `<div class="of-url">工作台：${esc(url)}</div>` : ''}
      ${prep.chars > 30000 ? `<div class="of-url">提示词较长（约 ${kChars}k 字）。如果工作台提示内容超长，把时间范围改小一些，或先按月生成。</div>` : ''}`;

    $('ofRecopy').onclick = async () => {
      const rr = await NoteBridge.officeCopy(prep.prompt);
      if (!rr || rr.ok === false) toast('复制失败：' + ((rr && rr.error) || '未知错误'), '!');
      else toast('提示词已重新复制，切到工作台粘贴即可', '📋');
    };

    $('ofFill').onclick = async () => {
      const rr = await NoteBridge.officeReadText();
      if (!rr || rr.ok === false) { toast((rr && rr.error) || '没有读到生成结果', '!'); return; }
      const text = String(rr.text || '').trim();
      if (!text) { toast('剪贴板是空的', '!'); return; }
      /* 防止把提示词本身当成结果贴回笔记 */
      if (text === String(prep.prompt || '').trim()) {
        toast('剪贴板里还是提示词本身，请先在工作台里生成并复制结果', '!');
        return;
      }
      let result;
      try {
        result = AI.applySummaryResult(opts, text);
      } catch (err) {
        toast('生成笔记失败：' + (err && err.message ? err.message : err), '!');
        return;
      }
      /* 结果已成功回填：工作台窗口用完了，关掉 */
      if (window.NoteBridge && NoteBridge.officeClose) {
        try { NoteBridge.officeClose(); } catch (e) { /* ignore */ }
      }
      onDone(result);
    };
  }

  /* ═══════════════ 模板 ═══════════════ */
  function allTemplates() {
    return TPL.builtins.concat(s.templates || []);
  }

  function tplVars() {
    return Object.assign({ author: '我' }, TPL.buildVars());
  }

  /** 按某个时间段渲染模板变量（总结模板里的周/月/季/年要对齐所选区间） */
  function tplVarsFor(range) {
    const mid = range ? Math.round((range.start + range.end) / 2) : Date.now();
    return Object.assign({ author: '我' }, TPL.buildVars(mid));
  }

  /** 可选的总结模板：周报 / 月报 / 季报 / 年报等总结类模板 */
  function summaryTemplates() {
    return allTemplates().filter((t) => {
      if (t.category !== 'summary') return false;
      return /总结|周报|月报|季报|年报/.test(String(t.name || '')) ||
        /总结/.test(String(t.notebook || ''));
    });
  }

  /** 内置总结模板与总结类型的对应关系（切换类型时自动跟随） */
  const TPL_KIND = {
    'tpl-weekly': 'week',
    'tpl-monthly': 'month',
    'tpl-quarterly': 'quarter',
    'tpl-yearly': 'year'
  };

  function templateTitle(tpl, rendered) {
    const m = String(rendered || '').match(/^\s*#\s+(.+)$/m);
    if (m) return m[1].trim().slice(0, 60);
    return TPL.render(tpl.name, tplVars());
  }

  /**
   * 用模板在指定笔记本里建笔记；同标题（例如「2026-11-04 工作日志」）
   * 已存在时直接复用，避免一天出现两篇同名日志。
   */
  function makeNoteFromTemplate(tpl, nbId) {
    const vars = tplVars();
    const rendered = TPL.render(tpl.content || '', vars);
    const title = templateTitle(tpl, rendered);
    const exist = s.notes.find((n) => !n.deletedAt && n.notebookId === nbId && n.title === title);
    if (exist) return { note: exist, reused: true };
    const note = Store.createNote({
      notebookId: nbId,
      title,
      content: stripFirstHeading(rendered),
      templateId: tpl.id
    });
    return { note, reused: false };
  }

  function stripFirstHeading(md) {
    return String(md || '').replace(/^\s*#\s+.*(?:\n+|$)/, '');
  }

  function notebookIdByName(name) {
    const found = s.notebooks.find((b) => b.name === name);
    if (found) return found.id;
    const colors = NB_COLORS;
    return Store.addNotebook(name, colors[s.notebooks.length % colors.length]).id;
  }

  /** 笔记本属于某个分组时，自动展开分组（否则侧栏看不到选中的子笔记本） */
  function revealNotebook(nbId) {
    const nb = Store.notebookOf(nbId);
    if (nb && nb.parentId) Store.setNotebookExpanded(nb.parentId, true);
  }

  function createFromTemplate(tpl) {
    const nbId = notebookIdByName(tpl.notebook || (s.notebooks[0] && s.notebooks[0].name) || '每日工作');
    const { note, reused } = makeNoteFromTemplate(tpl, nbId);
    /* 在某个标签下新建时，自动带上这个标签（tags 存名称） */
    const tagId = s.ui.view === 'tag' ? s.ui.tagId : null;
    const tagName = tagId ? Store.tagName(tagId) : null;
    if (tagName && !(note.tags || []).includes(tagName)) {
      Store.updateNote(note.id, { tags: [...(note.tags || []), tagName] });
    }
    revealNotebook(nbId);
    closeModal();
    renderAll();
    openNote(note.id, { focus: reused ? null : 'title' });
    toast(reused ? '这个时间段已有同名笔记，已打开' : `已用「${tpl.name}」创建笔记`, reused ? '📌' : '📝');
  }

  /**
   * 随手记：按「类型 + 子类」建笔记。
   * 类型绑定默认模板与笔记本，用户还能临时换模板或空白开始。
   */
  function createFromKind(kind, sub, opts) {
    if (!kind) return null;
    const o = opts || {};
    const tplId = o.blank ? null : (o.templateId != null ? o.templateId : ((sub && sub.templateId) || kind.templateId));
    const tpl = tplId ? allTemplates().find((t) => t.id === tplId) : null;
    let nbId = (sub && sub.notebookId) || kind.notebookId || '';
    if (!Store.notebookOf(nbId)) {
      const byName = s.notebooks.find((b) => b.name === (nbId === 'nb-daily' ? '每日工作' : '') );
      nbId = (byName && byName.id) || (s.notebooks[0] && s.notebooks[0].id);
    }
    const dedupe = o.dedupe !== false &&
      ['kind-daily', 'kind-mood', 'kind-todo', 'kind-summary'].includes(kind.id);

    let note = null;
    let reused = false;
    if (tpl) {
      const rendered = TPL.render(tpl.content || '', tplVars());
      const title = templateTitle(tpl, rendered);
      if (dedupe) {
        const exist = s.notes.find((n) => !n.deletedAt && n.notebookId === nbId && n.title === title);
        if (exist) { note = exist; reused = true; }
      }
      if (!note) {
        note = Store.createNote({
          notebookId: nbId,
          title,
          content: stripFirstHeading(rendered),
          templateId: tpl.id,
          kindId: kind.id,
          kindSubId: sub ? sub.id : null
        });
      }
    } else {
      note = Store.createNote({ notebookId: nbId, title: '无标题笔记', content: '', kindId: kind.id });
    }

    let content = note.content || '';
    if (o.body && o.body.trim()) content += (content ? '\n\n' : '') + o.body.trim();
    if (Array.isArray(o.attachments) && o.attachments.length) {
      content += (content ? '\n\n' : '') + o.attachments.join('\n\n') + '\n';
    }
    Store.updateNote(note.id, {
      title: (o.title && o.title.trim()) || note.title,
      content,
      kindId: kind.id,
      kindSubId: sub ? sub.id : null,
      templateId: tpl ? tpl.id : null
    }, { touch: false });

    Store.setUI({
      view: 'lookup', search: '', kindId: null,
      notebookId: null, tagId: null, activeNoteId: note.id
    });
    renderAll();
    openNote(note.id, { focus: o.focus || (reused ? null : 'title') });
    toast(reused ? '今天已有同名笔记，已打开继续写' : `已开始记录「${kind.name}」`, reused ? '📌' : kind.icon || '📝');
    return { note, reused };
  }

  function openTemplates() {
    if (!tplState.selected) tplState.selected = TPL.builtins[0].id;
    const html = `
      <div class="modal-head">
        <div>
          <h3>模板库</h3>
          <p>选一个模板，日期、星期、周次会自动填入当天</p>
        </div>
        <button class="modal-close" data-action="close" aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="tpl-layout">
        <div class="tpl-side">
          <div class="tpl-filter">
            <button data-filter="all" class="active">全部</button>
            <button data-filter="dev">项目研发</button>
            <button data-filter="log">日志</button>
            <button data-filter="summary">总结</button>
            <button data-filter="meeting">会议</button>
            <button data-filter="ops">运维</button>
            <button data-filter="biz">业务</button>
            <button data-filter="other">其他</button>
            <button data-filter="custom">自定义</button>
          </div>
          <div class="tpl-items" id="tplItems"></div>
          <div style="padding:8px 12px 12px;border-top:1px solid var(--line)">
            <button class="btn btn-ghost btn-sm" id="btnNewTpl" style="width:100%">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
              新建自定义模板
            </button>
          </div>
        </div>
        <div class="tpl-preview-wrap">
          <div class="tpl-preview-head" id="tplPreviewHead"></div>
          <div class="tpl-preview" id="tplPreview"></div>
        </div>
      </div>
      <div class="modal-foot">
        <div class="left">
          <button class="btn btn-ghost btn-sm" id="btnTplEdit" hidden>编辑模板</button>
          <button class="btn btn-ghost btn-sm" id="btnTplDel" hidden>删除</button>
        </div>
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="btnTplUse">用此模板新建</button>
      </div>`;
    openModal(html, { size: 'wide' });
    renderTplItems();
  }

  function renderTplItems() {
    const box = $('tplItems');
    if (!box) return;
    let list = allTemplates();
    if (tplState.filter === 'custom') list = list.filter((t) => !t.builtin);
    else if (tplState.filter !== 'all') list = list.filter((t) => t.category === tplState.filter);

    if (!list.length) {
      tplState.selected = null;
      box.innerHTML = `<div style="padding:24px 12px;color:var(--text-4);font-size:12.4px;text-align:center;line-height:1.9">
        还没有自定义模板<br>点下方按钮创建，或把已有笔记存为模板
      </div>`;
      $('tplPreview').innerHTML = '<div class="md-preview"><p class="md-empty">选择一个模板查看预览</p></div>';
      $('tplPreviewHead').innerHTML = '<div class="tph-title">模板库</div>';
      $('btnTplEdit').hidden = true;
      $('btnTplDel').hidden = true;
      return;
    }

    if (!list.some((t) => t.id === tplState.selected)) tplState.selected = list[0].id;

    box.innerHTML = list.map((t) => `
      <div class="tpl-item${t.id === tplState.selected ? ' active' : ''}" data-tpl="${t.id}">
        <div class="tpl-ic">${t.icon || '📄'}</div>
        <div class="tpl-info">
          <div class="tpl-name">${esc(t.name)}${t.builtin ? '' : '<span class="badge-custom">自定义</span>'}</div>
          <div class="tpl-desc">${esc(t.desc || '')}</div>
        </div>
      </div>`).join('');

    document.querySelectorAll('.tpl-filter button').forEach((b) => {
      b.classList.toggle('active', b.dataset.filter === tplState.filter);
    });
    renderTplPreview();
  }

  function renderTplPreview() {
    const tpl = allTemplates().find((t) => t.id === tplState.selected);
    if (!tpl) return;
    const vars = tplVars();
    const html = MD.toHtml(TPL.render(tpl.content || '', vars)) || '<p class="md-empty">空白模板</p>';
    $('tplPreviewHead').innerHTML = `
      <div class="tph-title"><span>${tpl.icon || '📄'}</span>${esc(tpl.name)}
        <span class="tph-sub">· 归入「${esc(tpl.notebook || '每日工作')}」</span>
      </div>
      <span class="tph-sub">变量预览</span>`;
    $('tplPreview').innerHTML = `<div class="md-preview">${html}</div>`;
    $('btnTplEdit').hidden = !!tpl.builtin;
    $('btnTplDel').hidden = !!tpl.builtin;
  }

  function openTemplateEditor(tpl) {
    const isNew = !tpl;
    const t = tpl || { name: '', icon: '📝', desc: '', notebook: '每日工作', content: '', category: 'other' };
    const options = s.notebooks.map((b) => `<option value="${esc(b.name)}"${b.name === t.notebook ? ' selected' : ''}>${esc(b.name)}</option>`).join('');
    openModal(`
      <div class="modal-head">
        <div><h3>${isNew ? '新建模板' : '编辑模板'}</h3><p>模板中可以写 {{date}}、{{weekday}}、{{week}} 等变量</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field-row">
          <div class="field">
            <label>模板名称</label>
            <input type="text" id="teName" value="${esc(t.name)}" placeholder="例如：客户拜访记录">
          </div>
          <div class="field">
            <label>图标（emoji）</label>
            <input type="text" id="teIcon" value="${esc(t.icon)}" maxlength="4" placeholder="📝">
          </div>
        </div>
        <div class="field">
          <label>一句话说明</label>
          <input type="text" id="teDesc" value="${esc(t.desc || '')}" placeholder="这个模板用来记录什么">
        </div>
        <div class="field">
          <label>默认归入笔记本</label>
          <select id="teNb">${options}</select>
        </div>
        <div class="field">
          <label>模板正文（Markdown）</label>
          <textarea id="teContent" spellcheck="false">${esc(t.content)}</textarea>
          <div class="hint">可用变量：{{date}} {{date_cn}} {{weekday}} {{week}} {{month_cn}} {{time}} {{datetime}} {{week_range}} — 创建时自动替换</div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="btnTeSave">保存模板</button>
      </div>`, { size: 'mid' });

    $('btnTeSave').onclick = () => {
      const name = $('teName').value.trim();
      if (!name) { toast('请填写模板名称', '!'); $('teName').focus(); return; }
      const data = {
        name,
        icon: $('teIcon').value.trim() || '📝',
        desc: $('teDesc').value.trim(),
        notebook: $('teNb').value,
        content: $('teContent').value,
        category: 'custom',
        builtin: false
      };
      if (isNew) {
        const nt = Object.assign({ id: Store.uid('tpl'), createdAt: Date.now() }, data);
        s.templates.push(nt);
        tplState.selected = nt.id;
        tplState.filter = 'custom';
      } else {
        const idx = s.templates.findIndex((x) => x.id === t.id);
        if (idx >= 0) s.templates[idx] = Object.assign({}, s.templates[idx], data);
        tplState.selected = t.id;
      }
      Store.save(true);
      toast(isNew ? '模板已创建' : '模板已更新', '✓');
      openTemplates();
    };
  }

  /* ═══════════════ 笔记本 / 标签 ═══════════════ */
  const TPL_CATEGORY_LABEL = {
    dev: '项目与研发', log: '日志', summary: '总结', meeting: '会议', ops: '运维与变更', biz: '业务经营', other: '其他', custom: '自定义'
  };

  function templateOptions(selectedId) {
    const groups = {};
    allTemplates().forEach((t) => {
      const k = t.builtin ? (t.category || 'other') : 'custom';
      (groups[k] = groups[k] || []).push(t);
    });
    const order = ['log', 'summary', 'meeting', 'ops', 'biz', 'other', 'custom'];
    return ['<option value="">空白笔记（不使用模板）</option>']
      .concat(order.filter((k) => groups[k]).map((k) => `<optgroup label="${TPL_CATEGORY_LABEL[k] || k}">`
        + groups[k].map((t) => `<option value="${t.id}"${t.id === selectedId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')
        + '</optgroup>'))
      .join('');
  }

  /** 笔记本管理（侧栏不再常驻笔记本树，改从设置进入） */
  function openNotebookManager() {
    const c = Store.counts();
    const rows = s.notebooks.filter((b) => !b.group).map((b) => {
      const parent = b.parentId ? Store.notebookOf(b.parentId) : null;
      const tpl = b.defaultTemplateId === undefined
        ? Store.defaultTemplateOf(b.id)
        : (b.defaultTemplateId || '');
      const t = tpl ? allTemplates().find((x) => x.id === tpl) : null;
      return `<div class="nbm-row" data-nbm="${b.id}">
        <span class="nb-dot" style="background:${b.color}"></span>
        <div class="nbm-main">
          <b>${parent ? `<span class="nbm-parent">${esc(parent.name)} /</span> ` : ''}${esc(b.name)}</b>
          <i>${c.perNotebook[b.id] || 0} 篇 · 默认模板：${t ? esc(t.name) : '空白'}</i>
        </div>
        <button class="btn btn-sm btn-ghost" data-nbm-edit="${b.id}">编辑</button>
      </div>`;
    }).join('');

    openModal(`
      <div class="modal-head">
        <div><h3>笔记本</h3><p>决定笔记归档到哪里；分组笔记本会自动收拢</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="nbm-list">${rows}</div>
      </div>
      <div class="modal-foot">
        <div class="left"><button class="btn btn-sm btn-ghost" id="btnNbNew">＋ 新建笔记本</button></div>
        <button class="btn btn-primary" data-action="close">完成</button>
      </div>`, { size: '' });

    document.querySelectorAll('[data-nbm-edit]').forEach((b) => {
      b.onclick = () => openNotebookEditor(Store.notebookOf(b.dataset.nbmEdit));
    });
    $('btnNbNew').onclick = () => openNotebookEditor(null);
  }

  function openNotebookEditor(nb) {
    const isNew = !nb;
    const b = nb || { name: '', color: NB_COLORS[s.notebooks.length % NB_COLORS.length] };
    const isGroup = !!(b.group || (b.id && Store.notebookKids(b.id).length));
    const curTpl = b.defaultTemplateId !== undefined
      ? b.defaultTemplateId
      : (Store.DEFAULT_TEMPLATES[b.id] || Store.DEFAULT_TEMPLATES[b.name] || '');
    openModal(`
      <div class="modal-head">
        <div><h3>${isNew ? '新建笔记本' : '编辑笔记本'}</h3><p>用笔记本把不同类型的工作分开</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>名称</label>
          <input type="text" id="nbName" value="${esc(b.name)}" placeholder="例如：客户跟进">
        </div>
        <div class="field">
          <label>颜色</label>
          <div id="nbColors" style="display:flex;gap:8px;flex-wrap:wrap">
            ${NB_COLORS.map((c) => `<button data-color="${c}" style="width:26px;height:26px;border-radius:7px;background:${c};border:2px solid ${c === b.color ? 'var(--text)' : 'transparent'};box-shadow:0 0 0 1px var(--line)"></button>`).join('')}
          </div>
        </div>
        ${isGroup ? '' : `<div class="field">
          <label>默认模板</label>
          <select id="nbTpl">${templateOptions(curTpl)}</select>
          <div class="hint">点「新建笔记」时自动套用这个模板；右侧箭头可临时改选其它模板。</div>
        </div>`}
      </div>
      <div class="modal-foot">
        <div class="left">${isNew ? '' : '<button class="btn btn-ghost btn-sm" id="btnNbDel" style="color:var(--danger)">删除笔记本</button>'}</div>
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="btnNbSave">保存</button>
      </div>`, { size: '' });

    let color = b.color;
    document.querySelectorAll('#nbColors button').forEach((btn) => {
      btn.onclick = () => {
        color = btn.dataset.color;
        document.querySelectorAll('#nbColors button').forEach((x) => {
          x.style.borderColor = x.dataset.color === color ? 'var(--text)' : 'transparent';
        });
      };
    });

    $('btnNbSave').onclick = () => {
      const name = $('nbName').value.trim();
      const tplSel = $('nbTpl');
      const tplId = tplSel ? tplSel.value : null;
      if (!name) { toast('请填写名称', '!'); return; }
      if (isNew) {
        const created = Store.addNotebook(name, color);
        if (tplId !== null && tplId !== '') Store.setNotebookDefaultTemplate(created.id, tplId);
        closeModal();
        Store.setUI({ view: 'notebook', notebookId: created.id });
        toast('笔记本已创建', '✓');
      } else {
        Store.renameNotebook(b.id, name, color);
        if (tplId !== null) Store.setNotebookDefaultTemplate(b.id, tplId);
        closeModal();
        toast('已保存', '✓');
      }
      renderAll();
    };

    const delBtn = $('btnNbDel');
    if (delBtn) delBtn.onclick = () => {
      if (s.notebooks.length <= 1) { toast('至少保留一个笔记本', '!'); return; }
      if (Store.notebookKids(b.id).length) { toast('这个笔记本下还有分类，先清理子笔记本', '!'); return; }
      Store.deleteNotebook(b.id);
      closeModal();
      renderAll();
      toast('笔记本已删除，笔记已移到其他笔记本', '🗑️');
    };
  }

  function openTagEditor() {
    openModal(`
      <div class="modal-head">
        <div><h3>新建标签</h3><p>标签可以跨笔记本归类，例如「复盘」「待跟进」</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field">
          <label>标签名称</label>
          <input type="text" id="tagNameInput" placeholder="例如：待跟进">
        </div>
        <div class="field">
          <label>已有标签</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${s.tags.map((t) => `<span class="tag-chip">#${esc(t.name)}<i data-del-tag="${t.id}" style="cursor:pointer;font-style:normal">×</i></span>`).join('') || '<span class="tag-empty">暂无</span>'}
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="btnTagSave">创建</button>
      </div>`, { size: '' });

    $('btnTagSave').onclick = () => {
      const name = $('tagNameInput').value.trim();
      if (!name) return;
      Store.addTag(name);
      closeModal();
      renderSidebar();
      toast('标签已创建', '#');
    };
    document.querySelectorAll('[data-del-tag]').forEach((el) => {
      el.onclick = () => {
        Store.deleteTag(el.dataset.delTag);
        closeModal();
        renderAll();
      };
    });
    setTimeout(() => $('tagNameInput') && $('tagNameInput').focus(), 60);
  }

  /* ═══════════════ 设置 ═══════════════ */
  async function openSettings() {
    const c = Store.counts();
    const kbytes = (Store.storageSize() / 1024).toFixed(1);
    const aiCfg = await AI.getConfig();
    const aiDesc = AI.isReady(aiCfg)
      ? `${AI.PRESETS[aiCfg.provider] ? AI.PRESETS[aiCfg.provider].label : aiCfg.provider} · ${aiCfg.model}`
      : '未配置：配置后可识别图片、自动生成周报月报';
    const inShellNow = !!(window.NoteBridge && NoteBridge.inShell);
    let mediaDir = '';
    if (inShellNow && NoteBridge.mediaDir) {
      try { mediaDir = await NoteBridge.mediaDir(); } catch (e) { mediaDir = ''; }
    }
    openModal(`
      <div class="modal-head">
        <div><h3>设置与数据</h3><p>所有内容保存在这台电脑的浏览器本地存储中</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="stat-grid">
          <div class="stat-card"><b>${c.all}</b><span>篇笔记</span></div>
          <div class="stat-card"><b>${s.notebooks.length}</b><span>个笔记本</span></div>
          <div class="stat-card"><b>${c.track}</b><span>项待办</span></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">随手记类型</div><div class="sr-desc">每种类型绑定默认模板与笔记本，可新增 / 修改</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnManageKinds">管理类型</button></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">模板</div><div class="sr-desc">新增或修改各类笔记的默认结构</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnManageTpl">模板库</button></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">笔记本</div><div class="sr-desc">笔记的归档位置，可以改名 / 调色 / 设默认模板</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnManageNb">管理笔记本</button></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">外观</div><div class="sr-desc">浅色更接近印象笔记，深色适合夜间</div></div>
          <div class="sr-ctrl">
            <button class="btn btn-sm ${document.documentElement.dataset.theme === 'light' ? 'btn-soft' : 'btn-ghost'}" data-theme-set="light">浅色</button>
            <button class="btn btn-sm ${document.documentElement.dataset.theme === 'dark' ? 'btn-soft' : 'btn-ghost'}" data-theme-set="dark">深色</button>
          </div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">AI 模型</div><div class="sr-desc">${esc(aiDesc)}</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnAIConfig">配置模型</button></div>
        </div>
${inShellNow ? `
        <div class="set-row">
          <div>
            <div class="sr-label">附件保存位置</div>
            <div class="sr-desc" id="mediaDirDesc" style="word-break:break-all">${esc(mediaDir || '默认：应用数据目录 / note-media')}</div>
            <div class="sr-desc" style="margin-top:2px;color:var(--text-4)">粘贴的图片、录音、手写都存在这里；换目录只影响之后插入的文件</div>
          </div>
          <div class="sr-ctrl">
            <button class="btn btn-sm btn-ghost" id="btnMediaDirPick">选择目录</button>
            <button class="btn btn-sm btn-ghost" id="btnMediaDirReset">恢复默认</button>
          </div>
        </div>` : ''}

        <div class="set-row">
          <div><div class="sr-label">备份全部数据</div><div class="sr-desc">导出 JSON 文件，可换机导入</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnExportAll">导出备份</button></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">从备份恢复</div><div class="sr-desc">导入会覆盖当前所有笔记，请先导出备份</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnImportAll">选择文件</button></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">存储占用</div><div class="sr-desc">${kbytes} KB / 浏览器上限约 5 MB</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm btn-ghost" id="btnClearTrash">清空回收站</button></div>
        </div>

        <div class="set-row">
          <div><div class="sr-label">重置为示例数据</div><div class="sr-desc">会删除当前全部笔记与模板，操作不可恢复</div></div>
          <div class="sr-ctrl"><button class="btn btn-sm" style="color:var(--danger);border:1px solid var(--line-2)" id="btnReset">重置</button></div>
        </div>

        <div class="set-row" style="display:block">
          <div class="sr-label" style="margin-bottom:6px">快捷键</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;color:var(--text-3)">
            <span>Ctrl N　新建笔记</span><span>Ctrl Shift N　从模板新建</span>
            <span>Ctrl K　搜索</span><span>Ctrl S　立即保存</span>
            <span>Ctrl B / I　加粗 / 斜体</span><span>Ctrl D　收藏</span>
          </div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-primary" data-action="close">完成</button>
      </div>`, { size: 'mid' });

    document.querySelectorAll('[data-theme-set]').forEach((b) => {
      b.onclick = () => {
        const theme = b.dataset.themeSet;
        applyTheme(theme);
        Store.setUI({ theme });
        openSettings();
      };
    });

    $('btnExportAll').onclick = () => {
      download(`归墨备份-${new Date().toISOString().slice(0, 10)}.json`, Store.exportJSON(), 'application/json');
      toast('备份已导出', '⬇️');
    };

    $('btnAIConfig').onclick = () => openAISettings();

    if ($('btnMediaDirPick')) {
      $('btnMediaDirPick').onclick = async () => {
        try {
          const next = await NoteBridge.pickMediaDir(mediaDir);
          if (!next) return;
          mediaDir = next;
          const d = $('mediaDirDesc');
          if (d) d.textContent = next;
          toast('之后的附件会存到新目录', '📁');
        } catch (e) {
          toast('目录设置失败：' + ((e && e.message) || e), '!');
        }
      };
      $('btnMediaDirReset').onclick = async () => {
        try {
          const next = await NoteBridge.setMediaDir('');
          mediaDir = next || '';
          const d = $('mediaDirDesc');
          if (d) d.textContent = mediaDir || '默认：应用数据目录 / note-media';
          toast('已恢复默认目录', '↩');
        } catch (e) {
          toast('恢复失败：' + ((e && e.message) || e), '!');
        }
      };
    }

    if ($('btnManageKinds')) $('btnManageKinds').onclick = () => { if (window.HomeUI) HomeUI.openKindSettings(); };
    if ($('btnManageTpl')) $('btnManageTpl').onclick = () => { closeModal(); openTemplates(); };
    if ($('btnManageNb')) $('btnManageNb').onclick = () => openNotebookManager();

    $('btnImportAll').onclick = () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            Store.importJSON(String(reader.result));
            s = Store.state;
            tplState = { filter: 'all', selected: null };
            applyTheme(Store.state.ui.theme);
            closeModal();
            currentId = null;
            renderAll();
            toast('数据已恢复', '✓');
          } catch (e) {
            toast('导入失败：文件格式不正确', '!');
          }
        };
        reader.readAsText(file);
      };
      input.click();
    };

    $('btnClearTrash').onclick = () => {
      Store.emptyTrash();
      closeModal();
      renderAll();
      toast('回收站已清空', '🗑️');
    };

    $('btnReset').onclick = () => {
      if (!confirm('确定要重置吗？当前所有笔记、模板都会被删除。')) return;
      localStorage.removeItem(Store.KEY);
      location.reload();
    };
  }

  /* ═══════════════ 模态框 ═══════════════ */
  function openModal(html, opts) {
    dom.modalBox.className = 'modal ' + ((opts && opts.size) || '');
    dom.modalBox.innerHTML = html;
    dom.modalRoot.hidden = false;
    dom.modalRoot.querySelectorAll('[data-action="close"]').forEach((b) => { b.onclick = closeModal; });
    dom.modalBox.querySelectorAll('.modal-close').forEach((b) => { b.onclick = closeModal; });
  }

  function closeModal() {
    dom.modalRoot.hidden = true;
    dom.modalBox.innerHTML = '';
    /* 弹窗关掉后把光标还给正文，接着就能打字 */
    setTimeout(() => focusEditor(), 0);
  }

  /* ═══════════════ 菜单 ═══════════════ */
  function closeMenu() {
    if (menuEl) { menuEl.remove(); menuEl = null; }
  }

  function showMenu(anchor, items, point) {
    closeMenu();
    const menu = document.createElement('div');
    menu.className = 'menu';
    menu.innerHTML = items.map((it) => it === '-' ? '<div class="menu-sep"></div>'
      : it.label ? `<div class="menu-label">${esc(it.label)}</div>`
        : `<button data-mi="${it.id}" class="${it.danger ? 'danger' : ''}">${it.icon ? `<span>${it.icon}</span>` : ''}<span>${esc(it.text)}</span></button>`).join('');
    document.body.appendChild(menu);
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left;
    let top;
    if (point) {
      /* 右键：从鼠标位置弹出，超出视口时自动回折 */
      left = Math.min(point.x, window.innerWidth - mw - 10);
      top = point.y + mh > window.innerHeight - 10 ? Math.max(8, point.y - mh) : point.y;
    } else {
      const r = anchor.getBoundingClientRect();
      left = Math.min(r.right - mw, window.innerWidth - mw - 10);
      top = r.bottom + 6;
      if (top + mh > window.innerHeight - 10) top = r.top - mh - 6;
    }
    menu.style.left = Math.max(8, left) + 'px';
    menu.style.top = Math.max(8, top) + 'px';
    menu.querySelectorAll('[data-mi]').forEach((btn) => {
      btn.onclick = () => {
        const it = items.find((x) => x && x.id === btn.dataset.mi);
        closeMenu();
        if (it && it.onClick) it.onClick();
      };
    });
    menuEl = menu;
    setTimeout(() => {
      document.addEventListener('click', onDocClickForMenu, { once: true });
    }, 0);
  }

  function onDocClickForMenu(e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu();
  }

  /** 右上角：设置与工具 */
  function openTopMenu(anchor) {
    const kb = Store.storageSize() / 1024;
    const size = kb > 1024 ? (kb / 1024).toFixed(2) + ' MB' : kb.toFixed(1) + ' KB';
    const go = (view) => {
      Store.setUI({ view, notebookId: null, tagId: null, search: '' });
      renderAll();
    };
    showMenu(anchor, [
      { id: 'settings', icon: '⚙️', text: '设置与数据', onClick: openSettings },
      '-',
      { id: 'vault', icon: '🔐', text: '密码箱', onClick: () => go('vault') },
      { id: 'trash', icon: '🗑️', text: '回收站', onClick: () => go('trash') },
      '-',
      { id: 'size', label: `本地存储 ${size}` }
    ]);
  }

  /* ═══════════════ 操作 ═══════════════ */
  /**
   * 新建笔记：没有主动选模板时，按当前笔记本的类型默认模板创建。
   * 例：每日工作 → 每日工作日志；会议纪要 → 会议纪要（通用）；
   *     每周/每月/季度/年度总结 → 对应的总结模板；每日工作 → 每日工作日志。
   */
  function newNote(opts) {
    const o = opts || {};
    /* 待办视图里，「新建」按钮 = 新建待办（指定笔记本时除外） */
    if (!o.notebookId && s.ui.view === 'track') { openTrackDialog(); return; }
    if (s.ui.view === 'vault') return;

    let nbId = o.notebookId || (s.ui.view === 'notebook' && s.ui.notebookId ? s.ui.notebookId : s.notebooks[0].id);
    /* 分组笔记本（如「工作总结」）不能直接放笔记，落到它的第一个子笔记本 */
    const curNb = Store.notebookOf(nbId);
    if (curNb && (curNb.group || Store.notebookKids(curNb.id).length)) {
      const kid = Store.notebookKids(curNb.id)[0];
      if (kid) nbId = kid.id;
    }

    if (o.notebookId && s.ui.view !== 'notebook') {
      Store.setUI({ view: 'notebook', notebookId: nbId, tagId: null });
    }
    const tplId = o.blank ? null : Store.defaultTemplateOf(nbId);
    const tpl = tplId ? allTemplates().find((t) => t.id === tplId) : null;

    const tagId = s.ui.view === 'tag' ? s.ui.tagId : null;
    /* 笔记上的 tags 存的是标签名（不是 id） */
    const tagName = tagId ? Store.tagName(tagId) : null;

    if (!tpl) {
      const note = Store.createNote({ notebookId: nbId, title: '无标题笔记', content: '', tags: tagName ? [tagName] : [] });
      revealNotebook(nbId);
      renderAll();
      openNote(note.id, { focus: 'title' });
      return;
    }

    const { note, reused } = makeNoteFromTemplate(tpl, nbId);
    if (tagName && !(note.tags || []).includes(tagName)) {
      Store.updateNote(note.id, { tags: [...(note.tags || []), tagName] });
    }
    /* 每日工作：把当天的「事项跟踪」进展表一并写进这篇日志 */
    const nb = Store.notebookOf(nbId);
    if (!reused && nb && (nb.id === 'nb-daily' || nb.name === '每日工作') && window.Track) {
      try { Track.syncDailyNote(Track.dayKey(Date.now())); } catch (e) { /* ignore */ }
    }
    revealNotebook(nbId);
    renderAll();
    openNote(note.id, { focus: reused ? null : 'title' });
    toast(
      reused ? `今天已有「${note.title}」，已为你打开`
        : `已按「${nb ? nb.name : '默认'}」模板创建：${tpl.name}`,
      reused ? '📌' : '📝'
    );
  }

  function moveNote(noteId, nbId) {
    Store.updateNote(noteId, { notebookId: nbId });
    renderAll();
    if (currentId === noteId) {
      renderNotebookSelect(nbId);
      const nb = Store.notebookOf(nbId);
      dom.crumbDot.style.background = nb.color;
      renderMeta(Store.getNote(noteId));
    }
    toast('已移动到「' + (Store.notebookOf(nbId) || {}).name + '」', '📁');
  }

  function saveAsTemplate() {
    const note = Store.getNote(currentId);
    if (!note) return;
    const tpl = {
      id: Store.uid('tpl'),
      name: note.title || '未命名模板',
      icon: '📌',
      desc: '来自笔记「' + (note.title || '无标题') + '」',
      notebook: (Store.notebookOf(note.notebookId) || {}).name || '未归类',
      content: note.content,
      category: 'custom',
      builtin: false,
      createdAt: Date.now()
    };
    s.templates.push(tpl);
    Store.save(true);
    renderAll();
    toast('已存为模板，可在模板库中查看', '📌');
  }

  function exportMarkdown() {
    const note = Store.getNote(currentId);
    if (!note) return;
    download(safeName(note.title) + '.md', `# ${note.title}\n\n${note.content}`, 'text/markdown');
    toast('已导出 Markdown', '⬇️');
  }

  function duplicateNote() {
    const note = Store.getNote(currentId);
    if (!note) return;
    const copy = Store.createNote({
      notebookId: note.notebookId,
      title: note.title + ' 副本',
      content: note.content,
      tags: note.tags.slice()
    });
    renderAll();
    openNote(copy.id);
    toast('已创建副本', '⧉');
  }

  /* ═══════════════ 右键菜单：删除各类笔记 ═══════════════ */

  function purgeNoteWithConfirm(id) {
    const note = Store.getNote(id);
    if (!note) return;
    if (!confirm(`彻底删除「${note.title || '无标题笔记'}」？\n删除后无法恢复，也不会留在回收站。`)) return;
    Store.purgeNote(id);
    renderAll();
    toast('已彻底删除', '🗑️');
  }

  /** 删除待办：同时把涉及日期的进展表同步掉 */
  function deleteTrackWithConfirm(id) {
    const it = Store.trackItem(id);
    if (!it) return;
    if (!confirm(`删除待办「${it.title}」？\n它会同时从「每日工作」的进展表中移除，删除后不可恢复。`)) return;
    const dates = new Set([Track.dayKey(it.createdAt)]);
    (it.progress || []).forEach((p) => dates.add(Track.dayKey(p.at)));
    (it.risks || []).forEach((r) => dates.add(Track.dayKey(r.at)));
    if (it.closedAt) dates.add(Track.dayKey(it.closedAt));
    Store.deleteTrackItem(it.id);
    trackSel = null;
    dates.forEach((d) => Track.syncDailyNote(d));
    renderSidebar();
    renderList();
    toast('待办已删除，相关日期表格已同步', '🗑️');
  }

  /** 待办右键菜单：与笔记右键同一套操作习惯（打开 / 状态 / 截止 / 删除） */
  function openTrackMenu(itemId, point) {
    const it = Store.trackItem(itemId);
    if (!it) return;
    const stText = it.status === 'doing' ? '进行中' : it.status === 'done' ? '已完成' : '未开始';
    const di = dueInfo(it.due);
    const setDue = (due) => {
      Store.updateTrackItem(it.id, { due });
      renderSidebar();
      renderList();
      toast(due ? '截止日期已更新' : '已取消截止日期', '📅');
    };
    const items = [{ label: `待办 · ${stText}${di ? ' · ' + di.text : ''}` }];

    items.push({ id: 'open', icon: '📖', text: '打开详情', onClick: () => { trackSel = itemId; renderList(); } });
    items.push({
      id: 'prog', icon: '✍️', text: '记录进展',
      onClick: () => {
        trackSel = itemId;
        renderList();
        setTimeout(() => { const ta = $('trkAddText'); if (ta) ta.focus(); }, 60);
      }
    });
    items.push('-');
    items.push({ label: '状态' });
    [['todo', '未开始'], ['doing', '进行中'], ['done', '已完成']].forEach(([k, txt]) => {
      items.push({
        id: 'st-' + k,
        icon: it.status === k ? '✅' : '○',
        text: `标记为${txt}`,
        onClick: () => {
          Store.setTrackStatus(it.id, k);
          Track.syncItem(Store.trackItem(it.id));
          pushStickyStatus(Store.trackItem(it.id));
          renderSidebar();
          renderList();
          toast(k === 'done' ? '事项已办结，当日表格已更新' : '状态已更新，当日表格已同步', '✓');
        }
      });
    });
    items.push('-');
    items.push({ label: '截止日期' });
    items.push({ id: 'due-today', icon: '📅', text: '今天到期', onClick: () => setDue(Track.dayKey(Date.now())) });
    items.push({ id: 'due-tomorrow', icon: '📅', text: '明天到期', onClick: () => setDue(Track.dayKey(Date.now() + DAY)) });
    items.push({ id: 'due-week', icon: '📅', text: '一周后', onClick: () => setDue(Track.dayKey(Date.now() + 7 * DAY)) });
    if (it.due) items.push({ id: 'due-clear', icon: '⌫', text: '清除截止日期', onClick: () => setDue(null) });
    items.push('-');
    items.push({
      id: 'del', icon: '🗑️', text: '删除待办', danger: true,
      onClick: () => deleteTrackWithConfirm(it.id)
    });
    showMenu(null, items, point);
  }

  /** 笔记右键菜单（回收站里是恢复 / 彻底删除） */
  function openNoteMenu(noteId, point) {
    const note = Store.getNote(noteId);
    if (!note) return;
    const nb = Store.notebookOf(note.notebookId);
    const items = [];

    if (note.deletedAt) {
      items.push({ label: '回收站 · 已删除笔记' });
      items.push({ id: 'restore', icon: '↩️', text: '恢复这篇笔记', onClick: () => { Store.restoreNote(noteId); renderAll(); toast('已恢复', '↩️'); } });
      items.push('-');
      items.push({ id: 'purge', icon: '🗑️', text: '彻底删除', danger: true, onClick: () => purgeNoteWithConfirm(noteId) });
      showMenu(null, items, point);
      return;
    }

    const movable = s.notebooks.filter((b) => !(b.group || Store.notebookKids(b.id).length));
    items.push({ label: `${nb ? nb.name : '未分类'} · ${relTime(note.updatedAt)}` });
    items.push({ id: 'open', icon: '📖', text: '打开笔记', onClick: () => openNote(noteId) });
    items.push({
      id: 'pin', icon: '📌', text: note.pinned ? '取消置顶' : '置顶',
      onClick: () => { Store.updateNote(noteId, { pinned: !note.pinned }); renderAll(); toast(note.pinned ? '已取消置顶' : '已置顶', '📌'); }
    });
    items.push('-');
    items.push({ id: 'dup', icon: '⧉', text: '创建副本', onClick: () => { openNote(noteId); duplicateNote(); } });
    items.push({ id: 'tpl', icon: '📌', text: '存为模板', onClick: () => { openNote(noteId); saveAsTemplate(); } });
    items.push({ id: 'md', icon: '⬇️', text: '导出 Markdown', onClick: () => { openNote(noteId); exportMarkdown(); } });
    items.push('-');
    items.push({ label: '移动到' });
    movable.forEach((b) => {
      const parent = b.parentId ? Store.notebookOf(b.parentId) : null;
      items.push({
        id: 'mv-' + b.id,
        icon: b.id === note.notebookId ? '✅' : '📁',
        text: (parent ? `└ ${b.name}` : b.name),
        onClick: () => moveNote(noteId, b.id)
      });
    });
    items.push('-');
    items.push({
      id: 'trash', icon: '🗑️', text: '移到回收站', danger: true,
      onClick: () => { Store.trashNote(noteId); renderAll(); toast('已移到回收站，可在回收站恢复', '🗑️'); }
    });
    items.push({
      id: 'purge', icon: '❌', text: '彻底删除（不可恢复）', danger: true,
      onClick: () => purgeNoteWithConfirm(noteId)
    });
    showMenu(null, items, point);
  }

  /** 笔记本右键菜单 */
  function openNotebookMenu(nbId, point) {
    const nb = Store.notebookOf(nbId);
    if (!nb) return;
    const kids = Store.notebookKids(nbId);
    const count = Store.counts().perNotebook[nbId] || 0;
    const isGroup = !!(nb.group || kids.length);
    const items = [{ label: `${nb.name} · ${count} 篇` }];

    if (!isGroup) {
      items.push({
        id: 'new', icon: '📝', text: '新建笔记（默认模板）',
        onClick: () => {
          Store.setUI({ view: 'notebook', notebookId: nbId, tagId: null });
          renderSidebar();
          renderList();
          newNote();
        }
      });
      items.push({
        id: 'blank', icon: '📄', text: '新建空白笔记',
        onClick: () => {
          Store.setUI({ view: 'notebook', notebookId: nbId, tagId: null });
          renderSidebar();
          renderList();
          newNote({ blank: true });
        }
      });
      items.push('-');
    }

    items.push({ id: 'edit', icon: '✏️', text: '编辑笔记本', onClick: () => openNotebookEditor(nb) });
    items.push('-');
    items.push({
      id: 'del', icon: '🗑️', text: '删除笔记本', danger: true,
      onClick: () => {
        if (kids.length) { toast('这个笔记本下还有分类，先清理子笔记本', '!'); return; }
        if (s.notebooks.length <= 1) { toast('至少保留一个笔记本', '!'); return; }
        if (!confirm(`删除笔记本「${nb.name}」？\n其中 ${count} 篇笔记会移动到其它笔记本，不会被删除。`)) return;
        Store.deleteNotebook(nbId);
        renderAll();
        toast('笔记本已删除，笔记已移到其它笔记本', '🗑️');
      }
    });
    showMenu(null, items, point);
  }

  /* ═══════════════ 事件绑定 ═══════════════ */
  function bind() {
    /* 侧栏：视图 / 笔记本 / 标签 */
    const side = $('sidebar');
    if (side) {
      side.onclick = (e) => {
        const caret = e.target.closest('[data-nb-caret]');
        if (caret) {
          const id = caret.dataset.nbCaret;
          const exp = Object.assign({}, s.ui.nbExpanded || {});
          exp[id] = exp[id] !== true;
          Store.setUI({ nbExpanded: exp });
          renderSidebar();
          return;
        }
        /* 切换笔记本 / 标签 / 视图时保留搜索词：搜索可以与当前过滤条件叠加 */
        const nb = e.target.closest('[data-nb]');
        if (nb) {
          Store.setUI({ view: 'notebook', notebookId: nb.dataset.nb, tagId: null });
          renderAll();
          return;
        }
        const tag = e.target.closest('[data-tag]');
        if (tag) {
          Store.setUI({ view: 'tag', tagId: tag.dataset.tag, notebookId: null });
          renderAll();
          return;
        }
        const vb = e.target.closest('[data-view]');
        if (vb) {
          Store.setUI({ view: vb.dataset.view, notebookId: null, tagId: null });
          renderAll();
        }
      };
    }
    const nbManage = $('btnNbManage');
    if (nbManage) {
      nbManage.onclick = (e) => { e.stopPropagation(); openNotebookManager(); };
    }
    const tagManage = $('btnTagManage');
    if (tagManage) {
      tagManage.onclick = (e) => { e.stopPropagation(); openTagEditor(); };
    }
    /* 点空白处收起标签选择浮层（点「＋ 标签」自身不算，由它负责开关） */
    document.addEventListener('click', (e) => {
      if (!tagPopEl) return;
      if (tagPopEl.contains(e.target)) return;
      if (e.target.closest && e.target.closest('#btnNoteTagAdd')) return;
      closeTagPicker();
    });

    const btnSettingsEl = $('btnSettings');
    if (btnSettingsEl) btnSettingsEl.onclick = openSettings;

    if (dom.btnDaySummary) dom.btnDaySummary.onclick = openPeriodSummary;
    $('btnEmptyCapture').onclick = () => newNote();
    const emptyLookup = $('btnEmptyLookup');
    if (emptyLookup) emptyLookup.onclick = () => { if (dom.search) dom.search.focus(); };
    $('btnListNew').onclick = newNote;
    $('btnUseTpl').onclick = openTemplates;

    if (dom.lookupBack) {
      dom.lookupBack.onclick = () => {
        Store.setUI({ view: 'all', search: '' });
        renderAll();
      };
    }
    if (dom.lookupNew) {
      dom.lookupNew.onclick = () => { if (window.HomeUI) HomeUI.openCapture(); };
    }
    if (dom.lookupChips) {
      dom.lookupChips.onclick = (e) => {
        const chip = e.target.closest('[data-lk-kind]');
        if (!chip) return;
        Store.setUI({ kindId: chip.dataset.lkKind === 'all' ? null : chip.dataset.lkKind });
        renderList();
      };
    }
    if (dom.lookupInput) {
      dom.lookupInput.oninput = () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          Store.setUI({ search: dom.lookupInput.value });
          renderList();
        }, 110);
      };
      dom.lookupInput.onkeydown = (e) => {
        if (e.key === 'Escape') {
          dom.lookupInput.value = '';
          Store.setUI({ search: '' });
          renderList();
          dom.lookupInput.blur();
        }
        if (e.key === 'Enter') {
          if (s.ui.kindId === 'kind-todo') {
            const first = sortTrackItems(Store.trackItems().filter((it) => trackMatches(it, s.ui.search)))[0];
            if (first) { trackSel = first.id; renderList(); }
            return;
          }
          const first = Store.filteredNotes()[0];
          if (first) openNote(first.id);
        }
      };
    }

    /* 编辑器工具：手写 / 语音 / 流程图重编辑 */
    const hwBtn = $('btnHandwrite');
    if (hwBtn) hwBtn.onclick = () => { if (window.HomeUI) HomeUI.insertHandwriting(); };
    const flowEditBtn = $('btnFlowEdit');
    if (flowEditBtn) flowEditBtn.onclick = () => { if (window.HomeUI) void HomeUI.editFlowAtCursor(false); };
    const voiceBtn = $('btnVoice');
    if (voiceBtn) voiceBtn.onclick = () => { if (window.HomeUI) HomeUI.insertVoice(); };

    /* 双击图片所在行 = 编辑流程图（普通文本行保持默认选词，不打扰） */
    if (dom.content) {
      dom.content.addEventListener('dblclick', () => {
        if (window.HomeUI) void HomeUI.editFlowAtCursor(true);
      });
    }
    /* 阅读模式里点流程图图片也能重开编辑 */
    if (dom.preview) {
      dom.preview.addEventListener('click', (e) => {
        const img = e.target && e.target.closest ? e.target.closest('img') : null;
        const src = img ? img.getAttribute('src') : '';
        if (src && window.HomeUI) void HomeUI.editFlowByUrl(src, true);
      });
    }

    $('btnTheme').onclick = () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      Store.setUI({ theme: next });
      toast(next === 'dark' ? '已切换到深色' : '已切换到浅色', next === 'dark' ? '🌙' : '☀️');
    };

    const collapseBtn = $('btnCollapse');
    if (collapseBtn) {
      collapseBtn.onclick = () => {
        const collapsed = !dom.app.classList.contains('collapsed');
        dom.app.classList.toggle('collapsed', collapsed);
        Store.setUI({ collapsed });
      };
    }

    /* 全局搜索：在首页 / 密码箱里输入时自动切到「随手查」 */
    if (dom.search) {
      dom.search.oninput = () => {
        const q = dom.search.value;
        if (dom.searchClear) dom.searchClear.hidden = !q;
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (s.ui.view === 'vault') {
            Store.setUI({ view: 'all', kindId: null, notebookId: null, tagId: null, search: q });
            renderAll();
          } else {
            Store.setUI({ search: q });
            renderList();
          }
        }, 110);
      };
      dom.search.onkeydown = (e) => {
        if (e.key === 'Escape') {
          dom.search.value = '';
          Store.setUI({ search: '' });
          renderList();
          dom.search.blur();
        }
        if (e.key === 'Enter') {
          const first = Store.filteredNotes()[0];
          if (first) openNote(first.id);
        }
      };
    }
    if (dom.searchClear) {
      dom.searchClear.onclick = () => {
        dom.search.value = '';
        Store.setUI({ search: '' });
        renderList();
        dom.search.focus();
      };
    }

    dom.sort.onchange = () => {
      Store.setUI({ sort: dom.sort.value });
      renderList();
    };

    /* 笔记列表 */
    dom.noteList.onclick = (e) => {
      /* 事项跟踪：新建事项 */
      /* 点选事项 → 右侧联动显示全生命周期详情 */
      const tline = e.target.closest('.todo-line[data-track-id]');
      if (tline) {
        if (trackSel !== tline.dataset.trackId) {
          trackSel = tline.dataset.trackId;
          renderList();
        }
        return;
      }
      const restore = e.target.closest('[data-restore]');
      if (restore) { Store.restoreNote(restore.dataset.restore); renderAll(); toast('已恢复', '↩️'); return; }
      const purge = e.target.closest('[data-purge]');
      if (purge) {
        if (confirm('彻底删除后无法恢复，确定吗？')) {
          Store.purgeNote(purge.dataset.purge);
          renderAll();
          toast('已彻底删除', '🗑️');
        }
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) { openNote(open.dataset.open); return; }
      const card = e.target.closest('[data-note]');
      if (card) {
        if (s.ui.view === 'trash') return;
        if (card.dataset.note !== currentId) openNote(card.dataset.note);
      }
    };

    dom.noteList.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const tline = e.target.closest('.todo-line[data-track-id]');
      if (!tline) return;
      e.preventDefault();
      trackSel = tline.dataset.trackId;
      renderList();
    };

    /* 右键：任意笔记都能从这里删除（回收站里可恢复或彻底删除） */
    dom.noteList.oncontextmenu = (e) => {
      if (s.ui.view === 'vault') return;
      if (s.ui.view === 'track') {
        const line = e.target.closest('[data-track-id]');
        if (!line) return;
        e.preventDefault();
        trackSel = line.dataset.trackId;
        renderList();
        openTrackMenu(line.dataset.trackId, { x: e.clientX, y: e.clientY });
        return;
      }
      const card = e.target.closest('[data-note]');
      if (!card) return;
      e.preventDefault();
      const id = card.dataset.note;
      if (s.ui.view !== 'trash' && id !== currentId) openNote(id);
      openNoteMenu(id, { x: e.clientX, y: e.clientY });
    };

    /* 事项详情：切换状态 / 记录进展 / 删除 */
    dom.trackDetail.onclick = (e) => {
      const stBtn = e.target.closest('[data-track-set]');
      if (stBtn) {
        if (!trackSel) return;
        Store.setTrackStatus(trackSel, stBtn.dataset.trackSet);
        Track.syncItem(Store.trackItem(trackSel));
        pushStickyStatus(Store.trackItem(trackSel));
        renderSidebar();
        renderList();
        toast(stBtn.dataset.trackSet === 'done' ? '事项已办结，当日表格已更新' : '状态已更新，当日表格已同步', '✓');
        return;
      }
      if (e.target.closest('#trkAddBtn')) { submitTrackProgress(); return; }
      if (e.target.closest('#trkRiskBtn')) { submitTrackRisk(); return; }
      const rBtn = e.target.closest('[data-risk-toggle]');
      if (rBtn) {
        if (!trackSel) return;
        Store.toggleTrackRisk(trackSel, rBtn.dataset.riskToggle);
        Track.syncItem(Store.trackItem(trackSel));
        renderSidebar();
        renderList();
        toast('风险状态已更新，当日表格已同步', '✓');
        return;
      }
    };

    /* 编辑器输入 */
    dom.title.oninput = () => { scheduleSave(); };
    dom.title.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); dom.content.focus(); }
    };
    /* 输入法组合期间（拼音还没上屏）不要动任何布局 / DOM：
       中文靠空格上屏，组合过程中重排会让 Chrome 中断组合，看起来就是「光标没了」。 */
    let composing = false;
    dom.content.addEventListener('compositionstart', () => { composing = true; });
    dom.content.addEventListener('compositionend', () => {
      composing = false;
      autoGrow();
      ensureCaretVisible();
      updateCounts(dom.content.value);
    });
    dom.content.addEventListener('blur', () => { if (!composing) autoGrow(true); });

    dom.content.oninput = () => {
      if (!composing) {
        autoGrow();
        ensureCaretVisible();
      }
      updateCounts(dom.content.value);
      scheduleSave();
    };
    dom.content.onpaste = onPaste;
    /* 正文区留白点击 = 继续输入（不要等到用户精确点中文本框） */
    dom.editor.addEventListener('mousedown', focusEditorFromBlank, true);

    /* 窗口重新获得焦点（从别的窗口 / 桌面切回来）时，如果哪儿都没聚焦就把
       光标还给正文：切回来直接打字即可，不用先点一下输入框。 */
    window.addEventListener('focus', () => {
      if (!currentId || dom.editor.hidden) return;
      if (s.ui.editorMode === 'preview') return;
      const a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return;
      focusEditor({ end: true });
    });

    /* 预览 / 分栏模式下焦点不在输入框，兜底接住粘贴（已在上面处理过的会 preventDefault） */
    document.addEventListener('paste', (e) => {
      if (e.defaultPrevented) return;
      if (!currentId || dom.editor.hidden) return;
      const tag = (e.target && e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const files = pickImageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      void handleImageFiles(files);
    });
    bindEditorDrop();

    /* 编辑器头部 */
    dom.noteNotebook.onchange = () => { if (currentId) moveNote(currentId, dom.noteNotebook.value); };

    document.querySelectorAll('#viewSeg button').forEach((b) => {
      b.onclick = () => {
        setMode(b.dataset.mode);
        if (b.dataset.mode === 'edit') dom.content.focus();
        else if (b.dataset.mode !== 'preview') autoGrow();
      };
    });

    $('btnPin').onclick = () => {
      if (!currentId) return;
      const note = Store.getNote(currentId);
      Store.updateNote(currentId, { pinned: !note.pinned });
      $('btnPin').classList.toggle('on', !note.pinned);
      renderList();
      toast(note.pinned ? '已取消置顶' : '已置顶', '📌');
    };

    $('btnExport').onclick = exportMarkdown;

    $('btnMore').onclick = () => {
      if (!currentId) return;
      showMenu($('btnMore'), [
        { label: '笔记操作' },
        { id: 'tpl', icon: '📌', text: '存为模板', onClick: saveAsTemplate },
        { id: 'dup', icon: '⧉', text: '创建副本', onClick: duplicateNote },
        { id: 'md', icon: '⬇️', text: '导出 Markdown', onClick: exportMarkdown },
        '-',
        { label: '移动到' },
        ...s.notebooks.map((b) => ({ id: 'mv-' + b.id, icon: '📁', text: b.name, onClick: () => moveNote(currentId, b.id) })),
        '-',
        { id: 'del', icon: '🗑️', text: '移到回收站', danger: true, onClick: () => { Store.trashNote(currentId); renderAll(); toast('已移到回收站', '🗑️'); } }
      ]);
    };

    /* 工具栏 */
    document.querySelectorAll('#toolbar .tb[data-md]').forEach((btn) => {
      btn.onclick = () => applyMd(btn.dataset.md);
    });

    /* 复选框（预览区）—— 三态循环，同步回便签 */
    dom.preview.onclick = (e) => {
      const btn = e.target.closest('.task-check');
      if (!btn || !currentId) return;
      e.preventDefault();
      cycleTaskAt(currentId, Number(btn.dataset.line));
      const note = Store.getNote(currentId);
      if (note) {
        dom.content.value = note.content;
        renderPreview(note.content);
        autoGrow();
        updateCounts(note.content);
      }
      renderSidebar();
      renderList();
    };

    /* 模态框关闭 */
    dom.modalRoot.onclick = (e) => {
      if (e.target.dataset.close === '1') closeModal();
    };

    /* 模板库事件（事件委托） */
    dom.modalBox.addEventListener('click', onModalClick);

    /* 快捷键 */
    document.addEventListener('keydown', onKeydown);
  }

  function onModalClick(e) {
    const f = e.target.closest('.tpl-filter button');
    if (f) {
      tplState.filter = f.dataset.filter;
      renderTplItems();
      return;
    }
    const item = e.target.closest('[data-tpl]');
    if (item) {
      tplState.selected = item.dataset.tpl;
      renderTplItems();
      return;
    }
    if (e.target.closest('#btnNewTpl')) { openTemplateEditor(null); return; }
    if (e.target.closest('#btnTplUse')) {
      const tpl = allTemplates().find((t) => t.id === tplState.selected);
      if (tpl) createFromTemplate(tpl);
      return;
    }
    if (e.target.closest('#btnTplEdit')) {
      const tpl = s.templates.find((t) => t.id === tplState.selected);
      if (tpl) openTemplateEditor(tpl);
      return;
    }
    if (e.target.closest('#btnTplDel')) {
      const tpl = s.templates.find((t) => t.id === tplState.selected);
      if (!tpl) return;
      if (!confirm(`删除模板「${tpl.name}」？`)) return;
      s.templates = s.templates.filter((x) => x.id !== tpl.id);
      Store.save(true);
      tplState.selected = null;
      openTemplates();
      toast('模板已删除', '🗑️');
    }
  }

  function applyMd(action) {
    if (!currentId) return;
    const ta = dom.content;
    if (s.ui.editorMode === 'preview') setMode('edit');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    const sel = val.slice(start, end);

    const wrap = (before, after, ph) => {
      const body = sel || ph || '';
      const next = before + body + after;
      ta.setRangeText(next, start, end, 'end');
      if (!sel) {
        ta.selectionStart = start + before.length;
        ta.selectionEnd = start + before.length + body.length;
      }
      afterEdit();
    };

    const prefixLines = (prefix, ph) => {
      const lineStart = val.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = val.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = val.length;
      const block = val.slice(lineStart, lineEnd);
      const lines = block.split('\n').map((l) => (l.trim() ? prefix + l : prefix + (ph || '')));
      ta.setRangeText(lines.join('\n'), lineStart, lineEnd, 'end');
      ta.selectionStart = lineStart + lines.join('\n').length;
      ta.selectionEnd = ta.selectionStart;
      afterEdit();
    };

    const insertBlock = (text) => {
      const needNl = start > 0 && val[start - 1] !== '\n';
      const insert = (needNl ? '\n' : '') + text + '\n';
      ta.setRangeText(insert, start, end, 'end');
      afterEdit();
    };

    switch (action) {
      case 'bold': wrap('**', '**', '加粗文字'); break;
      case 'italic': wrap('*', '*', '斜体文字'); break;
      case 'strike': wrap('~~', '~~', '删除线'); break;
      case 'code': wrap('`', '`', '代码'); break;
      case 'h1': prefixLines('# ', '大标题'); break;
      case 'h2': prefixLines('## ', '中标题'); break;
      case 'h3': prefixLines('### ', '小标题'); break;
      case 'ul': prefixLines('- ', '列表项'); break;
      case 'ol': prefixLines('1. ', '列表项'); break;
      case 'task': prefixLines('- [ ] ', '待办事项'); break;
      case 'quote': prefixLines('> ', '引用内容'); break;
      case 'hr': insertBlock('\n---\n'); break;
      case 'codeblock': insertBlock('```\n' + (sel || '// code') + '\n```'); break;
      case 'table':
        insertBlock('| 项目 | 内容 | 负责人 | 状态 |\n| --- | --- | --- | --- |\n|  |  |  |  |\n|  |  |  |  |');
        break;
      case 'date': wrap('', '', TPL.buildVars().date); break;
      default: break;
    }
  }

  function afterEdit() {
    autoGrow();
    updateCounts(dom.content.value);
    scheduleSave();
    if (s.ui.editorMode !== 'edit') renderPreview(dom.content.value);
    dom.content.focus();
    ensureCaretVisible();
  }

  function onKeydown(e) {
    const meta = e.ctrlKey || e.metaKey;
    const tag = (e.target.tagName || '').toLowerCase();
    const inField = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.key === 'Escape') {
      if (!dom.modalRoot.hidden) { closeModal(); e.preventDefault(); return; }
      if (tagPopEl) { closeTagPicker(); return; }
      if (imgAskEl) { hideImageAsk(); return; }
      closeMenu();
    }

    if (!meta) return;

    if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (dom.search) { dom.search.focus(); dom.search.select(); }
      return;
    }
    if (e.key.toLowerCase() === 'n' && e.shiftKey) { e.preventDefault(); openTemplates(); return; }
    if (e.key.toLowerCase() === 'n' && !e.shiftKey) {
      e.preventDefault();
      newNote();
      return;
    }
    if (e.key.toLowerCase() === 's') { e.preventDefault(); if (currentId) { if (saveTimer) clearTimeout(saveTimer); commitSave(); toast('已保存', '✓'); } return; }

    if (!currentId) return;

    if (e.key.toLowerCase() === 'b' && inField) { e.preventDefault(); applyMd('bold'); return; }
    if (e.key.toLowerCase() === 'i' && inField) { e.preventDefault(); applyMd('italic'); return; }
    if (e.key.toLowerCase() === 'p' && e.shiftKey) { e.preventDefault(); $('btnPin').click(); return; }
  }

  /* ═══════════════ 总渲染 ═══════════════ */
  function renderAll() {
    renderSidebar();
    renderList();
    /* 待办列表（含随手查里的待办）右栏是事项详情，不能被笔记编辑器覆盖 */
    if (s.ui.view === 'track' || (s.ui.view === 'lookup' && s.ui.kindId === 'kind-todo')) return;
    if (currentId) {
      const note = Store.getNote(currentId);
      if (note && !note.deletedAt) openNote(currentId);
      else showEmpty();
    } else {
      showEmpty();
    }
  }

  function init() {
    applyTheme(s.ui.theme);
    if (s.ui.collapsed) dom.app.classList.add('collapsed');
    dom.crumbTime.textContent = '—';
    bind();

    /* 打开即首页：只有「随手记 / 随手查」两个入口 */
    const startView = ['all', 'today', 'notebook', 'tag', 'track', 'vault', 'trash'].includes(s.ui.view) ? s.ui.view : 'all';
    s.ui.view = startView;
    if (startView === 'lookup') currentId = s.ui.activeNoteId || null;

    /* 调试/演示参数：?theme=dark&mode=split&view=todo&tpl=1&settings=1 */
    try {
      const qs = new URLSearchParams(location.search);
      if (qs.get('theme')) applyTheme(qs.get('theme'));
      if (qs.get('mode')) s.ui.editorMode = qs.get('mode');
      if (qs.get('view')) Store.setUI({ view: qs.get('view'), notebookId: null, tagId: null });
      if (qs.get('tplId')) tplState.selected = qs.get('tplId');
      if (qs.get('tplFilter')) tplState.filter = qs.get('tplFilter');
      // 演示用假配置，便于截图 AI 面板（不会真的发起请求）
      if (qs.has('aifake')) {
        try {
          localStorage.setItem('guimo.ai.v1', JSON.stringify({
            provider: 'custom', baseUrl: 'https://demo.local/v1', apiKey: 'demo',
            model: 'demo-model', visionModel: '', temperature: 0.4
          }));
        } catch (e) { /* ignore */ }
      }
      if (qs.has('tpl')) setTimeout(openTemplates, 150);
      if (qs.has('settings')) setTimeout(openSettings, 150);
      if (qs.has('ai')) setTimeout(openAISettings, 150);
      if (qs.has('aisum')) setTimeout(() => openAISummary(qs.get('aisum') || null), 300);
    } catch (e) { /* ignore */ }

    if (!s.ui.activeNoteId) {
      const first = Store.filteredNotes()[0];
      if (first) s.ui.activeNoteId = first.id;
    }
    renderAll();
    if (s.ui.activeNoteId && s.ui.view !== 'vault') {
      const note = Store.getNote(s.ui.activeNoteId);
      if (note && !note.deletedAt) openNote(s.ui.activeNoteId);
    }

    /* 桌面「随手记」按钮：直接落到「全部笔记」，不再有首页这一层 */
    if (window.NoteBridge && NoteBridge.onHome) {
      NoteBridge.onHome(() => {
        Store.setUI({ view: 'all', search: '', kindId: null, tagId: null, notebookId: null });
        const list = Store.filteredNotes();
        const keep = list.some((n) => n.id === currentId) ? currentId : (list[0] ? list[0].id : null);
        currentId = keep;
        s.ui.activeNoteId = keep;
        renderAll();
        /* 重绘之后焦点常常落在 body 或搜索框上，直接把光标交回正文 */
        if (keep) setTimeout(() => focusEditor({ end: true }), 0);
      });
    }

    /* 窗口被再次唤起（托盘 / 桌面工具栏又点了一次）：光标回到正文 */
    if (window.NoteBridge && NoteBridge.onFocusEdit) {
      NoteBridge.onFocusEdit(() => {
        setTimeout(() => focusEditor({ end: true }), 30);
      });
    }

    /* 便签同步：桌面便签变化时刷新笔记内容 */
    if (window.StickySync) {
      StickySync.onChange((note) => {
        if (note && note.id === currentId) {
          const editing = document.activeElement === dom.content || document.activeElement === dom.title;
          if (!editing) {
            dom.content.value = note.content;
            renderPreview(note.content);
            updateCounts(note.content);
            autoGrow();
          }
        }
        maybeImportSticky({ silent: true });
        /* 便签上改了状态/标题：当前打开的是当日工作日志时，把表格也刷新出来 */
        if (currentId && currentId.indexOf('note-track-') === 0) {
          const editing = document.activeElement === dom.content;
          const n = Store.getNote(currentId);
          if (n && !editing) {
            dom.content.value = n.content;
            renderPreview(n.content);
            updateCounts(n.content);
            autoGrow();
          }
        }
        renderSidebar();
        renderList();
      });
      StickySync.start();
      /* 首次拉到便签数据后，把便签事项同步成跟踪事项 */
      setTimeout(() => maybeImportSticky({ silent: true }), 800);
      setTimeout(() => maybeImportSticky({ silent: true }), 2500);
    }

    /* 桌面便签的「详情」按钮：跳到对应事项跟踪记录 */
    if (window.NoteBridge && NoteBridge.onTrackFocus) {
      NoteBridge.onTrackFocus((payload) => {
        const id = typeof payload === 'string' ? payload : (payload && payload.stickyId);
        void focusTrackBySticky(id);
      });
      /* 窗口是刚刚被「详情」拉起来的：取一次挂起的跳转目标 */
      setTimeout(async () => {
        try {
          const pending = await NoteBridge.takeTrackFocus();
          if (pending) void focusTrackBySticky(pending);
        } catch (e) { /* ignore */ }
      }, 700);
    }
  }

  // 供 Store 更新后重绘 / 调试
  window.__guimo = {
    renderAll,
    openNote,
    toast,
    openAISettings,
    openAISummary,
    insertAt: (text) => insertAtCursor(text),
    /** 把焦点交回正文（弹窗/手写板/语音关闭后调用）；opt.end 表示光标移到末尾 */
    focusContent: (opt) => focusEditor(opt || null),
    /** 把笔记正文里旧媒体地址整体换成新地址（流程图重编辑后原地更新） */
    replaceMedia: (oldUrl, newUrl) => {
      const ta = dom.content;
      if (!ta || !oldUrl || !newUrl || ta.value.indexOf(oldUrl) < 0) return false;
      ta.value = ta.value.split(oldUrl).join(newUrl);
      afterEdit();
      return true;
    },
    focusTrack: focusTrackBySticky,
    openPeriodSummary,
    openTodo: (id) => {
      if (id) trackSel = id;
      Store.setUI({ view: 'track', notebookId: null, tagId: null, search: '', kindId: null });
      renderSidebar();
      renderList();
    },
    newNote,
    refreshSidebar: () => renderSidebar(),
    refreshList: () => renderList(),
    createFromKind,
    allTemplates,
    openSettings,
    openTemplates,
    openTemplateEditor,
    openNotebookEditor,
    modal: (html, opts) => openModal(html, opts),
    closeModal,
    get state() { return s; },
    get currentId() { return currentId; },
    openVault: () => {
      Store.setUI({ view: 'vault', notebookId: null, tagId: null });
      renderSidebar();
      renderList();
    }
  };

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await Store.init();
      s = Store.state;
      init();
      /* 数据安全提示：notes.json 损坏 → 只读模式；落盘失败 → 改动暂存本页 */
      if (Store.isReadonly) {
        toast('笔记文件损坏，已进入只读模式（下方是占位数据，不会写盘）。可从 notes.json.bak.1~3 或 notes.json.corrupt-* 恢复', '!');
      }
      document.addEventListener('guimo:notes-corrupt', () => {
        toast('笔记文件损坏，已进入只读模式，可从 notes.json.bak.1~3 或 notes.json.corrupt-* 恢复', '!');
      });
      document.addEventListener('guimo:save-failed', () => {
        toast('保存到磁盘失败，本次改动暂存在当前页面；请检查磁盘空间或附件目录是否可写', '!');
      });
    } catch (e) {
      console.error('[app] 初始化失败', e);
      toast('初始化失败：' + (e && e.message ? e.message : e), '!');
    }
  });
})();
