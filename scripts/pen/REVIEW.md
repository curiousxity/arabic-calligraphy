# Stroke library review

The approval ledger for `src/lib/penData/`: every form, when it was drafted,
what it was drawn from, and the user's verdict. A form is approved only when
the user says so (a standing rule); drafts render in the app so the user can
judge them there. References are research material: the app credits no
author, and no plate or vector-set outline is copied into the library.

| form id | drafted | reference | user verdict | date |
|---|---|---|---|---|
| alif.standalone.1 | 2026-10-19, sixth draft: as the studio builds it, three pieces each fitted to its studio piece; the flag hangs off the head's edge; the foot ends on the line | the studio (أم أيمن), piece by piece | | |
| (book alif) | 2026-10-19, third draft | book plate f9 at its own pen (25.5 px); foot narrowed evenly | | |
| meem.standalone.1 | 2026-10-19, sixth draft: as the studio builds it, the arch, the bottom band and the tail from one point (the user: "use the alternate version of the meem") | the studio, piece by piece | | |
| (book meem) | 2026-10-19, third draft | book plate f24 at its own pen (23 px, so the meem is 13% larger than the second draft); the doubled node that notched the tail's turn removed | | |
| ya.starting.1 | 2026-10-19, sixth draft: the head a diamond pull, the hat a wedge hanging off its edge, both fitted to the studio's; the studio's dot shape | the studio, piece by piece | | |
| (fourth-draft ya) | 2026-10-19, fourth draft | the user's studio (أيمن), read from its vector outlines: head pulled down straight into the descent | | |
| meem.middle.1 | 2026-10-19, sixth draft: two pieces, the loop (the pen comes in) and the exit band over the top (the pen leaves by it) | the studio, piece by piece | | |
| nun.finishing.1 | 2026-10-19, sixth draft: three pieces after the pen lifts, the arm (a leaf from its beak), the bowl tucked under the arm's foot, the knot over the seam with the meem's exit; dot over the bowl | the studio, piece by piece | | |
| hamza (part) | 2026-10-19, third draft — no longer drawn over an alif (the user: Thuluth's alif needs no hamza) | book plate f23, one stroke, two nuqta across (MEB hamza measure), just above the alif's head | | |
| (fifth drafts) | 2026-10-19 | analysed with the user: each letter was one continuous stroke where the studio builds it from overlapping pieces, so the nib pinched where the pieces meet (the meem's head, the nun's arm); the flag and hat floated off their heads. The user: "Yes. Do both" (record it, redraw as pieces) | superseded | 2026-10-19 |
| (fourth drafts) | 2026-10-19 | the user: use the studio's meem; draw ours as smoothly as the studio's; the ya has a hat; the nun too irregular | rejected | 2026-10-19 |
| (third drafts) | 2026-10-19 | the user: hamza too big and not needed on the alif; scale by the stroke, to 0.1 nuqta; middle meem's head too thin; nun's body and tail off; the studio's rendering given as the reference | rejected (meem standalone kept: "fine") | 2026-10-19 |
| (second drafts) | 2026-10-19 | the user: size and spacing to come from the references, hamza likewise, joins off (stack them), meem jagged, a nuqta on the nun's tail | rejected | 2026-10-19 |
| (first drafts) | 2026-10-19 | rejected by the user: "looks like a kid drew it. You have to vary the nib angle" | rejected | 2026-10-19 |

Measured on the plates (2026-10-19): nib at 145 degrees (edge sloping down to the right); a dot is the nib pulled 1.08 pens at 70 degrees, so a nuqta is 1.65 pens; the alif 7-7.5 nuqta.

Redrawn 2026-10-19 with `scripts/pen/fit.py`, which moves a part's nodes and
turns its nib until the swept ink covers the reference's ink and nothing else,
and draws plate / difference / pen side by side. Every redrawn form was checked
that way before review; the first drafts were hand-placed at one nib angle,
which ran every rising and baseline stroke along the nib's edge into a hairline.

How each stroke is drawn, and why, is recorded in
`docs/calligraphy/stroke-ledger.md`. Add to it as each new letter is learned.
