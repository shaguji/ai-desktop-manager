/**
 * 把归墨笔记应用源码（notes-src/）同步到 resources/notes-app，
 * 作为桌面管家内嵌的笔记窗口随包分发。
 * 用法：node scripts/sync-notes.cjs
 *
 * 源码默认取仓库内的 notes-src/；若不存在（早期把笔记放在同级 ../note-studio
 * 的开发环境），回退到该目录，保证老工作区仍能构建。
 *
 * 构建强制项：清单里任何文件在源目录缺失、或拷贝后内容（SHA-256）不一致，
 * 都直接以非零码退出 —— 绝不能带着残缺/陈旧的笔记资源完成打包。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SRC = (() => {
  const inRepo = path.join(__dirname, '..', 'notes-src');
  if (fs.existsSync(path.join(inRepo, 'index.html'))) return inRepo;
  const legacy = path.join(__dirname, '..', '..', 'note-studio');
  console.warn('[sync-notes] 未找到 notes-src/，回退到旧路径:', legacy);
  return legacy;
})();
const DST = path.join(__dirname, '..', 'resources', 'notes-app');

const FILES = ['index.html'];
const ASSETS = ['bridge.js', 'templates.js', 'markdown.js', 'store.js', 'vault.js', 'vault-ui.js', 'track.js', 'sync.js', 'ai.js', 'home.js', 'app.js', 'styles.css'];

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function fail(msg) {
  console.error('[sync-notes] ✗ ' + msg);
  process.exit(1);
}

function copy(name, srcDir, dstDir, label) {
  const from = path.join(srcDir, name);
  const to = path.join(dstDir, name);
  if (!fs.existsSync(from)) fail(`${label} 源文件缺失: ${from}`);
  let data;
  try {
    data = fs.readFileSync(from);
  } catch (e) {
    fail(`${label} 读取失败 ${from}: ${e.message}`);
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, data);
  /* 回读校验：拷贝结果必须与源逐字节一致，否则构建失败 */
  let back;
  try {
    back = fs.readFileSync(to);
  } catch (e) {
    fail(`${label} 回读失败 ${to}: ${e.message}`);
  }
  if (sha256(data) !== sha256(back)) fail(`${label} 校验不一致: ${name}`);
  console.log('[sync-notes]', name, `(${(data.length / 1024).toFixed(1)}KB, sha256 ok)`);
}

fs.mkdirSync(path.join(DST, 'assets'), { recursive: true });
FILES.forEach((f) => copy(f, SRC, DST, 'root'));
ASSETS.forEach((f) => copy(f, path.join(SRC, 'assets'), path.join(DST, 'assets'), 'assets'));
console.log('[sync-notes] 完成（清单 ' + (FILES.length + ASSETS.length) + ' 个文件全部校验通过）→', DST);
