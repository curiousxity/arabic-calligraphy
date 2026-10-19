# Stroke library review

The approval ledger for `src/lib/penData/`: every form, when it was drafted,
what it was drawn from, and the user's verdict. A form is approved only when
the user says so (a standing rule); drafts render in the app so the user can
judge them there. References are research material: the app credits no
author, and no plate or vector-set outline is copied into the library.

| form id | drafted | reference | user verdict | date |
|---|---|---|---|---|
| alif.standalone.1 | 2026-10-19, third draft | book plate f9 at its own pen (25.5 px); foot narrowed evenly | | |
| meem.standalone.1 | 2026-10-19, third draft | book plate f24 at its own pen (23 px, so the meem is 13% larger than the second draft); the doubled node that notched the tail's turn removed | | |
| ya.starting.1 | 2026-10-19, third draft | book plate f16 (بمـ): stacked tooth with its hooked head, the upper half of one stroke split mid-diagonal; two dots side by side under the junction where the plate's ba dot sits (MEB: ya's starting forms) | | |
| meem.middle.1 | 2026-10-19, third draft | book plate f16 (بمـ): the lower half of that stroke, the head as a drop, out along the line into the nun with no join | | |
| nun.finishing.1 | 2026-10-19, third draft | book plate f23 at its own pen (28.7 px); the square on its tail was a dot, now gone; its dot near the arm (MEB: "nun'un noktası kola yakın konulur") | | |
| hamza (part) | 2026-10-19, third draft | book plate f23, one stroke, two nuqta across (MEB hamza measure), just above the alif's head | | |
| (second drafts) | 2026-10-19 | the user: size and spacing to come from the references, hamza likewise, joins off (stack them), meem jagged, a nuqta on the nun's tail | rejected | 2026-10-19 |
| (first drafts) | 2026-10-19 | rejected by the user: "looks like a kid drew it. You have to vary the nib angle" | rejected | 2026-10-19 |

Measured on the plates (2026-10-19): nib at 145 degrees (edge sloping down to the right); a dot is the nib pulled 1.08 pens at 70 degrees, so a nuqta is 1.65 pens; the alif 7-7.5 nuqta.

Redrawn 2026-10-19 with `scripts/pen/fit.py`, which moves a part's nodes and
turns its nib until the swept ink covers the reference's ink and nothing else,
and draws plate / difference / pen side by side. Every redrawn form was checked
that way before review; the first drafts were hand-placed at one nib angle,
which ran every rising and baseline stroke along the nib's edge into a hairline.
