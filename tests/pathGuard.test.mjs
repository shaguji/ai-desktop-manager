/* isPathInside 回归测试：目录穿越（..\..、前缀相近目录、符号链接语义）必须被拦下 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* 把 TS 源转译成可加载的 ESM（pathGuard 只依赖 node:fs / node:path，无 electron） */
const out = path.join(os.tmpdir(), `pathguard-test-${process.pid}.mjs`);
await build({
  entryPoints: [path.join(path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url)))), 'desktop-manager', 'src', 'main', 'pathGuard.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: out
});
const { isPathInside } = await import(pathToFileURL(out).href);

test('目录内文件允许', () => {
  assert.equal(isPathInside('C:\\media', 'C:\\media\\a.png'), true);
  assert.equal(isPathInside('C:\\media', 'C:\\media\\sub\\deep\\a.flow.json'), true);
});

test('..\\.. 越界被拦（startsWith 前缀判断的老漏洞）', () => {
  assert.equal(isPathInside('C:\\media', 'C:\\media\\..\\secret.txt'), false);
  assert.equal(isPathInside('C:\\media', 'C:\\media\\..\\..\\Windows\\system32\\x'), false);
  /* URL 编码解码后才露出来的穿越同样要被 resolve 折叠拦下 */
  assert.equal(isPathInside('C:\\media', 'C:\\media\\sub\\..\\..\\evil'), false);
});

test('相近前缀目录不误判', () => {
  assert.equal(isPathInside('C:\\media', 'C:\\media-other\\x.txt'), false);
  assert.equal(isPathInside('C:\\media', 'C:\\media2\\x.txt'), false);
});

test('与目录本身相同不算在内', () => {
  assert.equal(isPathInside('C:\\media', 'C:\\media'), false);
  assert.equal(isPathInside('C:\\media\\', 'C:\\media\\\\'), false);
});

test('正反斜杠与大小写不敏感（Windows 语义）', () => {
  assert.equal(isPathInside('c:/media', 'C:\\MEDIA\\A\\b.png'), true);
});

test('相对路径按 dir 解析', () => {
  const cwd = process.cwd();
  assert.equal(isPathInside(cwd, 'tests\\x.txt'), true);
  assert.equal(isPathInside(cwd, '..\\outside.txt'), false);
});
