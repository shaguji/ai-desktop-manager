/**
 * 待办提醒（便签事项 ↔ 闹铃）的纯逻辑。
 *
 * 设计上不新建一套调度器：一条待办提醒就是一个带 `todoId` 的 AlarmItem，
 * 和时钟里的闹铃共用同一个引擎（响铃 / 提示音 / 稍后提醒 / 系统通知）。
 * 这样只有一个「谁该响」的判定入口，也不会出现两套定时器互相打架。
 *
 * 本文件不依赖 Electron / React，可直接单测。
 */
import type { AlarmItem, NoteItem } from './types';

export const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

const pad = (n: number) => String(n).padStart(2, '0');

/** Local YYYY-MM-DD — deliberately not toISOString(), which is UTC. */
export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "HH:mm" → {h,m}；非法输入返回 null（手改配置写坏了也不会乱响）。 */
export function parseHHmm(time: string): { h: number; m: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || h > 23 || min > 59) return null;
  return { h, m: min };
}

/** "YYYY-MM-DD" → 本地时间当天 0 点；不用 new Date(str)（那按 UTC 解析）。 */
export function parseDateKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 一条闹铃是否由便签待办创建。 */
export function isTodoAlarm(a: AlarmItem | null | undefined): boolean {
  return !!a && !!a.todoId;
}

/** "一次" / "每天" / "工作日" / "周一、周三" — shown as a small badge. */
export function repeatLabel(days: number[]): string {
  const set = [...new Set(days ?? [])].sort();
  if (set.length === 0) return '一次';
  if (set.length === 7) return '每天';
  if (set.length === 5 && set.every((d, i) => d === i + 1)) return '工作日';
  return set.map((d) => '周' + WEEK_LABELS[d]).join('、');
}

/**
 * Next time this alarm will go off (null when it is switched off).
 *
 * - 有 `date` 的提醒只在那一天响（待办里「11 月 20 日 09:00 前提交」这种）。
 * - 只有 `days` 的提醒向前最多找 8 天，保证「只在周一」也能落进窗口。
 */
export function nextOccurrence(alarm: AlarmItem, from = new Date()): Date | null {
  if (!alarm.enabled) return null;
  const now = from.getTime();
  if (alarm.snoozeUntil && alarm.snoozeUntil > now) return new Date(alarm.snoozeUntil);

  const hm = parseHHmm(alarm.time);
  if (!hm) return null;

  if (alarm.date) {
    const day = parseDateKey(alarm.date);
    if (!day) return null;
    const cand = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hm.h, hm.m, 0, 0);
    if (cand.getTime() <= now) return null;
    if (alarm.lastFired === dateKey(cand)) return null;
    return cand;
  }

  for (let offset = 0; offset <= 8; offset++) {
    const cand = new Date(from);
    cand.setDate(cand.getDate() + offset);
    cand.setHours(hm.h, hm.m, 0, 0);
    if (cand.getTime() <= now) continue;
    if (alarm.days.length > 0 && !alarm.days.includes(cand.getDay())) continue;
    if (dateKey(cand) === alarm.lastFired) continue;
    return cand;
  }
  return null;
}

/** 今天 / 明天 / 后天 / 周三 / 11月20日 */
export function dayLabel(at: Date, from = new Date()): string {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((start(at) - start(from)) / 86_400_000);
  if (diff === 0) return '今天';
  if (diff === 1) return '明天';
  if (diff === 2) return '后天';
  if (diff > 2 && diff < 7) return '周' + WEEK_LABELS[at.getDay()];
  return `${at.getMonth() + 1}月${at.getDate()}日`;
}

/**
 * 便签条目上那行短文案：「今天 14:30」「每天 09:00」「已过期」。
 * 重复提醒直接说重复规则，比算下一次更符合直觉。
 */
