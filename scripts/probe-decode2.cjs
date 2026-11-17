const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const icoPath = path.join(process.env.LOCALAPPDATA, 'Feishu', 'icon.ico');
const b64 = fs.readFileSync(icoPath).toString('base64');
const dataUrl = 'data:image/x-icon;base64,' + b64;
const html = `<img id="a" src="${dataUrl}" width="32" height="32">`;
app.whenReady().then(async () => {
  // 完全模拟桌面层：透明 + frame false + show true
  const win = new BrowserWindow({
    show: false, width: 300, height: 200, transparent: true, frame: false, hasShadow: false
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const r = await win.webContents.executeJavaScript(`
    new Promise((res) => {
      const el = document.getElementById('a');
      const done = () => res({ w: el.naturalWidth, h: el.naturalHeight, ok: el.naturalWidth > 0 });
      if (el.complete) done(); else { el.onload = done; el.onerror = () => res({ err: 'onerror' }); }
      setTimeout(() => res({ err: 'timeout' }), 4000);
    })
  `);
  console.log('transparent window decode:', JSON.stringify(r));
  win.destroy();
  app.quit();
});
