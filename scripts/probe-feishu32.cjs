const { app } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const mod = require('./_fileicon.probe.cjs');
const LNK = path.join(process.env.USERPROFILE, 'Desktop', '整理', '应用程序', '飞书.lnk');
app.whenReady().then(async () => {
  try {
    const d = await mod.getFileIconDataURL(LNK, 32);
    console.log('len=', d ? d.length : 0, d ? 'mime=' + d.slice(5, d.indexOf(';')) : 'EMPTY', d ? 'md5=' + crypto.createHash('md5').update(d).digest('hex').slice(0, 8) : '');
  } catch (e) {
    console.log('THREW:', e.message);
  }
  app.quit();
});
