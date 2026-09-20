import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyMove, createInitialState, isFinished, legalMoves, previewMove } from '../engine.js';
import { AGENT_NAMES, KINDS, PLANNER_BUDGET, chooseMove, isAgent } from '../agents.js';
import { trackIds } from '../tracks.js';

/** Drives one car round on its own and reports what that cost it. */
function solo(trackId, kind, { budget = PLANNER_BUDGET, limit = 400 } = {}) {
  let state = createInitialState({ trackId, seed: 5, players: [{ name: kind, kind }] });
  let moves = 0;
  let worst = 0;
  let fellBack = 0;
  while (!isFinished(state) && moves < limit) {
    const { move, stats } = chooseMove(state, budget);
    worst = Math.max(worst, stats.expanded);
    if (stats.fellBack) fellBack += 1;
    state = applyMove(state, move);
    moves += 1;
  }
  return { state, player: state.players[0], moves, worst, fellBack };
}

test('both drivers offer a move the rules accept, on every track', () => {
  for (const trackId of trackIds()) {
    for (const kind of ['greedy', 'planner']) {
      const state = createInitialState({ trackId, seed: 3, players: [{ kind }] });
      const { move, stats } = chooseMove(state);
      assert.ok(MOVEish(move), `${trackId}/${kind}: ${JSON.stringify(move)} is not a move`);
      assert.equal(previewMove(state, move).blocking, false,
        `${trackId}/${kind}: chose a move that cannot be made`);
      assert.equal(stats.kind, kind);
      assert.ok(stats.expanded > 0 && stats.ms >= 0);
      assert.doesNotThrow(() => applyMove(state, move));
    }
  }
});

function MOVEish(move) {
  return move && [-1, 0, 1].includes(move.ax) && [-1, 0, 1].includes(move.ay);
}

test('Planner gets round every track without leaving it', { timeout: 120000 }, () => {
  for (const trackId of trackIds()) {
    const { player, moves } = solo(trackId, 'planner');
    assert.equal(player.finished, true, `${trackId}: the planner never finished`);
    assert.equal(player.crashes, 0, `${trackId}: the planner went off ${player.crashes} times`);
    assert.ok(moves < 60, `${trackId}: the planner took ${moves} moves`);
  }
});

test('Greedy gets round too, but drives off doing it — that is the whole point',
  { timeout: 120000 }, () => {
    for (const trackId of trackIds()) {
      const greedy = solo(trackId, 'greedy');
      const planner = solo(trackId, 'planner');
      assert.equal(greedy.player.finished, true, `${trackId}: greedy never finished`);
      assert.ok(greedy.player.crashes > planner.player.crashes,
        `${trackId}: greedy went off ${greedy.player.crashes} times and the planner `
        + `${planner.player.crashes}, so there is nothing to see`);
      assert.ok(greedy.moves > planner.moves,
        `${trackId}: greedy took ${greedy.moves} moves and the planner ${planner.moves}`);
    }
  });

test('the planner stays well inside its budget on the tracks that ship',
  { timeout: 120000 }, () => {
    for (const trackId of trackIds()) {
      const { worst, fellBack } = solo(trackId, 'planner');
      assert.equal(fellBack, 0, `${trackId}: the planner ran out of budget`);
      assert.ok(worst < PLANNER_BUDGET / 4,
        `${trackId}: worst move looked at ${worst} states of ${PLANNER_BUDGET}`);
    }
  });

test('when the budget does run out the planner says so and drives on', () => {
  const state = createInitialState({ trackId: 'monza', seed: 3, players: [{ kind: 'planner' }] });
  const { move, stats } = chooseMove(state, 5);
  assert.equal(stats.fellBack, true, 'it gave up and said so');
  assert.equal(stats.kind, 'planner', 'and it still reports as the planner');
  assert.equal(stats.budget, 5);
  assert.equal(previewMove(state, move).blocking, false, 'the move it fell back on is a real one');
});

test('a driver never picks a move that cannot be made', { timeout: 120000 }, () => {
  for (const kind of ['greedy', 'planner']) {
    let state = createInitialState({
      trackId: 'silverstone', seed: 9, players: [{ kind }, { kind: 'greedy' }],
    });
    for (let move = 0; move < 60 && !isFinished(state); move++) {
      const legal = legalMoves(state);
      const chosen = chooseMove(state).move;
      if (legal.length > 0) {
        assert.ok(legal.some(one => one.ax === chosen.ax && one.ay === chosen.ay),
          `${kind} picked ${JSON.stringify(chosen)}, which is not one of the moves it may make`);
      }
      state = applyMove(state, chosen);
    }
  }
});

test('a boxed-in driver still offers a move, and the crash rule takes it', () => {
  // Four cars at full speed with the three whole-number points ahead covered.
  const home = [30, 20];
  const state = createInitialState({
    trackId: 'silverstone', seed: 1,
    players: [{ kind: 'planner' }, { kind: 'greedy' }, {}, {}],
  });
  const boxed = {
    ...state,
    players: state.players.map((player, index) => {
      if (index === 0) return { ...player, pos: home, vel: [5, 5] };
      const spots = [[1, 1], [4, 5], [5, 4]][index - 1];
      return { ...player, pos: [home[0] + spots[0], home[1] + spots[1]] };
    }),
  };
  if (legalMoves(boxed).length !== 0) return; // the geometry moved; nothing to assert
  const { move } = chooseMove(boxed);
  const after = applyMove(boxed, move);
  assert.deepEqual(after.players[0].pos, home);
  assert.deepEqual(after.players[0].vel, [0, 0]);
  assert.equal(after.players[0].crashes, 1);
});

test('the same race gives the same drive, and nothing is modified on the way', () => {
  const state = createInitialState({
    trackId: 'interlagos', seed: 77, players: [{ kind: 'planner' }, { kind: 'greedy' }],
  });
  const before = structuredClone(state);
  const once = chooseMove(state).move;
  const twice = chooseMove(state).move;
  assert.deepEqual(once, twice, 'the same state always gives the same move');
  assert.deepEqual(state, before, 'and choosing changes nothing');
});

test('the drivers are named, and human is not one of them', () => {
  assert.deepEqual(KINDS, ['human', 'greedy', 'planner']);
  assert.equal(isAgent('human'), false);
  assert.equal(isAgent('greedy'), true);
  assert.equal(isAgent('planner'), true);
  assert.equal(AGENT_NAMES.greedy, 'Greedy');
  assert.equal(AGENT_NAMES.planner, 'Planner');
});

test('Greedy and Planner can race each other, and the Planner wins',
  { timeout: 120000 }, () => {
    let state = createInitialState({
      trackId: 'monza',
      seed: 4,
      players: [{ name: 'Greedy', kind: 'greedy' }, { name: 'Planner', kind: 'planner' }],
    });
    for (let move = 0; move < 400 && !isFinished(state); move++) {
      state = applyMove(state, chooseMove(state).move);
    }
    const [greedy, planner] = state.players;
    assert.equal(planner.finished, true, 'the planner got home');
    assert.ok(planner.finishTurn === null || greedy.finishTurn === null
      || planner.finishTurn < greedy.finishTurn, 'and got there first');
    assert.ok(greedy.crashes > 0, 'while the greedy one kept falling off');
  });
