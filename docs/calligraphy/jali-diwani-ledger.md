# Stroke ledger: what we have learned about writing Jali Diwani with the pen

This file records how each Jali Diwani stroke is drawn once a way of drawing
it has been found that works, and the measuring, spacing and joining rules
that apply to every letter. It is the Jali Diwani twin of
[stroke-ledger.md](stroke-ledger.md), which holds the Thuluth method; the
fitting method there (pieces, stamps, `ignore`, tight fits, side-by-sides at
4×) carries over, and its measurements do not. It records method and
measurements; it is not an approval record. The references are research
material only: the app credits no calligrapher.

The research behind it, and the decisions the user has made, are in
[the Jali Diwani research note](../superpowers/specs/2026-10-19-jali-diwani-research.md).
In short: the studio gives the starting outline and the piece split; **a
master's plate wins where they disagree**. Hashim al-Baghdadi leads: his
Jali Diwani alphabet (his book p. 65) for shape, his compositions (pp.
66–67) for joins and fillers, his numbered Diwani plate (p. 59) for the
order of the moves the two scripts share. Jawad Sabti's numbered Jali
Diwani plate gives the order of what Jali Diwani adds (head curls, the
kaf's flourish, the lam-alifs) and is a second opinion on the rest.

**Since 2026-10-25 the studio is the convention, for the stroke split and
the shapes both; Hashim's plates are kept as reference only** (section
"The studio is the convention", below). The 2026-10-21 paragraph that
follows is the earlier rule, kept as it was.

**Since 2026-10-21 every letter is fitted to Hashim's page itself**, the
studio's stroke split only guiding the cut (`jdplatecut.py`): the user
chose his proportions for the whole alphabet ("hashim"), and the studio's
letters are 20–45% smaller for the pen than his (waw 1.20× in height, ra
1.36×, dal 1.42×). **Tail tips stop where the reference's ink stops**
(`jdtip.py`; the user: "stop it until the reference ink stops"). Smoothing
work is for Jali Diwani only; where its forms sit beside Thuluth's in the
app is left for later.

**Since 2026-10-23 the order and direction of the pen's moves are also
read from the user's Jali Diwani video course** (14 lessons, notes in
[jali-diwani-course-notes.md](jali-diwani-course-notes.md); the videos are
not kept in the repository). Its teacher is not Hashim, so his plates still
set the proportions; the course shows what a page cannot: which move comes
first, which way it runs, where the pen lifts. It agrees with the splits
already approved (the waw's cup, closing move and tail; the dal's hook and
alif ending; the initial ain's body before its head) and adds that heads,
caps and the ha's top are separate strokes written last.

## Units and the pen

Measured 2026-10-20.

- **The nib rests at about 80° in Hashim's hand and the studio's**, steeper
  than Sabti's 62° (below). Hashim's dots on his p. 65 are nearly square,
  sides about 40 px at 74–83° and 33–39 px at 151–159°; his strokes'
  thickness tops out at about 42 px, so the nib is the 40 px side, at 79°,
  pulled about 0.93 pen along 156°. The studio agrees: fitting ورد, 125 of
  317 nodes' nib angles fell between 70° and 90°, the clear peak. Within a
  stroke the nib turns far from it (to 0–20° into the tapering tails), so
  fit with the angle free, as Thuluth's are.
- **Sabti's nib edge sits at about 62°** (y up: the edge rises to the right). From nine
  dots on Sabti's plate: their nib sides run 59–69°, two at 51–53°. This is
  the 60° the Arabic sources give, and it is far from Thuluth's 145–149°.
  It is why uprights come out thin and horizontals thick: an upright crosses
  the edge at 28°, so a fixed nib draws it 0.47 pen wide. Measured on the
  plate: Sabti's alif stem is 13–22 px down its length against a 40 px nib
  (0.35–0.55 pen); the lam's flat bowl bottom reaches the full 41 px. The
  nib still turns within a stroke (θ = φ ± asin(w/pen), as in Thuluth); 62°
  is where it rests, and the fits will show how far it moves.
- **A dot** is the nib (1.00 pen, about 40 px on the plate) pulled about
  0.7 pen along about 150°. Both its diagonals are about 1.25 pens, the
  longer near vertical, so a ladder of dots stood point to point measures
  **1.25 pens to the dot**.
- **The studio's units:** 4.644 units to the dot (every shape agrees to
  ±0.5%). Its strokes' thickness tops out sharply at **3.6 units** (324 of
  1,418 single-shape strokes reach 3.5–3.75; one exceeds 3.75), which is its
  pen. So the studio's dot is **1.29 pens**, against the plate's 1.25: the
  same unit. For the fitter: PPN = 4.644, PEN = 3.6 in the studio's units
  (scale the piece transform, never the data).
- **Thickness:** on the plate the thickest strokes run 41–47 px against a
  40 px nib (ink spread in print, and overlaps); the 99th-percentile
  stroke in the studio is 3.65 units against 3.6.
- Sabti's plate has no printed shadow: the heavy bands under the bowls are
  the pen's own ink, swelling and thinning smoothly round the curve.

## Fitting the studio's shapes (the method as it stands)

Thuluth's method (stroke-ledger.md) with these changes, worked out on the
ورد pilot, 2026-10-20. The tools are in `scripts/pen/jalidiwani/`.

- **Scale in the transform.** Each studio piece goes to the fitter as
  `[[S, S, 0, 0], d]` with S = 25.9 / 4.644 = 5.577, so the fitter works at
  Thuluth's 25.9 px to the nuqta; the pen is 3.6 × S = 20.08 px. The data is
  never rescaled.
- **The frame's x is the right-most ink plus the stamp's 2-unit margin.**
  `inkbox.json` is measured inside a 2-unit margin; Thuluth's catalogue
  leaves it off (0.08 nuqta there), here it is 0.43 nuqta, so it goes back
  on.
- **Jobs go straight into the queue's `todo/`; code is never synced.** The
  queue runs the Thuluth session's fitting code, which is newer than this
  branch's (`pieces.py` differs); `fitqueue.submit` would copy ours over it.
  Names start `jd-`, which the queue ranks with one-off jobs, ahead of
  Thuluth's catalogue.
- **First fits, then Thuluth's second pass** (`.u`: nodes 0.2 nuqta apart,
  outline weighed five times) for every stroke under 0.92 overlap or more
  than 0.12 nuqta off anywhere. On ورد the second pass took the shapes from
  0.95–0.97 overlap to 0.96–0.98.
- **Then a whole-shape end trim** (`jdtrim.py`): drop a stroke's end nodes
  one at a time while the shape's overlap holds (within 0.0005), its worst
  poke-out past the studio's outline shrinks, and its worst shortfall grows
  no more than 0.02 nuqta. fitjob's `trim_ends` judges a stroke alone with
  its neighbours' ground ignored, so it leaves a hairline that ends past the
  letter's outline (the dal's head: a 0.13-nuqta needle, gone) and a tail
  run on to a needle (the waw's and ra's tips: 0.20 → 0.12, 0.30 → 0.22).
- **Measure the poke-out and the shortfall, not only the overlap.** A sliver
  has almost no area, so overlap misses it; the sheets print, per shape, how
  far our ink lies outside the studio's and the studio's outside ours, in
  nuqta (`jdsheet.py`, and `jdpoke.py` finds the spots).
- **Tried and dropped: counting a band along the letter's edge** (`.e`, the
  neighbours' ground ignored only 0.12 nuqta in from the outline). It
  changed nothing: the worst spots were tail tips, not joins.
- **What the trims leave is the tail tips.** The fitter ends a tail in a
  needle where the studio's extracted outline ends blunt (an artefact of the
  extraction, as far as can be seen: Hashim's tails end sharp). The user
  ruled (2026-10-21) that the tip stops where the reference's ink stops:
  `jdtip.py` pulls each end back 0.05 nuqta at a time while that lessens
  the ink outside the reference within half a nuqta of the end, stopping
  if the shortfall there would grow more than 0.03 nuqta. On the studio's
  ورد letters: the waw's tail 0.12 → 0.04 nuqta out, the ra's 0.22 → 0.02,
  the dal's 0.04 → 0.01. On a scan the shortfall guard stops it earlier
  (Hashim's dal 0.35 → 0.17), since print frays the hairline's last part.
- **Smoothness is measured beside overlap** (`jdsmooth.py`; the user,
  2026-10-21: "the studio has smoother strokes"). *Sharp*: places our
  outline turns more than 18° over 0.05 nuqta each way with no such turn in
  the reference within 0.12 nuqta. *Bends*: sign changes of the outline's
  curvature beyond a dead band, ours and the reference's; on a wobbling edge
  every wobble counts. Bends mean nothing against a scan (Hashim's dal
  reads 28 from print fuzz).
- **Where the roughness is: joins, caps and tips, not edges.** On the ورد
  letters every sharp turn ours has and the studio lacks sits where one
  stroke's end meets another (the waw's head, the dal's right side), at a
  nib cap (the ra's head), inside one stroke where the nib turns fast round
  the dal's head (the underside's notch: the swept edge folds), or at a tail
  tip. None is along an edge.
- **Tried and dropped: fewer, evenly spaced nodes** (`jdsmoothjobs.py`,
  2026-10-21). Each stroke resampled to nodes 0.4 or 0.6 nuqta apart and
  refined with the smoothness weight at 0.05 or 0.30. The overlap fell 0.01–
  0.03 (the waw 0.974 → 0.948, its head flattened), the sharp turns and bends
  did not move, and on five of the nine strokes the refine handed back its
  start unchanged, so the batch mostly tested resampling. Node density was
  never where the roughness was.
- **Whole-letter refits (`.w`, `jdwhole.py`, 2026-10-21): mixed.** Each
  stroke refined from its trimmed nodes, scored as its union with the
  others (held at their trimmed nodes) against the whole letter. The waw
  0.974 → 0.977, its worst poke-out 0.12 → 0.07 nuqta, one sharp turn fewer
  (a small point at the top of its head is left). The ra's poke-out
  0.22 → 0.06 but its head went angular, a corner standing up at the right
  (0.966 → 0.960): worse to the eye. The studio dal 0.962 → 0.966 with the
  notch under its head unchanged; Hashim's dal 0.954 → 0.957 with three
  more sharp turns. The notch under the dal's head is inside one stroke and
  no pass has moved it. The tight fits stay the record; the waw's `.w` is a
  candidate.
- **Before 2026-10-21 the sheets drew the reference as polygons**:
  `pieces.ref_ring` samples a piece in its own units, every 0.2 nuqta at the
  studio's scale. The sheets now sample in screen px (`jdcatalog.ring`); the
  pilot's numbers moved by at most 0.004 and the table below stands.
- **Where the plate wins, the letter is fitted to Hashim's page itself**
  (`jdplatecut.py`; first used for the dal, below). His page gives a
  silhouette, not strokes, so the studio's stroke split for the same letter
  is scaled to his letter's height and laid over it, and each of his ink
  pixels goes to the stroke it falls in (the pieces overlap where the
  studio's do). The silhouette is cut from the full-resolution scan (40 px
  to the nib), smoothed by about a pixel against the scan's edge fuzz, and
  written as cubic curves between its corners. The pieces go to the fitter
  with the transform `PEN / 40`, so the fit is in the same units as every
  studio letter. Scores against a scan sit below the studio's (print spread
  takes the thickest strokes past the nib, which the fit cannot follow), so
  "within reason" for a plate-fitted letter is judged against the scan, and
  the number is given as it is. The plate is a reference only: the pieces
  are what the pen is fitted to, as the studio's are, and no outline from
  the page enters the library.
