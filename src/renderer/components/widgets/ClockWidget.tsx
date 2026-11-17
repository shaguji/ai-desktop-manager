import { useEffect, useState } from 'react';
import type { AlarmItem } from '../../../shared/types';
import { dayLabel, parseDateKey } from '../../../shared/reminder';
import { useStore } from '../../store';
import {
  WEEK_LABELS,
  formatRemain,
  hhmm,
  makeAlarm,
  nextAlarm,
  repeatLabel
} from '../../alarms';
import { WidgetShell } from './WidgetShell';

/** Where a brand-new alarm starts: the top of the next hour. */
function draftTime(): string {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return hhmm(d);
}

/** 重复规则 / 一次性提醒的日期；待办提醒多带一句「待办」来源。 */
function repeatText(a: AlarmItem): string {
  if (a.date) {
    const d = parseDateKey(a.date);
    return d ? `${dayLabel(d)} · 一次` : '一次';
  }
  return repeatLabel(a.days);
}

export function ClockWidget() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const clock = useStore((s) => s.widgets.clock);
  const ringing = useStore((s) => s.ringing);
  const updateAlarms = useStore((s) => s.updateAlarms);
  const stopRinging = useStore((s) => s.stopRinging);
  const snoozeRinging = useStore((s) => s.snoozeRinging);
  const completeTodo = useStore((s) => s.completeTodo);

  const alarms = clock.alarms ?? [];
  const sound = clock.alarmSound !== false;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [newTime, setNewTime] = useState(draftTime);
  const [newLabel, setNewLabel] = useState('');

  const next = nextAlarm(alarms, now);
  const activeCount = alarms.filter((a) => a.enabled).length;

  const patch = (id: string, next: Partial<AlarmItem>) =>
    updateAlarms(alarms.map((a) => (a.id === id ? { ...a, ...next } : a)));

  const addAlarm = () => {
    updateAlarms([...alarms, makeAlarm(newTime || '08:00', [], newLabel.trim())]);
    setNewLabel('');
    setEditing(null);
  };

  const removeAlarm = (id: string) => {
    updateAlarms(alarms.filter((a) => a.id !== id));
    if (editing === id) setEditing(null);
  };

  /** Weekday chips: empty set = one-shot, which is the default for new alarms. */
  const toggleDay = (a: AlarmItem, day: number) => {
    const days = a.days.includes(day) ? a.days.filter((d) => d !== day) : [...a.days, day].sort();
    // 一旦选了重复日，原来那个「只在那一天响」的日期就必须让位
    patch(a.id, days.length ? { days, date: undefined } : { days });
  };

  return (
    <WidgetShell
      wkey="clock"
      title="时钟"
      className={ringing ? 'ringing' : undefined}
      actions={
        <button
          className={'widget-bell no-drag' + (activeCount > 0 ? ' on' : '')}
          title={alarms.length ? `闹铃（${activeCount} 个已开启）` : '添加闹铃'}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="widget-bell-icon">🔔</span>
          {activeCount > 0 && <span className="widget-bell-dot" />}
        </button>
      }
    >
      {ringing ? (
        <div className="alarm-ringing">
          <div className="alarm-ringing-head">
            <span className="alarm-ringing-bell">{ringing.alarm.todoId ? '📌' : '🔔'}</span>
            <span className="alarm-ringing-title">{ringing.alarm.todoId ? '待办提醒' : '闹铃'}</span>
          </div>
          <div className="alarm-ringing-time">{ringing.alarm.time}</div>
          <div className="alarm-ringing-label">
            {ringing.alarm.label || (ringing.alarm.todoId ? '这条待办到点了' : '时间到，该起身了')}
          </div>
          <div className="alarm-ringing-actions">
            <button className="no-drag" onClick={() => snoozeRinging(5)}>
              稍后 5 分钟
            </button>
            {ringing.alarm.todoId && (
              <button
                className="no-drag alarm-done"
                onClick={() => completeTodo(ringing.alarm.todoId as string)}
              >
                已完成
              </button>
            )}
            <button className="no-drag alarm-stop" onClick={stopRinging}>
              停止
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="clock-time">{now.toLocaleTimeString('zh-CN', { hour12: false })}</div>
          <div className="clock-date">
            {now.toLocaleDateString('zh-CN', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              weekday: 'long'
            })}
          </div>
          <button className="clock-alarm-line no-drag" onClick={() => setOpen((v) => !v)}>
            {next ? (
              <>
                <span className="clock-alarm-line-bell">🔔</span>
                <span className="clock-alarm-line-time">{hhmm(next.at)}</span>
                <span className="clock-alarm-line-label">{next.alarm.label || repeatLabel(next.alarm.days)}</span>
                <span className="clock-alarm-line-remain">{formatRemain(next.at.getTime() - now.getTime())}</span>
              </>
            ) : (
              <span className="clock-alarm-line-idle">＋ 添加闹铃</span>
            )}
          </button>
        </>
      )}

      {open && (
        <div className="alarm-panel" onMouseDown={(e) => e.stopPropagation()}>
          {alarms.length === 0 && (
            <div className="alarm-empty">还没有闹铃；在便签里点 🔔 也能给待办设提醒</div>
          )}

          {alarms.map((a) => (
            <div key={a.id} className={'alarm-item' + (a.enabled ? '' : ' off')}>
              <button
                className={'alarm-power no-drag' + (a.enabled ? ' on' : '')}
                title={a.enabled ? '关闭这个闹铃' : '开启这个闹铃'}
                onClick={() => patch(a.id, { enabled: !a.enabled })}
              >
                ●
              </button>
              <button
                className="alarm-main no-drag"
                title="点击修改时间 / 重复"
                onClick={() => setEditing(editing === a.id ? null : a.id)}
              >
                <span className="alarm-time">{a.time}</span>
                <span className="alarm-meta">
                  <span className="alarm-label">
                    {a.todoId && <i className="alarm-todo-tag">待办</i>}
                    {a.label || '闹铃'}
                  </span>
                  <span className="alarm-repeat">{repeatText(a)}</span>
                </span>
              </button>
              <button className="alarm-del no-drag" title="删除闹铃" onClick={() => removeAlarm(a.id)}>
                ✕
              </button>
            </div>
          ))}

          {editing && (() => {
            const a = alarms.find((x) => x.id === editing);
            if (!a) return null;
            return (
              <div className="alarm-edit">
                <div className="alarm-edit-row">
                  <input
                    type="time"
                    className="no-drag"
                    value={a.time}
                    onChange={(e) => e.target.value && patch(a.id, { time: e.target.value })}
                  />
                  {a.date && (
                    <input
                      type="date"
                      className="no-drag"
                      value={a.date}
                      title="这条提醒只在这个日期响"
                      onChange={(e) => e.target.value && patch(a.id, { date: e.target.value })}
                    />
                  )}
                  <input
                    className="no-drag alarm-edit-name"
                    placeholder="名称（可选）"
                    value={a.label}
                    onChange={(e) => patch(a.id, { label: e.target.value })}
                  />
                </div>
                {a.todoId && (
                  <div className="alarm-edit-hint">
                    这条提醒来自便签待办，改文字请回便签；待办完成或删除后提醒会自动撤掉
                  </div>
                )}
                <div className="alarm-days">
                  {WEEK_LABELS.map((lab, i) => (
                    <button
                      key={i}
                      className={'alarm-day no-drag' + (a.days.includes(i) ? ' on' : '')}
                      onClick={() => toggleDay(a, i)}
                      title={'每周' + lab}
                    >
                      {lab}
                    </button>
                  ))}
                </div>
                <div className="alarm-edit-hint">
                  {a.days.length === 0 ? '一个都不选 = 只响一次' : repeatLabel(a.days) + ' 重复'}
                </div>
              </div>
            );
          })()}

          <div className="alarm-add">
            <input
              type="time"
              className="no-drag"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
            />
            <input
              className="no-drag alarm-add-name"
              placeholder="名称（可选）"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addAlarm();
              }}
            />
            <button className="no-drag alarm-add-btn" onClick={addAlarm}>
              添加
            </button>
          </div>

          <label className="alarm-sound no-drag">
            <input
              type="checkbox"
              checked={sound}
              onChange={() => updateAlarms(alarms, { alarmSound: !sound })}
            />
            <span>响铃提示音（关掉仍会闪烁提醒）</span>
          </label>
        </div>
      )}
    </WidgetShell>
  );
}
