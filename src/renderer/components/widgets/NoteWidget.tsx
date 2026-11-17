import { Fragment, useMemo, useState } from 'react';
import type { NoteItem, NoteStatus } from '../../../shared/types';
import {
  WEEK_LABELS,
  dateKey,
  findTodoAlarm,
  hhmm,
  remindWhenLabel,
  repeatLabel
} from '../../../shared/reminder';
import { useStore } from '../../store';
import { WidgetShell } from './WidgetShell';

const STATUS_ORDER: NoteStatus[] = ['todo', 'doing', 'done'];

/** todo = 未开始, doing = 进行中, done = 已完成 */
const STATUS_LABEL: Record<NoteStatus, string> = {
  todo: '未开始',
  doing: '进行中',
  done: '已完成'
};

/** Quick toggle on the status dot: one click advances to the next state. */
const NEXT_STATUS: Record<NoteStatus, NoteStatus> = {
  todo: 'doing',
  doing: 'done',
  done: 'todo'
};

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function newId(): string {
  return `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 新提醒的默认时间：下一个整点。 */
function defaultRemindTime(): { date: string; time: string } {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return { date: dateKey(d), time: hhmm(d) };
}

/** 行内空间有限：「今天 14:30」压成「14:30」，「明天 09:00」压成「明天」。 */
function shortRemind(label: string): string {
  const [head, time] = label.split(' ');
  if (head === '今天') return time || '今天';
  return head || label;
}

type DayGroup = {
  key: string;
  /** 今天 / 昨天 / 前天 / 11月2日 / 2025年11月2日 */
  label: string;
  /** 副标题：相对日期时给出具体日期，其余给星期 */
  sub: string;
  stamp: number;
  items: NoteItem[];
};

/**
 * Bucket the entries by the day they were created on. A day's entries are
 * shown under one shared heading instead of repeating the date on every row.
 * Newest day first; within a day the original order is preserved.
 */
function groupByDay(items: NoteItem[]): DayGroup[] {
  const now = new Date();
  const today = startOfDay(now.getTime());
  const groups = new Map<string, DayGroup>();

  for (const item of items) {
    const ts = Number.isFinite(item.at) && item.at > 0 ? item.at : 0;
    const d = new Date(ts);
    const key = ts
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate()
        ).padStart(2, '0')}`
      : 'earlier';

    let group = groups.get(key);
    if (!group) {
      const md = `${d.getMonth() + 1}月${d.getDate()}日`;
      const diff = ts ? Math.round((today - startOfDay(ts)) / 86_400_000) : -1;
      const sameYear = d.getFullYear() === now.getFullYear();
      const label = !ts
        ? '更早'
        : diff === 0
          ? '今天'
          : diff === 1
            ? '昨天'
            : diff === 2
              ? '前天'
              : sameYear
                ? md
                : `${d.getFullYear()}年${md}`;
      const sub = !ts
        ? ''
        : diff >= 0 && diff <= 2
          ? md
          : WEEKDAYS[d.getDay()];
      group = { key, label, sub, stamp: ts ? startOfDay(ts) : 0, items: [] };
      groups.set(key, group);
    }
    group.items.push(item);
  }

  return Array.from(groups.values()).sort((a, b) => b.stamp - a.stamp);
}

type RemindDraft = { date: string; time: string; days: number[] };

