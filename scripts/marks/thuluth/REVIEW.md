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

Numbered map: `sheet1-numbered.png` (sent 2026-10-16). Pieces 9/14 and
10/15 are the same two lam-alif forms drawn twice: cross-reference them
and trace whichever copy comes out cleaner. Construction/clean pairs
(confirmed 2026-10-17): 6→30 (nun), 11 and 27→26 (dal), 12→23 (ha),
17→19 (ta). 7 and 29 are two different ra forms. Trace the clean one; the
construction drawing supplies proportions and stroke order. The user named the
top row and piece 30 on 2026-10-16; the middle row (14–23) and the bottom
row (24–31) come next. "Measuring nuqtas" means the piece is drawn with
its column of measurement dots, which are cleaned off (letters are traced
dotless).

| # | name | status |
|---|---|---|
| 1 | ا alif (measuring nuqtas) | named |
| 2 | ا alif, smaller | traced 2026-10-17, clean; **approved, in the library** |
| 3 | ك | traced 2026-10-17; **not approved yet** (the user): the barb has extra pixels and should match the alif's barb; the tail tip has the same problem (a stroke number touches it) and should match the other letters' tails. A guide-line end on the barb is erased in `review.py` (`erase`); the rest is for a hand touch-up |
| 4 | ل lam (measuring nuqtas) — not لن | named (corrected) |
| 5 | لا | traced 2026-10-17; **needs cleanup**: measuring nuqtas, stroke numbers, arrows |
| 6 | ن nun — construction of 30 (measuring nuqtas) | named (corrected) |
| 7 | ر ra — not بز | named (corrected); **drawn overlapping 8**, needs a split rule |
| 8 | ب the body of ba — not بت | named (corrected); **drawn overlapping 7**, needs a split rule |
| 9 | لا, large — same form as 14 | traced 2026-10-17; **needs cleanup**: measuring nuqtas, guide line along the top, stroke numbers |
| 10 | لا, small — same form as 15 | traced 2026-10-17; **needs cleanup**: guide-line bits around the edge |
| 11 | د dal — construction of 26 (measuring nuqtas) | named (corrected) |
| 12 | ه ha — the **construction drawing** of 23: stroke numbers, measuring nuqtas and a **half nuqta**. Not a piece to trace; use it for proportions and to record the stroke order | named (corrected) |
| 13 | ى (alif maqsura / ya) | traced 2026-10-17; **needs cleanup**: a construction line through the bowl |
| 14 | لا, large — same form as 9 | traced 2026-10-17; **needs cleanup**: tick marks along the alif and bits of guide line at the join |
| 15 | لا, small — same form as 10, not ه. Tell it by the **alif's hat stroke** (the head at the top of the alif), which a ه never has | traced 2026-10-17, clean; **approved, in the library** |
| 16 | صـ | traced 2026-10-17; **needs cleanup**: a guide line inside the counter, bits along the tail |
| 17 | ط / ظ ta/za — construction of 19 (measuring nuqtas) | named (corrected) |
| 18 | ض | traced 2026-10-17; **needs cleanup**: a guide line inside the counter, the dot |
| 19 | ط ta — **the clean shape** (17 is its construction) | traced; **approved, in the library** |
| 20 | ب / ت / ث body — **two forms drawn superimposed** on each other, not بن | named (corrected); needs separating into two pieces |
| 21 | ج / ح / خ — the **alternate body**, not بي | traced 2026-10-17; **needs cleanup**: construction lines and measuring nuqtas inside the bowl |
| 22 | ق | traced 2026-10-17; **needs cleanup**: the dots, guide-box bits at the top, the base line |
| 23 | ه ha — **the actual shape** (the user, 2026-10-16): trace this one; 12 is its construction | traced; **approved, in the library** |
| 24 | ك — with a **small handwritten note** beside it to remove | traced 2026-10-17; **needs cleanup**: the written note (left over above the small kaf) |
| 25 | ل lam — clean | traced; **approved, in the library** |
| 26 | د dal — the clean shape (11 and 27 are its construction). Stroke numbers on the sheet, read before erasing: 1 at the head (top), 2 beside the upper stroke with an arrow down along it, 3 under the base with an arrow along it | traced 2026-10-17, clean (numbers erased); **approved, in the library** |
| 27 | د dal — construction of 26 (measuring nuqtas) | named (corrected) |
| 28 | و **waw tail** (the body without the head), measuring nuqtas — not a nun (corrected 2026-10-17) | named (corrected) |
| 29 | ر ra body (measuring nuqtas) — **a different form from 7**, not its construction | named (corrected) |
| 30 | ن nun — the clean shape (6 is its construction) | traced 2026-10-17, clean; **approved, in the library** |
| 31 | ى / ي ya — **three forms** in one drawing, not بني | named (corrected); needs separating into three pieces |

## Sheet t2 — `thuluth-2.webp` (1623×876)

A second scan of the same page, `thuluth-2b.webp` (sent 2026-10-16), is kept
as a fallback, like sheet 1's.

Names below include the user's corrections of 2026-10-16. Letters are traced
without their dots (dots come from the Dots group), which is also what
removes the measurement dots. Same pen as sheet 1 (both measure 16 px
across the stroke), so the same scale: 3.0 units per source px.

| # | name | status |
|---|---|---|
| 1 | ح standalone | traced 2026-10-17; **for the user to touch up by hand later** (needs more cleanup than the thin bit of guide line on top of the head) |
| 2 | ح ج خ shared stroke | traced 2026-10-17, clean; **approved, in the library** |
| 3 | ك zinadi, standalone | traced 2026-10-17; the two blobs above the start are **not part of the letter** (the user) and are erased (`erase` in `review.py`). Stroke numbers on the sheet: 1 at the upper stroke with an arrow along it, 2 along the middle stroke. The small tick on the lower stroke near where the second arrow points is a **stray mark** (the user) and is erased too. **Awaiting approval** of the cleaned trace |
| 4 | ب long, standalone and final | traced 2026-10-17; cleanup (baseline bits) |
| 5 | ح almond | traced 2026-10-17; cleanup (dots, line) |
| 6 | ح almond, small | traced 2026-10-17; needs cleanup: a drip under the base (a stroke number touching it) |
| 7 | ح almond, large | traced 2026-10-17; cleanup (dots on the right) |
| 8 | مـ start, small | traced 2026-10-17; needs cleanup: a drip under the base (a stroke number touching it) |
| 9 | م joined | traced 2026-10-17; cleanup (dots) |
| 10 | مـ start, joined | traced 2026-10-17, clean; **approved, in the library** |
| 11 | م standalone | traced 2026-10-17; cleanup (small square at the top) |
| 12 | ه | traced 2026-10-17, clean; **approved, in the library** |
| 13 | ه | traced 2026-10-17, clean; **approved, in the library** |
| 14 | هـ tall, start | traced 2026-10-17; cleanup (guide lines, dot) |
| 15 | ـهـ long, middle | traced 2026-10-17; cleanup (dot, line) |
| 16 | لا | traced 2026-10-17, clean; **approved, in the library** |
| 17 | لا | traced 2026-10-17, clean; **approved, in the library** |
| 18 | ى | traced 2026-10-17, clean (dots removed); **approved, in the library** |
| 19 | ح wrapped | traced 2026-10-17, clean (stroke numbers removed); **approved, in the library** |
| 20 | عـ head, start/join | traced 2026-10-17; cleanup (dot, line) |
| 21 | ع (dots on top are measurement) | traced 2026-10-17; cleanup (dots, side line) |
| 22 | ع wrapped | traced 2026-10-17; cleanup (construction lines in the head) |
| 23 | صـ start | traced 2026-10-17, clean; **approved, in the library** (the tick hanging at the left stays: the user approved it as drawn) |
| 24 | ص standalone (tail split from the ط) | traced 2026-10-17; **incomplete**: the tail is cut off where it ran into the ط on the original. Borrow a tail from a later tracing of the same form |
| 25 | ط | traced 2026-10-17; cleanup (stub at the bottom) |
| 26 | ف fa without dots (the user, 2026-10-16) | traced 2026-10-17; cleanup (dots) |
| 27 | ق without dots | traced 2026-10-17; needs cleanup: a mark left inside the head at the join |
| 28 | و | traced 2026-10-17, clean; **approved, in the library** |

## Sheet t3 — `thuluth-3.webp`

Received 2026-10-16, saved only (no pieces cut or traced yet). Three rows,
headings on the sheet: row 1 "احرف فردية للتمرين وهي غير مسقطة" (isolated
letters for practice, not descending); row 2 "احرف فردية ملفوفة" (wrapped),
"احرف فردية مرسلة" (extended), "حرفان مرتفعان" (two raised letters),
"احرف فردية للتمرين"; row 3 "الهاء المتصلة والفردية" (connected and
isolated heh), "حرف الحاء مرسل وملفوف" (ha, extended and wrapped),
"حرف الحاء النهائي" (final ha). Very few measurement dots on this sheet.
Second scan: `thuluth-3b.webp` (sent 2026-10-16).


Mapped and traced 2026-10-17. Same pen as sheets 1 and 2 (15 to 16 px
across the stroke), so the same scale: the alif comes out 487 units tall.
Numbers follow `sheet3-numbered.png`: cluster 1 is part of a heading and
is skipped; cluster 4 is the kaf's small sign, traced with 3; cluster 20
held two separate ha forms, traced as 20 (right) and 25 (left). Several
pieces are joined letter groups, kept whole for now. Names are provisional
readings for the user to confirm in the end-of-tracing sweep.

