import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SPEED, MOVES, applyMove, createInitialState, endRace, gateCrossings, isFinished,
  legalMoves, mulberry32, pointInside, previewMove, replayHistory,
  segmentInside, undoMove,
} from '../engine.js';
import { defineTrack, listTracks } from '../tracks.js';

/**
 * Two straights joined by half circles. The straights are exactly straight, so
 * the edge of the track lies on exact coordinates and a point can be put
 * exactly on it.
 */
function stadium(id, { left, right, top, bottom, w, step = 4, arc = 20 }) {
  const radius = (bottom - top) / 2;
  const middle = (top + bottom) / 2;
  const round = value => Math.round(value * 100) / 100;
  const points = [];
  for (let x = left; x <= right; x += step) points.push([x, top, w]);
  for (let angle = -90 + arc; angle <= 90 - arc; angle += arc) {
    const turn = (angle * Math.PI) / 180;
    points.push([round(right + radius * Math.cos(turn)), round(middle + radius * Math.sin(turn)), w]);
  }
  for (let x = right; x >= left; x -= step) points.push([x, bottom, w]);
  for (let angle = 90 + arc; angle <= 270 - arc; angle += arc) {
    const turn = (angle * Math.PI) / 180;
    points.push([round(left + radius * Math.cos(turn)), round(middle + radius * Math.sin(turn)), w]);
  }
  return defineTrack({ id, name: id, character: 'A test track', centerline: points });
}

// The top straight runs along y = 8 with a half-width of 2.5, so the track
// there is exactly the strip 5.5 < y < 10.5.
const WIDE = stadium('test-wide', { left: 16, right: 44, top: 8, bottom: 28, w: 2.5 });
// Small enough that its gates are about five apart, so one move can pass two.
const SMALL = stadium('test-small', { left: 18, right: 28, top: 16, bottom: 26, w: 2.2, step: 5, arc: 30 });
// Wide enough to box a car in on open ground.
const OPEN = stadium('test-open', { left: 20, right: 44, top: 12, bottom: 52, w: 6.5, step: 6, arc: 30 });

function race(track, players = 1) {
  return createInitialState({
    trackId: track.id,
    seed: 1,
    players: Array.from({ length: players }, (unused, index) => ({ name: `P${index + 1}` })),
  });
}

/** A state with one car moved somewhere specific. Tests need odd positions. */
function place(state, index, changes) {
  return {
    ...state,
    players: state.players.map((player, at) => (at === index ? { ...player, ...changes } : player)),
  };
}

function hasMove(moves, ax, ay) {
  return moves.some(move => move.ax === ax && move.ay === ay);
}

test('1. a point is on the track, off it, or exactly on the edge — which is off', () => {
  assert.equal(pointInside(WIDE, [30, 8]), true, 'the middle of the straight');
  assert.equal(pointInside(WIDE, [30, 10]), true, 'just inside the edge');
  assert.equal(pointInside(WIDE, [30, 10.5]), false, 'exactly on the edge is not on the track');
  assert.equal(pointInside(WIDE, [30, 5.5]), false, 'and neither is the other edge');
  assert.equal(pointInside(WIDE, [30, 11]), false, 'past the edge');
  assert.equal(pointInside(WIDE, [30, 18]), false, 'the hole in the middle');
});

test('2. a move that cuts out of a bend and back in is refused, on every track', () => {
  for (const track of [WIDE, SMALL, OPEN, ...listTracks()]) {
    let found = null;
    const { minX, maxX, minY, maxY } = track.bounds;
    search:
    for (let y = Math.floor(minY); y <= Math.ceil(maxY) && !found; y++) {
      for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
        if (!pointInside(track, [x, y])) continue;
        for (const velocity of speeds()) {
          const to = [x + velocity[0], y + velocity[1]];
          if (!pointInside(track, to)) continue;
          if (track.hit([x, y], to) === null) continue;
          found = { from: [x, y], to };
          break search;
        }
      }
    }
    assert.ok(found, `${track.id}: expected some move that leaves the track between its ends`);
    assert.equal(pointInside(track, found.from), true);
    assert.equal(pointInside(track, found.to), true, 'both ends are on the track');
    assert.equal(segmentInside(track, found.from, found.to), false,
      `${track.id}: ${JSON.stringify(found)} leaves the track on the way and must be refused`);
  }
});

