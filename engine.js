/**
 * The rules of Vector Rally.
 *
 * Every function here is pure: it reads its arguments and returns a new value.
 * Nothing in this file touches the DOM, and nothing calls Math.random — all
 * randomness goes through a seeded generator whose seed is part of the state,
 * so a race is fully described by its track, its seed and its move history.
 *
 * A car stands on a corner of the squared paper: its position is a pair of
 * whole numbers, a point where the lines cross, not a square. On its turn a
 * player changes each component of the velocity by -1, 0 or +1, and the car
 * travels in a straight line to position plus new velocity.
 *
 * The track is an area with a curved edge, so the question "did that move stay
 * on the track" is asked of the whole line, not of its far end. At speed 5 the
 * line is five units long and can cut the corner out of a bend and back in
 * again with both its ends still on the track. Testing only where the car
 * lands would miss exactly that.
 */

import { EPSILON, getTrack } from './tracks.js';

/** Bumped when the shape or the meaning of a saved state changes. */
export const SCHEMA = 2;

/** Neither velocity component may leave this range. */
export const MAX_SPEED = 5;

/** The nine moves, in reading order, which is also the order of the 3x3 pad. */
export const MOVES = Object.freeze([
  { ax: -1, ay: -1 }, { ax: 0, ay: -1 }, { ax: 1, ay: -1 },
  { ax: -1, ay: 0 }, { ax: 0, ay: 0 }, { ax: 1, ay: 0 },
  { ax: -1, ay: 1 }, { ax: 0, ay: 1 }, { ax: 1, ay: 1 },
].map(move => Object.freeze(move)));

/** Colour and shape both, because colour alone is no use to a colour-blind pupil. */
export const PLAYER_COLORS = Object.freeze(['#2f6f8f', '#a1503f', '#4a7a44', '#7a5b9b']);
export const PLAYER_SYMBOLS = Object.freeze(['circle', 'square', 'triangle', 'diamond']);

const MAX_PLAYERS = 4;

/**
 * mulberry32: small, fast, and identical in every browser, which is what we
 * need — the same seed has to replay the same race everywhere.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A whole number in 0..bound-1 from a mulberry32 stream. */
export function randomInt(random, bound) {
  return Math.floor(random() * bound);
}

// ---------------------------------------------------------------------------
// Geometry, as the rules need it
// ---------------------------------------------------------------------------

/** Is this point on the track? The edge itself counts as off. */
export function pointInside(track, point) {
  return track.contains(point[0], point[1]);
}

/**
 * Is the whole straight line from one point to the other on the track?
 *
 * Both ends being on the track is not enough, which is the entire reason this
 * function exists: a line can leave the area between its ends and come back.
 */
export function segmentInside(track, from, to) {
  if (!pointInside(track, from) || !pointInside(track, to)) return false;
  return track.hit(from, to) === null;
}

/**
 * The whole-number points along a move, in order, starting where the car is.
 * These are the only places a car can be put down, which matters when a move
 * ends off the track and the car has to be left at the last good one.
 */
export function latticePointsAlong(from, velocity) {
  const steps = gcd(Math.abs(velocity[0]), Math.abs(velocity[1]));
  const points = [{ point: [from[0], from[1]], t: 0 }];
  for (let step = 1; step <= steps; step++) {
    points.push({
      point: [from[0] + (velocity[0] * step) / steps, from[1] + (velocity[1] * step) / steps],
      t: step / steps,
    });
  }
  return points;
}

function gcd(a, b) {
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

/**
 * Where a move crosses the gates, in the order it crosses them.
 *
 * One move at speed 5 can pass two gates, and taking them out of order would
 * let a car collect the second checkpoint and skip the first — the same
 * mistake as jumping a wall, wearing a different hat.
 */
export function gateCrossings(track, from, to, limit = 1) {
  const found = [];
  for (const gate of track.gates) {
    const t = crossesGate(gate, from, to, limit);
    if (t !== null) found.push({ number: gate.number, t });
  }
  return found.sort((one, other) => one.t - other.t);
}

/**
 * How far along the move it passes this one gate the right way round, or null.
 * The planner in agents.js asks this of a single gate tens of thousands of
 * times a turn, which is why it is separate from the loop above.
 */
export function crossesGate(gate, from, to, limit = 1) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const gx = gate.b[0] - gate.a[0];
  const gy = gate.b[1] - gate.a[1];
  const denominator = dx * gy - dy * gx;
  if (Math.abs(denominator) <= EPSILON) return null;
  const t = ((gate.a[0] - from[0]) * gy - (gate.a[1] - from[1]) * gx) / denominator;
  const u = ((gate.a[0] - from[0]) * dy - (gate.a[1] - from[1]) * dx) / denominator;
  if (t <= EPSILON || t > limit + EPSILON) return null;
  if (u < -EPSILON || u > 1 + EPSILON) return null;
  // Only the way the gate faces counts, which is what stops a car rolling back
  // and forth over the line collecting laps.
  if (dx * gate.dir[0] + dy * gate.dir[1] <= 0) return null;
  return t;
}

