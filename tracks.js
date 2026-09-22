/**
 * Track geometry.
 *
 * A track is an area of the plane, not a grid of cells. It is bounded by two
 * closed curves — an outer and an inner — and a car may be anywhere between
 * them. The squared paper is background and arithmetic aid; the edge of the
 * track pays it no attention.
 *
 * The six tracks are written as the corners of a closed loop:
 *
 *   corners: [[x, y, r, w], [x, y, r, w], ...]
 *
 * Each corner is rounded off with an arc of radius r, the straights between
 * them stay straight, and w is the half-width of the track at that corner. A
 * handful of corners is enough to give a track its own shape, and anyone can
 * read one off the paper and change it.
 *
 * That becomes a centreline — a list of [x, y, w] points round the loop — and
 * the tracks made up on the spot are written as a centreline directly. The
 * centreline is smoothed
 * with a closed Catmull-Rom spline and then offset by ±w to make the two
 * edges. That gives smooth edges without any tidying up afterwards, it makes
 * the centreline double as the driving line the arrows follow, and it makes a
 * gate across the track nothing more than the normal at some distance along it.
 *
 * Offsetting has one trap: where the centreline bends tighter than w, the
 * inner edge folds through itself. Monaco's hairpin is exactly there. The
 * parser measures the curvature everywhere and refuses the track if it bends
 * too tightly, because a track that folds through itself should fail when it
 * is loaded rather than behave strangely in the third corner.
 */

/**
 * Floating point never lands exactly on a line, so every comparison against
 * zero is made with a tolerance. It is deliberately tiny: the numbers here are
 * tens, not millions, so 1e-9 sits far below anything the geometry produces by
 * accident and far above the rounding error of a few multiplications.
 */
export const EPSILON = 1e-9;

/** Roughly how far apart the sampled points along an edge are, in cells. */
const STEP = 0.4;

/** The side of the square used to bucket edges for lookup. */
const BUCKET = 4;

/** A race needs four places on the line. */
const MIN_STARTS = 4;

/** How many checkpoint gates a track is expected to have. */
const MIN_GATES = 8;
const MAX_GATES = 9;

/** The inner edge folds through itself at radius w, so keep a margin. */
const CURVE_MARGIN = 1.15;

/**
 * The six. Each corner is [x, y, r, w]: where it is, the radius it is rounded
 * off to, and the half-width of the track there. They are named after places
 * and go for a shape of their own rather than a copy of the real circuit.
 */
const SOURCES = [
  {
    id: 'monza',
    name: 'Monza',
    character: 'Long straights, and a dip in the middle of the top one',
    corners: [
      [60, 34, 9, 3.2], [10, 34, 6, 3.2], [8, 8, 6, 3], [30, 4, 6, 2.8],
      [42, 14, 5, 2.6], [56, 6, 5, 2.8], [64, 14, 5, 3],
    ],
  },
  {
    id: 'spa',
    name: 'Spa',
    character: 'Fast and sweeping, with one long diagonal',
    corners: [
      [58, 36, 6, 3], [12, 36, 6, 3], [8, 26, 4, 2.8], [24, 6, 6, 3.2],
      [36, 6, 5, 3], [64, 26, 6, 3],
    ],
  },
  {
    id: 'silverstone',
    name: 'Silverstone',
    character: 'A detour down into the middle and back out',
    corners: [
      [56, 36, 6, 3.2], [8, 36, 6, 3.2], [8, 4, 6, 3], [25, 4, 5, 2.8],
      [25, 20, 6, 2.8], [39, 20, 6, 2.8], [39, 4, 5, 2.8], [56, 4, 6, 3],
    ],
  },
  {
    id: 'monaco',
    name: 'Monaco',
    character: 'Narrow and twisting, with a hairpin',
    corners: [
      [39, 37, 4, 2.2], [8, 37, 4, 2.2], [8, 6, 4, 2.1], [39, 6, 4, 2.1],
      [39, 20, 4, 1.9], [19, 20, 3.5, 1.9], [19, 28, 3.5, 1.9], [39, 28, 4, 1.9],
    ],
  },
  {
    id: 'suzuka',
    name: 'Suzuka',
    character: 'Pinched in from both sides halfway down',
    corners: [
      [51, 36, 6, 3], [8, 36, 6, 3], [8, 26, 4, 2.8], [22.5, 20, 4, 2.8],
      [8, 14, 4, 2.8], [8, 4, 6, 3], [51, 4, 6, 3], [51, 14, 4, 2.8],
      [37, 20, 4, 2.8], [51, 26, 4, 2.8],
    ],
  },
  {
    id: 'interlagos',
    name: 'Interlagos',
    character: 'An L, run anti-clockwise',
    corners: [
      [8, 36, 6, 3.2], [64, 36, 6, 3.2], [64, 20, 5, 3], [34, 20, 6, 3],
      [34, 4, 6, 3], [8, 4, 6, 3],
    ],
  },
];

