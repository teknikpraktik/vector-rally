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
  MAX_SPEED, MOVES, crossesGate, latticePointsAlong, legalMoves, mulberry32,
  previewMove, segmentInside,
} from './engine.js';
import { getTrack } from './tracks.js';

/** How many states the planner may look at for one move before giving up. */
export const PLANNER_BUDGET = 50000;

/** What Greedy is willing to trade: one unit of speed against this much distance. */
const SPEED_WEIGHT = 1.35;

/** Greedy can see one move ahead, so it does avoid driving straight off — if it can. */
const CRASH_PENALTY = 30;

export const KINDS = Object.freeze(['human', 'greedy', 'planner', 'learner']);

export const AGENT_NAMES = Object.freeze({
  greedy: 'Greedy',
  planner: 'Planner',
  learner: 'Learner',
});

export function isAgent(kind) {
  return kind === 'greedy' || kind === 'planner' || kind === 'learner';
}

/**
 * The move this player's driver would make, with what it cost to work out.
 * Returns { move, stats } where stats is what the interface puts on the screen:
 * how many states were looked at, and whether the planner had to give up.
 */
export function chooseMove(state, budget = PLANNER_BUDGET, learned = null) {
  const player = state.players[state.active];
  if (player.kind === 'learner') return learnerMove(state, learned);
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

// ---------------------------------------------------------------------------
// Learner: tabular Q-learning, trained in the page
// ---------------------------------------------------------------------------

/**
 * The third driver learns instead of searching. It keeps a value for every
 * (point, velocity) it has been in and every one of the nine moves, and nudges
 * those values towards what actually happened. Nothing is written down between
 * sessions: the curve is the demonstration, and a table that already existed
 * when the lesson began would take the demonstration away.
 *
 * What it learns is "reach the finish line the right way round from wherever
 * you are". The checkpoints are deliberately not part of the state — the state
 * is a point and a velocity and nothing else — so the table cannot represent
 * which checkpoint is next. Going round the track the right way is the only
 * route to the line that counts, so the checkpoints come along on the way.
 *
 * Expect it to lose to the Planner. The track is fixed and fully visible, so a
 * search works out exactly what learning can only approximate. That a driver
 * which has had tens of thousands of attempts loses to one that simply
 * calculates is a more useful thing to know than the other way round.
 */

export const LEARNER_DEFAULTS = Object.freeze({
  alpha: 0.2,
  // The step size falls away as it goes: a rate that stays high keeps
  // knocking a nearly-settled table about, and the car drives differently
  // every time you train it.
  alphaTo: 0.02,
  gamma: 0.95,
  epsilonFrom: 1,
  epsilonTo: 0.05,
  episodes: 150000,
  episodeCap: 1500,
  shaping: false,
});

/** Leaving the track costs this much on top of the move itself. */
const OFF_TRACK_COST = 25;

/**
 * How a (point, velocity) is turned into one number. It lives here on its
 * own because a table trained in a worker has to be read back on the other
 * side, and both sides have to number the states the same way.
 */
export function stateKeyFor(track) {
  const originX = Math.floor(track.bounds.minX) - 2;
  const originY = Math.floor(track.bounds.minY) - 2;
  const width = Math.ceil(track.bounds.maxX - originX) + 4;
  return (x, y, vx, vy) =>
    (((y - originY) * width + (x - originX)) * 11 + vx + MAX_SPEED) * 11 + vy + MAX_SPEED;
}

/** A trained table, flattened so it can be handed between threads. */
export function packTable(learned) {
  const keys = new Int32Array(learned.table.size);
  const q = new Float32Array(learned.table.size * 9);
  const tried = new Uint8Array(learned.table.size * 9);
  let at = 0;
  for (const [id, row] of learned.table) {
    keys[at] = id;
    q.set(row.q, at * 9);
    tried.set(row.tried, at * 9);
    at += 1;
  }
  return { keys, q, tried };
}

/** And back again, on the side that will do the driving. */
export function unpackTable(track, packed) {
  const table = new Map();
  for (let at = 0; at < packed.keys.length; at++) {
    table.set(packed.keys[at], {
      q: packed.q.subarray(at * 9, at * 9 + 9),
      tried: packed.tried.subarray(at * 9, at * 9 + 9),
    });
  }
  return { table, key: stateKeyFor(track) };
}

/**
 * The chart: moves per episode against episodes, smoothed over a window,
 * thinned down to something that can be drawn and sent between threads.
 */
export function learningCurve(lengths, points = 240, window = 50) {
  if (lengths.length === 0) return [];
  const every = Math.max(1, Math.floor(lengths.length / points));
  const curve = [];
  for (let at = every; at <= lengths.length; at += every) {
    const from = Math.max(0, at - window);
    let total = 0;
    for (let index = from; index < at; index++) total += lengths[index];
    curve.push([at, Math.round((total / (at - from)) * 10) / 10]);
  }
  return curve;
}

export function createLearner(track, options = {}) {
  const settings = { ...LEARNER_DEFAULTS, ...options };
  const random = mulberry32(settings.seed ?? 20260920);
  const table = new Map();

  const key = stateKeyFor(track);

  // Everywhere a car could be put down, for the exploring starts. Without them
  // a random walker would never reach the line from the grid on a track this
  // long, and the curve would be a flat line along the top of the chart.
  const places = [];
  for (let y = Math.floor(track.bounds.minY); y <= Math.ceil(track.bounds.maxY); y++) {
    for (let x = Math.floor(track.bounds.minX); x <= Math.ceil(track.bounds.maxX); x++) {
      if (track.contains(x, y)) places.push([x, y]);
    }
  }

  // How much of the lap is left, for the optional shaping.
  const remaining = new Map();
  if (settings.shaping) {
    const finishAt = distanceAlong(track, track.gates[0].at);
    for (const place of places) {
      remaining.set(place.join(),
        ((finishAt - distanceAlong(track, place)) + track.length) % track.length);
    }
  }

  // An episode ends at the next gate, not at the finish line a whole lap
  // away. With a discount of 0.95 anything more than about twenty moves off
  // is worth almost exactly as much as anything else, so a lap-long goal
  // leaves the table flat and the car sits still rather than driving: every
  // move looks as good as every other. Gates are a few moves apart, well
  // inside that horizon, and a policy that always drives to the next gate
  // goes round the track — which is the same thing, learned in pieces.
  const gates = track.gates;
  const lengths = [];
  let episodes = 0;
  let crashes = 0;
  let arrivals = 0;
  let wrongWay = 0;
  let spent = 0;

  // Every value starts at zero, which is better than anything the car can
  // actually score, so an untried move always looks the most promising. That
  // is what makes it explore. It also means the table has to remember which
  // moves it has actually tried, or when the racing starts it would keep
  // recommending the ones it knows nothing about.
  const values = id => {
    let row = table.get(id);
    if (!row) {
      row = { q: new Float32Array(9), tried: new Uint8Array(9) };
      table.set(id, row);
    }
    return row;
  };

  const share = () => Math.min(1, episodes / Math.max(1, settings.episodes));
  const epsilonNow = () =>
    settings.epsilonFrom + (settings.epsilonTo - settings.epsilonFrom) * share();
  const alphaNow = () =>
    settings.alpha + ((settings.alphaTo ?? settings.alpha) - settings.alpha) * share();

  function episode() {
    const start = places[Math.floor(random() * places.length)];
    let x = start[0];
    let y = start[1];
    let vx = Math.floor(random() * (2 * MAX_SPEED + 1)) - MAX_SPEED;
    let vy = Math.floor(random() * (2 * MAX_SPEED + 1)) - MAX_SPEED;
    const epsilon = epsilonNow();
    const alpha = alphaNow();
    let steps = 0;

    while (steps < settings.episodeCap) {
      steps += 1;
      const row = values(key(x, y, vx, vy));
      const allowed = [];
      for (let index = 0; index < MOVES.length; index++) {
        if (Math.abs(vx + MOVES[index].ax) > MAX_SPEED) continue;
        if (Math.abs(vy + MOVES[index].ay) > MAX_SPEED) continue;
        allowed.push(index);
      }
      const choice = random() < epsilon
        ? allowed[Math.floor(random() * allowed.length)]
        : bestOf(row.q, allowed);

      const outcome = roll(track, gates, x, y, vx, vy, MOVES[choice]);
      let reward = -1;
      if (outcome.crashed) {
        reward -= OFF_TRACK_COST;
        crashes += 1;
      }
      if (settings.shaping) {
        // Potential-based, so it changes how fast it learns and not what the
        // best way round is.
        const before = remaining.get([x, y].join()) ?? 0;
        const after = outcome.home ? 0 : (remaining.get([outcome.x, outcome.y].join()) ?? before);
        reward += before - settings.gamma * after;
      }

      if (outcome.backwards) reward -= OFF_TRACK_COST;

      let target = reward;
      if (!outcome.home && !outcome.backwards) {
        const next = values(key(outcome.x, outcome.y, outcome.vx, outcome.vy));
        let best = -Infinity;
        for (let index = 0; index < 9; index++) {
          if (Math.abs(outcome.vx + MOVES[index].ax) > MAX_SPEED) continue;
          if (Math.abs(outcome.vy + MOVES[index].ay) > MAX_SPEED) continue;
          if (next.q[index] > best) best = next.q[index];
        }
        target += settings.gamma * (best === -Infinity ? 0 : best);
      }
      row.q[choice] += alpha * (target - row.q[choice]);
      row.tried[choice] = 1;

      x = outcome.x;
      y = outcome.y;
      vx = outcome.vx;
      vy = outcome.vy;
      if (outcome.home) {
        arrivals += 1;
        break;
      }
      if (outcome.backwards) {
        wrongWay += 1;
        break;
      }
    }

    episodes += 1;
    lengths.push(steps);
  }

  return {
    table,
    key,
    settings,
    get stats() {
      return {
        episodes,
        states: table.size,
        crashes,
        arrivals,
        wrongWay,
        seconds: Math.round(spent / 100) / 10,
        perSecond: spent > 0 ? Math.round(episodes / (spent / 1000)) : 0,
        epsilon: Math.round(epsilonNow() * 1000) / 1000,
        alpha: Math.round(alphaNow() * 1000) / 1000,
        rolling: rollingMean(lengths, 50),
        lengths,
      };
    },
    get done() {
      return episodes >= settings.episodes;
    },
    /**
     * Runs episodes for about this many milliseconds and hands control back.
     * Training takes seconds, and seconds of a frozen page is indistinguishable
     * from a broken one.
     */
    runFor(milliseconds) {
      const until = now() + milliseconds;
      const before = episodes;
      do {
        episode();
      } while (now() < until && episodes < settings.episodes);
      spent += milliseconds;
      return episodes - before;
    },
  };
}

/** One move, by the same rules the game uses, without building a whole state. */
function roll(track, gates, x, y, vx, vy, move) {
  const nvx = vx + move.ax;
  const nvy = vy + move.ay;
  const from = [x, y];
  const to = [x + nvx, y + nvy];
  const hit = track.hit(from, to);

  if (hit === null) {
    let home = false;
    let backwards = false;
    for (const gate of gates) {
      if (crossesGate(gate, from, to) !== null) home = true;
      // Going back through a gate is how the whole thing could be cheated:
      // reverse through one and come straight back for the reward, two moves
      // instead of driving to the next. So it ends the attempt instead.
      else if (crossesGate(gate, to, from) !== null) backwards = true;
    }
    return { x: to[0], y: to[1], vx: nvx, vy: nvy, crashed: false, home, backwards };
  }

  let landing = from;
  for (const step of latticePointsAlong(from, [nvx, nvy])) {
    if (step.t >= hit.t) break;
    if (track.contains(step.point[0], step.point[1])) landing = step.point;
  }
  return {
    x: landing[0], y: landing[1], vx: 0, vy: 0,
    crashed: true, home: false, backwards: false,
  };
}

function bestOf(row, allowed) {
  let best = allowed[0];
  let bestValue = -Infinity;
  for (const index of allowed) {
    if (row[index] > bestValue) {
      bestValue = row[index];
      best = index;
    }
  }
  return best;
}

/** The average of the last so many episodes, which is the line on the chart. */
export function rollingMean(lengths, window) {
  if (lengths.length === 0) return 0;
  const from = Math.max(0, lengths.length - window);
  let total = 0;
  for (let index = from; index < lengths.length; index++) total += lengths[index];
  return Math.round(total / (lengths.length - from));
}

function distanceAlong(track, point) {
  let best = 0;
  let bestGap = Infinity;
  for (const sample of track.samples) {
    const gap = (sample.x - point[0]) ** 2 + (sample.y - point[1]) ** 2;
    if (gap < bestGap) {
      bestGap = gap;
      best = sample.s;
    }
  }
  return best;
}

/**
 * The move the learned table thinks best. Other cars are not in the table at
 * all — it has never seen one — so when its favourite is blocked it takes the
 * best of the moves it is actually allowed. That is an honest limit of the
 * state it was given, and the interface says so.
 */
export function learnerMove(state, learned) {
  const started = now();
  const moves = legalMoves(state);
  if (moves.length === 0) {
    return { move: { ax: 0, ay: 0 }, stats: finish('learner', 0, started, { boxedIn: true }) };
  }
  const player = state.players[state.active];
  const row = learned && learned.table.get(
    learned.key(player.pos[0], player.pos[1], player.vel[0], player.vel[1]));
  if (!row) {
    // Somewhere it never visited while training: it has nothing to say, so the
    // greedy rule drives instead, and the interface reports it.
    const fallback = greedy(state);
    return {
      move: fallback.move,
      stats: finish('learner', 9, started, { unseen: true, fellBack: true }),
    };
  }

  let best = null;
  let bestValue = -Infinity;
  for (const move of moves) {
    const index = MOVES.findIndex(one => one.ax === move.ax && one.ay === move.ay);
    if (!row.tried[index]) continue;
    if (row.q[index] > bestValue) {
      bestValue = row.q[index];
      best = move;
    }
  }
  if (!best) {
    const fallback = greedy(state);
    return {
      move: fallback.move,
      stats: finish('learner', 9, started, { unseen: true, fellBack: true }),
    };
  }
  const favourite = MOVES[bestOf(row.q, [0, 1, 2, 3, 4, 5, 6, 7, 8]
    .filter(index => row.tried[index]))];
  const blocked = !moves.some(move => move.ax === favourite.ax && move.ay === favourite.ay);
  return { move: best, stats: finish('learner', moves.length, started, { blocked }) };
}
