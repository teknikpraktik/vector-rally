import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_SPEED, MOVES, applyMove, createInitialState, endRace, isFinished,
  legalMoves, mulberry32, pathCells, previewMove, replayHistory, undoMove,
} from '../engine.js';
import { defineTrack } from '../tracks.js';

// Small purpose-built tracks. Each one is drawn for the rule it tests, which
// is easier to read than one general track with everything on it.

const WALLS = defineTrack({
  id: 'test-walls',
  name: 'Walls',
  blurb: 'A wall across the corridor, with a way around it.',
  finishDir: [1, 0],
  route: [[4, 1], [14, 1], [14, 5], [4, 5]],
  text: `
####################
#F.................#
#F........#........#
#F........#........#
#F........#........#
#F.......1.........#
####################
`,
});

const DIAGONAL = defineTrack({
  id: 'test-diagonal',
  name: 'Diagonal',
  blurb: 'Two wall cells that touch only at their corners.',
  finishDir: [1, 0],
  route: [[3, 1], [7, 1], [7, 4], [3, 4]],
  text: `
##########
#F.......#
#F...#...#
#F..#....#
#F.......#
#F......1#
##########
`,
});

// Checkpoint 1 is the column at x=6, the finish line the column at x=10.
const LINES = defineTrack({
  id: 'test-lines',
  name: 'Lines',
  blurb: 'A checkpoint and a finish line, each one cell thick.',
  finishDir: [1, 0],
  route: [[3, 2], [8, 2], [13, 2], [17, 2]],
  text: `
####################
#.....1...F........#
#.....1...F........#
#.....1...F........#
#.....1...F........#
####################
`,
});

const OPEN = defineTrack({
  id: 'test-open',
  name: 'Open',
  blurb: 'An empty box for the rules about other cars.',
  finishDir: [1, 0],
  route: [[4, 1], [12, 1], [12, 4], [4, 4]],
  text: `
####################
#F................1#
#F.................#
#F.................#
#F.................#
####################
`,
});

function race(track, players = 1, changes = {}) {
  return {
    ...createInitialState({
      trackId: track.id,
      laps: 2,
      seed: 1,
      players: Array.from({ length: players }, (unused, index) => ({ name: `P${index + 1}` })),
    }),
    ...changes,
  };
}

/** A state with one player moved somewhere specific. Tests need odd positions. */
function place(state, index, changes) {
  return {
    ...state,
    players: state.players.map((player, at) => (at === index ? { ...player, ...changes } : player)),
  };
}

function hasMove(moves, ax, ay) {
  return moves.some(move => move.ax === ax && move.ay === ay);
}

test('1. the path between two cells is 4-connected', () => {
  const random = mulberry32(20260919);
  for (let attempt = 0; attempt < 1000; attempt++) {
    const from = [Math.floor(random() * 200) - 100, Math.floor(random() * 200) - 100];
    const velocity = [
      Math.floor(random() * (2 * MAX_SPEED + 1)) - MAX_SPEED,
      Math.floor(random() * (2 * MAX_SPEED + 1)) - MAX_SPEED,
    ];
    const to = [from[0] + velocity[0], from[1] + velocity[1]];
    const cells = pathCells(from, to);

    assert.deepEqual(cells[0], from, 'the path starts where the car is');
    assert.deepEqual(cells[cells.length - 1], to, 'the path ends where the car lands');
    assert.equal(cells.length, 1 + Math.abs(velocity[0]) + Math.abs(velocity[1]));
    for (let index = 1; index < cells.length; index++) {
      const dx = Math.abs(cells[index][0] - cells[index - 1][0]);
      const dy = Math.abs(cells[index][1] - cells[index - 1][1]);
      assert.equal(dx + dy, 1,
        `step ${index} of ${JSON.stringify(cells)} must change exactly one coordinate by one`);
    }
  }
});

test('2. a straight wall stops a car that would have jumped over it', () => {
  const state = place(race(WALLS), 0, { pos: [5, 3], vel: [MAX_SPEED, 0] });
  const preview = previewMove(state, { ax: 0, ay: 0 });
  assert.equal(preview.reason, 'wall');
  assert.deepEqual(preview.target, [10, 3], 'the car was aiming past the wall');

  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(after.players[0].pos, [9, 3], 'it stops on the last cell before the wall');
  assert.deepEqual(after.players[0].vel, [0, 0]);
});

