// Deep icon probe: compare Electron's app.getFileIcon vs Explorer-style
// SHGetFileInfoW (koffi) + HICON -> PNG render.
// Run with: npx electron scripts/probe-icon-deep.cjs
const koffi = require('koffi');
const path = require('node:path');
const fs = require('node:fs');
const { app, nativeImage } = require('electron');

const user32 = koffi.load('user32.dll');
const gdi32 = koffi.load('gdi32.dll');
const shell32 = koffi.load('shell32.dll');

koffi.struct('SHFILEINFOW', {
  hIcon: 'void*',
  iIcon: 'int32',
  dwAttributes: 'uint32',
  szDisplayName: koffi.array('char16', 260),
  szTypeName: koffi.array('char16', 80)
});
koffi.struct('ICONINFO', {
  fIcon: 'int32',
  xHotspot: 'uint32',
  yHotspot: 'uint32',
  hbmMask: 'void*',
  hbmColor: 'void*'
});
koffi.struct('BITMAP', {
  bmType: 'int32',
  bmWidth: 'int32',
  bmHeight: 'int32',
  bmWidthBytes: 'int32',
  bmPlanes: 'uint16',
  bmBitsPixel: 'uint16',
  bmBits: 'void*'
});
koffi.struct('BITMAPINFOHEADER', {
  biSize: 'uint32',
  biWidth: 'int32',
  biHeight: 'int32',
  biPlanes: 'uint16',
  biBitCount: 'uint16',
  biCompression: 'uint32',
  biSizeImage: 'uint32',
  biXPelsPerMeter: 'int32',
  biYPelsPerMeter: 'int32',
  biClrUsed: 'uint32',
  biClrImportant: 'uint32'
});

const SHGetFileInfoW = shell32.func(
  'intptr_t __stdcall SHGetFileInfoW(str16 pszPath, uint32_t dwFileAttributes, _Out_ SHFILEINFOW *psfi, uint32_t cbFileInfo, uint32_t uFlags)'
);
const GetIconInfo = user32.func('int32_t __stdcall GetIconInfo(void* hIcon, _Out_ ICONINFO *piconinfo)');
const GetObjectW = gdi32.func('int32_t __stdcall GetObjectW(void* h, int32_t c, _Out_ BITMAP *pv)');
const CreateCompatibleDC = gdi32.func('void* __stdcall CreateCompatibleDC(void* hdc)');
const DeleteDC = gdi32.func('int32_t __stdcall DeleteDC(void* hdc)');
const DeleteObject = gdi32.func('int32_t __stdcall DeleteObject(void* ho)');
const GetDIBits = gdi32.func(
  'int32_t __stdcall GetDIBits(void* hdc, void* hbm, uint32_t start, uint32_t cLines, void* lpvBits, BITMAPINFOHEADER *lpbi, uint32_t usage)'
);
const DestroyIcon = user32.func('int32_t __stdcall DestroyIcon(void* hIcon)');

const SHGFI_ICON = 0x100;
const SHGFI_LARGEICON = 0x0;

/** Explorer-style icon lookup (no SHGFI_USEFILEATTRIBUTES) -> PNG bytes. */
function shellIconPng(p) {
  const sfi = {};
  const r = SHGetFileInfoW(p, 0, sfi, koffi.sizeof('SHFILEINFOW'), SHGFI_ICON | SHGFI_LARGEICON);
  if (!r || !sfi.hIcon) return null;
  try {
    const ii = {};
    if (!GetIconInfo(sfi.hIcon, ii)) return null;
    const bm = {};
    if (!GetObjectW(ii.hbmColor, koffi.sizeof('BITMAP'), bm)) return null;
    const { bmWidth: w, bmHeight: h } = bm;
    if (!w || !h) return null;

    const bi = {
      biSize: koffi.sizeof('BITMAPINFOHEADER'),
      biWidth: w,
      biHeight: -h,
      biPlanes: 1,
      biBitCount: 32,
      biCompression: 0,
      biSizeImage: 0,
      biXPelsPerMeter: 0,
      biYPelsPerMeter: 0,
      biClrUsed: 0,
      biClrImportant: 0
    };
    const buf = Buffer.alloc(w * h * 4);
    const hdc = CreateCompatibleDC(null);
    const got = GetDIBits(hdc, ii.hbmColor, 0, h, buf, bi, 0);
    DeleteDC(hdc);
    if (!got) return null;

    const img = nativeImage.createFromBitmap(buf, { width: w, height: h });
    return img.isEmpty() ? null : img.toPNG();
  } finally {
    if (ii_clean(sfi)) {} // noop
  }
}
function ii_clean() {
  return false;
}

const targets = [
  'C:\\Program Files\\Clash Verge\\clash-verge.exe',
  'D:\\installSoft\\Codex++\\cc-switch.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Tencent\\QQNT\\QQ.exe'
].filter((p) => fs.existsSync(p));

app.whenReady().then(async () => {
  for (const p of targets) {
    let electronIcon = null;
    try {
      electronIcon = (await app.getFileIcon(p, { size: 'normal' })).toPNG();
    } catch {}
    const shellIcon = shellIconPng(p);

    const name = path.basename(p).replace(/[^\w.+-]/g, '_');
    if (shellIcon) fs.writeFileSync(`scripts/_icons/shell_${name}.png`, shellIcon);
    if (electronIcon) fs.writeFileSync(`scripts/_icons/electron_${name}.png`, electronIcon);
    console.log(
      path.basename(p).padEnd(20),
      'electron=' + (electronIcon ? 'ok' : 'FAIL'),
      'shell=' + (shellIcon ? 'ok' : 'FAIL'),
      shellIcon && electronIcon ? 'same=' + Buffer.compare(electronIcon, shellIcon) : ''
    );
  }
  app.quit();
});
