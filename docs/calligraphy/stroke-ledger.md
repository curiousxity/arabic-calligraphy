# Stroke ledger: what we have learned about writing Thuluth with the pen

This file records how each stroke is drawn once a way of drawing it has been
found that works, and the rules for measuring, spacing and joining that
apply to every letter. Each new letter starts from what is written here and
adds to it. It records method and measurements; it is not an approval
record. Each form's verdict lives in `scripts/pen/REVIEW.md`, and the
user's word there decides. The references are research material only: the
app credits no calligrapher.

**How the letters are taught:** [thuluth-course.md](thuluth-course.md) has
the steps of a 34-lesson Thuluth course on video, letter by letter. It
covers stroke order, nib angles, lifts and measurements, plus composing.
Read a letter's lesson before fitting it. Notes from the single videos the
user sent outside the course (meem, ya, a vector sheet's tour) are in
[video-notes.md](video-notes.md).

**What it is for.** These drawn letters are for the stacked compositions
(tarkib) only. Plain text keeps using the fonts, which already render
Thuluth well. Drawing letters stroke by stroke is what separates
calligraphy from a font, and it is only worth its cost where a font can't
follow. More composition types may be added later. Every letter form and
every join gets worked out this way once, until this ledger covers them
all.

Coordinates are in **library nuqta**, y down, with 0 on the line (the
alif's foot). Sizes are given to 0.1 nuqta or finer. A nuqta is only a rough
measure; the real unit is the pen.

## Units and the pen

- **The pen is the unit.** Every reference is drawn with its own pen width.
  The book's plates range from 23 to 29 px at a nominal 43 px nuqta. Measure
  each one's pen (`scripts/pen/fit.py --fit-pen`, or from a vector
  reference's dots), and convert at 1 library nuqta = 1.65 of that pen.
  Assuming one pen width for all plates made letters 7–13% too big or too
  small (rejected 2026-10-19).
- **Nib:** the edge sits at about 145–149° (sloping down to the right). The
  studio's dots give 149°, the book's 147°.
- **A dot** is the nib pulled a little more than its own width. The
  studio's: the nib (1.00 pen) at 149°, pulled 1.06 pens at 64°, nearly a
  square. The book's: 147°, 1.08 pens at 70°, which measures 1.65 pens on
  its long diagonal. The library draws the studio's dot. The dot's shape
  matters to spacing: the book's dot reached 0.025 nuqta nearer the meem's
  tail than the studio's and cost أيمن its tuck (see Spacing).
- **Scale to 0.1 nuqta, not whole nuqtas.** "Two nuqta wide" style
  measurements are rough. Size from the reference's ink, in pens.

## How to draw a stroke (the method that works)

0. **Build a letter from pieces, the way the reference does.** Before
   drawing anything, split the reference into its pieces (each closed
   outline in the studio's SVG is one) and colour them to see how they
   overlap. A letter is several overlapping pen pieces, each with its own
   nib angle, and the later piece hides the seam. One continuous stroke has
   only one nib angle at each point, so it can't reproduce two pieces that
   meet at different angles (see the first trap below). Draw one path per
   piece; a letter's entry and exit may be on different pieces.

   **Check the writing order before splitting.** The Turkish Ministry of
   Education Thuluth textbook (`hat10.pdf`, PDF pages 76–94, the
   "YAZILIŞI" panel on each letter's page) numbers each letter's pen
   strokes, draws their direction with arrows, and shows the letter pulled
   apart into its pieces. It covers alif, ba, jim, dal, ra, sin, sad, ta,
   ayn, fa, qaf, kaf, lam, mim, nun, waw, ha, lam-alif and ya. The numbered
   pieces are for the standalone letters; the joined forms on those pages
   are photos with no numbers. The 120 photos of letters being written
   (PDF pages 99–118) are too small, at 260 px, to show where the pen
   lifts. The scanned books in the same folder give dot measurements only,
   with no writing order. Example: the jim is (1) a short tick at the
   head's left end, (2) the top bar pushed left to right from that tick,
   (3) a new stroke from the bar's right end curving down to the left,
   (4) the bowl and tail. So the head's left end is a separate piece, not
   the bar turning a corner.
1. **Prefer a vector reference.** Raster plates are a fallback. Usable vector
   sources: the user's studio (its SVG paths, read from the page) and the
   Turkish Ministry of Education Thuluth book (`hat10.pdf`, letters stored
   as vector drawings, rendered at 400 dpi).
2. **Read each band directly.** A swept stroke's outline is two long sides
   joined by two short caps. Pair each point on one side with the nearest
   point on the other: the midpoint is the centre line, the gap is the width
   `w`.
3. **Work out the nib angle from the width.** `θ = φ ± asin(w / pen)`, where
   `φ` is the direction of travel. Keep to the branch that continues from
   the previous point, and unwrap by 180°, since a nib at θ and at θ + 180°
   is the same nib. A 180° jump in the stored angle would spin the nib
   through the stroke.
4. **Smooth, then place few nodes.** `scripts/pen/ribbon.py`'s
   `smooth_path` smooths the centre line and the unwrapped nib angle along
   the band, then puts nodes about 0.9 nuqta apart by arc length (0.5–0.6
   round tight curves such as a meem's head). Nodes every 0.4 nuqta taken
   straight from samples made the nun's bowl irregular (rejected 2026-10-19:
   "the noon stroke is too irregular … all of their strokes are just
   smoother"). `scripts/pen/build.py` makes Catmull-Rom cubics through the
   nodes.
5. **Fit each piece to its reference piece, then check it.**
   `scripts/pen/pieces.py` scores a path against the reference piece it
   copies: the overlap (intersection over union) and the gap between the
   two outlines, in nuqta. Its `refine` moves the nodes and turns the nib
   until the overlap is highest and the outlines closest, with a penalty on
   wiggles (changes of bend, not bend itself) and on folds. `fit_pull` fits
   a stamp or wedge. A piece is done at an overlap of about 0.95 or better,
   with 95% of its outline within 0.03 nuqta. Where a node is shared with
   another letter, or another piece already covers the ink, hold those
   nodes fixed and pass the other piece as `others`.

   Then **check at three times the size** against the reference before
   showing anyone: draw each piece over its reference piece in two colours.
   Any notch, spike, step or kink is a defect.
6. **Raster plates:** `fit.py` moves nodes and turns the nib to match the
   ink. Start its angles from the measured widths (step 3). Its search
   cannot jump between the two angle branches by itself.

7. **Stamps are pulls, not bands.** An alif's diamond head, a ya's head
   and its hat are the nib set down and pulled a short way. Read the
   diamond's four corners: one pair of sides is the nib (its angle), the
   other is the pull. Draw a two-node pull at that angle, from the middle of
   one nib side to the middle of the other. Reading a stamp as a band gives
   spikes.

   A **wedge** (a flag, a hat) is a triangle: a nib side and a point. Draw
   it as a pull from the middle of the nib side to the point, with the
   width falling from the nib side's length to nothing. With a fixed angle,
   the nib's two ends then run straight to the point, so the sweep is that
   exact triangle.

### Traps found the hard way

- **Reading a crescent by nearest points.** Where one side of a band is
  much longer than the other (the meem's arch over its head), pairing each
  point with the nearest on the other side gives a centre line well inside
  the curve and the wrong widths: the arch overlapped its reference by only
  0.62. Fit the piece instead (method step 5); it reached 0.96.
- **A short band read as tapering when it has two square ends.** The
  meem's bottom band is a full pen wide at both ends, with the nib at 104°
  and 80°. Nearest-point reading took it for a taper, and the fit stuck on
  a hair at the right. Read the caps off the corners and start the fit from
  them.
- **Overlap can't see a hairline.** A hair is too thin to register in the
  overlap score, so a fit let the alif's foot run 0.08 nuqta below the line
  and left a hair past the arch's point. The outline-gap term catches the
  second. For the first, check where every end lands: the nib's end
  reaches width × pen / 2 past the last node.
- **A fit can hide a fold under ink already drawn.** Refitting the ya's
  descent with the loop and the head counted as ink, the first node slid
  down under them and the stroke doubled back unseen; the seam then turned
  13°. Hold hidden ends fixed. `refine` now penalises any chord that turns
  back more than 90°.
- **Chaining a letter's pieces into one stroke.** Where two reference
  pieces meet with different nib angles, a single stroke has to swing its
  angle from one to the other. On the way it passes through the direction
  of travel, the nib edge points along its own path, and the ink pinches to
  a hair. Measured on the fifth draft (rejected 2026-10-19):
  - the meem's loop closing at its left: 0.32 pen against the reference's
    arch 0.93 and bottom band 0.87;
  - the meem's lower right corner went the other way, turned at full width
    (0.98 pen) where the reference's two tapers meet at 0.12 and 0.40. It
    came out pointed and ate half the counter;
  - the nun's arm into its bowl: 0.08 pen (nib 60°, travel 64°) against
    the reference's thin arm end (0.26) tucked under the bowl's thick
    start (0.63).

  Long single pieces (the alif's stem, the meem's tail, the nun's bowl)
  matched to 0.01–0.05 pen as one stroke. The defects were all at the
  meeting points.
- **Stamps placed by their own centre.** A flag or hat hangs off its head:
  it shares one of the head's corners and carries on along the head's edge.
  Placed as a free pull, it floats off the head (the ya's hat stood 0.1
  nuqta proud of the head's corner) or crosses the stem's edge at a shallow
  angle and leaves a sliver of paper (the alif's flag). Read the stamp's
  corners from the reference and build the pull from them (method step 7).
- **One nib angle for everything** turns every rising or baseline stroke into
  a hairline (the first drafts, "looks like a kid drew it").
- **Two nodes almost on top of each other** make a notch on the outside of a
  turn and a crease inside it (the standalone meem's tail).
- **A stroke going straight down with the nib upright** is a hairline. A
  full drop needs the nib turned flatter (about 150–160°).
- **A pointed end** needs the nib along the direction of travel at the tip.
  A flat nib there leaves a square cut.
- **Thin parts:** lift the nib gradually (width share) on the side away from
  the outer edge, or the outer edge steps.
- **A band's own sharp end above a stamp** reads as a spike. Start the band
  inside the stamp (the ya's descent begins inside its head's diamond).
- **The studio's bands keep nearly full breadth round their curves.** So
  the nib turns with the stroke through a bowl or a long tail (as much as
  180–280° over a nun's bowl or a meem). That is the studio's look, and the
  user chose it.
- **A rounded start the fitter can't reach.** The ha's head in الحب starts
  where the lam's foot does, and a nib's start is a straight edge, so the
  corner came out square where the studio's curves (the user: "this is
  bothering me"). Closer nodes and a heavier outline weight barely moved it:
  the curve needs the nib to start at another slant, or partly lifted, and
  turn at once, which is too far from the fit for its small steps. A search
  over the start finds it: for each stroke, the first node at nib angles
  40–100° and widths 1, 0.75 and 0.5 (a lifted corner), one node 0.06 nuqta
  in, the first five nodes refined and the rest held, each judged only on
  the ink within 0.35 nuqta of the corner. Both strokes starting at 80° and
  half width halved the difference (0.0051 → 0.0025 square nuqta; the
  outlines at most 0.030 → 0.015 nuqta apart).
- **A stroke split between two letters** keeps its tangent at the split
  (`dir` on both nodes). Split above any place where the stroke crosses
  itself, or the crossing reads as a corner at the join.

## Spacing (studio reference, أم أيمن)

- Each letter group sits as far right as it can while keeping clear of
  **all** the ink written before it, measured in any direction (not side by
  side), by **0.85 nuqta, inside a word or between words alike**. Measured
  once our letters matched the studio's outlines: the meem 0.89 from its
  alif, أيمن's alif 0.86 from أم's meem, يمن 0.87 from its alif and 0.87
  (its ي's dots) from أم's meem tail. An earlier 0.85 / 0.9 split was read
  off our own rougher letters.
- **Dots keep 0.55 nuqta**, wherever a dot is one of the two (`DOT_GAP`).
  In the studio's حياتي the ت's dots sit 0.56 from the alif before them,
  while the ت's body keeps 0.88. With dots held to 0.85 like bodies, تي
  stood 0.3 nuqta too far left, pushed away by its own dots. Measured on الحب حياتي, which is also in
  the layout test.
- A word may tuck in over another's tail or under its head. The studio's
  يمن sits under the meem of أم, its ي dots under the tail.
- **The tuck is fragile.** If a group can't keep its clearance in the
  tuck, the next clear place is past the whole tail: يمن jumped 4.8 nuqta
  left when its dots came 0.025 too near the tail. Shapes at the points of
  closest approach (feet, dots, tips) must match to a few hundredths. Check
  each group's place against the reference after any change to a letter
  (the layout test does this for أم أيمن).

## Letters

The five forms of أم أيمن below were approved by the user on 2026-10-19
("Very nice. Yes. Im happy"), along with the dot and the spacing. They are
the worked example for every letter after them.

Each letter is listed as its pieces, in the order the pen draws them, with
how closely each matches its studio piece (overlap; outline gap for 95% of
its length). Coordinates are in each letter's own frame: x from the
letter's right edge, y from the line.

### Alif (ا), standalone (studio, adopted 2026-10-19)

- **Height:** 7.87 nuqta, from the head's top to a hairline foot on the line.
- **Stem:** from inside the head, slightly bowed, 0.3–0.35 nuqta wide; the
  nib turns from 121° through 132° down to 91° at the foot, narrowing it.
  The last node is at (−0.283, −0.045) with the nib lifted to 0.15, so the
  hair ends exactly on the line (0.95; 0.04).
- **Head:** a diamond pull, the nib at 57.9°, from (−0.91, −7.57) to
  (−0.61, −6.75) (0.90; 0.04). Read off the corners, the nib side seemed
  to be 71.6°; the fit settles at 57.9° because the diamond has a fifth,
  short side that the corner reading counted as the nib's.
- **Flag:** a wedge hanging off the head's edge: the nib at 69.5°, 0.62
  wide at (−0.54, −6.95), pulled to a point at (−0.24, −6.29) (0.91; 0.02).
- **The book's alif** (plate 9: one stroke, head flicked up on the nib's
  edge) is heavier, and its foot keeps the next word further away.
- **No hamza over the alif in Thuluth.** The hamza of أ/إ is left out (the
  user's ruling).

### Meem (م), standalone (studio, adopted 2026-10-19: "use the alternate version of the meem")

Three pieces, all from one point at the head's left (about (−1.4, −1.87)):

- **Arch:** over the top of the head to a point at its lower right
  (−0.05, −1.29). It starts as a flat cap, the nib at 60°, and turns
  through 0° to −100° (that is, 80°) by the right side, so the arch thins
  to a hair at the point (0.96; 0.02).
- **Bottom band:** under the head, a short pull with square, full-width
  ends: the nib from 76° to 80° (0.97; 0.02).
- **Tail:** a long taper down and to the left, to (−9.5, 2.6), ending in a
  hair. The nib holds 77–80° for most of its length, then turns to 20° at
  the end (0.98; 0.01). No rising hook. Words after it tuck in over it.
- The head's counter is the space the arch and the bottom band leave
  between them. Its bottom is 1.07 nuqta above the line, its top 2.86
  above, and it is 1.6 nuqta wide.
- **The book's form** (plate 24, the tail rising again as a hairline) was
  set aside.
- **How the pen writes it** (a lesson video the user pointed to,
  2026-10-23): three strokes with the pen lifted between them, as the
  studio's pieces are.
  1. The arch begins at the head's left with a short climb up and to the
     right, goes over the top and comes down the right side. The right
     side goes down to the head's bottom right at full width, ending in a
     flat cut.
  2. The bottom band starts under that cut and runs right to left,
     closing the counter.
  3. The tail is a new stroke from the head's lower left.

  The straight-tailed meem (553b) is the same: arch from the left, then
  the left side down across the bar, then the bar from the right running
  on down into the tail in one stroke. Writing the head and the bar as one
  stroke (`merge.py`) was wrong for both.

### Ya (ي), starting, stacked on a meem

- **Head:** a diamond pull, the nib at 69.7°, from (−0.41, −2.92) to
  (−0.09, −2.43) (0.89; 0.03).
- **Hat:** a wedge hanging off the head's edge: the nib at 77.4°, 0.85
  wide at (−0.16, −2.70), pulled to a point at (0.18, −2.48) (0.94; 0.02;
  the user: "their ya stroke has a hat").
- **Descent:** from inside the head, (−0.26, −2.78), down to (−0.14,
  −2.05), the nib turning from 112° to 136°. There it hands over to the
  meem's loop, above where the stroke later crosses itself, keeping its
  direction (a shared node with a set tangent).
- **Dots:** two side by side under the meem's loop, 3.3–3.5 nuqta below the
  line, 0.9 apart, the left one a little lower.

### Meem (م), middle, under a stacked tooth

Two pieces. The pen comes in by the first and leaves by the second (the
part's `exit`).

- **Loop:** continues the ي's descent down the loop's left side, round the
  bottom (lowest about 0.3 above the line) and up the right side to a hair
  at (1.48, −0.85). The nib turns steadily from 136° to 262° (0.90 with the
  descent; the counter's lower edge within a hair of the studio's).
- **Exit:** a band of its own, starting inside the loop at its right side
  (1.29, −0.89), over the top and out to the left, to (−1.78, −0.36). The
  nib turns quickly to 238° inside the loop, where the loop hides it, then
  holds 260° (0.98; 0.02).

### Nun (ن), finishing, after a middle meem

Three pieces, after the pen lifts at the meem's exit (a `lift` join):

- **Arm:** a leaf, thin at both ends, from its beak at (−2.29, −1.00) down
  to (−2.09, 0.60), the nib turning from 121° to 149° and back to 92°
  (0.96; 0.01).
- **Bowl:** starts thick, tucked under the arm's thin foot at (−2.12,
  0.95), sweeps down-left to 2.6 below the line and rises to a thin tip at
  (−6.83, −0.58), the nib holding 72–81° along the bottom and turning to
  −124° (56°) at the tip (0.98; 0.01).
- **Knot:** where the meem's exit comes in at the arm, the nib held at 80°
  and pulled a short way along a slight curve, from (−1.74, −0.35) to
  (−2.28, −0.58), covering the seam (0.97; 0.01).
- **Dot:** above the left part of the bowl, 0.3 above the line. The Ministry
  book's rule is that the dot sits near the arm. The studio's sits over the
  bowl, and its placement is the one used here.

### الحب حياتي (studio, matched 2026-10-19)

Nine forms, matched to the studio's own line of أم أيمن الحب حياتي and
recorded under the user's standing instruction (matched within reason:
overlap 0.92 for the phrase against 0.90 for the approved أم أيمن; awaiting
the user's look). The user then named two joins that did not work, ya into
alif in حياتي and ta into ya. Refitted at their joins (see Joins), the phrase
overlaps the studio by **0.956**, side by side in
`comparisons/alhubb-hayati.png`.
Coordinates here are in each **letter group's** frame (x from the group's
right-most ink, y from the line), as the library stores them. Every join
inside these words is a lift: the next letter's first piece starts where
the last one's exit ends, within 0.2 nuqta.

**Studio facts found on the way:**
- The studio draws a join twice: each joined letter carries the pieces it
  shares with its neighbour, without a letter index (`data-l`) on the copy.
  Count each piece once.
- The studio writes the final ي of حياتي **without dots** (the ت above it
  has its own).
- **The curved alif joins a lam.** The alif that begins الحب is written as
  one sweep from below the line up into the lam's top, and the two are one
  letter group. The user: "this particular variant of alif can join to the
  next letter if the next letter is a lam." The layout does this only for a
  word's opening alif directly before a lam, and only where the library has
  that alif's joining form.
- **Dots may come closer than bodies.** تي's dots sit 0.56 nuqta from the
  alif before them while its body keeps 0.88; see Spacing.
- **The studio's alif heads differ between compositions.** In its line of
  all four words the two alifs of أم أيمن have their heads drawn lower than
  in its أم أيمن alone (against the line, ours score 0.85 instead of 0.90).
  The approved form follows the أم أيمن capture.

#### Alif (ا), joining a lam (الحب)

- **Sweep:** one band of 13 nodes from below the line, (−1.80, 2.35), up
  and over to the lam's top at (−3.41, −6.54). The nib turns the whole way,
  from −124° through 0° to 70° (0.95; 0.06).

#### Lam (ل), starting (الحب)

- **Stem:** down from its top, (−3.21, −6.46) to (−2.92, −2.75), the nib
  from 61° to 80° (0.98; 0.01).
- **Foot:** a band of its own out to the left, (−2.89, −2.79) to (−5.05,
  −2.01), the nib held at 80–82°. The pen leaves by it (0.99; 0.01).

#### Ha (ح), middle (الحب)

- **Head:** written left to right from the lam's foot, (−5.04, −2.06) to
  (−0.29, −1.84), the nib easing from 81° to 68° (0.98; 0.02).
- **Down:** back down to the left into the ب, to (−4.45, −0.32), the nib
  from 66° to 81°. The pen leaves by it (0.97; 0.03).

#### Ba (ب), finishing (الحب)

- **Start:** a short turned-up stroke, (−4.40, −0.35) to (−5.04, −1.49),
  the nib at 77–82° (0.94; 0.05).
- **Bowl:** the boat, 11 nodes from (−5.08, −1.28) to a thin tip at
  (−11.83, −1.00), the nib held at 78–87° (0.96; 0.03). Read off the
  piece's skeleton: a band started from its outline made the bottom too
  thin.
- **Dot:** under the bowl at (−7.22, 1.39).

#### Ha (ح), starting (حيا)

- **Top:** the head written left to right, (−4.83, −2.29) to (−0.11,
  −1.62), the nib at 56–61° (0.91; 0.08).
- **Hook:** the small turn at the head's left end, (−4.94, −2.12) to
  (−3.69, −1.99), the nib at 61–63° (0.92; 0.05).
- **Down:** back down to the left into the ي, to (−4.66, −0.34), the nib
  from 58° to 81°. The pen leaves by it (0.95; 0.03).

#### Ya (ي), middle (حيا)

- **Up:** to its tooth, (−4.60, −0.42) to (−5.82, −1.21), the nib at
  81–90° (0.95; 0.03).
- **Down:** into the alif, (−5.67, −1.43) to (−7.15, −0.30), the nib from
  70° to 80°. The pen leaves by it (0.93; 0.04).
- **Dots:** two under the line at (−5.91, 0.84) and (−6.85, 0.99).

#### Alif (ا), finishing (حيا)

- **Stem:** from the join on the line, (−7.29, −0.16), up to its top at
  (−8.97, −6.76), the nib turning from 44° at the foot to 70° (0.91; 0.08).
  The weakest piece of the phrase, where the studio's foot curls into the
  line. A refit with the outline weighed six times (`edge` 6) brought it up
  from 0.88.

#### Ta (ت), starting (تي)

- **Tooth:** down from its head, (−1.10, −2.79) to (−0.14, −1.01), the nib
  at 78–83° (0.94; 0.03).
- **Head:** two short pieces over the tooth's top: a pull at 144°, (−0.95,
  −3.09) to (−0.96, −2.41) (0.92; 0.04), and a three-node turn from 45° to
  111° (0.76; 0.08, the weakest fit in the phrase, on a piece a quarter
  nuqta long).
- **Band:** out to the left into the ي, (−0.10, −1.17) to (−1.86, −0.42),
  the nib held at 78–80°. The pen leaves by it (0.99; 0.01).
- **Dots:** two above, at (−0.40, −4.36) and (−1.35, −4.20).

#### Ya (ي), finishing (تي)

- **In:** from the ت's band, (−1.87, −0.39), round to the right to (0.03,
  0.32), the nib turning from 82° to −36° (0.95; 0.04).
- **Bowl:** from (0.05, 0.54) back out to the left under the line to a
  thin tip at (−5.66, −0.29), 12 nodes, the nib turning from 17° to −110°
  (0.95; 0.06). Its start was trimmed 0.10 nuqta by hand: with the nib
  nearly flat there, half the nib stood 0.14 right of the studio's bowl and
  moved the whole تي 0.14 in the placement test. `trim_ends` would not take
  the cut because it costs 0.006 of the bowl's own overlap (0.004 counted
  with the ي's first piece, which covers that corner).
- No dots (the studio's).

## The studio catalogue

From 2026-10-19 every shape the studio offers is fitted from its own
catalogue rather than from words written on its canvas. Shape by shape,
with overlaps and side-by-side sheets, the results are in
[studio-catalogue.md](studio-catalogue.md).

**The source.** The studio loads its whole letter library as data files
(`db.json`, `stamps.pack.json` and smaller join and dot files). The user
gave the OK to download them on 2026-10-19. They stay in Claude's scratch
folder and are not committed; only our fitted strokes go into the project.
- There are 1,337 entries in all 22 letter groups. Each has its group, form
  (Isolated, Initial, Medial, Final, Pairs, and some combined forms),
  variant number, width and height in nuqta, and joining points.
- Each entry's outline comes already split into its pen strokes (`s0`,
  `s1`, …), the same pieces the canvas draws.
- 556 entries are pair halves (`pair_of`): the studio's two-letter pairs
  cut in two. Another 153 are twins (`twin_of`) of other shapes. Neither
  is fitted again, which leaves **500 single shapes and 281 pairs, 2,500
  distinct strokes**. A stroke drawn the same in two shapes is fitted once
  and moved into place.
- **But a reused stroke can overshoot.** The match is on the stroke's
  outline alone, while the fit ignores its neighbours' ground (see
  [Joins](#joins)). So its ends may run into a neighbour that the shape it
  is moved into doesn't have. The Ba 047 showed a block of ink the studio
  hasn't got (the user, 2026-10-20). `split.py` measures each reused
  stroke's ink outside the new shape's studio ink, against the same at
  home. Where it grows by more than 0.01 square nuqta, the stroke gets its
  own fit in that shape, refined from the moved one. 19 of the first 229
  did. Run it again as each group's first fits land.

**Units and the line.** The catalogue is drawn at 25.9 units to the nuqta
in every entry, and the pen is 25.9 / 1.65 units wide.
- In an unjoined shape the line lies 3.0 units below the value in
  `rest.json`. This is measured on the studio canvas for its standalone
  meem (552) and its final nun (631).
- A joined shape is placed by its entry and exit points (`entry`, `exit`
  in `db.json`), so it needs no line of its own.

**Fitting.** Each stroke is one job in the folder queue (`fitqueue.py`, see
the compute note in Claude's memory). It's fitted as in method step 5:
- a band from the stroke's outline, a band from its skeleton, and a pull,
  keeping the best;
- refined on Geekmini's RTX 4070 by gradient descent (`gpufit.py`).
**Accuracy before time** (the user, 2026-10-19: "I would prioritize
accuracy over time"). Every fit is tight:
- nodes 0.3 nuqta apart, where they were 0.9;
- the outline gap weighed three times;
- three GPU stages, the last on a 200 px-to-the-nuqta grid, run until
  the cost stops falling.

Nodes 0.9 apart missed the slanted start of the curved alif (the user
saw it) and the turn of a final alif's foot, and the overlap barely
notices either. The curved alif's head was 0.22 nuqta off and is 0.12
tight. A stroke whose best fit is still under 0.92 overlap, or more than
0.12 nuqta off anywhere, is fitted tighter again: nodes 0.2 apart, the
outline weighed five times. The best fit by the CPU's own score is kept.

**The user's fixes** (`fixes.json` in the authoring scripts) override
that choice. Two kinds so far:
- **refit:** closer nodes and a heavier outline, for a shape a nib makes
  but the fit missed.
- **fill:** the studio's own outline as a filled mark, for marks a
  calligrapher fills in with a fine pen instead of writing with the nib.
  The alif's hat is one: the user, "the calligrapher makes a mark and then
  fills the rest of the shape in with a fine tip pen". No nib path makes
  it, so no fit can. The jim's starting mark, the small slanted block where
  its head begins, is another (the user, 2026-10-19: "those are all fill
  ins"; 20 shapes, 10 distinct strokes). The isolated dal's head is two
  more: its slanted starting block and its hat (the user, 2026-10-20:
  "yes. same thing with the hat on alif"; 146 and 147, three distinct
  strokes; the final dals have neither). Fitted with the nib, they left a
  step along the head's top edge. Measuring each stroke's widest
  point against the nib does **not** find fills: 245 strokes are wider than
  1.15 nibs somewhere, and neither of these is among them. Ask the user.
  The fine pen fills up to the nib's strokes, so paper shut in against a
  filled mark is part of it. A nib's straight edge can't follow the
  curved edge of a fill exactly: the alif 001's stem stopped 0.006 nuqta
  short of its hat and left a speck (2026-10-20). The sheets fill any such
  enclosed paper that touches a fill; the app must do the same. Only a
  sliver, though: at most 0.5 square nuqta. The jim 101's head closes its
  counter against the starting mark, and the rule filled the whole counter
  (3 square nuqta, 3% inked in the studio). That one fill was all of 101's
  low score: 0.80 → 0.93 once the counter stayed open (2026-10-23). No
  other shape had a pocket bigger than a speck.
- **A local search, by script** (`fix_alif.py` and its kind). The fix is
  written as the stroke's `.f` result and marked with a `how` so
  `fixes.py` never queues it again. The alif 005's top end curled back on
  itself: the nib swung about 115° in seven nodes, a hook the studio
  hasn't got. The curled nodes were dropped and the end searched (nib
  angle in 10° steps either side of the next node's, width 1 or 0.75; the
  first five nodes free, the rest held). **Choose by the worst miss first,
  then the area.** The hook covers a little of the studio's ink, so on
  area alone the search put a start with the hook back on top. By worst
  miss, 0.137 → 0.085 nuqta, and the end is one clean slanted cut.
- **Spurs at joins: judge each end on its own** (the user, 2026-10-20: the
  dal's bottom join, and the jim's heads where its strokes meet, in 119,
  123, 124, 128, 129, 130, 133 and 144). `trim_ends` stepped an end back
  only while the stroke's worst overshoot fell, and that worst was taken
  over the whole stroke. So a spur at one end survived whenever the other
  end strayed further. Now each end is judged by the overshoot within half
  a nuqta of where it was (`overshoot(..., near=)`). Trimmed again
  (`retrim.py`), most of the reported spurs went; the 119's corner is
  clean. The ends still straying get the end search (`endsearch.py`): the
  end node's nib angle in 20° steps up to 80° either side of its
  neighbour's, width 1, 0.75 or 0.5, the five end nodes free, judged on the
  whole shape (the other strokes as fitted, fills as their outline) within
  half a nuqta of the end, worst miss first. The dal's bottom join went
  0.258 → 0.089 nuqta (146) and 0.101 → 0.015 (147); the jim 144's 0.076 →
  0.007. Search one end of a stroke per round: both ends start from the
  same fit, so writing the second throws the first away.
- **A tighter turn is not a better turn.** The ba's tooth comes to a
  narrow, nearly pointed top that our fits round into a low hump, 0.1–0.4
  nuqta short. Two tries, both rejected by eye:
  - a corner node at the top (bend and fold excused there). The overlap
    rose, but the cusp showed the nib's straight edge as a flat peak, and
    the nodes either side crossed over and left nicks;
  - nodes 0.1 nuqta apart over the top, free. The tip's worst miss fell
    (080 0.222 → 0.045 nuqta, overlap 0.786 → 0.876), and the tops came
    out notched and kinked. Nothing prices spacing or the nib's turning
    per length, so the free nodes slid into clumps (chords down to 0.012
    nuqta, flat facets between them) and the nib pivoted in place (up to
    2,956° per nuqta). Past about 190° per nuqta one end of the nib runs
    backwards, which draws a knot. This run was meant to try a bend that
    charges a change of curvature rather than curvature itself
    (`bend="heading"`). At that roughness the bend hardly counted, so it
    proved nothing either way. On four good strokes it was no worse than
    the old one.

  The studio writes the tooth at a constant nib, about 78°. Its inner V is
  the outer peak moved by one vector, 0.67 nuqta along 258°, the same in
  076, 080 and 085c. The outer top is a tight arc, radius 0.11–0.18 nuqta.
  The old fits made a hump because one node turning the centre line 130°
  costs about 6 in fold, forty times the overlap it buys, so the turn was
  spread over two nodes. Some (085c) spun the nib 90° instead to fake the
  point. A score can rise while the shape gets worse. Fable's notch judge
  (`notch.py`) must pass before a tooth's number counts. It checks:
  - nodes no closer than 0.15 nuqta;
  - the nib turning no more than 120° a nuqta;
  - a turn of no more than 90° at any node but a corner;
  - no sharp inward corner on our outline that the studio's hasn't got.

  The third try followed that (`tooth3.py`). One node became a corner,
  half a nib below the studio's tip, with its nib held at 78° (`hold` in
  `pieces.refine`, so the job runs on the processor). Three ways: the corner
  and one node either side free; those three held at 78°; and the whole
  stroke free about the held corner. The whole stroke free won on every
  tooth. Six kept (2026-10-20): 076 0.84 → 0.94, 077b 0.83 → 0.93, 078
  0.82 → 0.93, 078b 0.83 → 0.95, 068 0.65 → 0.88, 069 0.70 → 0.89. The
  body now follows the studio's, but the top is a sharp spike where the
  studio's is a narrow rounded point. Rejected by eye: 080 and 085b–d,
  which have a lump on the inside of the rising stroke just under the top,
  and 048, still wrong. The nib-turning guard is judged over the whole
  stroke, so it fails fits whose only fast turn is far from the top. Use it
  near the tooth.

  Then the spike was rounded (`tooth4.py`). The corner became three nodes
  0.12 nuqta apart, all at the corner's nib angle, with the whole stroke
  free. Kept for 076 (0.94), 085b (0.73 → 0.92), 068 and 069: their tops
  are now narrow and rounded like the studio's. 077b, 078 and 078b kept
  the spike, because rounding straightened their downstroke out of its
  curve into the tail. 080, 085c and 085d still have the lump under the
  top and keep their old fits.

  The user, 2026-10-21: "85b is fine"; 076, 077b, 078 and 078b "need the
  tops to be more rounded"; 068 and 069 "are the same stroke and they
  suffer from the same problem". Measured: our outer top's radius was a
  quarter of the studio's on 077b, 078 and 078b, two-thirds on 076.
  Fable found one cause under all of them. The tooth is written with a pen
  1.12 nibs wide (the apex to the inner V, 1.117 to 1.124 nibs on all
  seven teeth, 085b too), so one standard nib could match the outer top or
  the inner V, never both. And the studio's top is not an arc: a tight
  bend on one side eases into a long gentle curve on the other.
  The method that worked, in steps:
  - **Build the top; don't refine it** (`tooth5.py`). The path is the
    studio's outer outline moved back by half the pen, nodes close where
    it turns tight and wider as the turn dies out, all fixed.
  - **Build down to where the body already lies on the track**
    (`tooth6.py`): the descent to 1.2 nuqta (0.9 on 078 and 078b). A
    shorter build left a step where it met the old body.
  - **Write it with the wider pen** (`tooth8.py`): every node width 1.12,
    the old body free. With the narrow pen the old body had turned the nib
    8–12° in one chord at the handover to fake the width, which nicked
    the inner edge.
  - **Spread any nib turn along the build** (`tooth9.py`). The rising
    stroke is written 4–7° steeper than the top, so the built nodes turn
    from 78° to the body's angle gradually, each placed from the outline
    for its own angle.
  - **068 and 069 start with the pen set down square:** one straight cut
    the pen's own length at its own angle, then the pen moves right and
    up. The whole rising side is built, nothing free on it.
  
  Overlap now: 076 0.98, 077b 0.96, 078 0.97, 078b 0.98, 068 0.94, 069
  0.93.
- **One studio outline can be two pen strokes.** The user, 2026-10-21:
  "some of the problems we are seeing are because some of these marks are
  drawn as one continuous stroke". 069 (and 068, the same stroke) is two,
  confirmed on a picture: the start block rising to the tooth's top, then
  from the top down into the tail. The studio's piece is cut by the line
  through the tooth's outer apex and its inner V (`twostroke.py`), and each
  stroke is fitted against its own half with the other half ignored, a
  standard pen. The sheet draws both (`fixes.json` "with"). Against the
  whole piece: 068 0.939 → 0.956, 069 0.933 → 0.953, above the one stroke
  with a pen 1.12 wide. So the tooth's "wider pen" here was two strokes
  overlapping at the top. Two faults remain by eye: the block's top edge
  turns at a corner where the studio's curves, and the inner V is pointed
  where the studio's is round. Three attempts to fix them (a built block
  edge and a stroke 2 riding deeper at the top; the same with the old
  block kept; the old fit with only the block's nib smoothed) each scored
  lower (0.936–0.947) and showed new steps, and were put back. The user,
  2026-10-21, on the block: "I think it is just one motion of the pen".
  The kept stroke 1 had set the pen down and turned it in place (+9° then
  back), then stopped turning at the seventh node: the corner. Rebuilt as
  one motion (Fable, `t13.py`, variant c): the path is the studio's outer
  edge moved back by half the pen, every nib held to the profile measured
  on the studio's band (−100° at the set-down, rolling to −112° up the
  rise, −102° over the top), with a pen 1.12 wide, since the block's cut
  is 1.116 nibs with nothing overlapping it. So the "overlap explains the
  wider pen" above holds for the top only, not the block. Kept with the
  t10 stroke 2: 068 0.956, 069 0.955; the block's worst miss 0.049 →
  0.016. The V is still a little pointed. Stroke 1 with a standard pen
  (variants a, b) and the wide stroke 1 with a rebuilt stroke 2 scored
  lower.
  The judge: Fable's gates (`tooth8.py judge`) catch the causes, a
  nib jump at a handover and chords out of proportion, not the look; every
  join was checked in close-up before it was kept.
- **End searches can spoil what the number doesn't see.** A second round
  searched 16 more ends. Ten were kept: 147's inner corner at the bottom
  join, 144, 129, 130, 123. Seven were put back by eye:
  - 119 (both ends): the head's tip went blunt and notched;
  - 116 (three): a blob at the lower join;
  - 133.s2: a crack along the head's top;
  - 124.s2: its lower-left end went wavy, with a hook.

  Every end fix is looked at in close-up before it is kept. The step
  that's left at the jim heads' tip is where our top bar, thinner than the
  studio's, meets the lower stroke's end: the wide-stroke question.
- **Strokes wider than the nib.** 510 of the 2,500 distinct strokes are
  wider than 1.08 nibs over more than a fifth of their length: the jim's
  head bar about 1.15, the 144's bowl 1.37. One nib can't reach the outer
  edge, which leaves a thin strip of the studio's ink along the jim heads'
  top. Wider nib, second pass, or fill: asked of the user, 2026-10-20.
  The user, 2026-10-21, yes to a wider pen for the ba's teeth. A node's
  `width` above 1 is now a wider pen, up to 1.5 (`WIDEST` in `pieces.py`,
  `fit.py` and `penSweep.ts`). The width is set per node and blends
  along each segment. Most wider strokes carry one width on every node.
  092's bowl is the first whose width changes along it (see "092's
  lower stroke" below).
  The jim heads' bars (Fable, `t14.py`, 2026-10-21) are each one wider
  stroke, not two overlapping: the cut at the bar's right end equals the
  chord through the ink along the nib's line all along the bar, and the
  chord's profile is smooth. Three pens, not one: 116.s1 (116, 128) 1.30
  nibs, 091.s3 (091, 092, 129, 133) 1.23, 130.s1 1.13. Built from the kept
  fit with the measured width on every node, the first node moved to the
  cut's middle at the cut's heading, the last chords densified, then
  refined with the neighbours ignored. 130 kept: 0.954 → 0.982, the step
  at the tip gone. 116 and 091 lift every shape that uses them (128 0.891
  → 0.973, 129 0.924 → 0.962) but leave a spike at the head's left elbow
  where the bar comes down into the lower stroke; held back for an end
  fix. The held-nib variants (h) overshot the top edge.
  The end fix (`t15.py`): the elbow lies on the neighbours' ignored
  ground, so a refine is blind there and the elbow is built instead,
  its nodes on the band's centre, the nib turning 2.5° a chord. 116 kept
  that way: 116 0.864 → 0.906, 128 0.891 → 0.974, the elbow clean. The
  spur under 116's right tip is 116.s2's end, not the bar. 091 not kept:
  the band narrows below a 1.23 pen's height before the elbow, so a rigid
  wide pen there folds or stops short (0.922, and one build diverged on
  the GPU). Fable's reading: the pen lifted, and the lower stroke sets
  down under the blob, as 068/069's did. Asked of the user.
  The user, 2026-10-21, said yes, on the textbook's writing order for the
  jim (the head's left end is a separate piece; see step 0 above). Kept
  (Fable's `t16.py`):
  - **The bar** keeps the wide pen's body, cut at x −5.32 just before the
    curl, with the nib held at 95–96° over the last stretch. The curl
    and the spike are gone. The textbook's own cut, earlier at −5.03,
    leaves a strip of studio ink bare. The blob under the shoulder is
    0.70–0.75 nuqta tall, and one standard nib is 0.606. The worst miss
    at the elbow is 0.127 for the cut at −5.03 and 0.082 for the cut at
    −5.32.
  - **Both lower strokes** set down there on the standard pen and run
    down the studio's outer edge (the union of the bar's and the lower
    stroke's pieces), with nodes 0.1 apart. The nib rolls from 96° to
    105–110° round the shoulder and back to the kept body's angle,
    at most 4.9° a chord. The new nodes are added before the kept body.
    The two strokes are 091.s4, used by 091 and 092, and 129.s4, used by
    129 and 133.
  - **The textbook's separate tick**, tried as an extra stroke, made a
    square end against the studio's round shoulder (worst miss 0.15).
    The studio's shoulder is one smooth outer edge, so one stroke that
    sets down at its top matches better.
  - **The queue's refines** of the handover returned their starts
    unchanged, so the build is what was kept.

  Scores: 091 0.904 → 0.938, 092 0.855 → 0.893, 129 0.924 → 0.961,
  133 0.929 → 0.962. The elbow's worst miss went from 0.10 to
  0.06–0.08. Still visible: the hollow under the bar's left end is
  filled about 0.05 deep, because the 1.23 pen is taller than the band
  there. There is a faint ripple, 0.02 or less, at the top of the
  shoulder. 091/092's lower stroke is short by 0.07 along its lower-left
  edge, which was already there before. The new fits' own piece scores
  look poor, because each now covers ink on the other's piece; judge
  them by the sheet.

**Ends rebuilt at a join (Fable's `t17*.py`, 2026-10-21).** The user
flagged several joins:
- a spur under 116's right tip (also 128, the same strokes);
- the head's right end, where the two head strokes meet, in 117, 119
  and 120;
- a step on 092's belly;
- a spur where 154's head (the ra) meets its body.

In each, the faulty end was taken back to a node that still fits. It was
then rebuilt on the studio's ink, with nodes about 0.1 nuqta apart, the
nib's outer end following the outer edge, and the nib turning at most 5°
a chord. Trimming alone made 116 worse. At these heads the bar's piece
and the lower stroke's piece end on one shared cut, at about 80° and 1.1
nibs. A 1.0 pen can't span that cut, so each fit had centred on it and
left a corner bare or poking out. Now the bar's last nib lies along the
cut from its top corner, and the lower stroke sets down along it from
its bottom corner (the textbook's order: the bar pushed to the right,
then a new stroke set down under its right end).

| shape | overlap before → after | worst miss at the join, before → after (nuqta) |
|---|---|---|
| 116 | 0.906 → 0.908 | 0.072 → 0.038 |
| 128 | 0.974 → 0.977 | 0.072 → 0.038 |
| 117 | 0.933 → 0.942 | 0.100 → 0.067 |
| 119 | 0.934 → 0.943 | 0.116 → 0.041 |
| 120 | 0.954 → 0.958 | 0.071 → 0.038 |
| 095 | 0.903 → 0.905 | 0.119 → 0.074 |
| 092 | 0.895 → 0.899 | 0.075 → 0.064 |
| 154 | 0.9635 → 0.9641 | 0.064 → 0.026 |

095 shares its lower stroke with 119. The queue's refines of 116's
handover moved nothing, so the builds were kept. The refines for the
other shapes are queued.

At three times the size, the spurs and the zigzag are gone, but these
are not clean yet:
- 117 and 119 have small ripples on the lower edge near the join;
- 154 has a small kink on the body's right edge;
- **092's belly now ripples instead of stepping.** Its kept bowl fit is
  poor (0.774 on its own piece). The start of the belly is wider than one
  pen allows at any angle, so a wider pen for the bowl's start is the
  next fix.

The bars of 117, 119, 120 and 095 run 0.05–0.07 under their top edge
along their length. That may also need a wider pen, as with 116, 091
and 130.

**092's lower stroke written with a pen as wide as its band (Fable's
`t18.py`, 2026-10-21).** The user: "Now there is a step off at the lower
stroke." The step was not at the join. It was about 3 nuqta down the
bowl, where the rebuilt start handed over to the kept body. Along the
flat bottom the studio's band is 0.80–0.83 nuqta across, which is
1.32–1.37 nibs. The kept body was on the standard pen, centred in the
band, and left 0.10–0.12 bare on each side for about 4 nuqta. The
rebuilt start rode the outer edge, so at the handover both edges
stepped by 0.10 (worst miss 0.152). Fixing the start alone could not
remove it.

Kept: each node's width is the ink's chord along its own nib line,
capped at 1.5, and widened only where the standard nib's end stands
inside the ink. The width is 1.0 for the first 0.6 nuqta, rises to 1.25
by 2 nuqta, holds 1.35 along the bottom, and comes back to 1.0 over the
tail's first nuqta. The start rides the outer edge, with the nib rolling
4.9° a chord at most. The body's nodes are re-centred on their chords
(moved 0.04 at most). The tail's last five nodes are untouched. Rejected:
the standard pen with the start moved to the band's middle. It removed
the jog, but the bare strips stayed (0.899, worst 0.132).

092 overlap 0.899 → 0.973. Worst miss at the join 0.064 → 0.050, and
along the bottom 0.132 → 0.025. Gates on the built part: 4.9° a chord,
chord ratio 1.5, widths 1.35 at most. 092.s3 is used by 092 only. Still
there:
- a bare wedge 0.05 deep on the inner side at the set-down;
- the tail tip's old over-ink (0.136);
- the nib's angle reverses 5° across the handover, though the outline
  is clean.

Either the pen changes width, or the start and the tail are separate
motions. Which story the app tells is the user's call. A refine with the
widths held (`t18.092.s3.w`) is queued. It came back (2026-10-22) at
0.980, but it broke the chord gate (5.09) and was not kept.

**Approved by the user, 2026-10-22:**
- Ra Zay Isolated;
- Ra Zay Final 158 and 159;
- Jim pair 093.

**Ra finals' spurs (Fable's `t20*.py`, 2026-10-22).** The user flagged
spurs on 161–165 and 600. The method is the one used for 154: the faulty
end is taken back to a node that still fits, then rebuilt riding the
studio's edge. Where the head under a hat is only 0.7–0.8 nib wide, the
nib lifts on its inner side.

| shape | where the spur was | overlap | worst miss at the join |
|---|---|---|---|
| 162 | the hat's (162.s2) last nib swung to 185° and poked out of the head's right edge | 0.979 → 0.981 | 0.175 → 0.040 |
| 163 | the body's (163.s1) last nib stuck up past the head's right edge | 0.958 → 0.958 | 0.040 → 0.013 |
| 164 | the head stroke (164.s1) ended with an upright nib, 0.15 below the body; the hat's (164.s0) first nib poked out of the head's left edge | 0.961 → 0.964 | 0.150 → 0.020; 0.130 → 0.031 |
| 165 | the same head-stroke spur, through 164.s1 | 0.946 → 0.946 | 0.149 → 0.020 |

Not kept:
- **600:** its spur is the same as 164's. The rebuild cut the miss from
  0.149 to 0.044, but overlap fell 0.9745 → 0.9740. The spur's ink had
  been filling a bare wedge at the end of the body.
- **161:** the head's top point stands 0.061 above the studio's, and the
  join has a step of 0.019. Neither would build without costing overlap.

The tail-tip hairs were left alone: 158 and 159 have the same and are
approved. Still visible at 3x:
- small nicks on the left edge of 162's and 164's stems;
- the bars of 163.s2 and 165.s2 round off the studio's square cut, the
  jim-bar problem;
- the hats of 161, 162 and 164 are bands 0.4–0.7 nib wide under a piece
  about 1.1 nibs tall. Whether to write them with a lifted nib or fill
  them, as the alif's and dal's hats are, is the user's call.

**Jim pairs' joins (Fable's `t21*.py`, 2026-10-22).** The user: "94 v2
and 95 v3 gap where the letters join … 99 v7 is bad."
- **094:** the jim's lower stroke and the ba's stroke end on one cut
  (80°, 1.11 nibs), as at the jim heads. Both ends were centred on it,
  which left a V-notch at the top and a spur below. Now each rides its
  own edge to its corner and lays its last nib along the cut. Both are
  widened to the ink's chord (1.10 at most). 0.955 → 0.961; worst miss
  at the join 0.100 → 0.019.
- **095:** a sliver of paper along the seam. The next letter's bar is
  1.10 nibs across along its whole length, so it is now written with a
  pen as wide as its band (1.06–1.09). 0.905 → 0.916; worst miss at the
  join 0.211 → 0.077. The rest of the miss lies under 095.s2, which was
  left alone because it was in the smoothing test.
- **099:** three faults fixed:
  - the same shared-cut notch at the jim–sin join;
  - the second tooth was forked: 099.s3's end hooked back and spun its
    nib flat, and 099.s5 started upright against an 80.5° cut;
  - the thin start ran 0.12 past the studio's point.

  0.957 → 0.963. 178, which shares 099.s5, went 0.946 → 0.948.

  Still visible on 099: a spur and notch at the first tooth's tip (0.08),
  the third tooth's tip (0.05), and a sag of 0.07 in the valley between
  teeth 2 and 3.

Method note: `t16.place` puts the nib's extreme point on the edge's
tangent. Where the nib lies nearly along the edge, as on a tooth's face,
that runs the end far ahead. `t21_build.place_end` puts the end itself
on the edge instead. The GPU refines of these builds gained 0.0007 at
most, moved ends by up to 0.23 and brought notches back, so none was
kept.

**Smoothing test (Fable's `t19*.py`, 2026-10-22).** The user: "there are
just some subtle irregularities in all of our shapes that the studio just
does not have." Tested on 092, 117, 119 and 095. Our edges change
direction at the nodes, with lumps and kinks of 10–15° every 0.1–0.3
nuqta, because the path's curvature jumps at each node. The measure
here is the outline's curvature wobble at the 95th percentile, per nuqta.

| shape | before | fairing | fairing + smooth outline | studio |
|---|---|---|---|---|
| 092 | 0.63 | 0.49 | 0.35 | 0.33 |
| 117 | 0.58 | 0.28 | 0.27 | 0.25 |
| 119 | 0.66 | 0.48 | 0.44 | 0.32 |
| 095 | 0.24 | 0.23 | 0.20 | 0.24 |

- **Fairing the strokes** (penalised second differences per channel,
  ends pinned, overlap down by 0.005 at most, no local miss up by more
  than 0.01) does not help visibly. It sharpened the elbow notches.
  Loosened, it folded the elbows.
- **Smoothing the drawn outline** (corners kept, each run between corners
  smoothed, outline moved 0.015 nuqta at most) reaches the studio's
  smoothness on 092, 117 and 095. Overlap is within ±0.004. It also fills
  092's pinhole at the elbow.
- **What is left is shape, not wobble:** the elbows of 092, 119 and 095
  sit lower than the studio's, and 117's lower stroke bends where the
  studio's is straight.

In the app this would be a pass after `sweepPath` on the outline it
returns. The user said yes, 2026-10-22. Built as `src/lib/outlineSmooth.ts`,
applied in `penLayout.ts` before the curves are fitted, with these
settings:
- resampled every 0.01 nuqta;
- no point moves more than 0.015;
- a turn of more than 40° over 0.08 counts as a corner and stays;
- samples within 0.12 of a corner stay where they are.

The sheets draw ours the same way (`scripts/pen/outline.py` with the
same steps and settings, applied in `sheet.py`), and their overlaps are
measured on the smoothed ink.

**Sin Shin complete; hooks at the teeth (Fable's `t22*.py`,
2026-10-22).** The last five strokes (170.s1, 171.s0, 172.s1, 172.s4,
184.s5) were fitted on the Geekmini, so all 68 Sin Shin shapes now have
every stroke. 184.s5 had failed on 2026-10-20 when a diverged fit asked
for a 238 GiB window. `pieces.score` and `overshoot` now score ink more
than 20 nuqta (`RUNAWAY`) past the reference as hopeless, without
rastering it.

Before the user's review, the Medial sheet showed barbs at the teeth.
They came from two constructions, repeated through shared strokes:
- **A beak in the valley and a forked second tooth.** The bowl between
  teeth 1 and 2 spun its last nibs flat under the valley, where the
  studio climbs tooth 2's right face as a thin wedge. The tooth stroke's
  last nib ran 0.2 past the tip. Now the bowl's lower end rides the outer
  edge round the bottom and up the wedge, widened to the ink's chord
  (1.36 at most). The tooth stroke's end rides tooth 2's left face to the
  tip.
- **A barb on tooth 1's right cut.** A start spun 40° → −94° in 0.15
  nuqta. Now it rides the tooth's bottom edge to the cut's corner and
  lays its nib along the 80° cut, widened to 1.10.

Thirteen strokes in eleven shapes were fixed, and every sharer improved:

| shape | overlap |
|---|---|
| 209 | 0.837 → 0.892 |
| 210 | 0.862 → 0.907 |
| 214b | 0.874 → 0.907 |
| 214c | 0.901 → 0.916 |
| 219 | 0.942 → 0.955 |
| 213 | 0.895 → 0.901 |
| 228 | 0.947 → 0.952 |
| 214 | 0.937 → 0.943 |
| 215 | 0.908 → 0.919 |
| 229 | 0.940 → 0.947 |
| 230 | 0.952 → 0.956 |

Still visible at 3x:
- tooth 2's tip is still double-pointed;
- a bump on the bowl's lower edge, and a nick on its upper edge, where
  the standard-width nodes meet the widened ones;
- on 209, 210 and 214b, the second valley is 0.13–0.17 shallower than
  the studio's, because 209.s3's band is wider than one nib.

`split.py` found one reused stroke overshooting: 172.s1 in 196, by
+0.298 sq nuqta (the dark bulb at 196's left end). It has its own fit
queued as 196.s1.

Second pass (`t22b`):
- **The double point was on tooth 1.** The bowl stroke's first nib stood
  0.1–0.15 right of the studio's topmost point. Its upper end now sits at
  that point, the pen lifted to 0.35 of its width (0.5 on 214c). The miss
  at the tip fell 0.127 → 0.04–0.05.
- **The bowl's handover:** the standard-width nodes are centred on the
  ink's chord, with the pen set to the chord's width: 0.80–0.88 where the
  band is thinner than a nib, then 1.0, then 1.36 up the climb. This is
  the pen changing width along a stroke again, as on 092. The bump and
  the nick are gone.
- **The second valley:** 209.s3, 210.s3 and 214b.s2 are widened to the
  chord (1.31 at most). The bare strip fell 0.132 → 0.035.

Overlap: 209 0.892 → 0.955, 210 0.907 → 0.959, 214b 0.907 → 0.944, 214c
0.916 → 0.924, 219 0.955 → 0.961. Still visible: the tip ends in a flat
cap about 0.2 wide where the studio's is a hooked point, and a bare
sliver 0.04–0.06 runs along the bowl's upper edge.

**The GPU refiner and widened strokes.** The four refines of widened
strokes came back unmoved and scored 0.44 against the build's 0.87 on
the same piece. The refiner seems not to honour `width`, or scores it
differently. Check `fitjob.py`/`gpufit` before queuing refines of any
widened stroke.

**Choosing a stroke's pass by the sheet (`pick.py`).** `result()` takes
the pass that best fits the stroke's own piece. The second passes (`.t`,
2026-10-21) won there but lost whole shapes, because the neighbours'
ground is ignored in a pass's own score:
- 049 0.928 → 0.805;
- 053 0.947 → 0.862;
- 082 0.941 → 0.890.

`pick.py` tries every finished pass in every shape that uses the stroke,
and records the best mean overlap as fixes.json's `use`, which
`result()` honours. Run over all 781 shapes on 2026-10-22. 72 strokes
changed pass and 11 shapes rose by more than 0.01. Under 0.85 now: Jim
101 (0.80), Ba 048 (0.81) and 728 (0.83).

**Approved by the user, 2026-10-22:**
- Sin Shin Isolated and Initial, apart from the shapes fixed below;
- Alif Isolated and Final.

The user's shorthand gained `^` for a joint. From 2026-10-22 the work is
done without Fable; its scripts are still used as tools.

**Hairs at stroke ends (`SCRATCH/me/hair.py`, 2026-10-22).** The user:
"196, 200, 201, 204, 205, 206 and 207 all have the middle of the shin
taller than the first."
- **The cause:** in each shape, the stroke ending at the middle tooth ran
  on past the studio's tip, and the nib's full width stood up past its
  last node. The tooth was 0.28–0.39 nuqta too tall, measured at the
  tips.
- **Why the old measure missed it:** a thin sliver up the side of the
  studio's tooth stays close to the studio's ink everywhere, so its
  distance from that ink is small. `reach` measures how much further our
  ink goes than the studio's past the end, along the stroke's last
  direction.
- **The fix:** each end is shortened along its own path (by 0.05 up to
  0.4 nuqta) and written with less of the nib (down to 0.3), keeping
  whichever choice reaches least while no sharer's sheet overlap drops.

Kept:
- 178.s2 (178, 180, 196, 201);
- 200.s2;
- 189.s0;
- 204.s2;
- 205.s2;
- 195.s2 (195, 206, 217, 227);
- 207.s2.

Every middle-tooth tip is now within 0.03 of the studio's, and overlaps
rose 0.000–0.006.

167's spur at the joint was two ends running past it, 167.s3's and
167.s4's. They were trimmed the same way (167 0.953 → 0.954, and 170,
which shares 167.s3, rose too).

**Joints (`SCRATCH/me/joint.py`, 2026-10-22).** The user: "552, 553 and
553b the mim strokes need to join better." A joint end is an end within
0.5 nuqta of another stroke's path. Each joint end is first tried
lengthened 0.05–0.3 along its last chord, for a stroke that stops short.
Its last four nodes are then tuned by coordinate descent:
- position in steps of 0.06, 0.03 and 0.014 nuqta;
- nib angle in steps of 6°, 3° and 1.4°;
- pen width 0.25–1.5.

The aim is to shrink the mismatched area within 0.35 of the joint, plus
half its worst point. No sharer's overlap may drop, neither worst point
may grow, the nib may turn at most max(5°, the stroke's own) per chord,
and the chord ratio stays at most max(2.5, the stroke's own).

On 553 the loop's left side, where the top stroke 553.s1 and the
downstroke 553.s0 begin, now curves round as the studio's does: s0 is
lengthened 0.1 up into the joint. 553 went 0.966 → 0.973, and the bar's
right end lost its bare corner.

552, 553b and the ya's 718–720 did not come right, and nothing from them
was kept:
- **The first run bought zigzags.** The path's bend swung back and forth
  by up to 68° between neighbouring nodes. That covered the studio's ink
  and raised the overlap, but drew a wavy dent in the ya's head. The
  tuner now also refuses any node whose path bend moves more than 8°
  from the stroke's own (`BEND`).
- **The second run was smooth but only partly better.** The spike where
  the ya's head meets its body (`()^`) went from 719 and 720. The
  head-head joint (`((^`) kept its notch and spur. 552 gained a spike,
  and 553b's square corner went round.
- **Why end-tuning can't fix it:** two separate strokes meet at each of
  these joints, each with its own nib cut, and the studio's outline flows
  straight through. The ya's S-curve is also 15–20% thinner than the
  studio's all along, and the tuner was compensating for that at the
  joint.

**One continuous stroke (`SCRATCH/me/merge.py`, 2026-10-22).** The
user: "redraw the ya's head and its S-curve as one continuous stroke.
same thing with the meem."
- **The method:** the pieces' current paths are chained in writing order,
  each handover made where the two paths come closest in the last and
  first thirds. The chain is refined on the queue against all of its
  studio pieces at once (`fitjob.py` refine with `pieces`), the shape's
  other strokes as ground. The first job draws the result (`use: ".m"`).
  Each absorbed job is marked `merged: [first job]`, and `sheet.py` draws
  nothing for it in a shape that holds the stroke it went into.
- **Kept, the ya:** 718 (718.s2 + 718.s1), 719 (719.s1 + 719.s0) and 720
  (720.s1 + 719.s0; the S-curve is shared, so each ya's own head takes it
  in). The notch and spur where head met S-curve (`((^`) are gone, and
  the outline flows through as the studio's does. Overlap barely moved:
  718 0.905 → 0.904, 719 0.905 → 0.898, 720 0.917 → 0.915. The S-curve
  is still thinner than the studio's, and a small spike stays where the
  S-curve meets the body (`()^`).
- **Not kept, the mim:**
  - 552 (the loop backwards from its left, then the bar) left a lump
    inside the counter, where the path turns back sharply into the bar;
  - 553b (tail, bar, loop, left side) looks as before, spur included.

  With the two end-tuning runs, that is the mim's third failed fix. It
  goes back to the user.

**The ya's S-curve into its tail, `))^` (2026-10-22).** The user: "there
are still step-offs at ))^".
- **What was tuned:** `joint.py`, with the bend gate, on the merged
  stroke's last end and the tail's first end, in 718, 719 and 720. The
  tails are 718.s0, 630.s0 (shared with 630 and 726) and 720.s2 (shared
  with 724).
- **Result:** the spikes and the sliver at the V are gone, and the outer
  edge runs straight down as the studio's does.
- **What was saved:** only these ends were kept, as `.f`. The head's
  first four nodes were put back from the merge, since that run had also
  tuned the opening and it did not come right (below). `keep.py` scores a
  merged stroke against its first piece alone, so the gap it prints there
  (2.7) means nothing; the sheet scores the whole shape.

**The ya's opening cut, not solved (2026-10-22).** The user: "the starting
strokes of 718, 719, and 720 on the top right are showing a start at the
wrong angle." The fit makes the head's thick bulb by spinning the nib
about 130° over its first four nodes (−30° to 95°). So the first stamp
lies at a slant no pen holds there, and it leaves a straight cut with a
notch on the inside. The studio's inner edge curves down to a sharp
point. Five tries, none clean:
1. **Searching the first nodes' angle over the whole half-turn
   (`startangle.py`):** the ink near the tip prefers the low angle, so
   nothing changed.
2. **Holding the studio's steep slant:** the bulb thins to a hairline.
3. **A narrow opening stamp at −45°:** good on 719, but it bares the
   bulb on 718 and 720.
4. **`joint.py` from there:** it can't win the bulb back.
5. **Narrowing only the opening stamp:** the cut and notch go, but the end
   is blunt and stops short of the studio's point.

It goes back to the user.

**The pen climbs first (2026-10-23).** The user: "The pen moves up first
for a very short stroke." The fit already climbed, about 0.6 nuqta from the
tip, but it spun the nib while climbing. `SCRATCH/me/upstart.py` swaps the
nodes before node j for one straight climb (length, lean and nib angle
searched) and keeps the rest:
- **The nib held over the climb, the old angles after it:** the search picked
  a 0.4 nuqta climb leaning 30° left, nib 70–80°. The point lands where the
  studio's does. But the nib then swings back (70° → 11° → 52° → 99°), which
  leaves a jagged step on the right edge and a notch inside. Nothing better
  for 718.
- **The nib turning one way only (`UP_RAMP=1`, eased from the climb's angle
  to node 5's):** this scores worse than now on all three, yet by eye it is
  the cleanest start so far on 719 (0.4 nuqta, −30°, nib 75°): a sharp
  point, no step, no notch, the inner edge curving down. Its right shoulder
  is narrower than the studio's. Flatter nibs (55–65°) push the point out
  past the studio's and leave the shoulder thin.

Not kept. It goes back to the user with the 719 close-up.

**The mim's joints after the video (2026-10-23).** The user pointed to a
lesson video for the meem (its order is under the Meem's method). In 552
the fitted bottom band opens with a hook down the head's bottom right, its
nib spinning about 150° (27° to −128°). That hook is what fills the
corner and leaves the notch inside the counter. The arch's right side
thins to a hair there instead of coming down full width.
- **The hook dropped, the nib held at the band's own angle:** the notch
  goes, but the corner is left bare (0.968 → 0.947).
- **Also holding the arch's right side flat (125–150°) to fill the
  corner:** the side swells into the counter and spikes out at the bottom
  (0.940). The fitted path runs along the inside of that side, so angles
  alone can't move it there.

Not kept. Moving the path needs a refit from the video's order, with the
nib's turning limited. It goes back to the user.

**The refits from the video's order (`SCRATCH/me/qmim.py`, 2026-10-23).**
The user: "Add it to the queue."
- **552, the arch refined beside the hookless band:** the band was held
  fixed as ink, and the arch's two lowest nodes held the nib at 125°
  (`.w1`) or 140° (`.w2`). Both came back worse (0.968 → 0.954, 0.951).
  The right side bulges into the counter, and the bottom right still
  spikes. Not kept.
- **553b, the arch's left end pinned to the left side's first node:** the
  spike at the top left goes, and the outer edge runs into the left side
  as the studio's does (0.958 → 0.962). A small sliver is left inside the
  counter's top-left corner. For the user's approval.

**The ya's head in a lesson video (2026-10-23).** The user pointed to a
second video, for the ya.
- **The head:** the pen lands under the right dot and climbs straight up
  half a nuqta with the nib held at about 40°. That makes a thick bulb,
  its sharp corner pointing down and to the left. Without lifting, it
  rolls over the top and sweeps down to the left into a hair.
- **The S-curve:** the pen lifts after the head and is set down again at
  the head's end, then goes down to the right, curving at both ends.
- **The tail:** it starts at the S-curve's end, goes down to the left 2.5
  nuqta, then straight left and up into the curve.

Built on 719 with the video's nib (40°, a straight climb of 0.5 nuqta,
then turning one way), the point lands at the bottom left, as in the
video. The studio's point is at the bottom right, so the studio's hand
needs the steeper nib (75°, leaning 30° left) shown before. Not kept;
the user decides between them.

**Kept: the video's head on all three ya (2026-10-23).** The user: "It
doesn't have to match the studio. It is fine if it matches the video."
On 718.s2, 719.s1 and 720.s1, the nodes before node 1 became a straight
climb of 0.5 nuqta with the nib at 40°. The nib then turns one way to
node 5's angle (`SCRATCH/me/yavid`, kept with `keep.py`). The slanted cut
and its notch are gone, and the point sits at the bottom left as in the
video. Overlap falls, because the studio's point is elsewhere: 718 0.905 →
0.890, 719 0.901 → 0.883, 720 0.915 → 0.903; Ya isolated mean 0.898 →
0.889.

**A lesson video is a reference too.** Where the user gives one, the
letter may follow the video instead of the studio.

**Two strokes that meet where the pen lifts (2026-10-23).** The user, of
the ya drawn as a head and an S-curve: "the strokes don't line up ... is
there a solution". The rule: the next stroke starts where the last one
ended, at the same place and nib angle, as a pen is set down where it
lifted.
- **Refitting the S-curve with its first node pinned to the head's end**
  (`SCRATCH/me/qya.py`, `<job>.p`, the head held beside it as ink): the
  lift came out clean, but the S-curve's far end lost its tuning into the
  tail. It left spikes on the outer edge, and on 719 and 720 a wedge into
  the counter.
- **Splitting the kept one-stroke path at the lift** (`SCRATCH/me/yasplit`,
  head = nodes up to the lift, S-curve = nodes from it on, so the two share
  that node): both joints stay as clean as one stroke (718 0.890 → 0.890,
  719 0.883 → 0.883, 720 0.903 → 0.902). 720 uses 719's S-curve, and its
  head ends 0.016 nuqta from 719's, leaving a slight bump where the
  S-curve meets the tail. For the user's approval.

Wherever a letter's strokes are first fitted as one and then split at a
lift, the split keeps the joint clean. Fitting each stroke on its own
never lines them up.

**Kept (2026-10-23).** The user: "The 2 stroke ya seems better to me. 553
also seems better. Small spur that needs to be fixed."
- **The ya:** split at the lift on 718, 719 and 720 (heads from
  `me/yapin`, S-curves from `me/yasplit`). The `merged` marks are gone, so
  the sheet draws two strokes.
- **553b's arch:** the refit from the video's order, its left end on the
  left side's first node (`553b.s0.w1`).
- **553b's spur:** the bar's end and the arch's start already nearly met at
  the head's bottom right (0.05 nuqta apart, nib 84° and 77°), and the
  arch's first stamp poked out below the bar as a spur. Now the two share
  one node, 8% along the arch's first chord, at the arch's nib angle
  (77.2°). The spur is gone and the right edge stays on the studio's
  (0.9618 → 0.9620). The same point at 20% along also clears it, but
  leaves the right side short of the studio's. A small wedge is still
  inside the counter's top-left corner; changing the angle there (80°,
  95°) swelled the outer edge, so it was left.

**The jim's bowls with a pen as wide as the band (`SCRATCH/me/widen.py`,
2026-10-23).** The user picked the jim group next. After 101 (its
counter, see "fill" above), the lowest were the isolated 090 and the
final 144, both 0.88. Both missed in one place: the bottom of the bowl.
The studio's band there is 1.3–1.35 nibs across, and our standard pen,
centred in it, left a strip bare along both edges. This is 092's case
("092's lower stroke" above), so the same rule, made general for any
stroke:
- Where the standard nib's end stands more than 0.01 nuqta inside the
  studio's piece, the node's width is the ink's chord along its own nib
  line, 0.005 inside both edges, capped at 1.5 nibs. The node moves to the
  chord's middle.
- The widths and moves are smoothed over three nodes ([1, 2, 1]), so a
  single wide node never bulges. Nib angles stay as they were.
- Kept for the bowls (144.s1, 090.s0, widest 1.35) and the head bars
  (144.s0 1.09, 090.s2 1.18). Nodes moved 0.05 nuqta at most.

| shape | before | after | worst miss (nuqta) |
|---|---|---|---|
| 144 | 0.876 | 0.977 | 0.126 → 0.050 |
| 090 | 0.878 | 0.978 | 0.156 → 0.141 |

090's worst miss is the bar's right corner, unchanged. The pen changes
width along the bowl, as 092's does, which is still the user's call
(see 092).

**The same pen over the whole jim group (2026-10-23).** The rule was run
on all 219 of the group's distinct strokes, with fill marks and merged
strokes left out. A stroke was kept only if every shape that draws it
gained at least 0.003 or held, lost no more than 0.001, and its worst
miss grew no more than 0.005.
- 101 strokes passed. 118 changed nothing, because the standard pen
  already covers them. None got worse.
- 093's two strokes were left out: the user approved 093 as it is
  (2026-10-22).
- **The eye check.** Every stretch widened past 1.15 nibs (29 strokes) was
  looked at three times larger: now, after and studio. Each was closer
  to the studio's. One fault came from the rule itself. Each stroke's
  end nodes were kept at their old width, so beside a widened neighbour
  the first stamp was narrower and cut a step into the end (108's head
  tip). Now an end takes the added width it shares with its one
  neighbour ([2, 1]). Only the added width is smoothed, so a thin start
  such as 144's 0.5 stays thin.
- 108's tip still showed a nick on the cut. The bar, now wider, stops
  just above where the lower stroke ends. The bar's last nib was
  lengthened 0.08 nibs down the cut, eased over three nodes. That left
  a hairline; a longer nib overshot the studio.
- **Kept:** 99 strokes, as `.f` (`me/wdgood2`).

62 shapes draw them (the jim group's, plus 233, 360b–d, 702, 705 and
707, which share strokes). Their mean overlap went from 0.948 to 0.977,
the lowest is now 233 at 0.954, and no worst miss grew. By form, the jim
group was 0.940–0.965 and is now 0.976–0.981.

| shape | before | after |
|---|---|---|
| 135 | 0.898 | 0.984 |
| 116 | 0.908 | 0.980 |
| 095 | 0.916 | 0.977 |
| 108 | 0.916 | 0.976 |
| 142 | 0.920 | 0.967 |
| 132 | 0.925 | 0.982 |
| 131 | 0.926 | 0.968 |
| 101 | 0.930 | 0.980 |

Small faults left, all smaller than before:
- a hairline nick at 108's head tip;
- a tiny step near 131's head tip;
- a tick at the end of 132's bar;
- a spike at the top right of 112's head;
- the left points of 131 and 142.

510 strokes across the catalogue are wider than 1.08 nibs over a fifth
of their length (see "Strokes wider than the nib"). The other groups are
next, if the user agrees.

**The same pen over every other group (2026-10-23).** The user: "yes.
run the same pass." The rule and the gate were the same as for the jim,
with ends sharing their neighbour's widening from the start. The pass
covered 2,278 distinct strokes. It left out fill marks, merged strokes,
the jim group (done), and every stroke of a shape the user has approved
(the alifs, Ra Zay Isolated, 158, 159, 093). Whether those get the wider
pen too is a question in the decisions folder.
- **The numbers:** 964 strokes passed, 1,307 changed nothing, and 7
  failed the gate (on worst miss).
- **Held for the user:** 080.s0. Whether 080 keeps its refit is an open
  question, and the wider pen was built on the refit.
- **Judged together:** the 626 shapes that draw the passing strokes. None
  fell, and no worst miss grew. Their mean overlap went from 0.947 to
  0.968. The ya finals rose most: 728 0.828 → 0.977, 732 0.856 → 0.975,
  729 0.881 → 0.977.
- **The eye check:** the 90 strokes widened past 1.2 nibs were looked at
  three times larger: now, after, studio. Nine came back with a new
  small nick or bump, and are not kept: 165.s2, 180.s5, 436.s2, 438.s1,
  556.s3, 719.s0, 722.s0, 723.s0 and 066.s0. Their files are in
  `me/wpass/held`, for an end fix later.
- **Kept:** 954 strokes as `.f` (`me/wpass/good`). The 119 widened only
  1.15–1.2 nibs were not looked at close up. They show on the redrawn
  sheets.
- **A slip, found on the redrawn sheets and put right:** `keep.py`
  rewrote each kept stroke's `fixes.json` entry and dropped its other
  keys.
  - 068.s0 and 069.s0 lost `with`, their second pen stroke, and half of
    each shape vanished (0.95 → 0.72 and 0.76). The key is restored,
    and their widened strokes stay. Both had been judged with the second
    stroke drawn, and both now score above where they began.
  - 085b.s0 lost `accepted` ("85b is fine", 2026-10-21) and was widened
    though the user had accepted it. It is back as accepted (the widened
    file is in `me/wpass/held`) and is part of the decision on approved
    shapes.
  - `keep.py` now keeps every key but `use` and `merged`.

All 781 shapes on the sheets, before → after:
- **Mean overlap:** 0.950 → 0.967.
- **Under 0.90:** 18 → 2 (H01 0.874, 719 0.898).
- **Under 0.95:** 309 → 65.
- **Fell:** none.

| group | shapes | before | after |
|---|---|---|---|
| Ya | 16 | 0.909 | 0.965 |
| Sin Shin | 68 | 0.935 | 0.960 |
| Fa | 7 | 0.942 | 0.965 |
| Fa Qaaf | 55 | 0.944 | 0.962 |
| Qaaf | 6 | 0.944 | 0.961 |
| Kaf | 52 | 0.946 | 0.974 |
| Ba Ta Tha | 81 | 0.947 | 0.962 |
| Ha | 71 | 0.947 | 0.965 |
| Sad Dad | 42 | 0.947 | 0.969 |
| Mim | 82 | 0.949 | 0.963 |
| Ta Za | 41 | 0.951 | 0.973 |
| Waw | 6 | 0.954 | 0.972 |
| Lam | 75 | 0.958 | 0.969 |
| Nun | 9 | 0.958 | 0.976 |
| Ayn Ghayn | 63 | 0.959 | 0.975 |
| Dal Dhal | 8 | 0.963 | 0.978 |
| Ra Zay | 12 | 0.968 | 0.971 |
| Laam Alif | 5 | 0.972 | 0.976 |

(Alif, Jim Ha Kha and Hamza are unchanged by this pass.)

**The user's decisions (2026-10-23).** From now on each open question
goes to the user as one picture in the NAS folder `HarfCanvas
side-by-side/decisions/`, and the picture is deleted once answered.
1. **A pen that changes width along a stroke:** kept ("option 2"). This
   answers the question left open at 092. The wider pen stays on the
   jim group and every other group.
2. **The Ra finals' hats (161, 162, 164):** filled with the fine pen, as
   the alif's and dal's hats are. The user: "i cant tell the difference.
   option 2 is fine". 161.s0, 162.s2 and 164.s0 are now `fill`.
   161 0.978 → 0.981, 162 0.977 → 0.980, 164 0.962 → 0.976 (with the
   wider pen's gains).
3. **Ba medial 080:** back to the old fit ("go back to the old fit"); the
   refit's `use: ".v"` is gone. 0.938 → 0.887, and the notch at its end
   is gone. Widening the old fit gained only 0.002, under the gate, so it
   stays on the standard pen.
4. **Mim 552's head corner:** "try", by the split-at-the-lift rule
   (`SCRATCH/me/split552.py`). The arch (552.s2) ends at the head's
   bottom right, nib 96.7°. The bottom band (552.s1) had opened with a
   hook there, its nib spinning 27° → −94°. That hook made the notch
   inside the counter and the spur under the corner.
   - **The fix:** the band's first three nodes were dropped. It now
     starts on the arch's corner node, at the same nib line (−83.3°), and
     runs on from its fourth node.
   - **What was searched:** moving the shared node along the arch's first
     chord (0–30%) only made it worse, and joining at the band's second
     or third node was close behind.
   - **Result:** overlap 0.971 → 0.974; worst miss within 0.5 nuqta of
     the corner 0.094 → 0.031. At three times the size, the notch and
     the spur are both gone.
   - **Still there:** the counter's top is more pointed than the
     studio's round one. That is the arch's own shape.
5. **Mim 553b's small wedge:** left ("leave").
6. **The wider pen on approved shapes:** yes ("option 2"). 19 strokes
   kept, after the same close-up check. The approval stands on the wider
   versions. Biggest gains: 007 0.922 → 0.970, 002 0.930 → 0.963, 093
   0.949 → 0.979, 085b 0.919 → 0.937. 158 and 159 changed nothing.

**The held strokes (2026-10-23).** The nine strokes held from the pass for
a nick were tried again. `widen.py` gained two settings for this:
- `WIDEN_PASSES` smooths the added width and the moves more than once;
- `WIDEN_TAPER "a b"` eases the widening off over the first a and last b
  nodes.

The taper puts the lift rule into the widening. Where a stroke hands over
to another at a lift, the two must meet with the same pen. A widened end
beside a standard-pen neighbour leaves a step.

| stroke | kept as | shapes |
|---|---|---|
| 165.s2 | smoothed 3× (its nick was already there at a join) | 165 0.953 → 0.974, 242 0.970 → 0.977 |
| 722.s0 | smoothed 3× (the same) | 722 0.951 → 0.965 |
| 719.s0 | smoothed 3×, eased off over the last 5 nodes before the tail | 719 0.898 → 0.939, 720 0.925 → 0.954 |
| 180.s5 | smoothed 3×, eased off 3 nodes at each end | 180 0.949 → 0.970 |
| 556.s3 | the same | 556 0.959 → 0.972 |

Still held: 436.s2 and 438.s1 (a notch at the counter's corner), 723.s0
(a notch on the inner edge), and 066.s0 (gains too little). They keep the
standard pen.

**The hamza H01 (0.874), the last shape under 0.90.** Its two head
strokes spin the nib 150° and more over less than a nuqta, faking the
shape. The course (lesson 31) writes the hamza's head like the ain's, and
of the ain's head (lesson 13): "Part of the head is drawn with a pen
stroke; the rest is finished with the tip of the pen." So the head may be
a fill mark, like the alif's hats and the jim's starting marks.
- Filling the top piece (H01.s1): 0.928.
- Filling both head pieces (H01.s0, H01.s1): 0.955.

Fills have always been the user's call, so this went to the decisions
folder as decision 7.

**Decision 7 (2026-10-23): option 3.** The user: "fill both pieces of the
hamza's head". H01.s0 and H01.s1 are filled marks now (`fill` in
`fixes.json`), and the tail stays a nib stroke. H01 0.874 → 0.955, and no
shape is left under 0.90 except 080, the user's old fit. The picture is
in the fixes folder ("Hamza H01 - head filled with the pen's tip").

**Reused strokes given their own fits (`SCRATCH/me/split2.py`,
2026-10-23).** 527, 527a and 429 each had a block of ink past the end of
their bottom stroke. The stroke was fitted in another shape and moved in,
and in its home shape the studio's piece runs that far. Trimming the end
(`hair.py`) stopped at 0.2 nuqta, because the home shape (506) would
lose.
- **The measure:** `split.py` (see "a reused stroke can overshoot") had
  not been run since the early fits. Run again, 85 of 757 reused strokes
  overshoot by more than 0.01 square nuqta.
- **The change:** `split2.py` is the same measure in two steps. `queue`
  sends the own fits to the Geekmini without touching the registry, so
  the sheets never show a shape waiting. `adopt` switches a shape to its
  own fit only once the fit is back and the shape's overlap rises.
- **Result:** all 85 came back. 77 were adopted. Eight weren't, because
  they didn't help (049 would have fallen 0.958 → 0.937).
- **Gains:** 527a 0.911 → 0.979, 527 0.917 → 0.974, 429 0.910 → 0.953,
  524a 0.931 → 0.973, 524 0.936 → 0.974, 526 0.941 → 0.968, 486 0.960 →
  0.975. No shape fell.

After the whole day: mean overlap 0.950 → 0.969 over 781 shapes; under
0.95, 309 → 40; under 0.90, 2 (H01, waiting on decision 7; 080, the
user's old fit).

**The wider pen on the Geekmini (`scripts/pen/widenjob.py`,
`SCRATCH/me/wjob.py`, 2026-10-23).** The user asked for widening passes
to run on the worker. Until now the worker could only fit a stroke.
Judging a widened stroke needs the sheets, the registry and the studio's
outlines, and those are only on the laptop.
- **The job:** `fitjob.py` has a third mode, "widen". It widens one stroke
  and judges it, before and after, on every shape that draws it.
- **What the laptop does:** the job carries everything the worker needs.
  `wjob.py queue` works out every other stroke of each shape on the
  laptop, as the sheet draws it at that moment, and puts their nodes in
  the job. The worker reads nothing but the job. A fix adopted while jobs
  wait can't change what they measure.
- **Collecting:** `wjob.py collect` writes the candidates in `widen.py`'s
  form, so `combo.py`, `widezoom.py` and `keep.py` run on them unchanged.
  It flags any shape whose "before" differs from the sheet's score.
- **One copy of the method:** `widen.py` now imports its method from
  `widenjob.py`, so the laptop and the worker run the same code.
- **The check:** five strokes (589.s0, 683.s0, 684.s3, 189.s0, 212.s1)
  were run three ways: the old `widen.py`, the new job on the laptop, and
  the new job on the Geekmini. All three gave the same nodes and the same
  numbers to the fourth decimal. Nothing from the check was adopted.
  (212.s1 and the first three were already widened, so their "after" is
  the pen widened twice. That is no candidate.)

**The first settings grid on the Geekmini (`wjob.py grid` / `pick`,
2026-10-23).** It covered 13 strokes still on the standard pen: the four
held ones (436.s2, 438.s1, 723.s0, 066.s0) and every unwidened stroke of
the lowest Sin shapes (204, 212, 189) and of 043 and 743.
- **The grid:** each stroke under 96 settings. Smoothing passes 1, 2, 3
  or 5; moves at full, half or none; eased off over 0, 2, 3 or 5 nodes at
  either end. That made 1,248 jobs, about 25 minutes on the worker.
- **Where the time goes:** a job computes for about 1 second. Its other
  ~6 seconds go to the queue: a fresh Python, NAS reads and writes,
  listing a 1,000-file todo folder. The worker runs 6 at once
  (`workers.json`). A GPU would not help. Batching the settings of one
  stroke into one job would.
- **A crash:** 043.s1 has two nodes, and a taper longer than the stroke
  indexed past it (60 jobs failed). `widen()` now clamps the taper to the
  stroke.
- **Passed the gate, kept after a close-up:** 189.s2, smoothed twice,
  moves halved, eased off over its first 3 nodes (p2m05t3-0). 189 0.923
  → 0.934. The bowl takes the studio's weight with no new notch.
- **Passed the gate, dropped by eye:** 212.s2 (+0.003) and 066.s0
  (+0.004). Each adds a nick on its inner edge.
- **Nothing passed:** 018.s0, 043.s1, 189.s0, 189.s4, 189.s5, 212.s0,
  743.s0. The Sin teeth are not a pen-width problem.
- **Asked the user:** on 436.s2, 438.s1 and 723.s0 every setting leaves
  the notch, the end tapers included. That is the third way tried on
  them, so they went to the user as decisions 11 (the qaf's counter
  tooth) and 12 (ya 723's inner dent). Each image shows the gain against
  the flaw.

After: mean overlap 0.969 over 781 shapes; under 0.95, 39.

**Decisions 11 and 12 (2026-10-23): the standard pen.** The user:
"Standard pens for both 11 and 12". 436.s2, 438.s1 and 723.s0 keep the
standard pen, so the qaf's counter and ya 723's bend stay as they were. A
clean outline is worth more than the overlap. Each now carries
`standard_pen` in `fixes.json`, and `wjob.py` skips those strokes, so no
later pass widens them again.

**A stroke's whole grid in one job (2026-10-23).** A widen job may carry
`variants`, a list of settings. The worker runs them all, judging
"before" once. The batched grid matched the 192 single jobs for 436.s2
and 723.s0 exactly, in about 1 minute instead of 4. `wjob.py grid` now
submits one job per stroke, and `pick` reads both forms.

**Reruns of the shapes under 0.90 (`SCRATCH/me/vpass.py`, `vjudge.py`,
2026-10-22).** The user agreed to rerun the 32 shapes under 0.90, but not
everything under 0.95. That was 343 shapes, most on pages already passed,
and many are held down by the studio's pen changing width, which a refit
cannot follow.
- **The refit:** every stroke was fitted afresh as `<job>.v`, with nodes
  0.15 nuqta apart and the outline weighed eight times, its neighbours as
  ground. 90 strokes went to the Geekmini. Fill marks and strokes already
  rebuilt by hand were left alone.
- **The automatic judge:** a `.v` replaced what the sheet draws only if
  every shape using the stroke gained at least 0.002 on average, none lost
  more than 0.001, and none's worst miss grew more than 0.005.
- **The eye check:** the judge passed 26. Looking at them turned down 7
  more:
  - 475.s0, 452.s3 (the kaf's tail in 475 and 486), 195.s3, 729.s0 and
    728.s0 came back wavy or hooked at an end;
  - 189.s1 notched 204's last tooth;
  - 174.s2 notched 197's.

  The worst-miss measure doesn't see a wave. A count of bends on the
  outline didn't separate good from bad either, so the eye decides.
- **Kept as `use: ".v"`:** H01.s0, H01.s1, 085d.s0, 016.s0, 085c.s0,
  554.s0, 237.s0, 174.s1, 377.s1, 080.s0, 223.s2, 342.s1, 412.s0, 412.s1,
  412.s2, 500.s3, 577.s0, 578.s1 and 718.s1.
- **Overruled the worst-miss gate:** 048.s0 and 055.s0 each improved by
  about 0.05, but their tips ran on past the studio's. Each was cut back
  0.25 nuqta (`hair.py`) and kept as `.f`.

| shape | before | after |
|---|---|---|
| 048 | 0.812 | 0.935 |
| 085d | 0.872 | 0.943 |
| 085c | 0.880 | 0.942 |
| 080 | 0.887 | 0.938 |
| 055 | 0.890 | 0.938 |
| 412 | 0.899 | 0.957 |
| 223 | 0.898 | 0.933 |
| 524a | 0.899 | 0.931 |
| 578 | 0.881 | 0.930 |
| 718 | 0.890 | 0.905 |

412's sharers 419, 426, 427 and 428 rose about 0.04 each. Shapes under
0.90 went from 32 to 20. 080's end gained a small step, and is kept for
the user to judge on the sheet.

**Judging a group.** Each letter group and form has a sheet of every
shape, ours beside the studio's, with the shape's overlap. Both sides
are drawn at four times the size and scaled down alike. Drawn straight
from the nib's overlapping stamps, ours looked stepped beside the
studio's single outline; the app draws ours as one smooth outline (the
user, on the first alif sheets: "the studio's are still smoother", which
this was). A shape under
0.85 is marked in red. Each sheet is checked by eye before its group is
recorded: by the user's standing instruction, a group that matches within
reason is recorded and work moves on. The user looks periodically.
A group enters [studio-catalogue.md](studio-catalogue.md) only once the
user has approved it (`approved.json` in the authoring scripts, with
their words). **Alif: approved 2026-10-20**, after the fixes to 001 and
005: "the fixes worked really well and you can now add all alifs".

## Joins

**Fit each stroke with its neighbours' ground ignored** (2026-10-19). A
stroke fitted alone against its own reference piece is penalised for any
ink outside that piece, and at a join the neighbouring piece sits exactly
where the corner should be filled. So every end was pulled back from its
corner, and every join was left with a notch: a wedge of paper where the
studio has ink. The user saw it at ya into alif in حياتي, and in the jim's
head (092). Now the shape's other strokes go with each stroke as ground
where ink counts neither for nor against it (`ignore` in `fitjob.py`,
`gpufit.refine` and `pieces.refine`). The stroke runs on through the corner
and its neighbour covers the rest. Measured on الحب حياتي, in square nuqta
of studio ink within 0.8 nuqta of the join left bare:

| join | before | after |
|---|---|---|
| curved alif into lam | 0.060 | 0.003 |
| ya into alif (حياتي) | 0.068 | 0.010 |
| ha into ba | 0.018 | 0.006 |
| the final ya's two strokes | 0.027 | 0.014 |

How far our ink strays outside both studio pieces fell too (the curved
alif 0.195 → 0.087 nuqta, the ba's start 0.230 → 0.021). A stroke's score
against its own piece alone can fall, because its ink now lies on its
neighbour's ground; judge a join on both pieces. Two joins did not improve
(ha into ya 0.014 → 0.017, ta into ya 0.004 → 0.007), and those strokes
kept their earlier fits. The catalogue's first fits carry their shapes'
other strokes as `ignore`, and strokes fitted before this get a join refit
(`<name>.j`) from their best fit.

- **A tooth onto a meem:** stacked. The tooth's stroke runs on and becomes
  the meem's loop, one stroke split between the two letters with gap 0 and
  rise 0.
- **A meem into a final nun:** the pen lifts. The meem's exit band ends in
  the nun's arm, and the nun's knot covers the seam.