function speeds() {
  const list = [];
  for (let vx = -MAX_SPEED; vx <= MAX_SPEED; vx++) {
    for (let vy = -MAX_SPEED; vy <= MAX_SPEED; vy++) {
      if (vx !== 0 || vy !== 0) list.push([vx, vy]);
    }
  }
  return list.sort((a, b) => (b[0] * b[0] + b[1] * b[1]) - (a[0] * a[0] + a[1] * a[1]));
}

test('3. a move that grazes the edge without crossing it is allowed', () => {
  // The top straight is the strip 5.5 < y < 10.5, so this runs a thousandth of
  // a unit inside the edge for five units without ever leaving.
  const from = [24, 10.499];
  const to = [29, 10.499];
  assert.equal(pointInside(WIDE, from), true);
  assert.equal(pointInside(WIDE, to), true);
  assert.equal(segmentInside(WIDE, from, to), true, 'touching the edge is not crossing it');
});

test('4. a move straight through a corner of the edge is refused', () => {
  // Corners are where the sign test gives up, so the answer there is always no.
  let refused = 0;
  for (const edge of WIDE.edges) {
    const corner = [edge[0], edge[1]];
    for (const reach of [[1.2, 0.35], [0.35, 1.2], [0.9, -0.9]]) {
      const from = [corner[0] - reach[0], corner[1] - reach[1]];
      const to = [corner[0] + reach[0], corner[1] + reach[1]];
      if (!pointInside(WIDE, from) || !pointInside(WIDE, to)) continue;
      assert.equal(segmentInside(WIDE, from, to), false,
        `a line from ${from} to ${to} passes through the corner at ${corner}`);
      refused += 1;
    }
  }
  assert.ok(refused > 0, 'there was at least one corner to try this on');
});

test('5. a gate counts one way round only', () => {
  const gate = SMALL.gates[0];
  const across = [gate.b[0] - gate.a[0], gate.b[1] - gate.a[1]];
  const middle = gate.at;
  const step = 2;
  const forward = [
    [middle[0] - gate.dir[0] * step - across[0] * 0, middle[1] - gate.dir[1] * step],
    [middle[0] + gate.dir[0] * step, middle[1] + gate.dir[1] * step],
  ];
  assert.equal(gateCrossings(SMALL, forward[0], forward[1], 1).some(hit => hit.number === 0), true,
    'the right way round counts');
  assert.equal(gateCrossings(SMALL, forward[1], forward[0], 1).some(hit => hit.number === 0), false,
    'the wrong way round does not');
});

test('6. one move can pass two gates, and they are taken in order', () => {
  let found = null;
  const { minX, maxX, minY, maxY } = SMALL.bounds;
  search:
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    for (let x = Math.floor(minX); x <= Math.ceil(maxX); x++) {
      if (!pointInside(SMALL, [x, y])) continue;
      for (const velocity of speeds()) {
        const to = [x + velocity[0], y + velocity[1]];
        if (!segmentInside(SMALL, [x, y], to)) continue;
        const crossings = gateCrossings(SMALL, [x, y], to, 1);
        if (crossings.length >= 2) { found = { from: [x, y], to, crossings }; break search; }
      }
    }
  }
  assert.ok(found, 'a small track has gates close enough to pass two in one move');
  for (let index = 1; index < found.crossings.length; index++) {
    assert.ok(found.crossings[index].t > found.crossings[index - 1].t,
      'the gates come back in the order the car reached them');
  }
});

