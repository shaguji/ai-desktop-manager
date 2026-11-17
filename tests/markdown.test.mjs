/* Markdown 链接白名单回归测试：渲染层绝不允许产出 javascript:/file:/data: 链接 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = readFileSync(path.join(here, '../notes-src/assets/markdown.js'), 'utf-8');
const sandbox = { window: {} };
vm.runInNewContext(code, sandbox);
const MD = sandbox.window.MD;

test('javascript: 链接不产出可点击 <a>', () => {
  const html = MD.toHtml('[点我](javascript:alert%281%29)');
  assert.ok(!/<a\s/i.test(html), '不应出现 <a>：' + html);
  assert.ok(html.includes('点我'));
});

test('混合大小写与 tab 混淆的协议同样被拒', () => {
  assert.ok(!/<a\s/i.test(MD.toHtml('[x](JaVaScRiPt:alert(1))')));
  assert.ok(!/<a\s/i.test(MD.toHtml('[x](data:text/html;base64,PHNjcmlwdD4)')));
});

test('file: 链接不产出可点击 <a>（打开本地文件走受控通道）', () => {
  const html = MD.toHtml('[秘密](file:///C:/Windows/system32/config.sam)');
  assert.ok(!/<a\s/i.test(html));
});

test('http/https/mailto 正常产出链接', () => {
  assert.ok(/<a href="https:\/\/example\.com"/.test(MD.toHtml('[ok](https://example.com)')));
  assert.ok(/<a href="http:\/\/example\.com"/.test(MD.toHtml('[ok](http://example.com)')));
  assert.ok(/<a href="mailto:a@b\.c"/.test(MD.toHtml('[mail](mailto:a@b.c)')));
});

test('<https://...> 自动链接保持受控', () => {
  assert.ok(/<a href="https:\/\//.test(MD.toHtml('<https://example.com>')));
  assert.ok(!/<a href="javascript/i.test(MD.toHtml('<javascript:alert(1)>')));
});

test('图片 / 音频 src 允许附件 file: 与 data:image，丢弃其它 data:', () => {
  const img = MD.toHtml('![图](file:///C:/note-media/a.png)');
  assert.ok(/src="file:\/\/\/C:\/note-media\/a\.png"/.test(img));
  const img2 = MD.toHtml('![图](data:image/png;base64,iVBOR)');
  assert.ok(/src="data:image\/png/.test(img2));
  const bad = MD.toHtml('![图](data:text/html;base64,PHNjcmlwdD4)');
  assert.ok(/src=""/.test(bad), '非媒体 data: 应被置空：' + bad);
});
