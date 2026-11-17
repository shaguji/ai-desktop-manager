// Diagnostic: enumerate top-level windows and report Electron overlay state.
const koffi = require('koffi');
const user32 = koffi.load('user32.dll');

const FindWindowExW = user32.func('void* FindWindowExW(void* p, void* after, str16 cls, str16 title)');
const GetWindowTextW = user32.func('int32_t GetWindowTextW(void* h, void* buf, int32_t max)');
const GetClassNameW = user32.func('int32_t GetClassNameW(void* h, void* buf, int32_t max)');
const GetWindowRect = user32.func('int32_t GetWindowRect(void* h, void* rect)');
const IsWindowVisible = user32.func('int32_t IsWindowVisible(void* h)');
const GetWindowLongW = user32.func('int32_t GetWindowLongW(void* h, int32_t idx)');

function text(h) {
  const b = Buffer.alloc(512 * 2);
  GetWindowTextW(h, b, 512);
  return b.toString('utf16le').replace(/\0.*/s, '');
}
function cls(h) {
  const b = Buffer.alloc(256 * 2);
  GetClassNameW(h, b, 256);
  return b.toString('utf16le').replace(/\0.*/s, '');
}
function rect(h) {
  const b = Buffer.alloc(16);
  GetWindowRect(h, b);
  const [l, t, r, bo] = [b.readInt32LE(0), b.readInt32LE(4), b.readInt32LE(8), b.readInt32LE(12)];
  return { l, t, w: r - l, h: bo - t };
}

const GWL_EXSTYLE = -20;
const WS_EX_LAYERED = 0x00080000;
const WS_EX_TRANSPARENT = 0x00000020;

const rows = [];
let prev = null;
for (let i = 0; i < 400; i++) {
  const h = FindWindowExW(null, prev, null, null);
  if (!h) break;
  prev = h;
  const c = cls(h);
  const t = text(h);
  if (c !== 'Chrome_WidgetWin_1' && !/桌面管家/.test(t)) continue;
  const r = rect(h);
  const ex = GetWindowLongW(h, GWL_EXSTYLE);
  rows.push({
    z: i,
    title: t || '(无标题)',
    cls: c,
    visible: !!IsWindowVisible(h),
    rect: `${r.w}x${r.h} @ (${r.l},${r.t})`,
    layered: !!(ex & WS_EX_LAYERED),
    clickThrough: !!(ex & WS_EX_TRANSPARENT)
  });
}
console.log('屏幕:', JSON.stringify(require('electron') ? {} : {}));
console.log('找到 Electron 窗口:', rows.length);
console.table(rows);