test('7. a checkpoint cannot be jumped, even at full speed', () => {
  // Every gate reaches from one edge of the track to the other, so there is no
  // way across the track that misses one.
  let state = race(SMALL);
  const track = SMALL;
  const gate = track.gates[1];
  const before = [Math.round(gate.at[0] - gate.dir[0] * 3), Math.round(gate.at[1] - gate.dir[1] * 3)];
  assert.equal(pointInside(track, before), true, 'somewhere to start from');

  let crossed = false;
  for (const velocity of speeds()) {
    const to = [before[0] + velocity[0], before[1] + velocity[1]];
    if (!segmentInside(track, before, to)) continue;
    const beyond = (to[0] - gate.at[0]) * gate.dir[0] + (to[1] - gate.at[1]) * gate.dir[1];
    if (beyond <= 0) continue;
    // This move ends past the gate, so it has to have gone through it.
    assert.ok(gateCrossings(track, before, to, 1).some(hit => hit.number === 1),
      `moving from ${before} to ${to} ended past gate 1 without registering it`);
    crossed = true;
  }
  assert.ok(crossed, 'at least one move got past the gate');
});

test('8. a car that leaves the track comes to rest off it, at a standstill', () => {
  // The top straight is the strip 5.5 < y < 10.5.
  const state = place(race(WIDE), 0, { pos: [30, 10], vel: [0, -5] });
  const outcome = previewMove(state, { ax: 0, ay: 0 });
  assert.equal(outcome.reason, 'off track');
  assert.equal(outcome.blocking, false, 'you are allowed to get it wrong');
  assert.ok(outcome.hit, 'and it knows where the line left the track');

  const after = applyMove(state, { ax: 0, ay: 0 });
  const car = after.players[0];
  assert.equal(pointInside(WIDE, car.pos), false,
    `it ended at ${car.pos}, which is still on the track`);
  assert.deepEqual(car.vel, [0, 0]);
  assert.equal(car.crashes, 1);
  assert.ok(Math.hypot(car.pos[0] - outcome.hit.x, car.pos[1] - outcome.hit.y) < 3,
    `it came to rest at ${car.pos}, nowhere near where it crossed the edge`);
});

test('9. a car that is off the track may only drive back onto it', () => {
  const off = place(race(WIDE), 0, { pos: [30, 10], vel: [0, -5] });
  const state = applyMove(off, { ax: 0, ay: 0 });
  assert.equal(pointInside(WIDE, state.players[0].pos), false);

  const moves = legalMoves(state);
  assert.ok(moves.length > 0, 'there is a way back');
  assert.ok(moves.length < 9, 'but not every direction is one');
  for (const move of moves) {
    const outcome = previewMove(state, move);
    assert.equal(pointInside(WIDE, outcome.target), true,
      `${JSON.stringify(move)} leads to ${outcome.target}, which is not back on the track`);
  }
  const back = applyMove(state, moves[0]);
  assert.equal(pointInside(WIDE, back.players[0].pos), true, 'and it took it');
  assert.equal(back.players[0].crashes, 1, 'rejoining is not another crash');
});
test('10. cars are points, and a move may not go through one', () => {
  let state = race(WIDE, 2);
  state = place(state, 0, { pos: [24, 8], vel: [4, 0] });
  state = place(state, 1, { pos: [26, 8] });

  const outcome = previewMove(state, { ax: 0, ay: 0 });
  assert.equal(outcome.reason, 'car', 'the other car is exactly on the way');
  assert.equal(outcome.blocking, true);
  assert.equal(hasMove(legalMoves(state), 0, 0), false);
  assert.throws(() => applyMove(state, { ax: 0, ay: 0 }), /standing in the way/);

  // A hair to either side and the cars pass each other, which is the point of
  // making them points.
  const past = place(state, 0, { pos: [24, 9], vel: [4, 0] });
  assert.equal(previewMove(past, { ax: 0, ay: 0 }).reason, null, 'past it, close but clear');
});

