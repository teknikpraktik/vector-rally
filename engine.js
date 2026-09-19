/**
 * The rules of Vector Rally.
 *
 * Every function here is pure: it reads its arguments and returns a new value.
 * Nothing in this file touches the DOM, and nothing calls Math.random — all
 * randomness goes through a seeded generator whose seed is part of the state,
 * so a race is fully described by its track, its seed and its move history.
 *
 * A car has a position and a velocity, both in whole grid cells. On its turn a
 * player changes each component of the velocity by -1, 0 or +1, and the car
 * moves by the new velocity. Everything the car passes over on the way there
 * counts: walls, other cars, checkpoints and the finish line.
 */

import { getTrack } from './tracks.js';

/** Bumped only if the shape of a saved state changes. */
export const SCHEMA = 1;

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

/**
 * The ordered list of cells a car passes through on its way from one cell to
 * another, both ends included.
 *
 * Two neighbouring cells in the list differ by exactly 1 in exactly one
 * coordinate: the path is 4-connected. That is the whole point. An ordinary
 * Bresenham line takes diagonal steps, and a diagonal step slips between two
 * wall cells that touch only at their corners without entering either of them,
 * so a one-cell-thick diagonal wall leaks. A 4-connected path cannot cross a
 * line of cells without standing on one of them.
 */
export function pathCells(from, to) {
  const [x0, y0] = requireCell(from, 'from');
  const [x1, y1] = requireCell(to, 'to');
  const stepX = Math.sign(x1 - x0);
  const stepY = Math.sign(y1 - y0);
  const spanX = Math.abs(x1 - x0);
  const spanY = Math.abs(y1 - y0);

  const cells = [[x0, y0]];
  let x = x0;
  let y = y0;
  let takenX = 0;
  let takenY = 0;
  while (takenX < spanX || takenY < spanY) {
    // Whichever axis is furthest behind where the true line is goes next.
    const stepAlongX = takenY >= spanY
      || (takenX < spanX && (1 + 2 * takenX) * spanY < (1 + 2 * takenY) * spanX);
    if (stepAlongX) {
      x += stepX;
      takenX += 1;
    } else {
      y += stepY;
      takenY += 1;
    }
    cells.push([x, y]);
  }
  return cells;
}

/**
 * A fresh race. The seed has to be supplied by the caller: the engine never
 * invents randomness of its own, because a race must be reproducible from its
 * state alone.
 */
