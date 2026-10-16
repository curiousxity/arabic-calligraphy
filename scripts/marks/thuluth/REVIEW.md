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
