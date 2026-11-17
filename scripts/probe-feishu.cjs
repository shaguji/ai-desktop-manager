const { app, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mod = require('./_fileicon.probe.cjs');

const LNK = path.join(process.env.USERPROFILE, 'Desktop', '整理', '应用程序', '飞书.lnk');

app.whenReady().then(async () => {
  console.log('=== lnk path ===');
  console.log(LNK, 'exists=', fs.existsSync(LNK));

  try {
    const sc = shell.readShortcutLink(LNK);
    console.log('=== readShortcutLink ===');
    console.log('target =', sc.target);
    console.log('icon   =', sc.icon);
    console.log('iconIndex =', sc.iconIndex);
    console.log('args   =', JSON.stringify(sc.args));
    console.log('cwd    =', sc.cwd);
  } catch (e) {
    console.log('=== readShortcutLink FAILED:', e.message);
  }

  const src = mod.resolveIconSource(LNK);
  console.log('=== resolveIconSource ===');
  console.log(src);
  console.log('exists=', fs.existsSync(src), 'ext=', path.extname(src));

  const d = await mod.getFileIconDataURL(LNK, 48);
  if (!d) return console.log('=== RESULT: EMPTY ICON ==='), app.quit();
  const m = /^data:([^;]+);base64,(.*)$/s.exec(d);
  const buf = Buffer.from(m[2], 'base64');
  console.log('=== RESULT ===');
  console.log('mime=', m[1], 'bytes=', buf.length, 'md5=', crypto.createHash('md5').update(buf).digest('hex').slice(0, 8));
  fs.mkdirSync('scripts/_icons', { recursive: true });
  fs.writeFileSync('scripts/_icons/feishu.png', buf);
  app.quit();
});