| # | provisional name | status |
|---|---|---|
| 2 | ا alif | traced 2026-10-17; clean; **approved, in the library** |
| 3 | ك kaf, upright, with its small kaf sign (cluster 4 on the map) | traced 2026-10-17; clean; **approved, in the library** |
| 5 | ل lam | traced 2026-10-17; clean; **approved, in the library** |
| 6 | لا two lam-alif forms, overlapping (one joined shape) | traced 2026-10-17; clean; may need splitting into two pieces; **approved, in the library** |
| 7 | ط ta | traced 2026-10-17; clean; **approved, in the library** |
| 8 | س seen, extended, with a start on the right. Stroke numbers: 1 at the upper right hook (arrow up), 2 along the upper stroke (arrow left), 3 at the start of the bowl (arrow down), 4 along the bottom of the bowl (arrow left) | traced 2026-10-17; clean (numbers erased); **approved, in the library** |
| 9 | و + ك waw and long kaf, joined. Stroke numbers: 1 inside the waw head (arrow left), 2 over the head (arrow right), 3 along the waw tail (arrow left) | traced 2026-10-17; clean (numbers erased); **approved, in the library** |
| 10 | ر و د ra, waw, dal, joined (wrapped forms) | traced 2026-10-17; clean; **approved, in the library** |
| 11 | ر ra, extended | traced 2026-10-17; clean; **approved, in the library** |
| 12 | و waw, extended | traced 2026-10-17; clean; **approved, in the library** |
| 13 | م meem, extended | traced 2026-10-17; clean; **approved, in the library** |
| 14 | ر م ra and meem, raised, joined | traced 2026-10-17; clean; **approved, in the library** |
| 15 | ص + ش/س sad with teeth, measuring nuqtas | traced 2026-10-17; **needs cleanup**: guide lines and measuring nuqtas at the teeth |
| 16 | و ه ة waw, ha, ta marbuta | traced 2026-10-17; **needs cleanup**: measuring marks and guide lines on the ha |
| 17 | و هـ ه waw, connected and standalone ha | traced 2026-10-17; clean; **approved, in the library** |
| 18 | ى ya | traced 2026-10-17; clean; **approved, in the library** |
| 19 | ح ha, extended | traced 2026-10-17; clean; **approved, in the library** |
| 20 | ح ha (right of the pair in cluster 20) | traced 2026-10-17; clean; **approved, in the library** |
| 25 | ح ha (left of the pair in cluster 20) | traced 2026-10-17; clean; **approved, in the library** |
| 21 | ع ain | traced 2026-10-17; clean; **approved, in the library** |
| 22 | ـح final ha. Stroke numbers: 1 at the top right, beside a dotted guide, 2 on the head (arrow down-left) | traced 2026-10-17; clean (numbers and dotted guide erased); **approved, in the library** |
| 23 | ـح final ha. Stroke numbers: 1 at a dotted curve at the top right, 2 on the head (arrow left) | traced 2026-10-17; clean (numbers and dotted guide erased); **approved, in the library** |
| 24 | ـد **ending dal** (the user). Stroke numbers: 1 beside the upright (arrow up), 2 at its top (arrow down), 3 along the base (arrow left), 4 at the left end (arrow up) | traced 2026-10-17; clean (numbers erased); **approved, in the library** |

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


Mapped and traced 2026-10-17 (`sheet4-numbered.png`). Same scale as
sheets 1–3. Map clusters 6, 9, 12 and 20–25 are written notes and are
skipped; the map merged الله with the height-3 alif (now 10 and 26) and the
worked line with the second tah-alif (now 18 and 27). Bits of the notes
next to pieces 7, 8, 10 and 16, and the ya dots and a small mark on 18, are
erased by point (`erase` in `review.py`). The small digits under the alifs
label lengths and heights, not stroke order. The alif heights grow from 550
to 718 units, as the notes' nuqta counts say they should. All 16 pieces are
clean.

| # | provisional name | units tall | status |
|---|---|---|---|
| 1 | ا alif, standalone, length 1 | 511 | traced 2026-10-17, clean; **approved, in the library** |
| 2 | ا alif, standalone, length 2 | 527 | traced 2026-10-17, clean; **approved, in the library** |
| 3 | ا alif, standalone, length 3 | 569 | traced 2026-10-17, clean; **approved, in the library** |
| 14 | ا alif height 1 (single line, 5–6 nuqtas) | 550 | traced 2026-10-17, clean; **approved, in the library** |
| 15 | ا alif height 2 (medium composed, 6–7) | 586 | traced 2026-10-17, clean; **approved, in the library** |
| 26 | ا alif height 3 (light composed, 7–8) | 619 | traced 2026-10-17, clean; **approved, in the library** |
| 11 | ا alif height 4 (heavy composed, 9–12) | 718 | traced 2026-10-17, clean; **approved, in the library** |
| 4 | ا arched alif, from Diwani | 534 | traced 2026-10-17, clean; **approved, in the library** |
| 5 | ا arched alif, full Diwani form | 529 | traced 2026-10-17, clean; **approved, in the library** |
| 13 | ط tah alif (ألف الطاء) | 442 | traced 2026-10-17, clean; **approved, in the library** |
| 27 | ط tah alif, Diwani-like variant | 370 | traced 2026-10-17, clean; **approved, in the library** |
| 7 | ال the two alifs usable for the lam (الر) | 830 | traced 2026-10-17, clean; **approved, in the library** |
| 8 | الحر final alif joined to the first lam | 700 | traced 2026-10-17, clean; **approved, in the library** |
| 10 | الله: either of two alifs may be used here; the dotted curve is the second (arched) alif, erased from this trace | 606 | traced 2026-10-17, clean; **approved, in the library** |
| 16 | اعلما ain joined to a final alif | 636 | traced 2026-10-17, clean; **approved, in the library** |
| 18 | يا غالباً غير مغلوب, the worked example line (traced dotless) | 888 | traced 2026-10-17, clean; **approved, in the library** |

### Sheet 4's notes, transcribed (2026-10-17)

The user: "Read the annotations as well. They have important information."
Every note on the sheet, with the piece it belongs to (my reading; check
in the sweep):

- **Heading**: حرف الالف (the letter alif).
- **Pieces 1–3**, label الالف المفرد العادي: the ordinary standalone
  alif, in three versions numbered ١ ٢ ٣. Small arrows at the feet of 2
  and 3 point to how each one ends.
- **Bottom right, about 1–3**: "١، ٢، ٣ الالف المفرد العادي وآخره نهاية
  الالف الجلي ديواني": the third one ends like the Jali Diwani alif.
  "ويكتب عند عدم ظهور النهاية في الاحرف (ويسمى بالالف الحر عند الخطاطين
  العباسيين)": it is written when the ending does not show among the
  letters, and Abbasid calligraphers call it **the free alif** (الالف الحر).
  "يجوز كتابة الالف بدون رسم الرأس وهذه القاعدة بغدادية (ويسمى بالالف
  السنادي)": the alif may be written **without its head**; this is a
  Baghdadi rule, and that alif is called **al-alif al-sinadi**.
- **Piece 4**: الالف المفرد المقوس المأخوذ من الديواني, the arched
  standalone alif, taken from Diwani.
- **Piece 5**: الالف المأخوذ من الديواني بشكله الكامل, the alif taken
  from Diwani in its full form.
- **Piece 10 (الله)**: "يجوز استعمال احد الالفين بحالة الضرورة في كتابة
  لفظة الجلالة": either of the two alifs may be used, when needed, in
  writing the word Allah. **The dotted curve is the second alif, not a
  guide line**: it shows the arched alternative for the last upright.
  The trace erased it; the arched form is the one in piece 4/5.
- **Piece 7 (الر)**: "يجوز استعمال هذين الالفين للام": these two alifs
  may be used for the lam.
- **Piece 8**: "يجوز اتصال الالف الاخير باللام الاولى للكلمة": the last
  alif may be joined to the first lam of the word.
- **Piece 16 (اعلما)**: "لا يجوز اتصال حرف العين الشعبانية بحرف الالف اذا
  كان منفصلاً لأنه يجب ان يكون رأسها واضحاً. ويجوز اتصاله بالالف النهائية
  فقط": the **sha'baniya ain** must not be joined to an alif that stands
  apart, because the ain's head must stay clear; it may be joined **only
  to a final alif**.
- **Piece 13**: الف الطاء (خاصة), the ta's own alif (special).
  **Piece 27**: الف الطاء (خاصة) مقاربة الى الديواني, the same, close to
  Diwani.
- **Pieces 14, 15, 26, 11** (labelled ١ ٢ ٣ ٤) and the numbered notes at
  the bottom: the alif's height by kind of line:
  1. in lines not composed (single line) to the end: 5 to 6 nuqtas;
  2. in medium composed lines: 6 to 7 nuqtas (divided among the letters
     that take part in the composition);
  3. in light composed lines: 7 to 8 nuqtas, and 8 to 9 nuqtas in
     Muhaqqaq;
  4. in heavy composed lines: 9 to 12 nuqtas.
  "(انظر ص ٥)": see page 5.

What this means for the library: the four heights are one alif drawn for
four kinds of line, so they belong together as a set, and a composition
should pick its alif by line type. The free alif (3) and the sinadi alif
(no head) are named forms worth keeping by those names.

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


Mapped and traced 2026-10-17 (`sheet5-numbered.png`). Same scale. Cluster
24 is a word in the notes, skipped.

### Sheet 5's notes, transcribed (2026-10-17)

- **Row 1 heading**: احرف فردية مع احرف نهائية, standalone letters with
  final letters.
- **Row 2 heading**: حرف الدال. Note over the row, arrow to **piece 17**:
  "اذا استعمل حرف الدال في الاسطر غير المركبة (الآيات القرآنية والاحاديث)
  جاز ان يكون آخره مرسلاً. ولا يجوز ارسال آخره اذا استعمل في اشكال أخرى":
  in lines that are not composed (Quran verses and hadith) the dal's end
  may be extended (mursal); it may not be extended in other layouts.
- **Left note, piece 18**: "اذا وقع حرف الدال او الراء او الواو في باطن حرف
  النون في اثناء التركيب، يجب ان يكون طول حرف النون ست نقاط، لان النون
  مأخوذ من خط المحقق": when dal, ra or waw sits inside a nun in a
  composition, the nun must be six nuqtas long, because that nun is taken
  from Muhaqqaq.
- **Row 3 heading**: حرف الراء. Labels: **23** الرهانية (rihaniya), **19**
  الملتوية (multawiya), **20** المرسلة (mursala), **21** في النون يصغر
  الراء (inside a nun the ra is made small), **22** مع اللام يصغر الراء
  (with a lam the ra is made small).
- **Bottom note**: "لحرف الراء ثلاثة اشكال تختلف باختلاف موقعها. وطول
  الرهانية والمرسلة عادة ست نقاط، إلا ان الراء الرهانية اذا وقعت في وسط
  النون او اتصلت باللام فان طولها يقصر الى اربع نقاط، وكذلك الراء المرسلة
  اذا وقعت داخل حرف النون يقصر طولها ايضاً الى اربع نقاط. اما المركبة
  الملتوية فيكون طولها ثابتاً (وهو اربع نقاط)، سواء كانت مفردة او متصلة":
  the ra has three shapes that change with position. The rihaniya and
  mursala are normally **six nuqtas** long; the rihaniya inside a nun or
  joined to a lam shortens to **four**, and so does the mursala inside a
  nun. The composed multawiya is a fixed **four nuqtas**, standalone or
  joined.

