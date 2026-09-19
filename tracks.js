/**
 * Tracks as editable text, plus the parser.
 *
 * A track is drawn as a grid of characters:
 *
 *   #    wall
 *   .    track
 *   S    starting cell (used in reading order: top to bottom, left to right)
 *   F    finish line
 *   1-9  checkpoint with that number
 *        (space) outside the track, never drawn
 *
 * Walls and the empty space outside the track are equally solid; the only
 * difference is that walls are drawn.
 *
 * Draw the finish line and every checkpoint as an unbroken line across the
 * full width of the track. A car at speed 5 covers five cells in a single
 * move, and the only thing that stops it slipping past a line is that no
 * route across the track avoids it.
 *
 * Every track also carries a driving direction for the finish line
 * (finishDir), which is what makes a lap count in one direction only.
 *
 * The parser is deliberately strict: a broken track throws when it is loaded
 * rather than behaving oddly in the third corner.
 */

const CHECKPOINT_CHARS = '123456789';

const SOURCES = [
  {
    id: 'monza',
    name: 'Monza',
    blurb: 'Long straights broken by three chicanes. Very little braking, '
      + 'but get a chicane wrong and you give the whole straight back.',
    finishDir: [1, 0],
    text: `
                   #############################################
                ###################################################
              #####......5..........####...............4........#####
            ####.........5..........####...............4...........####
           ###...........5..........####...####........4.............###
          ###............5.................####........4..............###
         ###.............5.................####........4...............##
        ###.......###############################################.......##
        ##.......#################################################......##
       ##......####                                             ###......##
       ##.....###                                                 ##.....##
       ##.....##                                                  ##.....##
      ##.....##                                                   ##33333##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   #####..##
      ##.....##                                                   #####..##
      ##.....##                                                   #####..##
      ##.....##                                                   #####..##
      ##.....##                                                   ##.....##
      ##66666##                                                   ##.....##
      ##.....##                                                   ##..#####
      ##.....##                                                   ##..#####
      ##.....##                                                   ##..#####
      ##.....##                                                   ##..#####
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##22222##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
      ##.....##                                                   ##.....##
       ##.....#####################################################......##
       ##.....####################################################......##
       ##.........F...............####.................1................##
        ##........F.....S....S....####.................1...............##
        ###.......F...............####...####..........1..............###
         ###......F.....S....S...........####..........1.............###
          ###.....F......................####..........1..........#####
           ##########################################################
             #####################################################
`,
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

/**
 * Adds a track at runtime and returns it parsed. The six tracks above are the
 * ones the game ships with; this is for tracks made somewhere else, such as
 * the small purpose-built ones the tests race on.
 */
export function defineTrack(source) {
  const track = parseTrack(source);
  if (cache.has(track.id)) throw new Error(`Track ${JSON.stringify(track.id)} already exists`);
  SOURCES.push(source);
  cache.set(track.id, track);
  return track;
}

/** A parsed track by id. Parsed once and then shared: treat it as read-only. */
export function getTrack(id) {
  if (cache.has(id)) return cache.get(id);
  const source = SOURCES.find(candidate => candidate.id === id);
  if (!source) throw new Error(`Unknown track: ${JSON.stringify(id)}`);
  const track = parseTrack(source);
  cache.set(id, track);
  return track;
}

/**
 * Turns one track source into a parsed track, throwing with a precise message
 * on anything it cannot make sense of.
 */
export function parseTrack(source) {
  if (!source || typeof source !== 'object') throw new Error('Track source must be an object');
  const where = `Track ${JSON.stringify(source.id)}`;
  for (const field of ['id', 'name', 'blurb', 'text']) {
    if (typeof source[field] !== 'string' || source[field] === '') {
      throw new Error(`${where}: ${field} must be a non-empty string`);
    }
  }
  const dir = source.finishDir;
  if (!Array.isArray(dir) || dir.length !== 2
    || !dir.every(component => component === -1 || component === 0 || component === 1)
    || (dir[0] === 0 && dir[1] === 0)) {
    throw new Error(`${where}: finishDir must be [dx, dy] with dx, dy in -1..1, not both zero`);
  }

  const rows = trimGrid(source.text);
  if (rows.length === 0) throw new Error(`${where}: the grid is empty`);
  const width = Math.max(...rows.map(row => row.length));
  const height = rows.length;
  const grid = rows.map(row => row.padEnd(width, ' '));

  const drivable = new Uint8Array(width * height);
  const checkpoints = new Uint8Array(width * height);
  const finishes = new Uint8Array(width * height);
  const starts = [];
  const finishCells = [];
  const checkpointCells = new Map();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const char = grid[y][x];
      const index = y * width + x;
      if (char === ' ' || char === '#') continue;
      if (char === '.') {
        drivable[index] = 1;
      } else if (char === 'S') {
        drivable[index] = 1;
        starts.push([x, y]);
      } else if (char === 'F') {
        drivable[index] = 1;
        finishes[index] = 1;
        finishCells.push([x, y]);
      } else if (CHECKPOINT_CHARS.includes(char)) {
        const number = Number(char);
        drivable[index] = 1;
        checkpoints[index] = number;
        if (!checkpointCells.has(number)) checkpointCells.set(number, []);
        checkpointCells.get(number).push([x, y]);
      } else {
        throw new Error(`${where}: unknown character ${JSON.stringify(char)} at ${x},${y}`);
      }
    }
  }

  if (starts.length < 4) {
    throw new Error(`${where}: needs at least 4 starting cells (S), found ${starts.length}`);
  }
  if (finishCells.length === 0) throw new Error(`${where}: has no finish line (F)`);

  const numbers = [...checkpointCells.keys()].sort((a, b) => a - b);
  if (numbers.length === 0) throw new Error(`${where}: has no checkpoints`);
  numbers.forEach((number, position) => {
    if (number !== position + 1) {
      throw new Error(`${where}: checkpoints must be numbered 1..k with no gaps, `
        + `found ${numbers.join(', ')}`);
    }
  });

  const track = {
    id: source.id,
    name: source.name,
    blurb: source.blurb,
    finishDir: [dir[0], dir[1]],
    width,
    height,
    rows: grid,
    starts,
    finishCells,
    checkpointCount: numbers.length,
    checkpointCells,

    inside(x, y) {
      return x >= 0 && y >= 0 && x < width && y < height;
    },
    charAt(x, y) {
      return this.inside(x, y) ? grid[y][x] : ' ';
    },
    /** Can a car stand here? Everything off the grid counts as outside. */
    isDrivable(x, y) {
      return this.inside(x, y) && drivable[y * width + x] === 1;
    },
    /** True for a wall, as opposed to the blank space outside the track. */
    isWall(x, y) {
      return this.inside(x, y) && grid[y][x] === '#';
    },
    isFinish(x, y) {
      return this.inside(x, y) && finishes[y * width + x] === 1;
    },
    /** The checkpoint number on this cell, or 0 for none. */
    checkpointAt(x, y) {
      return this.inside(x, y) ? checkpoints[y * width + x] : 0;
    },
  };

  requireConnected(track, where);
  return Object.freeze(track);
}

/** Drops the leading newline of the template literal and any trailing blank lines. */
function trimGrid(text) {
  const rows = text.replace(/^\n/, '').split('\n').map(row => row.replace(/\s+$/, ''));
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows;
}

/** A track whose surface falls into two pieces cannot be driven around. */
function requireConnected(track, where) {
  let first = null;
  let total = 0;
  for (let y = 0; y < track.height; y++) {
    for (let x = 0; x < track.width; x++) {
      if (!track.isDrivable(x, y)) continue;
      if (!first) first = [x, y];
      total++;
    }
  }

  const seen = new Set([`${first[0]},${first[1]}`]);
  const queue = [first];
  while (queue.length > 0) {
    const [x, y] = queue.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${x + dx},${y + dy}`;
      if (!track.isDrivable(x + dx, y + dy) || seen.has(key)) continue;
      seen.add(key);
      queue.push([x + dx, y + dy]);
    }
  }
  if (seen.size !== total) {
    throw new Error(`${where}: the track surface is not connected `
      + `(${seen.size} of ${total} cells reachable from ${first[0]},${first[1]})`);
  }
}
