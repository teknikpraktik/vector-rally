/**
 * Two computer drivers, and they are not easy and hard. They are two different
 * ideas about how to drive, and the difference is meant to be visible from the
 * back of the classroom.
 *
 * Greedy looks one move ahead and takes whichever of the nine gets it nearest
 * the next gate while carrying the most speed. It measures that distance in a
 * straight line, so it knows nothing about the shape of the track: it
 * accelerates towards a corner it cannot see and arrives with nowhere to go.
 *
 * Planner searches. A* over the states a car can be in — where it is and how
 * fast it is going — at one move per step, so it finds the fewest moves to the
 * gate after next and brakes for a corner before reaching it, because the
 * search has already been round it.
 *
 * Both of them steer by checkpoints the players cannot see.
 *
 * Neither uses Math.random: where two moves score the same, the tie is broken
 * by a generator seeded from the race.
 */

import {
  MAX_SPEED, MOVES, crossesGate, legalMoves, mulberry32, previewMove, segmentInside,
} from './engine.js';
import { getTrack } from './tracks.js';

/** How many states the planner may look at for one move before giving up. */
export const PLANNER_BUDGET = 50000;

/** What Greedy is willing to trade: one unit of speed against this much distance. */
const SPEED_WEIGHT = 1.35;

/** Greedy can see one move ahead, so it does avoid driving straight off — if it can. */
const CRASH_PENALTY = 30;

export const KINDS = Object.freeze(['human', 'greedy', 'planner']);

export const AGENT_NAMES = Object.freeze({
  greedy: 'Greedy',
  planner: 'Planner',
});

export function isAgent(kind) {
  return kind === 'greedy' || kind === 'planner';
}

/**
 * The move this player's driver would make, with what it cost to work out.
 * Returns { move, stats } where stats is what the interface puts on the screen:
 * how many states were looked at, and whether the planner had to give up.
 */
export function chooseMove(state, budget = PLANNER_BUDGET) {
  const player = state.players[state.active];
  if (player.kind === 'planner') {
    const planned = planner(state, budget);
    if (planned) return planned;
    const fallback = greedy(state);
    return {
      move: fallback.move,
      stats: { ...fallback.stats, kind: 'planner', fellBack: true, budget },
    };
  }
  return greedy(state);
}

// ---------------------------------------------------------------------------
// Greedy
// ---------------------------------------------------------------------------

