---
paths:
  - "src/lib/detachedMarks*.ts"
  - "src/components/DetachedMarkHoverHandles.tsx"
  - "scripts/measureDetachedMarks.mjs"
  - "e2e/detached-marks.spec.ts"
---

# Detached marks: dots, hamza and the kaf stroke (`src/lib/detachedMarks.ts`)

A letter's own dots, the hamza on أ إ ؤ ئ and the small stroke inside ك,
movable on text and Shape Fill blocks and split into rider pieces at stack
convert. Design: `docs/superpowers/specs/2026-10-14-free-marks-and-dots-design.md`;
plan: `docs/superpowers/plans/2026-10-14-free-marks-and-dots.md`.

**Detection is topological, not metric, and every rule was earned by a
probe.** The first predicate (bounding-box centre inside another contour,
size as a body fraction) passed 2 of 23 fonts. What ships:

1. **A counter is a contour most of whose vertices lie inside another.**
   Not the bbox centre: a jeem's own centre falls inside its dot, so the
   body was rejected and nothing was left. Winding is not used; the
   TrueType and CFF faces here disagree on it.
2. **The body is the touch-connected component of the largest contour**
   (`TOUCH_EPS_EM`). NotoSans draws the ط stem as a separate rectangle on
   the bowl; Lateef's final س tooth touches a piece that touches the body;
   Raqq's connectors are pieced. A dot never touches its letter.
3. **Size is an upper bound by body fraction *or* by absolute em area**
   (`MAX_MARK_FRACTION`, `MAX_MARK_EM_AREA`), plus a floor
   (`MIN_MARK_EM_AREA`, Yekan's medial ح carries a 5×11-unit speck). The em
   path exists because Amiri's hamza is 0.82 of its thin alif's box. Not a
   band round the nuqta: Ruqaa draws a dot pair as a dash and Gulzar's
   dots are nearly two nuqta wide.

**Two routes, one override shape.** Most fonts draw dots inside the
letter's outline; `mark` is the raw contour index. NotoSans, Ruqaa, Kufi2,
Qahiri, Gulzar and Urdu draw them as a separate zero-advance glyph — the
very glyph `findDiacriticGlyphIndices`' allowance gate refuses — admitted
here as a whole-glyph mark with `mark = -1 - n`, `n` its ordinal among
same-id glyphs in the cluster, sized **per contour** (Gulzar's three-dot
glyph is one glyph whose union is too big). A hamza the tashkeel detector
claims (fonts that decompose أ to alef + U+0654) stays a tashkeel; the
two tools together cover it.

**The gate was met, not accepted.** `scripts/measureDetachedMarks.mjs`
scores every bundled font against Unicode's dot counts, isolated and
joined. Zero false hits on undotted letters (>= 99% of cells) is the
gate; 18 of 23 clear it. The dotted half is reported, not gated — a miss
is a dot fused to its stem (Diwani ف, Ruqaa ن), and a count below
expected is a merged dot group, which is one movable mark. The five
pieced or decorative faces (Kufi2, Qahiri, RanaKufi, ThuluthDeco,
Wessam) are in `UNSUPPORTED_FONTS` by name rather than the bar loosened.
Numbers: `docs/archive/detached-mark-coverage.md` (the single home).

**Keyed like stroke cuts, stored in font units.** `cluster` + `glyphId`
checksum + `mark`; `dx`/`dy` are unscaled font units.
`buildDetachedMarkPlan` drops anything whose cluster, id or mark no longer
resolves. Tashkeel offsets are px at the block's size by history; the two
conventions are deliberate — do not unify them. `kashidaTextPatch` remaps
both on a tatweel insertion (`remapMarksForEdits` is the generic cut remap).

**Translate only.** No scale (removed-subsystems.md), no hide (a missing
dot changes the word). Double-click the handle resets.

**Order on text blocks: marks, then cuts, then warp.** The contour
translation is applied to the raw commands (raw contour indices), then
stroke-cut surgery, then the warp mapping, so a moved dot follows its
letter through the warp. That is the opposite order from the tashkeel
override, which is a ctx transform after the warp on a separate glyph. A
dot dragged across a cut line gets cut: accepted residue.

**The metrics loop boxes the moved outline** through `outlineBounds`, the
same branch cut glyphs take, so snapping and alignment see real ink.

**Shape Fill does the surgery once per glyph in `glyphCache`**, never per
tile; one override moves every repetition. Its `diacriticGlyphIndices`,
`detectedMarks` and `markPlan` memos sit **above** `glyphCache`, which
reads the plan — a `const` read before its declaration throws at runtime.
Arming widens the `glyphInstances` gate and pins the silhouette's drag,
as the diacritic tool does.

**Detection runs over the whole run only while armed**; otherwise only over
glyphs carrying an override (`glyphIndicesWithOverrides`). It is
point-in-polygon work per contour pair.

**Overlay order:** alternates, stroke cuts, detached marks, tashkeel.
Handlers on the per-placement `Group`, never the `Rect` (diacritics.md).
The drag baseline is the handle's rest position, not Konva's dragstart
position, which fires a few px in.

**At stack convert** detected marks leave the letter's commands before any
cut and become `role: "mark"` pieces with `parentId` the letter
(`d<index>-<k>` ids), at their moved position. The join sweep therefore
runs on the body only — which is why Amiri's مصبح now joins all three
pairs where it joined one: the ب's dot straddled the join edge and made the
cut illegal. Convert refuses the tatweel retry when the block has mark
overrides, for the same reason as tashkeel.
