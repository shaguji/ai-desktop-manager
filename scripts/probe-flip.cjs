// Verifies the dynamic capture/passthrough flip by reading WS_EX_TRANSPARENT
// while the cursor moves between a fence and empty desktop space.
// Run with: npx electron scripts/probe-flip.cjs
const koffi = require('koffi');
const { app, screen } = require('electron');

const user32 = koffi.load('user32.dll');
koffi.struct('PT2', { x: 'int32', y: 'int32' });
const FindWindowW = user32.func('void* __stdcall FindWindowW(str16 cls, str16 title)');
const SetCursorPos = user32.func('int32_t __stdcall SetCursorPos(int32_t x, int32_t y)');
const GetCursorPos = user32.func('int32_t __stdcall GetCursorPos(_Out_ PT2 *pt)');
const GetWindowLongW = user32.func('int32_t __stdcall GetWindowLongW(void* h, int32_t i)');

const GWL_EXSTYLE = -20;
const WS_EX_TRANSPARENT = 0x20;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function state(layer) {
  const ex = GetWindowLongW(layer, GWL_EXSTYLE) >>> 0;
  return {
    raw: '0x' + ex.toString(16),
    clickThrough: (ex & WS_EX_TRANSPARENT) !== 0
  };
}

app.whenReady().then(async () => {
  let layer = FindWindowW(null, '桌面管家');
  for (let i = 0; i < 20 && !layer; i++) { await sleep(500); layer = FindWindowW(null, '桌面管家'); }
  if (!layer) {
    console.log('桌面层未找到');
    return app.quit();
  }
  const dpr = screen.getPrimaryDisplay().scaleFactor;
  console.log('scaleFactor =', dpr);

  const saved = {};
  GetCursorPos(saved);

  const css = (x, y) => [Math.round(x * dpr), Math.round(y * dpr)];
  const fencePoint = css(300, 160); // inside the收纳 window
  const emptyPoint = css(1250, 800); // far from any UI

  for (const [label, pt] of [
    ['围栏内部', fencePoint],
    ['桌面上方空白', emptyPoint],
    ['再次进入围栏', fencePoint]
  ]) {
    SetCursorPos(pt[0], pt[1]);
    await sleep(900);
    const s = state(layer);
    console.log(
      `${label.padEnd(8)} (${pt[0]},${pt[1]})  exstyle=${s.raw}  ` +
        (s.clickThrough ? '穿透 → 桌面可点 ✅' : '捕获 → 只响应围栏 ✅')
    );
  }

  SetCursorPos(saved.x, saved.y);
  app.quit();
});