export function createInitialState({ trackId, players, laps = 3, seed, appVersion } = {}) {
  const track = getTrack(trackId);
  if (!Array.isArray(players) || players.length < 1 || players.length > MAX_PLAYERS) {
    throw new Error(`A race needs 1 to ${MAX_PLAYERS} players`);
  }
  if (players.length > track.starts.length) {
    throw new Error(`Track ${track.id} has ${track.starts.length} starting cells, `
      + `not enough for ${players.length} players`);
  }
  if (!Number.isInteger(laps) || laps < 1 || laps > 10) {
    throw new Error('laps must be a whole number from 1 to 10');
  }
  if (!Number.isInteger(seed)) {
    throw new Error('seed must be a whole number: every race is reproducible from its seed');
  }

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
      pos: [...track.starts[index]],
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

/** True once nobody is driving any more, whether the race ran out or was stopped. */
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
 * A move is unavailable if it would break the speed limit, or if another car
 * stands anywhere along the line the car would travel. Driving into a wall is
 * *not* unavailable: it is allowed, and it costs the player the turn.
 */
export function legalMoves(state) {
  if (isFinished(state)) return [];
  return MOVES.filter(move => !preview(state, move).blocking);
}

/**
 * What would happen if the active player made this move. The UI draws its
 * preview from this, and the agents in agents.js choose with it.
 */
export function previewMove(state, move) {
  if (isFinished(state)) throw new Error('The race is over');
  return preview(state, normalizeMove(move));
}

function preview(state, move) {
  const track = getTrack(state.trackId);
  const player = state.players[state.active];
  const velocity = [player.vel[0] + move.ax, player.vel[1] + move.ay];

  if (Math.abs(velocity[0]) > MAX_SPEED || Math.abs(velocity[1]) > MAX_SPEED) {
    return {
      move, velocity, target: null, cells: [], reachedIndex: -1,
      landing: [...player.pos], reason: 'speed limit', blocking: true, crashes: true,
    };
  }

  const target = [player.pos[0] + velocity[0], player.pos[1] + velocity[1]];
  const cells = pathCells(player.pos, target);
  const taken = takenCells(state, track, player.id);

  let stoppedAt = null;
  let reason = null;
  for (let index = 1; index < cells.length; index++) {
    const [x, y] = cells[index];
    if (!track.isDrivable(x, y)) {
      stoppedAt = index;
      reason = track.isWall(x, y) ? 'wall' : 'off track';
      break;
    }
    if (taken.has(key(x, y))) {
      stoppedAt = index;
      reason = 'car';
      break;
    }
  }

  if (stoppedAt === null) {
    return {
      move, velocity, target, cells, reachedIndex: cells.length - 1,
      landing: [...target], reason: null, blocking: false, crashes: false,
    };
  }

  // The car stops before whatever blocked it, backing up along its own path
  // past any cell it cannot stand on. Its own cell always qualifies, so this
  // search always finds somewhere to put the car.
  let landingIndex = stoppedAt;
  while (landingIndex > 0) {
    const [x, y] = cells[landingIndex];
    if (track.isDrivable(x, y) && !taken.has(key(x, y))) break;
    landingIndex -= 1;
  }

  return {
    move,
    velocity,
    target,
    cells,
    reachedIndex: stoppedAt - 1,
    landing: [...cells[landingIndex]],
    reason,
    blocking: reason === 'car',
    crashes: true,
  };
}

/**
 * Applies a move and returns the new state. The state passed in is never
 * modified.
 *
 * The move is resolved by physics rather than by permission: a car that runs
 * into a wall, off the track or into another car stops where it can, loses its
 * speed and ends its turn. Only a move that cannot exist at all — one that
 * breaks the speed limit — is refused outright. Use legalMoves to decide what
 * to offer a player; use this to carry a move out.
 */
export function applyMove(state, move) {
  if (isFinished(state)) throw new Error('The race is over');
  const chosen = normalizeMove(move);
  const track = getTrack(state.trackId);
  const player = state.players[state.active];
  const outcome = preview(state, chosen);

  if (outcome.reason === 'speed limit') {
    throw new Error(`That move would break the speed limit of ${MAX_SPEED}`);
  }

  // Boxed in with nowhere legal to go: the car crashes where it stands. The
  // consequence is the same as driving off the track, and it cannot lock the
  // race up — at velocity (0, 0) the move (0, 0) keeps the car on its own
  // cell, whose path is empty and which no other car can be standing on.
  const trapped = legalMoves(state).length === 0;

  // Everything the car drove over, in the order it drove over it.
  let checkpoints = player.checkpoints;
  let lap = player.lap;
  let finished = false;
  const reachedIndex = trapped ? 0 : outcome.reachedIndex;
  for (let index = 1; index <= reachedIndex; index++) {
    const [x, y] = outcome.cells[index];
    const checkpoint = track.checkpointAt(x, y);
    if (checkpoint !== 0 && checkpoint === checkpoints.length + 1) {
      checkpoints = [...checkpoints, checkpoint];
    }
    const crossing = track.isFinish(x, y)
      && dot(outcome.velocity, track.finishDir) > 0
      && checkpoints.length === track.checkpointCount;
    if (crossing && !finished) {
      lap += 1;
      checkpoints = [];
      if (lap >= state.laps) finished = true;
    }
  }

  const crashed = trapped || outcome.reason !== null;
  const landing = trapped ? [...player.pos] : outcome.landing;
  const updated = {
    ...player,
    pos: crashed ? landing : [...outcome.target],
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

/** The checkpoint this player is looking for, or null when the finish line is next. */
export function nextCheckpoint(state, player) {
  const track = getTrack(state.trackId);
  const next = player.checkpoints.length + 1;
  return next > track.checkpointCount ? null : next;
}

/** The cells a player is heading for: the next checkpoint, or the finish line. */
export function targetCells(state, player) {
  const track = getTrack(state.trackId);
  const next = nextCheckpoint(state, player);
  return next === null ? track.finishCells : track.checkpointCells.get(next);
}

/** Players in race order: finishers first, then whoever has come furthest. */
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
    if (!isCell(player.pos) || !isCell(player.vel)) {
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

/** The cells other cars are standing on. Cars that have finished are gone. */
function takenCells(state, track, exceptId) {
  const taken = new Map();
  for (const player of state.players) {
    if (player.id === exceptId || player.finished) continue;
    taken.set(key(player.pos[0], player.pos[1]), player.id);
  }
  return taken;
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

function requireCell(cell, what) {
  if (!isCell(cell)) throw new TypeError(`${what} must be [x, y] with whole numbers`);
  return cell;
}

function isCell(cell) {
  return Array.isArray(cell) && cell.length === 2 && cell.every(Number.isInteger);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function key(x, y) {
  return `${x},${y}`;
}

function nonEmpty(value) {
  return typeof value === 'string' && value !== '';
}

function currentAppVersion() {
  return typeof globalThis !== 'undefined' && typeof globalThis.APP_VERSION === 'string'
    ? globalThis.APP_VERSION
    : null;
}
