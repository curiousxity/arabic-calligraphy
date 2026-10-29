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

### Ba

**Ba Medial 4: the wing rising to the tooth, and the tooth coming down (two strokes)**

- **Strokes:** 068.s0. The studio gives it as one outline; the pen writes it as two.
- **Pen:** the outline is cut through the tooth's peak, from the top of the hollow under it to its tip.
  - The left part (the wing up to the peak): one angle, 85°.
  - The right part (the peak down the stem and round to the right): one angle, 78°.
  - The two may meet under each other by half a nib, as at any joint.
- **Source:**
  - The studio outline. As one stroke, four kinds of fit (one angle, a flick, a turning pen, and a turning pen with a
    flick) matched 87–91%. The best brought the peak out low and blunt, and the left end slanted where the studio's is
    square.
  - The user, 2026-10-27, decision 48: "I think it is 2 separate strokes try that".
  - Three cuts were tried, each at one angle and with a turning pen. The cut through the peak at one angle each matched
    96.5%, the worst spot 0.075 nuqta. A turning pen on the same cut matched 97.9% but turned only 5–8°, so one angle
    stands.
- **Status:** recreated.

**The ba teeth of Ba Initial 6 and Ba Medial 10 (one stroke each)**

- **Strokes:** 048.s0 (initial), 074.s0 (medial).
- **Pen:**
  - 048.s0: filled with the nib's tip, which gives the studio's rounded top. It matches 95%, with the worst spot
    0.05 nuqta.
  - 074.s0: a turning pen, 81–89°, which matches 96%. A nib-tip fill scored 97% but ran its top up into the next
    stroke.
- **Source:**
  - The studio outline. 048.s0 was tried at one angle, with a flick, with a turning pen with and without a flick, and
    with a turning pen at full nib. All matched 90–92%, and every one drew a sharp spike where the studio's top is
    rounded.
  - A second lesson course the user pointed to (2026-10-28): its first ba lesson draws the tooth in one touch.
  - The user, 2026-10-28: "maybe you dont have to make 2 strokes", so neither tooth is split as Ba Medial 4's is.
  - The user, 2026-10-28, on the results: "Agree. These look better."
- **Status:** recreated.

**The small flag on the ba tooth in a ba pair (041.s3), open**

- **Strokes:** 041.s3, a small pointed flag on a thin stem, sitting on top of the next stroke.
- **Pen:** not settled. A turning pen (95%) and a nib-tip fill (96%) both leave a blob of ink under the next stroke
  that the studio doesn't have.
- **Source:**
  - The studio outline.
  - The user, 2026-10-28, decision 50: "C" (check the lesson video first).
  - The second course's ba lessons: the tooth is one move from the top downward. The pen lands at the top with its
    full edge and is dragged down, so the top's point comes from the nib's corner, and the rest of the ink is the
    tooth's own body. In the studio's cut the flag is the part of that landing that shows above the next stroke.
  - The user, 2026-10-28, on the proposal: "Yes" (decision 50 A).
- **Status:** done. Filled with the nib tip, with no ink allowed under the next stroke, it matches 94.5% and stays
  inside the studio's shape (before: 95.5%, but with a blob under the next stroke). The turning pen matched 93%.

### Fa

**The head of Fa Initial 3 (the small loop)**

- **Strokes:** 402.s0.
- **Pen:** one angle the whole way, 80°, with a nib 1.26 times the nominal pen. The end narrows onto one corner
  (a flick) over its last 3.2 nuqta.
- **Source:**
  - The letters video (6:24–7:12) writes the isolated fa's head with the holder pointing the same way throughout.
  - The studio outline matches 98%, the worst spot 0.1 nuqta. A turning fit matched the same 98% only by turning
    the nib 180°, which the video does not show.
- **Status:** recreated.

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

**The kaf's top bar with a hairline hook (474.s0, 481.s0)**

