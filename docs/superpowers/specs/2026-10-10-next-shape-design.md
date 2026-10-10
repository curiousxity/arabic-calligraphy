# Next Shape — per-letter alternate glyphs

Date: 2026-10-10. Status: design, awaiting review.

## Goal

Let a calligrapher click a letter on a text block and step through the
alternate shapes its font already contains — Kelk's "Next Shape" tool, built
on OpenType rather than on a proprietary variant library.

**Success:** on a Ruqaa block, clicking ه cycles default → Looped Haa → Open
final Haa (where the context allows) → default, each step one undo entry; the
sidebar shows the same options as labelled thumbnails; a save round-trips the
choice; Fit to width and snapping measure the alternate, not the default.

**What the user said:** per letter, not block-level toggles. Don't join
non-joining letters (no "Join Alef"). Whole-glyph scaling is out — it was
removed for distorting letters (`.claude/rules/removed-subsystems.md`).

**Assumed, open to correction:** text blocks only in v1; a letter carries at
most one alternate at a time.

## Background: where the shapes come from

OpenType fonts keep optional glyphs behind feature tags HarfBuzz applies only
when asked. `shapeText` currently asks for none (`harfbuzz.ts`
`hb.shape(font, buffer)`). The bundled fonts hold a modest pool — Ruqaa
(`ss01`–`ss08` named sets, `jalt` on 25 letters), Amiri (`ss01`–`ss08`),
Qahiri (`salt`, `ss01`, `ss02`), AlFatemi (`aalt`), Lateef and Scheherazade
(`salt`, many `cvNN`), Wessam (`jalt`), Yekan (`salt`, `swsh`), FatemiMaqala
(`ss01`, `ss02`). Thuluth, ThuluthDeco, HarfCanvas Diwani and Taha Naskh have
none, and the tool will say so.

Verified with the bundled harfbuzzjs (`hbjs.js` passes each comma-separated
feature to `hb_feature_from_string`): on Ruqaa `هههه`, `ss01[1:2]=1` changes
only the glyph at cluster 1 (`369 → 345`) while a global `ss01` also changes
cluster 2 — ranged features are per-letter.

## Approach

