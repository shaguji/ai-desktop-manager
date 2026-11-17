const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const mod = require('./_fileicon.probe.cjs');
const DIR = path.join(process.env.USERPROFILE, 'Desktop', '整理', '应用程序');
app.whenReady().then(async () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.lnk')).sort();
  const win = new BrowserWindow({ show: false, width: 100, height: 100 });
  await win.loadURL('data:text/html,<body></body>');
  let bad = 0;
  for (const f of files) {
    const d = await mod.getFileIconDataURL(path.join(DIR, f), 48);
    if (!d) { console.log('EMPTY ', f); bad++; continue; }
    const r = await win.webContents.executeJavaScript(`
      new Promise((res) => {
        const el = new Image();
        el.onload = () => {
          const c = document.createElement('canvas');
          c.width = 32; c.height = 32;
          const ctx = c.getContext('2d');
          ctx.drawImage(el, 0, 0, 32, 32);
          const data = ctx.getImageData(0, 0, 32, 32).data;
          let opaque = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 10) opaque++;
          res({ mime: ${JSON.stringify(d.slice(5, d.indexOf(';')))}, natural: el.naturalWidth + 'x' + el.naturalHeight, opaque });
        };
        el.onerror = () => res({ mime: 'err', err: 'decode-error' });
        el.src = ${JSON.stringify(d)};
      })
    `);
    const flag = r.err || r.opaque < 50 ? '  << PROBLEM' : '';
    if (flag) bad++;
    console.log(`${String(r.mime).padEnd(14)} ${String(r.natural).padEnd(9)} opaque=${String(r.opaque).padStart(4)}  ${f}${flag}`);
  }
  console.log('---'); console.log(bad === 0 ? 'ALL OK' : bad + ' PROBLEM(S)');
  win.destroy();
  app.quit();
});
