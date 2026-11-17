const { app, BrowserWindow } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mod = require('./_fileicon.probe.cjs');
const LNK = path.join(process.env.USERPROFILE, 'Desktop', '整理', '应用程序', '飞书.lnk');
app.whenReady().then(async () => {
  const d = await mod.getFileIconDataURL(LNK, 48);
  if (!d) return console.log('EMPTY'), app.quit();
  const m = /^data:([^;]+);base64,(.*)$/s.exec(d);
  const buf = Buffer.from(m[2], 'base64');
  console.log('mime=', m[1], 'bytes=', buf.length, 'md5=', crypto.createHash('md5').update(buf).digest('hex').slice(0, 8));
  fs.writeFileSync('scripts/_icons/feishu_fixed.png', buf);

  // 强制像素解码：canvas 画出来数不透明像素
  const win = new BrowserWindow({ show: false, width: 100, height: 100 });
  const html = `<img id="i" src="${d}">`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const r = await win.webContents.executeJavaScript(`
    new Promise((res) => {
      const el = document.getElementById('i');
      const go = () => {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d');
        ctx.drawImage(el, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let opaque = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 10) opaque++;
        res({ natural: el.naturalWidth + 'x' + el.naturalHeight, opaquePixels: opaque + '/1024' });
      };
      if (el.complete && el.naturalWidth) go(); else el.onload = go;
      el.onerror = () => res({ err: 'onerror' });
    })
  `);
  console.log('decode check:', JSON.stringify(r));
  win.destroy();
  app.quit();
});