// ---------------------------------------------------------------------------
// Starting a race
// ---------------------------------------------------------------------------

/**
 * A fresh race. Every car starts on the finish line and a race is one lap.
 * The seed has to be supplied by the caller: the engine never invents
 * randomness of its own, because a race must be reproducible from its state.
 */
export function createInitialState({ trackId, players, laps = 1, seed, appVersion } = {}) {
  const track = getTrack(trackId);
  if (!Array.isArray(players) || players.length < 1 || players.length > MAX_PLAYERS) {
    throw new Error(`A race needs 1 to ${MAX_PLAYERS} players`);
  }
  if (players.length > track.starts.length) {
    throw new Error(`Track ${track.id} has ${track.starts.length} places on the line, `
      + `not enough for ${players.length} cars`);
  }
  if (!Number.isInteger(laps) || laps < 1 || laps > 10) {
    throw new Error('laps must be a whole number from 1 to 10');
  }
  if (!Number.isInteger(seed)) {
    throw new Error('seed must be a whole number: every race is reproducible from its seed');
  }

  const places = spreadAcross(track.starts, players.length);
  return {
    schema: SCHEMA,
    appVersion: appVersion ?? currentAppVersion(),
    trackId: track.id,
    laps,
    seed,
    turn: 0,
    active: 0,
    status: 'racing',
    players: players.map((player, index) => ({
      id: index,
      name: nonEmpty(player.name) ? player.name : `P${index + 1}`,
      kind: nonEmpty(player.kind) ? player.kind : 'human',
      color: nonEmpty(player.color) ? player.color : PLAYER_COLORS[index],
      symbol: nonEmpty(player.symbol) ? player.symbol : PLAYER_SYMBOLS[index],
      pos: [...places[index]],
      vel: [0, 0],
      trace: [],
      checkpoints: [],
      lap: 0,
      finished: false,
      finishTurn: null,
      crashes: 0,
    })),
    history: [],
  };
}

/** Spreads the cars evenly across the places on the line. */
function spreadAcross(places, count) {
  if (count === 1) return [places[Math.floor(places.length / 2)]];
  return Array.from({ length: count }, (unused, index) =>
    places[Math.round((index * (places.length - 1)) / (count - 1))]);
}

// ---------------------------------------------------------------------------
// Taking a turn
// ---------------------------------------------------------------------------

/** True once nobody is driving any more, whether the lap ran out or was stopped. */
export function isFinished(state) {
  return state.status !== 'racing';
}

/** The player whose turn it is, or null once the race is over. */
export function activePlayer(state) {
  return isFinished(state) ? null : state.players[state.active];
}

/**
 * The moves the active player may choose from — never more than nine, and
 * sometimes none at all.
 *
 * A move is unavailable only when it cannot happen at all: over the speed
 * limit, or straight through another car. Driving off the track is *not*
 * unavailable. It is allowed, and it costs the player the turn — which is the
 * whole reason there is anything to work out.
 */
export function legalMoves(state) {
  if (isFinished(state)) return [];
  return MOVES.filter(move => !preview(state, move).blocking);
}

/** What would happen if the active player made this move. */
export function previewMove(state, move) {
  if (isFinished(state)) throw new Error('The race is over');
  return preview(state, normalizeMove(move));
}

