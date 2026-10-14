# Free movement of tashkeel and nuqtas — design

**Date:** 2026-10-14
**Status:** approved in conversation; awaiting written review
**Scope:** text and Shape Fill blocks (live), and the stack convert path.
Text-on-path stays out, as it is for every per-glyph tool.

## Goal

Compose like a calligrapher: put a letter's dots and the vowel marks where
the composition wants them, including stacked, tucked or overlapped
positions. The user set the purpose explicitly ("compose like a
calligrapher", not collision fixes and not traditional placement rules), so
a drag is a free nudge with no snapping and no per-font placement table.

Two jobs, different sizes:

1. **Tashkeel sideways.** Vowel marks already move vertically, resize and
   hide. Adding horizontal movement is a widening of the existing override.
2. **Nuqtas and other detached marks.** New. A letter's dots, the hamza on
   أ إ ؤ ئ, and the small stroke inside ك become movable on live text,
   and become their own pieces when the block is converted to a stack.

The user chose the largest scope: everything movable on live text blocks,
not only after converting to a stack.

## Decisions already made

- **Translate only.** Dots and detached marks move; they never scale and
  never rotate. Scaling a letterform or a piece of one was removed on
  2026-10-10 for distorting pen weight (removed-subsystems.md), and a dot
  is one pen touch whose size *is* the nib. Tashkeel keep their existing
  scale handle because that shipped and was not objected to.
- **No hide for dots.** Hiding a dot changes the word. Tashkeel keep their
  hide button.
- **Detached marks include the hamza and the kaf stroke.** The user chose
  this over a dots-only shape filter, which would be one more predicate to
  get wrong.
- **Detection is topological, not metric.** See "Identifying a detached
  mark". The stroke-cut history (stroke-cuts.md) is the cautionary tale: a
  size predicate that looks reasonable on dots also admits counters and
  flourishes.
- **A numeric coverage gate is measured offline before the canvas tool is
  wired.** Unicode fixes how many dots every letter carries, so the
  detector can be scored exactly, per font, with no human judgement.

## Part one: tashkeel sideways

`DiacriticOverride` gains `offsetX?: number`, in the same units as
`offsetY` (local px at the block's font size). Default 0, so every old save
renders byte-identically and no payload version bump is needed.

Consumers, each of which reads `offsetY` today and must read `offsetX`
too (enumerated by grep; this list is the checklist):

- `ShapedText.tsx` `drawWarpedGlyphRun`: `ctx.translate(offsetX, offsetY)`.
- `ShapeFillText.tsx` tile loop: the same translate, before the tile's
  deformation as today.
- `DiacriticHoverHandles.tsx`: `displayX = cx + offsetX`; the hit rect,
  the three handle positions and the resize distance all use `displayX`.
- `stackConvert.ts` `runOutline` and the mark-piece loop: `x: m.px +
  offsetX * scale`.
- `blockRenderProps.ts` already passes the whole `diacriticOverrides`
  array, so mirrors need no change.

**The move handle drags freely.** Today its `dragBoundFunc` projects onto a
vertical rail captured at drag start. The rail goes; the drag reads both
`local.x - cx` and `local.y - cy` and patches `offsetX` and `offsetY`
together. Holding Shift restores the vertical rail (the same
`projectOntoAxis` call, now conditional), so a user who wants the old
behaviour has it. The existing e2e test asserts a downward drag lands as
`offsetY > 5`, which still holds.

"Reset diacritic overrides" already clears the whole override, so it
clears `offsetX` for free.

## Part two: detached marks on live text

### Identifying a detached mark

A glyph's outline is a list of closed contours. `toSegments` in
`stackGeometry.ts` already splits a path into per-contour segment lists
without flattening the curves; it is the splitter here. (`flattenContours`
in `strokeCuts.ts` is not: it loses the curves, and the moved contour must
be drawn, not only measured.)

A contour is a **detached mark** when all of the following hold:

1. **Its centre lies inside no other contour of the same glyph.** A counter
   (the hole in و, م, ه, ص, ف, ق) is also small and compact, and this is
   the only test that separates it from a dot. The test is point-in-polygon
   of the contour's bounding-box centre against each other contour,
   flattened. Winding direction is not used: TrueType and CFF fonts in
   `public/fonts/` use opposite conventions, and a winding test would need
   per-font knowledge.
2. **It is not the body.** The body is the contour with the largest
   bounding-box area that is itself inside no other contour. Everything
   else that passes rule 1 is a candidate. A glyph with one outer contour
   has no detached marks.
3. **It is small relative to the body.** Its bounding-box area is at most
   `MAX_MARK_FRACTION` of the body's bounding-box area. This is an upper
   bound, not an equality to the nuqta table: Ruqaa draws a dot pair as one
   dash and Gulzar's dots are nearly two nuqta wide, so a tolerance band
   around one nuqta would miss real marks. The fraction is tuned by the
   gate below, starting at 0.35.

What this admits beyond dots: the hamza on أ إ ؤ ئ, the kaf stroke, the
madda on آ, and a detached tail or flourish in a decorative face. The first
three are wanted. The last is what the gate's zero-false-hit half guards
against on undotted letters; a flourish on a dotted letter is accepted as a
known residue if the gate reports one.

What it cannot do: split a dot that the font draws fused to the body (a
dash dot touching a stem, or a Qahiri style where dots are part of the
stroke). Those letters simply have no movable mark; no error, no handle.

**Fonts whose dots are separate glyphs** (NotoSans, Ruqaa, Kufi2, Qahiri)
take a second route. `findDiacriticGlyphIndices` deliberately refuses a
zero-advance glyph whose cluster has no combining character behind it, so
its hide button cannot erase a dot. The new detector admits exactly that
leftover: a zero-advance glyph in a cluster with a base, not taken by the
tashkeel detector, whose own outline consists only of contours passing
rules 1 to 3 against the *base* glyph's body. That glyph is a detached mark
as a whole, keyed by its own glyph index rather than a contour index. The
one base letter known to carry a GPOS offset in such a cluster (NotoSans
reh with `dx = -30`) carries advance, so it never reaches this route.

The detector lives in a new pure module `src/lib/detachedMarks.ts`. It
imports from `stackGeometry.ts`, `strokeCuts.ts` (`outlineBounds`,
`toSvgCmds`) and `svgPath.ts` (`pointInPolygon`), and **must not import
`./harfbuzz`** so its tests can shape real text through the `shapeReal`
helper `diacritics.test.ts` established.

### The coverage gate

`scripts/measureDetachedMarks.mjs`, beside `measureStrokeZones.mjs`,
imports the real detector and scores every bundled font. For each letter
in a fixed table of expected counts, it shapes the letter in isolated,
initial, medial and final forms and compares detected marks to expected:

| expected | letters |
|---|---|
| 0 | ا د ر س ص ط ع ك* ل م ه و ح |
| 1 | ب ج خ ذ ز ض ظ غ ف ن |
| 2 | ت ق ي |
| 3 | ث ش |
| 1 (hamza) | أ إ ؤ ئ ء-on-seat |

`*` ك counts 1 where the font draws the kaf stroke detached, 0 where it is
fused; the script reports it separately rather than scoring it.

Two halves, both numeric, both recorded in `docs/archive/` the way
`stroke-zone-coverage.md` is:

- **Dotted letters:** detected is between 1 and expected on at least 95%
  of (letter, form, font) cells across the bundled fonts. Many faces draw
  ث's three dots or ت's two as one merged contour; that is one movable
  mark, which is what a composer wants, so it passes. The script counts
  merges separately so the archive records which fonts do it.
- **Undotted letters:** zero detections on at least 99% of cells. This is
  the half that matters. A false hit here is a handle on a piece of a
  letter's body, and dragging it tears the letter.

A font that fails the second half is listed by name as unsupported for the
tool, and the detector returns nothing for it (a per-font opt-out table,
same shape as `NIB_FLOOR_RATIO`), rather than the bar being loosened. The
stroke-cut gate was accepted rather than met once, with the reasoning
written down; this gate has a cheaper escape, so it is met.

The gate runs and its numbers are in the archive **before** any of the
canvas work in the plan starts. A predicate failure is found at the script.

### Storage

```ts
export type DetachedMarkOverride = {
  /** HarfBuzz cluster of the base letter, not a glyph index. */
  cluster: number;
  /** The base glyph's id when the override was made: a checksum. */
  glyphId: number;
  /**
   * Which mark on that glyph. For a contour-route mark, the contour's raw
   * index in the glyph's path (>= 0). For a separate-glyph-route mark,
   * `-1 - n` where `n` is the mark glyph's ordinal among glyphs in its
   * cluster with the same glyph id, so two identical dot glyphs stay
   * distinct and the two routes never collide.
   */
  mark: number;
  /** Translation in unscaled font units. */
  dx: number;
  dy: number;
};
```

on `BlockCommon` as `detachedMarkOverrides?: DetachedMarkOverride[]`, plus
`detachedMarkEditMode?: boolean` to arm the handles. Both optional, no
payload bump, and `stripRemovedFields` is not involved.

Why this keying and not the tashkeel one:

- **Cluster plus glyph-id checksum** is what stroke cuts use, and it
  survives a re-shape that changes the glyph count where a glyph index does
  not. `buildCutPlan` matches on both together because a cluster can hold
  several glyphs; the mark resolver does the same.
- **Raw contour index** is stable per glyph id. A sort by position is not,
  once two dots on the same letter have been moved past each other.
- **Font units**, like `StrokeCut.localX`, so a font-size change scales the
  offset. Tashkeel offsets are in px at the block's size for historical
  reasons; the two conventions are stated here so the next reader does not
  "fix" one to match the other.

Resolution each render: `buildDetachedMarkPlan(overrides, glyphs, font,
shapableText)` returns, per glyph index, the list of `(markIndex, dx, dy)`
whose cluster and glyph id still match and whose mark index still resolves
to a detected mark. Anything else is dropped silently, the same guard
`ShapedText` already applies to stale tashkeel overrides.

Kashida coexistence: cluster keys shift when a tatweel is inserted, so
`kashidaTextPatch` in `App.tsx` remaps `detachedMarkOverrides` alongside
`strokeCuts`, through the same `remapCutsForEdits`-shaped helper. This is
the rule stroke-cuts.md states: any handler inserting tatweel owes a remap of
everything keyed by a text offset, paid in one place.

### Drawing

`drawWarpedGlyphRun` in `ShapedText.tsx` already rebuilds a glyph's
commands when it has cuts. The plan for the glyph, if any, is applied in
the same place: split with `toSegments`, translate the chosen contours by
`(dx, dy) * scale`, rejoin with `fromSegments`. **This happens before the
warp mapping**, so a moved dot follows its letter through `warpX`/`warpY`.
That is the opposite of the tashkeel override, which is a `ctx` transform
applied after the warp; tashkeel are separate glyphs positioned by GPOS and
the ctx transform was the simplest correct thing, whereas a dot contour is
part of the letter's own path and must be warped with it or it detaches.

The separate-glyph route translates the whole mark glyph by `ctx.translate`
before its draw, exactly as the tashkeel override does, since it is its own
glyph.

Fill rule: canvas fills nonzero by default, so a moved dot overlapping its
own body unions with it rather than punching a hole.

`ShapeFillText.tsx` does the same surgery once per glyph id in its glyph
preparation, never per tile; the tile loop draws the prepared commands. An
override is keyed by cluster, so one moved dot moves in every tiled
repetition, exactly as a tashkeel override does there today.

Stroke-before-fill order is untouched; the surgery happens before either.

### Measurement

The metrics loop in `ShapedText` must box the *moved* outline. It already
does this for cut glyphs through `outlineBounds` rather than asking
opentype.js for the original box; a glyph with mark overrides takes the same
branch. Otherwise snapping, alignment and Fit to width keep measuring the
un-moved ink. `fitToWidth` needs no new term: a translation changes no
advance.

### The overlay

A new `DetachedMarkHoverHandles.tsx`, mounted between
`StrokeCutHoverHandles` and `DiacriticHoverHandles` (largest to smallest, as
e2e-tests.md requires: stroke rail, then mark, then dot). It takes
`DetachedMarkPlacement[]`, one per detected mark instance: the mark's
current box in the renderer's local space plus the same
`toCanvas`/`toLocal` adapter pair `diacriticPlacement.ts` defines, so the
Shape Fill tile adapter is reused unchanged.

One handle, the move handle, in a new colour. Hover handlers on the
per-placement `Group`, not the hit `Rect`, for the Konva leave race
diacritics.md records. Drag start calls `onBeginDetachedMarkDrag`
(`pushHistory`); drag move patches `(dx, dy)` in font units through
`toLocal` and the font scale; the drag is one undo step. Double-click on the
handle resets that mark to `(0, 0)`.

Arming: like stroke cuts and like Shape Fill's diacritic tool, a checkbox
"Move dots & marks" in the type panel sets `detachedMarkEditMode`, because
detection walks every glyph's contours with point-in-polygon tests and
should not run on every text block all the time. `supportsDetachedMarks` in
`blockCapabilities.ts` gates the checkbox and the three mutators together,
text and Shape Fill only. A "Reset dots & marks" button clears the list.

### Stack convert

`convertRunToStack` runs the detector on each placed letter. Every detected
mark is split out of the letter's commands and becomes a `StackPiece` with
`role: "mark"`, `parentId` the letter, same `order`, placed at its
overridden position. The letter piece keeps the remaining contours. From
there it is an ordinary rider: draggable alone, carried with its letter,
and chainOf already treats it so. Separate-glyph dots already arrive as mark
pieces today (`kind: "mark"` on zero advance), so only their override offset
is new.

Convert's refusal when the block has diacritic overrides and a fallback
tatweel is needed extends to `detachedMarkOverrides` for the same reason
(the insertion shifts cluster offsets; the remap exists but the retry path
re-shapes from scratch and the simplest safe thing is to refuse, as today).

### What is deliberately not in scope

- Rotation of a dot or mark. A translate is what was asked for.
- Snapping a dot to a traditional position. Purpose was set as free
  composition.
- Text-on-path. Per-glyph drag tools are deferred there for the open
  question of what an offset means along a curve.
- Splitting fused dots. A font that draws the dot touching the stem has no
  movable dot in it.
- Square kufi dots. A different design problem (square-kufi.md).

## Per-font nuqta table

`measureNuqta.py` was run on the eight fonts added since the archive. The
detector does not need the nuqta (size is a fraction of the body), but the
table is the project's unit and the stack's `nib.width` provenance reads it,
so the plan extends `NUQTA_RATIO` with the measured values and records the
run in `docs/archive/nuqta-measurements.md`:

| font | dot/em | note |
|---|---|---|
| HarfCanvasDiwani | 0.0586 | both methods agree |
| UKIJDiwani | 0.1172 | agree |
| Rabat | 0.0920 | agree |
| Blaka | 0.1670 | agree |
| Gulzar | 0.1890 | agree |
| Raqq | 0.0750 | modal only; alif/dot 11.3, check by hand |
| Ruqaa | 0.1530 vs 0.1200 | methods disagree, check by hand |
| RanaKufi | 0.1000 vs 0.2500 | methods disagree, check by hand |

The three flagged rows stay on `FALLBACK_RATIO` until someone looks.

## Testing

- `detachedMarks.test.ts`: real fonts through `shapeReal`. Pins the
  counter case (و and م yield no marks in every font), the three-dot case
  (ث yields three, each outside the body), the hamza case, and the
  separate-glyph route on NotoSans (ف's dot is admitted here and still
  refused by `findDiacriticGlyphIndices`). Each test is checked to fail
  against the variant it rules out: drop rule 1 and و gains a mark.
- `buildDetachedMarkPlan` tests: a stale glyph id drops the override; a
  tatweel insertion remaps the cluster.
- `stackConvert.test.ts`: a letter with a moved dot converts to a letter
  piece plus a mark piece at the moved position; the assembled outline's
  bounds match the text block's.
- `scripts/measureDetachedMarks.mjs` output archived as
  `docs/archive/detached-mark-coverage.md`, the single home for the
  numbers, as stroke-zone-coverage.md is for cuts.
- e2e: `e2e/detached-marks.spec.ts` arms the tool on ثبت in the default
  font, hovers a dot, drags its handle diagonally and asserts an override
  with both `dx` and `dy` nonzero, plus the every-other-frame hover check
  the other overlays carry. The tashkeel test gains a diagonal drag
  asserting `offsetX` nonzero and a Shift-drag asserting it is zero.

## Documentation

A new `.claude/rules/detached-marks.md` with `paths:` covering
`src/lib/detachedMarks*.ts`, the overlay, and the e2e spec, holding the
detector's rules, the two keying conventions and the warp-order decision.
One line in CLAUDE.md's subsystem index. diacritics.md gains a paragraph on
`offsetX` and the Shift rail. deferred-features.md's "Free movement of
nuqtas and diacritics" entry is replaced by a pointer. PROGRESS.md gets the
ship line and any residue the gate reports.