function greedy(state) {
  const started = now();
  const track = getTrack(state.trackId);
  const player = state.players[state.active];
  const gate = gateAhead(track, player, 0);
  const moves = legalMoves(state);
  if (moves.length === 0) {
    return { move: { ax: 0, ay: 0 }, stats: finish('greedy', 0, started, { boxedIn: true }) };
  }

  const random = mulberry32(state.seed + state.history.length);
  let best = moves[0];
  let bestScore = -Infinity;
  for (const move of moves) {
    const outcome = previewMove(state, move);
    const landing = outcome.reason ? outcome.landing : outcome.target;
    // Straight-line distance, which is exactly what makes it greedy: the track
    // could bend anywhere between here and there and this would not notice.
    const away = distanceToGate(gate, landing);
    const speed = Math.hypot(outcome.velocity[0], outcome.velocity[1]);
    const score = -away + SPEED_WEIGHT * speed
      - (outcome.reason ? CRASH_PENALTY : 0)
      + random() * 1e-6;
    if (score > bestScore) { bestScore = score; best = move; }
  }
  return { move: best, stats: finish('greedy', moves.length, started, {}) };
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * A* over (x, y, vx, vy), nine successors per state, one move each.
 *
 * It plans to the gate *after* the next one rather than to the next one. A car
 * that only plans as far as the next gate arrives at it flat out and drives
 * off immediately afterwards, having met its goal exactly and thought no
 * further. Only the first move of the plan is taken; the rest is thrown away
 * and worked out again next turn, because the other cars will have moved.
 */
function planner(state, budget) {
  const started = now();
  const track = getTrack(state.trackId);
  const player = state.players[state.active];
  const first = gateAhead(track, player, 0);
  const target = gateAhead(track, player, 1);
  const blockers = state.players
    .filter(other => other.id !== player.id && !other.finished)
    .map(other => other.pos);

  const span = 2 * MAX_SPEED + 1;
  const originX = Math.floor(track.bounds.minX) - 2;
  const originY = Math.floor(track.bounds.minY) - 2;
  const width = Math.ceil(track.bounds.maxX - originX) + 4;
  const key = (x, y, vx, vy) =>
    (((y - originY) * width + (x - originX)) * span + vx + MAX_SPEED) * span + vy + MAX_SPEED;

  const start = {
    x: player.pos[0], y: player.pos[1], vx: player.vel[0], vy: player.vel[1],
    passed: false, cost: 0, first: null,
  };
  const open = new Heap();
  open.push(start, guess(target, start.x, start.y));
  const seen = new Map([[key(start.x, start.y, start.vx, start.vy) * 2, 0]]);
  let expanded = 0;

  while (open.size > 0) {
    const here = open.pop();
    expanded += 1;
    if (expanded > budget) {
      return null;
    }

    for (const move of MOVES) {
      const vx = here.vx + move.ax;
      const vy = here.vy + move.ay;
      if (Math.abs(vx) > MAX_SPEED || Math.abs(vy) > MAX_SPEED) continue;
      const to = [here.x + vx, here.y + vy];
      const from = [here.x, here.y];
      if (!segmentInside(track, from, to)) continue;
      if (blockers.some(point => onLine(from, to, point))) continue;

      // The gates have to be taken in order, so the one after next only counts
      // once the next one has been passed.
      const passed = here.passed || crossesGate(first, from, to) !== null;
      if (passed && crossesGate(target, from, to) !== null) {
        return {
          move: here.first || move,
          stats: finish('planner', expanded, started, { depth: here.cost + 1 }),
        };
      }

      const id = key(to[0], to[1], vx, vy) * 2 + (passed ? 1 : 0);
      const cost = here.cost + 1;
      if (seen.has(id) && seen.get(id) <= cost) continue;
      seen.set(id, cost);
      open.push(
        { x: to[0], y: to[1], vx, vy, passed, cost, first: here.first || move },
        cost + guess(passed ? target : first, to[0], to[1]),
      );
    }
  }
  return null;
}

/**
 * How few moves could possibly still be needed: the furthest a car can move
 * along either axis in one go is five, so the larger of the two distances,
 * divided by five, can never overestimate. An honest under-estimate is what
 * makes A* find the shortest way rather than merely a way.
 */
function guess(gate, x, y) {
  let nearest = Infinity;
  for (const point of gate.samples) {
    const away = Math.max(Math.abs(point[0] - x), Math.abs(point[1] - y));
    if (away < nearest) nearest = away;
  }
  // The gate is sampled rather than solved, so give back half a step of slack
  // to be sure the estimate stays below the truth.
  return Math.ceil(Math.max(0, nearest - 0.5) / MAX_SPEED);
}

function distanceToGate(gate, point) {
  let nearest = Infinity;
  for (const sample of gate.samples) {
    const away = Math.hypot(sample[0] - point[0], sample[1] - point[1]);
    if (away < nearest) nearest = away;
  }
  return nearest;
}

/** The next gate this car is looking for, or the one a given number after it. */
function gateAhead(track, player, skip) {
  const order = [...Array.from({ length: track.checkpointCount }, (unused, i) => i + 1), 0];
  const at = Math.min(player.checkpoints.length, order.length - 1);
  return withSamples(track, track.gates[order[(at + skip) % order.length]]);
}

const sampled = new WeakMap();

/** Points along a gate, so distance to it can be measured without solving for it. */
function withSamples(track, gate) {
  if (!sampled.has(gate)) {
    const steps = Math.max(6, Math.ceil(Math.hypot(gate.b[0] - gate.a[0], gate.b[1] - gate.a[1]) * 2));
    const points = [];
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      points.push([
        gate.a[0] + (gate.b[0] - gate.a[0]) * t,
        gate.a[1] + (gate.b[1] - gate.a[1]) * t,
      ]);
    }
    sampled.set(gate, points);
  }
  return { ...gate, samples: sampled.get(gate) };
}

function onLine(from, to, point) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (dx * (point[1] - from[1]) - dy * (point[0] - from[0]) !== 0) return false;
  return point[0] >= Math.min(from[0], to[0]) && point[0] <= Math.max(from[0], to[0])
    && point[1] >= Math.min(from[1], to[1]) && point[1] <= Math.max(from[1], to[1]);
}

// ---------------------------------------------------------------------------
// A small binary heap, so A* pops the most promising state and not merely one
// ---------------------------------------------------------------------------

class Heap {
  constructor() {
    this.items = [];
    this.keys = [];
  }

  get size() {
    return this.items.length;
  }

  push(item, key) {
    this.items.push(item);
    this.keys.push(key);
    let at = this.items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.keys[parent] <= this.keys[at]) break;
      this.swap(at, parent);
      at = parent;
    }
  }

  pop() {
    const top = this.items[0];
    const item = this.items.pop();
    const key = this.keys.pop();
    if (this.items.length > 0) {
      this.items[0] = item;
      this.keys[0] = key;
      let at = 0;
      for (;;) {
        const left = at * 2 + 1;
        const right = left + 1;
        let smallest = at;
        if (left < this.keys.length && this.keys[left] < this.keys[smallest]) smallest = left;
        if (right < this.keys.length && this.keys[right] < this.keys[smallest]) smallest = right;
        if (smallest === at) break;
        this.swap(at, smallest);
        at = smallest;
      }
    }
    return top;
  }

  swap(one, other) {
    [this.items[one], this.items[other]] = [this.items[other], this.items[one]];
    [this.keys[one], this.keys[other]] = [this.keys[other], this.keys[one]];
  }
}

function now() {
  return typeof performance === 'object' && performance.now ? performance.now() : Date.now();
}

function finish(kind, expanded, started, extra) {
  const spent = Math.max(0.001, now() - started);
  return {
    kind,
    expanded,
    ms: Math.round(spent * 10) / 10,
    perSecond: Math.round(expanded / (spent / 1000)),
    fellBack: false,
    ...extra,
  };
}
