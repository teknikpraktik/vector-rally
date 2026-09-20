import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EPSILON, generateTrack, getTrack, listTracks, parseTrack, trackIds,
} from '../tracks.js';
import { MAX_SPEED, MOVES, gateCrossings, pointInside, segmentInside } from '../engine.js';

const EXPECTED = ['monza', 'spa', 'silverstone', 'monaco', 'suzuka', 'interlagos'];

/**
 * Breadth-first over every (point, velocity, checkpoints collected) a car can
 * be in. It answers two questions at once: whether the lap can be driven at
 * all, and how few moves the very best possible lap takes. The second number
 * is what tells us whether a four-player race fits in a lesson.
 */
function fastestLap(track, limit = 120) {
  const gates = track.checkpointCount;
  const span = 2 * MAX_SPEED + 1;
  const originX = Math.floor(track.bounds.minX) - 2;
  const originY = Math.floor(track.bounds.minY) - 2;
  const width = Math.ceil(track.bounds.maxX - originX) + 4;
  const key = (x, y, vx, vy, got) =>
    ((((y - originY) * width + (x - originX)) * span + vx + MAX_SPEED) * span
      + vy + MAX_SPEED) * (gates + 1) + got;

  const clear = new Map();
  const canGo = (from, to) => {
    const id = `${from[0]},${from[1]},${to[0]},${to[1]}`;
    if (!clear.has(id)) clear.set(id, segmentInside(track, from, to));
    return clear.get(id);
  };

  const start = track.starts[Math.floor(track.starts.length / 2)];
  const seen = new Set([key(start[0], start[1], 0, 0, 0)]);
  let frontier = [[start[0], start[1], 0, 0, 0]];

  for (let depth = 1; depth <= limit; depth++) {
    const next = [];
    for (const [x, y, vx, vy, got] of frontier) {
      for (const move of MOVES) {
        const nvx = vx + move.ax;
        const nvy = vy + move.ay;
        if (Math.abs(nvx) > MAX_SPEED || Math.abs(nvy) > MAX_SPEED) continue;
        const to = [x + nvx, y + nvy];
        if (!canGo([x, y], to)) continue;

        let collected = got;
        for (const gate of gateCrossings(track, [x, y], to, 1)) {
          if (gate.number === collected + 1) collected += 1;
          else if (gate.number === 0 && collected === gates) return depth;
        }
        const id = key(to[0], to[1], nvx, nvy, collected);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push([to[0], to[1], nvx, nvy, collected]);
      }
    }
    if (next.length === 0) return null;
    frontier = next;
  }
  return null;
}

test('the six tracks are there, and each is parsed once', () => {
  assert.deepEqual(trackIds(), EXPECTED);
  for (const track of listTracks()) {
    assert.equal(getTrack(track.id), track, 'a track is parsed once and then shared');
    assert.ok(track.name.length > 0);
    assert.ok(track.character.length > 0);
  }
});

test('15a. no track bends tighter than it is wide', () => {
  for (const track of listTracks()) {
    for (let index = 0; index < track.samples.length; index++) {
      const previous = track.samples[(index - 1 + track.samples.length) % track.samples.length];
      const here = track.samples[index];
      const next = track.samples[(index + 1) % track.samples.length];
      let turn = Math.atan2(next.y - here.y, next.x - here.x)
        - Math.atan2(here.y - previous.y, here.x - previous.x);
      while (turn > Math.PI) turn -= Math.PI * 2;
      while (turn < -Math.PI) turn += Math.PI * 2;
      if (Math.abs(turn) < 1e-6) continue;
      const along = (Math.hypot(here.x - previous.x, here.y - previous.y)
        + Math.hypot(next.x - here.x, next.y - here.y)) / 2;
      assert.ok(along / Math.abs(turn) >= here.w,
        `${track.id}: radius ${(along / Math.abs(turn)).toFixed(2)} at `
        + `${here.x.toFixed(1)},${here.y.toFixed(1)} is tighter than its half-width ${here.w}`);
    }
  }
});

test('15b. no edge of a track crosses itself or the other edge', () => {
  for (const track of listTracks()) {
    for (let a = 0; a < track.edges.length; a++) {
      const one = track.edges[a];
      for (let b = a + 2; b < track.edges.length; b++) {
        const other = track.edges[b];
        if (Math.max(one[0], one[2]) < Math.min(other[0], other[2])
          || Math.min(one[0], one[2]) > Math.max(other[0], other[2])
          || Math.max(one[1], one[3]) < Math.min(other[1], other[3])
          || Math.min(one[1], one[3]) > Math.max(other[1], other[3])) continue;
        assert.equal(crosses(one, other), false,
          `${track.id}: the edge crosses itself near ${one[0].toFixed(1)},${one[1].toFixed(1)}`);
      }
    }
  }
});

function crosses(one, other) {
  const side = (ax, ay, bx, by, px, py) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
  const straddles = (a, b) => (a > EPSILON && b < -EPSILON) || (a < -EPSILON && b > EPSILON);
  return straddles(side(...one, other[0], other[1]), side(...one, other[2], other[3]))
    && straddles(side(...other, one[0], one[1]), side(...other, one[2], one[3]));
}

test('15c. the finish line holds four cars, all of them on the track', () => {
  for (const track of listTracks()) {
    assert.ok(track.starts.length >= 4,
      `${track.id}: only ${track.starts.length} whole-number points on the line`);
    for (const place of track.starts) {
      assert.equal(pointInside(track, place), true, `${track.id}: ${place} is not on the track`);
    }
  }
});