- **Strokes:** 474.s0 (Kaf Initial 6), 481.s0.
- **Pen:** one angle the whole way, 85–86°. The bar rises to the right, rounds over at the top, then the pen rolls
  onto one corner and draws the hook down and to the left as a hairline. The nib narrows evenly over the last
  4 nuqta (the fitter's even-narrowing setting, GPUFIT_LIFT_SMOOTH 0.03). The fits match 97.6% (474.s0) and 96.8%
  (481.s0).
- **Source:**
  - The second lesson course's first kaf lesson, at 7:50–8:00: the bar and the hook are one stroke, and the hook is
    drawn on the nib's corner.
  - The studio outline. One angle, turning pen and flicks matched 95–96%, but the hairline narrowed in steps.
  - The user, 2026-10-28: "the pen version for the kaf looks like it is irregular". With the narrowing held even:
    "Agree. These look better."
- **Status:** recreated.

### Lam

**The bowl of Lam Final 3 (the long sweep from the stem down to a point on the left)**

- **Strokes:** 551.s2.
- **Pen:** a turning pen, from 10° to 243°. One of the exceptions: the nib turns much more than the path bends.
- **Source:**
  - The letters video (9:18–9:48) writes the isolated lam's bowl in one stroke with the holder steady. That bowl
    curls up at its left end; this one runs out flat to a sharp point, so the video does not settle it.
  - The studio outline. One angle matched 93%, and one angle with a flick 95%: at one angle the nib narrows only to
    about half its width, so the left point comes out blunt by 0.2 nuqta. The turning fit matches 99%, the worst
    spot 0.05 nuqta.
  - The user, 2026-10-27, decision 47: "Yes turning pen".
- **Status:** recreated.

### Nun

**The bowl of Nun Final 3**

- **Strokes:** 633.s2.
- **Pen:** one angle the whole way, 89°, with a nib 1.09 times the nominal pen. Both ends narrow onto one corner,
  one almost to a point and the other a little.
- **Source:**
  - The letters video (11:00–11:42) writes the isolated nun's bowl in one stroke. The holder stays steady and the
    left end thins to a point.
  - The studio outline matches 98%. The left tip stops 0.1 nuqta short of the studio's. A turning fit matched
    98.4% only by turning the nib 253°.
- **Status:** recreated.

### Sin

**The sin's middle tooth rising to a sharp peak and dropping into the hollow (195.s2), open**

- **Strokes:** 195.s2, shared by 195, 206, 217 and 227.
- **Pen:** not settled. Every fit rounds off the sharp peak. Best: turning pen 91%; one angle 76%; one angle with a
  flick 90%; turning 77%.
- **Source:**
  - The studio outline.
  - The user, 2026-10-28, decision 49: "C" (check the sin lessons first).
  - The second course's ba and sin lessons. A medial tooth starts from the sharp stop at the top of the stroke
    before it, then curves straight down. The tall tooth goes up, stops, then comes back down in a separate
    straight move that does not run back along the up-curve. A sin's second tooth curves up first, then down, a
    crest. So the pen stops at the peak and starts again, as at Ba Medial 4's peak.
  - The user, 2026-10-28, on the proposal: "Yes" (decision 49 A).
- **Tried:** three cuts from the notch under the peak were tried, each at one angle and with
  a turning pen. With the turning pen, the cut straight up matched 94% and the cut across the down-stroke 92%,
  against 91% as one stroke. The worst miss fell from 0.31 to 0.19 nuqta, and the peak comes out sharp. But both
  show a step where the two parts meet. The cut to the tip and the one-angle fits did worse (86-91%).
  - The user, 2026-10-28, decision 51: "keep one stroke and look at the videos to see if they make it".
  - The second course's sin lesson, written at speed: the pen goes up to the peak and leaves the paper there to
    take ink, then lands on the peak again and sweeps down-left into the bowl. So the lesson lifts at the peak,
    but that lift is also an ink dip, and the move after it is the bowl itself rather than a sweep onto a bowl.
    It does not show the wave written in one move.
  - Four more lessons the user sent, 2026-10-28. A double-pencil lesson draws each cup of the teeth as its own
    stroke, ending in a point at the peak, and sets the pencils down on that point for the next stroke; the
    finished peaks show the two strokes' lines crossing. A lesson with a numbered chart splits the sin the same way:
    a cup rising to a point, then a wave at a lower pen angle that "starts from top, where the 2nd stroke ends".
    The first course's sin lessons say it too ("you can stop here and from here you're gonna add a similar move").
    One short lesson carries the pen through the peak in one move, turning it.
  - The user, 2026-10-28, on making the split the main way: "ok".
- **Status:** two strokes, cut straight up from the notch under the peak, each with a turning pen and no ink
  outside the studio shape (97%; the left half 99%, the right 96%). Keeping the ink inside the studio shape
  fixed what the first split got wrong: a nick off the peak's right shoulder, a spur on its right edge, and a
  gap in the inner bend. A nib that may lift over 2 nuqta helped less (95%). That left the joint itself: a
  hairline slit along the cut and a small wedge at the top of the peak, where the halves meet. The user: "we are
  going to have to fill in the gaps though". So the joint is filled with the nib tip, as the filled heads are:
  after the two halves, whatever of the studio's ink is still bare within a nib of the cut gets its own free fill
  (two fills here). With the joint filled: 98%, worst miss 0.17 nuqta (from 0.22). A needle a pixel wide still
  pokes above the peak. The one-stroke turning fit (91%) is kept as the other way to write it.
- **Joint fill, for every split stroke:** the halves are written, then the pen goes back over the meeting with its
  tip. A sin lesson shows the same touch-up over the peak after the stroke is written.
- **Two more peaks written the same way (2026-10-28):** 069.s0 and 224.s2 have the same pointed peak, and every
  one-stroke pen (one angle, turning, flick) rounded it off. Each is cut from the notch under the peak up through
  its tip, the halves written with a turning nib and no overlap, then the joint filled with the nib tip.

  | stroke | one stroke (best) | two strokes, joint filled | worst miss (nuqta) |
  |---|---|---|---|
  | 069.s0 | 90% | 98.5% | 0.12 |
  | 224.s2 | 93% | 97% | 0.23 |
- **And one more (2026-10-29):** 189.s2's peak, rounded off by every one-stroke pen, cut the same way.

  | stroke | one stroke (best) | two strokes, joint filled |
  |---|---|---|
  | 189.s2 | 93% | 98.4% |
- **Decision 53 (the upturned hook at the start of a long tail, 2026-10-29):** every one-stroke pen clipped the
  hook's tip and left its round belly short of the studio edge. Cut off about half a nuqta from the tip (5% of the
  stroke) and filled with the nib tip, as the alif hat and the ra heads are, the hook comes back; the body is a
  turning pen, and the joint fill closes the seam. The user: "Yes to both", then, of the slivers left just past
  the joint where the body starts short of the studio edge: "The notch is the bigger problem. If that notch is not
  appropriately filled, I would rather go with the smoother first option." So the hook is its own piece only where
  no notch shows; otherwise the one-stroke fit stands. Two more tries at the notch are running: the body
  allowed to start half a nib under the hook, and the joint fill looking three nibs out from the cut.

  | stroke | one stroke (best) | hook as its own piece | notch |
  |---|---|---|---|
  | 195.s3 | 96% | 98.1% | slivers: one stroke stands |
  | 259g.s0 | 97% | 98.0% | slivers: one stroke stands |
  | 116g.s0 | 96.7% | 99.3% | none: adopted |
  | 301g.s0 | | 98.0% | slivers: one stroke stands |

  (116g.s0 and 301g.s0 needed the cut moved right, to x 17 and 18, before the hook piece was big enough to fit.)
- **Decision 52 (210.s1, a small head, 2026-10-28):** no pen got its top-right corner square: one angle 92%,
  turning, both flicks, and the nib-tip fill (91%, which notched the left side). The user: "go with A. The top right
  corner square is part of the other stroke." So the one-angle fit stays, and the corner is left to the neighbouring
  stroke.

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