- **"Heavier" is read in pens before anything is refitted.** The pen is the
  unit, so a letter that looks heavier for its height is either the same
  strokes on a shorter letter (a size difference) or thicker strokes (a
  different hand). The dal: the studio's is 4.2 pens tall with strokes one
  nib wide (1.01 pen at the thickest); Hashim's is 5.95 pens tall with the
  same nib (1.14 at the thickest, print spread included). Same strokes,
  bigger letter: his dal is about 40% taller for the nib, not drawn lighter.

## Pilot: ورد (2026-10-20)

Every letter isolated, every letter on Hashim's p. 65 and Sabti's plate, so
no joins: a test of heads, tails and hairlines. All ten isolated waw, ra and
dal shapes in the studio were fitted; Hashim's p. 65 chose among them
(`HarfCanvas side-by-side/Jali Diwani/pilot ورد/` on the NAS: all
candidates beside Hashim, the chosen three, and the three at 3×).

| letter | studio shape | why this one | overlap | out / short (nuqta) |
|---|---|---|---|---|
| و | 690 (v02), 3 pieces: head top, head underside, tail | Hashim's waw: a full round head and a long tail; 689 is the same form, shorter; 691 is a curled form | 0.976 | 0.12 (tail tip) / 0.01 |
| ر | 243 (v02), 2 pieces: the head dropped straight, then the body | Hashim's plain ra almost exactly, pointed head included; 244 and 245 are the diagonal forms, 246 Hashim's other (U-shaped) ra | 0.967 | 0.22 (tail tip) / 0.04 |
| د | **Hashim's p. 65 dal itself** (`h65-dal`), 2 pieces cut with the studio's 237 split as the guide: the body (s0), the hooked head (s1) | the studio's only isolated dal (237) is 4.2 pens tall against Hashim's 5.95, the same nib: the plate wins, so his letter was fitted (the user, 2026-10-20: "pick one and trace it"). The studio's 237 was fitted first (0.966, 0.05 / 0.07) and is kept as a fit, not as the dal | 0.954 against the scan | 0.36 (tail tip) / 0.06 |

Left at 3×: a point at the top of the waw's head and a step under the
dal's head where its two pieces meet, both under 0.08 nuqta; and the dal's
tail, which the fit runs 0.36 nuqta past the end of Hashim's printed
hairline into a needle, as the waw's and ra's tails do past the studio's
(the tail-tip question above). The dal's head starts in a slanted cut where
Hashim's is a blunt round (a 0.06-nuqta sliver), and its underside is a
hair thinner than his. The ra's head ends pointed and slanted where the
studio's is rounded, and the dal's head starts rounded where the studio's
is cut straight; Hashim's are pointed and rounded, so those stand (the
plate wins). Recorded in `scripts/pen/REVIEW-jali-diwani.md` under the
within-reason rule, awaiting the user's look.

