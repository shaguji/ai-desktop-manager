/* One-off: set wallpaper via SystemParametersInfoW with a clean path. */
const koffi = require('koffi');
const path = require('node:path');
const target = path.join(
  process.env.APPDATA,
  'desktop-manager',
  'wallpapers',
  process.argv[2] || '01-幽蓝流体.jpg'
);
const user32 = koffi.load('user32.dll');
const set = user32.func('int32_t __stdcall SystemParametersInfoW(uint32_t a, uint32_t b, str16 c, uint32_t d)');
const get = user32.func('int32_t __stdcall SystemParametersInfoW(uint32_t a, uint32_t b, str16 c, uint32_t d)');
const rc = set(0x0014, 0, target, 0x3);
const buf = Buffer.alloc(520);
get(0x0073, 520, buf, 0);
console.log('set rc =', rc, '\nnow =', buf.toString('utf16le').replace(/\0+$/, ''));
