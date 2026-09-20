# Vector Rally

A grid racing game for the browser. Each car has a position and a velocity
vector. You do not steer the car — you steer its *acceleration*, one grid unit
per turn, and live with the momentum that follows.

Built as a teaching example: the rules are small enough to read in a minute,
and the interesting part — braking before a corner rather than after it — falls
out of the physics instead of being programmed in.

## Rules

- A car has a position `(x, y)` and a velocity `(vx, vy)`, both in grid cells.
- Each turn you change `vx` and `vy` by −1, 0 or +1 each: nine possible moves.
  The new position is the old position plus the new velocity.
- **The game does not show you where that lands.** Working it out is the point,
  so the nine cells are not marked and there is no preview. The pad tells you
  what the velocity becomes; the addition is yours.
- Speed is capped at −5 ≤ `vx`, `vy` ≤ 5.
- Everything along the path between the old and the new position counts: walls,
  other cars, checkpoints and the finish line. At speed 5 you cannot jump over a
  one-cell wall, and you cannot jump over the finish line either.
- Leave the track and the car is put back on the last valid cell of its path
  with its velocity reset to zero. The turn ends there. Miscounting costs you.
- Two cars may never share a cell, and a move that crosses an occupied cell is
  impossible — it is crossed out on the pad and cannot be chosen. If all nine
  are impossible the car crashes: velocity resets, the car stays put, play
  moves on.
- The lap counts when the car crosses the finish line the way the arrows on the
  track point, with every checkpoint collected in order. Crossing backwards, or
  with checkpoints missing, does nothing.

One lap. Every car starts on the finish line, side by side. 1–4 players take
turns on the same device.

The edge of the track is drawn as one continuous curve rather than a staircase
of right angles, but the game is played on the grid underneath it: a cell is on
the track when its corner falls inside the line.

## Tracks

Twelve of them, named after places rather than events: Monza, Spa, Silverstone,
Monaco, Suzuka, Interlagos, Imola, Hockenheim, Zandvoort, Hungaroring,
Spielberg and Montréal.

They are hand-drawn on a grid of sixty to ninety cells, which is nowhere near
enough to reproduce a real circuit — a hairpin comes out as a single cell. What
they reproduce is the character: Monza fast and barely interrupted, Monaco all
corners, Suzuka crossing over itself, Hockenheim two enormous straights. The
track chooser says so on the screen where you pick one.

A perfect lap, found by searching every (position, velocity) a car can be in,
takes between 35 and 68 moves depending on the track.

## Running it locally

The game loads its logic as ES modules, so opening `index.html` straight from
the filesystem will **not** work — the browser blocks `file://` module imports.
Serve the directory over HTTP instead:

```sh
python3 -m http.server 8000
# or
npx serve
```

Then open <http://localhost:8000>.

## Installing it

Vector Rally is a PWA: load it once with a network connection and it works
offline after that.

- **Android / Chrome:** menu (three dots) → "Add to Home screen" / "Install app"
- **iOS / Safari:** the share button (square with an arrow) in the toolbar →
  scroll down → "Add to Home Screen". It is not in Safari's own menu, and it is
  below the fold in the share sheet.

## Tests

No dependencies, no `package.json`, no build step. Node's built-in test runner
finds `test/*.test.js` by itself:

```sh
node --test
```

To name the directory instead, pass it as a pattern — `node --test "test/*.test.js"`.
Plain `node --test test/` is rejected by Node on Windows, which reads the
argument as a module rather than a directory.

## File structure

```
index.html              UI, canvas, all CSS and UI/rendering JS inline
engine.js               game logic, ES module, no DOM
tracks.js               tracks as editable text, plus the parser
agents.js               computer opponents
version.js              single source of the version string
sw.js                   service worker
manifest.webmanifest
icon-192.png  icon-512.png  icon-maskable-512.png  apple-touch-icon.png
favicon.ico
screenshot.png
tools/make-icons.mjs    generates the icons, run by hand
test/
  engine.test.js
  tracks.test.js
  agents.test.js
```

The game logic lives in modules so the tests can import it directly. CSS,
UI and rendering stay inline in `index.html`.

The icons are generated rather than drawn by hand, by a script with no
dependencies — it writes the PNG chunks itself using Node's `zlib`:

```sh
node tools/make-icons.mjs
```

The generated files are committed, so this only needs running when the artwork
changes.

## Deployment

Static. The repository deploys to Vercel as it is: no build, no configuration,
no dependencies. `sw.js` sits in the root so its scope covers the whole site.

## Status

Built in steps, each one its own commit:

1. Core engine, one track, local human play
2. Twelve hand-drawn tracks
3. Greedy and planning agents, then a Q-learning agent trained live in the page
4. Landing page and install instructions
5. Screenshot, measurements, final README

## License

MIT — see [LICENSE](LICENSE).