**ورد from Hashim's page (2026-10-21).** With every letter to Hashim's
proportions, the waw and ra were cut from his p. 65 as the dal was (the
studio's 690 and 243 splits as the guides) and fitted, second-passed,
trimmed and tip-clipped (`jdtip.py`, hairline ends only: an end is a tip
when its ink is under 0.35 pen wide, so a head's broad cap is never pulled
back). Against the scan: waw 0.966 (0.10 out, 0.03 short), ra 0.962 (0.13
out where his tail's print frays), dal 0.952 (0.17 out, the same). The
waw's first fits stuck two caps out of its head as barbs (0.928); the
second passes took them in. Left at about 10×: under the dal's head and the
waw's, and where the waw's tail leaves its head, our edge runs a hair
inside his (`h65_example.png` on the NAS).

The dal is the first letter fitted to the plate rather than the studio, and
sets the precedent: the head's second pass took its body from 0.970 to
0.972 while the head stayed at 0.937 (band fit, 0.06 nuqta max gap), the
whole letter 0.954. The head's thickest run is 1.14 pens on the page, which
a one-nib pen cannot reach, so the head's overlap sits lower than any
studio stroke's for the same closeness. Fitted strokes run from the tail to
the junction (s0) and from the junction round to the head's cap (s1): the
fitter's own direction, not Sabti's writing order, which the move tables
below record.

## The first join: على (2026-10-21)

ربك on Hashim's p. 66 is one piece of ink with the سم of اسم and the ال of
الأعلى, and his kaf there is stretched to the line; the user chose to start
joins with a word that stands as its own piece of ink instead: على, the end
of الأعلى. No studio shape matches a composition's forms, so the silhouette
was cut by hand (`jdplatecut.py --cuts`), two straight cuts placed by eye:
along the lam's stem where the ayn's jaw runs into it, and where the ayn's
head meets its jaw. The cut was shown to the user before fitting. Page 66's
pen measures as p. 65's (the thickest strokes 44 px on both; two dots read
about 10% smaller), so the nib is taken as 40 px.

- **The lam and ya are one stroke**: down the stem, the small elbow at its
  foot, round the bottom and up to the ya's tip. Fitted as two (cut at the
  lam's foot) it came out 0.941 with a seam where the ya starts; as one,
  0.948. The user left the choice to the look.
- **The whole-word refit helped here** (`jdwhole.py`): 0.948 → 0.952, the
  worst poke-out 0.12 → 0.09 nuqta, the join of the ayn's jaw into the lam
  smoother. The crotch where the jaw meets the stem is Hashim's own.
- Left: the ayn's head ends in the nib's flat cut where his is a little
  rounder, and the lam's elbow sits a hair outside his.
- Approved by the user the same day ("It looks pretty good"): one cut by
  hand, fitted stroke by stroke, then refitted as a whole word, is how a
  join from his page is made.

## Carrying approved strokes onto his other words (2026-10-22/23)

Cutting every word by hand does not scale, and the user cannot mark the
strokes by hand, so the cut is now carried: an approved letter's **pen strokes**
are moved onto the same letter form where Hashim writes it again, then
polished against his ink. The research runs (tests 1-10 and the queue
rounds) are on the NAS in `harf-research` (`done/` the scripts, `out/` the
results) and the queue's `done/` (`jd-c11-*` to `jd-c14-*`).

- **What did not work.** Finding cuts from the outline alone (notches
  where one stroke meets the next) finds every bend too. Carrying a whole
  word breaks wherever Hashim writes one of its letters in another form
  (his على on p. 67 has a short ya, not p. 66's bowl), so templates are
  per **letter form**. Carrying an outline and cutting his ink by it could
  not tell "his letter is wider here" from "another letter crosses here",
  so it spilled into crossing letters, and its patches covered the waw but
  "the strokes don't make sense" (the user).
- **What works.** Place the approved letter on his: a search over size
  (0.55-1.25), slant and turn scored by how close its outline lies to his
  edges, how much of its inside is on ink, and how much of **his ink just
  outside it** is left uncovered (without that last term a small template
  wins by hiding inside a thick stroke); then bend it gently onto his
  edges, undoing a bend that crumples. The approved strokes' nodes go
  through the same placement and bending, the nib staying Hashim's 40 px.
  The queue then polishes each stroke against the whole letter with the
  others held as ink (as `jdwhole.py`), twice, the tail tips trimmed to
  his ink between rounds (`jdtip.py`'s rule).
- **His letter for the polish** is his ink joined to the letter within
  12 px of the strokes, the rest of his ink nearby neutral. A crossing
  letter then counts only as far as the pen reaches. A letter cut from a
  word (the ain from على) does not score the edge where it was cut.
- **Results.** The three waws on p. 66 (two in والذي, أحوى): overlap
  0.96-0.97, approved by the user ("Waw strokes are fine"). The ain
  carried from على onto p. 67's two على's: 0.92 and 0.93, against a
  ceiling of 0.94 (the approved ain itself, unmoved, scores 0.94 against
  its own word cut this way, the ink at the lam's join being the lam's).
- **An end that stops short.** In the على before انفسهم the ain's body
  stops short of the rounded cap where his pen started it: the 12 px
  letter cut the cap off. Adding his ink beyond that free end to the
  letter (not the end that joins the lam, and only the cap, not the
  slivers of crossing letters beside it) and polishing again lets the
  stroke reach it (0.87 -> 0.90 against the letter with the cap). Both
  p. 67 ayns approved by the user ("Yes they look fine").
- The laptop-side scripts (placing, sheets, tip trim, run-on) and their
  results are in `harf-research/laptop/` on the NAS.

## The lam and short ya of p. 67's على (2026-10-23)

- **The cut came from the user's hand.** Both of my readings of where the
  ya runs were wrong. The user traced the lam and ya on the السعد word
  and the ya's tail on the انفسهم one: the lam stops where it meets the
  ain's arm; the ya starts under it, goes down, kinks right, sweeps into
  the bowl, and its tail rises up the left (the course's ya shape 1,
  lesson 11).
- **Cutting along a trace.** Disks along the trace under-filled where the
  trace ran off-centre and bulged at crossings. What works is a ribbon
  across the stroke: the trace is moved onto the middle of his stroke,
  his ink is measured edge to edge at each step, and a side that bulges
  out over a short stretch (another letter touching or crossing) is
  bridged from either side. His own widening is gradual and is kept. A
  first try that held the width at any sudden jump never let go, and left
  the ya thin. Where the user marked "bleeding" (yellow) or "not filled"
  (purple) on the cut, the edge is bridged or takes his full ink there.
- **The ya is two moves.** As one stroke it spilled onto paper on the
  inside of its kink: one pen stroke cannot turn that sharp an inside
  corner. Split at the bend (the course's "down", then "back"), each half
  taken from the approved cut so that together they are exactly it, with
  an overlap across the corner. The user asked for the split.
- **Marks the user draws on the fit are off-limits.** Three spills on the
  انفسهم word (under the ain's head, both sides of the ya's kink) did not
  move when the outline was weighed three times as much (edge 15): under
  the ain's head the "spill" was the crossing letter's ink, which the
  carried ain's run-on cap had taken into its cut. Taking each mark out of
  the letter and out of the neutral ground, so the pen there counts as
  outside, cleared them (0.920 -> 0.934, worst miss 0.26 -> 0.17 nuqta).
- **What I fixed that was not asked.** I read "a large spur at the ain and
  the ya)" as the strokes' overlapping ends inside the letter, and refitted
  the ya's moves each against its own piece. The user: "you fixed the
  wrong thing"; set aside. Overlapping ends hidden inside the ink are
  fine; ask for a drawing before acting on a spur.
- **The ain's head waits for the narrow pen.** Inside its curl our pen
  spills onto paper by up to 0.10 nuqta and leaves a strip of his ink
  bare underneath; the approved ain did too (0.12). The course writes the
  head's top with a pen a third of the main nib (lesson 6). The user
  chose to leave it until the fitter has a second, narrower nib.
- **Result.** Both على's, the whole letter with the ain: overlap 0.947
  (near السعد) and 0.934 (before انفسهم), worst miss 0.19 and 0.17
  nuqta. Approved by the user ("Yes"). The nodes, cuts and scripts are in
  `harf-research/laptop/c15/` on the NAS (`approved_ala_p67.json`), the
  queue runs in its `done/` (`jd-c15-*`, `jd-c15s-*`, `jd-c15f-*`).

## The narrow nib, and the ain before انفسهم (2026-10-24)

- **A second, narrower nib.** The fitter knows one pen. To fit with a
  narrower one, the queue job's pen is set to that width, and the node
  widths that come back are rescaled to the main nib, so a node width
  under 1 means the narrower pen. Nothing in the fitter changed.
- **The ain's head takes half the nib.** Fitted three ways to the
  approved head cut (the body written under it counts neither way): a
  third of the nib, the course's small pen (lesson 6), overlap 0.73,
  worst miss 0.18 nuqta, too thin for his head in one pass; half the nib
  0.91 / 0.07, filling the curl with almost no spill; the main nib
  0.91 / 0.88, spilling into the curl again. His head is bolder than the
  teacher's, and lesson 1 gets half width from one pen by letting part
  of the nib touch. The user chose half ("Yes half nib"); whole letter
  0.935 against 0.932.
- **Smoothing a stroke is evening out the nib's turn.** Between two nodes
  the nib turns at a steady rate; wherever that rate jumps, the edge gets
  a small corner. Resampling the nodes closer and evening out the angle
  along the stroke, without moving it, made the turning 2 to 4 times
  smoother in the lam, the ya and the ain's body, and took out a hair at
  the lam–ya joint and notches along the body. The head's curl really
  turns that tightly and stayed about the same. The user asked for it:
  "The jagged edges is the cause of some of the bleeding problems".
- **Smoothing did not reduce the ink on paper.** It went up, 504 px to
  553, because it also evens out places where the nib had narrowed to
  stay inside his edge. The folds it removes were real spills, so it is
  kept, but it is not a fix for bleeding on its own. Of two smoothed
  versions the user took the one with the body as before (0.931) over a
  refitted body that filled his tip with a fold (0.936).
- **A full nib cannot make his rounded club.** The body's tip ends in a
  round club. One full-nib pass reaches its top only by turning sharply
  at the start, which leaves a point, and a step on the upper edge where
  the turned nib's corner sticks out. Three refits and a tip-local polish
  around the user's marks (magenta to cover, green bleed made
  off-limits) all left the point and the step.
- **A half-nib touch rounds it.** A second, short stroke (`ain.cap`),
  with the user's agreement. The body ends three nodes earlier, its
  straight nib edge below his top. The touch's cut is his ink in the tip
  minus the body, the crossing strokes and the green mark, keeping every
  piece of 20 px or more. A first cut kept only the largest piece and too
  wide a margin round the green, and lost a wedge on the top left ("Just
  missing a piece on top"). Where the touch lies over the body the overlap
  is hidden in the ink.
- **The user's second marks.** On the touch's first fit: a squarish
  corner at the lower right, where his ink runs into the crossing letter
  (green: cut, made off-limits), and a bend in the upper edge where the
  touch meets the body (blue: smooth). The bend was measured as the
  sharpest turn of the outline at 16x and the touch's tail pulled inward
  until it fell from about 20 degrees to 5 while clear of both greens.
- **Closing a pinhole between two strokes.** Each refine of the touch
  reopened a pinhole of paper between it and the body's end, and nudging
  the body's last node bared its end corner as a dent. What closed it:
  the body runs on a little (0.15 nuqta) along its own direction under
  the touch, its width narrowing to half the nib, checked at 16x.
- **Result.** The whole letter: overlap 0.937, worst out 0.13, worst short
  0.19 nuqta (0.18 before the touch: the body's upper edge lower down
  sits about a pixel inside his ink); ink on paper 553 px to 520; no
  pinholes; his ink inside the cut corner left bare, as asked. Still
  there: an angled end with mild corners at the cut, and the bumps on
  the lower right of the ya's bowl. Approved by the user ("yes"). Nodes in
  `harf-research/laptop/c15/approved_ala_p67_anfusihim.json` on the NAS,
  queue runs `jd-c15n-*`, `jd-c15j-*`, `jd-c15cap-*`, `jd-c15cap2-*`.

## Strokes that mesh: the basis (2026-10-25)

The user, once the studio's composed letters were captured: "treat this as a
collection of strokes that mesh into each other to form joined letters/words.
This has to be the fundamental basis of this part of the project." Every plate
is cut again on that basis.

- **The studio's composed letters are the guide.** All 902 shapes its Letter
  shapes picker offers were read one at a time with the Crowns switch on
  (overlapping letters lose their crowns), each with its marks: the three
  crown sizes (T04-T06, a head and a hairline each), the kaf's upper stroke
  (T18), the ط's stem (T16) and the dot groups. Kept in the scratch
  `studio-composed/composed.json` and on the NAS; `jdcatalog.strokes()`
  serves a composed key (`family-Form|stamp`) as the body strokes plus each
  mark's strokes, named `T05.s0` and so on.
- **Placed whole, then stroke by stroke.** `jdguidepick.pick` places the
  composed letter over his ink (dots left out). Then `refine` places each
  body stroke again on its own (within 15% and 9 degrees) and each mark with
  its strokes together (0.7-1.4x, 24 degrees, 1.5 pens of travel), each over
  the ink the others leave, always searched from the whole letter's pose so
  the ranges never compound.
- **The crown is a structure of its own.** Its distance from the letter
  varies (the user, 2026-10-25), so it is never held at the studio's
  offset: `plates.json` records, for every piece, where it landed against
  the studio's place (`placed`: moved in pens, size, turn). On p. 65 the
  crowns sit up to 2 pens from the studio's place and up to 1.4x its size.
- **Body before mark.** Where a mark's guide lies over a body stroke's, the
  ink is the body's, so a crown's hairline beside the stem takes none of it.
  A dot takes only a dot of his: of the small blobs within 3 pens of his
  letter, the one nearest the studio's dot, up to 4.5 pens from it (his dots
  sit elsewhere than the studio's: the zay's above the head, the studio's far
  to the left). Where his two dots touch (qaf, ta) one piece holds both. His
  alphabet writes ba and ta on one body, so that letter is guided by the ba's
  dot and the ta's together.
- **Windows (%) stay open.** A piece's outline is its outer edge; a window
  inside it is kept as a hole beside it (`pieces[sid].holes`), never filled.
- Known weak spot: the crown's thin tail below where it crosses the stem
  (lam, kaf) can go to the stem when the studio's tail is shorter than his.
- **Whole words from the studio.** Typing a word into the studio's word
  keypad (Jali Diwani style) previews it on the sheet; each piece of the word
  (a run of joined letters) carries `data-pen-item` with its stamp ids and
  its **junctions**: for each letter, the stroke that leaves it and the
  stroke of the next letter it runs into. That is the join map, stroke to
  stroke. All words of p. 66 and of p. 67's second line were read this way
  (2026-10-25, nothing downloaded): scratch `studio-words-jd/words.json`,
  pictures in `HarfCanvas side-by-side/studio words Jali Diwani/` on the NAS.
  الله is not built from letters there but is a ready module (T01). The
  studio adds a long swash (T14) to a final ba.
- **His words are not the studio's layout.** Hashim stacks and stretches;
  carrying a whole word rigidly failed before (2026-10-22). The studio's word
  gives the letters' shapes, their marks and which strokes join; each letter
  is then placed on his ink on its own, in reading order, and the join map
  says where one piece may run on into the next.

## The studio is the convention (2026-10-25)

Shown the p. 65 recut, the user found the ta, ra, zay and sad right "for the
most part" but said this script "has a lot of variability in how it is
written... pick one convention and stick to it." Offered the studio's split
as that convention, they agreed and went further: "you can save hashim's
version as a reference but i think the studio works better here. so lets
start fresh with the studio." This reverses 2026-10-21 (every letter fitted
to Hashim's page and proportions).

- **What the convention is.** The studio's strokes, as its composed letters
  and words use them, are what the pen is fitted to: their split, their
  shapes and their proportions. One way per letter form, the studio's; his
  variants are not cut.
- **Why the studio.** It covers every letter in every position, with its
  crowns, dots and the junctions that join one letter to the next, and it
  splits a stroke the same way wherever it appears, so fitted strokes will
  mesh into words. Its strokes have no windows: where a letter has a
  counter (the ha's eyes) it is the space between separate strokes, so the
  fitter, which fills an outline, needs no special handling.
- **Each stroke is fitted once.** Strokes are keyed by outline
  (`jdcatalog.key`), so a body stroke shared by ba, ta and tha, or by sin and
  shin, is one job. A mark (crowns T04-T06, the kaf's stroke T18, the ط's
  stem T16, the dot groups) is fitted once in its own frame, unturned; a
  stroke of several dots is split into one dab per dot (T23 two, T27 three).
  Where a mark sits on a letter is that letter's matrix in `composed.json`,
  which is the crown's variable offset the user asked for.
- **Batches.** First: every shape the Isolated and Final forms use, the
  stamps of the 41 studio words of pp. 66-67, and the marks (160 shapes,
  351 new strokes; the ورد strokes from 2026-10-20 are reused). Second: the
  rest of the Initial and Medial shapes (209 shapes, 417 strokes). Then the
  second passes, end trims and tip rule as in "Fitting the studio's shapes".
  Working folder: scratch `jd-studio/` (`registry.json`, `batches.json`).
- **Hashim's work is reference.** The p. 65 cuts (test 19, plates and
  pictures) are on the NAS in `harf-research/laptop/c19/`, and their review
  pictures, with the carried p. 66-67 waws and ains (old decisions 60-75),
  in `HarfCanvas side-by-side/Hashim reference/`. The letters already
  approved from his page (dal, waw, ra, على, the p. 67 ains and waws) stay
  approved as reference fits; the library takes the studio's.
- **Next, the mesh test:** assemble the fitted strokes into the studio's 41
  words by their junctions and compare each with the studio's own word.

## The studio's source: the vector sheet (2026-10-25)

The user then gave Omar Uddin's *Jali Diwani Vector Sheet 2.0* (two SVGs,
Detailed and Flat; reference only, kept off the repository). **The studio's
Jali Diwani shapes were extracted from it**: the studio's `db.json` carries
`sheet_form`, `n_red` (the sheet draws the letter studied in red) and an
extraction `iou`, and its twelve isolated alifs match the sheet's in
proportion to 0.01. The Detailed sheet draws every pen stroke as its own
path, grouped per letter, so it holds the exact outlines the studio
approximated (its extraction scored 0.85-0.93 against the sheet).

- **Matched on the Geekmini** (research t20, FFT over every shift): one
  scale, 2.866 studio units to the sheet's point; 546 of the 548 studio
  shapes that are single letters (the 191 pair-table shapes are two letters
  drawn together and are not used) match a sheet letter at a median overlap
  of 0.981 (5th percentile 0.962), and each studio stroke the sheet stroke it
  was cut from (median 0.977). The split is the same: where the counts
  differ, the studio cut one sheet stroke in two (the ayn's tail, 403, 404,
  484, 485; the second piece is absorbed into the first). Four shapes
  (247, 614, 646, H01) are spread over more than one sheet unit, a letter
  with an optional tail end or stem embellisher drawn on; those were
  matched stroke by stroke.
- **No source found:** 362 (sad, initial/medial) and 580 (kaf, initial);
  the studio's outline serves for them until they are looked at.
- **Marks:** the crowns (0.94-0.96), the kaf's stroke (0.98), the ط's stem
  (0.99) and the round dot groups (0.98) come from the sheet. The studio's
  square dots T20 and T22 have no match; every dot on the sheet's Nuqta
  layer is the same shape, so they take that dot, centred where the studio
  put its own.
- **The pen is 3.8 studio units**, not the extraction's 3.6: the sheet's dot
  is the nib, 3.80 units on its long side, and its thickest strokes reach
  3.7-3.8.
- **The connection types A-M** printed on the sheet's pair tables are the
  studio's `ports` (`port_source: brushset`).
- `jdcatalog.py` serves the sheet's strokes in each stamp's own frame when
  `JD_EXACT` names `stamps.exact.json`, so the composed letters, the words
  and their junctions stand unchanged. Jobs are named `jdx-`; the 46 fits of
  the extraction that ran first are kept for comparison. Batches as above:
  322 strokes, then 337.

## The pen held to the qalam (2026-10-26)

`jdpenjob.py` fits the sheet's strokes with the Thuluth session's pen model
(one size, width falling only at the ends onto one corner), changed for
Diwani as the trials showed:

- **The nib turns as it goes.** One angle a stroke drew the alif at 0.75;
  turning at every node, 0.98 (the course notes: rotate the pen while
  moving). Sizes stayed at the full nib.
- **The small pen** (a third of the nib) for the head curls and crown heads,
  the user's call. The thickness scan (t22: each stroke's thickest point, in
  nibs) puts about 110 strokes at or under a third, with a gap at 0.28-0.34;
  the crown's long looped stroke is one (0.27), the main nib cannot draw
  it. Thin is not proof of the small pen: a candidate list goes to the user.
