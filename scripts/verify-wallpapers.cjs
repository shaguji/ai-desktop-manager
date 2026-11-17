/* 验证内置壁纸列表是否包含新增的搞笑正能量壁纸 */
const { app } = require('electron');
const path = require('node:path');
app.setName('desktop-manager');
app.whenReady().then(() => {
  const wp = require(path.join(__dirname, '..', 'out', 'main', 'wallpapers.js'));
  const list = wp.listBuiltinWallpapers(null);
  console.log('COUNT=' + list.length);
  list.forEach((w, i) => console.log(`${i + 1}. ${w.name} thumb=${w.thumb ? 'yes' : 'no'}`));
  app.exit(0);
});
