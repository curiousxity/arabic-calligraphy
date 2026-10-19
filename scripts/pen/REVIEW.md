# Stroke library review

The approval ledger for `src/lib/penData/`: every form, when it was drafted,
what it was drawn from, and the user's verdict. A form is approved only when
the user says so (a standing rule); drafts render in the app so the user can
judge them there. References are research material: the app credits no
author, and no plate or vector-set outline is copied into the library.

| form id | drafted | reference | user verdict | date |
|---|---|---|---|---|
| alif.standalone.1 | 2026-10-19, redrawn same day | book plate f9; one stroke: head flicked up on the nib's edge, stem pulled down; fitted (96% of the plate's ink covered) | | |
| meem.standalone.1 | 2026-10-19, redrawn same day | book plate f24 (standalone meem "used in Thuluth"); nib turning 82–140° through the head and tail; fitted (97%) | | |
| ya.starting.1 | 2026-10-19, redrawn same day | vector set v2-24 (tooth); fitted (98%) | | |
| meem.middle.1 | 2026-10-19, redrawn same day | vector set v2-141; the join runs in along its base; fitted (98%) | | |
| nun.finishing.1 | 2026-10-19, redrawn same day | book plate f23 (بن); fitted (92%) | | |
| hamza (part) | 2026-10-19, redrawn same day | book plate f23 (hamza), one stroke, at 0.75 size over the alif | | |
| (first drafts) | 2026-10-19 | rejected by the user: "looks like a kid drew it. You have to vary the nib angle" | rejected | 2026-10-19 |

Measured on the plates (2026-10-19): nib at 145 degrees (edge sloping down to the right); a dot is the nib pulled 1.08 pens at 70 degrees, so a nuqta is 1.65 pens; the alif 7-7.5 nuqta.

Redrawn 2026-10-19 with `scripts/pen/fit.py`, which moves a part's nodes and
turns its nib until the swept ink covers the reference's ink and nothing else,
and draws plate / difference / pen side by side. Every redrawn form was checked
that way before review; the first drafts were hand-placed at one nib angle,
which ran every rising and baseline stroke along the nib's edge into a hairline.