export function remindWhenLabel(alarm: AlarmItem | null | undefined, from = new Date()): string {
  if (!alarm) return '';
  const at = nextOccurrence(alarm, from);
  if (alarm.days.length === 7) return `每天 ${alarm.time}`;
  if (alarm.days.length === 5 && alarm.days.every((d, i) => d === i + 1)) {
    return `工作日 ${alarm.time}`;
  }
  if (alarm.days.length > 0) return `${repeatLabel(alarm.days)} ${alarm.time}`;
  if (at) return `${dayLabel(at, from)} ${alarm.time}`;
  // 一次性提醒已经响过 / 日期已经过去：留个痕，用户点一下就能重设
  return alarm.lastFired ? '已提醒' : '已过期';
}

/**
 * 一次性待办提醒响过之后隔天自动收起：
 * 当天留着，便签上还能看到「已提醒」；隔天再留着就只是噪音了。
 * 重复提醒、普通闹铃一律不动。
 */
export function pruneFiredTodoAlarms(
  alarms: AlarmItem[] | undefined,
  now = new Date()
): { alarms: AlarmItem[]; changed: boolean } {
  const list = alarms ?? [];
  const today = dateKey(now);
  const out = list.filter((a) => {
    if (!a.todoId) return true;
    if (a.days.length > 0) return true;
    if (a.enabled) return true;
    // lastFired 是 YYYY-MM-DD，可以直接做字典序比较
    if (a.lastFired && a.lastFired < today) return false;
    return true;
  });
  return { alarms: out.length === list.length ? list : out, changed: out.length !== list.length };
}

export function findTodoAlarm(
  alarms: AlarmItem[] | undefined,
  todoId: string
): AlarmItem | undefined {
  return (alarms ?? []).find((a) => a.todoId === todoId);
}

export interface ReminderPlan {
  /** 一次性提醒的目标日期（YYYY-MM-DD）；有重复日时忽略。 */
  date?: string;
  /** 24h "HH:mm"。 */
  time: string;
  /** 0=周日 … 6=周六；空数组 = 只响一次。 */
  days?: number[];
}

function newAlarmId(): string {
  return 'al' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * 由待办条目 + 用户选择生成闹铃。改时间时复用原 id，
 * 这样正在响 / 已稍后提醒的那条会被就地更新，不会凭空多出一条。
 */
export function buildTodoAlarm(
  item: NoteItem,
  plan: ReminderPlan,
  existing?: AlarmItem
): AlarmItem {
  const days = [...new Set(plan.days ?? [])].filter((d) => d >= 0 && d <= 6).sort();
  return {
    id: existing?.id ?? newAlarmId(),
    time: plan.time,
    label: item.text,
    enabled: true,
    days,
    // 重复提醒不需要日期；一次性提醒固定在用户选的那天
    date: days.length ? undefined : plan.date,
    todoId: item.id,
    lastFired: undefined,
    snoozeUntil: undefined
  };
}

/**
 * 待办列表变化后校正关联闹铃：
 *  - 待办被删除 / 标为已完成 → 提醒一起撤掉（事情都做完了还响就是骚扰）
 *  - 待办文字被改 → 提醒的标题跟着改，否则响铃时显示的是一句旧文案
 *
 * 返回新数组；没有变化时原样返回，避免无意义的配置写盘。
 */
export function reconcileTodoAlarms(
  alarms: AlarmItem[] | undefined,
  items: NoteItem[]
): { alarms: AlarmItem[]; changed: boolean } {
  const list = alarms ?? [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: AlarmItem[] = [];
  let changed = false;

  for (const a of list) {
    if (!a.todoId) {
      out.push(a);
      continue;
    }
    const item = byId.get(a.todoId);
    if (!item || item.status === 'done') {
      changed = true;
      continue;
    }
    const label = item.text.trim();
    if (label && label !== a.label) {
      out.push({ ...a, label });
      changed = true;
      continue;
    }
    out.push(a);
  }

  return { alarms: changed ? out : list, changed };
}
