// Notify the shell that specific desktop entries were deleted, so the desktop
// ListView drops their stale icons. Test with two paths first.
const koffi = require('koffi');
const { app } = require('electron');

const shell32 = koffi.load('shell32.dll');
const SHChangeNotify = shell32.func(
  'void SHChangeNotify(int32_t wEventId, uint32_t uFlags, str16 dwItem1, str16 dwItem2)'
);

const SHCNE_DELETE = 0x00000004;
const SHCNE_RMDIR = 0x00000010;
const SHCNF_PATHW = 0x0005;
const SHCNF_FLUSHNOWAIT = 0x3000;

const targets = [
  'C:\\Users\\surface\\Desktop\\CC Switch.lnk',
  'C:\\Users\\surface\\Desktop\\Telegram.lnk'
];

app.whenReady().then(() => {
  for (const p of targets) {
    try {
      SHChangeNotify(SHCNE_DELETE, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, p, null);
      console.log('[delete-notify] ok', p);
    } catch (e) {
      console.error('[delete-notify] failed', p, e.message);
    }
  }
  setTimeout(() => app.quit(), 1500);
});
