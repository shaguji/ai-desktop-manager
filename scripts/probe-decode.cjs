const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const icoPath = path.join(process.env.LOCALAPPDATA, 'Feishu', 'icon.ico');
const b64 = fs.readFileSync(icoPath).toString('base64');
const dataUrl = 'data:image/x-icon;base64,' + b64;
console.log('data url length =', dataUrl.length);

const html = `<!doctype html><html><body>
<img id="a" src="${dataUrl}">
<img id="b" src="data:image/png;base64,${b64}">
</body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 400, height: 400 });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const r = await win.webContents.executeJavaScript(`
    (async () => {
      const probe = (id) => new Promise((res) => {
        const el = document.getElementById(id);
        const done = () => res({ id, w: el.naturalWidth, h: el.naturalHeight, ok: el.complete && el.naturalWidth > 0 });
        if (el.complete) done(); else { el.onload = done; el.onerror = () => res({ id, err: 'onerror' }); }
      });
      return Promise.all([probe('a'), probe('b')]);
    })()
  `);
  console.log(JSON.stringify(r, null, 1));
  win.destroy();
  app.quit();
});