const cache = new Map();

/** Every track, parsed, in declaration order. */
export function listTracks() {
  return SOURCES.map(source => getTrack(source.id));
}

/** The id of every track, in declaration order. */
export function trackIds() {
  return SOURCES.map(source => source.id);
}

/** A parsed track by id. Parsed once and then shared: treat it as read-only. */
export function getTrack(id) {
  if (cache.has(id)) return cache.get(id);
  // A made-up track carries its seed in its id, so it can be drawn again from
  // nothing — which is what lets a saved race on one be loaded back.
  const made = /^anywhere-(\d+)$/.exec(String(id));
  if (made) {
    const track = generateTrack(Number(made[1]), id).track;
    cache.set(id, track);
    return track;
  }
  const source = SOURCES.find(candidate => candidate.id === id);
  if (!source) throw new Error(`Unknown track: ${JSON.stringify(id)}`);
  const track = parseTrack(source);
  cache.set(id, track);
  return track;
}

/** Adds a track at runtime: generated tracks, and the ones the tests race on. */
export function defineTrack(source) {
  const track = parseTrack(source);
  cache.set(track.id, track);
  return track;
}

// ---------------------------------------------------------------------------
// Parsing: from a centreline to an area
// ---------------------------------------------------------------------------

export function parseTrack(source) {
  if (!source || typeof source !== 'object') throw new Error('Track source must be an object');
  const where = `Track ${JSON.stringify(source && source.id)}`;
  for (const field of ['id', 'name', 'character']) {
    if (typeof source[field] !== 'string' || source[field] === '') {
      throw new Error(`${where}: ${field} must be a non-empty string`);
    }
  }
  const points = source.corners ? roundCorners(source.corners, where) : source.centerline;
  if (!Array.isArray(points) || points.length < 6) {
    throw new Error(`${where}: centerline needs at least 6 points`);
  }
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite)) {
      throw new Error(`${where}: centerline point ${JSON.stringify(point)} is not [x, y, w]`);
    }
    if (point[2] <= 0.5) {
      throw new Error(`${where}: half-width ${point[2]} at ${point[0]},${point[1]} is too small`);
    }
  }

  const samples = sampleCenterline(points);
  requireGentleCurves(samples, where);

  const one = [];
  const other = [];
  for (const sample of samples) {
    one.push([sample.x + sample.nx * sample.w, sample.y + sample.ny * sample.w]);
    other.push([sample.x - sample.nx * sample.w, sample.y - sample.ny * sample.w]);
  }
  // Which offset is the outside depends on which way round the centreline was
  // written, and the one with the larger area is the outside either way.
  const [outer, inner] = Math.abs(area(one)) >= Math.abs(area(other))
    ? [one, other] : [other, one];

  const edges = [...loopEdges(outer), ...loopEdges(inner)];
  const last = samples[samples.length - 1];

  const track = {
    id: source.id,
    name: source.name,
    character: source.character,
    centerline: points.map(point => [...point]),
    samples,
    length: last.s + last.step,
    outer,
    inner,
    edges,
    bounds: bounds(outer),
    ...buildIndex(edges),
  };
  Object.assign(track, questions(track));

  requireSimpleEdges(track, where);

  track.gates = buildGates(track, source.gates || MAX_GATES);
  track.checkpointCount = track.gates.length - 1;
  if (track.checkpointCount < MIN_GATES || track.checkpointCount > MAX_GATES) {
    throw new Error(`${where}: needs ${MIN_GATES}–${MAX_GATES} checkpoint gates, `
      + `has ${track.checkpointCount}`);
  }

  track.starts = latticePointsOn(track, track.gates[0]);
  if (track.starts.length < MIN_STARTS) {
    throw new Error(`${where}: every car starts on the finish line, and only `
      + `${track.starts.length} whole-number points fit on it — ${MIN_STARTS} are needed`);
  }

  return Object.freeze(track);
}

