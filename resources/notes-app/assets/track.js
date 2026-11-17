/* ═══════════════════════════════════════════════════
   事项跟踪 → 每日工作 自动同步
   · 每个有动态的日子，在「每日工作」笔记本里维护一篇
     「YYYY-MM-DD 工作日志」，其中受管区块是一张进展表格
   · 事项新增 / 记录进展 / 切换状态后自动更新对应日期的表格
   · 表格里允许手工追加行（无 <!--t:ID--> 标记的行会被保留）
   ═══════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  const BEGIN = '<!--track:begin-->';
  const END = '<!--track:end-->';
  const MARK = /<!--\s*t:([\w-]+)\s*-->/;
  const STATUS_TEXT = { todo: '未开始', doing: '进行中', done: '已完成' };
  const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  const pad = (n) => String(n).padStart(2, '0');

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function hm(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function dailyTitle(dateKey) {
    return `${dateKey} 工作日志`;
  }

  function dailyNoteId(dateKey) {
    return `note-track-${dateKey}`;
  }

  function statusText(st) {
    return STATUS_TEXT[st] || STATUS_TEXT.todo;
  }

  /* ── 找到 / 创建某天的工作日志 ── */
  function ensureDailyNote(dateKey) {
    const title = dailyTitle(dateKey);
    let note = Store.getNote(dailyNoteId(dateKey));
    if (!note || note.deletedAt) {
      const nb = Store.state.notebooks.find((b) => b.name === '每日工作') || Store.state.notebooks[0];
      note = Store.activeNotes().find(
        (n) => n.title === title && n.notebookId === nb.id
      ) || null;
    }
    if (note && note.deletedAt) {
      Store.restoreNote(note.id);
    }
    if (!note) {
      note = Store.createNote({
        id: dailyNoteId(dateKey),
        notebookId: (Store.state.notebooks.find((b) => b.name === '每日工作') || Store.state.notebooks[0]).id,
        title,
        content: `# ${title}\n\n${BEGIN}\n${END}\n`,
        silent: true
      });
    }
    return note;
  }

  /* ── 某天有动态的事项 ── */
  function itemsOn(dateKey) {
    return Store.trackItems().filter((it) => {
      if (dayKey(it.createdAt) === dateKey) return true;
      if (it.closedAt && dayKey(it.closedAt) === dateKey) return true;
      if ((it.progress || []).some((p) => dayKey(p.at) === dateKey)) return true;
      if ((it.risks || []).some((r) => dayKey(r.at) === dateKey)) return true;
      /* 只切了状态、没写进展的日子也要留痕 */
      return (it.statusLog || []).some((s) => dayKey(s.at) === dateKey);
    });
  }

  function itemProgressOfDay(it, dateKey) {
    return (it.progress || []).filter((p) => dayKey(p.at) === dateKey);
  }

  function itemRisksOfDay(it, dateKey) {
    return (it.risks || []).filter((r) => dayKey(r.at) === dateKey);
  }

  function itemStatusOfDay(it, dateKey) {
    return (it.statusLog || []).filter((s) => dayKey(s.at) === dateKey);
  }

  /** 某天该事项的全部动态（状态 + 进展 + 风险），按时间排序后拼成一句话 */
  function itemEventsOfDay(it, dateKey) {
    const evs = itemStatusOfDay(it, dateKey).map((s) => ({
      at: s.at,
      text: `状态：${statusText(s.from)} → ${statusText(s.to)}`
    })).concat(itemProgressOfDay(it, dateKey).map((p) => ({ at: p.at, text: p.text })))
      .concat(itemRisksOfDay(it, dateKey).map((r) => ({
        at: r.at,
        text: `⚠ 风险：${r.text}${r.resolved ? '（已解决）' : ''}`
      })));
    return evs.sort((a, b) => a.at - b.at);
  }

  function buildRow(it, dateKey) {
    const events = itemEventsOfDay(it, dateKey);
    const created = dayKey(it.createdAt) === dateKey;
    const closed = it.closedAt && dayKey(it.closedAt) === dateKey;
    const parts = events.map((e) => e.text);
    if (created) parts.unshift('创建事项');
    if (closed && !events.some((e) => /办结|完成/.test(e.text))) parts.push('办结');
    const text = parts.length ? parts.join('；') : '—';
    const times = events.map((e) => e.at)
      .concat(created ? [it.createdAt] : [])
      .concat(closed ? [it.closedAt] : []);
    const time = times.length ? hm(Math.max.apply(null, times)) : '—';
    const title = String(it.title || '').replace(/\|/g, '／').replace(/<!--.*?-->/g, '').trim();
    const progress = text.replace(/\|/g, '／').replace(/\n+/g, '；');
    return `| ${title} <!--t:${it.id}--> | ${statusText(it.status)} | ${progress} | ${time} |`;
  }

  function buildBlock(dateKey) {
    const items = itemsOn(dateKey);
    const lines = [
      BEGIN,
      '> 本表由「事项跟踪」自动同步；可直接在表格末尾追加行补充当天其他工作内容，手工行不会被覆盖。'
    ];
    if (items.length) {
      lines.push('');
      lines.push('| 事项 | 状态 | 今日进展 | 更新 |');
      lines.push('| --- | --- | --- | --- |');
      /* 创建时间早的在前，和事项列表的叙事顺序一致 */
      items.sort((a, b) => a.createdAt - b.createdAt).forEach((it) => {
        lines.push(buildRow(it, dateKey));
      });
    }
    lines.push('');
    lines.push(END);
    return lines.join('\n');
  }

  /** 提取现有受管块里手工追加的表格行（无 <!--t:ID--> 标记的数据行） */
  function manualRows(note) {
    const content = (note && note.content) || '';
    const bi = content.indexOf(BEGIN);
    const ei = content.indexOf(END);
    if (bi < 0 || ei <= bi) return [];
    const block = content.slice(bi + BEGIN.length, ei);
    return block.split('\n').filter((line) => {
      const l = line.trim();
      if (!l.startsWith('|')) return false;
      if (MARK.test(l)) return false;
      if (/^\|\s*事项\s*\|/.test(l)) return false;
      if (/^\|\s*-{2,}/.test(l) || /^\|\s*---/.test(l)) return false;
      /* 至少要有两列才算数据行 */
      return l.split('|').length >= 3;
    });
  }

  function mergeBlock(note, block, rows) {
    const content = note.content || '';
    const bi = content.indexOf(BEGIN);
    const ei = content.indexOf(END);
    const full = rows && rows.length
      ? block.slice(0, block.lastIndexOf(END)) + rows.join('\n') + '\n\n' + END
      : block;
    if (bi >= 0 && ei > bi) {
      return content.slice(0, bi) + full + content.slice(ei + END.length);
    }
    /* 插到一级标题之后；没有标题就放最前面 */
    const m = content.match(/^\s*#\s+.*(?:\n|$)/);
    if (m) {
      const at = m.index + m[0].length;
      return content.slice(0, at) + '\n' + full + '\n' + content.slice(at);
    }
    return full + '\n\n' + content;
  }

  /** 把某天的工作日志同步到最新状态 */
  function syncDailyNote(dateKey) {
    const note = ensureDailyNote(dateKey);
    const rows = manualRows(note);
    const block = buildBlock(dateKey);
    const merged = mergeBlock(note, block, rows);
    if (merged !== note.content) {
      Store.updateNote(note.id, { content: merged });
    }
    return Store.getNote(note.id);
  }

  /** 事项变更后，同步它有动态的所有日期（封顶 30 天，防极端数据） */
  function syncItem(item) {
    if (!item) return;
    const dates = new Set();
    if (item.createdAt) dates.add(dayKey(item.createdAt));
    (item.progress || []).forEach((p) => dates.add(dayKey(p.at)));
    (item.risks || []).forEach((r) => dates.add(dayKey(r.at)));
    (item.statusLog || []).forEach((s) => dates.add(dayKey(s.at)));
    if (item.closedAt) dates.add(dayKey(item.closedAt));
    Array.from(dates).slice(0, 30).forEach((d) => syncDailyNote(d));
  }

  global.Track = {
    BEGIN,
    END,
    STATUS_TEXT,
    statusText,
    dayKey,
    dailyTitle,
    ensureDailyNote,
    itemsOn,
    syncDailyNote,
    syncItem,
    buildBlock
  };
})(window);
