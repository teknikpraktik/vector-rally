/**
 * Draws the favicon using nothing but Node's own zlib: the PNG inside the
 * .ico is assembled by hand here.
 *
 * Run it from the repository root when the artwork changes:
 *
 *   node tools/make-icons.mjs
 *
 * The generated file is committed, so nobody needs to run this to play the
 * game. It exists so the icon is reproducible instead of mysterious.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// The same pencil-on-graph-paper palette the game itself uses.
const PAPER = [244, 241, 232];
const GRID = [201, 212, 222];
const GRID_STRONG = [178, 195, 209];
const GRAPHITE = [58, 58, 58];
const CAR = [47, 111, 143];

/** Everything is drawn at four times the size and averaged down afterwards. */
const SUPERSAMPLE = 4;

function canvas(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const plot = (x, y, color, coverage = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= size || coverage <= 0) return;
    const at = (y * size + x) * 4;
    for (let channel = 0; channel < 3; channel++) {
      data[at + channel] = data[at + channel] * (1 - coverage) + color[channel] * coverage;
    }
    data[at + 3] = Math.max(data[at + 3], 255 * coverage);
  };
  return {
    size,
    data,
    plot,
    fill(color) {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) plot(x, y, color);
    },
    rect(x0, y0, x1, y1, color) {
      for (let y = Math.round(y0); y < Math.round(y1); y++) {
        for (let x = Math.round(x0); x < Math.round(x1); x++) plot(x, y, color);
      }
    },
    disc(cx, cy, radius, color) {
      for (let y = Math.floor(cy - radius); y <= Math.ceil(cy + radius); y++) {
        for (let x = Math.floor(cx - radius); x <= Math.ceil(cx + radius); x++) {
          if (Math.hypot(x - cx, y - cy) <= radius) plot(x, y, color);
        }
      }
    },
    ring(cx, cy, radius, width, color) {
      for (let y = Math.floor(cy - radius - width); y <= Math.ceil(cy + radius + width); y++) {
        for (let x = Math.floor(cx - radius - width); x <= Math.ceil(cx + radius + width); x++) {
          const distance = Math.abs(Math.hypot(x - cx, y - cy) - radius);
          if (distance <= width / 2) plot(x, y, color);
        }
      }
    },
    line(x0, y0, x1, y1, width, color) {
      const minX = Math.floor(Math.min(x0, x1) - width);
      const maxX = Math.ceil(Math.max(x0, x1) + width);
      const minY = Math.floor(Math.min(y0, y1) - width);
      const maxY = Math.ceil(Math.max(y0, y1) + width);
      const dx = x1 - x0;
      const dy = y1 - y0;
      const lengthSquared = dx * dx + dy * dy || 1e-9;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const along = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / lengthSquared));
          const distance = Math.hypot(x - (x0 + along * dx), y - (y0 + along * dy));
          if (distance <= width / 2) plot(x, y, color);
        }
      }
    },
  };
}

/** Averages the oversized drawing down to its final size. */
function downsample(big, size) {
  const out = new Uint8ClampedArray(size * size * 4);
  const factor = big.size / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const totals = [0, 0, 0, 0];
      for (let sy = 0; sy < factor; sy++) {
        for (let sx = 0; sx < factor; sx++) {
          const at = (((y * factor) + sy) * big.size + (x * factor) + sx) * 4;
          for (let channel = 0; channel < 4; channel++) totals[channel] += big.data[at + channel];
        }
      }
      const at = (y * size + x) * 4;
      for (let channel = 0; channel < 4; channel++) {
        out[at + channel] = totals[channel] / (factor * factor);
      }
    }
  }
  return out;
}

/**
 * The artwork: graph paper, and a racing line turning a corner — the same
 * dotted trace the game draws behind a car.
 */
function draw(size, { cells = 12 } = {}) {
  const image = canvas(size);
  image.fill(PAPER);

  const step = size / cells;
  const thin = Math.max(1, size / 220);
  for (let index = 1; index < cells; index++) {
    const at = Math.round(index * step);
    const heavy = index % 4 === 0;
    image.rect(at, 0, at + (heavy ? thin * 1.6 : thin), size, heavy ? GRID_STRONG : GRID);
    image.rect(0, at, size, at + (heavy ? thin * 1.6 : thin), heavy ? GRID_STRONG : GRID);
  }

  // A car braking into a corner and accelerating out of it: the steps bunch
  // up where it is slow and stretch out where it is fast.
  const trace = [
    [0.13, 0.85], [0.28, 0.78], [0.41, 0.68], [0.50, 0.56],
    [0.54, 0.43], [0.62, 0.33], [0.73, 0.26], [0.85, 0.21],
  ];
  const place = ([x, y]) => [x * size, y * size];

  const stroke = Math.max(1.5, size / 46);
  for (let index = 1; index < trace.length; index++) {
    const [x0, y0] = place(trace[index - 1]);
    const [x1, y1] = place(trace[index]);
    image.line(x0, y0, x1, y1, stroke, GRAPHITE);
  }
  for (const point of trace.slice(0, -1)) {
    const [x, y] = place(point);
    image.disc(x, y, size / 40, GRAPHITE);
  }

  const [carX, carY] = place(trace[trace.length - 1]);
  image.disc(carX, carY, size / 15, CAR);
  image.ring(carX, carY, size / 11, Math.max(1.5, size / 50), GRAPHITE);
  return image;
}

function icon(size, options) {
  const big = draw(size * SUPERSAMPLE, options);
  return { size, pixels: downsample(big, size) };
}

// --- PNG, written by hand ---------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length, 0);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([head, typed, crc]);
}

function png({ size, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;   // bits per channel
  header[9] = 6;   // truecolour with alpha
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlacing

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An .ico file with a single PNG inside it, which every browser since IE11 reads. */
function ico(image) {
  const body = png(image);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(1, 4); // one image
  const entry = Buffer.alloc(16);
  entry[0] = image.size < 256 ? image.size : 0;
  entry[1] = image.size < 256 ? image.size : 0;
  entry.writeUInt16LE(1, 4);  // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(body.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);
  return Buffer.concat([header, entry, body]);
}

const files = [
  ['favicon.ico', ico(icon(32, { cells: 6 }))],
];

for (const [name, bytes] of files) {
  writeFileSync(join(ROOT, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}
