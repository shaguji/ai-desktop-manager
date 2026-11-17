/* ═══════════════════════════════════════════════════
   轻量 Markdown 渲染器（零依赖）
   · 标题 / 列表 / 任务 / 表格 / 引用 / 代码块 / 分割线
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  /* ── 链接安全 ──
     渲染层来自笔记正文（可能粘贴任何外部内容），是最低信任级别的输入。
     可点击的 <a> 只允许 http/https/mailto：javascript:、data:、vbscript:
     以及 file:（不想让正文里的链接打开本地任意文件）一律降级成纯文本。
     图片 / 音频的 src 走另一份白名单：媒体需要 file:（附件）和 data:image
     才能显示，但 src 属性不会执行脚本，风险只有「外链回传」这一档。 */
  function safeHref(h) {
    const raw = String(h || '').trim();
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):/.exec(raw);
    if (!m) return null; /* 无协议的相对路径同样不可点击 */
    const proto = m[1].toLowerCase();
    return (proto === 'http' || proto === 'https' || proto === 'mailto') ? raw : null;
  }

  function safeSrc(h) {
    const raw = String(h || '').trim();
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]{1,31}):/.exec(raw);
    if (!m) return raw; /* 相对路径留给附件目录引用 */
    const proto = m[1].toLowerCase();
    if (proto === 'http' || proto === 'https' || proto === 'file') return raw;
    if (proto === 'data' && /^(data:image\/|data:audio\/|data:video\/)/i.test(raw)) return raw;
    return ''; /* 非媒体 data:（如 data:text/html）直接丢弃 */
  }

  function inline(text) {
    const codes = [];
    let s = esc(text);
    s = s.replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push(c);
      return '\u0001' + (codes.length - 1) + '\u0001';
    });
    s = s.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
    s = s.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g,
      (m, alt, src) => `<img src="${safeSrc(src)}" alt="${alt}" loading="lazy">`);
    /* 语音附件：[🎙 语音 00:23](url) → 可播放的音频条 */
    s = s.replace(/\[([^\]\n]*🎙[^\]\n]*)\]\(([^)\s]+)\)/g,
      (m, label, src) => `<span class="md-audio"><span class="ma-label">${label}</span><audio controls preload="none" src="${safeSrc(src)}"></audio></span>`);
    s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g,
      (m, t, h) => {
        const u = safeHref(h);
        /* 协议不在白名单里：只渲染文字，不再产出可点击的 <a> */
        return u
          ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`
          : `<span class="md-link-off" title="为安全起见，仅支持 http/https/mailto 链接">${t}</span>`;
      });
    s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g,
      (m, h) => `<a href="${h}" target="_blank" rel="noopener noreferrer">${h}</a>`);
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => `<code>${codes[+i]}</code>`);
    return s;
  }

  const LIST_RE = /^(\s*)([-*+]|\d{1,3}\.)\s+(.*)$/;

  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  function parseList(lines, start) {
    const first = lines[start].match(LIST_RE);
    const baseIndent = first[1].length;
    const ordered = /\d/.test(first[2]);
    const tag = ordered ? 'ol' : 'ul';
    let html = `<${tag}>`;
    let i = start;

    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*$/.test(line)) break;

      const m = line.match(LIST_RE);
      if (!m || m[1].length !== baseIndent) break;

      if (m[1].length === baseIndent && !ordered && /^[-*+]$/.test(m[2])) {
        // 继续当前层级
      }
      if (m[1].length === baseIndent && ordered !== /\d/.test(m[2])) break;

      const itemLine = i;
      let text = m[3];
      i++;

      // 收集嵌套 / 续行
      let nested = '';
      while (i < lines.length) {
        const n = lines[i];
        if (/^\s*$/.test(n)) break;
        const nm = n.match(LIST_RE);
        if (nm && nm[1].length > baseIndent) {
          const sub = parseList(lines, i);
          nested += sub.html;
          i = sub.next;
          continue;
        }
        if (!nm && /^\s{2,}\S/.test(n)) {
          nested += `<div class="li-cont">${inline(n.trim())}</div>`;
          i++;
          continue;
        }
        break;
      }

      const task = text.match(/^\[([ xX\/])\]\s*(.*)$/);
      if (task) {
        const ch = task[1].toLowerCase();
        const state = ch === 'x' ? 'done' : ch === '/' ? 'doing' : 'todo';
        let label = task[2];
        let sticky = '';
        const sm = label.match(/<!--\s*s:([\w-]+)\s*-->/);
        if (sm) {
          sticky = sm[1];
          label = label.replace(/<!--\s*s:[\w-]+\s*-->/, '').trim();
        }
        html += `<li class="task-item state-${state}${sticky ? ' task-sticky' : ''}"${sticky ? ` data-sticky="${sticky}"` : ''}>`
          + `<button type="button" class="task-check" data-line="${itemLine}" data-state="${state}" `
          + `title="${state === 'todo' ? '未开始' : state === 'doing' ? '进行中' : '已完成'}（点击切换）" `
          + `aria-label="切换状态"></button>`
          + `<span class="task-text">${inline(label)}</span></li>`;
      } else {
        html += `<li>${inline(text)}${nested}</li>`;
      }
    }

    html += `</${tag}>`;
    return { html, next: i };
  }

  /** 剔除代码围栏以外的 HTML 注释（<!--track:begin-->、<!--t:ID--> 等管理标记不该出现在预览里） */
  function stripHtmlComments(src) {
    return String(src == null ? '' : src)
      .split(/(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$))/g)
      .map((p, idx) => (idx % 2 ? p : p.replace(/<!--[\s\S]*?-->/g, '')))
      .join('');
  }

  function toHtml(src) {
    const lines = stripHtmlComments(src).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 空行
      if (/^\s*$/.test(line)) { i++; continue; }

      // 代码块
      const fence = line.match(/^\s*(```|~~~)\s*([\w+-]*)\s*$/);
      if (fence) {
        const marker = fence[1];
        const lang = fence[2];
        const buf = [];
        i++;
        while (i < lines.length && !new RegExp('^\\s*' + marker + '\\s*$').test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++; // 跳过结束围栏
        out.push(`<pre><code${lang ? ` class="language-${esc(lang)}"` : ''}>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }

      // 分割线
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 标题
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const lv = h[1].length;
        out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
        i++;
        continue;
      }

      // 引用
      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push(`<blockquote>${toHtml(buf.join('\n'))}</blockquote>`);
        continue;
      }

      // 表格
      if (line.includes('|') && i + 1 < lines.length
        && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
        const head = splitRow(line);
        i += 2;
        let body = '';
        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
          const cells = splitRow(lines[i]);
          body += '<tr>' + head.map((_, ci) => `<td>${inline(cells[ci] || '')}</td>`).join('') + '</tr>';
          i++;
        }
        out.push('<table><thead><tr>'
          + head.map((c) => `<th>${inline(c)}</th>`).join('')
          + '</tr></thead><tbody>' + body + '</tbody></table>');
        continue;
      }

      // 列表
      if (LIST_RE.test(line)) {
        const res = parseList(lines, i);
        out.push(res.html);
        i = res.next;
        continue;
      }

      // 段落
      const buf = [];
      while (i < lines.length
        && !/^\s*$/.test(lines[i])
        && !/^#{1,6}\s+/.test(lines[i])
        && !/^\s*>\s?/.test(lines[i])
        && !LIST_RE.test(lines[i])
        && !/^\s*(```|~~~)/.test(lines[i])
        && !/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])
        && !(lines[i].includes('|') && i + 1 < lines.length && /^\s*\|?[\s:-]*\|[\s:|-]*$/.test(lines[i + 1]) && lines[i + 1].includes('-'))) {
        buf.push(lines[i]);
        i++;
      }
      if (!buf.length) { buf.push(line); i++; }
      out.push(`<p>${buf.map(inline).join('<br>')}</p>`);
    }

    return out.join('\n');
  }

  /* 提取待办（用于聚合视图 / 便签同步） */
  function extractTasks(src) {
    const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    const list = [];
    lines.forEach((l, idx) => {
      const m = l.match(/^\s*[-*+]\s+\[([ xX\/])\]\s+(.*)$/);
      if (!m) return;
      const ch = m[1].toLowerCase();
      const state = ch === 'x' ? 'done' : ch === '/' ? 'doing' : 'todo';
      const sm = m[2].match(/<!--\s*s:([\w-]+)\s*-->/);
      list.push({
        line: idx,
        state,
        checked: state === 'done',
        status: state === 'done' ? 'done' : state === 'doing' ? 'doing' : 'todo',
        sticky: sm ? sm[1] : '',
        text: m[2].replace(/<!--.*?-->/g, '').replace(/[`*_~]/g, '').trim()
      });
    });
    return list;
  }

  /* 纯文本摘要（用于列表 / 搜索） */
  function plain(src, max) {
    let s = String(src || '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s*>\s?/gm, '')
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/[|]/g, ' ')
      .replace(/[*_~`]/g, '')
      .replace(/-{3,}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && s.length > max) s = s.slice(0, max) + '…';
    return s;
  }

  global.MD = { toHtml, extractTasks, plain, inline, esc };
})(window);