| # | provisional name | status |
|---|---|---|
| 1 | ا alif | traced 2026-10-17; clean; **approved, in the library** |
| 2 | ا alif | traced 2026-10-17; **needs cleanup**: guide-line bits at the foot |
| 3 | د dal | traced 2026-10-17; clean; **approved, in the library** |
| 4 | ى/ن final | traced 2026-10-17; **needs cleanup**: measuring nuqtas joined to the right side, guide marks |
| 5 | ں nun body, dotless | traced 2026-10-17; clean; **approved, in the library** |
| 6 | ن nun | traced 2026-10-17; clean; **approved, in the library** |
| 7 | ز/ر za or ra body (dotless) | traced 2026-10-17; clean; **approved, in the library** |
| 8 | ر ra, joined form with a flag head | traced 2026-10-17; clean; **approved, in the library** |
| 9 | ر joined to a preceding letter (to name); stroke numbers 1 (arrow up-left at the right) and 2 (arrow up at the middle) | traced 2026-10-17; clean (numbers, guide triangle erased); **approved, in the library** |
| 10 | و waw | traced 2026-10-17; clean; **approved, in the library** |
| 11 | و waw, second form | traced 2026-10-17; clean; **approved, in the library** |
| 12 | ق qaf | traced 2026-10-17; **needs cleanup**: measuring nuqtas, guide box and line |
| 13 | د dal, form 1 | traced 2026-10-17; clean; **approved, in the library** |
| 14 | د dal, form 2 | traced 2026-10-17; clean; **approved, in the library** |
| 15 | د dal, form 3 | traced 2026-10-17; clean; **approved, in the library** |
| 16 | د dal, form 4 | traced 2026-10-17; clean; **approved, in the library** |
| 17 | د dal with an extended end (مرسل) | traced 2026-10-17; clean; **approved, in the library** |
| 18 | ن + د dal inside a nun | traced 2026-10-17; clean; **approved, in the library** |
| 23 | ر ra, rihaniya (الرهانية) | traced 2026-10-17; clean; **approved, in the library** |
| 19 | ر ra, multawiya (الملتوية) | traced 2026-10-17; clean; **approved, in the library** |
| 20 | ر ra, mursala (المرسلة) | traced 2026-10-17; clean; **approved, in the library** |
| 21 | ن + ر ra made small inside a nun | traced 2026-10-17; clean (label word erased); **approved, in the library** |
| 22 | ل + ر ra made small after a lam | traced 2026-10-17; clean (label word erased); **approved, in the library** |

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


Mapped and traced 2026-10-17 (`sheet6-numbered.png`, made by the new
`mapSheet.py`). The pen measures **14 px** on this scan, so the sheet uses
48/14 = 3.43 units per px. **Scale to check in review**: at that scale the
lam is 712 units tall against 577 for sheet 1's lam, about a fifth taller.
Either the letters really are drawn larger for the pen here, or the scan's
blur makes the pen read thin. Note words beside 1, 3, 7 and 13 are dropped
with the new `"main"` erase (keep only the largest shape). The dotted
alternates are thin and are cleaned away; they are listed above.

### Sheet 6's notes, transcribed (2026-10-17)

- **Piece 1**, heading اللام واللام الالف: "يتكون من الالف وحوض النون او
  حوض القاف او الصاد او السين او الياء": the lam is the alif plus the bowl
  of nun, or of qaf, sad, seen or ya. (The dotted seen beside it shows one.)
- **Piece 2**, اللام الالف: "يتكون من حرف الالف ومن نهاية حرف الهاء النهائية
  المرسلة والالف المعوج ومنه يخرج الالف الثانية": made of the alif, the end
  of the final mursala ha, and the crooked alif, from which the second alif
  comes.
- **Piece 3**, اللام الالف: "يتكون في بدايته من الالف المعوج في نهايته في
  اندفاع القلم الى اليسار بنقطتين وانخفاضه بنقطة، يرجع القلم بقوس منحن.
  ويرتفع عن الرأس الاول بنقطة واحدة ويكون الزلف المضاف للزينة وهذا شكله":
  it begins with the crooked alif; at its end the pen pushes left **two
  nuqtas** and drops **one**, then returns in a bending arc. It rises **one
  nuqta** above the first head, and the **zulf** (the thin hairline) is
  added for decoration; this is its shape.
- **Pieces 7 and 8**: "في هذه الحالة عندما يكون التركيب في اللوحة يقطع
  امتداد اكمال اللام الالف ويكون الزلف مطولاً كما في الشكل": when a panel's
  composition calls for it, the lam-alif's extension is cut short and the
  zulf is lengthened, as in the figure.
- **Piece 13 (فلا)**: "هذا الشكل في الحالات الاضطرارية سواء كان في وسط
  السطر او في نهايته ويقتصر على الالواح المقيدة الحجم": for forced cases,
  mid-line or at the end, and only in panels of limited size.
- **Pieces 15/16**: "هذا الشكل يكتب في الحالات الاضطرارية وفي نهاية
  الاسطر": written in forced cases and at line ends (the arrow points to 15).
- **Piece 14**: "اللام الالف ذات الظفيرة يكون بعقدة او عقدتين او ثلاث وهذا
  يرجع الى طول اللام الالف ويكثر استعماله عند البغداديين": the braided
  lam-alif has one, two or three knots depending on its length; common with
  the Baghdadis.
- **Pieces 17, 18**: "يجوز استعمال اللام الالف في هذه الاشكال وتكون دائماً
  في النهاية": these lam-alif shapes may be used, always at the end.
- **Pieces 19, 20**: "يجوز استعمال اللام المرسل الفردي في نهاية الاسطر غير
  المركبة إلا ان ارساله يختلف عن ارسال كأس النون وتوابعه وهذا شكله الصحيح
  الموزون": the standalone mursala lam may end a line that is not composed,
  but its extension differs from that of the nun's cup and its kin; this is
  its correct, balanced shape.
- **Piece 21 (صلى)**: "هناك قاعدة قديمة بهذا الشكل للام واستعمالها في خط
  المحقق والثلث غير المركب": an old rule gives the lam this shape, used in
  Muhaqqaq and in Thuluth that is not composed.

| # | provisional name | units tall | status |
|---|---|---|---|
| 1 | ل lam | 712 | traced 2026-10-17, clean |
| 2 | لا lam-alif (alif + end of the mursala ha + crooked alif) | 701 | traced 2026-10-17, clean |
| 3 | لا lam-alif beginning with the crooked alif | 600 | traced 2026-10-17, clean |
| 7 | لا lam-alif cut short in a panel, zulf lengthened | 532 | traced 2026-10-17, clean |
| 8 | لا the same, small example | 309 | traced 2026-10-17, clean |
| 13 | فلا forced cases | 693 | traced 2026-10-17, clean |
| 14 | لا braided (ذات الظفيرة) | 704 | traced 2026-10-17, clean |
| 15 | لا forced cases and line ends | 703 | traced 2026-10-17, clean |
| 16 | لا second form | 715 | traced 2026-10-17, clean |
| 17 | سلا end-only lam-alif | 733 | traced 2026-10-17, clean |
| 18 | حلا end-only lam-alif | 750 | traced 2026-10-17, clean |
| 19 | هول standalone mursala lam | 722 | traced 2026-10-17, clean |
| 20 | حل standalone mursala lam | 707 | traced 2026-10-17, clean |
| 21 | صلى the old rule's lam | 796 | traced 2026-10-17, clean |

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


Mapped and traced 2026-10-17 as three sheets, `t7r1`–`t7r3`
(`sheet7-rowN-numbered.png`). Pen 16 px on all three: the shared scale.
Row 1's pieces are numbered by shape after cleaning (right to left), and
`"main"` drops the measuring nuqtas beside each pair.

Notes, transcribed: row 1 headings الباء الاولى ذات النقطتين (the initial
beh with two dots: pieces 2–15) and الباء الاولى ذات ثلاث نقاط (with three
dots: piece 19). Row 2: الباء مع الياء (beh with ya, piece 1), and over
pieces 2–5 "يجوز استعمال هذه في الباء والتاء والثاء والنون وهي متشابهات في
بدايتها": these may be used for ba, ta, tha and nun, which are alike at
their start. Row 3: الباء مع الميم (beh with meem, piece 3).

| piece | provisional name | status |
|---|---|---|
| r1 2 | بص بط initial beh with sad and with ta, touching | traced; nearly clean (a guide-line tick at the left) |
| r1 4 | بغ beh with ghain | traced; **needs cleanup**: guide lines across it |
| r1 5 | بق beh with qaf | traced; **needs cleanup**: nuqta stubs at the head |
| r1 9 | بم beh with meem | traced; **needs cleanup**: a nuqta stub on the tip |
| r1 10 | بر beh with ra | traced, clean |
| r1 13 | بو beh with waw | traced, clean |
| r1 15 | بى beh with ya | traced, clean |
| r1 19 | three-dot beh, long joined run (to name) | traced; **needs cleanup**: guide-line bits |
| r2 1 | بى beh with ya | traced, clean |
| r2 2–5 | initial teeth for ب ت ث ن, four forms | traced, clean (2's dotted alternate cleaned away) |
| r2 6 | beh body, long (to name) | traced, clean |
| r2 7, 8 | beh with waw, two forms (to name) | traced, clean |
| r3 1 | sad-like beh join (to name) | traced, clean |
| r3 2 | بط beh with ta | traced, clean |
| r3 3 | بم beh with meem | traced, clean |
| r3 4 | seen-like run with final ya and upright (to name) | traced, clean (dotted alternate head cleaned away) |

## Sheet t8 — initial beh of the ya type (row images)

- Row 1, `thuluth-8-row1.png` (2026-10-16): "باء أولية من نوع الياء" (initial
  beh of the ya type: يـ/بـ joined to ح، م، ه and others) and "باء أولية من
  نوع الياء المصغرة" (the same with the small ya), with measurement dots.
- Row 2, `thuluth-8-row2.png` (2026-10-16): "الباءات الأولية والوسطية
  والنهائية" (initial, medial and final behs): بلـ/بب-type runs, a long run
  of joined behs with measurement dots and a dotted circle, and a run like
  بلسة/تليمة with stroke-order numbers.
- Row 3, `thuluth-8-row3.png` (2026-10-16): one word, a run of joined behs
  ending in ة (416×152; drawn a little smaller — strokes ~18 px against ~24
  on the other rows, so its trace takes its own scale).


Mapped and traced 2026-10-17 as `t8r1`–`t8r3` (`sheet8-rowN-numbered.png`).
Pen 16 px on all three rows (row 3 included): the shared scale. Notes:
row 1 headings باء اولية من نوع الياء (initial beh of the ya type: pieces
1–4) and باء اولية من نوع الياء المصغرة (of the small-ya type: 6–8); row 2
heading الباءات الاولية والوسطية والنهائية (initial, medial and final
behs). Map pieces 5 and 6 of row 1 are one joined shape, traced as 6.
Baseline and guide-line bits touching the teeth are the common leftover on
this sheet; they are left for hand touch-up.

| piece | provisional name | status |
|---|---|---|
| r1 1 | يـ initial beh of the ya type | traced; **needs cleanup**: a tick on the stroke |
| r1 2 | بح beh with ha | traced, clean |
| r1 3 | بح beh with ha, second | traced, clean |
| r1 4 | بمى run ending in a long ya (to name) | traced, clean |
| r1 6 | small-ya beh with ra and nun, joined (to name) | traced, clean |
| r1 7 | small-ya beh run (to name) | traced; **needs cleanup**: measuring nuqtas and guide line joined to it |
| r1 8 | small-ya beh run with meem (to name) | traced; **needs cleanup**: guide-line bits |
| r2 1 | initial, medial and final behs (to name) | traced; **needs cleanup**: baseline bits under the teeth |
| r2 2 | long run of joined behs (to name) | traced; **needs cleanup**: baseline bits under the teeth |
| r2 3 | بلسة تليمة runs, stroke numbers (to name) | traced; **needs cleanup**: baseline bits; stroke numbers 1–7 read in review |
| r3 1 | one word, behs ending in ة (to name) | traced; **needs cleanup**: baseline under it |

## Sheet t9 — the jeem family (row images)

- Row 1, `thuluth-9-row1.png` (2026-10-16): "جيمات أولية" (initial jeems,
  several head angles) and "جيمات وسطية" (medial jeems), plus a large stacked
  جـ over ح with its full measurement grid. Heavy measurement dots on every
  piece — a candidate for cross-referencing with a cleaner scan if one comes.
- Row 2, `thuluth-9-row2.png` (2026-10-16): "حرف الحاء" — four words with
  a long ha: حم، حسا، حمل، حم. Almost no measurement dots. Notes (proportion
  rules): every ha followed by a madd (extension) is six nuqtas long; here
  the ha is followed not by a madd but by a low letter, and is still six
  nuqtas; a rule special to the word الرحمن in the Muhaqqaq pen makes the ha
  six nuqtas, and the noon likewise.
- Row 3, `thuluth-9-row3.webp` (2026-10-16): ha joined after and before
  other letters — لحم، لحم (two), حم، حكم، حمر، حر (the open ha, حاء
  مفتوح). No measurement dots. Note: the open ha may not be used before a
  raised letter such as kaf or lam (لا يجوز استعمال الحاء المفتوح إذا وقعت قبل
  أحد الحروف المرتفعة مثل الكاف واللام).


Mapped and traced 2026-10-17 as `t9r1`–`t9r3` (`sheet9-rowN-numbered.png`).
Row 1 pen 16 px; rows 2 and 3 are scanned larger (17.2 and 17.6 px) and
carry their own unit. Notes, transcribed: row 1 headings جيمات اولية
(initial jeems, 2–4) and جيمات وسطية (medial jeems, 5–6). Row 2 heading
حرف الحاء; over **5 (حم)** "كل حرف حاء تظهر بعده مد يكون طولها ست نقاط"
(every ha followed by an extension is six nuqtas long); over **2 (حسا)**
"والحاء هنا ليس بعدها مد بل حرف منخفض فيكون طولها ست نقاط" (here no
extension follows, but a low letter, and the ha is still six nuqtas); over
**6 (حمل)** "هذه القاعدة خاصة بكلمة الرحمن بقلم المحقق فيكون طول الحاء ست
نقاط وكذلك طول النون" (this rule is special to the word الرحمن in the
Muhaqqaq pen: the ha is six nuqtas, and so is the nun). Row 3, under the
row: "لا يجوز استعمال الحاء المفتوح اذا وقعت قبل احد الحروف المرتفعة مثل
الكاف واللام" (the open ha may not be used before a raised letter such as
kaf or lam).

