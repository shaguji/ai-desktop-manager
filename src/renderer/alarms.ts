import { useEffect } from 'react';
import type { AlarmItem } from '../shared/types';
import { useStore } from './store';
import {
  dateKey,
  hhmm,
  nextOccurrence,
  pruneFiredTodoAlarms,
  repeatLabel,
  WEEK_LABELS
} from '../shared/reminder';

export { WEEK_LABELS, dateKey, hhmm, nextOccurrence, repeatLabel };

export function nextAlarm(
  alarms: AlarmItem[] | undefined,
  from = new Date()
): { alarm: AlarmItem; at: Date } | null {
  let best: { alarm: AlarmItem; at: Date } | null = null;
  for (const a of alarms ?? []) {
    const at = nextOccurrence(a, from);
    if (at && (!best || at < best.at)) best = { alarm: a, at };
  }
  return best;
}

/** "还有 2 小时 5 分" — used under the clock so the next alarm is visible. */
export function formatRemain(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1) return '即将响铃';
  if (totalMin < 60) return `${totalMin} 分钟后`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h} 小时 ${m} 分后` : `${h} 小时后`;
  const d = Math.floor(h / 24);
  return `${d} 天后`;
}

export function makeAlarm(time: string, days: number[] = [], label = ''): AlarmItem {
  return {
    id: 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    time,
    label,
    enabled: true,
    days
  };
}

/** Nobody is going to stare at a flashing screen for ten minutes. */
const RING_MAX_MS = 5 * 60 * 1000;

/**
 * Global alarm scheduler. Mounted once by <App> so an alarm still rings when
 * the clock panel itself is closed or hidden behind a window — the overlay and
 * the system notification are independent of the widget.
 *
 * 便签待办设置的提醒也是同一条 AlarmItem（带 todoId），因此由这里统一触发，
 * 响铃时能同时带上待办标题，一条链路管所有提醒。
 *
 * The interval is created once and reads the store with getState(), so firing
 * (which writes the config) never restarts the timer. `enabled` is false in
 * the settings window: two renderers must not race to fire the same alarm.
 */
export function useAlarmEngine(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const st = useStore.getState();
      const now = new Date();

      if (st.ringing) {
        if (Date.now() - st.ringing.at > RING_MAX_MS) {
          st.stopRinging();
          st.notify('闹铃响了 5 分钟没人管，已自动停止');
        }
        return;
      }

      const clock = st.widgets.clock;
      const all = clock.alarms ?? [];
      // 响过一次的待办提醒第二天自动收起（当天保留，便签上还能看到「已提醒」）
      const pruned = pruneFiredTodoAlarms(all, now);
      if (pruned.changed) st.updateWidgets({ clock: { ...clock, alarms: pruned.alarms } });
      const alarms = pruned.alarms;
      if (alarms.length === 0) return;

      const today = dateKey(now);
      const minute = hhmm(now);
      const due = alarms.find((a) => {
        if (!a.enabled) return false;
        // Snooze wins over the clock: a 07:30 alarm snoozed at 07:30 rings at
        // 07:35 even though the wall clock no longer reads 07:30.
        if (a.snoozeUntil) return Date.now() >= a.snoozeUntil;
        if (a.time !== minute) return false;
        // 指定日期的一次性提醒：只在当天有效
        if (a.date) return a.date === today && a.lastFired !== today;
        if (a.days.length > 0 && !a.days.includes(now.getDay())) return false;
        return a.lastFired !== today;
      });
      if (!due) return;

      const next = alarms.map((a) =>
        a.id === due.id
          ? {
              ...a,
              lastFired: today,
              snoozeUntil: undefined,
              // Empty days = one-shot: it has done its job.
              enabled: a.days.length > 0 ? a.enabled : false
            }
          : a
      );
      st.updateWidgets({ clock: { ...clock, alarms: next } });
      st.ringAlarm({ ...due, snoozeUntil: undefined });
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
}