/**
 * Turns a list of corners into a centreline: an arc round each corner, and a
 * straight from the end of one arc to the start of the next.
 *
 * An arc of radius r round a corner that turns through an angle a starts and
 * ends r·tan(a/2) from the corner. If the arcs at the two ends of a straight
 * need more room than the straight has, the corners are too close together
 * for their radii, and the track is refused.
 */
function roundCorners(corners, where) {
  if (!Array.isArray(corners) || corners.length < 3) {
    throw new Error(`${where}: corners needs at least 3 corners`);
  }
  for (const corner of corners) {
    if (!Array.isArray(corner) || corner.length !== 4 || !corner.every(Number.isFinite)
      || corner[2] <= 0) {
      throw new Error(`${where}: corner ${JSON.stringify(corner)} is not [x, y, r, w]`);
    }
  }
  const count = corners.length;
  const arcs = corners.map(([x, y, r, w], index) => {
    const [px, py] = corners[(index - 1 + count) % count];
    const [nx, ny] = corners[(index + 1) % count];
    const inward = unit(x - px, y - py);
    const outward = unit(nx - x, ny - y);
    const turn = Math.atan2(inward[0] * outward[1] - inward[1] * outward[0],
      inward[0] * outward[0] + inward[1] * outward[1]);
    const reach = r * Math.tan(Math.abs(turn) / 2);
    const start = [x - inward[0] * reach, y - inward[1] * reach];
    const end = [x + outward[0] * reach, y + outward[1] * reach];
    // The centre of the arc is r to the side the track turns towards.
    const side = Math.sign(turn);
    const centre = [start[0] - inward[1] * side * r, start[1] + inward[0] * side * r];
    const from = Math.atan2(start[1] - centre[1], start[0] - centre[0]);
    const steps = Math.max(1, Math.ceil(Math.abs(turn) / (Math.PI / 12)));
    const points = [];
    for (let step = 0; step <= steps; step++) {
      const angle = from + (turn * step) / steps;
      points.push([centre[0] + r * Math.cos(angle), centre[1] + r * Math.sin(angle), w]);
    }
    return { start, end, reach, points, w };
  });

  const centerline = [];
  arcs.forEach((arc, index) => {
    const next = arcs[(index + 1) % count];
    const [x, y] = corners[index];
    const [nx, ny] = corners[(index + 1) % count];
    if (arc.reach + next.reach > Math.hypot(nx - x, ny - y) + EPSILON) {
      throw new Error(`${where}: the corners at ${x},${y} and ${nx},${ny} are too close `
        + 'together for their radii');
    }
    for (const point of arc.points) {
      const last = centerline[centerline.length - 1];
      if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.01) centerline.push(point);
    }
    // Points along the straight, about as far apart as the points round the
    // arcs: the spline through them bulges where the spacing jumps.
    const length = Math.hypot(next.start[0] - arc.end[0], next.start[1] - arc.end[1]);
    const pieces = Math.ceil(length / 1.5);
    for (let piece = 1; piece < pieces; piece++) {
      const t = piece / pieces;
      centerline.push([
        arc.end[0] + (next.start[0] - arc.end[0]) * t,
        arc.end[1] + (next.start[1] - arc.end[1]) * t,
        arc.w + (next.w - arc.w) * t,
      ]);
    }
  });
  const [first, last] = [centerline[0], centerline[centerline.length - 1]];
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= 0.01) centerline.pop();
  return centerline;
}

