import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getTrack, listTracks, parseTrack, trackIds } from '../tracks.js';

const NEIGHBOURS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** The cells of one line, and whether it runs across or down. */
function lineOf(track, cells) {
  const xs = new Set(cells.map(([x]) => x));
  const ys = new Set(cells.map(([, y]) => y));
  assert.ok(xs.size === 1 || ys.size === 1,
    `line on ${track.id} must be straight, found ${JSON.stringify(cells)}`);
  return xs.size === 1 ? { axis: 'v', step: [0, 1] } : { axis: 'h', step: [1, 0] };
}

/**
 * A line that does not reach both walls can be driven around, and then the lap
 * never counts. This checks that every checkpoint and the finish line is an
 * unbroken line from one side of the track to the other.
 */
function assertSpansTheTrack(track, cells, what) {
  const { step } = lineOf(track, cells);
  const sorted = [...cells].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  for (let index = 1; index < sorted.length; index++) {
    const dx = sorted[index][0] - sorted[index - 1][0];
    const dy = sorted[index][1] - sorted[index - 1][1];
    assert.equal(Math.abs(dx) + Math.abs(dy), 1, `${what} on ${track.id} has a gap in it`);
  }
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  assert.equal(track.isDrivable(first[0] - step[0], first[1] - step[1]), false,
    `${what} on ${track.id} does not reach the edge of the track at ${first}`);
  assert.equal(track.isDrivable(last[0] + step[0], last[1] + step[1]), false,
    `${what} on ${track.id} does not reach the edge of the track at ${last}`);
}

function connectedCells(track) {
  let start = null;
  let total = 0;
  for (let y = 0; y < track.height; y++) {
    for (let x = 0; x < track.width; x++) {
      if (!track.isDrivable(x, y)) continue;
      if (!start) start = [x, y];
      total += 1;
    }
  }
  const seen = new Set([String(start)]);
  const queue = [start];
  while (queue.length > 0) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of NEIGHBOURS) {
      const next = [x + dx, y + dy];
      if (!track.isDrivable(next[0], next[1]) || seen.has(String(next))) continue;
      seen.add(String(next));
      queue.push(next);
    }
  }
  return { reachable: seen.size, total };
}

test('every track parses', () => {
  const tracks = listTracks();
  assert.ok(tracks.length > 0);
  assert.deepEqual(tracks.map(track => track.id), trackIds());
  for (const track of tracks) {
    assert.equal(getTrack(track.id), track, 'a track is parsed once and then shared');
    assert.ok(track.name.length > 0);
    assert.ok(track.blurb.length > 0);
    assert.ok(track.width >= 60 && track.width <= 100,
      `${track.id} is ${track.width} cells wide, which is outside 60..100`);
  }
});

test('every track has a starting grid of at least four cells, none of them a wall', () => {
  for (const track of listTracks()) {
    assert.ok(track.starts.length >= 4, `${track.id} has ${track.starts.length} starting cells`);
    const seen = new Set();
    for (const [x, y] of track.starts) {
      assert.equal(track.isWall(x, y), false, `${track.id}: start ${x},${y} is a wall`);
      assert.equal(track.isDrivable(x, y), true, `${track.id}: start ${x},${y} is off the track`);
      assert.equal(track.isFinish(x, y), false, `${track.id}: start ${x},${y} is on the finish line`);
      assert.equal(track.checkpointAt(x, y), 0, `${track.id}: start ${x},${y} is on a checkpoint`);
      assert.equal(seen.has(String([x, y])), false, `${track.id}: two cars share start ${x},${y}`);
      seen.add(String([x, y]));
    }
  }
});

test('every track has a finish line with a direction', () => {
  for (const track of listTracks()) {
    assert.ok(track.finishCells.length > 0, `${track.id} has no finish line`);
    const [dx, dy] = track.finishDir;
    assert.ok(dx !== 0 || dy !== 0, `${track.id} has no driving direction`);
    assert.ok([-1, 0, 1].includes(dx) && [-1, 0, 1].includes(dy));
    assertSpansTheTrack(track, track.finishCells, 'the finish line');
  }
});

test('every track has at least four checkpoints, numbered in order', () => {
  for (const track of listTracks()) {
    assert.ok(track.checkpointCount >= 4,
      `${track.id} has ${track.checkpointCount} checkpoints`);
    for (let number = 1; number <= track.checkpointCount; number++) {
      const cells = track.checkpointCells.get(number);
      assert.ok(cells && cells.length > 0, `${track.id} is missing checkpoint ${number}`);
      assertSpansTheTrack(track, cells, `checkpoint ${number}`);
    }
  }
});

test('every track surface is in one piece', () => {
  for (const track of listTracks()) {
    const { reachable, total } = connectedCells(track);
    assert.equal(reachable, total, `${track.id} falls into more than one piece`);
  }
});

test('the parser refuses a broken track', () => {
  const good = `
##########
#SSSS...1#
#........#
#.......F#
##########
`;
  let uniqueId = 0;
  const source = (changes = {}) => ({
    id: `broken-${uniqueId += 1}`,
    name: 'Broken',
    blurb: 'Broken',
    finishDir: [1, 0],
    text: good,
    ...changes,
  });

  assert.doesNotThrow(() => parseTrack(source()));

  assert.throws(() => parseTrack(source({ text: good.replace('.', 'x') })),
    /unknown character/);
  assert.throws(() => parseTrack(source({ text: good.replace('SSSS', 'S..S') })),
    /at least 4 starting cells/);
  assert.throws(() => parseTrack(source({ text: good.replace('F', '.') })),
    /no finish line/);
  assert.throws(() => parseTrack(source({ text: good.replace('1', '2') })),
    /numbered 1..k/);
  assert.throws(() => parseTrack(source({ finishDir: [0, 0] })), /finishDir/);
  assert.throws(() => parseTrack(source({ finishDir: [2, 0] })), /finishDir/);
  assert.throws(() => parseTrack(source({ name: '' })), /non-empty string/);
  assert.throws(() => parseTrack(source({
    text: `
##########
#SSSS...1#
##########
#.......F#
##########
`,
  })), /not connected/);
});

test('an unknown track is an error, not an empty track', () => {
  assert.throws(() => getTrack('nürburgring'), /Unknown track/);
});