test('15d. every track has eight or nine checkpoints, evenly spread and in order', () => {
  for (const track of listTracks()) {
    assert.ok(track.checkpointCount >= 8 && track.checkpointCount <= 9,
      `${track.id} has ${track.checkpointCount} checkpoints`);
    assert.deepEqual(track.gates.map(gate => gate.number),
      Array.from({ length: track.gates.length }, (unused, index) => index),
      `${track.id}: the gates are numbered from the finish line upwards`);

    // Each gate reaches right across the track: one end outside each edge.
    for (const gate of track.gates) {
      assert.equal(pointInside(track, gate.a), false, `${track.id}: gate ${gate.number} stops short`);
      assert.equal(pointInside(track, gate.b), false, `${track.id}: gate ${gate.number} stops short`);
      assert.equal(pointInside(track, gate.at), true, `${track.id}: gate ${gate.number} misses the track`);
    }

    const spacing = [];
    for (let number = 0; number < track.gates.length; number++) {
      const here = along(track, track.gates[number].at);
      const next = along(track, track.gates[(number + 1) % track.gates.length].at);
      spacing.push(((next - here) + track.length) % track.length);
    }
    const even = track.length / track.gates.length;
    for (const gap of spacing) {
      assert.ok(gap > even * 0.55 && gap < even * 1.45,
        `${track.id}: gates ${gap.toFixed(1)} apart where ${even.toFixed(1)} was meant`);
    }
  }
});

function along(track, point) {
  let best = 0;
  let bestGap = Infinity;
  for (const sample of track.samples) {
    const gap = Math.hypot(sample.x - point[0], sample.y - point[1]);
    if (gap < bestGap) { bestGap = gap; best = sample.s; }
  }
  return best;
}

test('16. every track can actually be driven round, and the fastest lap is a lesson-sized number',
  { timeout: 120000 }, () => {
    const laps = [];
    for (const track of listTracks()) {
      const moves = fastestLap(track);
      assert.ok(moves !== null, `${track.id} cannot be driven round at all`);
      assert.ok(moves >= 12 && moves <= 55,
        `${track.id}: a perfect lap takes ${moves} moves, which is outside what a lesson holds`);
      laps.push(`${track.id} ${moves}`);
    }
    assert.equal(laps.length, 6);
  });

test('the parser refuses a broken track', () => {
  const good = {
    id: 'broken', name: 'Broken', character: 'Broken',
    centerline: ring(20, 3),
  };
  const with_ = changes => ({ ...good, ...changes });
  assert.doesNotThrow(() => parseTrack(with_({ id: 'broken-ok' })));

  assert.throws(() => parseTrack(with_({ name: '' })), /non-empty string/);
  assert.throws(() => parseTrack(with_({ centerline: [[1, 1, 2], [2, 2, 2]] })), /at least 6 points/);
  assert.throws(() => parseTrack(with_({ centerline: [...ring(20, 3).slice(0, -1), [1, 2]] })),
    /is not \[x, y, w\]/);
  assert.throws(() => parseTrack(with_({ centerline: ring(20, 0.2) })), /too small/);
  // A ring far tighter than it is wide: the inner edge would turn inside out.
  assert.throws(() => parseTrack(with_({ centerline: ring(4, 3.5) })), /fold through itself/);
});

/** A circular centreline of the given radius and half-width. */
function ring(radius, w, count = 20) {
  return Array.from({ length: count }, (unused, index) => {
    const angle = (index / count) * Math.PI * 2;
    return [
      Math.round((40 + radius * Math.cos(angle)) * 100) / 100,
      Math.round((40 + radius * Math.sin(angle)) * 100) / 100,
      w,
    ];
  });
}

test('an unknown track is an error, not an empty track', () => {
  assert.throws(() => getTrack('nürburgring'), /Unknown track/);
});

test('Anywhere produces a track that loads, for every seed it is given',
  { timeout: 120000 }, () => {
    const lengths = [];
    for (let seed = 1; seed <= 2000; seed++) {
      const { track } = generateTrack(seed);
      assert.ok(track.starts.length >= 4, `seed ${seed}: only ${track.starts.length} on the line`);
      assert.ok(track.checkpointCount >= 8, `seed ${seed}: ${track.checkpointCount} checkpoints`);
      assert.ok(track.length > 60 && track.length < 220, `seed ${seed}: length ${track.length}`);
      lengths.push(track.length);
    }
    assert.equal(lengths.length, 2000);
  });

test('Anywhere gives the same track for the same seed, and different ones for different seeds', () => {
  const first = generateTrack(1234, 'anywhere-repeat-a').source.centerline;
  const again = generateTrack(1234, 'anywhere-repeat-b').source.centerline;
  const other = generateTrack(1235, 'anywhere-repeat-c').source.centerline;
  assert.deepEqual(first, again, 'the same seed draws the same track');
  assert.notDeepEqual(first, other);
});

test('a generated track can be driven round', { timeout: 120000 }, () => {
  for (const seed of [7, 99, 4242]) {
    const { track } = generateTrack(seed, `anywhere-drive-${seed}`);
    assert.ok(fastestLap(track) !== null, `the track from seed ${seed} cannot be driven round`);
  }
});
