// Capture the primary screen as PNG so the desktop layer can be inspected.
const { app, desktopCapturer, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.whenReady().then(async () => {
  const out = process.env.SNAP_OUT || path.join(process.cwd(), '.shots', 'screen.png');
  const { width, height } = screen.getPrimaryDisplay().size;
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(width * scale), height: Math.round(height * scale) }
  });
  if (!sources.length) {
    console.error('no screen source');
    app.quit();
    return;
  }
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, sources[0].thumbnail.toPNG());
  console.log('[screen] saved', out, sources[0].thumbnail.getSize());
  app.quit();
});
