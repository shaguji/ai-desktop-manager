// Verifies SHChangeNotify(SHCNE_UPDATEDIR) with a str16 path + null second arg
// refreshes the desktop ListView (stale icons disappear).
// Run with: npx electron scripts/probe-notify.cjs
const koffi = require('koffi');
const { app } = require('electron');

const shell32 = koffi.load('shell32.dll');
const SHChangeNotify = shell32.func(
  'void SHChangeNotify(int32_t wEventId, uint32_t uFlags, str16 dwItem1, str16 dwItem2)'
);

const SHCNE_UPDATEDIR = 0x00001000;
const SHCNF_PATHW = 0x0005;
const SHCNF_FLUSHNOWAIT = 0x3000;

app.whenReady().then(() => {
  const desktop = app.getPath('desktop');
  try {
    SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, desktop, null);
    console.log('[notify] ok (PATHW)');
  } catch (e) {
    console.error('[notify] PATHW failed:', e.message);
    try {
      const SHChangeNotify2 = shell32.func(
        'void SHChangeNotify(int32_t wEventId, uint32_t uFlags, void* dwItem1, void* dwItem2)'
      );
      const buf = Buffer.from(desktop + '\0', 'utf16le');
      SHChangeNotify2(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, buf, null);
      console.log('[notify] ok (Buffer)');
    } catch (e2) {
      console.error('[notify] Buffer failed:', e2.message);
    }
  }
  setTimeout(() => app.quit(), 1500);
});
