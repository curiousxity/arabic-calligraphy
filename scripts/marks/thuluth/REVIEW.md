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
- Row 2, `thuluth-8-row2.png` (2026-10-16): "الباءات الأولية والوسطية
  والنهائية" (initial, medial and final behs): بلـ/بب-type runs, a long run
  of joined behs with measurement dots and a dotted circle, and a run like
  بلسة/تليمة with stroke-order numbers.
- Row 3, `thuluth-8-row3.png` (2026-10-16): one word, a run of joined behs
  ending in ة (416×152; drawn a little smaller — strokes ~18 px against ~24
  on the other rows, so its trace takes its own scale).

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
  الرحمن الرحيم kept on one level instead of stacked. It reads closer to
  Naskh than Thuluth: **script to confirm** before it goes in a Thuluth
  set. Clean, no guide lines.

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

Both signed "هاشم" and dated ١٣٧٥ (AH, about 1955). That points to Hashim
al-Baghdadi, whose "قواعد الخط العربي" teaches Thuluth with exactly this
kind of nuqta-measured sheet; **to confirm with the user** whether the
earlier sheets come from that book. Remove the signature and date from
both; never trace them.

- `thuluth-24-qalam-4.webp` (2026-10-16): "وإنك لعلى خلق عظيم" (al-Qalam
  68:4), a landscape panel: tall alifs and the ظ upright in a row, لعلى and
  خلق stacked in a deep curve underneath, the long kasra stroke under it.
  Small floral ornaments in all four corners. Verse marker "١٣" style
  numbers at the left.
- `thuluth-24-qalam-4-b.webp` (2026-10-16): **the same verse, "وإنك لعلى خلق
  عظيم", in a second layout**, black on light, no frame, ornament or
  signature: one line instead of the panel's deep curve, with the long
  saifi-like kaf stroke of لعلى rising across the top and خلق and عظيم
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
  layout read closer to **Naskh** than Thuluth — script to confirm. Small
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
