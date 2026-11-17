/* 归属目录移动映射：normalizeCategories 保留 targetDir/mappings；matchTargetMapping 匹配顺序 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const out = path.join(os.tmpdir(), `targetdir-test-${process.pid}.mjs`);
await build({
  entryPoints: [path.join(root, 'desktop-manager', 'src', 'shared', 'categories.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out
});
const { matchTargetMapping, effectiveMappings, normalizeCategories, OTHER_KEY } = await import(
  pathToFileURL(out).href
);

const baseRules = normalizeCategories([
  {
    key: 'c1',
    label: '工作归位',
    exts: [],
    keywords: [],
    mappings: [
      { keywords: ['报销', '发票'], targetDir: 'D:\\工作\\报销' },
      { keywords: ['周报'], targetDir: 'D:\\工作\\周报' },
      { keywords: [], targetDir: 'D:\\bad' },
      { keywords: ['缺目录'], targetDir: '' }
    ],
    builtin: false,
    enabled: true
  },
  {
    key: 'c2',
    label: '旧版单映射',
    exts: [],
    keywords: ['合同'],
    targetDir: 'D:\\工作\\合同',
    builtin: false,
    enabled: true
  },
  { key: 'c4', label: '无目录', exts: [], keywords: ['周报'], targetDir: '', builtin: false, enabled: true },
  {
    key: 'c5',
    label: '停用',
    exts: [],
    keywords: [],
    mappings: [{ keywords: ['机密'], targetDir: 'C:\\secret' }],
    builtin: false,
    enabled: false
  }
]);

test('normalizeCategories 归一化 mappings：丢弃残行、关键字小写去重', () => {
  const c1 = baseRules.find((r) => r.key === 'c1');
  assert.equal(c1.mappings.length, 2);
  assert.deepEqual(c1.mappings[0].keywords, ['报销', '发票']);
  assert.equal(c1.mappings[0].targetDir, 'D:\\工作\\报销');
});

test('effectiveMappings：显式 mappings 在前，旧版单映射兜底在后', () => {
  const c1 = baseRules.find((r) => r.key === 'c1');
  const c2 = baseRules.find((r) => r.key === 'c2');
  assert.equal(effectiveMappings(c1).length, 2);
  const c2m = effectiveMappings(c2);
  assert.equal(c2m.length, 1);
  assert.equal(c2m[0].targetDir, 'D:\\工作\\合同');
  assert.equal(effectiveMappings(baseRules.find((r) => r.key === 'c4')).length, 0);
});

test('matchTargetMapping 命中规则内不同映射', () => {
  const h1 = matchTargetMapping('10月报销单.docx', baseRules);
  assert.equal(h1.rule.key, 'c1');
  assert.equal(h1.mapping.targetDir, 'D:\\工作\\报销');
  const h2 = matchTargetMapping('第5周周报.docx', baseRules);
  assert.equal(h2.rule.key, 'c1');
  assert.equal(h2.mapping.targetDir, 'D:\\工作\\周报');
});

test('matchTargetMapping 旧版单映射仍参与，未配置/停用规则不参与', () => {
  const h = matchTargetMapping('采购合同v3.pdf', baseRules);
  assert.equal(h.rule.key, 'c2');
  assert.equal(h.mapping.targetDir, 'D:\\工作\\合同');
  assert.equal(matchTargetMapping('我的周报.docx', baseRules.filter((r) => r.key === 'c4')), null);
  assert.equal(matchTargetMapping('机密文件.txt', baseRules), null);
});

test('normalizeCategories 内置兜底仍在，其他字段不受影响', () => {
  const other = baseRules.find((r) => r.key === OTHER_KEY);
  assert.ok(other && other.builtin);
  const c1 = baseRules.find((r) => r.key === 'c1');
  assert.equal(c1.matchDir, false);
  assert.deepEqual(c1.exts, []);
});
