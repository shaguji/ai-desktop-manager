// Hit-test probe: asks Windows which window actually owns a screen point.
// If the overlay is swallowing clicks, WindowFromPoint returns the overlay hwnd
// even over empty desktop space.
// Run with: npx electron scripts/probe-hittest.cjs
const koffi = require('koffi');
const { app } = require('electron');

const user32 = koffi.load('user32.dll');

koffi.struct('PT', { x: 'int32', y: 'int32' });
koffi.struct('RC', { left: 'int32', top: 'int32', right: 'int32', bottom: 'int32' });

const FindWindowW = user32.func('void* __stdcall FindWindowW(str16 cls, str16 title)');
const FindWindowExW = user32.func('void* __stdcall FindWindowExW(void* p, void* a, str16 cls, str16 title)');
const SetCursorPos = user32.func('int32_t __stdcall SetCursorPos(int32_t x, int32_t y)');
const GetCursorPos = user32.func('int32_t __stdcall GetCursorPos(_Out_ PT *pt)');
const WindowFromPoint = user32.func('void* __stdcall WindowFromPoint(PT pt)');
const GetClassNameW = user32.func('int32_t __stdcall GetClassNameW(void* h, void* buf, int32_t n)');
const GetWindowTextW = user32.func('int32_t __stdcall GetWindowTextW(void* h, void* buf, int32_t n)');
const GetWindowRect = user32.func('int32_t __stdcall GetWindowRect(void* h, _Out_ RC *r)');
const GetWindowLongW = user32.func('int32_t __stdcall GetWindowLongW(void* h, int32_t i)');
const GetAncestor = user32.func('void* __stdcall GetAncestor(void* h, uint32_t flags)');
const GA_ROOT = 2;

const text = (fn, h) => {
  const b = Buffer.alloc(1024);
  fn(h, b, 512);
  return b.toString('utf16le').split('\0')[0];
};
const cls = (h) => text(GetClassNameW, h);
const title = (h) => text(GetWindowTextW, h);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function describe(h) {
  if (!h) return '(null)';
  return `${cls(h)} "${title(h)}"`;
}

app.whenReady().then(async () => {
  // Locate the desktop layer: full-screen Chrome_WidgetWin_1 titled 桌面管家.
  const layer = FindWindowW(null, '桌面管家');
  const settingsWin = FindWindowW(null, '桌面管家 · 设置');
  console.log('desktop layer hwnd:', layer, layer ? describe(layer) : '');
  console.log('settings  hwnd:', settingsWin, settingsWin ? describe(settingsWin) : '');
  if (layer) {
    const r = {};
    GetWindowRect(layer, r);
    console.log('layer rect:', `${r.left},${r.top} - ${r.right},${r.bottom}`);
    console.log('layer addr:', koffi.address(layer), 'WS_EX:', '0x' + (GetWindowLongW(layer, -20) >>> 0).toString(16));
  }

  const prog = FindWindowW('Progman', null);
  const defv = prog ? FindWindowExW(prog, null, 'SHELLDLL_DefView', null) : null;
  const lv = defv ? FindWindowExW(defv, null, 'SysListView32', null) : null;
  console.log('SysListView32 (desktop icons):', lv, lv ? describe(lv) : '');
  console.log('');

  const saved = {};
  GetCursorPos(saved);

  const points = [
    [100, 60, '桌面左上（此电脑/回收站图标区）'],
    [1150, 720, '桌面右下空白处'],
    [640, 400, '屏幕正中空白处'],
    [300, 160, '收纳窗口内部（应被拦截）'],
    [500, 330, '收纳窗口右边缘附近']
  ];

  for (const [x, y, label] of points) {
    SetCursorPos(x, y);
    await sleep(700);
    const hit = WindowFromPoint({ x, y });
    const root = hit ? GetAncestor(hit, GA_ROOT) : null;
    const isLayer = root && layer && koffi.address(root) === koffi.address(layer);
    console.log(
      `(${x},${y}) ${label}\n   -> top=${describe(root)}  ${isLayer ? '❌ 被桌面层拦截' : '✅ 交给下层'}`
    );
  }

  SetCursorPos(saved.x, saved.y);
  app.quit();
});