| piece | provisional name | status |
|---|---|---|
| r1 2 | جـ initial jeem, head angle 1 | traced, clean |
| r1 3, 4 | جـ initial jeem, head angles 2 and 3 | traced; **needs cleanup**: measuring nuqtas inside, guide lines |
| r1 5, 6 | ـجـ medial jeem, two forms | traced; **needs cleanup**: guide lines, nuqtas |
| r1 7 | جـ over ح stacked, measuring grid | traced; **needs cleanup**: grid lines and nuqtas |
| r2 5 | حم ha before an extension | traced, clean |
| r2 2 | حسا ha before a low letter | traced, clean |
| r2 6 | حمل the الرحمن rule | traced, clean |
| r2 7 | حم second | traced, clean |
| r3 1 | لحم لحم two words | traced, clean |
| r3 2 | حم | traced, clean |
| r3 3 | حكم | traced, clean |
| r3 4 | حمر حر the open ha, two words | traced, clean |

## Sheet t10 — the seen (row images)

- Row 1, `thuluth-10-row1.png` (2026-10-16): "حرف السين" — س standalone
  (labelled الفردي twice: the plain and the extended), لسه, سط with a medial
  seen (labelled وسط), and "السين مع الميم" (seen with meem): سمد، سملا. A
  faint dotted alternate outline above the سملا (the alif/lam, ~330–350 px
  from the left). No measurement dots.
- Row 2, `thuluth-10-row2.png` (2026-10-16): seen joined to ra and to meem
  — سمر، بسم-type runs, سر، سرس، سمرس. Notes: "السين والصاد متساويان
  بالاتصال مع الراء" (seen and sad behave the same when joined to ra); "إذا
  استعمل باء البسملة يكون المد بعده سيناً مرسلة" (when the ba of the basmala
  is used, the extension after it is an extended seen). A dotted alternate
  outline at the right, inside the first سمر (~1270–1310 px), and a small
  separate س under the line. No measurement dots.
