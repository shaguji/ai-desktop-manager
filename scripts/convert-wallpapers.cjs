/* 用 Electron nativeImage 把 .wpgen/outN.png 转成 JPG 壁纸 */
const { app, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const GEN = path.join(__dirname, '.wpgen');
const NAMES = [
  '07-摸鱼是为了更好地游泳',
  '08-代码会崩我不崩',
  '09-涨了我又行了',
  '10-先活着再优秀',
  '11-再撑一下就是周五',
  '12-余额不足快乐管够'
];

app.whenReady().then(() => {
  const destDir = path.join(__dirname, '..', 'resources', 'wallpapers');
  let ok = 0;
  NAMES.forEach((name, i) => {
    const src = path.join(GEN, `out${i}.png`);
    const img = nativeImage.createFromPath(src);
    if (img.isEmpty()) { console.log(`FAIL empty ${src}`); return; }
    const size = img.getSize();
    const jpg = img.toJPEG(92);
    const dest = path.join(destDir, `${name}.jpg`);
    fs.writeFileSync(dest, jpg);
    console.log(`OK ${name}.jpg ${size.width}x${size.height} ${(jpg.length / 1024).toFixed(0)}KB`);
    ok++;
  });
  console.log(`DONE ${ok}/6`);
  app.exit(0);
});
