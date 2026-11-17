/**
 * Generates the app icon (ico + png) with no external image assets.
 *
 * Design: a dark rounded square holding a white sticky-note card with three
 * text lines and a green "done" dot — the product is a desktop organizer with
 * a note widget, so the mark reads at 16px as "note + done".
 *
 * Everything is drawn at 4x and downsampled, which gives clean anti-aliased
 * edges without any drawing library.
 */
const fs = require('node:fs');
const path = require('node:path');
const Jimp = require('jimp');

const S = 2048; // supersampled canvas
const img = new Jimp(S, S, 0x00000000);
const { data } = img.bitmap;

function px(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  const sa = a / 255;
  if (sa >= 1) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
    return;
  }
  const da = data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  data[i] = Math.round((r * sa + data[i] * da * (1 - sa)) / oa);
  data[i + 1] = Math.round((g * sa + data[i + 1] * da * (1 - sa)) / oa);
  data[i + 2] = Math.round((b * sa + data[i + 2] * da * (1 - sa)) / oa);
  data[i + 3] = Math.round(oa * 255);
}

/** Rounded-rect coverage with a smooth 1px falloff (supersampled anyway). */
function inRR(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r || (x >= x0 + r && x <= x1 - r) || (y >= y0 + r && y <= y1 - r);
}

function fillRR(x0, y0, x1, y1, r, colorAt) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inRR(x, y, x0, y0, x1, y1, r)) continue;
      const c = colorAt(x, y);
      px(x, y, c[0], c[1], c[2], c[3] === undefined ? 255 : c[3]);
    }
  }
}

// ── 1. Background: rounded square with a vertical gradient ──────────────
const TOP = [38, 48, 74];
const BOT = [18, 23, 38];
fillRR(64, 64, S - 64, S - 64, 430, (_x, y) => {
  const t = (y - 64) / (S - 128);
  const e = t * t * (3 - 2 * t);
  return [
    Math.round(TOP[0] + (BOT[0] - TOP[0]) * e),
    Math.round(TOP[1] + (BOT[1] - TOP[1]) * e),
    Math.round(TOP[2] + (BOT[2] - TOP[2]) * e),
    255
  ];
});

// Inner top highlight, so the tile looks glassy rather than flat.
fillRR(112, 112, S - 112, 900, 380, (x, y) => {
  const t = 1 - (y - 112) / 788;
  return [255, 255, 255, Math.round(9 * t)];
});

// ── 2. Sticky note card ────────────────────────────────────────────────
const CARD = { x0: 424, y0: 348, x1: 1624, y1: 1404, r: 96 };
// Soft drop shadow under the card.
fillRR(CARD.x0 - 12, CARD.y0 + 26, CARD.x1 + 12, CARD.y1 + 46, CARD.r, () => [0, 0, 0, 46]);
fillRR(CARD.x0, CARD.y0, CARD.x1, CARD.y1, CARD.r, () => [246, 248, 252, 255]);

// Three text lines: two full width, one short.
const LINE = [201, 210, 227, 255];
fillRR(592, 620, 1456, 676, 28, () => LINE);
fillRR(592, 796, 1456, 852, 28, () => LINE);
fillRR(592, 972, 1206, 1028, 28, () => LINE);

// ── 3. Green "done" dot ────────────────────────────────────────────────
const DOT = { cx: 1382, cy: 1176, r: 132 };
for (let y = DOT.cy - DOT.r; y <= DOT.cy + DOT.r; y++) {
  for (let x = DOT.cx - DOT.r; x <= DOT.cx + DOT.r; x++) {
    const dx = x - DOT.cx;
    const dy = y - DOT.cy;
    if (dx * dx + dy * dy <= DOT.r * DOT.r) px(x, y, 70, 197, 126, 255);
  }
}
// White check inside the dot (thick polyline, round joins).
function thickLine(x0, y0, x1, y1, w, color) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  const pad = Math.ceil(w);
  for (let y = Math.floor(Math.min(y0, y1)) - pad; y <= Math.ceil(Math.max(y0, y1)) + pad; y++) {
    for (let x = Math.floor(Math.min(x0, x1)) - pad; x <= Math.ceil(Math.max(x0, x1)) + pad; x++) {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / len2));
      const qx = x0 + t * dx - x;
      const qy = y0 + t * dy - y;
      if (qx * qx + qy * qy <= (w / 2) * (w / 2)) px(x, y, color[0], color[1], color[2], color[3]);
    }
  }
}
const W = [255, 255, 255, 255];
thickLine(DOT.cx - 62, DOT.cy + 6, DOT.cx - 16, DOT.cy + 54, 30, W);
thickLine(DOT.cx - 16, DOT.cy + 54, DOT.cx + 70, DOT.cy - 44, 30, W);

// ── 4. Export PNGs + ICO ───────────────────────────────────────────────
(async () => {
  const SIZES = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const size of SIZES) {
    const scaled = img.clone().resize(size, size, Jimp.RESIZE_BICUBIC);
    pngs.push({ size, buf: await scaled.getBufferAsync(Jimp.MIME_PNG) });
  }

  /** PNG-compressed ICO container (Vista+). */
  function buildIco(entries) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(entries.length, 4);
    const dir = Buffer.alloc(16 * entries.length);
    let offset = 6 + dir.length;
    entries.forEach((e, i) => {
      const o = i * 16;
      dir.writeUInt8(e.size >= 256 ? 0 : e.size, o);
      dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1);
      dir.writeUInt8(0, o + 2);
      dir.writeUInt8(0, o + 3);
      dir.writeUInt16LE(1, o + 4);
      dir.writeUInt16LE(32, o + 6);
      dir.writeUInt32LE(e.buf.length, o + 8);
      dir.writeUInt32LE(offset, o + 12);
      offset += e.buf.length;
    });
    return Buffer.concat([header, dir, ...entries.map((e) => e.buf)]);
  }

  const root = path.resolve(__dirname, '..');
  fs.writeFileSync(path.join(root, 'resources/icon.ico'), buildIco(pngs));
  const icon256 = pngs.find((p) => p.size === 256);
  fs.writeFileSync(path.join(root, 'resources/icon.png'), icon256.buf);
  const tray = pngs.find((p) => p.size === 64);
  fs.writeFileSync(path.join(root, 'resources/tray.b64'), tray.buf.toString('base64'));

  console.log('icon.ico', fs.statSync(path.join(root, 'resources/icon.ico')).size, 'bytes');
  console.log('sizes', SIZES.join(','));
})();
