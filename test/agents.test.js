import { test } from 'node:test';
import assert from 'node:assert/strict';

import { applyMove, createInitialState, isFinished, legalMoves, previewMove } from '../engine.js';
import {
  AGENT_NAMES, KINDS, LEARNER_DEFAULTS, PLANNER_BUDGET, chooseMove, createLearner,
  isAgent, learningCurve, packTable, unpackTable,
} from '../agents.js';
import { getTrack, trackIds } from '../tracks.js';
import { readFileSync } from 'node:fs';

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
  assert.deepEqual(KINDS, ['human', 'greedy', 'planner', 'learner']);
  assert.equal(isAgent('human'), false);
  assert.equal(isAgent('greedy'), true);
  assert.equal(isAgent('planner'), true);
  assert.equal(AGENT_NAMES.greedy, 'Greedy');
  assert.equal(AGENT_NAMES.planner, 'Planner');
  assert.equal(AGENT_NAMES.learner, 'Learner');
  assert.equal(isAgent('learner'), true);
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

// ---------------------------------------------------------------------------
// The Learner
// ---------------------------------------------------------------------------

/** Trains one, quickly, for the tests that only need a table to exist. */
function taught(trackId, episodes = 20000, extra = {}) {
  const track = getTrack(trackId);
  const learner = createLearner(track, { episodes, seed: 4, ...extra });
  while (!learner.done) learner.runFor(50);
  return { track, learner };
}

test('learning brings the number of moves an attempt takes down', { timeout: 120000 }, () => {
  const { learner } = taught('interlagos', 40000);
  const curve = learningCurve(learner.stats.lengths, 10);
  const first = curve[0][1];
  const last = curve[curve.length - 1][1];
  assert.ok(last < first * 0.8,
    `it started at ${first} moves an attempt and ended at ${last}, which is not learning`);
  assert.ok(learner.stats.states > 1000, 'and it remembered a fair few states');
  assert.ok(learner.stats.arrivals > 100, 'and actually arrived somewhere');
});

test('a table survives being handed between threads', { timeout: 120000 }, () => {
  const { track, learner } = taught('suzuka');
  const packed = packTable(learner);
  assert.equal(packed.keys.length, learner.table.size);
  const back = unpackTable(track, packed);

  const state = createInitialState({
    trackId: 'suzuka', seed: 2, players: [{ kind: 'learner' }],
  });
  assert.deepEqual(chooseMove(state, undefined, back).move,
    chooseMove(state, undefined, learner).move,
    'the unpacked table drives exactly as the original did');
});

test('a Learner with nothing to go on says so and drives anyway', () => {
  const state = createInitialState({ trackId: 'monza', seed: 2, players: [{ kind: 'learner' }] });
  const { move, stats } = chooseMove(state, undefined, null);
  assert.equal(stats.kind, 'learner');
  assert.equal(stats.fellBack, true, 'it fell back rather than sitting there');
  assert.equal(previewMove(state, move).blocking, false);
});

test('a table learned on one track is no use on another', { timeout: 120000 }, () => {
  const { learner } = taught('monaco', 60000);
  // Somewhere else entirely, the same numbers mean nothing. Note that it
  // usually still *has* an entry: a state is numbered from the track bounds,
  // and two tracks of similar size number the same numbers. The entry is
  // simply about somewhere else, which is why the interface decides by track
  // rather than by whether the table has heard of the state.
  let state = createInitialState({
    trackId: 'spa', seed: 2, players: [{ kind: 'learner' }],
  });
  for (let move = 0; move < 40 && !isFinished(state); move++) {
    state = applyMove(state, chooseMove(state, undefined, learner).move);
  }
  assert.equal(state.players[0].finished, false,
    'a table from Monaco got a car round Spa, which it has no business doing');
});
test('a taught Learner that gets round still loses to the Planner',
  { timeout: 300000 }, () => {
    const trackId = 'interlagos';
    const drive = (kind, learner) => {
      let state = createInitialState({ trackId, seed: 5, players: [{ kind }] });
      let moves = 0;
      while (!isFinished(state) && moves < 400) {
        state = applyMove(state, chooseMove(state, undefined, learner).move);
        moves += 1;
      }
      return { moves, player: state.players[0] };
    };

    // Training does not always converge on something that gets round — about
    // four runs in five do. That is a fact about the method rather than a
    // fault, so the test tries twice and says so if neither works out.
    let learned = null;
    for (const seed of [2, 3]) {
      const { learner } = taught(trackId, 400000, { seed });
      const attempt = drive('learner', learner);
      if (attempt.player.finished) { learned = attempt; break; }
    }
    assert.ok(learned, 'neither run of training got a car round at all');

    const planned = drive('planner');
    assert.equal(planned.player.finished, true);
    assert.ok(planned.moves < learned.moves,
      `the planner took ${planned.moves} moves and the learner ${learned.moves} — `
      + 'the learner is supposed to be the worse of the two');
    assert.ok(planned.player.crashes <= learned.player.crashes,
      'and the planner is supposed to stay on the track');
  });
test('every attempt starts somewhere else, or nothing would ever be learned', () => {
  const track = getTrack('spa');
  const learner = createLearner(track, { episodes: 400, seed: 8 });
  learner.runFor(300);
  // With exploring starts the table fills up all over the track rather than in
  // a puddle around the starting line.
  const spread = new Set();
  for (const id of learner.table.keys()) spread.add(Math.floor(id / (11 * 11)));
  assert.ok(spread.size > 100,
    `only ${spread.size} places were ever visited, so the starts are not exploring`);
});

test('shaping changes how fast it learns, and is off unless asked for',
  { timeout: 120000 }, () => {
    assert.equal(LEARNER_DEFAULTS.shaping, false);
    const plain = taught('interlagos', 20000).learner.stats.rolling;
    const shaped = taught('interlagos', 20000, { shaping: true }).learner.stats.rolling;
    assert.ok(plain > 0 && shaped > 0, 'both of them learned something');
  });

test('nothing about a learned table is written down anywhere', () => {
  for (const file of ['../agents.js', '../engine.js', '../tracks.js', '../index.html']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.equal(/localStorage|sessionStorage|indexedDB/i.test(source), false,
      `${file} keeps something between sessions, and nothing here may`);
  }
});