- Row 3, `thuluth-10-row3.png` (2026-10-16): the extended seen — سرا with
  a long flat seen, and a stacked composition of a long seen over ح with ط
  (سحط-like). Note: "السين يكون في المد مقارباً إلى مد الباء المرسلة" (the
  seen's extension is close to that of the extended ba). A clipped stroke at
  the top edge belongs to the row above. No measurement dots.
- Row 4, `thuluth-10-row4.png` (2026-10-16): two pieces stacked in one
  image — "وسط" (medial seen: النسيم-like word, with measurement grid) and
  "سين أولي ووسط ونهائي" (initial, medial and final seen: a stacked run of
  seens over a long final, with stroke-order numbers and measurement dots).


Mapped and traced 2026-10-17 as `t10r1`–`t10r4`, using `mapSheet.py`'s new
`parts` mode (numbers are separate shapes, because whole words sit close).
Pens: rows 1, 2 at 14 px, row 3 at 16, row 4 at 14.4; each row has its own
unit. The notes are transcribed above (labels الفردي, وسط, السين مع الميم;
the seen/sad-with-ra rule; the basmala's ba; the seen's extension).

| piece | provisional name | status |
|---|---|---|
| r1 4 | س standalone seen (الفردي) | traced, clean (label word dropped) |
| r1 1 | س لسه سط, joined in the scan | traced, clean (label words dropped) |
| r1 2 | سمد سملا seen with meem | traced, clean |
| r2 1, 3 | سمر, two forms | traced, clean |
| r2 2 | seen joined to ra, long run | traced, clean |
| r2 4 | سمرس | traced, clean |
| r3 1 | سرا with a long flat seen | traced, clean |
| r3 2 | long seen over ح with ط, stacked | traced, clean |
| r4 1 | medial seen (النسيم-like) | traced; **needs cleanup**: guide lines |
| r4 2 | initial, medial and final seen, stacked | traced; **needs cleanup**: measuring nuqtas and lines; stroke numbers 1–4 to read |

## Sheet t11 — sad and tah: complex strokes and alternate forms (row images)

The user's framing (2026-10-16): "now the complex strokes and alternate forms".

- Row 1, `thuluth-11-row1.png` (2026-10-16): "حرف الصاد والطاء" — ص
  standalone, صر, a stacked run of two sads over a returned ya tail (صصى-like),
  صو, and a stacked مصحم-like word; a faint dotted alternate outline at the far
  left (~75–95 px, the start of the last word). No measurement dots.
- Row 2, `thuluth-11-row2.webp` (2026-10-16, 1551×602): two rows of complex
  tah and sad strokes and stacked forms — a مطـ-like opening run, طط, a
  stacked مصحى-like word, سط, a ط over ع stack, a long طـ run, and مصى.
  Dotted alternate outlines: a vertical at the far left by the first word,
  and dotted pieces beside سط and the stacked ع. No measurement dots seen.
- Row 3, `thuluth-11-row3.png` (2026-10-16, 771×271): two joined runs on
  guide lines. Right: "صاد اولی و وسط و نهائی" — initial, medial and final sad
  (صصص-like). Left: "طا اولی و وسط و نهائی" — initial, medial and final tah
  (ططط-like), the three tall tah uprights ending in arrowheads. Thin guide
  lines run through both; no measurement dots or dotted alternates seen.


Mapped and traced 2026-10-17 as `t11r1`–`t11r3` (parts mode). Pens 16,
15.6 and 16 px. Notes: row 1 heading حرف الصاد والطاء; row 3 labels صاد
اولى ووسط ونهائي and طاء اولى ووسط ونهائي (initial, medial and final sad
and tah). The dotted alternates are thin and are cleaned away.

| piece | provisional name | status |
|---|---|---|
| r1 1 | ص standalone sad | traced, clean |
| r1 2 | صر and a stacked صصى run | traced, clean |
| r1 3 | صو | traced, clean |
| r1 4 | stacked مصحم-like word (to name) | traced, clean |
| r2 1 | stacked مصحى-like word with ح (to name) | traced, clean |
| r2 2, 6 | ط tah, two forms | traced, clean |
| r2 3 | طط | traced, clean |
| r2 4 | مطـ run stacked with ط (to name) | traced, clean |
| r2 5 | مصى stacked, with a zigzag tail (as drawn) | traced, clean |
| r2 7 | long طـ run (to name) | traced, clean |
| r2 8 | ط over ع, stacked | traced, clean |
| r2 9 | سط | traced, clean |
| r3 1 | initial, medial, final sad and tah, touching | traced; **needs cleanup**: guide lines |

## Sheet t12 — ain (row images)

- Row 1, `thuluth-12-row1.png` (2026-10-16): the named ain forms, right to
  left. "عين فنجانی" (cup ain, standalone with dot-grid construction lines);
  "عين صادی" (sad-like ain, بغ-like with construction lines); "عين فنجانی" and
  "ثعبانی صادی" over one joined بلغب-like run; "عين اولی و وسط و نهائی"
  (initial, medial and final ain: an عغع-like run with a deep final bowl,
  measurement dots and stroke-order numbers); "عين ثعبانی" (snake ain, a
  stacked نابتغا-like word with stroke-order numbers and arrows). Measurement
  dots and construction lines on most pieces; no dotted alternates seen.
- Row 2, `thuluth-12-row2.png` (2026-10-16): "حرف العين" — one clean
  practice line, right to left: ا, لعمر, با, علی, عسـ…ـلی (an ain over a long
  seen-like stroke with a returned ya tail), عحمع-like word ending in an open
  final ain. Clean strokes: no measurement dots, guide lines or dotted
  alternates.
- Row 3, `thuluth-12-row3.png` (2026-10-16): one clean practice line, likely
  the words يسر / عسر / بعد (as in "بعد عسر يسرا"): a stacked ain-seen-ra
  word at the right, a medial ain in عسر, and a long ending in بعد. Clean
  strokes: no measurement dots, guide lines or dotted alternates. Dotless
  as drawn.
- Row 4, `thuluth-12-row4.png` (2026-10-16): a stacked composition (tarkib)
  of "وجعلنا" — tall alif and lam uprights, the ain and jeem stacked
  mid-height, the و at the right, the ن bowl underneath. Beside it the note
  "يجب على الخطاط ان يفهم اصول التركيب في وضع الحروف بموضعها" ("the
  calligrapher must understand the rules of composition: putting each letter
  in its place"). A reference for stacked compositions rather than a source
  of single pieces. Clean: no measurement dots or dotted alternates.
- Row 5, `thuluth-12-row5.png` (2026-10-16): a second arrangement of
  "وجعلنا" — the ain moved to the upper left beside the alif, the ن bowl
  directly under it, the lam's long bowl sweeping beneath the whole word.
  Pair it with row 4: same word, two placements of the same letters. Clean:
  no measurement dots, notes or dotted alternates.

## Sheet t13 — fa, qaf and waw (row images)

- Row 1, `thuluth-13-row1.webp` (2026-10-16): "حرف الفاء والقاف والواو",
  with the rule "يكتب رؤوس هذه الاحرف الثلاثة بشكل واحد" — the heads of
  these three letters are written the same way. **One shared head**, so it
  should be traced once and reused. Five numbered pieces, right to left:
  1. ف gathered (مجموع), derived from ba.
  2. ق gathered, its bowl derived from the cup of seen, sad and nun.
  3. و extended (مرسل), derived from extended ra.
  4. ف extended, derived from ba and from the base of the zinadi kaf.
  5. ق extended, derived from extended nun.
  Clean strokes, dotless (one small mark above piece 5 to check); labels,
  arrows and numbers need removing. No dotted alternates.
- Row 2, `thuluth-13-row2.webp` (2026-10-16): waw forms, numbered 6–11,
  right to left:
  6. و gathered (مجموع), derived from gathered ra and dal.
  7. و with a **dotted alternate outline** of a longer, curled tail.
     Note (`thuluth-13-notes.png`): "الواو المرسل ذات ٤ نقاط يكون داخل كأس
     النون أو السين" — the dotted one is the extended waw, four nuqtas
     long, used inside the cup of a nun or seen.
  8. و of seven nuqtas — labelled as Muhaqqaq, "not to be used in Thuluth".
     Keep it out of the Thuluth set.
  9. و with its head open on the left (الرأس المفتوح من اليسار).
  10. و with its head open on the right (الرأس المفتوح من اليمين).
  11. a joined مو-like pair: "the letter before the waw may join the waw's
      head from the left".
  Clean, dotless strokes; labels, arrows and numbers need removing.
- Row 3, `thuluth-13-row3.png` (2026-10-16): piece 12, one long joined run
  showing the shared fa/qaf/waw head in the start and middle of a word —
  a ف head stacked over a ح at the right, then medial heads after ع, ل, ط and
  ص, ending in لا. Read loosely as فحـعـفلفطفصلا; to confirm. Note
  (`thuluth-13-notes.png`): "حرف الفاء وكيفية استعماله بين الاحرف" —
  the fa and how it is used between letters, so these heads are fa. Clean, dotless;
  a faint dotted segment on the baseline under the ط to check.
- Row 4, `thuluth-13-row4.png` (2026-10-16): fa at the start, middle and end,
  in two kinds, each with a rule:
  - Right, "فاء اولى و وسط و نهائى": a وففـ-like run plus a فـ head stacked on
    a ح (فح), with the note "يكتب قبل الاحرف المرتفعة" — this fa is written
    **before tall letters**. Measurement dots and construction lines on the
    heads.
  - Left, "حرف فاء ممدود و متصل و وسط مع واو نهائى" (extended, joined and
    medial fa with a final waw): a و then a فبو-like run, with the note
    "يكتب قبل الاحرف المنخفضة" — this fa is written **before low letters**.
    Guide lines and a measurement dot.
  The tall/low rule is a placement rule worth keeping with the pieces.

## Sheet t14 — kaf and its kinds (row images)

- Row 1, `thuluth-14-row1.webp` (2026-10-16): "الكاف وانواعه", five numbered
  kafs, right to left, each with a dotted alternate tail or stroke:
  1. ك single (المفرد): "made of the alif and the base of fa and ba".
     Dotted alternate: a curled tail at the right edge.
  2. ك final (الكاف النهائي): "the upright of the medial lam with the base
     shown in (1)". Dotted alternate tail below.
  3. ك extended (المرسل): "made of the alif and the extended fa and ba; may
     also be used at the end". Dotted alternate tail below.
  4. ك zinadi (الزنادي). Dotted alternate near its start. Note
     (`thuluth-14-notes-2.png`): "الكاف الزنادي يتكون الرأس من الراء المنحرفة
     والخط الاول من الباء ذي الرأس المنخفض والخط الثاني من الباء ذي الرأس
     المرتفع" — the head comes from the slanted ra, the first stroke from
     the low-headed ba, the second stroke from the raised-head ba.
  5. ك zinadi joined into a following letter (كد-like). Dotted alternate
     vertical at the far left.
  The small ك signs inside 1–3 (the kaf's inner mark) are separate pieces.
  Clean strokes otherwise; labels and numbers need removing.
- Row 2, `thuluth-14-row2.webp` (2026-10-16): the saifi (sword) kaf, pieces
  6–9, right to left:
  6. saifi, initial joined (السيفي الاول المتصل): "made from the start of
     lam-alif, the head from the start of the extended seen". Dotted
     alternate: a long tail looping down below.
  7. saifi, single and joined (السيفي المفرد والمتصل): "from the first half
     of lam-alif; some calligraphers derive it from the dal". Dotted
     alternate: a looped tail below.
  8. "model of the medial saifi kaf and its derivatives" (a كرا-like run).
     Dotted alternate: a tall upright above.
  9. "model of the saifi kaf, medial and final, joined" (a مكا-like run).
  Clean strokes; labels and numbers need removing.
- Row 3, `thuluth-14-row3.png` (2026-10-16): three unlabelled pieces numbered
  (1)–(3), each a body with the small S-shaped kaf sign above it. (1) a
  crossed, lam-alif-like body; (2) a slanted body with a short flat base;
  (3) a tall upright over a round bowl. Clean, no measurement dots or dotted
  alternates. Named by the notes (`thuluth-14-notes.png`): "١، ٢، ٣: يجوز
  استعمال الكاف الزنادي الصغير بدل تكملة السيفي في حالات الضيق في الكتابة" —
  the S shape is a **small zinadi kaf**, used in place of the saifi kaf's
  upper part when space is tight. So these are three saifi kafs
  completed the short way.
- Notes, `thuluth-14-notes.png` (2026-10-16), besides the one above:
  - "(٥) يكون الفرق في الاحرف المرتفعة لكل من اللام والدال والكاف النهائي
    نقطتين وأما باقي الاحرف فيكون الفرق بينها نقطة او نصفها" — a height
    rule: between lam, dal and final kaf the difference is two nuqtas; for
    the other letters, one nuqta or half. Goes with row 1 piece 5 (كد).
  - "الكاف السيفي المفرد والوسط" — the saifi kaf, single and medial: a
    caption, probably for the next row.
- Row 4, `thuluth-14-row4.png` (2026-10-16): one small word, read as حكما — a
  ح head running into a medial kaf, then ma and a final alif. Possibly the
  example for the caption "الكاف السيفي المفرد والوسط" (to confirm). Clean,
  dotless, small (about 300 px wide), so it traces coarser than the others.
- Row 5, `thuluth-14-row5.webp` (2026-10-16): the construction sheet for
  the kafs in words, two halves:
  - Right, "الكاف الزنادي مع النهائي وفي الوسط والكاف السيفي الاولى" (the
    zinadi kaf with the final and medial, and the initial saifi kaf): a
    stacked بكلك-like run and a كا.
  - Left, "الكاف السيفي المفرد والوسط" (the saifi kaf, single and medial —
    the caption from the notes): بكر and بكلا.
  Heavy measurement: nuqta columns, dotted construction diagonals, stroke
  numbers and arrows on every piece. The best reference for proportions on
  this sheet, but the hardest to clean; the letters touch the construction
  lines in many places.

## Sheet t15 — ba and the letters built from it (row images)

- Row 1, `thuluth-15-row1.webp` (2026-10-16): "حرف الباء", right to left:
  - "الباءان العاديان" (the two ordinary bas): a short ب and a long ب. The
    long one has a **dotted alternate** at its left end: the tail curling
    down instead of rising.
  - "الباء والشين" (ba and shin): the ba body used as the shin/seen cup, with
    a **dotted alternate** head (a teeth-like start) above its right end.
  - "الباء والكاف" (ba and kaf): the ba body used as the base of a kaf, with
    the kaf's small inner mark.
  Clean, dotless; labels need removing. Compare with sheets t7/t8 (beh).
- Row 2, `thuluth-15-row2.webp` (2026-10-16): "حرف الباء ذات النقطة والنصف
  وهي متصلة بالحرف النهائي" — the **ba one and a half nuqtas wide**, joined
  to a final letter. Right to left, loosely: غو (or a و after a dot), با,
  بذ/بن, بك, بل, بق, به, and a stacked ...بلا run at the far left. The ba's
  short body is the same in every pair, so these are the initial-ba joins
  to each final letter. Measurement dots (nuqta columns), guide lines and
  stroke numbers on most pairs; letter dots drawn on some. Readings to
  confirm.
- Row 3, `thuluth-15-row3.webp` (2026-10-16): "حرف الباء ذات الثلاث نقاط وهو
  متصل بالحرف الاخير" — the **ba three nuqtas wide**, joined to the last
  letter. Right to left, loosely: a stacked بن, بن, نز/بر-like pair, a
  stacked بخ/نخ (with construction triangle), السن, and a long ...سس run
  under a nine-nuqta measurement row. Measurement dots, guide lines and
  letter dots on most. Readings to confirm.
  Also on this row, **two hamza shapes with a rule each** (small signs, for
  the marks/tashkeel side, not ba pieces):
  - ع-shaped "همزة الألف" (the alif's hamza): "not to be used in Thuluth,
    Naskh or Ijaza in place of the kaf's hamza".
  - small ء "همزة الكاف" (the kaf's hamza): "not to be used in place of the
    alif's hamza in the three scripts".
  So the two hamzas are distinct marks and must not be swapped.

## Sheet t16 — lam, the two special words, and mim (row images)

- Row 1, `thuluth-16-row1.webp` (2026-10-16), right to left:
  - "اللام الاولى والوسط والنهائي" (lam at the start, middle and end): a
    بلل-like run of tall lams.
  - "لفظة الجلالة قاعدتها خاصة" — the word **الله has its own rule**.
  - "كلمة محمد قاعدتها خاصة" — the word **محمد has its own rule** (stacked,
    with a dotted construction diagonal).
  - "الميمات الأولية" (initial mims): two مـ heads, the second with a dotted
    alternate tail.
  - "الميمات الوسطية" (medial mims): three بمـ-like pairs.
  Measurement dots, guide lines, stroke numbers and arrows on all of them.
  الله and محمد are whole-word pieces: candidates for word-level marks
  rather than letter pieces. Compare the lams with sheet t6, the mims with
  t2 pieces 8–11.
- Row 2, `thuluth-16-row2.webp` (2026-10-16), right to left:
  - "ميم وسط" (medial mim): one stacked بمـ-like piece with a construction
    box.
  - "الميمات النهائية" (final mims): بم/لم with a round bowl, a بم-like pair
    ending in a long sweeping tail, and a tall stacked final mim whose tail
    drops straight down (a vertical tail beside a nuqta column).
  - "ميم الراء المرسلة" (the mim of the extended ra): لم-like, the mim's tail
    taking the extended ra's sweep. **Dotted alternate** at its top right
    (a different start for the head).
  Measurement dots, construction boxes, stroke numbers and arrows on all
  but the last piece, which is clean.
- Row 3, `thuluth-16-row3.webp` (2026-10-16): "حرف الميم" — the standalone
  mims, each with a usage rule, right to left:
  - Two single mims: "هذا الميم الفردي يستعمل في خط الثلث ما عدا المحقق" —
    the **Thuluth single mim** (not Muhaqqaq). Under them: "ويجوز جعله ميمًا
    وراءً اذا زيد نصف نقطة عن قاعدة الميم" — adding half a nuqta to the base
    makes it a mim-ra. The second looks like that longer version.
  - "هذا الميم يستعمل في اول الحاء والخاء والجيم والراء والياء ومع النون
    الرحمانية النهائية" — this mim is used before ha, kha, jeem, ra and ya,
    and with the final "rahmani" nun. **Dotted alternate**: a following
    ح-like shape.
  - A mim with its tail dropping straight down: "يجوز استعماله في حالات
    اضطرارية وفي النهاية" — allowed when needed, and at the end.
  - At the left: "هذا الميم الفردي يستعمل في المحقق وفي الثلث في حالات
    الضرورة" — the **Muhaqqaq single mim**, used in Thuluth only when
    needed. **Dotted alternate**: a long joined shape behind it. A smaller
    مـ head at the far left.
  Clean strokes, no measurement dots; labels and arrows need removing.
- Row 4, `thuluth-16-row4.webp` (2026-10-16), right to left:
  - A سم-like piece and a separate mim head, with the rule "هذا الميم يستعمل
    مع الباء والسين والصاد والطاء والفاء والقاف المرتفعين قبل المد ويستعمل مع
    الياء النهائية في حالات قليلة" — this mim follows ba, seen, sad, tah, and
    the raised fa and qaf, before a long stroke; with a final ya only
    rarely. **Dotted alternate**: a curled tail under the separate head.
  - "الميمات الوسطية بين الاحرف" (medial mims between letters): one long
    joined run, loosely محمعمسمصملم — a mim after ح, ع, س, ص and ل in turn.
  Clean strokes, no measurement dots; labels need removing. Readings to
  confirm.
- Row 5, `thuluth-16-row5.png` (2026-10-16): mim-ra forms (ميم الراء — a mim
  whose tail is a ra), right to left:
  - "ميم الراء" after a lam (لم): the mim-ra joined to a tall lam.
  - "ميم الراء" standalone, with a **dotted alternate**: a tall lam-like
    upright with an arrowhead rising from the head (the same mim-ra joined
    under a lam instead).
  - "ميم الراء رحمانية" (the rahmani mim-ra) and "ميم الراء": a سمر-like run,
    the first a mim-ra after a seen-like stroke, the second a separate
    mim-ra.
  - At the far left, an unlabelled mim with a long straight tail (the
    extended-ra mim, as in row 2's last piece).
  Clean, no measurement dots; labels need removing.
- Row 6, `thuluth-16-row6.png` (2026-10-16): "الميمات النهائية المنخفضة" —
  the **low final mims**, four of them, each a small head on a tail that
  drops straight down. Right to left: two joined from a long rising
  diagonal (the second with a tiny **dotted alternate** hook at the tail's
  foot), then two joined from a short upright stub. Very clean, isolated
  pieces; an easy first trace.

## Sheet t17 — ha (ه) (row images)

- Row 1, `thuluth-17-row1.png` (2026-10-16): "هاءات اولية" (initial has):
  a هـ with a long rising diagonal entry and a هـ with a pointed top; "هاء
  وسطى" (medial ha): ـهـ joined from a short stroke on the right. Clean
  and isolated, but small (about 620 px wide), so it traces coarser.
  Compare with sheet t2 pieces 12–15.
- Row 2, `thuluth-17-row2.png` (2026-10-16): "حرف الهاء", the named has,
  right to left:
  - "الهاء الاولية يشتق من رأس الدال والفاء الوسطية كاملة ويسمى عين الهر" —
    initial ha built from the dal's head and the whole medial fa; called
    **"cat's eye" (عين الهر)**. A ده-like piece.
  - "هاء اولية تشتق من نهاية اواخر النون والكؤوس المشابهة لها وتسمى اذن
    الفرس" — initial ha built from the end of the nun and similar cups;
    called **"horse's ear" (اذن الفرس)**.
  - A joined run, loosely لهلهها, with three labels: "هاء منخفض وسطى" (low
    medial ha), "هاء وسطية" (medial ha), and "هاء منخفض وتسمى اذن الفرس" (low
    ha, also called horse's ear).
  Clean strokes, no measurement dots or dotted alternates; labels and arrows
  need removing. Matches row 1's shapes at a larger size.
- Row 3, `thuluth-17-row3.png` (2026-10-16): numbered "(1)", unlabelled.
  Two joined runs, loosely محه and مهحة: a mim-ha opening, a ha bowl in the
  middle, and a final ha/ta marbuta at the left end with a looped,
  knotted tail. Probably a final-ha example; **reading and name to confirm**.
  Clean, no measurement dots; small (about 760 px wide).
- Row 4, `thuluth-17-row4.png` (2026-10-16): numbered "(2)", "يجمع الهاءات
  الوسطية والهاء الاخير" — **brings together the medial has and the final
  ha**: a tall lam with an arrowhead, then لههه-like medial has, ending in
  the looped, knotted final ha seen in (1). So (1) is very likely the same
  lesson (final ha after mim and ha). Clean, no measurement dots; small
  (about 500 px wide).
- Row 5, `thuluth-17-row5.webp` (2026-10-16): final has (ـه) after a
  dal-like stroke, right to left: two with a round inner loop, two with a
  crossed (knotted) inner stroke, and a حه-like pair at the left under a
  large **dotted alternate** (tall crossing uprights, a kaf/lam-like
  overlay — what it stands for to confirm).
  Note under the row: "١-٢ استعمالها قليل إلا في أواخر كلمة سنة وما شابهها
  وخاصة في خط الإجازة" — "1–2 are rarely used, except at the end of the
  word سنة and similar words, especially in Ijaza script". **Which pieces
  "1–2" means is to confirm**: most likely the knotted final ha of rows 3–4,
  numbered (1) and (2); possibly the first two on this row. Either way,
  mark those as rare, not the default final ha.
  Clean strokes, no measurement dots.
- Row 6, `thuluth-17-row6.webp` (2026-10-16): "الهاءات الاولية والوسطية
  والنهائية" — the has at the start, middle and end, in words, right to
  left, loosely: هه (clean, no measurement), نجه/بجه (stacked), مهنه-like,
  a stacked لها/لهـ with a tall lam, فيه/فهه, and جحه-like at the left.
  The construction sheet for ha: nuqta columns, guide lines, stroke numbers
  and arrows on every piece but the first. Readings to confirm. Use it to
  check proportions; trace from the cleaner rows 1–5 where shapes repeat.

## Sheet t18 — final ya (row images)

- Row 1, `thuluth-18-row1.webp` (2026-10-16): "الياءات النهائية وكيفية اتصالها
  بالأحرف المختلفة" — the **final ya and how it joins each letter**. Right
  to left, loosely: هي (a long flat ya), مخي, مي, في, عي, طي, صي, سي, and بي/لي
  — the returned ya tail after each letter. Clean strokes; one small
  measurement mark and guide line under سي, and letter dots drawn on a few
  (مخي, عي). Compare with sheet t2 piece 18 and sheet t8 (ya type).

## Sheet t19 — practice words, and Thuluth's tashkeel and ornament signs

- Row 1, `thuluth-19-row1.webp` (2026-10-16), two parts:
  - Top, "كلمات فردية للتمرين" (single words for practice): one line of
    words on guide lines, loosely علي، لهم، عهم، سعف، فص، صطع، لا — with a
    small vertical side note by the فـ (reads like "يكتب قبل الاحرف
    المنخفضة", to confirm) and a small hamza-like sign over the final لا.
  - Below, "تشكيلات وتزيين خط الثلث" — **Thuluth's tashkeel and ornament
    signs**: two rows of small marks — small letter signs (ح، ع، ط، ص، س, a
    small ه, a small lam-alif, ء, a small mim, ي, ا), the small الله sign,
    madda-like strokes, waw-shaped signs, and long fatha/kasra strokes.
    Many carry tiny decorative hairline flicks (drawn with a fine pen).
  The second part belongs with the **mark/tashkeel library**, not letters:
  these are the small signs a Thuluth panel is filled with. Their flicks are
  hairlines, so they need the gentlest cleaning (the guide-line remover
  could eat them). Clean, no measurement dots.

## Sheet t20 — finished pieces: al-Fatiha, line by line (white on black)

- `thuluth-20-basmala.webp` (2026-10-16): "بسم الله الرحمن الرحيم", fully
  voweled and ornamented, **white ink on black** (the only inverted scan so
  far: invert it before cleaning, since the pipeline expects dark ink on
  light paper). The long extended seen of بسم, the الله with its shadda-alif
  and small ه sign, the stacked الرحمن and الرحيم. Every tashkeel and
  ornament sign from sheet t19 appears here **in place** — shadda with
  fatha, sukun, kasra strokes, the small م and ح signs under letters, the
  ص-like signs over the alifs — so it is the reference for **where** those
  signs sit, not just what they look like. A target for a composed result,
  rather than a source of single pieces.
- `thuluth-20-fatiha-2.webp` (2026-10-16): "الحمد لله رب العالمين الرحمن
  الرحيم" (verses 2–3), same hand, same white-on-black treatment and full
  tashkeel. Repeats الله, الرحمن and الرحيم from the Basmala, so the two can
  be cross-checked. New here: the stacked الحمد, رب with its long
  extended ba, and العالمين.
- `thuluth-20-fatiha-3.webp` (2026-10-16): "مالك يوم الدين إياك نعبد وإياك"
  (verse 4 and the start of verse 5; the line breaks mid-verse, so the
  next line should start with نستعين). New here: مالك with the small kaf
  sign inside its kaf, يوم, the stacked الدين, إياك twice (two kafs to
  compare), and نعبد with its long ain-ba sweep. The small signs under
  letters (ع under the ain, م, ح) show the sheet t19 letter signs in use.
  A slightly lighter strip along the bottom-left edge is scan background:
  crop it.
- `thuluth-20-fatiha-4.webp` (2026-10-16): "نستعين اهدنا الصراط المستقيم"
  (end of verse 5 and verse 6). New here: نستعين with its teeth and stacked
  ain, اهدنا, الصراط with sad and tah side by side (compare sheet t11), and
  المستقيم with a long seen-ta-qaf run. Letter signs under letters (س, ع,
  ط, ص, م) again show sheet t19's signs in place.
- `thuluth-20-fatiha-5.webp` (2026-10-16): "صراط الذين أنعمت عليهم غير"
  (verse 7, first part; the next line should start with المغضوب). New
  here: الذين, أنعمت with a very long ain-mim-ta sweep (the longest
  extension in the set, with a long fatha stroke over it), عليهم stacked,
  and غير with its returned ya. صراط repeats the previous line's الصراط:
  a second copy to cross-check.
- `thuluth-20-fatiha-6.webp` (2026-10-16): "غير المغضوب عليهم ولا الضالين"
  (end of verse 7). **The surah is complete** across the six files. غير
  repeats the end of the previous line, and عليهم repeats too: second
  copies to cross-check. New here: المغضوب with its sad and waw, ولا (a
  lam-alif after a waw), and الضالين ending in a returned nun. A lighter
  strip along the bottom-right edge is scan background: crop it.

## Sheet t21 — more Basmalas (black on light)

- `thuluth-21-basmala.webp` (2026-10-16, 1172×423): "بسم الله الرحمن الرحيم"
  in a **different, compact composition** from sheet t20's: no long
  extended seen, the words close together and stacked, the final ميم of
  الرحيم curled back at the left. Dark ink on light paper (no inverting).
  Full tashkeel and ornament signs in place, with more of the small
  v-shaped flicks than t20. Checked at full size: solid strokes, no
  shadow or double edge. Compare with t20's Basmala: same text, two
  layouts.
- `thuluth-21-basmala-b.png` (2026-10-16): a third Basmala — the long
  extended seen like t20's, but a **finer pen**, light strokes, sparse
  tashkeel (fatha/kasra strokes and small signs only, no v flicks), and
  الرحمن الرحيم kept on one level instead of stacked. **Naskh, confirmed by
  the user (2026-10-16)**: keep it out of the Thuluth set; Naskh reference
  only. Clean, no guide lines.

## Sheet t22 — a framed verse panel

- `thuluth-22-yusuf-21.webp` (2026-10-16): "والله غالب على أمره ولكن أكثر
  الناس لا يعلمون" (Yusuf 12:21), one line inside a thin rectangular
  frame, dark on light, full tashkeel and ornament signs. Worth noting:
  - **The last word, يعلمون, is written small** and tucked in at the left
    end, beside لا: the traditional way to fit an overflowing word into a
    fixed panel. A layout technique the app does not have yet.
  - ولكن أكثر: two long saifi kafs leaning right (compare sheet t14 row 2),
    the second crossing over the ن of ولكن.
  - الله, غالب with a long ba, على stacked, الناس with a long seen.
  The frame line is a guide-like straight line: the cleaner will remove
  it, which is what we want.

## Sheet t23 — a dense stacked panel (jali-style)

- `thuluth-23-ahzab-14.webp` (2026-10-16): "ولو دخلت عليهم من أقطارها ثم
  سئلوا الفتنة لآتوها وما تلبثوا بها إلا يسيرا" (al-Ahzab 33:14, my reading;
  to confirm); dark on light. The **densest composition so far**:
  words stacked two and three tiers deep, tall alif/lam uprights packed in a
  row, and the gaps filled with tashkeel and ornament signs. A small
  **signature (imza)** sits at the bottom centre — remove it, never trace
  it as a piece. A small mark at the far left edge (a verse-end or number)
  to check.
  Use: the target for "stacked" quality, the hardest layout the app
  could aim at. Not a source of single pieces: letters overlap and touch
  everywhere, so the component assigner would merge most of it.

## Sheet t24 — two signed panels with corner ornaments (white on black)

Both were signed "هاشم" and dated. **Hashim is the user's grandfather**
(told 2026-10-16), and the lesson sheets t1–t19 are his work too. None of
it is from al-Baghdadi's book, so never attribute it to him. The user
asked for no credit in the app.

- `thuluth-24-qalam-4.webp` (2026-10-16): "وإنك لعلى خلق عظيم" (al-Qalam
  68:4), a landscape panel: tall alifs and the ظ upright in a row, لعلى and
  خلق stacked in a deep curve underneath, the long kasra stroke under it.
  Small floral ornaments in all four corners. Verse marker "١٣" style
  numbers at the left.
- `thuluth-24-qalam-4-b.webp` (2026-10-16): **the same verse, "وإنك لعلى خلق
  عظيم", in a second layout**, black on light, no frame, ornament or
  signature: one line instead of the panel's deep curve, with the kaf of
  وإنك drawn as a long stroke reaching left over لعلى, and خلق and عظيم
  set side by side. Same words, two compositions: pair it with
  `thuluth-24-qalam-4.webp`. No inverting needed.
- `thuluth-24-fatir-43.webp` (2026-10-16): "ولا يحيق المكر السيء إلا بأهله"
  (Fatir 35:43), a **square** panel: a row of tall lam-alifs across the top
  half, السيء stacked above, بأهله and يحيق wrapped around the bottom.
  Corner floral ornaments, denser than the first.
Both: invert before cleaning. The corner florals are not letters; they
could be a later source for frame corner pieces (sheet `c`'s Frames group
in the mark library), but only if the user wants that.

## Sheet t25 — two panels with a small companion text (black on light)

- `thuluth-25-naml-30.webp` (2026-10-16): "إنه من سليمان وإنه بسم الله
  الرحمن الرحيم" (al-Naml 27:30). The Basmala is the main line, with the
  long extended seen; the words before it, "إنه من سليمان وإنه", are
  written **small and stacked into one compact block** sitting in the space
  above the extended seen. The same small-text technique as sheet t22's
  يعلمون, used for a whole phrase. Vertical floral borders at both ends:
  not letters.
- `thuluth-25-hadith.webp` (2026-10-16): a hadith panel in three tiers —
  small top line "قال رسول الله صلى الله عليه وسلم", the main line "من حسن
  إسلام المرء تركه ما لا يعنيه", and a small bottom line "صدق رسول الله"
  (with its own long extended lam). Floral sprays beside the small lines,
  a signature at the far left, small date digits (١٣ ٧٦?) under the main
  line: remove all of them. The main line has tall lam-alifs and a long
  stacked تركه ما.
  The panel is enclosed by a **repeating patterned border** (one motif
  tiled all the way round). Not a letter, but the clearest candidate yet
  for a tiling frame border, if the user wants frames from these sheets.
- `thuluth-25-wali-tawfiq.webp` (2026-10-16): "الله ولي التوفيق" as the main
  line, large: الله with its tall alif and lams, ولي with a very long ya
  sweeping under the whole middle, التوفيق stacked at the left. The small
  stacked block above the sweep reads like "نعم المولى ونعم النصير" (to
  confirm) — the small-companion-text technique again, filling the space
  the long ya leaves. **The bottom edge is cropped**: the lowest part of
  the ya's sweep is cut off, so a fuller scan would be needed to trace it.
  No signature, no border.

## Sheet t26 — a closing line

- `thuluth-26-closing.png` (2026-10-16): "وبه نستعين ونستجير إنه ولي الهداية
  والتوفيق وعليه التكلان" — a closing formula, one level line, fine pen,
  light tashkeel. A small stacked signature block at the left dated ١٣٨٤
  (about 1964): remove it. Like t21's third Basmala, the pen and the flat
  layout are **Naskh, confirmed by the user (2026-10-16)**: keep it out of
  the Thuluth set; Naskh reference only. Small
  (about 1530 px wide for a long line), so letters are only ~40 px tall.

## Sheet t27 — a dense panel with its reading key

- `thuluth-27-qalam-51.webp` (2026-10-16): "وإن يكاد الذين كفروا ليزلقونك
  بأبصارهم لما سمعوا الذكر ويقولون إنه لمجنون" (al-Qalam 68:51), white on
  black, a long dense panel stacked two and three tiers deep like t23. A
  small stacked "صدق الله العظيم" at the top left, the "هاشم" signature at
  the bottom left and the date ١٣٧٦ (about 1957) under the middle: remove
  all three. Invert before cleaning.
- `thuluth-27-qalam-51-key.webp` (2026-10-16): **the same verse written
  plainly on one line** (a Naskh-like key), so every word of the panel can
  be read off it. This is the first panel to come with its own key: use the
  pair to name the stacked pieces of the panel exactly, and as the model
  for checking readings of t23 and the other dense panels.

## Sheet t28 — a second panel with its key (one image)

- `thuluth-28-furqan-74.webp` (2026-10-16): "ربنا هب لنا من أزواجنا
  وذرياتنا قرة أعين واجعلنا للمتقين إماما" (al-Furqan 25:74). **Panel and
  key in one image**: the white-on-black panel on top (about y < 670), the
  plain one-line key on light paper below. Crop them apart before
  cleaning; invert only the panel. The panel is stacked two tiers deep with
  a forest of tall alif/lam uprights across the top; a small stacked "صدق
  الله العظيم" block at the top left, the "هاشم" signature and the date
  ١٣٧٧ (about 1958) along the bottom: remove all three.

## Sheet t29 — al-Fath panel

- `thuluth-29-fath-10.webp` (2026-10-16): "إن الذين يبايعونك إنما يبايعون
  الله" (al-Fath 48:10, my reading; no key sent). White on black, large
  and bold — fewer words than t27/t28, so the letters are bigger (alifs
  about 500 px tall) and the stacking is easier to follow: يبايعونك and
  يبايعون each stacked in two tiers, a row of tall alifs and lams, الله at
  the left end. Signature at the bottom left and the date ١٣٨٠ (about
  1960) under it: remove both. Invert before cleaning.

## Sheet t30 — al-Isra panel with its key (one image)

- `thuluth-30-isra-73.webp` (2026-10-16): "وإن كادوا ليفتنونك عن الذي أوحينا
  إليك لتفتري علينا غيره وإذا لاتخذوك خليلا" (al-Isra 17:73), read off the
  key. Panel (white on black, top, about y < 560) and plain key (below) in
  one image, like t28: crop apart, invert only the panel. Long and dense,
  stacked two tiers, many tall uprights, ending in a long خليلا. Signature at
  the left and date ١٣٧٧ (about 1958) under the middle: remove both.

## Sheet t31 — al-Naml 27:6, one line

- `thuluth-31-naml-6.webp` (2026-10-16): "وإنك لتلقى القرآن من لدن حكيم عليم"
  (al-Naml 27:6, my reading; no key). White on black, **one mostly level
  line** with only light stacking (من over لدن, حكيم): much closer to the
  plain line the app writes than the dense panels, so a good near-term
  target. A small flower-shaped **verse-end marker** at the far left: not a
  letter, remove it. No signature or date seen. Invert before cleaning.
- `thuluth-25-wali-tawfiq-b.webp` (2026-10-16): **"الله ولي التوفيق" in a
  second layout** (it belongs with `thuluth-25-wali-tawfiq.webp`; logged
  here because it arrived later). No small companion block. The long sweep
  has moved: here it is the final **qaf of التوفيق** that runs out flat to
  the left, while the ya of ولي stays short and drops under the line. One
  level line, light tashkeel, no signature or border; the whole sweep is
  in frame this time.

## Sheet t32 — book-title compositions (black on light)

- `thuluth-32-title-kaab.webp` (2026-10-16): a book title in three lines —
  small "ديوان" on top, the main Thuluth line "كعب بن مالك الأنصاري" stacked
  in two tiers (بن ما lifted over the run, a tall row of alif/lam uprights,
  the kaf at the right drawn large), and small "دراسة وتحقيق" underneath.
  The top and bottom lines are in a plainer hand (not Thuluth): reference
  only. Full ornament signs around the main line.
- `thuluth-32-title-tughrai.png` (2026-10-16): the single word "الطغرائي",
  large and compact: tall alif, lam and tah uprights, the ghain head
  stacked mid-height, the final ya sweeping back under the lam. The "هاشم"
  signature sits inside the lower bowl: remove it.
Both show a calligrapher composing **a short phrase or one word to fill a
block**, rather than a line: a different target from the verse panels.
- `thuluth-32-title-furusiya.png` (2026-10-16): the single word "الفروسية",
  one level line: tall alif and lam, the fa head, a long seen run with a
  long fatha stroke above it, ending in a ta marbuta. Small signature under
  the end: remove it.
- `thuluth-32-title-nahda.png` (2026-10-16): a publisher's name, "مكتبة
  النهضة" in Thuluth (the kaf's long stroke reaching left over the word, the
  ta marbuta stacked, ض at the left), with "للطباعة والنشر والتوزيع" small
  underneath in a plainer hand (reference only). Small signature under the
  main line: remove it. The closest thing yet to a **logo/wordmark**.

## Collection complete (2026-10-16) — open questions and review order

**Signatures and dates are erased from the saved scans** (2026-10-16, at
the user's request). Twelve files were cleaned: t23, both t24 panels,
the t25 hadith, t26, t27, t28, t29, t30 and the three signed t32 titles.
Only marks lying wholly inside a hand-picked box were erased, so no
letter was touched; each patch is filled with its own surrounding
colour. The originals stay in git history (before commit "Erase
signatures and dates"). Notes above that say "remove the signature" or
"remove the date" are now done. The "صدق الله العظيم" blocks are text,
not signatures, and were kept.

The user finished sending scans: 87 files, sheets t1–t32. Nothing has been
traced into the app. Questions to settle with the user during review:

1. ~~Source: are the lesson sheets from Hashim al-Baghdadi's book?~~
   Answered: no. The signed panels are by **Hashim, the user's
   grandfather**, and so are the lesson sheets (t1–t19), confirmed
   2026-10-16. No credit in the app.
2. ~~Names for sheet t1 and t2 piece 26~~ — all named 2026-10-16 (t1
   pieces the user did not correct keep the guessed name; t2 26 is ف
   fa without dots).
3. ~~Script of `thuluth-21-basmala-b.png` and `thuluth-26-closing.png`?~~
   Answered: Naskh. Both stay out of the Thuluth set.
4. t17 row 5: which pieces the note "١-٢" means, and what the big dotted
   overlay stands for; the words in t17 row 3.
5. t14 row 4 (حكما): is it the example for "الكاف السيفي المفرد والوسط"?
6. Readings marked "to confirm": t13 row 3, t15 rows 2–3, t17 row 6, t19's
   practice words and side note, t23 (al-Ahzab 33:14), t25 (the small
   block), t29 (al-Fath 48:10), t31 (al-Naml 27:6).
7. Whether to use the corner florals (t24) and the tiled border (t25
   hadith) as frame pieces at all.
8. Whether to keep t13 piece 8 (the Muhaqqaq waw) anywhere.

**Stroke-order numbers and arrows must go before tracing** (user,
2026-10-16). Many lesson sheets (t1, t2, t9, t14 row 5, t15, t16, t17 row 6
and others) carry small digits and arrows showing the order and direction
of the pen strokes. The current cleaner (`review.py`'s `clean_sheet`)
only drops them when they stand apart from the letters (tiny or very thin
pieces); a digit or arrowhead that **touches a letter** survives and
would be traced as part of it. So every piece gets a numbers-and-arrows
pass before its trace: list what is left touching the letter, erase it
by hand where needed, and check the result with the user. The numbers
are useful information too, and the user wants them kept (2026-10-16):
**record each piece's stroke order in this ledger before erasing its
numbers** (which stroke is 1, 2, 3…, and the arrow directions), in case
the app ever animates or teaches strokes.

Suggested review order, easiest first, so the method is agreed on clean
pieces before the hard ones: t16 row 6 (low final mims), t13 rows 1–2 (fa,
qaf, waw), t14 rows 1–3 (kafs), t15 row 1 (ba), t18 row 1 (final ya), then
the lettered sheets with measurement dots, then t19's small signs, and the
panels last (as targets, not sources).

## Clean outlines (`outlines/`)

Vector-clean pieces the user supplies directly (coloured ink on white, no
measurement marks). Traced with `traceOutline.py`; the review image and the
traced path sit beside each source.

- `outline-01.png` (2026-10-17, 652×1284): **ـم the joined ending meem**
  (named by the user, 2026-10-17). **Taken back out of the library**
  (the user, 2026-10-17): at 420 units it is too small, because the size
  ignored the **hat**, the joining stroke that rises into the meem from the
  letter before it. The standalone meem in the reference alphabet has no hat,
  so comparing heights with it undercounts. Left out for now; the trace and
  its notes are kept. Was in the library at **420 units tall**
  (`traceOutline.py` unit 0.354 per source px; the outline is shrunk to about
  600 px before tracing, which halves the path to 862 commands and still keeps
  the notch under the flag). How the size was chosen: the reference
  alphabet's meem measured against its alif, lam, ta and ha, scaled to those
  letters' sizes in the library, gives 420, 390, 433 and 437. Matching pen
  width to the grandfather's pieces gave 364, but the widest point on the
  meem is where two strokes overlap, so that reading runs small. Re-check
  against the coming meem outlines.
  `thuluth-lineup.png` (drawn by `lineup.py`) shows every Thuluth piece in the
  library side by side at library scale.

## Reference alphabet (`reference/alphabet.png`)

The full Thuluth alphabet, isolated forms, supplied by the user on
2026-10-17 **for reference only**. It carries a watermark, so nothing is
traced from it; the user will supply suitable outlines for new letters one
at a time. It is useful for proportions between letters.

First measurement (dark ink only, source px): the alif is 104 tall and the
isolated meem 88 tall, so a meem is about 0.85 of an alif. At the library's
alif of about 500 units, that puts a meem near 420 units tall. This is the
**isolated** meem. The same figure comes out of the alphabet's lam, ta and
ha, so it was used for `outline-01`, and turned out too small (see above):
a joined form carries a hat the standalone form lacks, so match like with
like.

## Smoother tracing (2026-10-17)

The user found the traced letters pixelated. Two causes, both fixed: the
review pictures were drawn without edge smoothing (now drawn 4x and shrunk),
and the tracer saw only a black-and-white copy of each piece, so its curves
followed the scan's pixel steps. `tracePieces.py` now traces the scan's own
grey edge shading (`gray=` in `review.trace`), lightly smoothed (blur 0.5 px,
alphamax 1.2, opttolerance 0.8). Paths are about half as long as before.
Every sheet-1 trace, approved ones included, was redone this way.

## Hand touch-ups (`touchup/`)

The user's suggestion (2026-10-17): erase leftovers by hand instead of in
code. Each traced piece is saved, cleaned and enlarged 4x, as
`touchup/<sheet>-<n>.png`. The user opens it in any paint program, paints
white to erase and black to add, and saves. From then on the piece is traced
from that file, not the scan, and the file is never overwritten. To start a
piece over, delete its file and re-run `tracePieces.py`.

## Waiting on something

From sheet 6 on (the user, 2026-10-17): go through the remaining sheets
one by one (map, read the notes, trace, log), **then** review them
together. Nothing from sheet 6 on enters the library before that review.

The user wants to go through all the tracings first, then do **one
cleanup sweep at the end** (2026-10-17): the hand touch-ups, borrowed
tails, the English names in the library, and the sheet-3 names.


- **For the user to touch up by hand later**: t1 3 (kaf: barb and tail tip
  to match the alif's barb and the other tails), t2 1 (standalone ha).
- **Incomplete, borrow from a later tracing**: t2 24 (standalone sad, tail
  cut off where it ran into the ط).

## In the app's mark library

Approved pieces go into the *Thuluth* group of the mark library.
`scripts/marks/traceMarks.py` reads them from the saved review trace (its
`TRACED` table) and lists each approved one by name in `GROUPS`; nothing
else on a sheet is added.

| piece | name in the app | id | approved |
|---|---|---|---|
| t1 23 | Ha (ه) | `thuluth-t1-23` | 2026-10-17 |
| t1 25 | Lam (ل) | `thuluth-t1-25` | 2026-10-17 |
| t1 19 | Ta (ط) | `thuluth-t1-19` | 2026-10-17 |
| t1 2 | Small alif (ا) | `thuluth-t1-2` | 2026-10-17 |
| t1 15 | Small lam-alif (لا) | `thuluth-t1-15` | 2026-10-17 |
| t1 26 | Dal (د) | `thuluth-t1-26` | 2026-10-17 |
| t1 30 | Nun (ن) | `thuluth-t1-30` | 2026-10-17 |
| t2 2 | Ha body, shared by ha, jim and kha (ح) | `thuluth-t2-2` | 2026-10-17 |
| t2 10 | Joined starting meem (مـ) | `thuluth-t2-10` | 2026-10-17 |
| t2 12 | Ha, round (ه) | `thuluth-t2-12` | 2026-10-17 |
| t2 13 | Ha, round, second form (ه) | `thuluth-t2-13` | 2026-10-17 |
| t2 16 | Small lam-alif, second form (لا) | `thuluth-t2-16` | 2026-10-17 |
| t2 17 | Lam-alif, open (لا) | `thuluth-t2-17` | 2026-10-17 |
| t2 18 | Ya (ى) | `thuluth-t2-18` | 2026-10-17 |
| t2 19 | Wrapped ha (ح) | `thuluth-t2-19` | 2026-10-17 |
| t2 23 | Starting sad (صـ) | `thuluth-t2-23` | 2026-10-17 |
| t2 28 | Waw (و) | `thuluth-t2-28` | 2026-10-17 |
| t3 (21 pieces) | see `traceMarks.py` | `thuluth-t3-<n>` | 2026-10-17 (all of sheet 3 but 15 and 16) |
| t4 (16 pieces) | see `traceMarks.py` | `thuluth-t4-<n>` | 2026-10-17 (all of sheet 4) |
| t5 (20 pieces) | see `traceMarks.py` | `thuluth-t5-<n>` | 2026-10-17 (all of sheet 5 but 2, 4, 12) |
| outline 01 | Joined ending meem (ـم) | `thuluth-outline-01` | removed 2026-10-17: too small (size ignored the hat); left out for now |

Tip barbs (2026-10-17): the small barb at the top of an upright (sheet t1
pieces 19 and 25) is **part of the letter**, not a direction arrow. Keep it.
