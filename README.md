# Vector Rally

![Vector Rally](screenshot.png)

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
- **Nothing is marked on the track.** Adding the velocity to the position is the
  whole exercise, and it cannot be the exercise if the answers are drawn on the
  screen to pick between. There is a switch on the race screen for showing the
  nine while the game is being explained, off unless somebody turns it on.
- Neither part of the velocity may leave −7…7.
- The whole line from where you are to where you land has to stay on the track.
  At speed 7 that line is seven units long and can cut the corner out of a bend
  and back in again with both of its ends still on the track. That is leaving
  the track, and it is caught.
- **Go off and the car spins.** It is not put back on the track: it comes to
  rest just outside it, where it crossed the edge, at a standstill, and turns a
  full circle — a quarter each turn — so it misses its next four turns. After
  that it may only drive back on or stand still. Because nobody can check a
  curved edge by eye, the game shows the exact point where the line crossed and
  the piece of edge it crossed before moving the car.
- The spin is there because without it the cheapest way round could be to not
  brake at all. Leaving the track used to cost two turns and all the speed, and
  at top speed that can be less than braking for the corner costs. Four turns
  more makes braking pay, which is the thing the game is here to teach.
  `SPIN_TURNS` in `engine.js` is the number to change.
- **Standing still is always allowed from a standstill**, on the track or off
  it. That one line is what keeps a race from ever locking up: a crash always
  leaves a car stopped, and a stopped car can always stay stopped, so there is
  always a move next turn. The proof is written beside the crash rule in
  `engine.js`, because the rule that a car off the track may only drive back on
  quietly broke it once already. A spinning car is simply passed over, and
  every time it is its count goes down, so the turn always reaches someone.
- Cars are points. Two of them may not stand on the same point, and a move
  whose line passes exactly through another car is impossible. Passing close is
  not — with point-sized cars there is room.
- One lap. It counts when you cross the finish line the way the arrows point,
  having passed every hidden checkpoint in order on the way round. The result
  is the number of turns it took, missed turns included.

Every car starts on the finish line, side by side, at a standstill. 1–4 players
take turns on the same device — there are no computer drivers. Mouse and touch
only: work out the crossing you are going to and tap it. While you hold it, it is
ringed, with the speed that move would leave you with; let go to go there. There
is no undo: a move, once made, is made.

Each car is drawn as a small car in its own colour, with its number on the roof
so the colours are not the only way to tell them apart, pointing the way it last
moved. A spinning car is turned a quarter further each turn it misses, with the
turns it still has to miss above it.

**There is no snapping to the nearest possible move.** Snapping would quietly
correct a miscalculation into a legal move the player never meant, and the one
sum the game exists to teach would be done for them without their noticing. Press
the wrong crossing and nothing happens, and the game says which kind of wrong it
was: *Not reachable from your velocity* means the sum was wrong, *Occupied* or
*Speed limit* means the sum was right and the rules say no. The radius a press
has to land within stays half a unit however far out you go, because widening it
would put the snapping back in by the back door.

### On the race screen

At the top: *← Home*, whose turn it is, and the speed — nothing else, so the
position has to be read off the paper. At the bottom, *Show the nine*: a switch
that stays pressed in, with a tick, while it is on, and says in the banner when
it changes.

The board never zooms or pans by itself; only the player moves it.

- **Drag** to pan, with the mouse or one finger. A press that moves more than 8
  pixels is a drag and chooses nothing when it lets go, so panning cannot
  make a move by accident.
- **Zoom** with the scroll wheel (around the mouse pointer), a two-finger pinch
  (around the middle of the fingers), or the **+** and **−** buttons. The
  target button — the one maps use for *where am I* — goes back to the
  starting view on the car whose turn it is. On a keyboard, `+`, `-` and `0`
  do the same.
- Zoom runs from 8 to 96 pixels to the unit. A race opens at 48, where a
  crossing is a thumb across. Below 44 the board is a map: taps stop choosing
  moves and it says *Zoom in to move*.

## The screens

There are two, and only ever one on the screen at a time.

**The start page** reads from the top down in the order things are decided:
what the game is (the title and a picture of a car braking for a corner),
**1** who is playing, **2** which track, then *Start race*, and *How it works*
folded away at the bottom. On a wide screen the picture sits beside the title
and the two steps sit side by side, but the order is the same.

The tracks are a grid, three to a row, each drawn small from its own geometry
with its record underneath. Anywhere sits across the bottom.

**The race** has the whole screen to itself. Starting one is pushed onto the
browser's history, so a phone's back button goes back to the start page rather
than out of the game.

