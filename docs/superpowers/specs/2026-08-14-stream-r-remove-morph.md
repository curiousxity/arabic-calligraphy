# Stream R — Remove the Morph Glyph Editor subsystem

Branch: `stream/r-remove-morph`. Runs **alone** — no parallel streams until
this merges. Read `2026-08-14-program-overview.md` first.

## Decision being implemented

The Morph Glyph Editor panel and its entire engine are removed: the Stretch
tool, stroke schemas, spine tables, glyph rigs, join pins, nuqta snapping,
the Kashida dial, Fit width, and By-stroke/Lasso mask editing. Rationale:
the stack's core promise (strokes that extend) was measured inert — the
kashida dial does not widen a run, ~86% of authored zones have no handle in
a given font, and strokes that do stretch deform instead of extending. The
user chose removal over continued repair; tatweel-based elongation (Phase 1
stream D) replaces the elongation story with one that works.

**What survives, explicitly:**

- **Per-glyph move & scale** (`lib/glyphTransform.ts`,
  `GlyphTransformHoverHandles.tsx`) — its arming checkbox ("Move & scale
  glyph") currently lives inside `MorphGlyphEditor.tsx` and must be
  **relocated to the Typography panel** in `Sidebar.tsx` before the panel is
  deleted.
- **Diacritic overrides** (`lib/diacritics.ts`, `lib/diacriticPlacement.ts`,
  `DiacriticHoverHandles.tsx`) — untouched, including the Shape Fill
  "Diacritic tool" checkbox.
- **Warp** (`lib/warp.ts`) — untouched.
- **`lib/arabicJoining.ts` + its test** — its only current consumer is the
  doomed `strokeSchema/glyphLookup.ts`, but Phase 1's tatweel stream needs
  it. Keep it even though it goes temporarily consumer-less.
- **`projectOntoAxis`** — currently in `lib/strokeSchema/dragAxis.ts`,
  imported by the two *surviving* hover-handle components. **Relocate** it
  (and the relevant part of `dragAxis.test.ts`) to a new `src/lib/dragAxis.ts`
  before deleting the `strokeSchema/` directory. Do not reimplement it.
- **Offline scripts** (`scripts/measureNuqta.py`, `deriveStrokeSpines.py`,
  `auditSpineOrientation.py`, `renderFontSample.py`, `mergePuaGlyphs.py`,
  `FONTS.md`) — scripts are inert; they stay as the "don't redo the work"
  insurance alongside `docs/archive/nuqta-measurements.md`.

## Archive first (order matters)

`docs/archive/nuqta-measurements.md` already exists and carries the measured
nuqta table. Before deleting anything, fill in its **pre-removal SHA**
placeholder with the SHA of the current `main` HEAD (the parent of your
removal commits). That SHA is the recovery point for every deleted file.

## Delete list

Modules (each with its tests and snapshots):

- `src/components/MorphGlyphEditor.tsx`
- `src/components/StrokeStretchHoverHandles.tsx`
- `src/lib/strokeSchema/` — entire directory (after relocating
  `projectOntoAxis`)
- `src/lib/strokeSpines/` — entire directory
- `src/lib/glyphEdits.ts`
- `src/lib/joinPins.ts` (+ `joinPins.test.ts`, `joinPins.fonts.test.ts`)
- `src/lib/nuqta.ts`
- `src/lib/justify.ts`
- `src/lib/kashidaFactor.ts`
- `src/lib/glyphContours.ts` — expected deletable once mask editing goes;
  **verify by grep** that no surviving module imports it before deleting
- `src/data/strokeSchemas/` — all 105 JSONs
- `src/data/strokeSpines/` — all 30 tables

State, types, and plumbing:

- `src/types.ts`: remove `GlyphStretchHandle`, `GlyphRig` and every
  stretch/rig/kashida field from `BlockCommon` (`glyphEdits`,
  `glyphRigValues`, `kashidaAmount`, `kashidaEditMode`, `glyphEditTool`,
  and stretch-mask fields). **Keep** `GlyphTransform`, `DiacriticOverride`,
  warp fields, `glyphTransforms`, `diacriticOverrides`.
- `src/App.tsx`: remove `setStretchFactor`, `setBlockKashidaAmount`,
  `justifyBlock` and the Fit-width state, the glyph-rig store and handlers,
  `snapStrokesToNuqta` state, the Morph panel visibility state
  (`rightPanelVisible` — check whether anything else uses it), and the
  dynamic `import()` of `lib/justify`. **Keep** `glyphTransformMode` state
  and its handlers, `supportsDiacriticOverrides`, `supportsGlyphTransforms`.
- `src/components/ShapedText.tsx` / `ShapeFillText.tsx`: strip
  `glyphEdits`/rig/kashida plumbing, `computeJoinPins` usage, the
  click-to-select-glyph + mask-overlay logic (`selectedGlyphIndex`,
  `selectedGlyphContours`, `deriveContourMask` effect), and the
  `useGlyphSchemaCatalog` call sites. **Keep** the glyph metrics memo
  (`glyphHitBoxes`/`glyphTransformedHitBoxes`), `drawWarpedGlyphRun`'s
  diacritic-override and glyph-transform handling, and the
  stroke-before-fill draw order.
- `src/components/CanvasStage.tsx`: drop the rig/stretch props it threads.
- `src/components/Sidebar.tsx`: remove the Morph panel launcher, the
  Typography → Kashida section, Fit width, and the "Snap strokes to nuqta"
  checkbox; **add** the relocated "Move & scale glyph" checkbox to
  Typography (visible for plain text blocks only, matching the current
  arming rule).
- Saved projects: in `applyParsedLayoutPayload`, strip `glyphEdits`,
  `glyphRigValues`, and `kashidaAmount` from loaded blocks — same mechanism
  and precedent as the `shapeWarp` filter. An old save must load cleanly
  with those edits dropped, not half-rendered or crashing.

## Docs

- `CLAUDE.md`: delete the stroke-schema, spine, nuqta, join-pin and
  auto-justify sections; replace with a short "Removed subsystems" note
  pointing at `docs/archive/nuqta-measurements.md` and the recorded SHA
  (follow the `shapeWarp` precedent's tone). Update the "adding a font"
  section: it drops from a five-place edit to **four** (the
  `NUQTA_EM_RATIO` step is gone). Update the diacritics section's
  cross-references to joinPins.
- `PROGRESS.md`: one entry under Shipped; move the now-moot stroke-stretch
  Known-limitations entries into the entry as "resolved by removal".
- `src/components/guide/sections/glyph-editing.tsx`: rewrite to cover only
  move & scale + diacritics. Delete `auto-justify.tsx`.

## Verification

- `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`,
  `npm run build` — all green. Expect the suite to shrink by roughly 150+
  tests; that is the point, not a problem.
- `grep -rn "strokeSchema\|strokeSpines\|glyphEdits\|joinPins\|kashida\|nuqta\|MorphGlyphEditor\|StrokeStretchHoverHandles\|GlyphRig\|justifyBlock"` across
  `src/` returns nothing (case-insensitive pass too; CSS `justify-content`
  hits are fine).
- **In a real browser** (this repo's history is full of type-checks-green,
  feature-silently-dead regressions): app boots with no console errors; a
  plain text block renders; diacritic hover handles still arm and drag; the
  relocated "Move & scale glyph" checkbox still arms the three dots; an old
  saved project containing stretch handles loads cleanly.
