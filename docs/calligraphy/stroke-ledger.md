# Stroke ledger: what we have learned about writing Thuluth with the pen

This file records how each stroke is drawn once a way of drawing it has been
found that works, and the rules for measuring, spacing and joining that
apply to every letter. Each new letter starts from what is written here and
adds to it. It records method and measurements; it is not an approval
record. Each form's verdict lives in `scripts/pen/REVIEW.md`, and the
user's word there decides. The references are research material only: the
app credits no calligrapher.

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
overlap 0.92 for the phrase against 0.90 for the approved أم أيمن, side by
side in `comparisons/alhubb-hayati.png`; awaiting the user's look).
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

## Joins

- **A tooth onto a meem:** stacked. The tooth's stroke runs on and becomes
  the meem's loop, one stroke split between the two letters with gap 0 and
  rise 0.
- **A meem into a final nun:** the pen lifts. The meem's exit band ends in
  the nun's arm, and the nun's knot covers the seam.
