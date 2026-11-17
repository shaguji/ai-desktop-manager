const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { getFileIconDataURL } = require('./_fileicon.probe.cjs');
const targets = [
  ['此电脑', '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}'],
  ['回收站', '::{645FF040-5081-101B-9F08-00AA002F954E}']
];
app.whenReady().then(async () => {
  for (const [name, p] of targets) {
    const d = await getFileIconDataURL(p, 48);
    if (!d) return console.log(name, 'NO ICON');
    const h = crypto.createHash('md5').update(d).digest('hex').slice(0, 8);
    const m = /^data:([^;]+);base64,(.*)$/s.exec(d);
    fs.writeFileSync(`scripts/_icons/${name}.png`, Buffer.from(m[2], 'base64'));
    console.log(name, 'ok md5=' + h, Math.round(d.length / 1024) + 'KB');
  }
  app.quit();
});