function preview(state, move) {
  const track = getTrack(state.trackId);
  const player = state.players[state.active];
  const velocity = [player.vel[0] + move.ax, player.vel[1] + move.ay];
  const blocked = (reason, extra = {}) => ({
    move,
    velocity,
    target: null,
    landing: [...player.pos],
    reason,
    blocking: true,
    crashes: false,
    hit: null,
    gates: [],
    ...extra,
  });

  if (Math.abs(velocity[0]) > MAX_SPEED || Math.abs(velocity[1]) > MAX_SPEED) {
    return blocked('speed limit');
  }

  const from = player.pos;
  const target = [from[0] + velocity[0], from[1] + velocity[1]];

  // Cars are points, and two of them may not share one. Because every position
  // is a whole number this is exact arithmetic — no rounding decides it.
  for (const other of state.players) {
    if (other.id === player.id || other.finished) continue;
    if (onSegment(from, target, other.pos)) return blocked('car', { target });
  }

  const hit = track.hit(from, target);
  const limit = hit === null ? 1 : hit.t;
  const gates = gateCrossings(track, from, target, limit);

  if (hit === null) {
    return {
      move, velocity, target, landing: [...target],
      reason: null, blocking: false, crashes: false, hit: null, gates,
    };
  }

  // Off the track. The car is left on the last whole-number point it reached
  // before the edge, backing up past any point another car is standing on. Its
  // own point always qualifies, so this always finds somewhere.
  const taken = new Set(state.players
    .filter(other => other.id !== player.id && !other.finished)
    .map(other => `${other.pos[0]},${other.pos[1]}`));
  let landing = [...from];
  for (const step of latticePointsAlong(from, velocity)) {
    if (step.t >= hit.t - EPSILON) break;
    if (!pointInside(track, step.point)) continue;
    if (taken.has(`${step.point[0]},${step.point[1]}`)) continue;
    landing = step.point;
  }

  return {
    move, velocity, target, landing,
    reason: 'off track', blocking: false, crashes: true, hit, gates,
  };
}

/** Does this point lie exactly on the line from one end to the other? */
function onSegment(from, to, point) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx * (point[1] - from[1]) - dy * (point[0] - from[0]) !== 0) return false;
  return point[0] >= Math.min(from[0], to[0]) && point[0] <= Math.max(from[0], to[0])
    && point[1] >= Math.min(from[1], to[1]) && point[1] <= Math.max(from[1], to[1]);
}

/**
 * Applies a move and returns the new state. The state passed in is never
 * modified.
 *
 * Use legalMoves to decide what to offer a player; use this to carry a move
 * out. A move that cannot exist at all is refused here too.
 */
export function applyMove(state, move) {
  if (isFinished(state)) throw new Error('The race is over');
  const chosen = normalizeMove(move);
  const track = getTrack(state.trackId);
  const player = state.players[state.active];
  const outcome = preview(state, chosen);

  // Boxed in with nowhere legal to go: the car crashes where it stands,
  // whichever move was asked for — there is no move left that could be asked
  // for instead. It cannot lock the race up either: at velocity (0, 0) the
  // move (0, 0) keeps the car on its own point, whose line is empty and which
  // no other car can be standing on.
  const trapped = legalMoves(state).length === 0;

  if (!trapped) {
    if (outcome.reason === 'speed limit') {
      throw new Error(`That move would break the speed limit of ${MAX_SPEED}`);
    }
    if (outcome.reason === 'car') {
      throw new Error('Another car is standing in the way of that move');
    }
  }

  let checkpoints = player.checkpoints;
  let lap = player.lap;
  let finished = false;
  if (!trapped) {
    for (const gate of outcome.gates) {
      if (gate.number === checkpoints.length + 1) {
        checkpoints = [...checkpoints, gate.number];
      } else if (gate.number === 0 && checkpoints.length === track.checkpointCount && !finished) {
        lap += 1;
        checkpoints = [];
        if (lap >= state.laps) finished = true;
      }
    }
  }

  const crashed = trapped || outcome.crashes;
  const updated = {
    ...player,
    pos: trapped ? [...player.pos] : [...outcome.landing],
    vel: crashed ? [0, 0] : outcome.velocity,
    trace: [...player.trace, [...player.pos]],
    checkpoints,
    lap,
    finished,
    finishTurn: finished ? state.turn : null,
    crashes: crashed ? player.crashes + 1 : player.crashes,
  };

  const players = state.players.map(other => (other.id === updated.id ? updated : other));
  const next = nextPlayer(state, players);

  return {
    ...state,
    turn: next.turn,
    active: next.active,
    status: next.status,
    players,
    history: [...state.history, { player: player.id, ax: chosen.ax, ay: chosen.ay }],
  };
}

/** Ends the race early. A lesson is forty minutes long. */
export function endRace(state) {
  if (isFinished(state)) return state;
  return { ...state, status: 'ended' };
}

