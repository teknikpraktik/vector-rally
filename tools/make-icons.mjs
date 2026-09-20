/**
 * Draws every picture the app ships with — the icons, and the placeholder
 * that stands in for a screenshot — using nothing but Node's own zlib: the
 * PNG chunks are assembled by hand here.
 *
 * Run it from the repository root when the artwork changes:
 *
 *   node tools/make-icons.mjs
 *
 * The generated files are committed, so nobody needs to run this to play the
 * game. It exists so the icons are reproducible instead of mysterious.
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

function canvas(size, tall = size) {
  const data = new Uint8ClampedArray(size * tall * 4);
  const plot = (x, y, color, coverage = 1) => {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= size || y >= tall || coverage <= 0) return;
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
    height: tall,
    fill(color) {
      for (let y = 0; y < tall; y++) for (let x = 0; x < size; x++) plot(x, y, color);
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
 *
 * `inset` shrinks the drawing towards the middle. A maskable icon may be
 * cropped to a circle by the launcher, so everything that matters has to stay
 * inside the middle 80 per cent.
 */
function draw(size, { inset = 1, cells = 12 } = {}) {
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
  const place = ([x, y]) => [
    (0.5 + (x - 0.5) * inset) * size,
    (0.5 + (y - 0.5) * inset) * size,
  ];

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
  const big = draw(size * SUPERSAMPLE, {
    ...options,
    cells: options && options.cells,
  });
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

function png({ size, pixels, height = size }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;   // bits per channel
  header[9] = 6;   // truecolour with alpha
  header[10] = 0;  // deflate
  header[11] = 0;  // adaptive filtering
  header[12] = 0;  // no interlacing

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
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


// ---------------------------------------------------------------------------
// The placeholder that stands in for a screenshot
// ---------------------------------------------------------------------------

/**
 * A picture of a race, drawn from the real track geometry by running the real
 * agents under the real rules. It is *not* a screenshot: there is no interface
 * in it, because this script has no browser to photograph. It says so across
 * the bottom of itself, and the README says so too. Replace it with a real one.
 */

/** Five by seven, which is all the letters this needs. */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
};

function write(image, text, x, y, scale, colour) {
  let at = x;
  for (const letter of text.toUpperCase()) {
    const glyph = GLYPHS[letter];
    if (glyph) {
      glyph.forEach((row, down) => {
        [...row].forEach((on, across) => {
          if (on !== '#') return;
          image.rect(at + across * scale, y + down * scale,
            at + (across + 1) * scale, y + (down + 1) * scale, colour);
        });
      });
    }
    at += 6 * scale;
  }
  return at;
}

function stroke(image, points, weight, colour, closed = false) {
  const count = closed ? points.length : points.length - 1;
  for (let index = 0; index < count; index++) {
    const [x0, y0] = points[index];
    const [x1, y1] = points[(index + 1) % points.length];
    image.line(x0, y0, x1, y1, weight, colour);
  }
}

async function screenshot() {
  const { applyMove, createInitialState, isFinished } = await import('../engine.js');
  const { chooseMove } = await import('../agents.js');
  const { getTrack } = await import('../tracks.js');

  const width = 1280;
  const height = 760;
  const board = getTrack('silverstone');
  const image = canvas(width, height);
  image.fill(PAPER);

  const pad = 40;
  const { minX, maxX, minY, maxY } = board.bounds;
  const size = Math.min((width - pad * 2) / (maxX - minX), (height - pad * 2 - 60) / (maxY - minY));
  const ox = (width - (maxX - minX) * size) / 2 - minX * size;
  const oy = (height - 60 - (maxY - minY) * size) / 2 - minY * size;
  const at = (x, y) => [ox + x * size, oy + y * size];

  // The surface, asked of the geometry itself rather than guessed at.
  for (let py = 0; py < height - 60; py++) {
    for (let px = 0; px < width; px++) {
      if (board.contains((px - ox) / size, (py - oy) / size)) image.plot(px, py, [251, 249, 243]);
    }
  }
  for (let x = Math.ceil(minX) - 2; x <= maxX + 2; x++) {
    const [sx] = at(x, 0);
    image.rect(sx, 0, sx + 1, height - 60, GRID);
  }
  for (let y = Math.ceil(minY) - 2; y <= maxY + 2; y++) {
    const [, sy] = at(0, y);
    image.rect(0, sy, width, sy + 1, GRID);
  }

  for (const loop of [board.outer, board.inner]) {
    stroke(image, loop.map(point => at(point[0], point[1])), Math.max(1, size * 0.06), GRAPHITE, true);
  }

  const every = Math.max(1, Math.round(6 / (board.samples[0].step || 0.4)));
  for (let index = 0; index < board.samples.length; index += every) {
    const sample = board.samples[index];
    const [sx, sy] = at(sample.x, sample.y);
    const wing = size * 0.5;
    for (const side of [-1, 1]) {
      image.line(sx - (sample.tx * 0.7 - sample.ty * side * 0.7) * wing,
        sy - (sample.ty * 0.7 + sample.tx * side * 0.7) * wing, sx, sy,
        Math.max(1, size * 0.07), [59, 59, 64, 0.32]);
    }
  }

  const gate = board.gates[0];
  for (let step = 0; step < 16; step += 2) {
    const from = step / 16;
    const to = (step + 1) / 16;
    const along = share => [
      gate.a[0] + (gate.b[0] - gate.a[0]) * share,
      gate.a[1] + (gate.b[1] - gate.a[1]) * share,
    ];
    image.line(...at(...along(from)), ...at(...along(to)), size * 0.22, GRAPHITE);
  }

  // A real race, a dozen turns in.
  const colours = [[47, 111, 143], [161, 80, 63], [74, 122, 68]];
  let state = createInitialState({
    trackId: board.id,
    seed: 20260920,
    players: [
      { name: 'P1', kind: 'planner' },
      { name: 'P2', kind: 'greedy' },
      { name: 'P3', kind: 'planner' },
    ],
  });
  for (let move = 0; move < 33 && !isFinished(state); move++) {
    state = applyMove(state, chooseMove(state).move);
  }
  state.players.forEach((player, index) => {
    const points = [...player.trace, player.pos].map(point => at(point[0], point[1]));
    stroke(image, points, Math.max(1.5, size * 0.09), [...colours[index], 0.65]);
    for (const [x, y] of points.slice(0, -1)) image.disc(x, y, size * 0.13, [...colours[index], 0.8]);
    const [cx, cy] = points[points.length - 1];
    image.disc(cx, cy, size * 0.42, colours[index]);
    image.ring(cx, cy, size * 0.42, Math.max(1.5, size * 0.1), GRAPHITE);
  });

  // And a line across the bottom saying what this is.
  image.rect(0, height - 60, width, height, [233, 226, 212]);
  image.rect(0, height - 60, width, height - 57, GRAPHITE);
  write(image, 'PLACEHOLDER  NOT A REAL SCREENSHOT', 28, height - 42, 3, GRAPHITE);
  return { size: width, pixels: image.data, height };
}

const files = [
  ['screenshot.png', png(await screenshot())],
  ['icon-192.png', png(icon(192, { cells: 10 }))],
  ['icon-512.png', png(icon(512, { cells: 12 }))],
  ['icon-maskable-512.png', png(icon(512, { cells: 12, inset: 0.68 }))],
  ['apple-touch-icon.png', png(icon(180, { cells: 10 }))],
  ['favicon.ico', ico(icon(32, { cells: 6 }))],
];

for (const [name, bytes] of files) {
  writeFileSync(join(ROOT, name), bytes);
  console.log(`${name}  ${bytes.length} bytes`);
}