test('11. with all nine moves unavailable the car crashes, and can move again next turn', () => {
  // At full speed only four moves are left, and the whole-number points on
  // those four lines can be covered by three cars.
  const home = [30, 7];
  let state = race(OPEN, 4);
  state = place(state, 0, { pos: home, vel: [MAX_SPEED, MAX_SPEED] });
  state = place(state, 1, { pos: [home[0] + 1, home[1] + 1] });
  state = place(state, 2, { pos: [home[0] + 4, home[1] + 5] });
  state = place(state, 3, { pos: [home[0] + 5, home[1] + 4] });
  for (const player of state.players) {
    assert.equal(pointInside(OPEN, player.pos), true, `${player.pos} is off the track`);
  }
  assert.equal(legalMoves(state).length, 0, 'boxed in at full speed');

  let after = applyMove(state, { ax: -1, ay: -1 });
  assert.deepEqual(after.players[0].pos, home, 'the car stays where it is');
  assert.deepEqual(after.players[0].vel, [0, 0]);
  assert.equal(after.players[0].crashes, 1);
  assert.equal(after.active, 1, 'and the turn passes on');

  after = applyMove(after, { ax: 0, ay: 0 });
  after = applyMove(after, { ax: 0, ay: 0 });
  after = applyMove(after, { ax: 0, ay: 0 });
  assert.equal(after.active, 0, 'back to the crashed car');
  const moves = legalMoves(after);
  assert.ok(moves.length > 0, 'a car at a standstill always has somewhere to go');
  assert.equal(hasMove(moves, 0, 0), true, 'if only its own point');
});

test('12. applying a move leaves the state it was given alone', () => {
  const state = place(race(WIDE, 2), 0, { pos: [24, 8], vel: [2, 1] });
  const before = structuredClone(state);
  applyMove(state, { ax: 1, ay: -1 });
  assert.deepEqual(state, before);
});

test('13. replaying the history reproduces the race exactly', () => {
  const random = mulberry32(11);
  let state = createInitialState({
    trackId: 'monza', seed: 4242, players: [{ name: 'A' }, { name: 'B' }],
  });
  for (let move = 0; move < 120 && !isFinished(state); move++) {
    const moves = legalMoves(state);
    state = applyMove(state, moves.length === 0
      ? { ax: 0, ay: 0 }
      : moves[Math.floor(random() * moves.length)]);
  }
  assert.ok(state.history.length > 60, 'the race actually happened');
  assert.deepEqual(replayHistory(state), state);
  assert.equal(undoMove(state).history.length, state.history.length - 1);
});

test('14. the speed limit cannot be exceeded', () => {
  const state = place(race(OPEN), 0, { pos: [30, 14], vel: [MAX_SPEED, 0] });
  assert.equal(pointInside(OPEN, [30, 14]), true, 'the car is on the track to begin with');
  const moves = legalMoves(state);
  assert.equal(hasMove(moves, 1, 0), false);
  assert.throws(() => applyMove(state, { ax: 1, ay: 0 }), /speed limit/);
  for (const move of MOVES) {
    const velocity = state.players[0].vel[0] + move.ax;
    if (Math.abs(velocity) > MAX_SPEED) assert.equal(hasMove(moves, move.ax, move.ay), false);
  }
});

test('every car starts on the finish line, at a standstill', () => {
  const state = race(WIDE, 4);
  for (const player of state.players) {
    assert.deepEqual(player.vel, [0, 0]);
    assert.ok(WIDE.starts.some(place => place[0] === player.pos[0] && place[1] === player.pos[1]));
  }
  const spread = new Set(state.players.map(player => String(player.pos)));
  assert.equal(spread.size, 4, 'and no two of them in the same place');
});

test('a race can be stopped early, and then nobody can move', () => {
  const state = endRace(race(WIDE));
  assert.equal(isFinished(state), true);
  assert.deepEqual(legalMoves(state), []);
  assert.throws(() => applyMove(state, { ax: 0, ay: 0 }), /over/);
});

test('a race cannot be created without a seed', () => {
  assert.throws(() => createInitialState({ trackId: 'monza', players: [{}] }), /seed/);
});
