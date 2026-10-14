# Detached-mark detection coverage

The single home for these numbers; `.claude/rules/detached-marks.md` only
summarises. Produced by `scripts/measureDetachedMarks.mjs` on 2026-10-14
with `MAX_MARK_FRACTION = 0.35`, `MAX_MARK_EM_AREA = 0.07`,
`MIN_MARK_EM_AREA = 0.001`, `TOUCH_EPS_EM = 0.01`, before the opt-out list
was applied (so the numbers are the detector's own).

**Gate: undotted letters yield zero detections on >= 99% of (letter, form)
cells.** That is the half that matters — a false hit is a handle on a piece
of the letter's body, and dragging it tears the letter. A font failing it
is listed in `UNSUPPORTED_FONTS` by name rather than the bar being
loosened. The dotted half (1 <= detected <= expected) is reported, not
gated: a miss there is a dot the font draws fused to its stem, which has no
handle and harms nothing. A detected count below expected is a merged dot
group (two or three dots as one contour), which is one movable mark and is
what a composer wants; "merged" counts those cells.

Hamza rows (أ إ ؤ ئ) also count a U+0654/U+0655 glyph that
`findDiacriticGlyphIndices` claims as a tashkeel: several fonts decompose
these letters, and the hamza is then movable through the tashkeel handles.

| font | dotted % | undotted % | merged groups | kaf stroke | result |
|---|---|---|---|---|---|
| AlFatemi | 100.0 | 100.0 | 0 | 1 | pass |
| Amiri | 100.0 | 100.0 | 20 | 1 | pass |
| Blaka | 100.0 | 100.0 | 8 | 1 | pass |
| FatemiMaqala | 100.0 | 100.0 | 0 | 1 | pass |
| Gulzar | 100.0 | 100.0 | 20 | 0 | pass |
| HarfCanvasDiwani | 92.1 | 100.0 | 17 | 0 | pass |
| Kufi | 100.0 | 100.0 | 0 | 1 | pass |
| Kufi2 | 93.4 | 93.8 | 18 | 0 | opted out |
| Lateef | 89.5 | 100.0 | 0 | 1 | pass |
| NotoSans | 100.0 | 100.0 | 20 | 1 | pass |
| Qahiri | 96.1 | 91.7 | 16 | 0 | opted out |
| Rabat | 100.0 | 100.0 | 4 | 0 | pass |
| RanaKufi | 90.8 | 89.6 | 19 | 0 | opted out |
| Raqq | 100.0 | 100.0 | 20 | 0 | pass |
| Ruqaa | 89.5 | 100.0 | 14 | 0 | pass |
| Scheherazade | 100.0 | 100.0 | 20 | 1 | pass |
| TahaNaskhRegular | 100.0 | 100.0 | 20 | 1 | pass |
| Thuluth | 97.4 | 100.0 | 0 | 1 | pass |
| ThuluthDeco | 3.9 | 4.2 | 0 | 4 | opted out |
| UKIJDiwani | 100.0 | 100.0 | 20 | 1 | pass |
| Urdu | 100.0 | 100.0 | 20 | 0 | pass |
| Wessam | 90.8 | 91.7 | 20 | 0 | opted out |
| Yekan | 100.0 | 100.0 | 0 | 1 | pass |

18 of 23 bundled fonts pass. The kaf column is 1 where the font draws the
kaf stroke detached (movable) and 0 where it is fused.

## Residue on passing fonts

Each is a dot the font draws fused to the body (`0/n`), except Lateef's
hamza rows (`2/1`): its ؤ and ئ are precomposed glyphs whose hamza is drawn
as **two non-touching contours** (head and hook), each admitted as a mark,
so the user gets two handles on one hamza and can pull it apart. That is
over-detection on a dotted letter, which the gate does not score; a
bounding-box-overlap merge of candidates would fold it into one mark
(deferred).

- **HarfCanvasDiwani** dotted 92.1%: `ف:0/1 ن:0/1 ـن:0/1 ق:0/2 ـق:0/2 ـي:0/2`
- **Lateef** dotted 89.5%: `ؤ:2/1 ؤـ:2/1 ـؤـ:2/1 ـؤ:2/1 ئ:2/1 ئـ:2/1 ـئـ:2/1 ـئ:2/1`
- **Ruqaa** dotted 89.5%: `ن:0/1 ـن:0/1 ق:0/2 ـق:0/2 ثـ:0/3 ـثـ:0/3 شـ:0/3 ـشـ:0/3`
- **Thuluth** dotted 97.4%: `ي:0/2 ـي:0/2`

## Opted out (`UNSUPPORTED_FONTS`)

All five build letters from pieces that do not touch — Kufi2, Qahiri and
RanaKufi from cells, ThuluthDeco from decorative segments, Wessam with a ط
stem floating 0.022 em above its bowl — so a piece of the body is
indistinguishable from a dot. The detector returns nothing for them; the
tashkeel handles still work.

- **Kufi2** — undotted 93.8%: `ـس:3 ـه:2 ـحـ:1 ـجـ:2/1 ـخـ:2/1 ـفـ:2/1 ـف:3/1 ـش:4/3`
- **Qahiri** — undotted 91.7%: `س:4 سـ:2 ـسـ:4 ـس:4 ش:5/3 ـشـ:5/3 ـش:5/3`
- **RanaKufi** — undotted 89.6%: `د:1 دـ:1 ـدـ:1 ـد:1 ـع:2 ذ:2/1 ذـ:2/1 ـذـ:2/1`
- **ThuluthDeco** — undotted 4.2%: `ـاـ:3 ـا:3 د:4 دـ:4 ـدـ:6 ـد:6 ر:2 رـ:2`
- **Wessam** — undotted 91.7%: `ط:1 طـ:1 ـطـ:1 ـط:1 ظ:2/1 ظـ:2/1 ـظـ:2/1 ـظ:2/1`

## What the rules fixed, in order

The first predicate (bounding-box centre inside another contour, size as a
body fraction) passed 2 of 23. Each rule below was added after a probe of
a specific miss, not by loosening a number:

1. **Containment by vertex majority, not bbox centre.** A jeem's own centre
   falls inside its dot, so the body was rejected and nothing was left.
2. **An absolute em-area admission path.** Amiri's hamza is 0.82 of its
   thin alif's box; no body fraction admits it without admitting a
   two-stroke letter's smaller half.
3. **Per-contour sizing on the separate-glyph route.** Gulzar and Urdu
   put a whole dot group in one zero-advance glyph whose union is too big.
4. **Touch components.** NotoSans draws the ط stem as a separate
   rectangle on the bowl; Lateef's final س tooth touches a piece that
   touches the body. Anything touch-connected to the largest contour is
   body.
5. **A minimum area.** Yekan's medial ح carries a 5×11-unit speck.
