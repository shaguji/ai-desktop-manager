// Walk the top-level window chain (Progman + all WorkerW) and report every
// SHELLDLL_DefView with its SysListView32 item count.
const koffi = require('koffi');
const { app } = require('electron');

const user32 = koffi.load('user32.dll');
const FindWindowW = user32.func('void* __stdcall FindWindowW(str16 cls, str16 title)');
const FindWindowExW = user32.func(
  'void* __stdcall FindWindowExW(void* parent, void* after, str16 cls, str16 title)'
);
const SendMessageW = user32.func(
  'intptr_t __stdcall SendMessageW(void* hwnd, uint32_t msg, uintptr_t wp, intptr_t lp)'
);
const IsWindowVisible = user32.func('int32_t IsWindowVisible(void* hwnd)');

const LVM_GETITEMCOUNT = 0x1004;

function report(label, parent) {
  const dv = FindWindowExW(parent, null, 'SHELLDLL_DefView', null);
  if (!dv) return;
  const lv = FindWindowExW(dv, null, 'SysListView32', 'FolderView');
  const count = lv ? SendMessageW(lv, LVM_GETITEMCOUNT, 0, 0) : -1;
  console.log("[view]", label, "defview=", dv, "visible=", IsWindowVisible(dv), "items=", count);
}

app.whenReady().then(() => {
  const progman = FindWindowW('Progman', null);
  report('Progman', progman);
  let worker = null;
  let i = 0;
  while (true) {
    worker = FindWindowExW(null, worker, 'WorkerW', null);
    if (!worker) break;
    report(`WorkerW#${i++}`, worker);
  }
  console.log('[view] scan done,', i, 'WorkerW windows');
  setTimeout(() => app.quit(), 1200);
});