- **End windows in proportion to the nib.** Sized for the main nib, they
  covered the whole jim head curl and an unwound fit beat the spiral.
- **Long tails** (4 nuqta or more) may thin over 2 nuqta, the user's call.

**The flick, from a lesson video the user pointed to:** as the stroke
finishes, lift the nib's short side gradually while the hand keeps moving,
so that at the end only the tip of the long side touches. That is the
model's lift onto one corner, and it is always the same corner. The fits
agree: every real tail flick in the trials (237.s1, 113.s1, 001.s0, 553.s1)
chose the end corner on the nib's upper end, the one the model calls +1
while the angle stays within 0-180. The fitter still tries both corners at
each end (the user, 2026-10-26: "just let the fitter choose"). The same video writes the ra in two
moves, the head then the tail from the head's foot, as the sheet splits it.
A Thuluth alif lesson showed the paper turned for the head and the tail:
the nib's angle to the letter changes between its parts.

**Thin decorations take the small pen; a head curl ends in a circle (the
user, 2026-10-27, pointing to the course's jim lesson).** The jim's fourth
move, its head, "is done with a different pen size", a third of the nib,
and the alif lesson gives the same pen to "the decorations and the small
heads". On 11 thin test strokes the small pen beat the main nib every time
(116.s0 0.87 against 0.68, 053.s1 0.97 against 0.88), so every stroke at or
under a third of the nib that the thickness scan held back is fitted with
it. The same lesson draws the head's other shape as a sweep that "end[s] it
with a circle": the jim's head curl 113.s2 is the spiral (overlap 0.88), not
the hook the judge picked (0.77) for a smaller miss at the tip. The judge is
left as it is; where a curl's best-overlap fit (the job's `.alt` picture)
beats the judge's pick, the curl is taken.

**A curl goes on round into its hook (accepted by the user, 2026-10-28).**
The jim lesson's circle head (05:29-05:36) is one small-pen move. It
starts as a hairline on the right, sweeps left thickening, turns down,
curls under and back to the right, and stops in a short thick foot. The
inner hook is that foot, not a stroke of its own. The band's centre line
stopped at the bottom of the curl, so the fits left the hook empty
(window_worst 0.18-0.20). `PEN_WALK` gives a curl a second start, the walk
round its skeleton that the tip hairlines use, and that walk reaches the
hook. On the 21 curl tails (tag c2: 114.s2-161.s2) every best fit came
from the walk: overlap 0.86-0.88 rose to 0.946-0.955, the worst window to
0.035 (0.05 on 145.s1 and 152.s2), and 113.s2 to 0.95. Each end narrows to
about 0.7 of the small pen over its last 1.7 nuqta as the curl tightens.

**The sin's tooth is two strokes that meet at the peak (decided by the
user, 2026-10-28).** The pen narrows only where it lifts at an end, so a
single stroke keeps its full width over the peak. The peak then rounds off,
or the stroke cuts under it and leaves the tooth empty. The course teaches
the tooth as "stop and come back", so each tooth is its own move (lesson 4).
`PEN_CUT` cuts the outline at its sharpest outward point, across the stroke
under the tooth. The right half (`~c0`) runs from the stroke's right end
into the peak. The left half (`~c1`) runs out of the peak, and both may
narrow onto a corner there. Against the sheet's whole outline (tag k1):

| | one stroke: overlap | one stroke: typical edge miss | two strokes: overlap | two strokes: typical edge miss |
|---|---|---|---|---|
| 297.s1 | 0.924 | 0.043 | 0.949 | 0.028 |
| 301.s1 | 0.851 | 0.116 | 0.934 | 0.032 |

Both halves are one qalam. Fitted apart, 297.s1's halves took 1.49 and 0.94
nib sizes, and the bigger one bulged past the sheet's end. So the bigger half
is now fitted first, with its size free, and the other half is held to that
size. The Thuluth side kept its sin as one stroke (decision 51). Diwani's
tooth gains much more from the cut, so that choice does not carry over.

The right half starts at a thin spike, and there the pen first stood out
past the sheet's edge. The flick was tried for it (the user asked). The
ledger's flick starts on the nib's corner at the hairline and opens at one
angle. That lost on both strokes: 297.s1's right half scored 0.80 against
0.90 for the turning nib. Through the dip the nib turned about 170 degrees,
which one angle cannot follow. (That turn was a fault of the fit, not the
pen; see the end-window note below: held upright, the nib slides down and
left through the dip.) A turning nib allowed to narrow over the
whole half lost too (0.90 and 0.88). So neither flick is tried by default
(`PEN_FLICK=1` turns them on). With the shared size, the plain turning nib
reaches the spike; only a sliver stands out on 297.s1. Against the sheet's
whole outline (tag k5), 297.s1 scores 0.942 and 301.s1 0.948. A rerun of
the same settings moved 297.s1's right half between 0.925 and 0.936, and
its shared size between 0.95 and 0.94, so differences that small are noise.

The other eleven main-pen tooth strokes were cut the same way (k6, 2026-10-29).
071.s0 has no peak to cut at and stays one stroke. The cut first landed in
the wrong place on four of them: 356.s0 and 357.s0 down the shaft or near the
hook's tip, 299.s1 in the dip, 366.s0 near the hook's tip. The peak is found
by how sharp the outline turns a quarter nuqta either side of a point. On a
long smooth stretch the outline's points lie far apart, and the nearest point
a quarter nuqta back was sometimes the point itself. That reads as a right
angle, and it beat any real peak blunter than that. `cut_piece` now measures
along the outline between its points. The other strokes kept their cut.

