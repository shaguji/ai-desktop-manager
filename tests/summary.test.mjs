/* 办公网生成总结的回归测试：
   · prepareSummary 只组装提示词、不联网，且必须带素材与结构；
   · cleanSummaryText 去掉代码围栏与「好的，以下是…」寒暄；
   · applySummaryResult 把贴回来的正文落成笔记。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.join(here, '../notes-src/assets/ai.js'), 'utf-8');

const notes = [
  {
    id: 'n1',
    title: '埋点方案评审',
    notebookId: 'nb-project',
    createdAt: new Date(2026, 7, 12).getTime(),
    updatedAt: new Date(2026, 7, 12).getTime(),
    content: '# 埋点方案评审\n\n- 完成 12 个页面的埋点清单\n- [x] 与业务方对齐指标口径',
    tags: []
  },
  {
    id: 'n2',
    title: '9 月生产变更',
    notebookId: 'nb-ops',
    createdAt: new Date(2026, 8, 3).getTime(),
    updatedAt: new Date(2026, 8, 3).getTime(),
    content: '本月 42 次变更，成功率 97.6%，无 P1 事件。',
    tags: []
  }
];

function makeSandbox() {
  const created = [];
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem() { /* noop */ } },
    Store: {
      state: {
        notes,
        notebooks: [
          { id: 'nb-project', name: '项目与复盘' },
          { id: 'nb-ops', name: '运维与变更' },
          { id: 'nb-summary', name: '工作总结', group: true },
          { id: 'nb-sum-quarterly', name: '季度总结', parentId: 'nb-summary' }
        ]
      },
      notebookOf: (id) => ({ id, name: id === 'nb-project' ? '项目与复盘' : '运维与变更' }),
      notebookKids: () => [{ id: 'nb-sum-quarterly', name: '季度总结' }],
      createNote: (n) => {
        created.push(n);
        return { id: 'n-new', ...n };
      }
    },
    MD: { extractTasks: () => [{ state: 'open', text: '跟进灰度发布' }] }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox);
  return { AI: sandbox.AI, created };
}

test('prepareSummary 生成季度提示词：含要求、素材与下季度规划，且不发起请求', () => {
  const { AI } = makeSandbox();
  const range = AI.rangeFromDates('2026-07-01', '2026-09-30', 'quarter');
  const prep = AI.prepareSummary({ range, extra: '语气正式' });

  assert.equal(prep.kind, 'quarter');
  assert.ok(prep.prompt.includes('【角色与写作要求】'), '应包含角色要求段');
  assert.ok(prep.prompt.includes('埋点方案评审'), '应包含笔记正文素材');
  assert.ok(prep.prompt.includes('42 次变更'), '应包含第二篇笔记');
  assert.ok(prep.prompt.includes('下季度规划'), '应包含输出结构');
  assert.ok(prep.prompt.includes('语气正式'), '额外要求应透传');
  assert.ok(prep.prompt.includes('跟进灰度发布'), '待办应进提示词');
  assert.ok(prep.chars > 200);
  assert.ok(/\d/.test(prep.title) && prep.title.includes('季度'), '标题应为季度总结');
});

test('提示词强制工作明细用 Markdown 表格（含竖线与分隔线示范）', () => {
  const { AI } = makeSandbox();
  const range = AI.rangeFromDates('2026-07-01', '2026-09-30', 'quarter');
  const prep = AI.prepareSummary({ range });
  assert.ok(/工作明细[\s\S]*?\| 事项 \| 进展 \| 结果 \/ 数据 \| 状态 \|/.test(prep.prompt), '工作明细应给出表格表头');
  assert.ok(prep.prompt.includes('| --- | --- | --- | --- |'), '表头下应给出 --- 分隔线示范');
  assert.ok(/Markdown 表格|竖线 \| 分隔/.test(prep.prompt), '系统要求里应明确 Markdown 表格');
});

test('时间段内没有笔记时给出可读错误', () => {
  const { AI } = makeSandbox();
  const range = AI.rangeFromDates('2020-01-01', '2020-03-31', 'quarter');
  assert.throws(() => AI.prepareSummary({ range }), /没有笔记/);
});

test('cleanSummaryText 去掉代码围栏与开头寒暄', () => {
  const { AI } = makeSandbox();
  const fenced = '```markdown\n# 2026 年第三季度工作总结\n\n## 一、概览\n- 完成埋点\n```';
  assert.equal(AI.cleanSummaryText(fenced), '# 2026 年第三季度工作总结\n\n## 一、概览\n- 完成埋点');

  const chatty = '好的，以下是根据您提供的记录整理的季度总结：\n\n# 2026 年第三季度工作总结\n\n正文';
  assert.equal(AI.cleanSummaryText(chatty), '# 2026 年第三季度工作总结\n\n正文');

  /* 正文中间的「以下是」不能被误删 */
  const keep = '# 标题\n\n以下是本季度重点：\n- 事项';
  assert.equal(AI.cleanSummaryText(keep), keep);
});

test('applySummaryResult 把贴回来的正文落成季度总结笔记', () => {
  const { AI, created } = makeSandbox();
  const range = AI.rangeFromDates('2026-07-01', '2026-09-30', 'quarter');
  const opts = { range };
  const result = AI.applySummaryResult(opts, '```\n# 2026 年第三季度工作总结\n\n## 一、概览\n- 42 次变更\n```');

  assert.equal(created.length, 1);
  const note = created[0];
  assert.equal(note.notebookId, 'nb-sum-quarterly');
  assert.ok(note.content.startsWith('# 2026 年第三季度工作总结'));
  assert.ok(!note.content.includes('```'), '不应残留代码围栏');
  assert.ok(note.tags.includes('AI总结') && note.tags.includes('季度总结'));
  assert.equal(result.kind, 'quarter');
  assert.equal(result.count, 2);
});

test('空结果不允许生成笔记', () => {
  const { AI, created } = makeSandbox();
  const range = AI.rangeFromDates('2026-07-01', '2026-09-30', 'quarter');
  assert.throws(() => AI.applySummaryResult({ range }, '   '), /空的/);
  assert.equal(created.length, 0);
});
