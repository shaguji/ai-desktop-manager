import { deflateSync, crc32 } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SIZE = 64;

// Build raw RGBA scanlines
const row = (y) => {
  const buf = Buffer.alloc(1 + SIZE * 4);
  buf[0] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    // accent background #4f8cff
    let r = 0x4f, g = 0x8c, b = 0xff;
    // white inner panel (a "window" look) inset 16px
    const inX = x >= 16 && x < SIZE - 16;
    const inY = y >= 16 && y < SIZE - 16;
    if (inX && inY) {
      r = 245; g = 248; b = 255;
    }
    const o = 1 + x * 4;
    buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = 255;
  }
  return buf;
};

const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) row(y).copy(raw, y * (1 + SIZE * 4));

const compressed = deflateSync(raw);

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // color type RGBA
ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  sig,
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0))
]);

const b64 = png.toString('base64');

const root = process.cwd();
mkdirSync(join(root, 'resources'), { recursive: true });
writeFileSync(join(root, 'resources', 'icon.png'), png);
writeFileSync(
  join(root, 'src', 'main', 'icon.ts'),
  `// Auto-generated placeholder icon (base64 PNG). Replace resources/icon.png for a custom icon.\nexport const ICON_BASE64 = ${JSON.stringify(b64)};\n`
);
console.log('icon generated, bytes=', png.length, 'b64 len=', b64.length);
