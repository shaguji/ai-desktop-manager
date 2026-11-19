// Electron probe for the REAL fileIcon implementation (bundled from src).
// Run with: npx electron scripts/probe-icons2.cjs
const { app } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { getFileIconDataURL, resolveIconSource } = require('./_fileicon.probe.cjs');

const appDir = path.join(os.homedir(), 'Desktop', '整理', '应用程序');
const outDir = path.join(__dirname, '_icons');
fs.mkdirSync(outDir, { recursive: true });

const files = fs
  .readdirSync(appDir)
  .filter((n) => /\.lnk$/i.test(n))
  .map((n) => path.join(appDir, n));

const md5 = (s) => (s ? crypto.createHash('md5').update(s).digest('hex').slice(0, 10) : '(empty)');

// Write PNG-backed icons out so they can be inspected visually.
function dump(name, dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1] === 'image/x-icon' ? 'ico' : m[1].split('/')[1];
  const file = path.join(outDir, name.replace(/[\\/:*?"<>|]/g, '_') + '.' + ext);
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
  return file;
}

app.whenReady().then(async () => {
  const seen = new Map();
  let empty = 0;
  let resolved = 0;
  for (const f of files) {
    const ref = resolveIconSource(f);
    const src = ref.path;
    const data = await getFileIconDataURL(f, 48);
    const h = md5(data);
    if (!data) empty++;
    if (src !== f) resolved++;
    const dup = seen.has(h) ? '  <-- SAME AS ' + seen.get(h) : '';
    if (!seen.has(h)) seen.set(h, path.basename(f));
    if (/Electron|WorkBuddy|cc-switch|clash/i.test(path.basename(src))) dump(path.basename(src), data);
    console.log(path.basename(f).padEnd(30), '->', path.basename(src).padEnd(26), h, dup);
  }
  console.log(
    `\ntotal=${files.length} resolved=${resolved} empty=${empty} uniqueIcons=${seen.size}`
  );
  app.quit();
});
