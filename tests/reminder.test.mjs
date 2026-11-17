/* 待办提醒：一次性 / 指定日期 / 重复 / 稍后提醒 的下一次响铃，以及和待办的联动校正 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const out = path.join(os.tmpdir(), `reminder-test-${process.pid}.mjs`);
await build({
  entryPoints: [path.join(root, 'desktop-manager', 'src', 'shared', 'reminder.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out
});
const {
  dateKey,
  hhmm,
  nextOccurrence,
  remindWhenLabel,
  repeatLabel,
  buildTodoAlarm,
  reconcileTodoAlarms,
  pruneFiredTodoAlarms,
  findTodoAlarm
} = await import(pathToFileURL(out).href);

/** 周二 15:00，所有断言都相对这个时刻算，避免依赖真实时间 */
const FROM = new Date(2026, 10, 17, 15, 0, 0);

const alarm = (p = {}) => ({
  id: 'a1',
  time: '16:00',
  label: '提醒',
  enabled: true,
  days: [],
  ...p
});

test('dateKey / hhmm 用本地时间，不落到 UTC', () => {
  const d = new Date(2026, 10, 7, 9, 5, 0);
  assert.equal(dateKey(d), '2026-11-07');
  assert.equal(hhmm(d), '09:05');
});

test('一次性闹铃：今天还没到就今天，过了就明天', () => {
  assert.equal(dateKey(nextOccurrence(alarm({ time: '16:30' }), FROM)), '2026-11-17');
  assert.equal(dateKey(nextOccurrence(alarm({ time: '09:00' }), FROM)), '2026-11-18');
});

test('指定日期的提醒只在那一天响', () => {
  const a = alarm({ time: '09:00', date: '2026-11-20' });
  const at = nextOccurrence(a, FROM);
  assert.equal(dateKey(at), '2026-11-20');
  assert.equal(nextOccurrence(alarm({ time: '09:00', date: '2026-11-16' }), FROM), null);
  assert.equal(nextOccurrence(alarm({ time: '09:00', date: '2026-11-20', lastFired: '2026-11-20' }), FROM), null);
});

test('重复日：只在选中的星期响', () => {
  for (const day of [1, 3, 5]) {
    const at = nextOccurrence(alarm({ time: '09:00', days: [day] }), FROM);
    assert.ok(at, `周${day} 应该能算出下一次`);
    assert.equal(at.getDay(), day);
    assert.ok(at > FROM);
  }
});

test('关闭 / 非法时间 / 稍后提醒', () => {
  assert.equal(nextOccurrence(alarm({ enabled: false }), FROM), null);
  assert.equal(nextOccurrence(alarm({ time: '25:99' }), FROM), null);
  const snoozed = alarm({ time: '09:00', snoozeUntil: FROM.getTime() + 5 * 60000 });
  assert.equal(nextOccurrence(snoozed, FROM).getTime(), FROM.getTime() + 5 * 60000);
});

test('repeatLabel 的三种别名', () => {
  assert.equal(repeatLabel([]), '一次');
  assert.equal(repeatLabel([0, 1, 2, 3, 4, 5, 6]), '每天');
  assert.equal(repeatLabel([1, 2, 3, 4, 5]), '工作日');
  assert.equal(repeatLabel([1, 3]), '周一、周三');
});

test('便签行上的短文案', () => {
  assert.equal(remindWhenLabel(alarm({ time: '16:00' }), FROM), '今天 16:00');
  assert.equal(remindWhenLabel(alarm({ time: '09:00' }), FROM), '明天 09:00');
  assert.equal(remindWhenLabel(alarm({ time: '09:00', days: [0, 1, 2, 3, 4, 5, 6] }), FROM), '每天 09:00');
  assert.equal(remindWhenLabel(alarm({ time: '09:00', days: [1, 2, 3, 4, 5] }), FROM), '工作日 09:00');
  assert.equal(
    remindWhenLabel(alarm({ time: '09:00', enabled: false, lastFired: '2026-11-16' }), FROM),
    '已提醒'
  );
  assert.equal(remindWhenLabel(alarm({ time: '09:00', date: '2026-11-10' }), FROM), '已过期');
  assert.equal(remindWhenLabel(undefined, FROM), '');
});

