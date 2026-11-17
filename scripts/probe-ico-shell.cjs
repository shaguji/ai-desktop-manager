const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { shellIconPng } = require('./_shellicon.probe.cjs');
const icoPath = path.join(process.env.LOCALAPPDATA, 'Feishu', 'icon.ico');
app.whenReady().then(() => {
  const png = shellIconPng(icoPath);
  if (!png) return console.log('shellIconPng(.ico) = null'), app.quit();
  fs.mkdirSync('scripts/_icons', { recursive: true });
  fs.writeFileSync('scripts/_icons/feishu_shell.png', png);
  console.log('shellIconPng(.ico) =', png.length, 'bytes PNG');
  app.quit();
});
