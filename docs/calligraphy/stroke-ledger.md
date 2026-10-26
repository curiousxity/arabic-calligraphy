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

**The shapes under 0.95 (2026-10-23, "Let's do 3 2 and 4").** There were
38, leaving out 080 (the user's old fit). Everything ran on the Geekmini,
in three passes. Each was judged by the sheets and then by eye close up,
and every kept change has a before/after/studio picture in the fixes
folder.
1. **Tight refits** (`vpass.py`, `<job>.v`, nodes 0.15 nuqta apart,
   outline ×8). They went to the 49 strokes never refitted before. 28
   passed `vjudge.py` and 25 were kept.
   - **Dropped by eye:** 413.s0 (a hairline spur off the head, in 413 and
     420), 436.s2 (kinks in the qaf's counter, which decision 11 had just
     kept clean), 212.s2 (a kink where the tooth meets the bowl).
   - **Gains:** 215 0.924 → 0.944, 054 0.932 → 0.970, 044 0.927 →
     0.948, 066 0.933 → 0.956.
2. **Polishes of hand-fixed strokes** (`qpass.py`, `<job>.q`). Each is a
   GPU refine from the nodes drawn now, with the widths held. They went to
   the 45 strokes with "refit", which pass 1 leaves alone. 19 passed and 17
   were kept. `vjudge.py` judges them with `VJUDGE_SUFFIX=q`, and
   `keep.py` writes them as `.f`.
   - **Dropped by eye:** 719.s0 (opens a sliver of paper inside 720's
     S-curve), 020.s0 (puts a corner into the lower edge at 045's start).
   - **Changed before keeping:** 719.s1. The polish had moved its end 0.8
     nuqta off the node it shares with 719.s0, which left a spur at the
     lift. With the end put back on that node (the lift rule), 719 went
     0.939 → 0.956, clean, the head's hook as the studio's.
   - **Gains:** 204 0.910 → 0.954 (the first hump, low by ~0.15 nuqta, now
     in place; the shortened tooth tips held), 071 0.941 → 0.964, 046
     0.941 → 0.968, 261 0.933 → 0.952, 709 0.939 → 0.957.
3. **The wider pen on the 25 refits** (the batched grid). 25 jobs held
   2,400 settings and took a few minutes. 16 passed the gate, and all 16
   were clean close up. 215, 225 and 401 each lost a small notch. Gains:
   066 0.956 → 0.970, 401 0.962 → 0.973, 044 0.948 → 0.955.

After: mean overlap 0.970 over 781 shapes. Under 0.95: 39 → 17. Under
0.93: 4 (080, 043, 743, 413).
- **043 and 743:** no refit passed, so they are as they were. Both are
  small shapes, and their misses are thin slivers along the edges and
  the cut at one end.
- **The other 13** sit between 0.936 and 0.949.

**Hairs at the ends of the remaining 17 (`hair.py scan` / `trim`,
2026-10-23, "Next").** Ten stroke ends strayed more than 0.1 nuqta past
the studio's ink.
- **Trimmed and kept (8):** 189.s3, 189.s4, 212.s1, 216.s0 (its start,
  0.32 → 0.09 nuqta), 216.s1 (in 216, 217, 221 and 227), 216.s2, 253.s0
  and 396.s3 (0.39 → 0.21). Every shape using them kept or raised its
  overlap, and the close-ups are clean.
- **Not trimmed:** 743.s0, 189.s5, 216.s0's end and 744.s0. Every trim
  that would remove their hair loses overlap somewhere.
- **The gains are small** (216 0.937 → 0.940). The mean holds at 0.970,
  with 17 shapes under 0.95.
- **What is left in the Sin teeth:** the tooth tips stand as thin spikes
  where the studio's are a little shorter and rounder. Most of the
  remaining misses are this and thin edge slivers, near what a
  nib-stroke model reaches.

**Library review begun (2026-10-23, "Lets do 1").** Every group and form
sheet not yet approved went into the NAS folder `HarfCanvas
side-by-side/review/`. That is 68 sheets, numbered and named with their
shape count, mean and lowest overlap. The user approves or flags them by
number.
- **An approved sheet** goes into `approved.json` as "Group - Form", with
  the user's words, and its file moves to `review/approved/`.
- **A group** enters `studio-catalogue.md` (`catalogue.py`) once all its
  sheets are approved.
- **Approved before the wider pen:** Ra Zay Isolated and Sin Shin
  Isolated and Initial were approved on 10-22 and have been widened since,
  so they are listed again for the user to confirm.
- **The catalogue's Alif section** was regenerated: mean 0.956 → 0.971,
  lowest 0.922 → 0.955.

Approved in review:
- 2026-10-23, "01, 02, 03, 04, all good": Ayn Ghayn Isolated, Initial,
  Initial & Medial, and Medial.
- 2026-10-23, "7 and 10 good": Ba Ta Tha Isolated and Final.

**Review 12, Dal Dhal Isolated: "spur at ))^" (2026-10-23).** At the
joint of the dal's two body strokes, the end of 146.s3 (used in 146 and
147) left a small hair on the outer edge of the elbow. Its nib corner
poked out past the lower stroke.
- **Not the lower stroke:** trimming the start of 146.s2 left the hair
  where it was.
- **The scan missed it** at 0.1 nuqta. `hair.py trim` refuses the cut,
  because 146 loses 0.001.
- **The fix:** `hair.cut` 0.06 nuqta off 146.s3's end, by hand. 146
  0.980 → 0.979, 147 0.984 → 0.985, and the hair is gone in both. A clean
  outline over a thousandth of overlap, as in decisions 11 and 12. The
  sheet is redrawn and back in review.

Approved in review, 2026-10-23: Jim Ha Kha Isolated (25, "25 is fine")
and Final (28); Kaf Isolated (30) and Initial (31).

**Review 19, Ha Isolated 643: "spur on the left and divot on the right
[of] the right eye" (2026-10-23).**
- **The divot:** 643.s2 runs along the eye's floor and curls up into its
  right corner, the nib turning 133° → 258° over its last three nodes.
  The floor sagged into a rounded pocket where the studio's runs straight
  into a sharp corner.
  - **Tried and dropped:** holding or slowing the nib turn (0.940, 0.950)
    and widening the end (0.957).
  - **The fix:** a new tool, `eyetune.py`. It moves chosen nodes in
    0.04/0.02/0.01 nuqta steps, scored on overlap less the mismatch inside
    a window around the flaw. It started from the GPU polish of 643.s2
    (`.q`, which had not passed the gate this afternoon). A second run
    with the window weighed ×15 took out a nick the first run left. 643
    0.963 → 0.974, kept.
  - **Dropped along the way:** smoothing those nodes widened the nick.
    The tuned 643.s1 rounded the left eye's corner, so s1 stays as it was.
- **The spur:** a small hook at the right eye's top-left corner, where
  the tail stroke 643.s0 and 643.s1 end under the ink.
  - **Tried:** cutting 643.s4's end (no change) and tuning s1's nodes (no
    change). Cutting 0.1 nuqta off s0's end and tuning its last nodes
    clears the hook, but rounds the left eye's lower-right corner.
  - **Three ways tried,** so it went to the user as decision 13: keep the
    hook, or remove it with the rounder left-eye corner.

**Review 24, the hamza H01: "a bit too pointy" (2026-10-23).** The tail
(H01.s2, the one nib stroke left after decision 7) thins to a point and
runs on past the studio's broad, square-cut end. Over its last stretch
the nib lies almost along the stroke. The letter is 1.5 nuqta across, so
the nib covers much of it.
- **Tried:**
  - cutting the end and turning its nib (every cut loses 0.025 or more);
  - `eyetune.py` with the nib angle as well (`EYETUNE_ANGLES=1`, 0.962,
    still pointy);
  - the wider pen, 96 settings, none passing.
- **Decision 14:** keep the nib's point, or fill the tail with the pen's
  tip too (0.979).

**Review 35, Laam Alif Isolated: "spurs on the left head caps"
(2026-10-23).** The caps were filled with the fine pen from the studio
outline, as the alif's and Ra's hats are: 518.s6 and 575.s6 (in 714,
714a, 518, 575, 666), and 715.s0 and 715.s1. 714 0.979 → 0.982, 715
0.967 → 0.969, 714a 0.980 → 0.984. The rest rose a little.

**Review 49, Qaaf Isolated 437: "spurs at ((^ and ()^" (2026-10-23).**
Both came from 436.s1 (in 436 and 437): its start at the head-body joint
and its end where the two head strokes meet. Cut back 0.15 and 0.06
nuqta along its path. 437 0.936 → 0.938, 436 0.957 → 0.958. The same
hair went from 436.

**Review 62, Ta 274: "fix the head cap" (2026-10-23).** The cap pieces
274.s0 and 102.s7 were filled with the fine pen. They are used in 46
shapes, mostly Ta Za, and in one pair each of eight other groups. None
fell, mean +0.0014, 274 0.971 → 0.976. Every group they touch was
redrawn and its review copy refreshed.

The user added `` ` `` for a spur to the shorthand (2026-10-23).

Approved in review, 2026-10-23: Reset Final (53), Qaaf Final (50), Nun
Final (48).

**Spurs at a head-body joint: 234, 600, 628, 630 (reviews 54, 52, 47,
2026-10-23).** All four had the same flaw. The end of one stroke at the
joint poked a hair a pixel or two wide out past the edge of the stroke it
joins.
- **A new tool, `spurcut.py`.** It cuts an end back by the shortest of a
  ladder of lengths that clears the hair, with at most `SPUR_SLACK` of
  overlap lost in any shape that uses the stroke.
- **Measured by pixels, not distance:** a hair this thin stays close to
  the studio's ink, so `hair.stray` reads it as small. It is judged by
  its loose pixels within 0.35 nuqta of the end instead.
- **Run across every end, it cut too much,** since edge slivers count
  as loose pixels as well. So only the six ends with the hairs were cut:
  101.s5's start (0.25), 600.s0's start (0.16), 600.s1's end (0.35),
  628.s2's start (0.2), 628.s3's end (0.25) and 630.s1's end (0.13).
- **Result:** clean close up in all four. 234 0.976 → 0.977, 600 0.970 →
  0.972, 628 0.979 → 0.979, 630 0.978 → 0.978; 101 (it shares 101.s5)
  0.980 → 0.982.

**Review 16, Fa Qaaf Initial 403 and 409 (2026-10-23, "Big problems at
403v4", "Problems on both").**
- **The flaw in both:** the head does not run down into the body. In
  403, the head's outer stroke (376.s0) and the body (403.s2) began side
  by side, sharing neither a node nor a nib line (the lift rule). That
  left a wedge of paper inside the corner, the body's square corner
  poking out, a spur on the head's left and a deep counter. In 409, the
  head's lower edge broke into steps where it meets the body.
- **The Geekmini:** all six strokes (376.s0, 376.s1, 403.s2, 392.s0,
  392.s1, 409.s2) got a tight refit (`.v2`) and a GPU polish from their
  drawn nodes with the outline ×16 (`.q2`). Every combination was scored
  on both shapes that use them.
- **409:** the three polishes. 409 0.955 → 0.974, 392 0.968 → 0.973. The
  head now flows into the body.
- **403:** 376.s0 refitted and 376.s1 polished, then `eyetune.py` (nib
  angles too) on the first nodes of 376.s0 and 403.s2 together, twice,
  the second time with the joint weighed ×25. 403 0.967 → 0.978, 376
  0.960 → 0.964. The wedge, the square corner and the left spur are
  gone, and a small notch is left on the joint's outer edge.

**Review 15, Fa Final 432–435: "irregularities in the windows"
(2026-10-23).** Each loop is three strokes meeting around the counter:
the loop, a short inner stroke and the body. Each shape has its own.
Where they met, they left notches and spurs.
- **The tuning:** `eyetune.py`, nib angles too, on every node inside each
  window (8 to 24 nodes a shape), the window weighed ×10. All four ran at
  once on the laptop.
- **Result:** 432 0.958 → 0.974, 433 0.954 → 0.963, 434 0.966 → 0.973,
  435 0.968 → 0.979. Clean close up, and the windows now take the
  studio's shape.

**Review 05, Ayn Ghayn Final 370 and 371: "the initial ( stroke from the
joining previous word ... looks like a blob" (2026-10-23).** The head's
first stroke, where the pen arrives from the previous letter, began as a
blunt lump. The studio's begins with a slanted point.
- **The fix:** the first four nodes of 370.s1 (used in 370 and 371) and
  370.s0 were tuned with the start weighed ×15. 370 0.968 → 0.973, 371
  0.973 → 0.975.
- **The user's wider point:** "You are going to have to have some joining
  logic when we actually join." When the library builds words, each
  letter's entry stroke must be fitted or blended with the previous
  letter's exit as one pen stroke, sharing nib angle and width at the
  lift, not pasted beside it as the isolated studio piece. Noted for that
  work.
- **Second look:** "15 ok. 370 ok. 371 still has a bulbous configuration.
  Even the studio's 409 is incorrect" (2026-10-23). Fa Final approved,
  and 370 too. 371 and 409 went back to the user as clean pictures
  (ours beside the studio) to mark. The point about 409 is that the
  studio is not the last word there: its own neck has a step where the
  head meets the body.
- **Third look:** "5 371 the right connecting stroke is bloby", and later
  "still bloby on the right where it connects to the prior letter". 371.s0
  started with the nib spinning about 130 degrees over its first four nodes,
  which drew a round lump. Setting the start angles alone, or a straight
  run out to the end, did worse. `eyetune.py` on its first seven nodes,
  the end weighed x25, gave the studio's square cut (0.975 -> 0.978). The
  review copy of sheet 05 the user saw was older than this fix, so it was
  refreshed and the close-up sent for a further look.

**Reviews of 2026-10-23, second round.** The user's words are quoted per
item; the shorthand gained `&` (defect) and `%` (window).
- **Approved:** 13, 37 and 40 ("13 good", "37 ok", "40 ok"); 12 ("12 is
  good"), which completes Dal Dhal, the second whole group in the
  catalogue after Alif; 15, and 370 on sheet 05.
- **Filled with the fine pen** (the outline drawn as a filled mark, as the
  alif's and Ra's hats are): 714's right hat (496.s2, 501.s0; "35 714 right
  hat`"), 717's hat (717.s0, 717.s1; "36 717v2 hat`"), the hamza's tail
  (H01.s2; "24 right still too pointy", which settles decision 14 as
  option 2), and the kaf's S mark (032.s4, 185.s8, 032.s2; 290.s9, 185.s9,
  492.s0; 442.s4, 442.s5, 442.s6; "33 s in kaaf ` and ^&"). Every shape
  sharing those pieces held or rose (the S mark: 491 0.968 -> 0.978, 492
  0.971 -> 0.982, 442a 0.974 -> 0.982; 714 0.982 -> 0.984; H01 0.955 ->
  0.979).
- **A fill can't take a head with a window.** The Fa head's two pieces
  outline the counter between them, and each piece's outline filled
  closes it (372 0.968 -> 0.949). Heads with windows stay pen strokes.
- **Cuts:** 642.s4's end 0.2 ("19 642 ` bottom right"); 656.s6's start 0.8
  and 656.s7's 0.13 ("656 v13 `"); 373.s0's start 0.3, a hair below the
  Fa's neck in 373 and 374 that cutting its end did not touch.
- **553's head hair** ("553v2 ((`"): it was the start of 553.s0's nib edge,
  not an overshoot, so cuts lost overlap without clearing it. Its first
  node's nib turned 10 degrees and narrowed to 0.6 width cleared it.
- **The Fa necks** ("14 ()^ still wrong. Maybe use the videos as a
  reference"): the course (lesson 15) writes the head as two moves that
  stop square and are rounded with the pen's tip, then the Ba body from a
  1-nuqta neck. Our inner stroke ended in a tooth and a notch at the neck.
  `eyetune.py` on the neck's nodes, then a second pass with **the edge's
  length weighed** (`PERIM_W`: our edge length in the window against the
  studio's, so a spike or notch counts though it adds little area; also
  `EXTRA_WIN`, a window on each sharer) cleared them: 372 0.968 -> 0.975,
  373 0.971 -> 0.976, 374 0.973 -> 0.972 after the hair cut.
- **62's right joint** ("62 ))` right"): the ends of 274.s3/275.s4 and the
  shared body 274.s2 tuned with both shapes' joints weighed.
- **Sheet 23** ("653v10 saad ((^ issues. 656 v13 ` 657 v14 waw ((^` and ha %`
  659v16 ha laam ^&"): 657's waw head and ha window corner, and 659's
  ha-lam joint tuned with the edge length weighed (657 0.965 -> 0.968,
  659 0.965 -> 0.967; 683, sharing 657.s1, held).
- **Windows** ("49 % on all", "552 top window defect"): 438's took the
  studio's pointed shape (0.964 -> 0.971). 436/437's and 552's did not come
  clean in three laptop passes, nor 653's fork with tuning, cuts or a
  shared end point: 552 and 653 are decisions 18 and 19; 436/437 went to
  the GPU polish below.
- **Sheet 11** ("11 ^ issues"): every stroke of its 25 shapes polished on
  the Geekmini's GPU (`qpass.py` with `QPASS_ALL=1 QPASS_SUFFIX=qj`:
  gpufit.refine from the nodes drawn now, outline x8), to be judged by
  `vjudge.py` (`VJUDGE_SUFFIX=qj`). The user asked for the GPU: the
  coordinate searches are one-node-at-a-time and suit a CPU, so a "tune"
  mode for the worker's CPUs (`scripts/pen/tunejob.py`, `SCRATCH/me/tjob.py`:
  eyetune's windows and joint.py's joint ends, self-contained like a widen
  job) exists for local cleanup after it.
- **Review pages:** every sheet of more than four shapes is now a folder
  of pages, four pairs a page (`SCRATCH/me/splitsheet.py`), because the
  tall sheets could not be read ("split and rerender the others because i
  cant see them").

**Decisions 13, 18 and 19, 2026-10-24.**
- **Decision 13, Ha 643** ("13, 2 but both %need to be smoother. There is
  also a ` on the left"): the tail stroke cut back so the hook in the
  right eye's corner goes, then both eyes smoothed and the hair on the
  left eye's outer edge cleared. Coordinate tuning could not do it: moving
  nodes, turning and narrowing the nib left the left eye's corner round
  and the right eye's floor stepped, and put a kink in the outer edge.
  What did it is a **stroke built from the studio's band**
  (`SCRATCH/me/chord.py`). A studio piece is a band between two long
  edges. Walk both edges together by arc length; at each step the nib is
  the chord from one edge to the other. Its middle is the node, its
  direction the nib angle and its length the pen's width (0.3 to 1.5, the
  pen changing width as decision 01 allows). The swept edges are then the
  studio's own edges, so a window they bound is the studio's.
  `chordfit.py` then moves the four edge ends a few ring points at a time
  for the most overlap, since an end that runs on under a neighbour beats
  one that stops at the piece's cap. 643.s0-s3 rebuilt this way: 643
  0.974 -> 0.989, both eyes' corners sharp, the hook and the hair gone.
- **Decision 18, Mim 552** ("18 1. The % needs to be smoother. No peak"):
  the tuned head kept, then its arch (552.s2) rebuilt from its band, inner
  edge ring points 20 to 73 against outer 15 down to 92, 20 nodes. The
  window's top is the studio's smooth arc and the peak is gone: 552
  0.981 -> 0.983. The peak was the inner edge of a broad nib turning
  tighter than half its width, which no node move undoes.
- **Decision 19, Ha-Sad 653** ("19 is not fixed. The fork is still
  there"): the fork was a slit of paper between the loop's end (653.s6)
  and the inner stroke's (653.s5), too thin for the overlap or the edge
  length to notice. `eyetune.py` gained **`SLIT_W`**: paper a disc of
  `SLIT_R` (0.06 nuqta) would close where the studio has ink, and ink it
  would open where the studio has paper, counted by area. Tuning the two
  ends' last nodes with it closed the fork (653 0.9736 -> 0.9737).
  `EYETUNE_WIDTHS=1` lets eyetune narrow or widen the nib too.
- **Hairs, everywhere still in review.** 485 hair jobs on the Geekmini
  (`tjob.py hair`, one per hair at a joint or sideways off a free end:
  cut the end back, turn the nib, narrow it). 338 strokes came back
  changed. 19 failed the gate: some shape lost more than 0.001, or its
  worst miss grew more than 0.005. A before/after defect scan then found
  that 124 shapes gained a new or deeper fault, nearly all notches where
  a cut end bares the studio's ink. Kept: the 162 strokes whose every
  shape came out clean, 173 shapes. That cleared 206 faults with no new
  ones, and mean overlap rose 0.0006. **A hair cut needs the scan after
  it;** the overlap alone passes a cut that leaves a notch.
- **The band method for every flagged shape** (the user, 2026-10-24,
  "yes", to using it beyond 643 and 552). `chord.py auto` finds a piece's
  two edges from the fitted stroke: its first and last nibs' corners land
  on the studio ring. The start cap is the short way between the first
  two, and each edge walks away from it to the first end corner. A shared
  stroke is built from its home shape's piece, in that shape's frame.
  Built straight from the band, before any fitting, 372 went 0.975 ->
  0.982, 373/374 0.978 -> 0.986 and 400 0.961 -> 0.968; 403 and 409 fell a
  little. The end search ran on the laptop until the user asked for the
  GPU ("from now on, i want you to try to run everything you can via the
  geekmini gpu"). Each band is now polished on the GPU instead
  (`bandq.py`: refine mode, from the band, widths held, outline x8) and
  judged against both the band as built (`.br`) and the stroke drawn now.
  108 strokes in 27 groups of shapes that share strokes; none failed on
  the GPU. vjudge passed 64 polished and 58 as built. Each stroke took the
  polished one where it passed, else the band as built (6). Over the 57
  shapes drawing them, mean overlap rose 0.010, and every shape gained
  (0.0015 to 0.048). 185 faults went and 18 shapes gained one, most at
  the scanner's floor (0.031, an end's corner a hair round). Three were
  real:
  - 230.s3 put a tooth on 495 and 495a and reshaped 438's window, so it
    was dropped.
  - 373.s0's band start left a hair under 374; a 0.05 cut cleared it.
  - 229/230's tip ends in a small fork (0.03) where it had a 0.115 hair;
    kept as the lesser fault.

  Kept: 69 strokes. Some of the gains:

  | shape | before | after |
  |---|---|---|
  | 437 | 0.938 | 0.986 |
  | 413 | 0.932 | 0.973 |
  | 436 | 0.958 | 0.988 |
  | 429 | 0.954 | 0.978 |
  | 400 | 0.961 | 0.978 |
  | 670 | 0.969 | 0.987 |
  | 228 | 0.967 | 0.985 |
  | 372 | 0.975 | 0.989 |
  | 401 | 0.976 | 0.984 |
  | 637 | 0.982 | 0.989 |

  Before/after pictures are in the NAS fixes folder ("rebuilt from the
  studio's bands").
- **Approved after the rebuild:** "436 437 and 414 are good". The Qaaf
  catalogue rises to mean 0.976, lowest 0.960 (from 0.963 and 0.938).
  414 is one shape of sheet 17, which is not yet approved as a whole.
- **A picture's overlap is scored in its own frame.** The before and the
  after of a shape are drawn in frames that differ by the ink's extent.
  The first `bapic.py` scored the after against the before's studio mask,
  which showed 414 falling (0.969 -> 0.962) when it rose (-> 0.977).
- **The band method for every stroke on the sheets in review** (the user,
  2026-10-24: "Yes"). That was 1140 strokes on 19 sheets, all built and
  sent to the GPU. The first nine sheets to finish (05, 11, 18, 27, 51,
  55, 58, 60, 64; 561 strokes) were judged as the user asked for "the ones
  that are done".
  - vjudge passed 278 polished and 268 as built: 320 strokes, 42 of them
    as built.
  - The defect scan moved to the Geekmini at the user's word ("If you can
    transfer this job to the geekmini do it"). The scripts and the data
    they read go to the queue as one zip, and a "scan" job runs them
    there (`scanq.py`, `scripts/pen/scanjob.py`). It is about ten times
    the laptop's speed and matched the laptop's result on every shape.
    Twelve scans at once had run the laptop out of memory.
  - Over 182 shapes the 320 cleared 631 faults, and 59 shapes gained one.
    The 206 strokes whose shapes stayed clean were kept. Each of the
    other 114 was then tried alone over those 206, and 50 passed.
  - Together, two shapes still gained a fault. 382 had a notch where the
    unchanged 382.s4 met the rebuilt strokes; 382.s3 went back. In 311,
    294.s2 and 294.s3 each passed alone but not together; 294.s2 went
    back.
  - Kept: 254 strokes. Over the 182 shapes, 489 faults went and none was
    added; mean overlap rose 0.007.

  | sheet | mean before | mean after | lowest before | lowest after |
  |---|---|---|---|---|
  | 05 Ayn Ghayn final | 0.974 | 0.983 | 0.973 | 0.980 |
  | 11 Ba Ta Tha pairs | 0.969 | 0.980 | 0.952 | 0.961 |
  | 18 Fa Qaaf pairs | 0.968 | 0.983 | 0.948 | 0.975 |
  | 27 Jim Ha Kha medial | 0.981 | 0.986 | 0.967 | 0.967 |
  | 51 Ra Zay isolated | 0.975 | 0.982 | 0.973 | 0.976 |
  | 55 Sad Dad initial and medial | 0.969 | 0.976 | 0.946 | 0.946 |
  | 58 Sin Shin initial | 0.961 | 0.971 | 0.951 | 0.951 |
  | 60 Sin Shin final | 0.966 | 0.981 | 0.953 | 0.974 |
  | 64 Ta Za pairs | 0.975 | 0.982 | 0.967 | 0.977 |

  The other ten sheets follow when the GPU finishes them.
- **Review by marked pictures** (the user, 2026-10-24: "I can do the same if
  you give me inline photos"). The pages go to the user as pictures; they
  ring approved shapes in green and faults in red. A red ring's place on
  the page gives a point on the shape and the stroke nodes within 0.4
  nuqta of it (`marks.py`).
- **Two ways to fix a mark, both on the Geekmini.**
  - A window search (`tjob.py window`, CPU) moves and turns only the
    nodes under the mark, judged on every shape drawing the stroke.
  - A GPU polish (`gpumark.py`) refines the stroke with every other node
    held (`fixed`). The user asked whether the GPU was in use; these fixes
    had been CPU searches.

  At each mark the one leaving less mismatch within 0.3 nuqta won, then a
  before/after defect scan. The window search won at most marks. The GPU
  polish moves only where overlap rises, and a 0.03-0.1 nuqta point barely
  changes overlap, so it often handed the stroke back unchanged.
- **Kept: 44 strokes on 21 shapes:**
  - sheet 58: 196, 199-201, 204-207;
  - sheet 18: 376, 378, 382, 385, 386, 390, 393;
  - 371, 154, 030, 033, 277, 279.

  Across 52 shapes, 21 faults went; the new ones are at the scanner's
  floor (0.031-0.041).
- **Not fixed.** 377's V needs ink the studio doesn't have: closing it in
  the target also thickened the head's underside. 202, 203, 023, 031, 041
  and 276 didn't improve. 028, 032, 040, 142, 384 and 392 traded the
  marked fault for a new one of 0.05-0.28 (a fix to 382.s4 put a 0.18
  point on 502 and 651, which share it).
- **Approved by the user's green rings:**
  - 197, 198, 208, 375, 379, 380, 381, 383, 387, 388, 389, 391, 394;
  - 370, 155, 156, 022, 024-027, 029, 038, 039, 278;
  - all of sheet 27 but 142 ("Only 1 problem in 27. The remaining marks
    in 27 are ok").
- **The review record had drifted.** Two `splitsheet.py` runs at once each
  saved the whole record. The second save undid the first's renames, and
  35 sheets were left pointing at folders that were gone. So the band
  rebuild saw 19 sheets in review where there were 49. The record was
  rebuilt from the folder, and `splitsheet.py` now saves only its own
  sheets. The 30 missed sheets' 1137 strokes went to the GPU the same way.
- **Judging moved to the Geekmini too** (2026-10-24). The judge
  (`vjudge.py`), the defect scans and the trials of held strokes now run
  there as scan jobs. Jobs named `fast-` go ahead of everything else; their
  results are renamed back when done. The laptop builds bands, keeps
  strokes and draws pages.
  - The nine missed sheets under five shapes (14, 19, 35, 36, 47, 54, 62,
    65, 66; the user, "Give me some <5 of the missed sheets") were moved
    to the front. Kept: 26 of 54 strokes; 42 faults went. 630b.s0 stayed
    out for a 0.07 notch.
  - The next eight sheets to finish (8, 9, 33, 34, 39, 42, 45, 46): the
    judge passed 301 of 485 strokes. Kept 218, the clean 156 and 62 that
    passed alone. 364 faults went; the faults added are at 0.045 or less.
    Mean overlap rose 0.007.
- **Second round of red marks** (sheets 11, 18, 55, 60, 64). Kept 40
  strokes on 21 shapes, with the GPU polish for 297 and 298.
  - 261's and 270's sad tooth now rises to the studio's point. The window
    search carried it up: +0.020 and +0.026 overlap.
  - 019, 034 and 294 traded the marked fault for a new one of 0.05 or
    more, and stay as they were.
- **Studio flaws to fill:** 637 ("637 needs to be filled in. It is wrong
  on the studio") and 377 have the same thin slit between the head's tail
  and the stroke. Both are now window searches with the studio's slit
  closed only inside a tight box (`CLOSE`, r 0.12). Last time a wide box
  thickened 377's underside.
  - That failed too: the slit narrowed but stayed open on both. A tune
    only moves and turns the pen, and two strokes converging at a sharp
    angle leave paper between them however they sit. Closing it needs a
    fine-pen fill of the corner, the joint step below.
- **Third round of red marks** (sheets 14, 18, 19, 47, 55, 60, 64, 11).
  Kept 36 strokes on 21 shapes. The defect scan caught 019 (spur 0.089),
  035 (notch 0.055) and 715 (spur 0.070). The first two kept the other
  candidate. 715's other candidate made a 0.18 spur, so 715 stays as it
  was.
- **Rings read from the picture** (`SCRATCH/me/inkmarks.py`). Red and green
  ink on a returned page are found by colour, and each ring's centre gives
  its cell and point. Rings drawn round a label near a row's edge can land
  in the wrong cell; check the green list against the page.
- **Joints between a letter's own strokes (^)** (the user, 2026-10-24, on
  the Ba, Kaf and Mim pages: "The ^ are going to need some work when we
  start joining letters"). Most of that round's 61 red rings sit where two
  strokes meet: the notch or slit between them (044, 047, 048, 051-053,
  057, 060, 065, 068, 069, 444-446, 455, 457, 459, 461, 465, 554, 568,
  569). They go through the usual touch-up now. The real fix belongs with
  letter joins: a joint step that fills the corner as a calligrapher does
  with a fine pen, since the nib's stamps alone can't close it.
- **Fourth round of red marks, first part** (sheets 8, 9, 11, 55, 60; the
  user, 2026-10-24: "Send whatever you have"). The 42 marked shapes whose
  jobs had all come back went through before the rest. 63 strokes were
  kept. The scan caught four candidates with a new fault of 0.05 or more.
  080 and 085c took the GPU candidate instead. 067 and 077 stay as they
  were, since no candidate helped them without the fault, and neither
  candidate helped 068. 020.s0 is shared by 020 and 045, and each shape's
  mark gave it a different fix. 020's own fix was kept because 020 is on
  its third attempt, so 045's mark there may still show. `SCRATCH/me/
  redstat.py` lists which marked shapes have all their jobs back.
- **Sheets 26 and 29 (Jim Ha Kha starting and pairs) rebuilt from the
  studio's bands.** 93 of 170 band strokes passed `vjudge.py` (24 of them
  as built). The defect scan found new notches of 0.05 or more in 107,
  110 and 119, so the 11 strokes drawn by those shapes stay as they were.
  82 strokes were kept.
- **Fourth round of red marks, second part** (sheets 8, 9 and 26,
  2026-10-25). The window search can now change the nib's width
  (`widths`), since a cut whose width is off steps the edge beside it. 21
  strokes were kept. 080's and 119's first picks deepened a spur at a tip
  just outside the window. Both were rerun with the corner term below and
  a 0.5-nuqta window: 080 went from 0.888 to 0.935 (worst 0.20 to 0.14),
  and 119 from 0.964 to 0.976 (worst 0.119 to 0.046). Nine marks (045, 052,
  057, 067, 068, 069, 070b, 073, 075) found no candidate that helped and
  stay as they were.
- **Fourth round, the rest** (Kaf pairs, Mim, Lam medial, Fa, Ha, Nun, Ta
  Za: 47 marked shapes whose jobs came back last). 73 strokes were kept.
  The scan found a new fault of 0.05 or more in nine shapes.
  - *Swapped:* 450 took the GPU candidate instead, and passed.
  - *Left as they were:* the other candidate still added a spur for 293,
    373, 572 and 573. For 293 and 373 the spur was on a sharer, 295 and
    the approved 374. For 397, 454, 459 and 461 there was no other
    candidate that helped.
- **Stroke starts: what the rings on a start are.** The user ringed the
  start of 047, 053, 055 and 066, where our cut's corner differs from the
  studio's.
  - *What they are:* close up, it is mostly missing ink at the corner,
    0.036 to 0.040 nuqta deep. It shows before the smoothing, so the cause
    is the pen, not the outline: the first node's nib angle and width
    differ from the second's by 7 to 11 degrees and up to 0.2 of the pen,
    and the sweep blends them over the first segment, cutting the corner
    off (053, 066) or leaving a flat top (055).
  - *Trimming ink behind the cut does nothing:* it moved the edge less
    than half a pixel on a review page. A trim can only remove ink, and
    the defect is ink missing. It was tried and dropped. So was a
    pinned-corner smoother.
  - *The fix:* the width search fixed 053 and 066. For the rest, the
    window score has a corner term, `corner_w` x each window's worst miss
    in nuqta (`tunejob.py`), so a 0.03-nuqta corner counts although it
    adds almost no area.
  - *The settings:* on 055, `corner_w` 0.5 with no shape allowed to lose
    overlap left an odd bump. 0.5 allowing a 0.005 loss gave a soft peak.
    2 allowing a 0.005 loss gave the studio's sharp corner (0.038 to 0.013
    nuqta) with a slightly heavier start. The user, 2026-10-25: "55 strong
    is best". 047 was already close; 0.5 strict took it from 0.014 to
    0.006 nuqta at the ring.
- **Stroke ends of every unapproved shape** (the user, 2026-10-25: "Start
  on the unapproved strokes"). `SCRATCH/me/endq.py` sends one window job
  per stroke over its two ends, with the strong settings (`corner_w` 2,
  floor 0.005, widths free). Two kinds of end are left alone:
  - a thin tip (nib under half the pen), which has no corner to square;
  - an end with another stroke of the shape within 0.8 nuqta, where the
    corner is under the other stroke's ink.

  353 shapes went. Shapes waiting on a band polish, and strokes waiting on
  a red-mark fix, wait for those first. `SCRATCH/me/unapproved.py` lists
  the unapproved shapes and which are ready.
- **The corner term on the GPU** (the user, 2026-10-25, of the CPU
  searches: "Why are these jobs running on the cpu?"). `gpufit.refine`
  takes `corner`, `windows` (circles in the nodes' nuqta) and
  `widths_free`.
  - *The term:* each window adds a power mean (p 6) of how far its wrong
    pixels lie from the right ink. Ours is measured on the hard ink every
    25 steps, and the gradient comes through the soft ink.
  - *The width step:* at 0.1 the width never moved far enough; it needs
    3. On 032.s6's end the miss went from 0.29 to 0.025 nuqta, as the CPU
    search found. On the user's ringed joints it won 6 of 9 against the
    CPU joint search.
  - *Where it is used now:* red marks (`gpumark.py`) and the stroke-end
    roll-out (`SCRATCH/me/egpu.py`) go to the GPU first. The CPU search
    comes back only where the GPU result fails `endpick.py`. Defect scans
    stay on the CPU.
- **Decision 11: three rings still red after three touch-ups** (373, 465,
  553). Close up, none was a gap at the joint:
  - 373 and 553 have a hair of a stroke end poking past the studio's
    edge;
  - in 465 the stroke from the left ends 0.02 nuqta too high, leaving a
    0.034-nuqta step where it meets the next.

  The user, 2026-10-25, chose "A": trim the tips. All three go to the hair
  search (cut back, turn or narrow the end's nib), aimed at the ring
  (`tjob.py hairat`).
- **Judging the stroke-end touch-ups.** One page a shape: the whole letter
  now, touched up and the studio's across the top, and under each a
  close-up of the end drawn at three times the sheets' resolution
  (`SCRATCH/me/endpages.py`). Smaller pages were "too small and
  pixelated". The marking the user and I agreed:
  - green on a column keeps that end ("now" keeps the old one);
  - a red ring anywhere becomes a red mark, fixed on the GPU
    (`gpumark.py`);
  - a red dot on a tip means "lengthen a little bit" (the user,
    2026-10-25);
  - an unmarked or unreturned page keeps the touch-up.

  Every keep still passes a before/after defect scan first.
- **The first two rounds of end pages** (28 shapes, 2026-10-25). 21
  touch-ups were kept, 2 old ends stayed (088.s1, 159.s0), and 2 tips were
  lengthened. The user: "A lot of improvement but there are also some
  other errors that i guess i didnt see before".
  - *The scan:* one new fault, on 175. Its kept tip has a 0.055-nuqta spur
    the scan doesn't like. The user had looked at that close-up and chosen
    it, so it stays.
  - *Lengthening:* the tip is stretched along its own direction over its
    last 0.4 nuqta, the end moving 0.08 nuqta and nothing behind 0.4
    moving (`SCRATCH/me/lengthen.py`). Moving only the end node folded
    158, whose last nodes sit 0.02 nuqta apart. 158 also had a hook in its
    second node, which drew a hair spike once stretched, so that node was
    dropped. Both tips go back to the user before they are kept.
  - *Red rings on the same pages:* 20 rings became GPU polishes. Most were
    joints and tooth bottoms the end pages showed larger than the sheets
    did. They were kept where the scan stayed clean.
    - *085d:* the first round turned the tip the wrong way. A second
      round (corner 4, window 0.5 nuqta) put it on the studio's edge.
    - *170:* the whole top-right turn sat about a third of a nuqta left of
      the studio's. The first round closed two thirds of that. A second
      round, starting from the first round's result, is running.
    - *191:* the first round grew the spur, so it is running again with
      more nodes free.
- **Rounds three to five of end pages** (2026-10-25). The pages now go in
  batches of about 8; 16 overflowed the user's attachment limit.
  - *A strong GPU round often returns its start unchanged.* Corner 4 and
    window 0.5 from a start already near the studio left 171, 176, 194
    and 170's tip exactly as they were. What works: a default round
    first (corner 2, window 0.35), then the strong one from its result
    (`GPU_START` in `gpumark.py`).
  - *Trimming a tip.* A tip running long past the studio's (170 and 171,
    about half a nuqta, left by the hook polish as a 0.53-nuqta hair
    spur) is cut back by `lengthen.py` with a negative stretch. 170 took
    0.5 nuqta over the last 1.0 (`LEN_SPAN=1.0`); trims of 0.4 to 0.6
    all cut the miss at the turn from 0.129 to 0.023, and the scan picks
    the shortest that clears the spur. 194's tooth took 0.10.
  - *Filling a flaw of the studio's.* The user, on 392: "needs fill in at
    ^". The studio has the same V-notch at the head, so polishing toward
    it keeps the notch. `fillpatch.py` adds an extra target piece, the
    convex hull of the studio's ink within 0.3 nuqta of the ring
    (0.024 nuqta² of fill), and the GPU polishes toward that
    (`GPU_PATCH`). Both the mark comparison and the defect scan measure
    against the studio, so they score the fill as worse (the scan calls
    it a 0.087 spur). It is judged by eye, and was kept.
  - *A touch-up must not undo a later fix.* 088.s0's end touch-up was
    built before its red-ring fix was kept; showing it would have offered
    to undo the fix. `endshow.py` now skips any stroke kept after the
    roll-out was built.
  - *The Mim pairs* (555, 558, 560): the CPU joint fix added faults of
    up to 0.13 nuqta. One GPU round starting from the CPU fix cleaned
    them up (555 0.015 → 0.003, 560 0.019 → 0.009; 558 took the strong
    settings, 0.023 → 0.009). 626 kept its original stroke, since
    neither attempt beat it.
  - *Still open:* 317a's filled edge leaves a 0.056-nuqta bump in both
    rounds, and goes to the user on a page.
- **Rounds six to eight of end pages** (2026-10-25). Most rings clear in
  one GPU round. What the rest taught:
  - *Free the stroke that owns the edge.* `marks.py` looks for nodes
    within 0.4 nuqta of the ring, and an edge can pass close while its
    nodes are far. 470's ring was 0.47 from the joint stroke s3, which
    no round had freed; freeing it cut the miss from 0.013 to 0.005.
    Measure the distance to each stroke's line, not just its nodes.
  - *More nodes free* (`GPU_SPREAD`, nodes either side of the ring's) helps
    when a round returns its start, but freeing nearly a whole stroke
    (432.s1) let it grow a step.
  - *Leave a touched-up end out of a ring's round.* On 343, freeing the
    touched-up s2 next to the ring grew a hairline from its tip in two
    rounds; freeing only s0 cleared the ring.
  - *A ring on a stroke kept as a touch-up the same day* starts from the
    touch-up (`GPU_START` = the keep folder), so the round cannot undo
    it.
  - *Rings the user drew on the "now" column* belong to that column's
    frame (`redfind.py LABEL@0`); a ring running off the panel pulls its
    centre, so it is placed by eye.
  - *Three failed tries go to the user* as one picture each in the
    decisions folder (`SCRATCH/me/decide.py`: now, the attempts and the
    studio, with a close-up at the ring). Six went on 2026-10-25: 432,
    248, 470, 190, 189 and 250. Four are one fault: where two strokes
    meet, the studio has one rounded peak or arch and ours has a sharp
    corner or two points with a notch (432, 189, 250, 248). 190's is a
    tip the studio ends broad and blunt and ours ends as a hair; trims
    shorten it but cannot widen it.
  - *Queue names:* a scan the worker takes before its rename to `fast-`
    finishes as `scan-`, so a watch counts both.
- **Round nine of end pages, and the window judge** (2026-10-25). Of
  eleven rings on batch 9, 361, 367 and 317b cleared in one round, while
  321's and 336's joint notches only shrank. 201's tooth spike did not
  move in two rounds. A review of the six open decisions (the user asked
  for Fable's opinion) found the cause of most returns-unchanged:
  - *The judge did not excuse a neighbour's ground.* `gpufit.refine` keeps
    its start unless a schedule beats it on `iou - gap95 - corner *
    window_worst`. The corner term in the cost excuses ink on the
    neighbours' pieces (`ignore`), but `window_worst` counted it as a
    worst miss. So a stroke run on through a joint, the very thing that
    fills a rounded peak, was judged worse and thrown away. Fixed: the
    judge leaves out ink on the `ignore` ground (commit 36e9735).
    Afterwards:
    - 250's notch went 0.0105 → 0.0039;
    - 248's edge went 0.0156 → 0.0064 (positions only, `GPU_WIDTHS=0`,
      spread 2; a width pinned at a clamp had gamed the window).
  - *Don't send the neighbours along as `others` for a ring round.* The
    judge's `gap95` then reads the neighbours' whole outline (about 9
    nuqta), which drowns any gain at the ring, and every job came back as
    it went in. `gpumark.py` leaves them out (`GPU_OTHERS=1` sends them).
  - *A spike can be another stroke's start.* 189's head spike was s4's
    start stamp, 0.16 nuqta from the ring and never freed. A trim at that
    tip (`tjob.py hairat`) took it off, leaving a low stub where the
    studio has a small rounded hump.
  - *Not cleared:*
    - 432: a hairpin (100° of nib turn between nodes 0.08 apart),
      re-laid on an even arc (`SCRATCH/me/reseed.py`, bend by heading),
      rounded its corner but cost the letter 0.005 of overlap.
    - 190: a gentler smoothness weight (`GPU_ROUGH=0.005`) left the tip
      worse.
    - 470: the trim changed nothing, because the miss is studio ink left
      bare, not a spur.
    - 201: the spike goes only when the shared 178.s2 moves, which costs
      196 0.0035 of overlap; that went to the user as decision 07.
    - 321's notch did not move again.

  Decisions 02, 05 and 06 were retired as fixed. Each has a
  before/after/studio picture in the fixes folder.
- **The user's decisions, and what came after them** (2026-10-25):
  - *04, 190:* "4 b". The tip trim B (red33t t20) was kept.
  - *07, 201:* "7 a but there are problems elsewhere". A, the shared
    178.s2 moved, was kept: the tooth spike is gone, and 196 eases from
    0.972 to 0.968. On a clean page of 201 and the three letters
    sharing that stroke (`SCRATCH/me/markme.py`), the user ringed eight
    more misses:
    - the spurs at the joins of 178 and 180 cleared in one round;
    - 201's middle tooth and last corner, and 196's inner corner and
      right edge, cleared in a second, stronger round (corner 4, window
      0.5, spread 2);
    - 180's right end did not clear (below).
  - *03, 470:* "Same problem" as 432, more correct but with a new
    fault. Starting from A, the bump under the tail turned out to be
    470.s3's nib grown to 1.28 at one node. Removing that width and
    polishing positions only (`GPU_WIDTHS=0`) cleared it with the joint
    still filled. Kept.
  - *01, 432:* "now i guess", after ten tries, none of which gave the
    studio's round inner arch:
    - B, which had freed the whole stroke, swung the nib's width from
      0.3 to 1.29 along it. That swing is the step the user saw, and
      taming the widths (plain or smoothed) lost the loop.
    - A pen pivot (`SCRATCH/me/pivot.py`: the turn's two nodes merged
      into one `corner` node, run on the worker's CPU) sharpened the
      turn instead of rounding it.
    - Polishing from the pivot shrank the step but kept a point.
  - *08, 180's right end:* "None of them are correct". The corner is
    where 180.s1 meets 175.s3, which 18 shapes share, and 180.s1 had
    only four nodes from the first tooth's tip to that corner. Every
    round could only pull the whole stroke, so one try raised the
    tooth's tip. Midpoints were added (four nodes to seven), the
    tooth's nodes held, and the end polished (`SCRATCH/me/job45.py`).
    The GPU handed the seed back unchanged. At the sheets' resolution
    the step is 0.02 nuqta of our ink past the studio's (a fifth of the
    0.1-nuqta scale), and it shows only in the 3× close-up. The studio's
    rounded corner there lies on 175.s3's ground, so 180.s1's own target
    never asks for it. The user took "now" (2026-10-25, "Ok" to accepting
    it as a subtle joint irregularity).
  - *What these taught:*
    - When a width-free round gains, look at the widths it chose: a
      width at a clamp, or a swing along the stroke, is the window
      being gamed.
    - A stroke with few nodes cannot change its end without moving its
      other end.

- **Round ten of end pages, and every old ring measured again**
  (2026-10-25):
  - *End pages 10:* all eight touch-ups were marked green. Seven
    scanned clean and were kept (645.s6, 647.s6, 549.s2, 646.s6, 648.s5,
    744.s0, 432.s0). 743.s0's scan flagged the tail's bottom point at
    0.064 nuqta. It was a point before the touch-up too, and a GPU round
    on it came back unchanged, so the user decides (decision 15).
  - *The user's rings on those pages* (645's lower joint, two on 647's
    loop, 646's top-bar tip) were polished on the GPU (`gpumark` g48)
    and kept after a clean scan. 646's tip barely moved the mismatch
    area (0.0058 → 0.0054) but lost its jag and hook. The picture, not
    the number, showed that.
  - *Every ring ever marked* (360, from every `marks.json`) was measured
    on the letters as kept now (`SCRATCH/me/ringcheck.py`: the deepest
    ink off the studio's either way within 0.25 nuqta of the ring):
    - 337 were under 0.05 nuqta. 23 were at 0.05 or more, 7 of them at
      0.1 or more.
    - 392's right ring was left out, since it differs from the studio on
      purpose (the user's fill).
    - The other 21 rings were rerun on the GPU with the fixed window
      judge (g47). Fourteen came back better, and every shape they touch
      scanned clean except 572. Kept: 041, 461, 393, 183, 067, 453 (with
      the shared 385.s6), 187, 323 and 715.
    - Not kept, put to the user as decisions 09 to 14: 028 and 459 trade
      a gap for a bump; 142, 171 and 077 gained nothing or grew a step;
      572 cleared its ring, but the scan flagged a tick beside it.
  - *Decision 08 closed:* "now" kept for 180 (above).
  - *What this taught:* the mismatch area round a ring misses the shape
    of a fault. A jag or hook barely changes the area. Look at the
    close-up before calling a round useless.
  - *The Geekmini* runs at most 3 jobs at once from now on (the user,
    2026-10-25: "Decrease parallel tasks to 3 at a time max";
    `workers.json`).

- **Round eleven of end pages** (2026-10-25). The user: "They are all
  pretty much the same."
  - *Green on the touch-up, kept after a clean scan:* 634.s0, 332.s1,
    015.s1, 329.s0, 434.s0 and 319.s4 (`endkeep13`).
  - *Green on "now":* 174.s5, whose touched-up tail dipped and ended in
    a flat hook, and 253.s3.
  - *The user's ring on 174's left side:* a notch where the upper stroke
    (s4) runs into the bowl (s5). The first GPU round (g51) halved the
    miss round the ring (0.023 → 0.011 nuqta²) but left a small nick. A
    second round from that result, freeing two nodes either side (g52),
    took it to 0.0035 and matched the studio. It scanned clean (0.968 →
    0.971) and was kept.

- **End touch-ups stopped, approval pages started** (2026-10-25). The
  user: "Stop the touch ups. Lets fix the other problems. Start
  approving things."
  - *The end roll-out stopped* with 152 touch-ups never shown. Half of
    them changed less than a third as much as the ones reviewed. None
    were kept.
  - *Approval pages* (`SCRATCH/me/approvepages.py`): every shape not yet
    approved (488) is drawn 4 to a page, ours beside the studio's, into
    the NAS folder `review/to approve/`. Groups with the fewest shapes
    left come first, so whole groups close sooner. Shapes waiting on a
    decision (028, 459, 142, 171, 077, 572, 743) are held back.
    `SCRATCH/me/pagering.py` turns a ring on a page into a mark.
  - *My own check before sending* found hooked head tips on 718 and 720.
    A GPU round (red53) fixed both; they scanned clean and were kept. The
    user's rings landed on the same tips. The same round made 154 and
    159 worse, left 162 and 485 as they were, and opened a white slit
    in 719's shared stroke 719.s0. None of those were kept.
  - *Pages A001–A008:* 373, H01, 161 and 482 approved. That completes
    Fa, Hamza, Nun and Reset, which went into the catalogue. Red rings
    on 715, 637, 154, 158, 159, 160, 162–165, 600, 481, 483–486, 454,
    457, 461, 465, 719, 720 and 721 went to the GPU (red54). Page A006
    (487–490) was not returned and stays unapproved.
  - *Kept after a close-up check and a scan:*
    - from red54: 158, 160, 454, 457, 461 (without 460.s2), 465, 481,
      486, 600 and 721, and 485's start;
    - from the second round (red56: spread 2, corner 4, neighbours sent
      along): 163 and 165.
    - The scan flagged a point on 160, 481, 485 and 721. Each close-up
      showed it was better than the spike or notch it replaced.
    - Strokes that an approved shape also draws (445.s0, 460.s2) were
      left out, so nothing approved changed.
  - *The Kaf medial corner* (481, 483–489) was a spike from one shared
    stroke, 483.s3. Its first node's nib angle was 23° off the next one,
    and three GPU rounds would not move it: the job kept its start each
    time. Dropping that node (a hand edit) cleared the corner on all six
    shapes, and their scans were clean. *Lesson:* when the GPU returns a
    stroke unchanged at a spike, look for a twisted angle at an end node.
  - *Decisions 41–48* (16–40 were already used by another job's cut
    pages): 154 head top, 159 top tip, 162 head joint, 719 head (every
    round opened a white slit in shared stroke 719.s0), 715 top tip (the
    studio has a barb ours lacks), 637 joint, 164 head joint and 720's
    right side. Each had three GPU rounds that didn't fix it.
  - *My own check of pages A009–A010* sent the Ya heads 722, 723, 724,
    726 and 727 to the GPU (red55). None were kept:
    - 723 grew a step at its joint, 724 turned lumpy, 727 grew a tick,
      and 726 was worse.
    - 722's head start came out squared like the studio's, but the scan
      flagged a bigger tick inside the head. It waits for the user's
      marks on those pages.
- **Decisions answered by drawing on them** (2026-10-25). The user asked
  for the decision pictures in the chat ("Give me the decisions in the
  chat so i can draw and send them back") and drew on the close-ups. A
  ring round a column picks it. A drawing marks what to change on the
  column it is drawn on. `SCRATCH/me/decmarks.py` turns a drawing into
  marks: the centroid of each drawn blob, offset from the decision's
  ring by where it sits in the close-up.
  - *Picked as drawn, done:*
    - 15, 743: the touched-up tail (kept from `e743`).
    - 42, 159: the second GPU round (red54).
    - 44, 719: now. The shared 719.s0 stays as it is.
    - 47, 164: now.
  - *Drawn on, back on the GPU, each starting from the column drawn on:*
    - 09, 028: the gap at the joint filled on now (g59, the neighbours
      sent along).
    - 10, 459: from the GPU's version, the step on the left smoothed
      and the tick on the right cleared.
    - 11, 142: now's left side filled out, blunt like the studio's.
    - 12, 171: the inside of the downstroke filled out under the turn.
    - 13, 077: the GPU's tip cut back where it swells.
    - 14, 572: from the GPU's version, the left corner rounded and the
      bottom tick cleared (all g58).
    - 41, 154: from round 2, the left edge straight up to a corner
      (g60).
    - 46, 637: the studio's small notch at the joint, cut into now
      (g60).
  - *What came back:* a ring round the drawing (the plain rounds above)
    moved nothing again. The drawing had become one point, and a point
    asks the same polish toward the studio that had already failed three
    times. Two methods that keep what was drawn worked instead:
    - **Ink to take away: hand edits at the stroke ends.** Each tick was a
      stroke end poking past its neighbour, and each step or corner was a
      node with its nib width at the 1.5 clamp. Kept after clean scans:
      - 459 from the GPU's version: 459.s5 node 6's width 1.5 → 1.1 (the
        step), 459.s4's end node dropped (the tick).
      - 572 from the GPU's version: 572.s4 node 5's width 1.5 → 1.0 (the
        corner), 572.s3's start trimmed 0.1 nuqta (the tick).
      - 077 from the GPU's version: the tip's widths cut to 0.5 and 0.15
        and the tip trimmed 0.12 nuqta.
      - `SCRATCH/me/nodeview.py` draws every node, numbered, over a
        close-up, with ours-only ink orange, so the node behind a fault can
        be read off. A stray wedge on 572 had no node under it: it was the
        outline folding at the clamped width.
    - **Ink to add: the drawing as the target.** `SCRATCH/me/drawpatch.py`
      turns a drawn blob into an extra target piece (as `fillpatch.py`
      does with a hull), so a GPU round aims at the studio plus the
      drawing. On 637 that filled the V at the joint, kept after a clean
      scan (the user's green there is 81% on paper: a fill, not the
      studio's notch). 028's gap filled but grew a lump; 142 and 171 did
      not move.
    - The scan's flags on 077 (the cut tip) and 572 (the loop's counter,
      as before) were judged by close-up.
    - **A shape the stroke cannot reach: change how the pen starts, then
      polish.** Kept after clean scans:
      - 142: a node added before the start with a flat nib (angle 0)
        gives the studio's blunt head; s0's end pulled back off the
        point. A GPU round from there (g63) rounded it, 0.967 → 0.975.
      - 171: the nib turned 15° on nodes 68–71 smooths the inside of the
        turn, as drawn. The GPU's polish of it put a corner back, so the
        hand version was kept.
      - 715: the barb rebuilt as a solid triangle on the stem. The pen
        starts at the barb's end (thin), runs to a node on the stem at
        the barb's foot (nib at 68°, the barb's height), through a node
        midway up the stem, to the tip moved onto the studio's. The first
        try, with the barb's node off the stem, left a white eye between
        barb and stem. 0.976 → 0.977; the scan's tip flag is the new tip
        matching the studio's.
  - *Second pass on the pictures* (2026-10-25). The user: "Still some
    fixes but much better." Green on 715's barb (done). The rest, kept
    after clean scans:
    - 09, 028: the fill's lump was the second stroke's start flaring at
      a −33° nib, plus a node at the 1.5 width clamp. The start was turned
      to its neighbour's angle at width 0.4 and trimmed 0.05 nuqta; the
      clamped node went to 1.1.
    - 41, 154: round 2 picked. Its bump was another node at the 1.5
      clamp, eased to 1.25.
    - 48, 720: round 3 picked. The spike was the bowl stroke's end
      (720.s2, shared with 724) poking past the head stroke; trimmed 0.05
      nuqta. Trimming the head stroke's end (719.s0) only made the spike
      longer, which showed whose end it was.
    - 142: the head's angular right side and stepped bottom left. Node
      1's nib turned to 45°, node 2 narrowed to 0.7 and both lower nodes
      moved right a little.
    - 171: a dent in the downstroke, from widths of 0.73 and 0.9 under a
      node at the clamp: 1.3, 1.0, 1.05.
    - Decision 43 (162) is the only one still open.
  - *Third pass* (2026-10-25): green on 154 and 171 (done). Kept after
    clean scans:
    - 028: the joint stroke's end widened to 0.8 and turned to 40°, which
      tucked the lower tick in. A GPU round (g64) smoothed the step under
      the alif head, but only 028.s4's result was kept. Its 028.s5 result
      lengthened the hook beside the alif head, and its 028.s2 result
      reopened the gap at the joint.
    - 142: the hairline's end trimmed 0.3 nuqta over a 0.7 span, so it
      no longer touches the head (a 0.4 span left a tooth). The head moved
      left 0.035. The hairline now ends in a finer point than the
      studio's; turning the nib there made it worse.
    - 720: the right side filled out by widening the shared 719.s0 at the
      junction (nodes 13–14 to 1.05 and 1.0). 719 scanned unchanged.
  - *715's barb* (decision 45): the GPU never moved the tip, because it
    has nothing to start a barb from. So the barb was begun by hand: two
    nodes added before the tip, 0.5 nuqta down and to the left, thin.
    The pen now starts at the barb's end, runs up to the tip, turns there
    and comes down the stem. A GPU round from there (g61, smoothing 0.02) shapes it.

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

### Words the studio builds (references for the joining step, 2026-10-24)

The studio composes any word typed into it (the user, 2026-10-24: "It will
build the words that you give it ... the joined words do exist"). Thirteen
words likely to be hard were built there and kept as references, so our own
joins can be checked against the studio's join by join: محمد, نجم, حياتي,
في, كل, كلا, السلام, بسم, معلم, تحت, ايمن, ام, الحب.
- **How they are kept.** The studio draws a word as catalogue entries
  placed letter by letter. Each letter's first strokes match one entry
  exactly, so a word is stored as entry numbers plus their placements
  (`words.json`, in Claude's scratch folder `studio/words/`, with
  `addword.py` and `render.py`). The pictures and the json are on the NAS
  in `HarfCanvas side-by-side/studio words/`. Dots are left out; the
  joins are the point.
- **What the studio does that the catalogue doesn't show:**
  - **Stacking is placement only.** In محمد, نجم, معلم and تحت the letters
    are the ordinary initial and medial entries, raised and moved so that
    each one starts on the one before. No special stacked shapes.
  - **Pairs are used when they exist.** في is the Fa and Ya pair (398), and
    كلا is the Kaf and Lam-alif pair (465).
  - **A lam is reshaped to fit the word.** In كل, السلام and الحب the lam's
    stem is lengthened (or the lam-alif rebuilt) to stand level with the
    word's other tall letters. These strokes are in no catalogue entry and
    are kept as full outlines. Our joining step needs the same ability:
    the stem stretches, and the nib stays the same.
  - **A word breaks after a letter that doesn't join forward** (alif). The
    next part is placed down and to the left, as in حياتي, السلام, ايمن
    and ام.
