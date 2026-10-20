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

## Units and the pen

Measured 2026-10-20.

- **Nib edge at about 62°** (y up: the edge rises to the right). From nine
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