The two are sections of one page, switched by a class, rather than two pages:
the race needs the setup (names, the chosen track, the seed Anywhere drew) and
nothing has to be passed between pages to get it.

The picture on the start page is a real run on Silverstone, recorded once and
written into `index.html` as a list of points. The search that found it was
told to keep a whole unit clear of the edge, so the car — drawn a little larger
than it is, so it can be seen on a phone — is never over the line. The dots
spread out where it is quick and bunch up where it has braked. It holds still
for anyone who has asked their machine to stop animating things.

## Records

The fewest turns anyone has taken round each of the six tracks is kept on the
device, in `localStorage`, with the name of whoever did it. It is shown on the
track's card and after the race. Anywhere keeps none: there is never the same
track twice. Where the browser refuses storage — a private window, say — there
are simply no records.

## The track

A track is an **area of the plane** bounded by two closed curves, not a grid of
cells. The squares on the paper are there to count in; the edge of the track
pays them no attention.

The six are written as the corners of a closed loop:

```js
corners: [[x, y, r, w], [x, y, r, w], ...]   // r rounds the corner off, w is the half-width
```

Each corner is rounded with an arc of radius `r`, the straights between them
stay straight, and that makes a centreline. A handful of corners is enough to
give a track its own shape, and anyone can read one off the paper and change
it. If two corners are too close together for their radii, the track is
refused.

The centreline — which is what Anywhere writes directly — is smoothed with a
closed Catmull-Rom spline and offset by ±w to make the two edges. One
description gives the edges, the driving line the arrows follow, and the gates
across the track all at once.

Offsetting has a trap: where the centreline bends tighter than w, the inner
edge folds through itself. The parser measures the curvature everywhere and
refuses a track that bends too tightly, so a broken track fails when it is
loaded rather than in the third corner.

The finish line and the checkpoints are **gates**: a straight line across the
track with a direction. One move at speed 7 can pass two of them, so the
crossings are sorted along the line and taken in order — otherwise a car could
collect the second checkpoint and skip the first.

### The six

Monza, Spa, Silverstone, Monaco, Suzuka and Interlagos — named after places
rather than events, and each with a shape of its own rather than a copy of the
real circuit: Monza is long with a dip in the top straight, Spa a sweeping
wedge, Silverstone makes a detour down into the middle, Monaco is narrow and
folds back on itself through a hairpin, Suzuka is pinched in from both sides,
and Interlagos is an L run the other way round.

**Anywhere** is not a seventh track but a generator: it draws a closed
centreline from the seed of the race and checks it with the same parser
everything else goes through, flattening the shape and trying again if it came
out too tight. Its id carries the seed, so a race on one can be reloaded. The
tests run it over 2000 seeds.

A perfect lap, found by searching every `(point, velocity, checkpoints)` a car
can be in, takes from 32 moves (Spa) to 44 (Monaco and Suzuka). A beginner runs
perhaps 70% over that, so reckon on 55–75 turns each: comfortable for two or
three players in a forty-minute lesson, tight for four on the longest tracks.

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
version.js              single source of the version string
sw.js                   removes the service worker earlier versions installed
favicon.ico
screenshot.png
tools/make-icons.mjs    generates the favicon, run by hand
test/
  engine.test.js
  tracks.test.js
```

The rules live in modules so the tests can import them directly. CSS, UI and
rendering stay inline in `index.html`.

The favicon is generated rather than drawn by hand, by a script with no
dependencies — it writes the PNG chunks itself using Node's `zlib`:

```sh
node tools/make-icons.mjs
```

The generated file is committed, so this only needs running when the artwork
changes.

## Deployment

Static. The repository deploys to Vercel as it is: no build, no configuration,
no dependencies.

## Status

Built in steps, one commit each:

1. Core engine, one track, local human play
2. Twelve hand-drawn tracks, on a grid
2b. Continuous track geometry, positions on the lattice, six tracks
2c. Player count and swipeable track selection
3a. Greedy and planning agents
3b. A Q-learning agent trained live in the page
4. Landing page and install instructions
5. Screenshot, measurements, final README
6. Hot seat only: computer drivers, the Learner and the install/offline
   support removed; the start page, track picker and race as separate views;
   pan and zoom by hand only; cars instead of symbols
7. One start page in the order things are decided, tracks in a grid with
   records, six tracks of distinct shapes written as corners, top speed 7, a
   spin for leaving the track, no undo

## License

MIT — see [LICENSE](LICENSE).