function unit(x, y) {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
}

/** Catmull-Rom through the centreline, sampled evenly, carrying the width along. */
function sampleCenterline(points) {
  const raw = [];
  const count = points.length;
  for (let index = 0; index < count; index++) {
    const p0 = points[(index - 1 + count) % count];
    const p1 = points[index];
    const p2 = points[(index + 1) % count];
    const p3 = points[(index + 2) % count];
    const steps = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / STEP));
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      raw.push({
        x: catmull(p0[0], p1[0], p2[0], p3[0], t),
        y: catmull(p0[1], p1[1], p2[1], p3[1], t),
        w: catmull(p0[2], p1[2], p2[2], p3[2], t),
      });
    }
  }

  let travelled = 0;
  return raw.map((point, index) => {
    const next = raw[(index + 1) % raw.length];
    const previous = raw[(index - 1 + raw.length) % raw.length];
    const tx = next.x - previous.x;
    const ty = next.y - previous.y;
    const length = Math.hypot(tx, ty) || 1;
    const sample = {
      x: point.x,
      y: point.y,
      w: point.w,
      tx: tx / length,
      ty: ty / length,
      nx: -ty / length,
      ny: tx / length,
      s: travelled,
      step: Math.hypot(next.x - point.x, next.y - point.y),
    };
    travelled += sample.step;
    return sample;
  });
}

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t
    + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
    + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/**
 * Where the centreline bends tighter than the track is wide, the inner edge
 * turns inside out. Measuring it here means a track like that never loads.
 */
function requireGentleCurves(samples, where) {
  for (let index = 0; index < samples.length; index++) {
    const previous = samples[(index - 1 + samples.length) % samples.length];
    const here = samples[index];
    const next = samples[(index + 1) % samples.length];
    const turn = Math.abs(angleBetween(previous, here, next));
    const along = (Math.hypot(here.x - previous.x, here.y - previous.y)
      + Math.hypot(next.x - here.x, next.y - here.y)) / 2;
    if (turn < 1e-6 || along < 1e-6) continue;
    const radius = along / turn;
    if (radius < here.w * CURVE_MARGIN) {
      throw new Error(`${where}: the centreline bends to a radius of ${radius.toFixed(2)} at `
        + `${here.x.toFixed(1)},${here.y.toFixed(1)}, tighter than its half-width of `
        + `${here.w.toFixed(2)} — the inner edge would fold through itself`);
    }
  }
}

function angleBetween(a, b, c) {
  let turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
  while (turn > Math.PI) turn -= Math.PI * 2;
  while (turn < -Math.PI) turn += Math.PI * 2;
  return turn;
}

function loopEdges(loop) {
  return loop.map((point, index) => {
    const next = loop[(index + 1) % loop.length];
    return [point[0], point[1], next[0], next[1]];
  });
}

function area(loop) {
  let total = 0;
  for (let index = 0; index < loop.length; index++) {
    const [x1, y1] = loop[index];
    const [x2, y2] = loop[(index + 1) % loop.length];
    total += x1 * y2 - x2 * y1;
  }
  return total / 2;
}