export function NoteWidget() {
  const note = useStore((s) => s.widgets.note);
  const alarms = useStore((s) => s.widgets.clock.alarms);
  const saveNotes = useStore((s) => s.saveNotes);
  const setTodoReminder = useStore((s) => s.setTodoReminder);
  const clearTodoReminder = useStore((s) => s.clearTodoReminder);
  const notify = useStore((s) => s.notify);

  const [draft, setDraft] = useState('');
  /** Which item currently shows the explicit status picker. */
  const [openId, setOpenId] = useState<string | null>(null);
  /** Which item currently shows the reminder editor. */
  const [remindId, setRemindId] = useState<string | null>(null);
  const [rd, setRd] = useState<RemindDraft>(() => ({
    ...defaultRemindTime(),
    days: []
  }));

  const items: NoteItem[] = Array.isArray(note.items) ? note.items : [];
  /* 桌面便签只看「待办中」的事：已完成的留在数据里但不占屏幕（在归墨里可查） */
  const visible = items.filter((i) => i.status !== 'done');
  const done = items.filter((i) => i.status === 'done').length;
  const doing = visible.filter((i) => i.status === 'doing').length;
  const days = useMemo(() => groupByDay(visible), [visible]);

  const save = (next: NoteItem[]) => {
    saveNotes(next);
  };

  const setStatus = (id: string, status: NoteStatus) => {
    save(items.map((i) => (i.id === id ? { ...i, status } : i)));
  };

  const cycle = (id: string, status: NoteStatus) => {
    setStatus(id, NEXT_STATUS[status]);
  };

  const editText = (id: string, text: string) => {
    save(items.map((i) => (i.id === id ? { ...i, text } : i)));
  };

  const remove = (id: string) => {
    if (openId === id) setOpenId(null);
    if (remindId === id) setRemindId(null);
    save(items.filter((i) => i.id !== id));
  };

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    save([...items, { id: newId(), text, status: 'todo', at: Date.now() }]);
    setDraft('');
  };

  /** 跳到「归墨 · 工作笔记」里这条事项的跟踪详情 */
  const openDetail = (item: NoteItem) => {
    const api = (window as any).electronAPI;
    if (api && typeof api.notesOpenTrack === 'function') {
      void api.notesOpenTrack(item.id);
    }
  };

  const openRemind = (item: NoteItem) => {
    if (remindId === item.id) {
      setRemindId(null);
      return;
    }
    const rem = findTodoAlarm(alarms, item.id);
    const fallback = defaultRemindTime();
    setRd({
      date: rem?.date ?? fallback.date,
      time: rem?.time ?? fallback.time,
      days: rem?.days ?? []
    });
    setRemindId(item.id);
  };

  const applyQuick = (kind: '1h' | 'today' | 'tomorrow' | 'daily') => {
    const now = new Date();
    if (kind === '1h') {
      const d = new Date(now.getTime() + 3_600_000);
      d.setSeconds(0, 0);
      setRd({ date: dateKey(d), time: hhmm(d), days: [] });
      return;
    }
    if (kind === 'today') {
      setRd({ date: dateKey(now), time: '18:00', days: [] });
      return;
    }
    if (kind === 'tomorrow') {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      setRd({ date: dateKey(d), time: '09:00', days: [] });
      return;
    }
    setRd({ date: dateKey(now), time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] });
  };

  const saveRemind = (item: NoteItem) => {
    if (!/^\d{2}:\d{2}$/.test(rd.time)) {
      notify('请先选一个提醒时间', 'error');
      return;
    }
    if (rd.days.length === 0) {
      const at = new Date(`${rd.date}T${rd.time}:00`);
      if (Number.isNaN(at.getTime())) {
        notify('请先选一个提醒日期', 'error');
        return;
      }
      if (at.getTime() <= Date.now()) {
        notify('这个时间已经过去了，请选一个将来的时间', 'error');
        return;
      }
    }
    setTodoReminder(item.id, { date: rd.date, time: rd.time, days: rd.days });
    setRemindId(null);
  };

  const remindCount = visible.filter((i) => findTodoAlarm(alarms, i.id)).length;
  const summary = visible.length ? `${visible.length} 项` : '空';

  const renderItem = (item: NoteItem) => {
    const rem = findTodoAlarm(alarms, item.id);
    const when = remindWhenLabel(rem);
    const stale = when === '已过期' || when === '已提醒';
    return (
      <Fragment key={item.id}>
        <div
          className={`note-item st-${item.status}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpenId(null);
              setRemindId(null);
            }
          }}
        >
          <button
            className="note-dot"
            title={`状态：${STATUS_LABEL[item.status]}（点击快速切换）`}
            onClick={() => cycle(item.id, item.status)}
          />
          <input
            className="note-text"
            value={item.text}
            title="点击修改内容"
            onChange={(e) => editText(item.id, e.target.value)}
            onBlur={(e) => {
              if (!e.target.value.trim()) remove(item.id);
            }}
          />
          <button
            className={
              'note-bell' +
              (rem ? ' on' : '') +
              (stale ? ' stale' : '') +
              (remindId === item.id ? ' open' : '')
            }
            title={rem ? `${stale ? when + '，点击重新设置' : '提醒：' + when + '（点击修改）'}` : '给这条待办设置提醒'}
            aria-label={rem ? `提醒：${when}` : '设置提醒'}
            onClick={() => openRemind(item)}
          >
            <span className="note-bell-icon">🔔</span>
            {rem && <span className="note-bell-text">{shortRemind(when)}</span>}
          </button>
          <button
            className={`note-badge${openId === item.id ? ' open' : ''}`}
            title="点击选择状态"
            aria-haspopup="true"
            aria-expanded={openId === item.id}
            onClick={() => setOpenId(openId === item.id ? null : item.id)}
          >
            {STATUS_LABEL[item.status]}
            <span className="note-caret">▾</span>
          </button>
          <button
            className="note-detail"
            title="在「归墨 · 工作笔记」里查看这条事项的跟踪详情"
            onClick={() => openDetail(item)}
          >
            详情
          </button>
          <button className="note-del" title="删除该事项" onClick={() => remove(item.id)}>
            ✕
          </button>
        </div>

        {openId === item.id && (
          <div className="note-status-picker" role="radiogroup" aria-label="事项状态">
            {STATUS_ORDER.map((s) => (
              <button
                key={s}
                className={`nsp st-${s}${s === item.status ? ' on' : ''}`}
                role="radio"
                aria-checked={s === item.status}
                onClick={() => {
                  setStatus(item.id, s);
                  setOpenId(null);
                }}
              >
                <i className="nsp-dot" />
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>
        )}

        {remindId === item.id && (
          <div className="note-remind">
            <div className="nr-row">
              <input
                type="date"
                className="nr-date"
                value={rd.date}
                disabled={rd.days.length > 0}
                title={rd.days.length > 0 ? '重复提醒不需要日期' : '提醒日期'}
                onChange={(e) => e.target.value && setRd({ ...rd, date: e.target.value })}
              />
              <input
                type="time"
                className="nr-time"
                value={rd.time}
                onChange={(e) => e.target.value && setRd({ ...rd, time: e.target.value })}
              />
              <button className="nr-save" onClick={() => saveRemind(item)}>
                保存
              </button>
              {rem && (
                <button
                  className="nr-clear"
                  title="取消这条待办的提醒"
                  onClick={() => {
                    clearTodoReminder(item.id);
                    setRemindId(null);
                  }}
                >
                  移除
                </button>
              )}
            </div>
            <div className="nr-quick">
              <button onClick={() => applyQuick('1h')}>1 小时后</button>
              <button onClick={() => applyQuick('today')}>今天 18:00</button>
              <button onClick={() => applyQuick('tomorrow')}>明天 09:00</button>
              <button onClick={() => applyQuick('daily')}>每天 09:00</button>
            </div>
            <div className="nr-days">
              {WEEK_LABELS.map((lab, i) => (
                <button
                  key={i}
                  className={'nr-day' + (rd.days.includes(i) ? ' on' : '')}
                  title={'每周' + lab + '提醒'}
                  onClick={() =>
                    setRd({
                      ...rd,
                      days: rd.days.includes(i)
                        ? rd.days.filter((d) => d !== i)
                        : [...rd.days, i].sort()
                    })
                  }
                >
                  {lab}
                </button>
              ))}
              <span className="nr-hint">
                {rd.days.length ? repeatLabel(rd.days) + ' 重复' : '一个都不选 = 只响一次'}
              </span>
            </div>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <WidgetShell
      wkey="note"
      resizable
      minW={220}
      minH={170}
      title={`便签 · ${summary}${doing ? ` · ${doing} 进行中` : ''}${
        remindCount ? ` · ${remindCount} 个提醒` : ''
      }`}
    >
      <div className="note-list">
        {days.map((day) => (
          <section className="note-day" key={day.key}>
            <header className="note-day-head">
              <span className="note-day-label">{day.label}</span>
              {day.sub && <span className="note-day-sub">{day.sub}</span>}
              <span className="note-day-line" />
              <span className="note-day-count">{day.items.length}</span>
            </header>
            <div className="note-day-body">{day.items.map(renderItem)}</div>
          </section>
        ))}
        {items.length === 0 && <p className="note-empty">还没有事项，在下方输入后回车添加</p>}
        {items.length > 0 && visible.length === 0 && (
          <p className="note-empty">
            待办都完成了{done ? `（已收起 ${done} 项）` : ''}，在下方添加新的
          </p>
        )}
      </div>

      <div className="note-add">
        <input
          value={draft}
          placeholder="添加事项，回车确认"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <button onClick={add} title="添加事项">
          ＋
        </button>
      </div>
    </WidgetShell>
  );
}
