// Try SHChangeNotify with SHCNF_IDLIST + desktop PIDL (the documented way to
// make the desktop ListView re-enumerate).
const koffi = require('koffi');
const { app } = require('electron');

const shell32 = koffi.load('shell32.dll');
const SHGetSpecialFolderLocation = shell32.func(
  'int32_t SHGetSpecialFolderLocation(void* hwnd, int32_t csidl, _Out_ void** ppidl)'
);
const SHChangeNotify = shell32.func(
  'void SHChangeNotify(int32_t wEventId, uint32_t uFlags, void* dwItem1, void* dwItem2)'
);

const CSIDL_DESKTOP = 0x0000;
const SHCNE_UPDATEDIR = 0x00001000;
const SHCNF_IDLIST = 0x0000;
const SHCNF_FLUSHNOWAIT = 0x3000;

app.whenReady().then(() => {
  const pidlBuf = Buffer.alloc(8);
  const hr = SHGetSpecialFolderLocation(null, CSIDL_DESKTOP, pidlBuf);
  console.log('[pidl] hr =', hr);
  if (hr !== 0) { app.quit(); return; }
  const pidl = koffi.decode(pidlBuf, 'void *');
  console.log('[pidl] value =', pidl);
  try {
    SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_IDLIST | SHCNF_FLUSHNOWAIT, pidl, null);
    console.log('[notify] IDLIST ok');
  } catch (e) {
    console.error('[notify] IDLIST failed:', e.message);
  }
  setTimeout(() => app.quit(), 1500);
});
