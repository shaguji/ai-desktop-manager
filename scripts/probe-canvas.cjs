const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const feishuIco = fs.readFileSync(path.join(process.env.LOCALAPPDATA, 'Feishu', 'icon.ico'));

// 钉钉 ico 路径不确定，先只测飞书 + 从 ico 里抠出的 PNG 帧
// 帧0: PNG 256x256 off=134 len=10131
const frame0 = feishuIco.subarray(134, 134 + 10131);
const b64Ico = feishuIco.toString('base64');
const b64Png = frame0.toString('base64');

const html = `<canvas id="c1" width="32" height="32"></canvas>
<canvas id="c2" width="32" height="32"></canvas>
<img id="i1" src="data:image/x-icon;base64,${b64Ico}">
<img id="i2" src="data:image/png;base64,${b64Png}">`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 200, height: 100 });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  const r = await win.webContents.executeJavaScript(`
    (async () => {
      const load = (id) => new Promise((res, rej) => {
        const el = document.getElementById(id);
        if (el.complete && el.naturalWidth) return res(el);
        el.onload = () => res(el);
        el.onerror = () => rej(new Error(id + ' onerror'));
      });
      const draw = async (imgId, canvasId) => {
        try {
          const img = await load(imgId);
          const ctx = document.getElementById(canvasId).getContext('2d');
          ctx.drawImage(img, 0, 0, 32, 32);
          const data = ctx.getImageData(0, 0, 32, 32).data;
          let opaque = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i] > 10) opaque++;
          return { ok: true, natural: img.naturalWidth + 'x' + img.naturalHeight, opaquePixels: opaque + '/1024' };
        } catch (e) { return { ok: false, err: e.message }; }
      };
      return { ico: await draw('i1', 'c1'), pngFrame: await draw('i2', 'c2') };
    })()
  `);
  console.log(JSON.stringify(r, null, 1));
  win.destroy();
  app.quit();
});
