// Post WM_KEYDOWN/UP VK_F5 to the desktop SysListView32 to force a full refresh.
const koffi = require('koffi');
const { app } = require('electron');

const user32 = koffi.load('user32.dll');
const FindWindowW = user32.func('void* __stdcall FindWindowW(str16 cls, str16 title)');
const FindWindowExW = user32.func(
  'void* __stdcall FindWindowExW(void* parent, void* after, str16 cls, str16 title)'
);
const PostMessageW = user32.func(
  'int32_t __stdcall PostMessageW(void* hwnd, uint32_t msg, uintptr_t wp, intptr_t lp)'
);

const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const VK_F5 = 0x74;

app.whenReady().then(() => {
  const progman = FindWindowW('Progman', null);
  let defview = FindWindowExW(progman, null, 'SHELLDLL_DefView', null);
  if (!defview) {
    // WorkerW fallback
    let worker = null;
    for (let i = 0; i < 40 && !defview; i++) {
      worker = FindWindowExW(null, worker, 'WorkerW', null);
      if (!worker) break;
      defview = FindWindowExW(worker, null, 'SHELLDLL_DefView', null);
    }
  }
  console.log('[f5] defview =', defview);
  if (!defview) { app.quit(); return; }
  const list = FindWindowExW(defview, null, 'SysListView32', 'FolderView');
  console.log('[f5] listview =', list);
  const target = list || defview;
  PostMessageW(target, WM_KEYDOWN, VK_F5, 0);
  PostMessageW(target, WM_KEYUP, VK_F5, 0);
  console.log('[f5] sent');
  setTimeout(() => app.quit(), 1500);
});
