# Thuluth review ledger

Every piece cut from a Thuluth source sheet, and whether the user has
approved its name and its traced outline. **Only `approved` pieces go into
the app's mark library.** Source sheets live in `scripts/marks/` and are kept
even before any of their pieces are used. The tool is `review.py` (this
folder); it draws the source crop beside the traced outline for review.

**Repeat scans are deliberate.** The user sends several copies of the same
page so pieces can be cross-referenced: when one scan has a smudge, a
measurement dot touching the letter or a soft edge, the same piece can be
taken from another (`<sheet>b`, `<sheet>c`, …). Keep every copy.

**Dotted outlines are alternate forms.** Some sheets draw an alternative shape
as a faint dotted outline beside or over a solid letter. They are pieces in
their own right: join the dots into a closed outline, fill it, and review it
separately from the solid letter it sits by. They are lighter than the ink
(grey 150 to ~225 on a 250 paper), so the solid-ink threshold misses them.

**Sheets may arrive line by line** (one image per row), saved as
`thuluth-<n>-row<k>`; a sheet's section lists which rows are in.

Statuses: `waiting` (shown, no answer yet), `cleanup` (leftover measurement
dots or guide lines touching the letter, to remove by hand before review),
`approved`, `redo` (with the user's note).

## Sheet t1 — `thuluth-1.webp` (1638×1024)

A second scan of the same page, `thuluth-1b.webp` (1667×1032, sent 2026-10-16), is
kept too: same resolution and sharpness, slightly different framing — a
fallback if a piece comes out cleaner in it.

Names not agreed yet: all 31 pieces `waiting`. Numbered sheet sent
2026-10-16; the user asked to go over the pieces again together.

## Sheet t2 — `thuluth-2.webp` (1623×876)

A second scan of the same page, `thuluth-2b.webp` (sent 2026-10-16), is kept
as a fallback, like sheet 1's.

Names below include the user's corrections of 2026-10-16. Letters are traced
without their dots (dots come from the Dots group), which is also what
removes the measurement dots.

| # | name | status |
|---|---|---|
| 1 | ح standalone | waiting |
| 2 | ح ج خ shared stroke | waiting |
| 3 | ك zinadi, standalone | waiting |
| 4 | ب long, standalone and final | cleanup (baseline bits) |
| 5 | ح almond | cleanup (dots, line) |
| 6 | ح almond, small | waiting |
| 7 | ح almond, large | cleanup (dots on the right) |
| 8 | مـ start, small | waiting |
| 9 | م joined | cleanup (dots) |
| 10 | مـ start, joined | waiting |
| 11 | م standalone | cleanup (small square at the top) |
| 12 | ه | waiting |
| 13 | ه | waiting |
| 14 | هـ tall, start | cleanup (guide lines, dot) |
| 15 | ـهـ long, middle | cleanup (dot, line) |
| 16 | لا | waiting |
| 17 | لا | waiting |
| 18 | ى | waiting |
| 19 | ح wrapped | waiting |
| 20 | عـ head, start/join | cleanup (dot, line) |
| 21 | ع (dots on top are measurement) | cleanup (dots, side line) |
| 22 | ع wrapped | cleanup (construction lines in the head) |
| 23 | صـ start | waiting |
| 24 | ص standalone (tail split from the ط) | waiting |
| 25 | ط | cleanup (stub at the bottom) |
| 26 | ق / فـ ? | cleanup (dots); name to confirm |
| 27 | ق without dots | waiting |
| 28 | و | waiting |

## Sheet t3 — `thuluth-3.webp`

Received 2026-10-16, saved only (no pieces cut or traced yet). Three rows,
headings on the sheet: row 1 "احرف فردية للتمرين وهي غير مسقطة" (isolated
letters for practice, not descending); row 2 "احرف فردية ملفوفة" (wrapped),
"احرف فردية مرسلة" (extended), "حرفان مرتفعان" (two raised letters),
"احرف فردية للتمرين"; row 3 "الهاء المتصلة والفردية" (connected and
isolated heh), "حرف الحاء مرسل وملفوف" (ha, extended and wrapped),
"حرف الحاء النهائي" (final ha). Very few measurement dots on this sheet.
Second scan: `thuluth-3b.webp` (sent 2026-10-16).

## Sheet t4 — `thuluth-4.webp` (the alif)

Received 2026-10-16, saved only. "حرف الألف": the plain standalone alif in
three lengths (الألف المفرد العادي, numbered 1–3); the arched alif taken
from Diwani (الألف المفرد المقوس المأخوذ من الديواني) and its full Diwani
form; the alif in لفظة الجلالة (الله); two alifs usable for the lam (الر);
the final alif joined to the first lam (الحر); the "tah alif" (ألف الطاء،
خاصة) and its Diwani-like variant (ط); four alif heights (1–4) for the four
kinds of line; and ع joined to a final alif (اعلما), with the rule that a
separate ع's head must stay clear. The bottom line يا غالباً غير مغلوب is a
worked example, and the notes underneath give each alif's height in nuqtas
by line type: (1) single-line 5–6, (2) medium composed 6–7, (3) light
composed 7–8 (8–9 in Muhaqqaq), (4) heavy composed 9–12. Almost no
measurement dots — mostly clean strokes and Arabic notes.

## Sheet t5 — `thuluth-5.webp` (dal and ra)

Received 2026-10-16, saved only. Row 1 "احرف فردية مع احرف نهائية"
(isolated with final letters): ا، د، ي/ن، ن، ر، ز، ر، و، ق and others, with
some measurement dots. Row 2 "حرف الدال": four dal forms; note — in a
non-composed line (Quran verses, hadith) the dal's end may be extended
(مرسل), not otherwise. Side note: when dal, ra or waw sit inside a noon in a
composition, the noon is six nuqtas long (taken from Muhaqqaq). Row 3
"حرف الراء", named forms: الرهانية، الملتوية، المرسلة، "في النون يصغر
الراء" (the ra made small inside a noon), "مع اللام يصغر الراء" (made small
after a lam). Notes underneath (proportions): ra has three shapes by
position; the rihaniya and mursala ra are normally six nuqtas long, cut to
four when the rihaniya sits inside a noon or joins a lam, and likewise the
mursala inside a noon; the composed multawiya ra is a fixed four nuqtas,
standalone or joined. Few measurement dots outside row 1.

