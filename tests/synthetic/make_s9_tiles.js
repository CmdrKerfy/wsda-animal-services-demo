'use strict';
// Synthetic PNG backgrounds for the S9 browser suite ("Backgrounds"): the suite answers the page's
// requests to server.arcgisonline.com itself, so the tile backgrounds are tested with no network. Each picture is a
// checkerboard of two colors per background, easy to find in the exported PNG and unlike any color the branded page
// draws. No packages: the PNG is written with Node's zlib.
//
//   const { syntheticPng, COLORS } = require('./tests/synthetic/make_s9_tiles.js');
//   syntheticPng(512, 256, 'satellite')   -> Buffer (an RGB PNG)

const zlib = require('zlib');

// Two colors per background (the first fills even squares).
const COLORS = {
  satellite: ['#3a7d44', '#2f6a39'],
  relief: ['#c9a66b', '#b8955c'],
  hillshade: ['#8f9aa6', '#7e8995'],
  tile: ['#6b4fa0', '#5c4290']
};
const SQUARE = 32;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

function syntheticPng(width, height, kind) {
  const [a, b] = (COLORS[kind] || COLORS.tile).map(rgb);
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;   // no filter
    for (let x = 0; x < width; x++) {
      const c = (Math.floor(x / SQUARE) + Math.floor(y / SQUARE)) % 2 ? b : a;
      raw.set(c, row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

module.exports = { syntheticPng, COLORS, SQUARE };