**Discovery by probing HarfBuzz**, chosen over parsing GSUB lookups ourselves
(more code, and misses context-dependent alternates) and over swapping glyph
ids after shaping (keeps the old glyph's advance and anchors — wrong
spacing). For a target letter: list the face's GSUB feature tags
(`face.getTableFeatureTags("GSUB")`), keep the optional ones, reshape the run
with each `tag[start:end]=value` (values 1–4 for `salt`/`aalt`/`jalt`/`swsh`,
1 otherwise), and keep each result whose glyph at that cluster differs from the
default, de-duplicated by resulting glyph id. Features that don't touch the
letter (Amiri's localised `@`) fall out by themselves.

Optional tags considered: `salt`, `aalt`, `jalt`, `swsh`, `ss01`–`ss20`,
`cv01`–`cv99`. Never probed: anything HarfBuzz applies by default for Arabic
(`init`, `medi`, `fina`, `isol`, `rlig`, `calt`, `liga`, `ccmp`, `mark`,
`mkmk`, `curs`, …).

## Data

```ts
// types.ts
export type GlyphAlternate = {
  /** Index among the text's *letters*: UTF-16 positions, skipping tatweel
   *  (U+0640) and combining marks. */
  letter: number;
  /** The character found there when the choice was made — a checksum. */
  char: string;
  feature: string; // "ss01", "salt", "jalt", …
  value: number;   // 1 for on/off features; alternate index for salt/aalt/…
};
// BlockCommon
glyphAlternates?: GlyphAlternate[];
glyphAlternateMode?: boolean; // arms the canvas tool
```

**Why a letter ordinal and not a text offset.** Stroke cuts key by text
offset and pay for it with a remap through `kashidaTextPatch` on every tatweel
insertion. Kashida and Fit to width only ever insert tatweel, and stripped
diacritics only ever remove marks; an ordinal that skips both is unchanged by
all three, so this field needs **no remap anywhere**, and Fit to width's
candidate measurements see the right alternates for free. The cost is the
same glyph-index fragility diacritic overrides already have under *typed*
edits before the letter; `char` turns the worst case (the alternate landing
on a different character) into a drop instead of a misapplication.

Absent field = default shapes: old saves render byte-identically, no payload
version bump.

## Units

- **`src/lib/glyphAlternates.ts`** — pure, no `./harfbuzz` import (Vitest
  can't load harfbuzzjs statically). `letterOffsets(text): number[]` (letter
  ordinal → UTF-16 offset); `featureStringFor(text, alternates): string` →
  `"ss01[5:6]=1,jalt[9:10]=2"`, dropping entries whose `char` no longer
  matches; `OPTIONAL_FEATURE_TAGS` and `isOptionalFeature`;
  `cycleAlternate(options, current, direction)`; `setAlternate(list,
  letter, choice | null)`.
- **`src/lib/fontFeatureNames.ts`** — pure. `readFeatureNames(bytes:
  ArrayBuffer): Map<string, string>` reads GSUB FeatureParams `UINameID` and
  resolves it in the `name` table (opentype.js parses neither; verified it
  exposes `featureParams` only as a bare offset). Ruqaa must yield
  `ss01 → "Looped Haa"`. Fallback labels when a font has no names: "Style set
  N", "Alternate N", "Justification", "Swash".
- **`harfbuzz.ts`** — `shapeText(text, fontUrl, alternates?)`: builds the
  feature string against `shapableText` *after* diacritic stripping (the
  buffer's clusters index that string, which is why the ordinal skips marks),
  passes it to `hb.shape`, and adds it to the cache key. New
  `findAlternates(text, fontUrl, alternates)` → per letter, the option list
  `{ feature, value, glyphId, label }[]` with the default first; results
  cached by `text|fontUrl|features`. Each letter is probed with the *other*
  letters' current alternates applied, so contextual alternates see their
  real neighbours.
- **`useShapedGlyphs(text, fontFamily, alternates?)`** threads the field
  through. **`useGlyphAlternates(block, armed)`** runs `findAlternates` only
  while the tool is armed and exposes the per-letter options.
- **`measureShapedRun` / `measureShapedWidth`** gain the same optional
  argument; App's Fit to width and placement measurements pass the block's
  `glyphAlternates`.
- **`AlternateHoverHandles.tsx`** — overlay in `ShapedText`, mounted
  **first** (glyph-sized rects, so before the stroke rail and the mark
  handles; Konva routes to the topmost listening shape). Hover outlines a
  letter only if it has options. Hover handlers on the per-letter `Group`, not
  the hit `Rect` (the sibling-hover race in `e2e-tests.md`). Click → next,
  Shift-click → previous; both call `onPickAlternate(letter, choice)`, and a
  click also makes that letter the one the sidebar strip shows, so picking
  from the strip after a click edits the same letter.
- **Sidebar → Typography → "Alternate letter shapes".** Checkbox (gated on
  `supportsGlyphAlternates`, text only, in `blockCapabilities.ts`); for the
  last letter clicked, a strip of thumbnails — default first, the current one
  marked, each labelled. Thumbnails are SVG paths from opentype.js
  (`glyph.getPath(...).toPathData()`). "No alternate shapes in this font"
  when the font has none, "This letter has no alternates" when the letter has
  none. "Reset letter shapes" clears the field.
- **`App.tsx`** — `pickGlyphAlternate(blockId, letter, choice)` calls
  `pushHistory()` then writes through `setAlternate` (discrete, so no
  debounce); `toggleGlyphAlternateMode`; `resetGlyphAlternates`. The
  last-clicked letter is UI state in App, not document state.
- **`blockRenderProps.ts`** carries `glyphAlternates` for text, so mirrors
  draw the alternates.

## Interactions with existing per-letter edits

- **Stroke cuts** are checksummed by `glyphId`, so changing a letter's shape
  drops a stretch on that letter — correct, since the cut was made for the
  old outline. The sidebar strip says so when the letter carries one.
- **Diacritic overrides** key by glyph index. An alternate that is a
  ligature (Amiri `ss02`, medial meem + final alef) changes the glyph count
  and can shift overrides after it; they are re-validated each render and
  drop rather than misapply. Accepted, documented.
- **Kashida / Fit to width:** unaffected by construction (see Data). A
  tatweel next to a letter can change its contextual form, and an alternate
  may then no longer apply; it stays stored and silently takes effect again
  if the form returns.
- **Export** renders from the stage, so PNG/JPEG/SVG/PDF get alternates for
  free. The **practice sheet** keeps ignoring per-letter edits (its v1 rule),
  as does `nameDesign`'s run measurement.

## Also in this change

`arabicJoining.ts` classifies ZWJ (U+200D) as non-joining; per Unicode it is
join-causing. Fix with a test.

## Testing

Unit tests use real harfbuzzjs and real fonts (`diacritics.test.ts`'s
`shapeReal` helper) wherever shaping is involved:

- `findAlternates` on Ruqaa `ه` finds `ss01`; on `س` finds `jalt`; on Thuluth
  finds nothing; options are de-duplicated (Ruqaa `jalt=1` and `jalt=2` give
  the same glyph → one option).
- A ranged feature changes only the target letter's glyph.
- `letterOffsets` / `featureStringFor`: tatweel and marks skipped; a
  kashida-inserted string yields the same feature ranges on the same letters;
  a `char` mismatch drops the entry.
- `readFeatureNames(Ruqaa)` → `ss01: "Looped Haa"`, `ss03: "Tailed Noon"`.
- `shapeText` cache: same text, different alternates → different results.
- `cycleAlternate` wraps both directions.
- e2e `e2e/glyph-alternates.spec.ts`: Ruqaa block, arm, click a ه → ink
  changes and `glyphAlternates` has one entry; Ctrl+Z restores it; a
  Thuluth block shows the no-alternates message; hover stays mounted on
  alternate moves (the every-other-frame check the other overlays have).

## Out of scope

Shape Fill and text-on-path (deferred: their renderers would pick up the
alternates, but the overlays need their own coordinate work); block-level
named-set toggles; joining non-joining letters; drawing new alternates into
HarfCanvas Diwani.

## Docs

New `.claude/rules/glyph-alternates.md` with `paths:` for the new modules and
overlay, one line in CLAUDE.md's subsystem index, a guide section for
calligraphers, a PROGRESS entry, and a README feature line.