function bounds(loop) {
  const xs = loop.map(point => point[0]);
  const ys = loop.map(point => point[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

// ---------------------------------------------------------------------------
// Finding the edges that matter
// ---------------------------------------------------------------------------

/**
 * Every question about the edge of the track — and the search for the fastest
 * lap in the tests asks a great many of them — only concerns edges that are
 * nearby.
 * Edges go into square buckets for that, and into a bucket per row of the
 * paper for the sideways ray that decides whether a point is inside.
 */
function buildIndex(edges) {
  const buckets = new Map();
  const rows = new Map();
  edges.forEach((edge, id) => {
    const minX = Math.min(edge[0], edge[2]);
    const maxX = Math.max(edge[0], edge[2]);
    const minY = Math.min(edge[1], edge[3]);
    const maxY = Math.max(edge[1], edge[3]);
    for (let gx = Math.floor(minX / BUCKET); gx <= Math.floor(maxX / BUCKET); gx++) {
      for (let gy = Math.floor(minY / BUCKET); gy <= Math.floor(maxY / BUCKET); gy++) {
        const key = `${gx},${gy}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(id);
      }
    }
    for (let row = Math.floor(minY); row <= Math.floor(maxY); row++) {
      if (!rows.has(row)) rows.set(row, []);
      rows.get(row).push(id);
    }
  });
  return { buckets, rows };
}

function edgesNear(track, minX, minY, maxX, maxY) {
  const found = new Set();
  for (let gx = Math.floor((minX - 1) / BUCKET); gx <= Math.floor((maxX + 1) / BUCKET); gx++) {
    for (let gy = Math.floor((minY - 1) / BUCKET); gy <= Math.floor((maxY + 1) / BUCKET); gy++) {
      const bucket = track.buckets.get(`${gx},${gy}`);
      if (bucket) for (const id of bucket) found.add(id);
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// What the rules ask of the geometry
// ---------------------------------------------------------------------------

function questions(track) {
  return {
    /**
     * Is this point on the track? The edge itself is not: a point exactly on
     * the boundary counts as outside, which keeps "may a car stand here" and
     * "may a car cross here" from ever disagreeing.
     */
    contains(x, y) {
      for (const id of edgesNear(track, x, y, x, y)) {
        if (distanceToEdge(track.edges[id], x, y) <= EPSILON) return false;
      }
      // A ray to the right crosses the boundary an odd number of times from
      // inside the area and an even number from outside it, which takes care
      // of the hole in the middle without a special case.
      let crossings = 0;
      for (const id of track.rows.get(Math.floor(y)) || []) {
        const [x1, y1, x2, y2] = track.edges[id];
        if ((y1 > y) === (y2 > y)) continue;
        if (x1 + ((y - y1) / (y2 - y1)) * (x2 - x1) > x) crossings += 1;
      }
      return crossings % 2 === 1;
    },

    /**
     * The first place the straight line from one point to another meets the
     * edge of the track, or null if it never does.
     *
     * Three awkward cases are settled here once and for all, because floating
     * point cannot be trusted to settle them the same way twice:
     *
     *   - A line that touches an edge without crossing it is allowed. It has
     *     not left the track, and refusing it would crash a car that grazes
     *     the kerb for no reason anybody could see.
     *   - A line through a corner of the edge is refused. At a corner the sign
     *     test breaks down, and a line through one can pass from inside to
     *     outside without ever registering as a crossing. Conservative is the
     *     only stable answer.
     *   - An end of the line sitting exactly on an edge is refused, for the
     *     same reason a point on the edge is not on the track.
     */
    hit(from, to) {
      const minX = Math.min(from[0], to[0]);
      const maxX = Math.max(from[0], to[0]);
      const minY = Math.min(from[1], to[1]);
      const maxY = Math.max(from[1], to[1]);
      let first = null;
      for (const id of edgesNear(track, minX, minY, maxX, maxY)) {
        const where = crossing(from, to, track.edges[id]);
        if (where === null) continue;
        if (first === null || where.t < first.t) {
          first = { t: where.t, x: where.x, y: where.y, edge: track.edges[id] };
        }
      }
      return first;
    },
  };
}

/** Where the line from→to is blocked by one edge, or null. See hit(). */
function crossing(from, to, edge) {
  const [px, py] = from;
  const [qx, qy] = to;
  const [ax, ay, bx, by] = edge;

  const d1 = cross(bx - ax, by - ay, px - ax, py - ay);
  const d2 = cross(bx - ax, by - ay, qx - ax, qy - ay);
  const d3 = cross(qx - px, qy - py, ax - px, ay - py);
  const d4 = cross(qx - px, qy - py, bx - px, by - py);
  const straddles = (one, two) => (one > EPSILON && two < -EPSILON)
    || (one < -EPSILON && two > EPSILON);

  if (straddles(d1, d2) && straddles(d3, d4)) return where(from, to, edge, null);
  if (Math.abs(d3) <= EPSILON && between(from, to, ax, ay)) return where(from, to, edge, [ax, ay]);
  if (Math.abs(d4) <= EPSILON && between(from, to, bx, by)) return where(from, to, edge, [bx, by]);
  if (Math.abs(d1) <= EPSILON && between([ax, ay], [bx, by], px, py)) {
    return { t: 0, x: px, y: py };
  }
  if (Math.abs(d2) <= EPSILON && between([ax, ay], [bx, by], qx, qy)) {
    return { t: 1, x: qx, y: qy };
  }
  return null;
}

function where(from, to, edge, known) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (known) {
    const squared = dx * dx + dy * dy || 1;
    return {
      t: ((known[0] - from[0]) * dx + (known[1] - from[1]) * dy) / squared,
      x: known[0],
      y: known[1],
    };
  }
  const [ax, ay, bx, by] = edge;
  const denominator = cross(dx, dy, bx - ax, by - ay);
  if (Math.abs(denominator) <= EPSILON) return { t: 0, x: from[0], y: from[1] };
  const t = cross(ax - from[0], ay - from[1], bx - ax, by - ay) / denominator;
  return { t, x: from[0] + dx * t, y: from[1] + dy * t };
}

function between(from, to, x, y) {
  return x >= Math.min(from[0], to[0]) - EPSILON && x <= Math.max(from[0], to[0]) + EPSILON
    && y >= Math.min(from[1], to[1]) - EPSILON && y <= Math.max(from[1], to[1]) + EPSILON;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function distanceToEdge(edge, x, y) {
  const [ax, ay, bx, by] = edge;
  const dx = bx - ax;
  const dy = by - ay;
  const squared = dx * dx + dy * dy || 1e-12;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / squared));
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** No part of an edge may cross another part of it, or of the other edge. */
function requireSimpleEdges(track, where) {
  track.edges.forEach((edge, id) => {
    const minX = Math.min(edge[0], edge[2]);
    const maxX = Math.max(edge[0], edge[2]);
    const minY = Math.min(edge[1], edge[3]);
    const maxY = Math.max(edge[1], edge[3]);
    for (const other of edgesNear(track, minX, minY, maxX, maxY)) {
      if (Math.abs(other - id) <= 1) continue;
      const against = track.edges[other];
      if (straddle(edge, against) && straddle(against, edge)) {
        throw new Error(`${where}: the edge of the track crosses itself near `
          + `${edge[0].toFixed(1)},${edge[1].toFixed(1)} — the centreline bends too tightly `
          + 'or runs too close to another part of the track');
      }
    }
  });
}

function straddle(edge, other) {
  const d1 = cross(edge[2] - edge[0], edge[3] - edge[1], other[0] - edge[0], other[1] - edge[1]);
  const d2 = cross(edge[2] - edge[0], edge[3] - edge[1], other[2] - edge[0], other[3] - edge[1]);
  return (d1 > EPSILON && d2 < -EPSILON) || (d1 < -EPSILON && d2 > EPSILON);
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/**
 * The finish line and the checkpoints are gates: a straight line across the
 * track with a direction along it. Crossing one the right way is what counts.
 *
 * The finish gate is put where the track runs squarely along the paper, so
 * that the line falls on whole-number coordinates and the cars can line up on
 * it. The checkpoints are spread evenly round the rest of the lap.
 */
function buildGates(track, count) {
  const start = squareSample(track);
  const gates = [gateAt(track, start, 0)];
  for (let number = 1; number <= count; number++) {
    const along = (track.samples[start].s + (number / (count + 1)) * track.length) % track.length;
    gates.push(gateAt(track, nearestSample(track, along), number));
  }
  return gates;
}

/** The point on the lap where the track runs most nearly along the paper. */
function squareSample(track) {
  let best = 0;
  let bestScore = -Infinity;
  track.samples.forEach((sample, index) => {
    const along = Math.max(Math.abs(sample.tx), Math.abs(sample.ty));
    const across = Math.min(Math.abs(sample.tx), Math.abs(sample.ty));
    const score = along - across * 6 + sample.w * 0.08;
    if (score > bestScore) { bestScore = score; best = index; }
  });
  return best;
}

function nearestSample(track, distance) {
  let best = 0;
  let bestGap = Infinity;
  track.samples.forEach((sample, index) => {
    const gap = Math.abs(sample.s - distance);
    if (gap < bestGap) { bestGap = gap; best = index; }
  });
  return best;
}

function gateAt(track, index, number) {
  const sample = track.samples[index];
  // The finish gate is squared up to the paper so whole-number points sit on
  // it; the checkpoints can lie wherever the track happens to run.
  const flat = number === 0 && Math.abs(sample.tx) > Math.abs(sample.ty);
  const upright = number === 0 && Math.abs(sample.ty) >= Math.abs(sample.tx);
  const x = flat ? Math.round(sample.x) : sample.x;
  const y = upright ? Math.round(sample.y) : sample.y;
  const nx = flat ? 0 : upright ? 1 : sample.nx;
  const ny = flat ? 1 : upright ? 0 : sample.ny;
  const reach = sample.w + 0.75;
  return {
    number,
    a: [x - nx * reach, y - ny * reach],
    b: [x + nx * reach, y + ny * reach],
    dir: flat ? [Math.sign(sample.tx), 0]
      : upright ? [0, Math.sign(sample.ty)]
        : [sample.tx, sample.ty],
    at: [x, y],
  };
}

/** The whole-number points that lie on a gate and on the track. */
function latticePointsOn(track, gate) {
  const found = [];
  const seen = new Set();
  const steps = Math.ceil(Math.hypot(gate.b[0] - gate.a[0], gate.b[1] - gate.a[1]) * 8);
  for (let step = 0; step <= steps; step++) {
    const t = step / steps;
    const x = Math.round(gate.a[0] + (gate.b[0] - gate.a[0]) * t);
    const y = Math.round(gate.a[1] + (gate.b[1] - gate.a[1]) * t);
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (distanceToEdge([gate.a[0], gate.a[1], gate.b[0], gate.b[1]], x, y) > 1e-6) continue;
    if (!track.contains(x, y)) continue;
    found.push([x, y]);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Anywhere: a track made up on the spot
// ---------------------------------------------------------------------------

/**
 * Builds a closed centreline from a seed. It checks its own work with the same
 * parser everything else goes through, and flattens the shape and tries again
 * if it came out too tight anywhere — so this returns a track that loads, or
 * throws here rather than in the middle of a lesson.
 */
export function generateTrack(seed, id = `anywhere-${seed >>> 0}`) {
  const random = mulberry(seed);
  const harmonics = [2, 3, 4, 5].map(order => ({
    order,
    phase: random() * Math.PI * 2,
    weight: (0.35 + random()) / order,
  }));
  const widthPhase = random() * Math.PI * 2;
  const widthOrder = 2 + Math.floor(random() * 3);
  let last = null;

  for (let attempt = 0; attempt < 16; attempt++) {
    const amplitude = 0.24 * Math.pow(0.8, attempt);
    const centerline = [];
    const count = 28;
    for (let step = 0; step < count; step++) {
      const angle = (step / count) * Math.PI * 2;
      let wobble = 0;
      for (const harmonic of harmonics) {
        wobble += harmonic.weight * Math.cos(harmonic.order * angle + harmonic.phase);
      }
      const radius = 19.2 * (1 + amplitude * wobble);
      centerline.push([
        round2(34 + radius * 1.2 * Math.cos(angle)),
        round2(20 + radius * 0.78 * Math.sin(angle)),
        round2(2.9 + 0.45 * Math.sin(widthOrder * angle + widthPhase)),
      ]);
    }
    const source = {
      id, name: 'Anywhere', character: 'Made up on the spot', centerline,
    };
    try {
      return { source, track: parseTrack(source) };
    } catch (error) {
      last = error;
    }
  }
  throw last;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** The same small generator the engine uses, kept here so tracks.js stands alone. */
function mulberry(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