test('3. a diagonal wall cannot be slipped through at the corner', () => {
  const state = place(race(DIAGONAL), 0, { pos: [4, 2], vel: [0, 0] });
  assert.equal(DIAGONAL.isWall(5, 2), true);
  assert.equal(DIAGONAL.isWall(4, 3), true);

  const preview = previewMove(state, { ax: 1, ay: 1 });
  assert.deepEqual(preview.target, [5, 3], 'the car aimed diagonally between the two wall cells');
  assert.equal(preview.reason, 'wall');

  const after = applyMove(state, { ax: 1, ay: 1 });
  assert.deepEqual(after.players[0].pos, [4, 2], 'it never gets through');
  assert.deepEqual(after.players[0].vel, [0, 0]);
});

test('4. a lap counts even when the car jumps over the finish line', () => {
  const state = place(race(LINES), 0, { pos: [7, 2], vel: [MAX_SPEED, 0], checkpoints: [1] });
  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(after.players[0].pos, [12, 2], 'the finish line is not a wall');
  assert.equal(after.players[0].lap, 1);
  assert.deepEqual(after.players[0].checkpoints, [], 'the collection starts again');
});

test('5. a checkpoint is collected even when the car jumps over it', () => {
  const state = place(race(LINES), 0, { pos: [3, 2], vel: [MAX_SPEED, 0] });
  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(after.players[0].pos, [8, 2]);
  assert.deepEqual(after.players[0].checkpoints, [1]);
  assert.equal(after.players[0].lap, 0, 'the finish line was not reached');
});

test('6. crossing the finish line the wrong way counts for nothing', () => {
  const state = place(race(LINES), 0, { pos: [13, 2], vel: [-MAX_SPEED, 0], checkpoints: [1] });
  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(after.players[0].pos, [8, 2], 'it drove back over the line');
  assert.equal(after.players[0].lap, 0);
  assert.deepEqual(after.players[0].checkpoints, [1], 'and kept what it had');
});

test('7. crossing the finish line without every checkpoint counts for nothing', () => {
  const state = place(race(LINES), 0, { pos: [7, 2], vel: [MAX_SPEED, 0], checkpoints: [] });
  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.equal(after.players[0].lap, 0);
});

test('8. a car may not drive through another car on the way past', () => {
  let state = race(OPEN, 2);
  state = place(state, 0, { pos: [2, 1], vel: [3, 0] });
  state = place(state, 1, { pos: [4, 1], vel: [0, 0] });

  const preview = previewMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(preview.target, [5, 1], 'the target cell itself is free');
  assert.equal(preview.reason, 'car', 'but the way there is not');
  assert.equal(hasMove(legalMoves(state), 0, 0), false);
});

test('9. driving off the track costs the turn and all the speed', () => {
  const state = place(race(WALLS), 0, { pos: [14, 1], vel: [MAX_SPEED, 0] });
  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(after.players[0].pos, [18, 1], 'the last cell on the track');
  assert.deepEqual(after.players[0].vel, [0, 0]);
  assert.equal(after.players[0].crashes, 1);
});

test('10. a car that crashes onto a taken cell backs up to the nearest free one', () => {
  let state = race(OPEN, 3);
  state = place(state, 0, { pos: [2, 1], vel: [4, 0] });
  state = place(state, 1, { pos: [4, 1] });
  state = place(state, 2, { pos: [5, 1] });

  const after = applyMove(state, { ax: 0, ay: 0 });
  assert.deepEqual(after.players[0].pos, [3, 1],
    'it stops in front of the car at 4,1 rather than on it');
  assert.deepEqual(after.players[0].vel, [0, 0]);
  assert.equal(after.players[0].crashes, 1);

  // With both cells in front taken there is nowhere to back up to, and the
  // car simply stays where it is.
  let boxed = race(OPEN, 3);
  boxed = place(boxed, 0, { pos: [2, 1], vel: [4, 0] });
  boxed = place(boxed, 1, { pos: [3, 1] });
  boxed = place(boxed, 2, { pos: [4, 1] });
  const stuck = applyMove(boxed, { ax: 0, ay: 0 });
  assert.deepEqual(stuck.players[0].pos, [2, 1]);
  assert.deepEqual(stuck.players[0].vel, [0, 0]);
});