/** The state this race started from, rebuilt from the state's own description. */
export function initialStateOf(state) {
  return createInitialState({
    trackId: state.trackId,
    laps: state.laps,
    seed: state.seed,
    appVersion: state.appVersion,
    players: state.players.map(player => ({
      name: player.name,
      kind: player.kind,
      color: player.color,
      symbol: player.symbol,
    })),
  });
}

/**
 * Replays a list of moves from the start of the race. Because every rule is a
 * pure function of the state, this reproduces the race exactly — which is also
 * what makes undo a two-line affair.
 */
export function replayHistory(state, history = state.history) {
  let replayed = initialStateOf(state);
  for (const entry of history) replayed = applyMove(replayed, entry);
  return replayed;
}

/** The race as it was one move ago. */
export function undoMove(state) {
  if (state.history.length === 0) return state;
  return replayHistory(state, state.history.slice(0, -1));
}

/** The gate this player is looking for next: a checkpoint, or the finish line. */
export function nextGate(state, player) {
  const track = getTrack(state.trackId);
  const number = player.checkpoints.length + 1;
  return track.gates[number > track.checkpointCount ? 0 : number];
}

/** Players in race order: whoever is home first, then whoever has come furthest. */
export function standings(state) {
  const track = getTrack(state.trackId);
  return [...state.players].sort((a, b) => {
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    if (a.finished && b.finished) return a.finishTurn - b.finishTurn || a.id - b.id;
    return b.lap - a.lap
      || b.checkpoints.length - a.checkpoints.length
      || a.crashes - b.crashes
      || a.id - b.id;
  }).map((player, place) => ({ place: place + 1, player, of: track.checkpointCount }));
}

// ---------------------------------------------------------------------------
// Saving and loading
// ---------------------------------------------------------------------------

/** The state as text, for the debug panel. */
export function stateToJSON(state) {
  return JSON.stringify(state, null, 2);
}

/**
 * Reads a state back from text, checking enough of it that a broken paste
 * fails here rather than three moves later.
 */
export function stateFromJSON(text) {
  const state = typeof text === 'string' ? JSON.parse(text) : text;
  if (!state || typeof state !== 'object') throw new Error('Not a state object');
  if (state.schema !== SCHEMA) {
    throw new Error(`Unsupported state schema ${state.schema}, expected ${SCHEMA}`);
  }
  getTrack(state.trackId);
  if (!Number.isInteger(state.seed)) throw new Error('State has no seed');
  if (!Number.isInteger(state.laps)) throw new Error('State has no lap count');
  if (!['racing', 'finished', 'ended'].includes(state.status)) {
    throw new Error(`Unknown status ${JSON.stringify(state.status)}`);
  }
  if (!Array.isArray(state.players) || state.players.length === 0) {
    throw new Error('State has no players');
  }
  state.players.forEach((player, index) => {
    if (!isPoint(player.pos) || !isPoint(player.vel)) {
      throw new Error(`Player ${index} has no position or velocity`);
    }
    if (!Array.isArray(player.trace) || !Array.isArray(player.checkpoints)) {
      throw new Error(`Player ${index} has no trace or checkpoint list`);
    }
  });
  if (!Array.isArray(state.history)) throw new Error('State has no history');
  return state;
}

function nextPlayer(state, players) {
  const count = players.length;
  for (let step = 1; step <= count; step++) {
    const index = (state.active + step) % count;
    if (players[index].finished) continue;
    return {
      active: index,
      turn: state.turn + (state.active + step >= count ? 1 : 0),
      status: 'racing',
    };
  }
  return { active: state.active, turn: state.turn, status: 'finished' };
}

function normalizeMove(move) {
  if (!move || typeof move !== 'object') throw new TypeError('A move is { ax, ay }');
  const { ax, ay } = move;
  for (const component of [ax, ay]) {
    if (component !== -1 && component !== 0 && component !== 1) {
      throw new RangeError(`A move changes each velocity component by -1, 0 or 1, got ${component}`);
    }
  }
  return { ax, ay };
}

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isInteger);
}

function nonEmpty(value) {
  return typeof value === 'string' && value !== '';
}

function currentAppVersion() {
  return typeof globalThis !== 'undefined' && typeof globalThis.APP_VERSION === 'string'
    ? globalThis.APP_VERSION
    : null;
}