## Sheet t6 — `thuluth-6.webp` (lam and lam-alif)

Received 2026-10-16, saved only. Solid letters with long Arabic notes.
Row 1: ل ("اللام واللام الألف" — the lam is the alif plus the bowl of ن، ق،
ص، س or ي); لا made of the alif and the end of the final mursala heh, with
the crooked alif giving the second alif; لا starting with the crooked alif;
a lam-alif cut short when the composition needs it. Row 2: braided lam-alif
(ذات الظفيرة, one to three knots, common with the Baghdadis); لا for forced
cases at line ends; فلا. Row 3: lam-alif forms used only at the end (حلا,
سلا); the standalone mursala lam at the end of non-composed lines (هول، حل);
an old rule's lam form, for Muhaqqaq and non-composed Thuluth (صلى).

Dotted alternate forms on this sheet (to fill and review separately):
- beside the ل, top right (~1430–1545, 140–200): a seen with a loop flowing
  into the lam's bowl;
- beside the first لا, top (~1085–1220, 60–235): the alif continued long to
  the upper right, and a ب-like tooth before the لا;
- middle row, left of the second لا (~1040–1110, 330–410): a slanted
  alternate alif head;
- small traces near صلى (~150–195, 690–725) and above the big لا (~400, 320).

## Sheet t7 — the beh (three row images)

Only the top row is saved so far (1617×314, same scale as the full sheets):
initial beh with two dots and with three dots ("الباء الأولى ذات النقطتين /
ذات ثلاث نقاط"), joined to ص، ط، غ، ق، م، ر، و، ي — with measurement dots on
each. The full page was seen 2026-10-16 but arrived mid-turn and could not be
saved; its rows 2–3 are "الباء مع الياء" (beh with ya), seen-like teeth usable
for ب ت ث ن ("يجوز استعمال هذه في الباء والتاء والثاء والنون"), and
"الباء مع الميم" (beh with meem), with dotted alternate outlines beside the
لا-like shape in row 2 and at the start of the bottom-left word. Row 2 saved
as `thuluth-7-row2.png` (beh with ya; the seen-like teeth for ب ت ث ن; the
dotted alternate beside the second piece from the right). Row 3 saved as
`thuluth-7-row3.png` ("الباء مع الميم": صط-like beh joins, بم, a seen-like
run with a final ya, and a dotted alternate head at the far left). Sheet 7 is
complete.

## Sheet t8 — initial beh of the ya type (row images)

- Row 1, `thuluth-8-row1.png` (2026-10-16): "باء أولية من نوع الياء" (initial
  beh of the ya type: يـ/بـ joined to ح، م، ه and others) and "باء أولية من
  نوع الياء المصغرة" (the same with the small ya), with measurement dots.
