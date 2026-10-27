# Studio ledger: the studio's strokes, written with one pen

Started 2026-10-25. The user: "keep things as they are but start a new ledger
that is based on the strokes from the studio". The library built so far, its
approvals, and [stroke-ledger.md](stroke-ledger.md) stay as they are. This
ledger starts again from the studio's own strokes and records how a single
qalam writes each one.

Why it was needed: the studio gives each stroke as a filled outline. It does
not give the pen's path, where the pen lifts, or how one stroke runs into the
next. The fits guessed all three, and they let the nib turn freely from node
to node to fake shapes the pen does not make. Joints such as 028's
(stroke-ledger, "Fourth pass") took several rounds of guessing.

## Sources, in order

1. **The studio's stroke outlines** (`studio-data/stamps.pack.json`, one
   `sN` per stroke). This is what the ledger recreates.
2. **The vector sheets the user supplied** (NAS, `thuluth vector sheets/`).
   The *Detailed* sheet draws every letter as separate semi-transparent
   strokes, so an overlap shows darker. That shows where each stroke ends and
   how far the next one runs into it. The sheets cover every letter's
   isolated, initial, medial and final forms, the traditional pairs, and
   twenty compositions. They are a reference only and are never named.
3. **The lesson videos the user gave** (NAS, `videos/`): pen dynamics and
   scale, the flick, and every isolated letter written once on camera.
4. **The user**, when the first three do not settle a stroke. They explain
   how to move the pen, and send further videos.
5. **Hashim's references, and searching the web** for how the pen moves.

## The pen

Most of Thuluth is written with one qalam of one size. "This should not be
this difficult." Rules from the pen-dynamics lesson:

- **One angle.** The nib is held at a fixed angle, 50–60° in Thuluth. The
  wrist does not move, and the whole edge stays on the paper. A stroke is
  thickest going up and thinnest coming down because the direction changes,
  not the angle.
- **The nuqta** is a square diamond: equal sides, turned 45°. It is the unit
  of every measurement. A small circle beside a count means half a nuqta.
- **Tolerance.** A letter may be off by about a nuqta, a nuqta and a half at
  most.

Techniques (each gets a section once it is worked out from the videos):

- **The flick.** As a final stroke ends, the short side of the nib lifts
  gradually while the hand keeps moving. By the end only the corner of the
  long side touches. The nib narrows onto **one corner**, not about its
  middle. One edge runs on unbroken and the other closes onto it. The ra's
  tail and the mim's tail are flicks. The sin's long body uses the same move in reverse: the stroke *starts* at
  the hook. The nib comes down on its corner at the hairline's tip, opens to
  full width as it climbs and curls over the top, then runs left the whole
  length of the body to the bowl (the lesson video, 4:36-4:44). In 170.s0 the
  narrow part is the first 3.3 nuqta, at one angle (81°). The ink is the
  same either way. A turning nib could not draw it (the user, 2026-10-26).
- **Angle changes.** When the pen does turn, the move is recorded as an
  exception with its reason, never as a free variable.
- **Lifts.** A new stroke starts where the pen comes back down. The vector
  sheet shows how far it overlaps the last one.
- **Under a neighbour.** A stroke's ink stops where the studio's stroke
  stops, even where the next stroke would cover it. It may run at most half
  a nib under a neighbour, for a clean joint. Hidden ink is not free: it
  shows once the stroke is joined to something else (the user, 2026-10-26).
  Before this, 32 of 204 fits ran on under a neighbour, a spur up to three
  stroke widths into its stem.
- **Turning pen.** Where one angle cannot follow a sweep, the nib turns
  smoothly through it, even past 180° through an S or a curl. "The hand
  actually turns that much" (the user, 2026-10-26).
- **Filled heads.** The alif hat, the ra and dal heads and the sin teeth
  are filled in with the nib tip or a smaller pen, not swept with the main
  nib. A sweep of the teeth needs a nib narrower than the pen's narrowest
  setting.

What this means for the fitting code (`scripts/pen`): the angle is fixed
per stroke, and changes only at a recorded technique point. A flick is a
narrowing anchored on one corner. Both run on the Geekmini's GPU.

## How an entry reads

Entries are grouped by letter, then by pen move. A move is written once, and
every studio stroke that is that move is listed under it.

- **Strokes**: the studio strokes it covers (`shape.sN`).
- **Pen**: the start, direction, angle, width and any technique point, in
  nuqta.
- **Order and joins**: what comes before it, where the pen lifts, and how far
  it runs into its neighbour (from the Detailed sheet).
