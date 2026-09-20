# Vector Rally

A racing game for the browser, played on squared paper. Each car has a position
and a velocity vector. You do not steer the car — you steer its *acceleration*,
one unit per turn, and live with the momentum that follows.

Built as a teaching example: the rules are small enough to read in a minute,
and the interesting part — braking before a corner rather than after it — falls
out of the arithmetic instead of being programmed in.

## Rules

- A car stands on a **corner of the paper**: a point where two lines cross, not
  a square. Its position and its velocity are both pairs of whole numbers.
- Each turn you change `vx` and `vy` by −1, 0 or +1 each: nine possible moves.
  The car then travels in a straight line to position plus the new velocity.
- **The game does not show you where that lands.** Working it out is the point,
  so nothing is marked on the track and there is no preview. The pad tells you
  what the velocity becomes, and nothing else.
- Neither part of the velocity may leave −5…5.
- The whole line from where you are to where you land has to stay on the track.
  At speed 5 that line is five units long and can cut the corner out of a bend
  and back in again with both of its ends still on the track. That is leaving
  the track, and it is caught.
- Go off and the car is put back on the last whole-number point it reached,
  with its velocity set to zero. That costs you the turn. Because nobody can
  check a curved edge by eye, the game shows the exact point where the line
  crossed the edge, and the piece of edge it crossed, before moving the car.
- Cars are points. Two of them may not stand on the same point, and a move
  whose line passes exactly through another car is impossible. Passing close is
  not — with point-sized cars there is room.
- A move that is genuinely impossible — another car exactly on the line, or
  over the speed limit — is crossed out on the pad and cannot be taken.
- One lap. It counts when you cross the finish line the way the arrows point,
  having passed every hidden checkpoint in order on the way round.

Every car starts on the finish line, side by side, at a standstill. 1–4 players
take turns on the same device. Mouse and touch only: press one of the nine pad
buttons and let go to take that move.

Starting a race is two screens: how many are playing, then which track — a
carousel you swipe through, one card at a time, each with the track drawn from
its own geometry.

## The track

A track is an **area of the plane** bounded by two closed curves, not a grid of
cells. The squares on the paper are there to count in; the edge of the track
pays them no attention.

Tracks are written as a centreline with a width:

```js
centerline: [[x, y, w], [x, y, w], ...]   // a closed loop, w is the half-width
```

The loop is smoothed with a closed Catmull-Rom spline and offset by ±w to make
the two edges. One description gives the edges, the driving line the arrows
follow, and the gates across the track all at once.

Offsetting has a trap: where the centreline bends tighter than w, the inner
edge folds through itself — Monaco's hairpin is exactly there. The parser
measures the curvature everywhere and refuses a track that bends too tightly,
so a broken track fails when it is loaded rather than in the third corner.

The finish line and the checkpoints are **gates**: a straight line across the
track with a direction. One move at speed 5 can pass two of them, so the
crossings are sorted along the line and taken in order — otherwise a car could
collect the second checkpoint and skip the first.

### The six

Monza, Spa, Silverstone, Monaco, Suzuka and Interlagos — named after places
rather than events. They are drawn by hand and are nowhere near measured
reproductions of real circuits; what they reproduce is character. Monza is fast
with three chicanes to brake for, Monaco is barely three units wide with a
hairpin, Interlagos is short and runs the other way round.

**Anywhere** is not a seventh track but a generator: it draws a closed
centreline from the seed of the race and checks it with the same parser
everything else goes through, flattening the shape and trying again if it came
out too tight. Its id carries the seed, so a race on one can be replayed or
reloaded. The tests run it over 2000 seeds.

A perfect lap, found by searching every `(point, velocity, checkpoints)` a car
can be in, takes 30 to 39 moves depending on the track. A beginner runs perhaps
70% over that, so reckon on 50–65 moves each: comfortable for two or three
players in a forty-minute lesson, tight for four on the longest tracks. There
is a button to end the race early.

## The computer drivers

Two of them, and they are not easy and hard — they are two different ideas
about how to drive, and the difference is meant to be visible from the back of
the room.

**Greedy** looks one move ahead and takes whichever of the nine gets it nearest
the next checkpoint while carrying the most speed. It measures that distance in
a straight line, so it knows nothing about the shape of the track: it
accelerates towards a corner it cannot see and arrives with nowhere left to go.

**Planner** runs A* over the states a car can be in — where it is and how fast
it is going — nine successors a state, one move each, with an admissible
estimate of `ceil(distance to the gate / 5)` measured the way a car actually
moves. It plans to the gate *after* the next one, not to the next one: a car
that only plans as far as the next gate arrives at it flat out and drives off
immediately afterwards, having met its goal and thought no further. Only the
first move of the plan is taken, and the rest is worked out again next turn.

Both steer by checkpoints the players cannot see, and the interface says so.

There is a node budget, 50,000 states a move. If the planner runs out it falls
back to Greedy **and says so on the screen** — a planner that quietly drove like
the greedy one would just look like a planner that is no good.

One lap on each track, one car alone, measured on an AMD Ryzen 9 5900HX under
Node 24 — a laptop, not a phone:

| Track | Greedy | Planner | Perfect |
|---|---|---|---|
| Monza | 82 moves, 16 off | 43 moves, 0 off | 39 |
| Spa | 57, 8 | 36, 0 | 34 |
| Silverstone | 77, 15 | 37, 0 | 34 |
| Monaco | 59, 11 | 42, 0 | 39 |
| Suzuka | 48, 7 | 34, 0 | 34 |
| Interlagos | 55, 11 | 32, 0 | 30 |

The planner's worst single move looked at about 3,000 states — a sixteenth of
its budget — at roughly 150,000 states a second, so 8 to 18 ms a move. The
budget has never actually run out on these tracks; the fallback is tested by
handing the planner a budget of five. Phone numbers are still to be measured.

There is a mode on the track screen that races Greedy against Planner with
nobody playing, for showing the difference on a projector.

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

To name the directory instead, pass it as a pattern —
`node --test "test/*.test.js"`. Plain `node --test test/` is rejected by Node on
Windows, which reads the argument as a module rather than a directory.

The suite includes a breadth-first search over every state a car can be in, for
every track, which proves each lap can actually be driven and measures the
fastest one.

## File structure

```
index.html              UI, canvas, all CSS and UI/rendering JS inline
engine.js               the rules, ES module, no DOM
tracks.js               track geometry, the six tracks, and the generator
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

The rules live in modules so the tests can import them directly. CSS, UI and
rendering stay inline in `index.html`.

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
2. Twelve hand-drawn tracks (on a grid)
2b. Continuous track geometry, positions on the lattice, six tracks
2c. Player count and swipeable track selection
3a. Greedy and planning agents
3b. A Q-learning agent trained live in the page
4. Landing page and install instructions
5. Screenshot, measurements, final README

## License

MIT — see [LICENSE](LICENSE).
