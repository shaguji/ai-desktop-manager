/* ═══════════════════════════════════════════════════
   密码箱 —— 界面层
   · 未创建：设置主密码
   · 已创建未解锁：输入主密码解锁
   · 已解锁：左侧条目列表，右侧编辑（自动加密保存）
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  let pane = null;
  let bound = false;
  let query = '';
  let selected = null;
  let saveTimer = null;
  let revealed = false;
  let lastError = '';

  function toast(msg, icon) {
    const wrap = $('toastWrap');
    if (!wrap) return;
    const d = document.createElement('div');
    d.className = 'toast';
    d.innerHTML = `<span class="t-ic">${icon || '✓'}</span><span>${esc(msg)}</span>`;
    wrap.appendChild(d);
    setTimeout(() => {
      d.style.transition = 'opacity .2s, transform .2s';
      d.style.opacity = '0';
      d.style.transform = 'translateY(6px)';
      setTimeout(() => d.remove(), 220);
    }, 2100);
  }

  function fullTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function hostOf(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    try {
      return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).host;
    } catch (e) {
      return u.slice(0, 40);
    }
  }

  function normUrl(url) {
    const u = String(url || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
  }

  async function copy(text, label) {
    const val = String(text || '');
    if (!val) { toast('没有可复制的内容', '!'); return; }
    try {
      await navigator.clipboard.writeText(val);
      toast(`已复制${label || ''}到剪贴板`, '📋');
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = val;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(`已复制${label || ''}到剪贴板`, '📋'); }
      catch (err) { toast('复制失败，请手动选择', '!'); }
      ta.remove();
    }
  }

  /* ───────── 三种状态 ───────── */

  function lockedHtml() {
    const exists = Vault.has();
    if (!exists) {
      return `<div class="vault-locked">
        <div class="vl-card">
          <div class="vl-ic">🔐</div>
          <h3>创建密码箱</h3>
          <p>用主密码加密保存各类网址、账号和密码。<br>密文只存在本机，换设备或忘记主密码都无法恢复。</p>
          <input id="vaultPwd" type="password" placeholder="设置主密码（至少 6 位）" autocomplete="new-password">
          <input id="vaultPwd2" type="password" placeholder="再输入一次" autocomplete="new-password">
          <div class="vl-err" id="vaultErr" ${lastError ? '' : 'hidden'}>${esc(lastError)}</div>
          <button class="btn btn-primary" id="vaultCreate">创建并解锁</button>
          <p class="vl-hint">忘记主密码无法找回，也不会同步到云端</p>
        </div>
      </div>`;
    }
    return `<div class="vault-locked">
      <div class="vl-card">
        <div class="vl-ic">🔒</div>
        <h3>密码箱已锁定</h3>
        <p>输入主密码解锁。5 分钟无操作会自动锁定。</p>
        <input id="vaultPwd" type="password" placeholder="主密码" autocomplete="current-password">
        <div class="vl-err" id="vaultErr" ${lastError ? '' : 'hidden'}>${esc(lastError)}</div>
        <button class="btn btn-primary" id="vaultUnlock">解锁</button>
        <button class="link-btn" id="vaultReset">忘记密码？清空密码箱</button>
      </div>
    </div>`;
  }

  function entryCard(it) {
    const on = it.id === selected;
    const host = hostOf(it.url);
    return `<div class="vault-item${on ? ' active' : ''}" data-vid="${it.id}">
      <div class="vi-avatar">${esc((it.site || '?').slice(0, 1))}</div>
      <div class="vi-main">
        <div class="vi-site">${esc(it.site || '未命名')}</div>
        <div class="vi-sub">${esc(it.username || host || '—')}</div>
      </div>
    </div>`;
  }

  function detailHtml(it) {
    if (!it) {
      return `<div class="vault-placeholder">
        <div class="vp-ic">🗝️</div>
        <p>选择左侧记录查看详情，或点「新增」添加一条。</p>
      </div>`;
    }
    const host = hostOf(it.url);
    return `<div class="vault-detail-inner">
      <div class="vd-head">
        <div>
          <h3>${esc(it.site || '未命名')}</h3>
          <p>${host ? esc(host) : '未填写网址'} · 更新于 ${fullTime(it.updatedAt)}</p>
        </div>
        <div class="vd-actions">
          <span class="vd-saved" id="vaultSaved">已加密保存</span>
          <button class="btn btn-sm btn-ghost vd-del" id="vaultDel">删除</button>
        </div>
      </div>

      <div class="field">
        <label>站点名称</label>
        <input type="text" id="vSite" value="${esc(it.site)}" placeholder="例如：内部运维平台">
      </div>

      <div class="field">
        <label>网址</label>
        <div class="vd-row">
          <input type="text" id="vUrl" value="${esc(it.url)}" placeholder="https://…">
          <button class="btn btn-sm btn-ghost" id="vOpen">打开</button>
        </div>
      </div>

      <div class="field">
        <label>用户名 / 账号</label>
        <div class="vd-row">
          <input type="text" id="vUser" value="${esc(it.username)}" placeholder="登录账号">
          <button class="btn btn-sm btn-ghost" id="vCopyUser">复制</button>
        </div>
      </div>

      <div class="field">
        <label>密码</label>
        <div class="vd-row">
          <input type="${revealed ? 'text' : 'password'}" id="vPass" value="${esc(it.password)}" placeholder="密码" autocomplete="off">
          <button class="btn btn-sm btn-ghost" id="vToggle">${revealed ? '隐藏' : '显示'}</button>
          <button class="btn btn-sm btn-soft" id="vCopyPass">复制</button>
        </div>
        <div class="hint">密码只在解锁后的内存里出现，落盘内容是 AES-GCM 密文</div>
      </div>

      <div class="field">
        <label>备注</label>
        <textarea id="vNote" rows="3" placeholder="用途、密保问题、申请流程…">${esc(it.note)}</textarea>
      </div>
    </div>`;
  }

  function unlockedHtml() {
    const all = Vault.entries();
    const kw = query.trim().toLowerCase();
    const list = kw
      ? all.filter((x) => [x.site, x.url, x.username, x.note].join(' ').toLowerCase().includes(kw))
      : all;
    if (selected && !list.some((x) => x.id === selected)) selected = list.length ? list[0].id : null;
    if (!selected && list.length) selected = list[0].id;
    const cur = list.find((x) => x.id === selected) || all.find((x) => x.id === selected) || null;

    return `<div class="vault-head">
        <div class="vh-title">
          <span class="vh-lock">🔓</span>
          <div>
            <h2>密码箱</h2>
            <p>共 ${all.length} 条 · 仅本机、加密保存</p>
          </div>
        </div>
        <div class="vh-actions">
          <input id="vaultSearch" type="text" placeholder="搜索站点 / 账号" value="${esc(query)}">
          <button class="btn btn-primary btn-sm" id="vaultNew">＋ 新增</button>
          <button class="btn btn-ghost btn-sm" id="vaultLock">锁定</button>
        </div>
      </div>
      <div class="vault-body">
        <div class="vault-list">${list.length ? list.map(entryCard).join('')
          : `<div class="vault-empty">${kw ? '没有匹配的记录' : '还没有记录，点「新增」添加第一条'}</div>`}</div>
        <div class="vault-detail" id="vaultDetail">${detailHtml(cur)}</div>
      </div>`;
  }

  function render() {
    if (!pane) pane = $('vaultPane');
    if (!pane) return;
    pane.innerHTML = Vault.isUnlocked() ? unlockedHtml() : lockedHtml();
    pane.onscroll = null;
  }

  /* ───────── 事件 ───────── */

  function readDraft() {
    const it = Vault.find(selected);
    if (!it) return null;
    return {
      id: it.id,
      site: $('vSite') ? $('vSite').value : it.site,
      url: $('vUrl') ? $('vUrl').value : it.url,
      username: $('vUser') ? $('vUser').value : it.username,
      password: $('vPass') ? $('vPass').value : it.password,
      note: $('vNote') ? $('vNote').value : it.note
    };
  }

  function scheduleSave() {
    const saved = $('vaultSaved');
    if (saved) saved.textContent = '正在保存…';
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 600);
  }

  /** 立即把当前表单内容加密保存（切条目 / 搜索 / 锁定时先落盘） */
  function flushSave() {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    const d = readDraft();
    if (!d) return;
    void Vault.update(d.id, {
      site: d.site, url: d.url, username: d.username, password: d.password, note: d.note
    });
    const s2 = $('vaultSaved');
    if (s2) s2.textContent = '已加密保存';
    /* 列表标题跟着走，不重绘以免输入框失焦 */
    const card = pane.querySelector(`[data-vid="${d.id}"]`);
    if (card) {
      const site = card.querySelector('.vi-site');
      const sub = card.querySelector('.vi-sub');
      if (site) site.textContent = d.site || '未命名';
      if (sub) sub.textContent = d.username || hostOf(d.url) || '—';
    }
    const h3 = pane.querySelector('.vd-head h3');
    if (h3) h3.textContent = d.site || '未命名';
  }

  async function createSubmit() {
    const p1 = $('vaultPwd');
    const p2 = $('vaultPwd2');
    const err = $('vaultErr');
    const show = (msg) => { lastError = msg; if (err) { err.textContent = msg; err.hidden = !msg; } };
    if (!p1 || !p2) return;
    if (p1.value !== p2.value) { show('两次输入的主密码不一致'); return; }
    if (p1.value.length < 6) { show('主密码至少 6 位'); return; }
    try {
      await Vault.create(p1.value);
      lastError = '';
      toast('密码箱已创建并解锁', '🔐');
      render();
      if (global.__guimo) global.__guimo.refreshSidebar();
    } catch (e) {
      show(e.message || '创建失败');
    }
  }

  async function unlockSubmit() {
    const p = $('vaultPwd');
    const err = $('vaultErr');
    if (!p) return;
    try {
      await Vault.unlock(p.value);
      lastError = '';
      render();
      if (global.__guimo) global.__guimo.refreshSidebar();
      toast('密码箱已解锁', '🔓');
    } catch (e) {
      lastError = e.message || '解锁失败';
      if (err) { err.textContent = lastError; err.hidden = false; }
      p.select();
    }
  }

  function bind() {
    if (bound) return;
    bound = true;

    document.addEventListener('click', async (e) => {
      if (!pane || pane.hidden) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (pane.contains(t)) Vault.touch();

      if (t.closest('#vaultCreate')) { void createSubmit(); return; }
      if (t.closest('#vaultUnlock')) { void unlockSubmit(); return; }
      if (t.closest('#vaultLock')) {
        /* 先把没落盘的输入加密写完，再清空内存 */
        flushSave();
        setTimeout(() => {
          Vault.lock();
          selected = null;
          revealed = false;
          render();
          if (global.__guimo) global.__guimo.refreshSidebar();
          toast('密码箱已锁定', '🔒');
        }, 220);
        return;
      }
      if (t.closest('#vaultReset')) {
        if (!confirm('清空密码箱会永久删除其中所有记录，且无法恢复。确定继续吗？')) return;
        Vault.destroy();
        lastError = '';
        render();
        if (global.__guimo) global.__guimo.refreshSidebar();
        toast('密码箱已清空', '🗑️');
        return;
      }
      if (t.closest('#vaultNew')) {
        const it = await Vault.add({ site: '新记录', url: '', username: '', password: '', note: '' });
        selected = it.id;
        revealed = false;
        render();
        const s = $('vSite');
        if (s) { s.focus(); s.select(); }
        return;
      }
      const item = t.closest('[data-vid]');
      if (item) {
        flushSave();
        selected = item.dataset.vid;
        revealed = false;
        render();
        return;
      }
      if (t.closest('#vToggle')) {
        revealed = !revealed;
        const inp = $('vPass');
        if (inp) inp.type = revealed ? 'text' : 'password';
        t.closest('#vToggle').textContent = revealed ? '隐藏' : '显示';
        return;
      }
      if (t.closest('#vCopyPass')) { void copy($('vPass') && $('vPass').value, '密码'); return; }
      if (t.closest('#vCopyUser')) { void copy($('vUser') && $('vUser').value, '账号'); return; }
      if (t.closest('#vOpen')) {
        const url = normUrl($('vUrl') && $('vUrl').value);
        if (!url) { toast('还没有填写网址', '!'); return; }
        global.open(url, '_blank', 'noopener');
        return;
      }
      if (t.closest('#vaultDel')) {
        const it = Vault.find(selected);
        if (!it) return;
        if (!confirm(`删除记录「${it.site || '未命名'}」？删除后无法恢复。`)) return;
        await Vault.remove(it.id);
        selected = null;
        render();
        if (global.__guimo) global.__guimo.refreshSidebar();
        toast('记录已删除', '🗑️');
      }
    });

    document.addEventListener('input', (e) => {
      if (!pane || pane.hidden) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.id === 'vaultSearch') {
        flushSave();
        query = t.value;
        render();
        const s = $('vaultSearch');
        if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
        return;
      }
      if (['vSite', 'vUrl', 'vUser', 'vPass', 'vNote'].includes(t.id)) scheduleSave();
    });

    document.addEventListener('keydown', (e) => {
      if (!pane || pane.hidden) return;
      if (e.key === 'Enter' && (e.target.id === 'vaultPwd' || e.target.id === 'vaultPwd2')) {
        e.preventDefault();
        if (Vault.has()) void unlockSubmit();
        else void createSubmit();
      }
    });

    Vault.onChange(() => {
      if (pane && !pane.hidden) render();
    });
  }

  /** 进入密码箱视图时调用 */
  function mount() {
    pane = pane || $('vaultPane');
    bind();
    render();
  }

  global.VaultUI = {
    mount,
    render,
    /** 侧栏计数：解锁后显示条数，锁定状态不泄露数量 */
    count() {
      if (!Vault.isUnlocked()) return '—';
      return Vault.entries().length;
    },
    reset() {
      query = '';
      selected = null;
      revealed = false;
      lastError = '';
    }
  };
})(window);