- **Source**: studio outline, vector sheet, video and time, the user, Hashim
  or a web source (by description, never by name).
- **Status**: *recreated* (by me, checked against the studio), *needs a
  video*, or *needs the user* (a decision picture goes to the NAS
  decisions folder, phrased in pen terms).

## Inventory

781 studio shapes are drawn from 2,616 distinct strokes (3,310 uses):

| Group | Shapes | Distinct strokes |
|---|---:|---:|
| Ha | 71 | 286 |
| Ayn Ghayn | 63 | 248 |
| Mim | 82 | 246 |
| Sin Shin | 68 | 241 |
| Kaf | 52 | 237 |
| Jim Ha Kha | 61 | 229 |
| Ba Ta Tha | 81 | 223 |
| Lam | 75 | 214 |
| Ta Za | 41 | 201 |
| Fa Qaaf | 55 | 201 |
| Sad Dad | 42 | 177 |
| Ra Zay | 12 | 27 |
| Ya | 16 | 27 |
| Nun | 9 | 23 |
| Dal Dhal | 8 | 22 |
| Laam Alif | 5 | 22 |
| Fa | 7 | 20 |
| Alif | 16 | 19 |
| Waw | 6 | 17 |
| Qaaf | 6 | 14 |
| Reset | 4 | 5 |
| Hamza | 1 | 3 |

## Where each isolated letter is written in the letters video

Times are minutes:seconds into the individual-letters lesson.

| Letter | From | Letter | From |
|---|---|---|---|
| alif | 0:12 | fa | 6:24 |
| ba | 0:24 | qaf | 7:12 |
| jim | 0:42 | kaf | 8:24 |
| dal | 1:12 | lam | 9:18 |
| ra (and an alternative) | 1:42 | mim (and an alternative) | 9:48 |
| sin | 2:24 | nun | 11:00 |
| sad | 3:18 | ha | 11:42 |
| ta | 4:18 | waw (and an alternative) | 12:00 |
| ain | 5:06 | ya | 13:12 |
| | | hamza | 13:36 |

## Letters

(Filled in letter by letter.)

### Kaf

**The initial kaf's top bar (the long bar rising right, then a thin line back down)**

- **Strokes:** 469.s0, 470.s0.
- **Pen:** one angle the whole way: 83° in 469.s0, 87° in 470.s0. The bar rises to the right at full width,
  turns over at the top, and comes back down and to the left as a thin line.
  - In 470.s0 the thin line's end is a flick onto one corner.
  - 469.s0 ends square.
- **Source:**
  - The letters video (8:24–9:18) writes only the isolated kaf. Its top is a plain diagonal with a separate small
    head, so the video does not show this bar.
  - The studio outline. Four fits were tried on each: one angle, turning pen, and a flick with each. The turning fits
    scored up to 1.2% higher overall but stopped short of the studio's top of the bend by up to 0.16 nuqta. The
    one-angle fits miss by 0.07 nuqta (469.s0) and 0.05 nuqta (470.s0) at their worst spot.
  - The user, 2026-10-27, decision 46: close enough, keep the one-angle fit.
- **Status:** recreated. The thin line coming down is a little thicker than the studio's where it leaves the bend.

### Ya

**The long tail of Ya 4 (the flat tail running right)**

- **Strokes:** 721.s1, 732i.s1.
- **Pen:** one angle the whole way: 73.5° in 721.s1, 82.7° in 732i.s1. The nib is a little wider than the
  nominal pen (1.20 times). The stroke goes down from the neck, round the bottom bend at full width, then
  runs right along the line.
  - In 732i.s1 the right tip is a flick: it narrows onto one corner over the last 3.3 nuqta.
  - 721.s1 ends square.
- **Order and joins:** written after the head and neck. It starts under the neck's foot.
- **Source:**
  - The letters video (13:22–13:31) writes the isolated ya's tail in one stroke. The hand stays still from
    the neck's foot round the bottom bend, and the bend is round and at full width. That ya's tail curls back
    up to the left, not right as Ya 4's does, so the video settles the pen but not the path. A small roll of
    the pen between the fingers would not show at the video's size, so this rests on the holder keeping its
    direction and the bend keeping its full width.
  - The studio outline matches 96% (721.s1) and 95% (732i.s1). A turning fit matched 732i.s1 1% better, but
    only by turning the nib about 115°, which the video does not show.
- **Status:** recreated. One miss remains: the studio's bottom bend is a little rounder and fuller than either
  fit, by up to 0.2–0.3 nuqta.