test('buildTodoAlarm：一次性带日期，重复则丢掉日期', () => {
  const item = { id: 't9', text: '交报销单', status: 'todo', at: 1 };
  const one = buildTodoAlarm(item, { date: '2026-11-20', time: '09:00', days: [] });
  assert.equal(one.todoId, 't9');
  assert.equal(one.label, '交报销单');
  assert.equal(one.date, '2026-11-20');
  assert.equal(one.enabled, true);
  assert.deepEqual(one.days, []);

  const rep = buildTodoAlarm(item, { date: '2026-11-20', time: '09:00', days: [5, 1, 1] });
  assert.equal(rep.date, undefined);
  assert.deepEqual(rep.days, [1, 5]);

  // 修改时间复用原 id：正在响 / 已稍后的那条被就地更新
  const again = buildTodoAlarm(item, { time: '10:00', days: [] }, one);
  assert.equal(again.id, one.id);
  assert.equal(again.time, '10:00');
  // 重新设置必须清掉上次的响铃痕迹
  assert.equal(again.lastFired, undefined);
  assert.equal(again.snoozeUntil, undefined);
});

test('待办完成 / 删除后提醒自动撤掉，改文字则同步标题', () => {
  const items = [
    { id: 't1', text: '写周报', status: 'todo', at: 1 },
    { id: 't2', text: '已完成的', status: 'done', at: 2 }
  ];
  const alarms = [
    alarm({ id: 'a1', label: '旧标题', todoId: 't1' }),
    alarm({ id: 'a2', todoId: 't2' }),
    alarm({ id: 'a3', label: '普通闹铃' })
  ];
  const rec = reconcileTodoAlarms(alarms, items);
  assert.equal(rec.changed, true);
  assert.deepEqual(rec.alarms.map((a) => a.id), ['a1', 'a3']);
  assert.equal(rec.alarms[0].label, '写周报');

  // 待办被删掉 → 关联提醒也没了
  const gone = reconcileTodoAlarms(alarms, []);
  assert.deepEqual(gone.alarms.map((a) => a.id), ['a3']);

  // 没有变化时原样返回，避免每次编辑都写盘
  const plain = [alarm({ id: 'a3', label: '普通闹铃' })];
  const same = reconcileTodoAlarms(plain, []);
  assert.equal(same.changed, false);
  assert.equal(same.alarms, plain);
});

test('findTodoAlarm 按 todoId 定位', () => {
  const list = [alarm({ id: 'a1' }), alarm({ id: 'a2', todoId: 't1' })];
  assert.equal(findTodoAlarm(list, 't1').id, 'a2');
  assert.equal(findTodoAlarm(list, 't9'), undefined);
  assert.equal(findTodoAlarm(undefined, 't1'), undefined);
});

test('响过一次的待办提醒隔天收起，普通闹铃不动', () => {
  const list = [
    // 今天刚响过：留着，便签上还能看到「已提醒」
    alarm({ id: 'today', todoId: 't1', enabled: false, lastFired: '2026-11-17' }),
    // 昨天响过的：收起
    alarm({ id: 'old', todoId: 't2', enabled: false, lastFired: '2026-11-16' }),
    // 重复提醒没做完就继续留着
    alarm({ id: 'repeat', todoId: 't3', enabled: true, days: [1, 3] }),
    // 普通闹铃不参与
    alarm({ id: 'plain', enabled: false, lastFired: '2026-11-01' })
  ];
  const rec = pruneFiredTodoAlarms(list, FROM);
  assert.equal(rec.changed, true);
  assert.deepEqual(rec.alarms.map((a) => a.id), ['today', 'repeat', 'plain']);

  const same = pruneFiredTodoAlarms([alarm({ id: 'plain' })], FROM);
  assert.equal(same.changed, false);
});