Separately, the fitter twice picked the worse fit for a right half. 290.s1:
a try that followed the dip and the peak at 0.94 lost to one that missed the
dip at 0.83; 366.s0: 0.947 lost to 0.902. The better try's only fault was its
free end. Drawn with the nib edge-on, it ran on as a hair past the sheet's
spike tip, and the end window counts that as a deep miss. The tip rule
(the user, 2026-10-21: the tip stops where the reference's ink stops,
`jdtip.py`) now runs on every try before the pick, not after (the user,
2026-10-29). `trim_ends` pulls a hairline free end back 0.05 nuqta at a time
while that lessens the ink outside near the end. It stops when the sheet's
own ink near the end would come uncovered by more than 0.03 nuqta, and after
1 nuqta at most. A broad end, a cap or a head, is left to the fit, and a cut
half's cut end stays. The try is then scored again against its start path's
end windows, so a trim that leaves the sheet's end uncovered shows as a
miss. Each try keeps its untrimmed score beside the trimmed one (`raw`,
`trim`). `PEN_TRIM=0` turns it off. Against the sheet's whole outline:

| | one stroke: overlap | two strokes, first cut | two strokes, peak cut | with the trim (k8) |
|---|---|---|---|---|
| 290.s1 | 0.856 | 0.866 | (the same cut) | 0.934 |
| 299.s1 | 0.835 | 0.944 | 0.950 | |
| 356.s0 | 0.776 | 0.917 | 0.982 | |
| 357.s0 | 0.854 | 0.946 | 0.980 | |
| 366.s0 | 0.795 | 0.952 | 0.931 | 0.946 |
| 297.s1 | 0.924 | | 0.942 (k5) | 0.943 |
| 301.s1 | 0.851 | | 0.948 (k5) | 0.948 |

309.s1 0.942, 311.s1 0.956, 312.s1 0.938, 313.s1 0.941 and 347.s0 0.953 were
cut at the peak the first time (k6). 366.s0's first cut scored higher, but
it was not cut at the peak and its half bridged the tooth. With the trim, its
right half follows the dip, and its end stops at the sheet's tip.

**A cut half is judged at its free end only; the nib does not spin through
the dip** (the user, 2026-10-29). 366.s0's right half wound its nib about 165
degrees through the dip (87 down to -77). That drew a ledge in the dip, where
the nib lay flat, and a spike over the peak, from the nib's corner. The user:
there the pen goes down and slides left; it does not turn. The fitter tried a
nib held upright down the dip, and it covered the outline better (0.944
against 0.919). It lost on the window at the cut end, 0.27 nuqta to 0.13.
That window asked the half to cover its own side of the cut alone, before the
other half was drawn, and the spin was how it did. `PEN_CUTWIN=free` judges a
cut half on its free end's window only. The joint is checked on the whole
outline once both halves are in. A charge on how fast the nib turns
(`PEN_TURN`, k9) only spread the spin out, and it made 297.s1 and 299.s1 worse.
It is off.

With no window at the cut end, nothing caught a cut end running past the
peak. 347.s0's right half ran 0.4 nuqta over it, a spike the user marked.
Under `PEN_CUTWIN=free`, `trim_ends` trims the cut end too.

347.s0's left half still began a little high, inside the right half's ink,
and left a step below the peak. The user drew its start (2026-10-29):
- the second stroke starts where the first ended, its top level with the
  first's;
- the nib moves a short way left (the user first said right, then corrected
  it; right left a square notch at the peak);
- then the long move down.

`PEN_LEAD` fits it that way:
- The right half's points are pulled down until the nib's top is level with
  the outline's peak, never up (`level_top`).
