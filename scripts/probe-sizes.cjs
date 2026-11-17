const { app } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const exes = [
  'C://Program Files\\Clash Verge\\clash-verge.exe',
  'D://installSoft//Microsoft VS Code\\Code.exe',
  'C://Program Files\\Tencent\\QQNT\\QQ.exe'
].filter((p) => fs.existsSync(p));
const h = (b) => crypto.createHash('md5').update(b).digest('hex').slice(0, 8);
app.whenReady().then(async () => {
  for (const p of exes) {
    const row = [path.basename(p)];
    for (const size of ['small', 'normal', 'large']) {
      try {
        row.push(size + '=' + h((await app.getFileIcon(p, { size })).toPNG()));
      } catch (e) {
        row.push(size + '=ERR');
      }
    }
    console.log(row.join('  '));
  }
  app.quit();
});
