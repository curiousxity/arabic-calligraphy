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
  stroke reach it.

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