test('11. with all nine moves unavailable the car crashes, and can move again next turn', () => {
  let state = race(OPEN, 3);
  state = place(state, 0, { pos: [2, 2], vel: [MAX_SPEED, MAX_SPEED] });
  state = place(state, 1, { pos: [2, 3] });
  state = place(state, 2, { pos: [3, 2] });
  assert.equal(legalMoves(state).length, 0, 'boxed in at full speed');

  let after = applyMove(state, { ax: -1, ay: -1 });
  assert.deepEqual(after.players[0].pos, [2, 2], 'the car stays where it is');
  assert.deepEqual(after.players[0].vel, [0, 0]);
  assert.equal(after.players[0].crashes, 1);
  assert.equal(after.active, 1, 'and the turn passes on');

  after = applyMove(after, { ax: 0, ay: 0 });
  after = applyMove(after, { ax: 0, ay: 0 });
  assert.equal(after.active, 0, 'back to the crashed car');
  const moves = legalMoves(after);
  assert.ok(moves.length > 0, 'a car at a standstill always has somewhere to go');
  assert.equal(hasMove(moves, 0, 0), true, 'if only its own cell');
});

test('12. applying a move leaves the state it was given alone', () => {
  const state = place(race(WALLS, 2), 0, { pos: [5, 3], vel: [2, 1] });
  const before = structuredClone(state);
  applyMove(state, { ax: 1, ay: -1 });
  assert.deepEqual(state, before);
});

test('13. replaying the history reproduces the race exactly', () => {
  const random = mulberry32(7);
  let state = createInitialState({
    trackId: 'monza',
    laps: 2,
    seed: 4242,
    players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
  });

  for (let move = 0; move < 120 && !isFinished(state); move++) {
    const moves = legalMoves(state);
    const chosen = moves.length === 0
      ? { ax: 0, ay: 0 }
      : moves[Math.floor(random() * moves.length)];
    state = applyMove(state, chosen);
  }
  assert.ok(state.history.length > 100, 'the race actually happened');

  assert.deepEqual(replayHistory(state), state);
  assert.deepEqual(undoMove(state), replayHistory(state, state.history.slice(0, -1)));
  assert.equal(undoMove(state).history.length, state.history.length - 1);
});

test('14. the speed limit cannot be exceeded', () => {
  const state = place(race(OPEN), 0, { pos: [2, 2], vel: [MAX_SPEED, 0] });
  const moves = legalMoves(state);
  assert.equal(hasMove(moves, 1, 0), false);
  assert.equal(hasMove(moves, 0, 0), true);
  assert.throws(() => applyMove(state, { ax: 1, ay: 0 }), /speed limit/);

  for (const move of MOVES) {
    const velocity = [state.players[0].vel[0] + move.ax, state.players[0].vel[1] + move.ay];
    if (Math.abs(velocity[0]) > MAX_SPEED || Math.abs(velocity[1]) > MAX_SPEED) {
      assert.equal(hasMove(moves, move.ax, move.ay), false);
    }
  }
});

test('a race can be stopped early, and then nobody can move', () => {
  const state = endRace(race(OPEN));
  assert.equal(isFinished(state), true);
  assert.equal(state.status, 'ended');
  assert.deepEqual(legalMoves(state), []);
  assert.throws(() => applyMove(state, { ax: 0, ay: 0 }), /over/);
});

test('a move has to be one of the nine', () => {
  const state = race(OPEN);
  assert.throws(() => applyMove(state, { ax: 2, ay: 0 }), /-1, 0 or 1/);
  assert.throws(() => applyMove(state, null), /\{ ax, ay \}/);
});

test('a race cannot be created without a seed', () => {
  assert.throws(
    () => createInitialState({ trackId: 'monza', players: [{}] }),
    /seed/,
  );
});
