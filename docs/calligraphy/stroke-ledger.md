# Stroke ledger: what we have learned about writing Thuluth with the pen

This file records how each stroke is drawn once a way of drawing it has been
found that works, and the rules for measuring, spacing and joining that
apply to every letter. Each new letter starts from what is written here and
adds to it. It records method and measurements; it is not an approval
record. Each form's verdict lives in `scripts/pen/REVIEW.md`, and the
user's word there decides. The references are research material only: the
app credits no calligrapher.

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
- **A dot** is the nib pulled 1.06–1.08 pens at 64–70°: a rhombus about
  1.65 pens along its long diagonal.
- **Scale to 0.1 nuqta, not whole nuqtas.** "Two nuqta wide" style
  measurements are rough. Size from the reference's ink, in pens.

## How to draw a stroke (the method that works)

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
5. **Check at three times the size** against the reference before showing
   anyone. Any notch, spike, step or kink is a defect.
6. **Raster plates:** `fit.py` moves nodes and turns the nib to match the
   ink. Start its angles from the measured widths (step 3). Its search
   cannot jump between the two angle branches by itself.

7. **Stamps are pulls, not bands.** An alif's diamond head, a ya's head
   and its hat are the nib set down and pulled a short way. Read the
   diamond's four corners: one pair of sides is the nib (its angle), the
   other is the pull. Draw a two-node pull at that angle, from the middle of
   one nib side to the middle of the other. Reading a stamp as a band gives
   spikes.

### Traps found the hard way

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
  side):
  - **0.85 nuqta inside a word;**
  - **0.9 nuqta between words.**
- A word may tuck in over another's tail or under its head. The studio's
  أيمن sits under the meem of أم, with its ي dots 0.87 from the meem's tail.

## Letters

### Alif (ا), standalone (studio, adopted 2026-10-19)

- **Height:** 7.87 nuqta, from the head's top to a hairline foot on the line.
- **Head:** a diamond stamp. The nib is set at 71.6° and pulled down and
  right from (−0.91, −7.53) to (−0.62, −6.79), measured from the alif's
  right edge on the line.
- **Flag:** a wedge off the head's right corner, down to a point 0.3 right
  of the stem.
- **Stem:** from inside the head, slightly bowed, 0.3–0.35 nuqta wide,
  narrowing to the foot.
- **The book's alif** (plate 9: one stroke, head flicked up on the nib's
  edge) is heavier, and its foot keeps the next word further away.
- **No hamza over the alif in Thuluth.** The hamza of أ/إ is left out (the
  user's ruling).

### Meem (م), standalone (studio, adopted 2026-10-19: "use the alternate version of the meem")

- **Head:** a loop with a counter. Its bottom is 1.07 nuqta above the line,
  its top 2.86 above, and it is 1.6 nuqta wide.
- **Order:** start thin at the head's left, go over the top to a point at
  its right, come back under it to the left, then run straight on into the
  tail.
- **Tail:** a long taper down and to the left, to 9.5 nuqta left of the
  head's right edge and 2.6 below the line, ending in a hair. No rising hook. Words after
  it tuck in over it.
- **The book's form** (plate 24, the tail rising again as a hairline) was
  set aside.

### Ya (ي), starting, stacked on a meem

- **Head:** top 3.2 nuqta above the line. The head is a diamond stamp,
  the nib set at 78°.
- **Hat:** a wedge off the head's right corner, down to a point (the user:
  "their ya stroke has a hat").
- **Descent:** comes down slightly right and becomes the meem's loop (see
  below). The ي hands over to the meem 2.1 nuqta above the line, above where
  the stroke later crosses itself.
- **Dots:** two side by side under the meem's loop, 3.3–3.5 nuqta below the
  line, 0.9 apart, the left one a little lower.

### Meem (م), middle, under a stacked tooth

- **The loop:** continues the ي's stroke down the loop's left side, round
  the bottom (lowest about 0.3 above the line), up the right side and over
  the top going left. The nib turns steadily from about 147° to 270° round
  the loop. The counter stays open.
- **Exit:** a band out to the left and slightly down, ending inside the
  nun's arm (carried 0.3 nuqta past the end of the studio's band so the two
  overlap).

### Nun (ن), finishing, after a middle meem

- **A fresh stroke:** the pen lifts after the meem's exit (a `lift` join).
- **Arm:** starts at a pointed beak 1.2 above the line and comes down,
  thick, to the line.
- **Bowl:** sweeps down-left to 2.6 below the line and rises to a thin tip
  0.5 above the line.
- **Dot:** above the left part of the bowl, 0.3 above the line. The Ministry
  book's rule is that the dot sits near the arm. The studio's sits over the
  bowl, and its placement is the one used here.

## Joins

- **A tooth onto a meem:** stacked. The tooth's stroke runs on and becomes
  the meem's loop, one stroke split between the two letters with gap 0 and
  rise 0.
- **A meem into a final nun:** the pen lifts. The nun's arm overlaps the
  meem's exit.
