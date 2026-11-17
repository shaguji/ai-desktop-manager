/* ═══════════════════════════════════════════════════
   随手记 · 随手查 · 手写 / 语音
   —— 不再有「首页」：桌面随手记直接进全部笔记，
      这里只负责按类型新建（随手记）与搜索修改（随手查）
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => MD.esc(s == null ? '' : s);
  const pad = (n) => String(n).padStart(2, '0');
  const WDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const DAY = 86400000;

  const KIND_COLORS = ['#00a82d', '#2f74d0', '#7c5cd6', '#d99a00', '#0f9d9d', '#e05252', '#b8791f', '#8d968f'];

  let cap = null;      // 随手记弹层状态
  let hw = null;       // 手写板状态
  let voice = null;    // 语音状态
  let kindForm = null; // 类型编辑器状态

  /* ───────── 小工具 ───────── */
  function allTemplates() {
    const custom = (Store.state.templates || []).map((t) => Object.assign({}, t, { builtin: false }));
    return TPL.builtins.concat(custom);
  }

  function tplById(id) {
    return id ? allTemplates().find((t) => t.id === id) || null : null;
  }

  function relTime(ts) {
    const d = Date.now() - (ts || 0);
    if (d < 60e3) return '刚刚';
    if (d < 3600e3) return Math.floor(d / 60e3) + ' 分钟前';
    if (d < DAY) return Math.floor(d / 3600e3) + ' 小时前';
    if (d < 7 * DAY) return Math.floor(d / DAY) + ' 天前';
    const t = new Date(ts);
    return `${t.getMonth() + 1}月${t.getDate()}日`;
  }

  function fullDay(ts) {
    const t = new Date(ts);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }

  function clockText(ts) {
    const t = new Date(ts);
    return `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  }

  function greeting() {
    const h = new Date().getHours();
    if (h < 5) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    return '晚上好';
  }

  function toast(msg, icon) {
    if (global.__guimo && global.__guimo.toast) global.__guimo.toast(msg, icon);
  }

  async function saveMedia(dataUrl) {
    if (global.NoteBridge && NoteBridge.inShell) {
      const r = await NoteBridge.saveMedia(dataUrl);
      if (r && r.url) return r.url;
    }
    return dataUrl;
  }

  /** 流程图连线数据存 sidecar（图片同名 .flow.json），之后可以重开编辑 */
  async function saveFlowData(url, nodes, edges) {
    try {
      if (global.NoteBridge && NoteBridge.inShell && typeof NoteBridge.saveFlow === 'function') {
        await NoteBridge.saveFlow(url, JSON.stringify({ v: 1, nodes, edges }));
      }
    } catch (e) {
      /* sidecar 写失败不影响插图，只是这张图之后不能重开编辑 */
    }
  }

  /** 从 markdown 一行里抠出图片地址 */
  function imageUrlInLine(line) {
    const m = /!\[[^\]]*\]\(([^)\s]+)\)/.exec(String(line || ''));
    return m ? m[1] : '';
  }

  /** 读取某个图片的流程图数据（没有 sidecar = 不可编辑） */
  async function loadFlowData(url) {
    if (!url) return null;
    try {
      if (!(global.NoteBridge && NoteBridge.inShell && typeof NoteBridge.loadFlow === 'function')) return null;
      const raw = await NoteBridge.loadFlow(url);
      if (!raw) return null;
      const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!data || !Array.isArray(data.nodes) || !data.nodes.length) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * 编辑已有流程图。
   * 来源优先级：显式传入的 url > 光标所在行的图片；quiet=true 时行里没图就默默退出
   * （供双击文本区调用，不能每双击一次就弹提示）。
   */
  async function editFlowAtCursor(quiet) {
    const cur = global.__guimo && global.__guimo.currentId;
    if (!cur) { toast('先打开一篇笔记，再编辑流程图', '!'); return; }
    const ta = $('noteContent');
    if (!ta) return;
    const pos = ta.selectionStart || 0;
    const start = ta.value.lastIndexOf('\n', Math.max(0, pos - 1)) + 1;
    let end = ta.value.indexOf('\n', pos);
    if (end < 0) end = ta.value.length;
    const url = imageUrlInLine(ta.value.slice(start, end));
    if (!url) {
      if (!quiet) toast('先把光标放到流程图图片所在的那一行', '!');
      return;
    }
    await editFlowByUrl(url, quiet);
  }

  async function editFlowByUrl(url, quiet) {
    const data = await loadFlowData(url);
    if (!data) {
      if (!quiet) toast('这张图不是可编辑的流程图（更新前插入的图没有连线数据）', '!');
      return;
    }
    openHandwriting(async (newUrl, oldUrl) => {
      /* 优先原地替换旧图地址，正文其他内容不动 */
      if (oldUrl && global.__guimo && global.__guimo.replaceMedia && global.__guimo.replaceMedia(oldUrl, newUrl)) {
        toast('流程图已更新', '🧩');
        return;
      }
      if (global.__guimo) global.__guimo.insertAt(`\n\n![流程图 ${fullDay(Date.now())} ${clockText(Date.now())}](${newUrl})\n`);
      toast('流程图已插入', '🧩');
    }, { flow: data, editUrl: url });
  }

  function kindOf(id) {
    return (Store.state.kinds || []).find((k) => k.id === id) || null;
  }

  /* ═══════════════ 随手记 / 随手查 ═══════════════
     原来的「首页」已取消：桌面「随手记」直接进入全部笔记，
     这里只保留新建（随手记）与查找（随手查）两个功能。 */

  /* ═══════════════ 随手查 ═══════════════ */
  function openLookup(kindId, noteId) {
    Store.setUI({
      view: 'lookup',
      search: '',
      kindId: kindId || null,
      notebookId: null,
      tagId: null
    });
    if (global.__guimo) {
      global.__guimo.renderAll();
      if (noteId) global.__guimo.openNote(noteId);
      const input = $('lkInput');
      if (input && !noteId) setTimeout(() => input.focus(), 60);
    }
  }

  /* 随手查顶部类型 chips：待办走事项跟踪那张表，单独计数 */
  function renderLookupChips() {
    const box = $('lkChips');
    if (!box) return;
    const ui = Store.state.ui;
    const live = Store.activeNotes();
    const counts = {};
    live.forEach((n) => {
      if (!n.kindId) return;
      counts[n.kindId] = (counts[n.kindId] || 0) + 1;
    });
    const todoCount = Store.trackItems ? Store.trackItems().length : 0;
    const chips = [`<button class="lk-chip${!ui.kindId ? ' on' : ''}" data-lk-kind="all">全部<em>${live.length}</em></button>`]
      .concat(Store.noteKinds().map((k) => {
        const n = k.mode === 'track' ? todoCount : (counts[k.id] || 0);
        return `<button class="lk-chip${ui.kindId === k.id ? ' on' : ''}" data-lk-kind="${esc(k.id)}" style="--k:${k.color}">
        <span>${k.icon}</span>${esc(k.name)}<em>${n}</em>
      </button>`;
      }));
    box.innerHTML = chips.join('');
  }

  /* ═══════════════ 随手记弹层 ═══════════════ */
  function openCapture(kindId, subId) {
    closeCapture();
    const kinds = Store.noteKinds();
    if (!kinds.length) {
      toast('还没有可用的笔记类型，先去设置里新建一个', '!');
      openKindSettings();
      return;
    }
    const kind = kinds.find((k) => k.id === kindId) || kinds[0];
    cap = {
      kindId: kind.id,
      subId: subId || null,
      tplId: kind.templateId,
      attachments: [],
      blank: false
    };

    const overlay = document.createElement('div');
    overlay.className = 'cap-overlay';
    overlay.id = 'capOverlay';
    overlay.innerHTML = `<div class="cap-sheet" role="dialog" aria-modal="true">
      <div class="cap-top">
        <div class="cap-title">
          <span class="cap-mark">✍️</span>
          <div><h3>随手记一笔</h3><p id="capSub">选类型 → 模板自动就位 → 开始写</p></div>
        </div>
        <button class="cap-x" data-cap-close aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>

      <div class="cap-body">
        <div class="cap-step"><i>1</i>选择类型</div>
        <div class="cap-kinds" id="capKinds">
          ${kinds.map((k) => `<button class="ck${k.id === kind.id ? ' on' : ''}" data-ck="${esc(k.id)}" style="--k:${k.color}">
            <span class="ck-ic">${k.icon}</span>
            <b>${esc(k.name)}</b>
            <i>${esc(k.desc || '')}</i>
          </button>`).join('')}
        </div>

        <div class="cap-subs" id="capSubs"></div>

        <div class="cap-step" id="capStep2"><i>2</i><span id="capStep2Txt">写点什么（可选）</span></div>
        <input id="capTitle" class="cap-input" type="text" placeholder="标题（留空就用模板标题）" maxlength="120" spellcheck="false">
        <div class="cap-editor">
          <textarea id="capText" placeholder="先写两句，创建后可以继续补充…" spellcheck="false"></textarea>
          <div class="cap-tools" id="capTools">
            <button type="button" id="capHand">✍️ 手写</button>
            <button type="button" id="capVoice">🎙 语音</button>
            <span class="cap-tip">会作为附件插到这篇笔记里</span>
          </div>
        </div>
        <div class="cap-track" id="capTrack" hidden>
          <input id="capRisk" class="cap-input" type="text" placeholder="初始风险 / 困难（可选，之后还能继续补）" maxlength="200" spellcheck="false">
        </div>
        <div class="cap-attach" id="capAttach" hidden></div>

        <div class="cap-tplrow" id="capTplRow">
          <span class="ctl-label">模板</span>
          <select id="capTpl"></select>
          <label class="cap-blank"><input type="checkbox" id="capBlank"> 空白开始</label>
        </div>
      </div>

      <div class="cap-foot">
        <span class="cap-nb" id="capNb"></span>
        <div class="cap-actions">
          <button class="btn btn-ghost" data-cap-close>取消</button>
          <button class="btn btn-primary" id="capGo">开始记录</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-cap-close]').forEach((b) => { b.onclick = closeCapture; });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeCapture(); });

    $('capKinds').onclick = (e) => {
      const b = e.target.closest('[data-ck]');
      if (!b) return;
      cap.kindId = b.dataset.ck;
      cap.subId = null;
      cap.blank = false;
      const k = kindOf(cap.kindId);
      cap.tplId = k ? k.templateId : '';
      renderCapKinds();
      renderCapSubs();
      renderCapTpl();
    };

    $('capTpl').onchange = () => {
      cap.tplId = $('capTpl').value;
      cap.blank = !cap.tplId;
      $('capBlank').checked = cap.blank;
    };
    $('capBlank').onchange = () => {
      cap.blank = $('capBlank').checked;
      if (cap.blank) {
        cap.tplId = '';
        $('capTpl').value = '';
      } else {
        const k = kindOf(cap.kindId);
        cap.tplId = (currentSub() && currentSub().templateId) || (k && k.templateId) || '';
        $('capTpl').value = cap.tplId;
      }
    };

    $('capHand').onclick = () => {
      openHandwriting(async (url, oldUrl, mode) => {
        if (!cap) return;
        const kind = mode === 'flow' ? '流程图' : '手写';
        cap.attachments.push(`![${kind} ${fullDay(Date.now())} ${clockText(Date.now())}](${url})`);
        renderCapAttach();
      });
    };
    $('capVoice').onclick = () => {
      openVoice({
        onText: (text) => {
          const ta = $('capText');
          if (ta) ta.value = (ta.value ? ta.value.replace(/\s*$/, '') + '\n' : '') + text;
        },
        onMedia: (url, dur) => {
          if (!cap) return;
          cap.attachments.push(`[🎙 语音 ${dur}](${url})`);
          renderCapAttach();
        }
      });
    };

    $('capGo').onclick = submitCapture;
    renderCapKinds();
    renderCapSubs();
    renderCapTpl();
    renderCapAttach();
    setTimeout(() => { const t = $('capText'); if (t) t.focus(); }, 80);
  }

  function currentSub() {
    if (!cap || !cap.subId) return null;
    const k = kindOf(cap.kindId);
    return k ? (k.subs || []).find((s) => s.id === cap.subId) || null : null;
  }

  function renderCapKinds() {
    document.querySelectorAll('#capKinds .ck').forEach((b) => {
      b.classList.toggle('on', b.dataset.ck === cap.kindId);
    });
    applyCapMode();
  }

  /** 待办类型走「事项跟踪」，表单换成名称 / 背景 / 风险 */
  function applyCapMode() {
    if (!cap) return;
    const k = kindOf(cap.kindId);
    const track = !!(k && k.mode === 'track');
    const tplRow = $('capTplRow');
    const trackBox = $('capTrack');
    const tools = $('capTools');
    if (tplRow) tplRow.hidden = track;
    if (trackBox) trackBox.hidden = !track;
    if (tools) tools.hidden = track;

    const sub = $('capSub');
    if (sub) sub.textContent = track ? '选类型 → 写清要做什么 → 开始跟踪' : '选类型 → 模板自动就位 → 开始写';
    const step2 = $('capStep2Txt');
    if (step2) step2.textContent = track ? '要做什么' : '写点什么（可选）';
    const title = $('capTitle');
    if (title) title.placeholder = track ? '待办名称，例：周三前给出埋点方案' : '标题（留空就用模板标题）';
    const text = $('capText');
    if (text) text.placeholder = track
      ? '背景 / 目标（可选）：为什么要做、做到什么程度算办结'
      : '先写两句，创建后可以继续补充…';
    const go = $('capGo');
    if (go) go.textContent = track ? '创建待办' : '开始记录';

    const nbBox = $('capNb');
    if (nbBox) {
      if (track) {
        nbBox.textContent = '创建后自动同步到「每日工作」';
      } else {
        const sub2 = currentSub();
        const nb = Store.notebookOf((sub2 && sub2.notebookId) || (k && k.notebookId));
        nbBox.textContent = `保存到：${nb ? nb.name : '每日工作'}`;
      }
    }
  }

  function renderCapSubs() {
    const box = $('capSubs');
    const k = kindOf(cap.kindId);
    const subs = (k && k.subs) || [];
    if (!box) return;
    if (!subs.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<span class="cs-label">进一步细分</span>
      ${subs.map((s) => `<button class="cs-chip${cap.subId === s.id ? ' on' : ''}" data-cs="${esc(s.id)}">${esc(s.name)}</button>`).join('')}`;
    box.querySelectorAll('[data-cs]').forEach((b) => {
      b.onclick = () => {
        cap.subId = cap.subId === b.dataset.cs ? null : b.dataset.cs;
        const sub = currentSub();
        cap.tplId = sub ? sub.templateId : (k.templateId || '');
        cap.blank = false;
        $('capBlank').checked = false;
        renderCapSubs();
        renderCapTpl();
        renderCapKinds();
      };
    });
  }

  function renderCapTpl() {
    const sel = $('capTpl');
    if (!sel) return;
    const groups = [
      { key: 'dev', label: '项目与研发' },
      { key: 'log', label: '日志' },
      { key: 'meeting', label: '会议' },
      { key: 'ops', label: '运维与变更' },
      { key: 'summary', label: '总结' },
      { key: 'biz', label: '业务' },
      { key: 'other', label: '其他' },
      { key: 'custom', label: '自定义模板' }
    ];
    const list = allTemplates();
    const opts = ['<option value="">空白（不用模板）</option>'];
    groups.forEach((g) => {
      const items = list.filter((t) => (t.builtin ? (t.category || 'other') : 'custom') === g.key);
      if (!items.length) return;
      opts.push(`<optgroup label="${g.label}">${items.map((t) => `<option value="${t.id}">${esc(t.icon || '')} ${esc(t.name)}</option>`).join('')}</optgroup>`);
    });
    sel.innerHTML = opts.join('');
    sel.value = cap.tplId || '';
    const blank = $('capBlank');
    if (blank) blank.checked = !cap.tplId;
  }

  function renderCapAttach() {
    const box = $('capAttach');
    if (!box) return;
    if (!cap || !cap.attachments.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = cap.attachments.map((md, i) => {
      const hand = md.startsWith('![');
      return `<div class="ca-item">
        <span class="ca-ic">${hand ? '✍️' : '🎙'}</span>
        <span class="ca-txt">${hand ? '手写图片' : '语音记录'} ${i + 1}</span>
        <button class="ca-del" data-ca-del="${i}" title="移除">✕</button>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-ca-del]').forEach((b) => {
      b.onclick = () => {
        cap.attachments.splice(Number(b.dataset.caDel), 1);
        renderCapAttach();
      };
    });
  }

  function closeCapture() {
    const el = $('capOverlay');
    if (el) el.remove();
    cap = null;
  }

  function submitCapture() {
    if (!cap) return;
    const k = kindOf(cap.kindId);
    if (!k) { toast('类型不存在', '!'); return; }

    /* 待办：与「事项跟踪」同一份数据，直接建一条可跟进的待办 */
    if (k.mode === 'track') {
      const t = (($('capTitle') && $('capTitle').value) || '').trim();
      if (!t) {
        toast('先写一句要做什么', '!');
        const input = $('capTitle');
        if (input) input.focus();
        return;
      }
      const detail = (($('capText') && $('capText').value) || '').trim();
      const risk = (($('capRisk') && $('capRisk').value) || '').trim();
      closeCapture();
      const item = Store.addTrackItem({
        title: t,
        detail,
        risks: risk ? [{ id: 'r-' + Date.now().toString(36), at: Date.now(), text: risk, resolved: false }] : []
      });
      if (global.Track) Track.syncItem(item);
      if (global.__guimo && global.__guimo.openTodo) global.__guimo.openTodo(item.id);
      else if (global.__guimo) global.__guimo.renderAll();
      toast('待办已记下，进展会同步到「每日工作」', '✅');
      return;
    }

    const sub = currentSub();
    const title = ($('capTitle') && $('capTitle').value) || '';
    const body = ($('capText') && $('capText').value) || '';
    const payload = {
      title: title.trim(),
      body,
      attachments: cap.attachments.slice(),
      templateId: cap.tplId || '',
      blank: cap.blank || !cap.tplId
    };
    closeCapture();
    if (global.__guimo) global.__guimo.createFromKind(k, sub, payload);
  }

  /* ═══════════════ 手写板 ═══════════════ */
  /**
   * opts.flow + opts.editUrl：编辑已有流程图。
   * 打开时预载节点/连线，插入时回调 (newUrl, oldUrl, mode)，
   * 调用方用 oldUrl 把笔记里的旧图地址整体替换。
   */
  function openHandwriting(onDone, opts) {
    closeHandwriting();
    const o = opts || {};
    const colors = ['#1d2320', '#2f74d0', '#d8443c'];
    const sizes = [3, 6, 11];

    const overlay = document.createElement('div');
    overlay.className = 'hw-overlay';
    overlay.id = 'hwOverlay';
    overlay.innerHTML = `<div class="hw-card" role="dialog" aria-modal="true">
      <div class="hw-head">
        <div><b id="hwTitle">手写</b><span id="hwSub">鼠标、触控笔、手指都能写</span></div>
        <button class="hw-x" data-hw-close aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="hw-tabs">
        <button class="hw-tab on" data-hw-tab="draw">手写</button>
        <button class="hw-tab" data-hw-tab="flow">流程图</button>
      </div>
      <div class="hw-canvas-wrap" id="hwWrap">
        <canvas id="hwCanvas" width="1000" height="560"></canvas>
        <div class="hw-ph" id="hwPh">在这里书写…</div>
        <div class="flow-pane" id="flowPane" hidden>
          <svg id="flowSvg" viewBox="0 0 1000 560"></svg>
          <div class="flow-ph" id="flowPh">先选图形（或双击空白处加矩形），拖节点边缘的小圆点连线</div>
          <input class="flow-text-input" id="flowTextInput" maxlength="40" hidden>
        </div>
      </div>
      <div class="hw-tools" id="hwToolsDraw">
        <div class="hw-group hw-colors">
          ${colors.map((c, i) => `<button class="hw-swatch${i === 0 ? ' on' : ''}" data-hw-color="${c}" style="background:${c}" title="笔色"></button>`).join('')}
        </div>
        <div class="hw-group hw-sizes">
          ${sizes.map((s, i) => `<button class="hw-size${i === 1 ? ' on' : ''}" data-hw-size="${s}" title="粗细"><i style="width:${s + 2}px;height:${s + 2}px"></i></button>`).join('')}
        </div>
        <span class="hw-sep"></span>
        <button class="hw-btn" id="hwEraser">橡皮</button>
        <button class="hw-btn" id="hwUndo">撤销</button>
        <button class="hw-btn" id="hwClear">清空</button>
      </div>
      <div class="hw-tools" id="hwToolsFlow" hidden>
        <div class="hw-group">
          <button class="hw-btn on" data-flow-tool="select" title="拖动节点 / 选择">选择</button>
          <button class="hw-btn" data-flow-tool="rect" title="开始 / 结束">矩形</button>
          <button class="hw-btn" data-flow-tool="round" title="处理步骤">圆角</button>
          <button class="hw-btn" data-flow-tool="diamond" title="判断">判断</button>
          <button class="hw-btn" data-flow-tool="circle" title="连接点">圆形</button>
        </div>
        <span class="hw-sep"></span>
        <button class="hw-btn" id="flowUndo">撤销</button>
        <button class="hw-btn" id="flowDel">删除</button>
        <button class="hw-btn" id="flowClear">清空</button>
        <span class="flow-hint-inline">双击图形 / 连线改字 · 拖边缘圆点连线 · Delete 删除</span>
      </div>
      <div class="hw-foot">
        <span class="hw-hint" id="hwHint">写好后会以图片插入当前笔记</span>
        <div>
          <button class="btn btn-ghost" data-hw-close>取消</button>
          <button class="btn btn-primary" id="hwSave">插入笔记</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(overlay);

    const canvas = $('hwCanvas');
    const ctx = canvas.getContext('2d');
    hw = { strokes: [], cur: null, color: colors[0], size: sizes[1], eraser: false, onDone, mode: 'draw', editUrl: o.editUrl || '' };
    if (o.editUrl) $('hwSave').textContent = '保存修改';

    const paintBg = () => { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height); };

    function redraw() {
      paintBg();
      hw.strokes.forEach((s) => {
        if (!s.pts.length) return;
        ctx.beginPath();
        ctx.strokeStyle = s.erase ? '#ffffff' : s.color;
        ctx.lineWidth = s.size;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        if (s.pts.length === 1) {
          ctx.arc(s.pts[0].x, s.pts[0].y, s.size / 2, 0, Math.PI * 2);
          ctx.fillStyle = s.erase ? '#ffffff' : s.color;
          ctx.fill();
          return;
        }
        ctx.moveTo(s.pts[0].x, s.pts[0].y);
        for (let i = 1; i < s.pts.length; i++) {
          const p = s.pts[i];
          const prev = s.pts[i - 1];
          const mx = (p.x + prev.x) / 2;
          const my = (p.y + prev.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        }
        ctx.stroke();
      });
    }

    paintBg();

    /* ═══════════ 手写 / 流程图 双模式 ═══════════ */
    const SHAPES = {
      rect: { w: 150, h: 56 },
      round: { w: 160, h: 56 },
      diamond: { w: 132, h: 84 },
      circle: { w: 92, h: 92 }
    };
    const flow = { nodes: [], edges: [], sel: null, tool: 'select', drag: null, link: null, seq: 1, undo: [] };
    const svgEl = $('flowSvg');
    const pane = $('flowPane');
    const textInput = $('flowTextInput');
    /* 输入框要按视口定位，挂到 body 上才不会受弹窗动画 / 裁剪影响 */
    if (textInput && textInput.parentNode !== document.body) document.body.appendChild(textInput);

    /* 编辑已有流程图：预载节点 / 连线，直接落在流程图页签 */
    if (o.flow && Array.isArray(o.flow.nodes) && o.flow.nodes.length) {
      flow.nodes = JSON.parse(JSON.stringify(o.flow.nodes));
      flow.edges = JSON.parse(JSON.stringify(o.flow.edges || []));
      let mx = 0;
      flow.nodes.concat(flow.edges).forEach((x) => {
        const m = /(\d+)$/.exec(String((x && x.id) || ''));
        if (m) mx = Math.max(mx, Number(m[1]));
      });
      flow.seq = mx + 1;
      hw.mode = 'flow';
    }

    function setMode(mode) {
      hw.mode = mode;
      const isFlow = mode === 'flow';
      overlay.querySelectorAll('[data-hw-tab]').forEach((b) => {
        b.classList.toggle('on', b.dataset.hwTab === mode);
      });
      const td = $('hwToolsDraw');
      const tf = $('hwToolsFlow');
      if (td) td.hidden = isFlow;
      if (tf) tf.hidden = !isFlow;
      pane.hidden = !isFlow;
      canvas.style.display = isFlow ? 'none' : 'block';
      const ph = $('hwPh');
      if (ph) ph.hidden = isFlow || hw.strokes.length > 0;
      $('hwTitle').textContent = isFlow ? '流程图' : '手写';
      $('hwSub').textContent = isFlow ? '框选、连线，快速理清流程' : '鼠标、触控笔、手指都能写';
      $('hwHint').textContent = isFlow ? '画好后会以 PNG 图片插入当前笔记' : '写好后会以图片插入当前笔记';
      if (isFlow) renderFlow();
    }

    function boxOf(n) {
      return { x: n.x, y: n.y, w: n.w, h: n.h, cx: n.x + n.w / 2, cy: n.y + n.h / 2 };
    }

    function shapeD(n) {
      const b = boxOf(n);
      if (n.type === 'diamond') {
        return `M${b.cx} ${b.y} L${b.x + b.w} ${b.cy} L${b.cx} ${b.y + b.h} L${b.x} ${b.cy} Z`;
      }
      const r = n.type === 'round' ? 16 : 5;
      const x = b.x, y = b.y, w = b.w, h = b.h;
      return `M${x + r} ${y} H${x + w - r} Q${x + w} ${y} ${x + w} ${y + r} V${y + h - r} Q${x + w} ${y + h} ${x + w - r} ${y + h} H${x + r} Q${x} ${y + h} ${x} ${y + h - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
    }

    /* 连线的四个锚点边：连线从指定的边出发、从指定的边进入（正交折线） */
    const FLOW_SIDES = ['t', 'r', 'b', 'l'];
    const FLOW_OUT = { t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };

    function sideAnchor(n, side) {
      const b = boxOf(n);
      if (side === 't') return { x: b.cx, y: b.y };
      if (side === 'b') return { x: b.cx, y: b.y + b.h };
      if (side === 'l') return { x: b.x, y: b.cy };
      return { x: b.x + b.w, y: b.cy };
    }

    /** 没记锚点时（自动连线 / 旧数据）按两框相对位置选进出口 */
    function autoSides(a, b) {
      const A = boxOf(a), B = boxOf(b);
      const dx = B.cx - A.cx, dy = B.cy - A.cy;
      if (Math.abs(dx) >= Math.abs(dy)) return [dx >= 0 ? 'r' : 'l', dx >= 0 ? 'l' : 'r'];
      return [dy >= 0 ? 'b' : 't', dy >= 0 ? 't' : 'b'];
    }

    /**
     * 正交折线：从 A 的 fs 边向外引 18px，正交走到 B 的 ts 边外侧，再进入 B。
     * 锚点是拖连线时真实出发的那个圆点，所以线永远从用户指的地方出来。
     */
    function edgePoints(a, b, e) {
      let fs, ts;
      if (e && FLOW_SIDES.includes(e.fs) && FLOW_SIDES.includes(e.ts)) {
        fs = e.fs; ts = e.ts;
      } else {
        [fs, ts] = autoSides(a, b);
      }
      const p1 = sideAnchor(a, fs);
      const p2 = sideAnchor(b, ts);
      const E = 18;
      const q1 = { x: p1.x + FLOW_OUT[fs][0] * E, y: p1.y + FLOW_OUT[fs][1] * E };
      const q2 = { x: p2.x + FLOW_OUT[ts][0] * E, y: p2.y + FLOW_OUT[ts][1] * E };
      const h1 = fs === 'l' || fs === 'r';
      const h2 = ts === 'l' || ts === 'r';
      const pts = [[p1.x, p1.y], [q1.x, q1.y]];
      if (h1 && h2) {
        const mx = (q1.x + q2.x) / 2;
        pts.push([mx, q1.y], [mx, q2.y]);
      } else if (!h1 && !h2) {
        const my = (q1.y + q2.y) / 2;
        pts.push([q1.x, my], [q2.x, my]);
      } else if (h1) {
        pts.push([q2.x, q1.y]);
      } else {
        pts.push([q1.x, q2.y]);
      }
      pts.push([q2.x, q2.y], [p2.x, p2.y]);
      return pts.filter((p, i) => i === 0 || p[0] !== pts[i - 1][0] || p[1] !== pts[i - 1][1]);
    }

    function edgeD(a, b, e) {
      return edgePoints(a, b, e).map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
    }

    /** 最长中段的中点，连线上的文字就摆这里（弯多的时候不会压到拐角） */
    function edgeMid(a, b, e) {
      const pts = edgePoints(a, b, e);
      let bi = 0, best = -1;
      for (let i = 1; i < pts.length - 1; i++) {
        const len = Math.abs(pts[i][0] - pts[i + 1][0]) + Math.abs(pts[i][1] - pts[i + 1][1]);
        if (len > best) { best = len; bi = i; }
      }
      const p1 = pts[Math.max(0, bi)];
      const p2 = pts[Math.min(pts.length - 1, bi + 1)];
      return { x: (p1[0] + p2[0]) / 2, y: (p1[1] + p2[1]) / 2 };
    }

    function wrapLabel(text, w) {
      const s = String(text || '').trim();
      if (!s) return [''];
      const per = Math.max(4, Math.floor((w - 18) / 13));
      const out = [];
      let rest = s;
      while (rest.length > per && out.length < 2) {
        out.push(rest.slice(0, per));
        rest = rest.slice(per);
      }
      out.push(rest);
      return out.slice(0, 2);
    }

    function renderFlow() {
      if (!svgEl) return;
      const defs = `<defs><marker id="fArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#8d968f"/></marker></defs>`;
      const edges = flow.edges.map((e) => {
        const a = flow.nodes.find((n) => n.id === e.from);
        const b = flow.nodes.find((n) => n.id === e.to);
        if (!a || !b) return '';
        const on = flow.sel && flow.sel.type === 'edge' && flow.sel.id === e.id;
        const mid = edgeMid(a, b, e);
        const lab = String(e.label || '').trim();
        let labelEl = '';
        if (lab) {
          const tw = Math.min(190, Math.max(28, lab.length * 12.4 + 18));
          labelEl = `<rect x="${(mid.x - tw / 2).toFixed(1)}" y="${(mid.y - 11).toFixed(1)}" width="${tw.toFixed(1)}" height="22" rx="5" fill="#ffffff" stroke="${on ? '#2f74d0' : '#dfe4df'}" stroke-width="1"/>
            <text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11.5" fill="#4a554d" font-family="-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif" style="pointer-events:none">${esc(lab)}</text>`;
        } else if (on) {
          labelEl = `<circle cx="${mid.x.toFixed(1)}" cy="${mid.y.toFixed(1)}" r="9" fill="#fff" stroke="#2f74d0" stroke-width="1.4" stroke-dasharray="3 2"/>
            <text x="${mid.x.toFixed(1)}" y="${mid.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="12" fill="#2f74d0" style="pointer-events:none">+</text>`;
        }
        return `<g data-edge="${e.id}" style="cursor:pointer">
          <path d="${edgeD(a, b, e)}" fill="none" stroke="${on ? '#2f74d0' : '#9aa39c'}" stroke-width="${on ? 2.4 : 1.7}" marker-end="url(#fArrow)" pointer-events="none"/>
          <path d="${edgeD(a, b, e)}" fill="none" stroke="transparent" stroke-width="14"/>
          ${labelEl}
        </g>`;
      }).join('');
      const nodes = flow.nodes.map((n) => {
        const b = boxOf(n);
        const on = flow.sel && flow.sel.type === 'node' && flow.sel.id === n.id;
        const fill = n.type === 'diamond' ? '#fff7e4' : (n.type === 'circle' ? '#eef4ff' : '#ffffff');
        const stroke = on ? '#2f74d0' : '#cbd1cb';
        const sw = on ? 2.2 : 1.6;
        const shape = n.type === 'circle'
          ? `<ellipse cx="${b.cx}" cy="${b.cy}" rx="${n.w / 2}" ry="${n.h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`
          : `<path d="${shapeD(n)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>`;
        const lines = wrapLabel(n.text, n.w);
        const text = lines.map((l, i) => `<text x="${b.cx}" y="${b.cy + (i - (lines.length - 1) / 2) * 17}" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="#1d2320" font-family="-apple-system,BlinkMacSystemFont,'Microsoft YaHei',sans-serif" style="pointer-events:none">${esc(l)}</text>`).join('');
        /* 四边各一个锚点圆点：可见的小点 + 更大的透明热区，拖它连线 */
        const ports = on
          ? [['t', b.cx, b.y], ['r', b.x + b.w, b.cy], ['b', b.cx, b.y + b.h], ['l', b.x, b.cy]]
            .map(([s, px, py]) => `<circle data-port="${s}" cx="${px}" cy="${py}" r="4.6" fill="#fff" stroke="#2f74d0" stroke-width="1.6" style="cursor:crosshair"/><circle data-port="${s}" cx="${px}" cy="${py}" r="13" fill="transparent" pointer-events="all" style="cursor:crosshair"/>`).join('')
          : '';
        return `<g data-node="${n.id}" style="cursor:move">${shape}${text}${ports}</g>`;
      }).join('');
      /* 连线预览：同样走正交折线，落点方向实时跟随 */
      const preview = flow.link
        ? (() => {
            const L = flow.link;
            const ov = FLOW_OUT[L.side] || [0, 1];
            const E = 18;
            const qx = L.sx + ov[0] * E;
            const qy = L.sy + ov[1] * E;
            const horiz = L.side === 'l' || L.side === 'r';
            const bx = horiz ? L.x : qx;
            const by = horiz ? qy : L.y;
            return `<path d="M${L.sx} ${L.sy} L${qx} ${qy} L${bx} ${by} L${L.x} ${L.y}" fill="none" stroke="#2f74d0" stroke-width="1.8" stroke-dasharray="5 4" pointer-events="none"/>`;
          })()
        : '';
      svgEl.innerHTML = defs + edges + nodes + preview;
      const fph = $('flowPh');
      if (fph) fph.hidden = flow.nodes.length > 0;
    }

    function svgPt(e) {
      const r = svgEl.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (1000 / r.width),
        y: (e.clientY - r.top) * (560 / r.height)
      };
    }

    function snapshot() {
      flow.undo.push(JSON.stringify({ nodes: flow.nodes, edges: flow.edges }));
      if (flow.undo.length > 40) flow.undo.shift();
    }

    /** 把浮动输入框摆到视口坐标 (cx, cy) 处，kind 决定改的是节点还是连线 */
    function showEditor(kind, id, text, cx, cy) {
      if (!textInput) return;
      const w = kind === 'edge' ? 150 : 168;
      textInput.dataset.kind = kind;
      textInput.dataset.tid = id;
      textInput.dataset.old = text || '';
      textInput.value = text || '';
      textInput.placeholder = kind === 'edge' ? '连线文字' : '节点文字';
      textInput.style.width = w + 'px';
      textInput.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2)) + 'px';
      textInput.style.top = Math.max(8, Math.min(window.innerHeight - 38, cy - 15)) + 'px';
      textInput.hidden = false;
      setTimeout(() => { textInput.focus(); textInput.select(); }, 0);
    }

    function openTextEditor(n) {
      const r = pane.getBoundingClientRect();
      showEditor('node', n.id, n.text,
        r.left + ((n.x + n.w / 2) / 1000) * r.width,
        r.top + ((n.y + n.h / 2) / 560) * r.height);
    }

    function openEdgeEditor(e) {
      const a = flow.nodes.find((n) => n.id === e.from);
      const b = flow.nodes.find((n) => n.id === e.to);
      if (!a || !b) return;
      const mid = edgeMid(a, b, e);
      const r = pane.getBoundingClientRect();
      showEditor('edge', e.id, e.label,
        r.left + (mid.x / 1000) * r.width,
        r.top + (mid.y / 560) * r.height);
    }

    function commitTextInput(save) {
      if (!textInput || textInput.hidden) return;
      const kind = textInput.dataset.kind || 'node';
      const id = textInput.dataset.tid;
      const val = save ? textInput.value.trim() : (textInput.dataset.old || '');
      if (kind === 'edge') {
        const e = flow.edges.find((x) => x.id === id);
        if (e) e.label = val;
      } else {
        const n = flow.nodes.find((x) => x.id === id);
        if (n) n.text = val;
      }
      textInput.hidden = true;
      renderFlow();
    }

    /* 双击判定自己做：renderFlow 会重建 DOM，原生 dblclick 的 target 容易失效 */
    let lastHit = { key: '', t: 0 };
    function hitTwice(key) {
      const now = Date.now();
      const twice = lastHit.key === key && now - lastHit.t < 480;
      lastHit = { key: twice ? '' : key, t: now };
      return twice;
    }

    function addNode(type, x, y) {
      const s = SHAPES[type] || SHAPES.rect;
      snapshot();
      let nx = Math.round(x / 10) * 10 - s.w / 2;
      let ny = Math.round(y / 10) * 10 - s.h / 2;
      nx = Math.max(4, Math.min(1000 - s.w - 4, nx));
      ny = Math.max(4, Math.min(560 - s.h - 4, ny));
      const n = { id: 'n' + (flow.seq++), type, x: nx, y: ny, w: s.w, h: s.h, text: '' };
      flow.nodes.push(n);
      flow.sel = { type: 'node', id: n.id };
      setTool('select');
      renderFlow();
      openTextEditor(n);
    }

    function setTool(t) {
      flow.tool = t;
      overlay.querySelectorAll('[data-flow-tool]').forEach((b) => {
        b.classList.toggle('on', b.dataset.flowTool === t);
      });
      if (svgEl) svgEl.style.cursor = t === 'select' ? 'default' : 'crosshair';
    }

    function delSelected() {
      if (!flow.sel) return;
      snapshot();
      if (flow.sel.type === 'node') {
        const id = flow.sel.id;
        flow.nodes = flow.nodes.filter((n) => n.id !== id);
        flow.edges = flow.edges.filter((x) => x.from !== id && x.to !== id);
      } else {
        flow.edges = flow.edges.filter((x) => x.id !== flow.sel.id);
      }
      flow.sel = null;
      renderFlow();
    }

    if (svgEl) {
      svgEl.addEventListener('pointerdown', (e) => {
        if (hw.mode !== 'flow') return;
        if (!textInput.hidden) commitTextInput(true);
        const port = e.target.closest ? e.target.closest('[data-port]') : null;
        const nodeEl = port ? port.closest('[data-node]') : (e.target.closest ? e.target.closest('[data-node]') : null);
        const edgeEl = e.target.closest ? e.target.closest('[data-edge]') : null;
        const p = svgPt(e);
        if (port && nodeEl) {
          const id = nodeEl.getAttribute('data-node');
          const n = flow.nodes.find((x) => x.id === id);
          if (n) {
            /* 从哪个锚点边出发就记哪条边，折线会从这个点引出 */
            const side = port.getAttribute('data-port') || 'b';
            const ap = sideAnchor(n, side);
            flow.link = { from: id, side, sx: ap.x, sy: ap.y, x: p.x, y: p.y };
          }
          e.preventDefault();
          return;
        }
        if (nodeEl) {
          const id = nodeEl.getAttribute('data-node');
          const n = flow.nodes.find((x) => x.id === id);
          if (n) {
            const twice = hitTwice('node:' + id);
            flow.sel = { type: 'node', id };
            flow.drag = twice ? null : { id, dx: p.x - n.x, dy: p.y - n.y };
            renderFlow();
            if (twice) openTextEditor(n);
          }
          e.preventDefault();
          return;
        }
        if (edgeEl) {
          const id = edgeEl.getAttribute('data-edge');
          const ed = flow.edges.find((x) => x.id === id);
          flow.sel = { type: 'edge', id };
          renderFlow();
          if (ed && hitTwice('edge:' + id)) openEdgeEditor(ed);
          e.preventDefault();
          return;
        }
        if (flow.tool !== 'select') {
          addNode(flow.tool, p.x, p.y);
        } else {
          flow.sel = null;
          renderFlow();
        }
        e.preventDefault();
      });

      svgEl.addEventListener('pointermove', (e) => {
        if (hw.mode !== 'flow') return;
        if (flow.drag) {
          const n = flow.nodes.find((x) => x.id === flow.drag.id);
          if (!n) return;
          const p = svgPt(e);
          n.x = Math.max(0, Math.min(1000 - n.w, Math.round((p.x - flow.drag.dx) / 10) * 10));
          n.y = Math.max(0, Math.min(560 - n.h, Math.round((p.y - flow.drag.dy) / 10) * 10));
          renderFlow();
        } else if (flow.link) {
          const p = svgPt(e);
          flow.link.x = p.x;
          flow.link.y = p.y;
          renderFlow();
        }
      });

      /* 拖动 / 连线全程挂 window：不依赖 pointer capture，鼠标拖出画布也能继续跟 */
      const onFlowMove = (e) => {
        if (!hw || hw.mode !== 'flow') return;
        if (flow.drag) {
          const n = flow.nodes.find((x) => x.id === flow.drag.id);
          if (!n) return;
          const p = svgPt(e);
          n.x = Math.max(0, Math.min(1000 - n.w, Math.round((p.x - flow.drag.dx) / 10) * 10));
          n.y = Math.max(0, Math.min(560 - n.h, Math.round((p.y - flow.drag.dy) / 10) * 10));
          renderFlow();
        } else if (flow.link) {
          const p = svgPt(e);
          flow.link.x = p.x;
          flow.link.y = p.y;
          renderFlow();
        }
      };

      const endFlowDrag = (e) => {
        if (!hw || hw.mode !== 'flow') return;
        if (flow.link) {
          const hit = document.elementFromPoint(e.clientX, e.clientY);
          const g = hit && hit.closest ? hit.closest('[data-node]') : null;
          const toId = g ? g.getAttribute('data-node') : null;
          if (toId && toId !== flow.link.from) {
            const a = flow.nodes.find((n) => n.id === flow.link.from);
            const b = flow.nodes.find((n) => n.id === toId);
            if (a && b) {
              /* 进哪条边由落点相对目标框的方位决定，折线从这里进入 */
              const A = boxOf(a), B = boxOf(b);
              const dx = B.cx - A.cx, dy = B.cy - A.cy;
              const ts = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'l' : 'r') : (dy >= 0 ? 't' : 'b');
              snapshot();
              const dup = flow.edges.find((x) => x.from === flow.link.from && x.to === toId);
              if (dup) {
                /* 同两个节点再连一次 = 重新选锚点，替换旧线的进出口 */
                dup.fs = flow.link.side;
                dup.ts = ts;
              } else {
                flow.edges.push({ id: 'e' + (flow.seq++), from: flow.link.from, to: toId, fs: flow.link.side, ts });
              }
            }
          }
          flow.link = null;
          renderFlow();
        }
        flow.drag = null;
      };
      window.addEventListener('pointermove', onFlowMove);
      window.addEventListener('pointerup', endFlowDrag);
      window.addEventListener('pointercancel', endFlowDrag);
      hw.flowMove = onFlowMove;
      hw.flowEnd = endFlowDrag;

      svgEl.addEventListener('dblclick', (e) => {
        if (hw.mode !== 'flow') return;
        if (!textInput.hidden) return;
        const eg = e.target.closest ? e.target.closest('[data-edge]') : null;
        if (eg) {
          const ed = flow.edges.find((x) => x.id === eg.getAttribute('data-edge'));
          if (ed) { flow.sel = { type: 'edge', id: ed.id }; renderFlow(); openEdgeEditor(ed); }
          return;
        }
        const g = e.target.closest ? e.target.closest('[data-node]') : null;
        if (!g) return;
        const n = flow.nodes.find((x) => x.id === g.getAttribute('data-node'));
        if (n) { flow.sel = { type: 'node', id: n.id }; renderFlow(); openTextEditor(n); }
      });
    }

    if (textInput) {
      textInput.addEventListener('blur', () => commitTextInput(true));
      textInput.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commitTextInput(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commitTextInput(false); }
      });
    }

    overlay.querySelectorAll('[data-hw-tab]').forEach((b) => {
      b.onclick = () => setMode(b.dataset.hwTab);
    });
    /* 带着旧图进来 = 编辑模式，直接打开流程图页签 */
    if (hw.mode === 'flow') setMode('flow');
    overlay.querySelectorAll('[data-flow-tool]').forEach((b) => {
      b.onclick = () => setTool(b.dataset.flowTool);
    });
    if ($('flowUndo')) {
      $('flowUndo').onclick = () => {
        const last = flow.undo.pop();
        if (!last) { toast('没有可撤销的操作', '!'); return; }
        try {
          const s = JSON.parse(last);
          flow.nodes = s.nodes || [];
          flow.edges = s.edges || [];
        } catch (e) { /* ignore */ }
        flow.sel = null;
        renderFlow();
      };
    }
    if ($('flowDel')) $('flowDel').onclick = delSelected;
    if ($('flowClear')) {
      $('flowClear').onclick = () => {
        if (!flow.nodes.length) return;
        snapshot();
        flow.nodes = [];
        flow.edges = [];
        flow.sel = null;
        renderFlow();
      };
    }

    /** 导出：按内容包围盒裁切，2 倍像素，白底 PNG */
    async function flowToPng() {
      if (!flow.nodes.length) return '';
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      flow.nodes.forEach((n) => {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
      });
      const pad = 28;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const w = Math.max(40, Math.round(maxX - minX));
      const h = Math.max(40, Math.round(maxY - minY));
      const clone = svgEl.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.setAttribute('viewBox', `${minX} ${minY} ${w} ${h}`);
      clone.setAttribute('width', String(w));
      clone.setAttribute('height', String(h));
      clone.removeAttribute('style');
      clone.querySelectorAll('[data-port]').forEach((el) => el.remove());
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', String(minX));
      bg.setAttribute('y', String(minY));
      bg.setAttribute('width', String(w));
      bg.setAttribute('height', String(h));
      bg.setAttribute('fill', '#ffffff');
      clone.insertBefore(bg, clone.firstChild);
      const svgText = new XMLSerializer().serializeToString(clone);
      const src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('流程图渲染失败'));
        img.src = src;
      });
      const out = document.createElement('canvas');
      out.width = w * 2;
      out.height = h * 2;
      const g2 = out.getContext('2d');
      g2.scale(2, 2);
      g2.fillStyle = '#ffffff';
      g2.fillRect(0, 0, w, h);
      g2.drawImage(img, 0, 0, w, h);
      return out.toDataURL('image/png');
    }

    /* Delete / Backspace 删除选中（键盘事件得挂在 document 上，弹层本身不可聚焦） */
    const onFlowKey = (e) => {
      if (!hw || hw.mode !== 'flow' || !flow.sel) return;
      if (document.activeElement === textInput) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        delSelected();
        return;
      }
      /* 选中后直接按 Enter 也能改字（不必双击） */
      if (e.key === 'Enter' || e.key === 'F2') {
        e.preventDefault();
        if (flow.sel.type === 'edge') {
          const ed = flow.edges.find((x) => x.id === flow.sel.id);
          if (ed) openEdgeEditor(ed);
        } else {
          const n = flow.nodes.find((x) => x.id === flow.sel.id);
          if (n) openTextEditor(n);
        }
      }
    };
    document.addEventListener('keydown', onFlowKey);
    hw.keyHandler = onFlowKey;

    function pt(e) {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) * (canvas.width / r.width),
        y: (e.clientY - r.top) * (canvas.height / r.height)
      };
    }

    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件没有真实 pointerId */ }
      hw.cur = { color: hw.color, size: hw.eraser ? 26 : hw.size, erase: hw.eraser, pts: [pt(e)] };
      hw.strokes.push(hw.cur);
      const ph = $('hwPh');
      if (ph) ph.hidden = true;
      redraw();
      e.preventDefault();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!hw || !hw.cur) return;
      hw.cur.pts.push(pt(e));
      redraw();
      e.preventDefault();
    });
    const endStroke = () => { if (hw) hw.cur = null; };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', endStroke);

    overlay.querySelectorAll('[data-hw-color]').forEach((b) => {
      b.onclick = () => {
        hw.color = b.dataset.hwColor;
        hw.eraser = false;
        $('hwEraser').classList.remove('on');
        overlay.querySelectorAll('[data-hw-color]').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    overlay.querySelectorAll('[data-hw-size]').forEach((b) => {
      b.onclick = () => {
        hw.size = Number(b.dataset.hwSize);
        overlay.querySelectorAll('[data-hw-size]').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    $('hwEraser').onclick = () => {
      hw.eraser = !hw.eraser;
      $('hwEraser').classList.toggle('on', hw.eraser);
    };
    $('hwUndo').onclick = () => {
      hw.strokes.pop();
      redraw();
      if (!hw.strokes.length) { const ph = $('hwPh'); if (ph) ph.hidden = false; }
    };
    $('hwClear').onclick = () => {
      hw.strokes = [];
      redraw();
      const ph = $('hwPh');
      if (ph) ph.hidden = false;
    };

    overlay.querySelectorAll('[data-hw-close]').forEach((b) => { b.onclick = closeHandwriting; });
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeHandwriting(); });

    $('hwSave').onclick = async () => {
      if (hw.mode === 'flow') {
        if (!flow.nodes.length) { toast('还没画内容', '!'); return; }
        let png = '';
        try {
          flow.sel = null;          /* 别把蓝色选中框导出进图片 */
          commitTextInput(true);
          renderFlow();
          png = await flowToPng();
        } catch (e) {
          toast('导出失败：' + ((e && e.message) || e), '!');
          return;
        }
        if (!png) { toast('导出失败', '!'); return; }
        const cb2 = hw.onDone;
        const editUrl = hw.editUrl;
        closeHandwriting();
        const u2 = await saveMedia(png);
        /* 连线数据存进图片旁边的 sidecar（同名 .flow.json），之后随时双击重开编辑 */
        await saveFlowData(u2, flow.nodes, flow.edges);
        if (cb2) cb2(u2, editUrl, 'flow');
        toast('流程图已插入', '🧩');
        return;
      }
      if (!hw.strokes.length) { toast('还没写内容', '!'); return; }
      /* 导出前再画一次（去掉辅助虚线），裁掉纯白边 */
      const out = document.createElement('canvas');
      const box = trimBox(canvas);
      out.width = box.w;
      out.height = box.h;
      const octx = out.getContext('2d');
      octx.fillStyle = '#ffffff';
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(canvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
      const dataUrl = out.toDataURL('image/png');
      const cb = hw.onDone;
      closeHandwriting();
      const url = await saveMedia(dataUrl);
      if (cb) cb(url);
      toast('手写已插入', '✍️');
    };
  }

  /** 估算笔迹边界，把大片空白裁掉（简单扫描非白像素） */
  function trimBox(canvas) {
    try {
      const ctx = canvas.getContext('2d');
      const { width: W, height: H } = canvas;
      const data = ctx.getImageData(0, 0, W, H).data;
      let minX = W, minY = H, maxX = 0, maxY = 0;
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          const i = (y * W + x) * 4;
          if (data[i] < 246 || data[i + 1] < 246 || data[i + 2] < 246) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX <= minX || maxY <= minY) return { x: 0, y: 0, w: W, h: H };
      const padPx = 18;
      const x = Math.max(0, minX - padPx);
      const y = Math.max(0, minY - padPx);
      const w = Math.min(W - x, maxX - minX + padPx * 2);
      const h = Math.min(H - y, maxY - minY + padPx * 2);
      return { x, y, w, h };
    } catch (e) {
      return { x: 0, y: 0, w: canvas.width, h: canvas.height };
    }
  }

  function closeHandwriting() {
    const el = $('hwOverlay');
    if (el) el.remove();
    if (hw) {
      if (hw.keyHandler) document.removeEventListener('keydown', hw.keyHandler);
      if (hw.flowMove) window.removeEventListener('pointermove', hw.flowMove);
      if (hw.flowEnd) {
        window.removeEventListener('pointerup', hw.flowEnd);
        window.removeEventListener('pointercancel', hw.flowEnd);
      }
    }
    const ti = $('flowTextInput');
    if (ti) ti.remove();
    hw = null;
    /* 关闭手写/流程图后把光标还给笔记正文，接着就能打字 */
    if (global.__guimo && global.__guimo.focusContent) setTimeout(() => global.__guimo.focusContent(), 30);
  }

  /* ═══════════════ 语音输入 ═══════════════ */
  /**
   * 轻量录音：不弹大窗，只在底部浮一条小胶囊；
   * 工具栏的麦克风按钮同时变红并呼吸，表示正在录。
   * 录音中再点一次麦克风 = 停止并插入。
   */
  function openVoice(opts) {
    if (voice) { finishVoice(); return; }
    const o = opts || {};
    voice = {
      mode: 'text',
      text: '',
      mediaUrl: null,
      duration: 0,
      rec: null,
      stream: null,
      chunks: [],
      timer: null,
      startedAt: Date.now(),
      done: false,
      finishing: false,
      onText: o.onText,
      onMedia: o.onMedia
    };
    buildRecDock();
    markRecBtn(true);
    tickTimer();
    voice.timer = setInterval(tickTimer, 500);

    const SR = global.SpeechRecognition || global.webkitSpeechRecognition;
    const inShell = !!(global.NoteBridge && global.NoteBridge.inShell);
    /* Electron 里的 Web Speech 没有可用后端（一定报 network / service-not-allowed），
       所以桌面端直接录音 + 云端转写；浏览器里才尝试实时识别 */
    if (!inShell && SR) startSpeech(SR);
    else startRecording();

    if (global.AI && AI.getConfig) {
      AI.getConfig().then((cfg) => {
        if (!voice) return;
        if (!AI.asrReady(cfg)) {
          recTip('未配置识别 · 存为附件', '还没配置语音识别模型，这段录音会直接存成附件（设置 → AI 模型 → 语音识别）');
        }
      }).catch(() => {});
    }
  }

  /** 底部小胶囊：红点 + 计时 + 停止 / 取消 */
  function buildRecDock() {
    const old = $('recDock');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'rec-dock';
    el.id = 'recDock';
    el.innerHTML = `
      <span class="rec-dot"></span>
      <span class="rec-time" id="recTime">00:00</span>
      <span class="rec-tip" id="recTip">录音中</span>
      <span class="rec-acts">
        <button class="rec-act rec-stop" id="recStop" title="停止并插入">■</button>
        <button class="rec-act rec-x" id="recCancel" title="取消这段录音">✕</button>
      </span>`;
    document.body.appendChild(el);
    const stop = el.querySelector('#recStop');
    const cancel = el.querySelector('#recCancel');
    if (stop) stop.onclick = () => finishVoice();
    if (cancel) {
      cancel.onclick = () => {
        closeVoice();
        toast('已取消录音', '⨯');
      };
    }
  }

  /** 麦克风按钮红色呼吸 */
  function markRecBtn(on) {
    ['btnVoice', 'capVoice'].forEach((id) => {
      const b = $(id);
      if (b) b.classList.toggle('rec-on', !!on);
    });
  }

  function tickTimer() {
    if (!voice) return;
    const sec = Math.floor((Date.now() - voice.startedAt) / 1000);
    voice.duration = sec;
    const t = $('recTime');
    if (t) t.textContent = `${pad(Math.floor(sec / 60))}:${pad(sec % 60)}`;
    if (sec >= 180) finishVoice();
  }

  /** 胶囊上的短状态 + 悬停长说明 */
  function recTip(short, long) {
    const t = $('recTip');
    if (t) t.textContent = short || '录音中';
    const d = $('recDock');
    if (d) d.title = long || short || '';
  }

  function startSpeech(SR) {
    if (!voice) return;
    let finalText = '';
    let rec = null;
    try {
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        let interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        if (voice) voice.text = (finalText + interim).trim();
      };
      rec.onerror = (e) => {
        const fatal = ['network', 'service-not-allowed', 'audio-capture', 'not-allowed'];
        if (fatal.includes(e.error)) {
          try { rec.abort(); } catch (err) { /* ignore */ }
          startRecording('识别不可用，改用录音');
        }
      };
      rec.start();
      voice.mode = 'text';
      voice.rec = rec;
      recTip('实时转写中', '说话内容会实时转成文字，说完点麦克风或胶囊上的停止');
    } catch (e) {
      startRecording();
    }
  }

  let recStopResolve = null;

  /** 录音格式优先级：AAC(.m4a) > webm */
  const REC_MIMES = [
    'audio/mp4;codecs=mp4a.40.2',
    'audio/mp4',
    'audio/webm;codecs=opus',
    'audio/webm'
  ];
  function pickRecordMime() {
    if (!global.MediaRecorder) return '';
    for (const t of REC_MIMES) {
      try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* ignore */ }
    }
    return '';
  }
  /** dataURL 的 mime 只留主类型，方便落盘时选后缀 */
  function mimeOf(dataUrl) {
    const m = /^data:([^;,]+)/i.exec(String(dataUrl || ''));
    return m ? m[1].toLowerCase() : '';
  }
  function extOf(mime) {
    const m = String(mime || '').split(';')[0].trim().toLowerCase();
    if (m === 'audio/mp4' || m === 'audio/aac' || m === 'audio/x-m4a') return 'm4a';
    if (m === 'audio/mpeg') return 'mp3';
    if (m === 'audio/ogg') return 'ogg';
    if (m === 'audio/wav' || m === 'audio/x-wav') return 'wav';
    if (m === 'audio/webm') return 'webm';
    return 'm4a';
  }


  async function startRecording(note) {
    if (!voice) return;
    voice.mode = 'record';
    recTip(note || '录音中', note || '正在录音，说完点麦克风或胶囊上的停止，会自动转成文字');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      recTip('麦克风不可用', '当前环境不支持麦克风，无法录音');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!voice) { stream.getTracks().forEach((t) => t.stop()); return; }
      voice.stream = stream;
      /* 优先录 AAC（.m4a）——体积小、Windows / 手机都能直接播；不行再退回 webm */
      const mime = pickRecordMime();
      const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      voice.rec = rec;
      voice.chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) voice.chunks.push(e.data); };
      rec.onstop = () => {
        const blob = new Blob(voice ? voice.chunks : [], { type: (rec.mimeType || 'audio/webm') });
        if (voice && voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
        const done = recStopResolve;
        recStopResolve = null;
        if (done) done(blob);
      };
      rec.start(200);
    } catch (e) {
      recTip('没有麦克风权限', '请在系统设置里允许「桌面管家」使用麦克风');
    }
  }

  function stopRecording(v) {
    return new Promise((resolve) => {
      if (!v || !v.rec || v.rec.state === 'inactive') { resolve(null); return; }
      recStopResolve = resolve;
      try { v.rec.stop(); } catch (e) { recStopResolve = null; resolve(null); }
    });
  }

  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      if (!blob) { resolve(''); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
  }

  /** 录音先落盘成文件，笔记里只留路径；桌面端绝不再把 base64 塞进正文 */
  async function persistMedia(dataUrl) {
    if (!dataUrl) return '';
    if (global.NoteBridge && NoteBridge.inShell) {
      const saved = await NoteBridge.saveMedia(dataUrl);
      if (saved && saved.url) return saved.url;
      toast('附件保存失败，请检查「附件保存位置」设置', '!');
      return '';
    }
    return dataUrl;
  }

  async function finishVoice() {
    if (!voice || voice.finishing) return;
    const v = voice;
    v.finishing = true;
    v.done = true;
    if (v.timer) clearInterval(v.timer);

    let text = String(v.text || '').trim();

    const finish = async (finalText, mediaDataUrl) => {
      const url = mediaDataUrl ? await persistMedia(mediaDataUrl) : '';
      const dur = `${pad(Math.floor(v.duration / 60))}:${pad(v.duration % 60)}`;
      closeVoice();
      if (finalText && v.onText) v.onText(finalText);
      if (url && v.onMedia) v.onMedia(url, dur);
      if (!finalText && !url) toast('没有识别到内容', '!');
      else toast(finalText ? '语音已转成文字' : '录音已插入', '🎙️');
    };

    if (v.mode === 'record' && v.rec && v.rec.state !== 'inactive') {
      recTip('正在保存录音…', '正在把录音写成音频文件');
      let blob = null;
      try { blob = await stopRecording(v); } catch (e) { /* ignore */ }
      const dataUrl = blob ? await blobToDataURL(blob) : '';
      const mime = mimeOf(dataUrl) || (blob && blob.type) || 'audio/webm';
      const dur = `${pad(Math.floor(v.duration / 60))}:${pad(v.duration % 60)}`;
      const onText = v.onText;
      const onMedia = v.onMedia;

      /* 先把录音落盘成音频文件，再让用户决定要不要转文字 */
      const url = dataUrl ? await persistMedia(dataUrl) : '';
      closeVoice();
      if (!dataUrl) { toast('没有录到声音', '!'); return; }
      if (!url) return;
      if (text) { /* 浏览器实时识别已经拿到文字：直接问要不要一起插录音 */
        askVoiceAction({ url, dataUrl, mime, dur, text, onText, onMedia });
        return;
      }
      askVoiceAction({ url, dataUrl, mime, dur, onText, onMedia });
      return;
    }

    if (v.rec && v.rec.state !== 'inactive') {
      try { v.rec.stop(); } catch (e) { /* ignore */ }
    }
    await finish(text, text ? '' : v.mediaUrl);
  }

  /**
   * 录完不再自动转写：先给出录音文件，让用户选「转文字 / 只插录音 / 丢弃」。
   * 转写用的是内存里的原始 dataURL，落盘的音频不动，随时可以回去听。
   */
  function askVoiceAction(ctx) {
    const old = $('voiceAsk');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'voice-ask';
    el.id = 'voiceAsk';
    el.innerHTML = `
      <span class="va-ic">🎙️</span>
      <div class="va-body">
        <b>录音 ${esc(ctx.dur)}</b>
        <i id="vaNote">已存为 ${esc(extOf(ctx.mime).toUpperCase())}，要转成文字吗？</i>
      </div>
      <div class="va-acts">
        <button class="btn btn-sm btn-primary" data-va="text">转成文字</button>
        ${(global.NoteBridge && NoteBridge.officeAutoSupported && NoteBridge.officeAutoSupported())
          ? '<button class="btn btn-sm btn-ghost" data-va="office">办公网转写</button>'
          : ''}
        <button class="btn btn-sm btn-ghost" data-va="summary">录音总结</button>
        <button class="btn btn-sm btn-ghost" data-va="media">只插入录音</button>
        <button class="btn btn-sm btn-ghost" data-va="drop">丢弃</button>
      </div>`;
    document.body.appendChild(el);
    const note = el.querySelector('#vaNote');
    const kill = () => el.remove();
    const lock = (on) => el.querySelectorAll('[data-va]').forEach((b) => { b.disabled = on; });

    /* 转写只做一次：总结前已有文字就直接复用，避免重复计费 */
    let asrText = String(ctx.text || '').trim();
    async function ensureText() {
      if (asrText) return asrText;
      const cfg = global.AI ? await AI.getConfig() : null;
      if (!cfg || !AI.asrReady(cfg)) throw new Error('还没配置语音识别（设置 → AI 模型 → 语音识别）');
      const out = await AI.transcribe(ctx.dataUrl, ctx.mime);
      if (!out) throw new Error('没有识别到说话内容');
      asrText = out;
      return out;
    }

    el.querySelector('[data-va="media"]').onclick = () => {
      kill();
      if (ctx.onMedia) ctx.onMedia(ctx.url, ctx.dur);
      toast('录音已插入', '🎙️');
    };

    el.querySelector('[data-va="drop"]').onclick = async () => {
      kill();
      if (ctx.url && global.NoteBridge && NoteBridge.removeMedia) {
        try { await NoteBridge.removeMedia(ctx.url); } catch (e) { /* ignore */ }
      }
      toast('已丢弃这段录音', '⨯');
    };

    /* 办公网转写：录音文件直接注入内网工作台，自动读回转写结果。
       站点不接受音频文件时降级为手动（拖文件进工作台 → 复制回复 → 贴回）。 */
    const obtn = el.querySelector('[data-va="office"]');
    if (obtn) obtn.onclick = async () => {
      lock(true);
      obtn.textContent = '转写中…';
      const prompt = '转写这段语音的内容，按要点整理；直接输出转写文字和要点，不要寒暄';
      if (note) note.textContent = '正在把录音注入办公网工作台…';
      let r = null;
      try {
        r = await NoteBridge.officeAuto({
          type: 'file',
          dataUrl: ctx.dataUrl,
          mime: ctx.mime || 'audio/webm',
          name: 'recording.' + extOf(ctx.mime || 'audio/webm'),
          prompt
        });
      } catch (e) {
        r = { ok: false, manual: true, error: String((e && e.message) || e) };
      }
      if (r && r.ok && r.text && r.text.trim()) {
        kill();
        if (ctx.onText) ctx.onText(r.text.trim());
        toast('办公网转写完成，文字已插入', '🎙️');
        return;
      }
      /* 降级：给手动路径一个「贴回结果」按钮 */
      obtn.textContent = '贴回转写结果';
      const manualHint = (r && r.error) || '自动转写没有读到结果';
      if (note) {
        note.textContent = manualHint + '。可以在工作台里手动处理录音（拖入发送），回复复制后点「贴回转写结果」';
        note.id = 'vaNote';
      }
      obtn.onclick = async () => {
        const rr = await NoteBridge.officeReadText();
        const text = rr && rr.ok ? String(rr.text || '').trim() : '';
        if (!text) { toast((rr && rr.error) || '剪贴板是空的，请先复制工作台的回复', '!'); return; }
        kill();
        if (ctx.onText) ctx.onText(text);
        toast('转写结果已插入', '🎙️');
      };
      lock(false);
    };

    const tbtn = el.querySelector('[data-va="text"]');
    tbtn.onclick = async () => {
      lock(true);
      tbtn.textContent = '转写中…';
      if (note) note.textContent = '正在把语音转成文字…';
      try {
        const out = await ensureText();
        kill();
        if (ctx.onText) ctx.onText(out);
        toast('语音已转成文字', '🎙️');
      } catch (e) {
        lock(false);
        tbtn.textContent = '转成文字';
        if (note) note.textContent = '转写失败：' + ((e && e.message) || e);
      }
    };

    /* 录音总结：转写 → 模型整理成结构化笔记，原录音一并留档 */
    const sbtn = el.querySelector('[data-va="summary"]');
    sbtn.onclick = async () => {
      lock(true);
      sbtn.textContent = '总结中…';
      if (note) note.textContent = asrText ? '正在生成总结…' : '正在把语音转成文字…';
      try {
        const text = await ensureText();
        if (note) note.textContent = '正在生成总结…';
        const cfg = global.AI ? await AI.getConfig() : null;
        if (!cfg || !AI.isReady(cfg)) throw new Error('还没配置 AI 模型（设置 → AI 模型）');
        const raw = await AI.chat(summaryMessages(text, ctx.dur), { temperature: 0.3, maxTokens: 900 });
        const summary = cleanSummary(raw);
        if (!summary) throw new Error('没生成出内容');
        kill();
        if (ctx.onText) ctx.onText(`\n\n> 🎙 录音总结 · ${ctx.dur}\n\n${summary}\n`);
        if (ctx.url && ctx.onMedia) ctx.onMedia(ctx.url, ctx.dur);
        toast('录音已总结并插入', '📝');
      } catch (e) {
        lock(false);
        sbtn.textContent = '录音总结';
        if (note) note.textContent = '总结失败：' + ((e && e.message) || e);
      }
    };
  }

  /** 录音总结的提示词：只整理，不编造，输出固定四段 */
  function summaryMessages(text, dur) {
    const body = String(text || '').slice(0, 12000);
    return [
      {
        role: 'system',
        content: '你是录音整理助手。把口语转写整理成结构清晰的中文笔记：保留人名、时间、数字、决定、待办，删掉语气词、重复和跑题内容，绝不编造转写里没有的信息。只输出整理结果，不要开场白，不要解释你在做什么。'
      },
      {
        role: 'user',
        content: `录音时长 ${dur}，转写如下：\n"""\n${body}\n"""\n\n请按这个格式输出（没有的段落整段省略）：\n**主旨**：一句话概括，不超过 40 字\n\n**要点**\n- 每条一行，最多 6 条\n\n**待办**\n- 要做的事，带上提到的人或时间\n\n**结论**\n- 明确的决定或结论`
      }
    ];
  }

  function cleanSummary(s) {
    return String(s || '')
      .replace(/^```[a-z]*\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .replace(/^(好的|以下是|这是)[^\n]*\n+/, '')
      .trim();
  }

  function closeVoice() {
    const el = $('recDock');
    if (el) el.remove();
    markRecBtn(false);
    if (voice) {
      if (voice.timer) clearInterval(voice.timer);
      try { if (voice.rec && voice.rec.state !== 'inactive') voice.rec.stop(); } catch (e) { /* ignore */ }
      if (voice.stream) voice.stream.getTracks().forEach((t) => t.stop());
      voice = null;
    }
    if (global.__guimo && global.__guimo.focusContent) setTimeout(() => global.__guimo.focusContent(), 30);
  }

  /* ── 编辑器里的手写 / 语音入口 ── */
  function insertHandwriting() {
    const cur = global.__guimo && global.__guimo.currentId;
    if (!cur) { toast('先打开一篇笔记，再插入手写', '!'); return; }
    openHandwriting(async (url, oldUrl, mode) => {
      const kind = mode === 'flow' ? '流程图' : '手写';
      if (global.__guimo) global.__guimo.insertAt(`\n\n![${kind} ${fullDay(Date.now())} ${clockText(Date.now())}](${url})\n`);
    });
  }

  function insertVoice() {
    const cur = global.__guimo && global.__guimo.currentId;
    if (!cur) { toast('先打开一篇笔记，再插入语音', '!'); return; }
    openVoice({
      onText: (text) => {
        if (global.__guimo) global.__guimo.insertAt(text + '\n');
      },
      onMedia: (url, dur) => {
        if (global.__guimo) global.__guimo.insertAt(`\n\n[🎙 语音 ${dur}](${url})\n`);
      }
    });
  }

  /* ═══════════════ 设置：类型管理 ═══════════════ */
  function openKindSettings() {
    const kinds = Store.allKinds();
    const rows = kinds.map((k) => {
      const t = tplById(k.templateId);
      const nb = Store.notebookOf(k.notebookId);
      return `<div class="km-row${k.hidden ? ' off' : ''}" style="--k:${k.color}">
        <span class="km-ic">${k.icon}</span>
        <div class="km-main">
          <b>${esc(k.name)}${k.builtin ? '<em>内置</em>' : ''}${k.hidden ? '<em class="off">已隐藏</em>' : ''}</b>
          <i>${esc(k.desc || '')} · ${t ? esc(t.name) : '空白'} · ${nb ? esc(nb.name) : '每日工作'}${(k.subs || []).length ? ` · ${k.subs.length} 个细分` : ''}</i>
        </div>
        <button class="btn btn-sm btn-ghost" data-km-edit="${esc(k.id)}">编辑</button>
        <button class="btn btn-sm btn-ghost km-del" data-km-del="${esc(k.id)}">${k.builtin ? (k.hidden ? '恢复' : '隐藏') : '删除'}</button>
      </div>`;
    }).join('');

    global.__guimo.modal(`
      <div class="modal-head">
        <div><h3>随手记类型</h3><p>每个类型绑定一个默认模板与笔记本；隐藏的类型可以随时恢复</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="km-list">${rows}</div>
      </div>
      <div class="modal-foot">
        <div class="left">
          <button class="btn btn-sm btn-ghost" id="btnKindNew">＋ 新建类型</button>
          <button class="btn btn-sm btn-ghost" id="btnKindReset">恢复默认</button>
        </div>
        <button class="btn btn-primary" data-action="close">完成</button>
      </div>`, { size: 'wide' });

    document.querySelectorAll('[data-km-edit]').forEach((b) => {
      b.onclick = () => openKindEditor(b.dataset.kmEdit);
    });
    document.querySelectorAll('[data-km-del]').forEach((b) => {
      b.onclick = () => {
        const k = kindOf(b.dataset.kmDel);
        if (!k) return;
        if (k.builtin && k.hidden) {
          Store.updateKind(k.id, { hidden: false });
          openKindSettings();
          return;
        }
        if (!confirm(k.builtin ? `隐藏「${k.name}」这个类型？\n已写的笔记不受影响。` : `删除类型「${k.name}」？\n已写的笔记不受影响。`)) return;
        Store.deleteKind(k.id);
        openKindSettings();
      };
    });
    $('btnKindNew').onclick = () => openKindEditor(null);
    $('btnKindReset').onclick = () => {
      if (!confirm('恢复默认类型？\n自定义类型会被清空，内置类型的隐藏状态会重置，笔记不受影响。')) return;
      Store.restoreKinds();
      openKindSettings();
    };
  }

  function openKindEditor(kindId) {
    const isNew = !kindId;
    const k = isNew
      ? { id: '', name: '', icon: '📝', color: KIND_COLORS[0], desc: '', notebookId: 'nb-daily', templateId: 'tpl-blank', subs: [] }
      : JSON.parse(JSON.stringify(kindOf(kindId)));
    kindForm = { id: kindId || '', color: k.color, subs: (k.subs || []).map((s) => Object.assign({}, s)) };

    const nbs = Store.state.notebooks.filter((b) => !(b.group || Store.notebookKids(b.id).length));
    const nbOpts = nbs.map((b) => {
      const parent = b.parentId ? Store.notebookOf(b.parentId) : null;
      return `<option value="${b.id}"${b.id === k.notebookId ? ' selected' : ''}>${parent ? `　└ ` : ''}${esc(b.name)}</option>`;
    }).join('');

    global.__guimo.modal(`
      <div class="modal-head">
        <div><h3>${isNew ? '新建笔记类型' : '编辑笔记类型'}</h3><p>类型决定「随手记」里出现什么，以及默认用哪个模板</p></div>
        <button class="modal-close" data-action="close"><svg viewBox="0 0 24 24" fill="none"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      </div>
      <div class="modal-body">
        <div class="field-row ke-row">
          <div class="field ke-icon-field">
            <label>图标</label>
            <input type="text" id="keIcon" value="${esc(k.icon)}" maxlength="4">
          </div>
          <div class="field" style="flex:1">
            <label>名称</label>
            <input type="text" id="keName" value="${esc(k.name)}" placeholder="例如：需求澄清" maxlength="20">
          </div>
        </div>
        <div class="field">
          <label>一句话说明</label>
          <input type="text" id="keDesc" value="${esc(k.desc || '')}" placeholder="显示在类型卡片上，帮助自己快速选对" maxlength="40">
        </div>
        <div class="field">
          <label>颜色</label>
          <div class="ke-colors" id="keColors">
            ${KIND_COLORS.map((c) => `<button type="button" data-ke-color="${c}" class="${c === k.color ? 'on' : ''}" style="background:${c}"></button>`).join('')}
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>默认模板</label>
            <select id="keTpl"></select>
          </div>
          <div class="field">
            <label>保存到笔记本</label>
            <select id="keNb">${nbOpts}</select>
          </div>
        </div>
        <div class="field">
          <label>细分（可选）</label>
          <div class="ke-subs" id="keSubs"></div>
          <button type="button" class="btn btn-sm btn-ghost ke-addsub" id="keAddSub">＋ 添加细分</button>
        </div>
      </div>
      <div class="modal-foot">
        <div class="left">${isNew || k.builtin ? '' : `<button class="btn btn-sm btn-ghost km-del" id="keDel">删除类型</button>`}</div>
        <button class="btn btn-ghost" data-action="close">取消</button>
        <button class="btn btn-primary" id="keSave">保存</button>
      </div>`, { size: 'mid' });

    renderKeTpl(k.templateId);
    renderKeSubs();

    document.querySelectorAll('[data-ke-color]').forEach((b) => {
      b.onclick = () => {
        kindForm.color = b.dataset.keColor;
        document.querySelectorAll('[data-ke-color]').forEach((x) => x.classList.toggle('on', x === b));
      };
    });
    $('keAddSub').onclick = () => {
      kindForm.subs.push({ id: 'sub-' + Date.now().toString(36), name: '', templateId: $('keTpl').value || '', notebookId: $('keNb').value });
      renderKeSubs();
    };
    $('keSave').onclick = () => {
      const name = $('keName').value.trim();
      if (!name) { toast('请填写类型名称', '!'); return; }
      const data = {
        name,
        icon: $('keIcon').value.trim() || '📝',
        desc: $('keDesc').value.trim(),
        color: kindForm.color,
        templateId: $('keTpl').value || '',
        notebookId: $('keNb').value,
        subs: collectKeSubs()
      };
      if (isNew) Store.addKind(Object.assign({ builtin: false, hidden: false }, data));
      else Store.updateKind(k.id, Object.assign({ hidden: false }, data));
      openKindSettings();
      toast(isNew ? '类型已创建' : '类型已保存', '✓');
    };
    if ($('keDel')) {
      $('keDel').onclick = () => {
        if (!confirm(`删除类型「${k.name}」？已写的笔记不受影响。`)) return;
        Store.deleteKind(k.id);
        openKindSettings();
      };
    }
  }

  function renderKeTpl(selected) {
    const sel = $('keTpl');
    if (!sel) return;
    const list = allTemplates();
    const groups = [
      ['dev', '项目与研发'], ['log', '日志'], ['meeting', '会议'], ['ops', '运维与变更'],
      ['summary', '总结'], ['biz', '业务'], ['other', '其他'], ['custom', '自定义模板']
    ];
    const opts = ['<option value="">空白（不用模板）</option>'];
    groups.forEach(([key, label]) => {
      const items = list.filter((t) => (t.builtin ? (t.category || 'other') : 'custom') === key);
      if (!items.length) return;
      opts.push(`<optgroup label="${label}">${items.map((t) => `<option value="${t.id}">${esc(t.icon || '')} ${esc(t.name)}</option>`).join('')}</optgroup>`);
    });
    sel.innerHTML = opts.join('');
    sel.value = selected || '';
  }

  function renderKeSubs() {
    const box = $('keSubs');
    if (!box) return;
    if (!kindForm.subs.length) {
      box.innerHTML = '<div class="ke-subs-empty">例如「项目工作」可以细分：需求分析 / 开发实施 / 上线投产</div>';
      return;
    }
    const list = allTemplates();
    box.innerHTML = kindForm.subs.map((s, i) => `<div class="ke-sub" data-sub-row="${i}">
      <input type="text" data-sub-name value="${esc(s.name)}" placeholder="细分名称" maxlength="16">
      <select data-sub-tpl>
        <option value="">空白</option>
        ${list.map((t) => `<option value="${t.id}"${t.id === s.templateId ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}
      </select>
      <button type="button" class="ke-sub-del" data-sub-del="${i}" title="删除">✕</button>
    </div>`).join('');
    box.querySelectorAll('[data-sub-del]').forEach((b) => {
      b.onclick = () => {
        kindForm.subs.splice(Number(b.dataset.subDel), 1);
        renderKeSubs();
      };
    });
  }

  function collectKeSubs() {
    const rows = document.querySelectorAll('#keSubs [data-sub-row]');
    const out = [];
    rows.forEach((r) => {
      const name = r.querySelector('[data-sub-name]').value.trim();
      const tpl = r.querySelector('[data-sub-tpl]').value;
      if (!name) return;
      const i = Number(r.dataset.subRow);
      const prev = kindForm.subs[i] || {};
      out.push({ id: prev.id || ('sub-' + Math.random().toString(36).slice(2, 7)), name, templateId: tpl, notebookId: prev.notebookId || $('keNb').value });
    });
    return out;
  }

  /* ═══════════════ 导出 ═══════════════ */
  global.HomeUI = {
    openCapture,
    closeCapture,
    openLookup,
    renderLookupChips,
    openKindSettings,
    openKindEditor,
    insertHandwriting,
    insertVoice,
    openHandwriting,
    openVoice,
    editFlowAtCursor,
    editFlowByUrl
  };
})(window);