- The left half starts there, at full nib width (left to narrow, its top sat
  under the peak's shoulder).
- It moves `PEN_LEAD_STEP` (-0.15 nuqta, to the left).
- Its start and its tail's end are held. Left free, the tail's end drew up off
  the tail.
- The short move's end is not held (`PEN_LEAD_HOLDSTEP=0`). Held level at
  full width, the move stood over the outline where the top edge falls away
  left of the peak, and drew a bulge (k17).
- Its nib starts at its own path's angle. At the right half's upright angle,
  it stayed upright down the whole left half.
- An overlap at the joint (`PEN_LEAD_OVERLAP`) was not needed (k20: 0.971).

The studio's tail ends in a short flat cut, and the held tail matches it.

**Superseded the same day.** The user then asked to approve every item by hand ("Before we move on, let me
manually approve every item we have so far"). Shown each stroke alone, as studio | ours over the studio's edge | ours
alone, they approved only three: "approve numbers 1 and 8 from the first sheet. only approve 9 from the second sheet.
reject the rest". Approved: **366.s0 (k10), 357.s0 (k10), 347.s0 (k19)**. Rejected: 290.s1, 297.s1, 301.s1, 309.s1,
311.s1, 313.s1 (k10), 299.s1 (k7), 312.s1 (k21 and k6), 356.s0 (k21 and k7). The table below is the pick as it
stood before that review; only the three approved rows stand.

Asked what was wrong, the user ruled first on what is not wrong: "The squared left end is very advantageous. I would
not get rid of that because that is where the stroke connects to the next letter. The small kinks that you mentioned
are actually not that bad. The small tick at the peak is also fine." A stroke is "one movement of a pen" and smooth;
a V or an angle belongs where two strokes adjoin. Shown the nine side by side (studio | ours), they marked four, all at
the peak where the halves meet, "very subtle": 301.s1 and 309.s1 a nub on the peak and a notch just under it, 299.s1
a two-tipped peak, 312.s1 a jagged peak and a small notch on the dip's right side. "The others I approve": **290.s1,
297.s1, 311.s1, 313.s1 (k10) and 356.s0 (k7)** are approved. The four marked are refitted with `PEN_LEAD`.

`PEN_LEAD` drew a second horn on these flat-topped peaks, full width or narrowing (k23, k24). Bringing the right
half's points down to the peak (`level_top` alone, on the k10/k7/k21 fits) cleared 312.s1 and 309.s1's nub. Shown the
fixes with each stroke's letter beside it in colour (the user: "showing marks in different colors may also help"),
the user approved, 2026-10-29 ("much better. The first page is good"): **312.s1 (levelled), 685.s1 (`PEN_TURNS`, no
ledge in the bowl), T02.s1 (the small pen), 105.s0, 249.s0 and 685.s0** (the last two's tails run under the next
stroke of the letter). Still marked at the peak: 309.s1 and 301.s1 a small notch just under it, 301.s1 a kink on the
slope, 299.s1 two tips. They go to `PEN_JOINT`: each half refitted against the whole stroke's outline with the other
half's ink on the page.

That refit made every half worse on the whole outline (299.s1's first half 0.949 to 0.874), so none stood. Filling
and trimming against the studio's outline near the peak copied its facets and V back. What worked, approved 2026-10-30
(shown the three peaks, studio | before | smoothed, the user: "Ok"): **smoothing our own ink at the joint**
(`jdfinish.py`). Within 0.8 nib of the joint, notches between the two strokes close (a closing of 0.10 nuqta); within
0.35 nib of the peak's top, thin tips come off (an opening of 0.07 nuqta, kept to the tip: over the whole zone it cut
through the tooth's thin rising stroke). 299.s1 has one smooth peak; 309.s1's notch is filled; 301.s1's is mostly
filled, and the slight kink on its slope stays (a bend outward, which a closing cannot change). Under 0.01 square
nuqta changes a tooth. **309.s1, 301.s1 and 299.s1 are approved** with the right half levelled to the peak and the
joint finished. The finish is for a tooth's peak only: at the Bismillah's joins between letters (2026-10-30) it
rounded the counters' tips into lobes (joins 2 and 8) and drew a hook (join 7), even held to the studio's ink. There
the sharp inner corners are real: an angle belongs where two strokes meet.

**The Bismillah, review sheet 1 (2026-10-31).** Approved: **003.s0, 059.s0, 059.s1, 136.s0, 136.s1, 136.s2, 151.s0**.
059.s2 stays open (the user: it "is going to end up with an irregularity when it joins to another letter").

**Joins between letters.** Fitted as they are, six of the eight Bismillah joins already look like the studio's. Two
did not: a step under the ha->ya (136.s0 -> 105.s0) and a nub at the ha->mim (151.s0 -> 672.s0). In the word, the
sin's second tooth came out a sliver: 314.s0 and 314.s1 both took a 0.7 nib (the user: "it is the sin tooth").
- `PEN_NEXT`: the entry stroke refitted alone with the exit stroke's ink counted as on the page. Every join got worse
  (ha->ya 0.917 to 0.871 in a 1.5-nib zone, a notch and a hook; ha->mim a spike; the sin's tooth lost). With the
  exit's ink there, the entry gains nothing by covering the joint, and its start drifts loose.
- 314.s0 at the full nib (`PEN_SIZE=0`, and with `PEN_FULLEND`): the sin's tooth did not come back; it is 314.s1's start.
- `PEN_THROUGH`: exit and entry fitted as one pen movement through the join, then split where they meet, so each
  letter keeps its strokes and a raised, dropped or stretched letter still carries its half. At the ha->ya (th1) the
  step under the join went; the ha->mim's nub stayed. The user approved the ha->ya (2026-10-31) with the seam closed:
  meeting at one node, the halves drawn apart left a hairline, so the exit now runs one node on under the entry's ink.
- 314.s1 at the full nib (sq3): the sin's second tooth is solid again, a little shorter than the studio's.
- The ha->mim (151.s0 -> 672.s0) stays one movement (the user, 2026-10-31: "One movement"). Its nub is still open:
  it is in the studio's own outline, and fitting the ha on into the mim's stem (672.s1) matched only 0.464.
- The sin's teeth (2026-11-01): 314.s1 at the full nib with its start full (`PEN_FULLSTART`, sq4) and 314.s0 cut in
  two at the full nib (`PEN_CUT`, `PEN_CUTWIN=free`, `PEN_CUT_MARGIN=0.15`, `PEN_FULLEND`, sc1), finished where the
  two meet without the shave: the height and walls match the studio's. The points were needles where the studio's
  are a little round. Holding the nib 40 or 55 degrees across the way up at the tooth's start rounded nothing (a flat
  nib makes a slanted flat) and cut the teeth down; turning the nib, narrowing it, or rounding by an opening did too.
  **Approved: a small round cap of our own ink on each point** (`jdfinish.cap`, 0.012 nuqta; the user: "Small"). The
  studio's first tooth is still a little thicker along its length; a cap does not change that.

**Heads that turn back (the catalogue's overnight fits, 2026-10-31).** A stroke that rises and turns sharply back
down into a flag (074, 076, 077, 084, 086, 087, 108, 731) lost the flag fitted whole: rounded off or gone. The flag is
a second move, as a tooth is: `PEN_CUT` with the peak allowed within `PEN_CUT_MARGIN` of the end (0.3, or 0.15
nuqta). 074.s0 0.929 to 0.946, 084.s0 0.82 to 0.931, 108.s0 0.831 to 0.951, each flag back. At 0.15: 076.s0 0.920 to 0.985, 077.s0 0.921 to 0.987, 087.s0 0.947 to 0.968. 731.s0 kept its flag but
drew a spike at its other end. 075.s0 and 095.s0 find no peak to cut at; 086.s0's cut falls at the flag's far edge.
The thin crossing loops 484.s0 and 485.s0 (0.19, 0.27) fit with the small pen walking the skeleton (`PEN_SMALL`,
`PEN_WALK`): 0.91 each; 732.s0 with the walk, 0.805 to 0.892.

**The flag head is three moves (the user, 2026-11-01; approved on 074, 084 and 108).** "The stroke starts with the
pen moving towards the left. Then there is a second stroke that goes up to 11 o'clock, and the third stroke starts
slightly higher where you get the notch and then rolls down." `PEN_THREE` cuts the head (`three_piece`):
- **red, the block:** cut off by the nib's line through the flag's top corner, the nib lying along the flag's right
  edge;
- **green, the climb:** from the flag's top corner to the peak, down the notch and the neck's underside;
- **blue, the roll:** its cut runs from the notch straight up to the peak. Cut across the stem at the notch instead,
  the climb kept a strip of the neck and ran on left past the peak to cover it, flattening the point.

Green follows red (`PEN_FOLLOW`): it starts at the corner where the neck's underside meets the flag's bottom
(`PEN_FOLLOW_AT`), so no notch is left between them ("the green strokes should start matching the bottom of the
red stroke"). The underside is the trace of the nib's lower corner as the pen climbs up and to the left, not a nib
face, so the nib is held at 80 degrees (`PEN_FOLLOW_ANG`), near upright, along its first half nuqta (`PEN_FOLLOW_HOLD`),
and never moves right or down. Holding the nib along the underside's own angle (118 degrees) spilled; a dome at the
peak went when the roll's cut moved to the peak. Blue is fitted last with red and green kept (`PEN_KEEP`).

**Red and green are a pair (the user: "You have to use them together").** 074's pair is carried to the other flags
whole, by one affine map from six points of the head (the flag's top corner, the peak, the notch, the neck's bottom
corner, the flag's two right corners): 084's head is 074's, 108's is narrower. Fitting 108's red on its own ran it
the wrong way.

| stroke | overlap | studio ink missed / ours outside (sq nuqta) |
|---|---|---|
| 074.s0 | 0.970 | 0.016 / 0.018 |
| 084.s0 | 0.960 | 0.047 / 0.013 (most of it the tail's blunt lip) |
| 108.s0 | 0.953 | 0.020 / 0.015 |

**Blue on 095 and 731, and the tails of all four (the user, 2026-11-02; approved on 075, 086, 095 and 731).**
Blue is re-run from its kept fit (`PEN_POLISH`), not fitted afresh:
- **The neck (`meet`, 095 and 731):** blue's first node is green's last (place, angle and width), which cleared the
  red spike at 095's neck. Its first segments are split, and widths are free there (`PEN_MEET_WIDTHS`), then capped at
  the nib and settled again, which removed the wedge. 731's seam is not closed by an overlap: "no you cannot close
  731".
- **The tail (`PEN_TAIL_FIT`):** the studio ends each tail in a small blunt knob, and ours ran to a needle. Whole-
  stroke scoring can't see a miss that small, though the grid (200 px a nuqta) can. So only the last 0.6 nuqta is refit,
  scored on the studio's ink within 0.6 nuqta of the tip (`tail_piece`), and kept only if the worst miss at the tip
  falls. With widths free, 086 got its knob but also a waist (0.90 → 0.71 → 0.94 nib), which showed as a step. Evening
  the widths out afterwards spilled 0.1–0.17 nuqta. **Kept: widths held at the nib (`PEN_TAIL_WFREE=0`)**, with 095's
  tip started blunt at the studio's far end (`PEN_TAIL_SEED`).

| stroke | tip gap (nuqta) | overlap |
|---|---|---|
| 095.s0 (n095h1) | 0.031 → 0.010 | 0.962 → 0.966 |
| 086.s0 (n086h1) | 0.048 → 0.010 | 0.983 → 0.986 |
| 731.s0 (n731e, end patch) | 0.023 → 0 | 0.970 → 0.975 |
| 075.s0 | unchanged; its square end already matched | 0.985 |

**731's tail is the studio's outline (the user allowed it, 2026-11-02).** No refit reached the knob: widths free,
evened out, or held, each left a needle or a spill. The Thuluth session had the same result and patches its ends
with the studio's outline instead. `jdendcap.py` does the same here. Within 0.3 nuqta of the tail's last node, ours
past the studio edge is erased and the studio's ink, rounded by two rounds of corner cutting, is filled in. The
patch is stored as the record's `endcap` (erase and fill rings, in nuqta). 0.3 nuqta is where ours and the studio
already agree to within 0.003, so the patch's edge leaves a jog of about 0.004, invisible at normal size. Tail ends
only, and only once the pen fit has failed.

**484, 485 and 732 (the user, 2026-11-03; approved).** The studio's outline may now patch any part a pen fit can't
match ("you can use the studio outlines for anything not limited to the tails"). The pen fit still comes first.
- **Crossings go straight on (`PEN_WALK_STRAIGHT`).** At a junction, the skeleton walk took whichever branch came
  first, so 485's loop turned back on its own side and its two sides touched instead of crossing. The walk now takes
  the branch that carries on straightest. On 484 that fixed the loop but broke the small curl, which has a crossing of
  its own. So the old fit's curl was joined to the new fit's loop, with the nib angle made continuous across the join,
  and refit from there (`PEN_START`, a start given by hand): 0.917 → 0.947.
- **732 is a flag head (731's kind).** Red and green come from the sheet as one nib gesture, then blue is fitted with
  them kept, then the neck and tail pass (meet, held-width tail).
- **Patches (`jdendcap.py`, a list where a stroke has more than one).** 484's and 485's loop bottoms (the studio
  comes to a point, ours was round), 732's bowl bottom (a lump and a nick), and the five tail tips (needles 0.15
  nuqta past the studio's end, or short of it). A hard switch at the patch's circle left a 0.005 jog, so inside the
  last 0.15 nuqta our edge eases into the studio's, blended by signed distance. Every tip is now within 0.005 nuqta.
- At a crossing, the studio's outline has a small hole where the two lines overlap (even-odd fill). Ours is solid
  ink there, as a pen leaves it.

| shape | before | now |
|---|---|---|
| 484.s0 | 0.898 | 0.965 |
| 485.s0 | 0.914 | 0.96 |
| 732.s0 | 0.889 | 0.97 |

**076, 077 and 087 (the earlier catalogue fixes, the user, 2026-11-03; approved).** They were fitted with the
turn-back as a second move before the flag head had three. Now they are three moves: red and green from the sheet as
one nib gesture (076 and 077 share the head), then blue fitted with them kept. 076's tilted flag and the strip 087
missed along its head are gone. Patches, each blended in:
- the tails: 076's and 077's square ends had corners past the studio's, and 087's needle is now the studio's knob;
- each head's peak: a small spike past the studio's.

The first peak patch erased part of blue beside green, because the patch counted only its own stroke's ink as ours.
Now every stroke of the shape near the patch counts. The earlier patches (731, 484, 485, 732) each sit where only one
stroke has ink.

| shape | before | now |
|---|---|---|
| 076.s0 | 0.981 | 0.991 |
| 077.s0 | 0.984 | 0.990 |
| 087.s0 | 0.966 | 0.989 |

**The rest of the catalogue, reviewed in sheets of eight (the user, 2026-11-03).** The 238 strokes not yet reviewed
were sorted by eye into groups: clean, hooked ends, barbed heads, spills past the studio's edge along one side,
bowls, and wrong shapes. Of the first 32 marked clean, the user approved 24 and sent back eight: 023.s0, 023.s2,
078.s0, 081.s0, 104.s0, 106.s0, 107.s0 and 109.s0. Their overlap scores look like the approved ones, so the scores
alone don't catch what is wrong with them.

Approved as fitted: 013.s0, 014.s0, 016.s0, 017.s0, 083.s0, 090.s1, 091.s0, 093.s0, 162.s0, 164.s0, 165.s0, 165.s1,
166.s0, 167.s0, 170.s0, 171.s0, 172.s0, 172.s1, 173.s0, 173.s1, 176.s0, 177.s0, 178.s0, 179.s0.

**Hooked ends are patched from the studio's outline (approved).** On twelve strokes the pen fit stopped short of a
small hook at one end, or ran past it, by up to a third of a nuqta. The user expects this to be common ("you can start
on the end hooks because that is going to be a common issue"). Each hook is patched as 731's tail was. The patch is a
disc round the end node, of radius 0.6 to 1.2 nuqta depending on the hook's size, and our edge eases into the studio's
over the disc's last 0.15 nuqta. On 164.s1, 474.s0 and 476.s0 our pen's tip ran past the studio's, and the blend left
it as a separate speck below the hook. The patch now drops any island of our ink that has no studio ink under it.

| shape | end | radius (nuqta) | before | now |
|---|---|---|---|---|
| 088.s0 | last | 1.2 | 0.940 | 0.985 |
| 096.s0 | first | 1.1 | 0.950 | 0.988 |
| 097.s0 | first | 1.2 | 0.955 | 0.978 |
| 099.s0 | last | 1.1 | 0.963 | 0.985 |
| 100.s0 | first | 1.1 | 0.962 | 0.985 |
| 110.s0 | first | 1.1 | 0.950 | 0.983 |
| 111.s0 | first | 1.0 | 0.946 | 0.990 |
| 112.s0 | last | 0.9 | 0.943 | 0.977 |
| 164.s1 | last | 0.75 | 0.965 | 0.988 |
| 200.s0 | first | 0.6 | 0.952 | 0.987 |
| 474.s0 | first | 1.05 | 0.948 | 0.992 |
| 476.s0 | first | 1.15 | 0.942 | 0.992 |

**Tried and dropped: settling the spill group (`PEN_SETTLE`, 2026-11-03).** On long S strokes and alif stems the fit
runs 0.02 to 0.05 nuqta past the studio's edge along one side, with the nib held near full width. `PEN_SETTLE` took the
fitted stroke as it was, split its segments, and settled it with the widths free (never wider than the nib), then again
on those widths. It raised the overlap on all five tried (162.s1 0.982 to 0.993, 181.s1 0.976 to 0.991, 620.s1 0.982
to 0.993, 459.s1 0.987 to 0.995, 023.s2 0.969 to 0.982), but the freed widths left lumps and facets along every one,
and strokes are smooth. It was taken out of the pen job. The spill group is to be patched from the studio's outline
along the side that spills instead.

**Peaked bends follow the studio on both sides (the user, 2026-11-03; the eight sent back, approved).** Six of the
eight are the same shape: up to a peak, then down and out to the right. The studio's peak comes to a point, with a
corner in the arch under it. Our pen rounds both, and the overlap scores (0.965-0.973) don't show it. The Thuluth
session had the same fault on its humped joins, and the user ruled there "Fix the humps on both sides". The same
holds here, so the corner under the peak is kept although strokes are otherwise smooth. Patches, each blended in:
- the top of each peak (radius 0.35, at the studio's highest point);
- the corner under it (radius 0.35, aimed at where our ink lies past the studio's: aiming at the arch's highest
  point missed the corner, which sits to one side);
- 104's kinked leg and 078's foot and shoulder (0.95 and 0.9; a smaller disc left a step at its edge);
- 023.s2's lumpy edge (one 0.9 disc in the middle) and both tips, and 023.s0's top tip.

Two patches on one stroke used to blend each against the bare fit. Where their discs overlapped, the second erased
part of the first (104's peak under its leg patch) or left a step (023.s2's tip). Each patch now blends against the
stroke with its earlier patches already applied.

| shape | before | now |
|---|---|---|
| 023.s0 | 0.972 | 0.976 |
| 023.s2 | 0.965 | 0.992 |
| 078.s0 | 0.966 | 0.990 |
| 081.s0 | 0.965 | 0.980 |
| 104.s0 | 0.967 | 0.990 |
| 106.s0 | 0.973 | 0.983 |
| 107.s0 | 0.945 | 0.966 |
| 109.s0 | 0.969 | 0.983 |

**Head barbs are patched from the studio's outline (the user, 2026-11-03; approved).** The pen fit leaves out the small
barb at a head. On the long alifs (019-022) it is a hairline hanging off the top to the left. On 221, 222 and 473 the
head is rounded with a small barb, and ours ended square.
- **Alifs:** a 0.6 patch at the head's top, then a 0.2 patch at the barb's tip. The first left the hairline's tip a
  little short, because the blend is still part ours there.
- **221, 222, 473:** a 1.0-1.15 patch at the head (0.75 left a step at the disc's edge). A 0.4-0.8 patch on the tail
  tip removes a needle past the studio's end. A 0.5 patch on the outer curve fixes a flat spot. It was aimed at where
  the studio's ink lies past ours.

| shape | before | now |
|---|---|---|
| 019.s0 | 0.964 | 0.985 |
| 020.s0 | 0.964 | 0.981 |
| 021.s0 | 0.973 | 0.987 |
| 022.s0 | 0.973 | 0.987 |
| 221.s0 | 0.956 | 0.997 |
| 222.s0 | 0.955 | 0.997 |
| 473.s0 | 0.962 | 0.997 |

**Bowls and shapes: a refit, then patches where it still misses (the user, 2026-11-03; approved).** Four strokes whose
fit missed the studio in the body, not just at a tip, were refitted on the queue two ways: with a turning nib, and with
the fit started from a walk along the shape's centre line (`PEN_WALK`).
- **092.s0:** the walk won outright (0.922 to 0.979, the turning nib 0.881). A 0.6 patch at each tip finished it.
- **187.s2 and 207.s2:** the turning nib was better (0.908 to 0.935, 0.904 to 0.938) but left the bowl's left end wrong.
  `jdautopatch.py` laid one 0.5 patch on the largest miss, then a 0.3 patch at the first tip and a 0.5 at the last.
- **072.s1:** neither refit was clean (0.931 turning, 0.972 walk, both with a kink). The original fit kept, with two 0.5
  patches on its worst misses and a 0.5 on the foot.

`jdautopatch.py` finds the largest blob of ours-only or studio-only ink, after a 5 px opening so a hairline sliver
along an edge doesn't count, and patches its centroid. It repeats until the largest blob is under 400 px at 400 px a
nuqta.

| shape | before | now |
|---|---|---|
| 072.s1 | 0.915 | 0.995 |
| 092.s0 | 0.913 | 0.996 |
| 187.s2 | 0.868 | 0.992 |
| 207.s2 | 0.885 | 0.991 |

**The rest of the bowls, and two shapes, patched on the queue (the user, 2026-11-04; approved).** No refit this time:
`jdautopatch.py` on the catalogue's fits, four rounds of 0.5, run as queue jobs (a laptop run of the eight was stopped
for low memory; patches go to the queue from now on, `jdpensubmit.py --patch`). Three wanted a second job, with patches
aimed by eye after a look: 192.s2 at both tips (0.5 last, 0.3 first) and a lump on the inner edge (0.4); 235.s5 at its
squared tip (0.5) and the inner edge beside it (0.4); 072.s0 at a kink on the inner curve (0.5) and the foot (0.4).
The small notch just inside the top of each bowl's left tip is the studio's own and is kept.

| shape | before | now |
|---|---|---|
| 181.s2 | 0.902 | 0.995 |
| 192.s2 | 0.874 | 0.994 |
| 203.s2 | 0.893 | 0.995 |
| 220.s3 | 0.878 | 0.995 |
| 226.s3 | 0.902 | 0.995 |
| 235.s5 | 0.879 | 0.995 |
| 023.s1 | 0.969 | 0.989 |
| 072.s0 | 0.947 | 0.996 |

The pick before the review, each pair against the sheet's whole outline:

| stroke | run | overlap |
|---|---|---|
| 366.s0 | k10 | 0.976 (was 0.946) |
| 290.s1 | k10 | 0.942 |
| 297.s1 | k10 | 0.952 |
| 301.s1 | k10 | 0.956 |
| 309.s1 | k10 | 0.959 |
| 311.s1 | k10 | 0.963 |
| 313.s1 | k10 | 0.946 |
| 357.s0 | k10 | 0.984 |
| 347.s0 | k19 (`PEN_LEAD`) | 0.974 |
| 299.s1 | k7 | 0.950 |
| 356.s0 | k7 | 0.982 |
| 312.s1 | k6 | 0.938 |

k10 is `PEN_CUTWIN=free`. 299.s1, 312.s1 and 356.s0 keep their earlier fits:
- **312.s1 and 356.s0:** under k10, a half spun about 180 degrees at its
  free end.
- **299.s1:** under k10, its left half fit worse.

The free-end spins are open.

**The shape and spill groups, patched on the queue (the user, 2026-11-04; approved).** All 41 shape strokes and 50 of the 54 spill strokes, patched from the studio's outline after the pen fit. Shape mean 0.946 to 0.993; spill mean 0.972 to 0.993. 459.s1, 462.s1, 465.s2 and 469.s1 needed another round, below.

- **Scores don't find small faults, so edges were measured.** Our outline against the studio's, at 300 px a nuqta. A bar of 0.015 nuqta still let visible kinks through, so these were taken below 0.009. Needle tips, kinks and a seam inside 098.s0's ink had all passed by eye on sheets.
- **A patch can hold the neighbouring stroke's ink.** Every stroke of the shape near a patch counts as ours (the 076 entry above), so a patch's fill can carry a piece of the neighbour. One stroke drawn alone then looks wrong, and its score drops, while the whole letter is right. Near a neighbour, judge the whole letter. Spill strokes 226.s2 and others approved here may hold such ink.
- **Patch from a set that holds the whole shape.** Three spill rounds ran from a set of spill strokes alone, so neighbours didn't count, and were replaced by a replay from a complete set.

- **Stray ink in patches, removed from the last four spill strokes (approved).** The neighbour's ink in 459.s1, 462.s1 and 465.s2 is gone: fills are clipped to the stroke's own outline, and the small nicks that leaves are patched again from a set holding only that stroke, so nothing neighbouring counts. Now 0.997, 0.998 and 0.998 (were 0.961, 0.916 and 0.976 with the neighbour's ink). 469.s1's edge slivers were cleared: 0.995. A spur on 465.s1 and a spike on 459.s2, left by patches, went the same way; both approved.

Shape group:

| stroke | before | now |
|---|---|---|
| 080.s0 | 0.913 | 0.992 |
| 085.s0 | 0.914 | 0.995 |
| 090.s0 | 0.937 | 0.995 |
| 098.s0 | 0.918 | 0.995 |
| 102.s0 | 0.886 | 0.996 |
| 103.s0 | 0.910 | 0.995 |
| 182.s0 | 0.961 | 0.994 |
| 219.s0 | 0.978 | 0.995 |
| 223.s0 | 0.943 | 0.995 |
| 224.s1 | 0.967 | 0.991 |
| 225.s0 | 0.982 | 0.996 |
| 226.s0 | 0.981 | 0.997 |
| 232.s0 | 0.942 | 0.986 |
| 235.s1 | 0.959 | 0.986 |
| 241.s0 | 0.950 | 0.995 |
| 251.s0 | 0.937 | 0.993 |
| 471.s0 | 0.968 | 0.995 |
| 478.s0 | 0.964 | 0.997 |
| 480.s1 | 0.981 | 0.997 |
| 483.s0 | 0.936 | 0.978 |
| 485.s2 | 0.966 | 0.991 |
| 537.s1 | 0.971 | 0.995 |
| 538.s1 | 0.956 | 0.994 |
| 540.s1 | 0.956 | 0.995 |
| 541.s1 | 0.960 | 0.994 |
| 543.s1 | 0.950 | 0.992 |
| 544.s1 | 0.953 | 0.993 |
| 545.s1 | 0.946 | 0.993 |
| 547.s1 | 0.941 | 0.991 |
| 548.s1 | 0.961 | 0.992 |
| 623.s2 | 0.877 | 0.980 |
| 624.s2 | 0.951 | 0.995 |
| 627.s2 | 0.936 | 0.992 |
| 628.s2 | 0.944 | 0.992 |
| 630.s2 | 0.963 | 0.994 |
| 631.s2 | 0.949 | 0.996 |
| 632.s2 | 0.925 | 0.993 |
| 638.s1 | 0.960 | 0.990 |
| 639.s1 | 0.945 | 0.990 |
| 641.s1 | 0.960 | 0.990 |
| 737.s1 | 0.894 | 0.996 |

Spill group:

| stroke | before | now |
|---|---|---|
| 162.s1 | 0.986 | 0.993 |
| 163.s1 | 0.975 | 0.996 |
| 166.s1 | 0.970 | 0.993 |
| 167.s1 | 0.968 | 0.992 |
| 168.s1 | 0.979 | 0.992 |
| 177.s1 | 0.971 | 0.993 |
| 181.s1 | 0.976 | 0.991 |
| 188.s1 | 0.973 | 0.992 |
| 202.s1 | 0.960 | 0.992 |
| 203.s1 | 0.981 | 0.992 |
| 207.s1 | 0.967 | 0.996 |
| 211.s2 | 0.961 | 0.994 |
| 215.s2 | 0.963 | 0.993 |
| 217.s2 | 0.972 | 0.992 |
| 220.s2 | 0.974 | 0.996 |
| 222.s2 | 0.963 | 0.994 |
| 223.s2 | 0.970 | 0.993 |
| 224.s2 | 0.970 | 0.996 |
| 226.s2 | 0.976 | 0.992 |
| 228.s2 | 0.965 | 0.992 |
| 229.s2 | 0.973 | 0.994 |
| 460.s0 | 0.987 | 0.997 |
| 460.s2 | 0.969 | 0.993 |
| 462.s2 | 0.981 | 0.995 |
| 464.s0 | 0.989 | 0.997 |
| 468.s1 | 0.973 | 0.995 |
| 472.s1 | 0.979 | 0.992 |
| 473.s1 | 0.959 | 0.989 |
| 474.s1 | 0.973 | 0.991 |
| 475.s1 | 0.970 | 0.991 |
| 476.s1 | 0.967 | 0.990 |
| 478.s1 | 0.971 | 0.989 |
| 482.s1 | 0.965 | 0.991 |
| 483.s3 | 0.955 | 0.988 |
| 484.s2 | 0.967 | 0.989 |
| 532.s1 | 0.938 | 0.995 |
| 619.s1 | 0.959 | 0.992 |
| 620.s1 | 0.978 | 0.992 |
| 621.s1 | 0.960 | 0.991 |
| 624.s1 | 0.971 | 0.993 |
| 627.s1 | 0.969 | 0.992 |
| 628.s1 | 0.977 | 0.993 |
| 630.s1 | 0.975 | 0.993 |
| 632.s1 | 0.976 | 0.992 |
| 634.s1 | 0.978 | 0.993 |
| 636.s1 | 0.983 | 0.993 |
| 639.s2 | 0.979 | 0.993 |
| 640.s2 | 0.979 | 0.992 |
| 640B.s2 | 0.991 | 0.992 |
| 641.s2 | 0.986 | 0.990 |


**Neighbour ink taken out of the patches (the user, 2026-11-04).** 69 strokes held another stroke's ink in their fills, 47 of them already settled. It could bring back a fault if the neighbour was patched later. Fills are now clipped to the stroke's own outline plus 0.004 nuqta, and any nick that leaves is patched again from a set holding one stroke per shape, so nothing neighbouring counts. No stroke or letter got worse; 22 of 46 letters improved. This replaces the 076 rule for new patches: strokes are drawn separately, so a patch needs no neighbour's ink.

**Hairlines drawn with the pen's tip are fitted apart from the body.**
T18.s0 is one outline on the sheet: a thick body with a hairline loop off
the tail's end and another hanging under the head. The course draws such
decorations as moves of their own, "using the tip of the pen", pulled
"neatly from the main line". Held whole to one pen it fit at 0.62. Split
(`PEN_SPLIT`), the body is everything wider than 0.2 nuqta, drawn with the
main pen, and each hairline reaching half a nuqta or more is filled with the
small pen. A hairline that circles back on itself starts from a walk round
its skeleton that passes every loop once (`walk_samples`), not the longest
path, which cut the loop off (0.57 and 0.42 before, 0.84 and 0.80 after).
The body fits at 0.97; body and both loops against the sheet's whole outline
at 0.93, the body alone at 0.82. Both are kept (decision 48, the user,
2026-10-27): the body alone is T18's plain version, body and loops its
decorative one. The loops come out a little fatter than the sheet's, and the
stem under the head's loop a little short.

**Two genuine ways to draw a stroke are both kept, the fancier tagged
decorative (the user, 2026-10-27).** The hook and the curl that ends in a
circle (113.s2); a body alone and the body with its tip hairlines (T18.s0).
When a fit's best-overlap alternative is a different style rather than a
wrong one, it becomes the second version, not a discard.

**A turning nib tries the other anchor pairs on its leading angle only**
(`PEN_PRUNE`, from the Thuluth session's measurements): one angle's four
pairs scored within 0.005 of each other while the angles differed by
0.05-0.15, and the pruned search found the same fits in half the time.

## Sabti's moves, letter by letter

How Sabti writes each letter on his plate (Beirut Jali volume, p. 9): the
numbered moves, their direction, and where the pen lifts. Numbers are his;
directions are read from his arrows. A reading marked [?] could not be made
out at the scan's resolution.

Read 2026-10-20 from the scan enlarged 4–8× (scratchpad `crops/sabti_w/`).
The arrows are clear throughout; the digits are small, written along their
arrows (so turned), and some are uncertain. His ٢ is written like a small Y.
The plate shows isolated letters only, so medial and initial forms and the
joins come from the studio, Hashim's Diwani plate (his book p. 59, which
numbers the moves of joined forms too) and his Jali Diwani compositions
(pp. 66–67). Hashim's p. 59 confirms the alif and lam below and the reading
of ٢.

### What every letter shares

These hold on every letter on the plate, so they are firmer than any single
reading below.

1. **The body comes first, from the top right, downward.** Move ١ (or ١ then
   ٢ after a small head) is the thick stroke down from the letter's top
   right. Ornaments are never first.
2. **The tail follows in the same move or the next**, sweeping out to the
   left (ا ر ز د و ى ن) or, on the jim/ha/ayn tail, down and out to the
   right.
3. **Two kinds of bowl, turning opposite ways.**
   - *Small bowls* (ن ى س ش ص ض ق ف ث, and the lam's bowl): down the right
     side, round the bottom from right to left, then up the left side to a
     hairline tip. One continuous move or two (round the bottom, then up).
   - *Big bowls* (ج ح خ ع غ, and their open tails): from the throat across
     the top to the left, down the left side, then round the bottom **from
     left to right** and up. This is the "drawn back left to right" the
     sources describe.
4. **Head ornaments come after the body.** The curl on ا ل ك (the zülüf),
   and the kaf's flourish above it, are added once the stem and tail are
   down: a hairline up the left, round the curl, and a hairline back down
   inside it.
5. **Dots last, each its own numbered move, each pulled down and to the
   right.** That matches the dot measured above (the nib pulled along about
   150°/330°). Two and three dots are laid one after another, right to left.
6. **Heads are small turns.** The mim's head is a short flick to the right
   at the top before the body; the jim/ha/ayn head is a hook to the left and
   then a top bar out to the right.

### Letter by letter

Moves in order. Pieces the plate shows as separate pen lifts are marked
*lift*.

| letter | moves (Sabti's numbers) | notes |
|---|---|---|
| ا | ١ stem down from the top, thick; ٢ tail out to the left to a point; then the head: up a hairline on the left, round the curl over the top, ٥ hairline down inside [?3–4] | the curl is added last |
| ل | ١ stem down; ٢ on down the right side into the bowl; the bowl round the bottom right to left and up the left [٣–٤?]; the bowl ends crossing the stem and running out to the right as a hairline; head curl as the alif's | the bowl's top crosses the stem |
| ك | as ل, then the kaf's flourish above in five or six more moves (numbers run to ١١) | the most moves on the plate |
| ك (with the top bar) | as ل; the long top bar is a separate piece laid over, written right to left [?] | |
| لا (two forms) | ١ the lam's stem down; ٢ on into the base; the alif written **up** from the base inside the loop; ٥ the base's tail out to the left | the alif goes up, not down |
| ط ظ | the loop body first (eye, then the base out to the left); the upright written down through it afterwards [?] | |
| ث ة | ث: ١ down from the top right, ٢ round the bottom to the left, then up the left to a hairline; dots ٣ ٤ ٥ | ة: a closed loop, two moves, round to the left then down |
| ر ز | ١ down from the head; ٢ the tail out to the left to a point; ز's dot after | |
| د | ١ the head out to the right; ٢ down and round; tail to the left [?] | which of the row's ra-like letters is the dal is itself a guess |
| ض ص | ١ the eye (a small loop inside the head); ٢ out of it down to the left; then the bowl: down the right side, round to the left, ٥ up the left; dot last | small-bowl type |
| ف ق | ١ inside the head, to the left (the head's underside); ٢ over the top and down the right side; then the bowl round to the left (٤) and up the left to a hairline (٥); dots ٦ ٧ | ف's tail is long and flat; ق's bowl is deep |
| و | ١ inside the head, to the left; ٢ over the top, down the right, on into the tail out to the left | as the head of ف ق |
| ى | ١ down from the top right; ٢ on down, round the small bowl; ٣ the bottom out to the left; ٥ up the left [?] | |
| ن | ١ down the right side from the tip; ٢ round the bottom to the left; up the left to a hairline [٣?]; dot ٤ | |
| م (three forms) | ١ the head, a short flick to the right; ٢ the body down to the left; ٣ down; ٤ the tail's tip. One form ends in a small loop (٥) | |
| ج ح خ | ١ the hook to the left; ٢ the top bar out to the right, to a point; ٣ the thick diagonal down to the left; then either the open tail down and out to the right (٣/٤) or the big bowl (across the top to the left, down the left, round the bottom left to right, ٥ up); jim's dot inside, pulled down-right | big-bowl type |
| ع غ | ١ over the top of the head to the left; ٢ under the head back to the right; ٣ the body down to the left; then the open tail (left to right) or the big bowl, as ح | |
| س ش | ١ ٢ the teeth, each down; ٣ down the right side of the bowl; round to the left and ٥ up the left (small bowl); ش's three dots last | |

Not on the plate as separate letters: ب and ت (their body is ث's), ه, and
every medial and initial form. Hashim's plate (Jali volume,
p. 8) has the whole alphabet and its marks; the studio has the forms.
