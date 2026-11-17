// Electron probe: proves that .lnk files resolve to distinct program icons.
// Run with: npx electron scripts/probe-icons.cjs
const { app, shell } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

function collect(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((n) => /\.(lnk|url)$/i.test(n))
      .map((n) => path.join(dir, n));
  } catch {
    return [];
  }
}

const desktop = path.join(os.homedir(), 'Desktop');
const files = [
  ...collect(path.join(process.env.PUBLIC || '', 'Desktop')),
  ...collect(path.join(desktop, '整理', '应用程序'))
].slice(0, 14);

const hash = (buf) => crypto.createHash('md5').update(buf).digest('hex').slice(0, 8);

app.whenReady().then(async () => {
  console.log('probing', files.length, 'shortcut(s)\n');
  for (const f of files) {
    let sc = null;
    try {
      sc = shell.readShortcutLink(f);
    } catch (e) {
      console.log('!! readShortcutLink failed', path.basename(f), e.message);
    }
    const target = sc && sc.target ? sc.target : '';
    const icon = sc && sc.icon ? sc.icon : '';

    let lnkHash = '-';
    let tgtHash = '-';
    try {
      lnkHash = hash((await app.getFileIcon(f, { size: 'normal' })).toPNG());
    } catch {}
    if (target && fs.existsSync(target)) {
      try {
        tgtHash = hash((await app.getFileIcon(target, { size: 'normal' })).toPNG());
      } catch {}
    }
    console.log(
      [
        path.basename(f).padEnd(28),
        'lnk=' + lnkHash,
        'targetIcon=' + tgtHash,
        'target=' + (target ? path.basename(target) : '(none)'),
        icon ? 'icon=' + icon : ''
      ].join('  ')
    );
  }
  app.quit();
});
