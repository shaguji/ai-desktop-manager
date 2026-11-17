const { app, desktopCapturer, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
app.whenReady().then(async () => {
  const d = screen.getPrimaryDisplay();
  const srcs = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: d.bounds.width, height: d.bounds.height }
  });
  if (!srcs.length) return console.log('no screen source'), app.quit();
  const png = srcs[0].thumbnail.toPNG();
  const out = path.join(__dirname, '_screen.png');
  fs.writeFileSync(out, png);
  console.log('saved', out, png.length, 'bytes, size', srcs[0].thumbnail.getSize());
  app.quit();
});
