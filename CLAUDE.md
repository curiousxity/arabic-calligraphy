# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HarfCanvas — a browser-based Arabic calligraphy design tool (React 19 + TypeScript + Vite, canvas rendering via Konva/react-konva). Users compose text, SVG-shape, and image blocks on a resizable artboard and export to PNG/JPEG/SVG/PDF.

## Commands

```bash
npm run dev       # start dev server
npm run build     # tsc -b && vite build
npm run lint      # eslint .
npm test          # vitest run (all tests, single pass)
npx vitest run path/to/file.test.ts   # run a single test file
npx vitest        # watch mode
npx tsc --noEmit -p tsconfig.app.json # typecheck only, no build output
```

There is no dedicated test-watch or coverage script beyond the above. Tests live beside the code they cover (`src/lib/*.test.ts`), not in a separate `__tests__` tree.

After any non-trivial change, run typecheck + lint + tests + build in that order — this is the verification loop used throughout the project's history.

## Architecture

### State lives in one place: `src/App.tsx`

Nearly all editor state (the `blocks` array, selection, canvas size/preset, pan/zoom, undo history, clipboard, save/load) is owned by the single `App` component and passed down as props to `Sidebar` and `CanvasStage`. There is no context/store/reducer — just `useState` + a large number of `useCallback` handlers defined in `App.tsx` and threaded through as props. When adding a feature, the pattern is: add state/handler in `App.tsx`, pass it to `Sidebar` and/or `CanvasStage`, wire the prop through to where it's consumed.

Because handlers reference each other via closures declared later in the same function body, a handler used inside a `useEffect`/`useCallback` **must be physically defined above** the point that references it in the dependency array, or TS/runtime "used before declaration" errors occur — this bites when reordering code in `App.tsx`.

### The `Block` discriminated union (`src/types.ts`)

Everything drawn on the canvas is a `Block`: `TextBlock | ShapeFillBlock | ShapeWarpBlock | ImageBlock`, discriminated by `type`. All four share a large `BlockCommon` (position, font fields, stroke/shadow, `groupId`, lock state, etc.) even where a variant doesn't conceptually need them (e.g. `ImageBlock` still carries unused `text`/`fontSize`/`color`/`fontFamily` because `BlockCommon` requires them) — this is an intentional simplification, not an oversight.

Because `Partial<Block>` patches spread onto a `Block` union member don't type-check cleanly across 4+ variants, the two generic update paths (`updateBlock`, `updateSelectedBlock` in `App.tsx`) cast the result `as Block`. This is a deliberate, narrow trust-the-caller escape hatch — don't propagate `as Block` elsewhere; fix the type properly if a new case needs it.

`shapeFill`/`shapeWarp`/`image` blocks are fundamentally different rendering algorithms, not variants of one engine — see the component-by-component notes below. There was an explicit decision *not* to merge them into one engine (too much regression risk for little gain); if asked to "unify" them, favor UI-level consolidation over touching the render math.

### Rendering: one Konva component per block type

`CanvasStage.tsx` maps `blocks` to one of `ShapedText` (text), `ShapeFillText` (shapeFill), `ShapeWarpText` (shapeWarp), or `ImageBlockView` (image), each a `react-konva` `Group`. Common per-block wiring (id, draggable, click/drag handlers) is built once as `commonProps` and spread into whichever component renders.

- **`ShapedText.tsx`** — a normal text block; single shaped run, optional per-glyph `warpX`/`warpY` distortion via `src/lib/warp.ts`.
- **`ShapeFillText.tsx`** — *tiles* the shaped text in repeating rows to fill an uploaded SVG shape's silhouette (scanline + ray-casting against a sampled polygon), auto-scaling each row to span the shape width exactly.
- **`ShapeWarpText.tsx`** — draws the text *once* and remaps every glyph point into the shape's bounding envelope (`envelope`/`topBottom`/`stretch`/`radial` modes), with an additional per-glyph handle system (`glyphWarps`, pinch/move/scaleX/scaleY) for manual distortion in "glyph edit mode". Has its own inline warp-point math, independent of `lib/warp.ts`.

  `ShapedText.tsx`, `ShapeFillText.tsx`, and `ShapeWarpText.tsx` all additionally support the "Stretch" tool (`glyphEdits`/`GlyphStretchHandle` in `types.ts`, math in `lib/glyphEdits.ts`) — see the "Stroke-schema-driven glyph editor" section below.
- Shape Warp blocks have a second shape input alongside "Upload SVG"/hand-draw: **"Trace image"** uploads a raster photo/logo and auto-traces its silhouette client-side into the same `{ pathData, w, h }` shape `extractSvgPaths` already produces — `src/lib/imageTrace.ts` (`imagetracerjs`, aliased in `vite.config.ts` the same way `opentype.js` is, since it also has no `package.json` "exports" field) binarizes the image at a user-adjustable threshold (`ImageTraceDialog.tsx`, live preview) and hands the resulting silhouette through the *existing* `extractSvgPaths`, so `ShapeWarpText.tsx`'s envelope/topBottom/stretch/radial engine has no idea whether a shape came from an SVG upload or a traced image. Binarization is **alpha-aware** (any pixel with alpha < 128 is background regardless of its RGB) — the source is drawn onto a fresh, transparent canvas, so without that check a transparent PNG's untouched pixels read back as `rgba(0,0,0,0)`, i.e. maximally dark, and the whole image traces to a solid rectangle at every threshold. All of this feature's canvas work lives in `imageTrace.ts` (`imageElementToImageData`), not the dialog; it's the one part with no unit test, since jsdom can't rasterize. Shape Fill does not have this button — YAGNI until asked for.
- **`ImageBlockView.tsx`** — loads a data-URL image and draws it via Konva `Image`.

`ShapeFillText.tsx` and `ShapeWarpText.tsx` each reimplement their own SVG-path-replay-to-canvas-context helper (`replayPath`/`tracePath`) because Konva's context wrapper doesn't support `Path2D` — this duplication is known and intentional, not an oversight to "fix" by extracting a shared helper (their fill/clip logic differs enough that past attempts kept them separate).

Selected/grouped/multi-selected blocks currently have **no persistent on-canvas outline** (a dashed selection-box `Transformer` was tried and explicitly removed per user feedback) — the two exceptions are: a small drag-to-resize corner handle shown only on the *selected* `shapeFill`/`image` block, and colored glyph-edit handles for `shapeWarp`. Don't reintroduce a general selection bounding box without checking this history.

### Arabic text shaping pipeline (`src/lib/harfbuzz.ts` + `src/hooks/useShapedGlyphs.ts`)

Text is shaped with real HarfBuzz compiled to WASM (`harfbuzzjs` npm package, loaded async), not a JS approximation. `shapeText(text, fontUrl)` loads the font bytes, shapes via HarfBuzz (`rtl` direction, `arab` script), and returns glyph IDs/advances plus the font parsed by `opentype.js` (used afterward to fetch actual glyph outlines for Konva drawing). Results are cached by `text|fontUrl` in-memory (`shapeCache`); call `clearShapeCache()` if a font file changes at the same URL. `FONT_URLS` (in `useShapedGlyphs.ts`) maps font-family keys to `/fonts/*.ttf|otf` — this is the single place new fonts get registered for the app to shape with.

`src/lib/normalizeGlyphs.ts` and `src/lib/svgPath.ts` have their own `*.test.ts` files — these are the two lib modules with actual test coverage; `warp.ts` also has a test.

### Per-instance diacritic control (`src/lib/diacritics.ts`, `DiacriticHoverHandles.tsx`)

Plain text blocks support per-instance adjustment of individual tashkeel
marks (harakat, tanween, sukun, shadda, etc.) — hovering any diacritic on
a selected block's canvas shows three small handles: drag one vertically
to reposition it, drag another to resize it, and click a third to hide
just that one instance. This is separate from, and non-destructive
relative to, the existing "Clear diacritics" button (`clearDiacritics` in
`App.tsx`), which permanently removes every diacritic character from the
block's text — overrides only change how a diacritic *renders*, never the
underlying text, and a "Reset diacritic overrides" button clears them
without touching the text either.

`lib/diacritics.ts`'s `findDiacriticGlyphIndices(glyphs, font)` identifies
which shaped glyphs are diacritics by glyph identity, **not** by cluster:
HarfBuzz's default cluster level (`MONOTONE_GRAPHEMES`) merges a base
letter with every combining mark following it into one cluster whose
value is the *base letter's* character offset, so a mark glyph's own
`glyph.cl` never points at the mark's own character — cluster-to-source
lookup (what an earlier version of this function did, and what
`strokeSchema/glyphLookup.ts` still does for its own, different, purpose)
silently detects nothing on real shaped text. The working detection is
two signals: (1) primary — the glyph's own Unicode codepoint(s), from
`font.glyphs.get(g.g).unicodes` (opentype.js's cmap-derived metadata),
tested against `ARABIC_DIACRITIC_RE`; (2) fallback, for contextual mark
variants with no cmap entry at all (e.g. a font's own fused mark-ligature
glyph) — within a cluster shared by more than one glyph, a base letter is
drawn at its own designed origin (HarfBuzz position `dx`/`dy` both 0)
while every mark stacked onto it carries a nonzero GPOS mark-attachment
offset, so a cluster-sharing glyph with nonzero `dx`/`dy` is treated as a
mark too. `ARABIC_DIACRITIC_RE` itself now lives in `diacritics.ts` (not
`harfbuzz.ts`, which re-exports it for compatibility) specifically so
this module has no runtime dependency on harfbuzzjs, which lets
`diacritics.test.ts` shape real text with real harfbuzzjs directly rather
than mocking it — every assertion in that suite is checked against actual
HarfBuzz output for real fonts in `public/fonts/`, not hand-written
`{ g, cl }` fixtures (a fabricated-cluster version of this test suite is
exactly what let the cluster-lookup bug ship unnoticed once before).

Overrides (`DiacriticOverride` in `types.ts`: `scale`/`offsetY`/`hidden`,
default no-op) are keyed by glyph index — the same scheme
`GlyphStretchHandle` already uses for the Stretch tool, including that
scheme's known fragility (a text edit before a diacritic in the string can
shift which glyph index its override lands on after re-shaping). Because
of that fragility, `ShapedText.tsx` recomputes `findDiacriticGlyphIndices`
for its own current glyph run each render and filters `diacriticOverrides`
down to only the glyph indices that call currently identifies as
diacritics before handing them to `drawWarpedGlyphRun` — a stale override
whose glyph index now lands on a base letter (rather than a mark) is
silently ignored instead of hiding or grotesquely scaling that letter.
Surviving overrides are applied inside `ShapedText.tsx`'s shared
`drawWarpedGlyphRun` as an
extra `ctx.translate`/`ctx.scale` pivoted on the glyph's own pen-origin
`(gx, gy)`, structurally identical to how that same function already
handles the Private-Use-Area "override glyph" preset symbols. A `hidden`
override skips the glyph's draw call but not its advance width, so hiding
a mark never reflows surrounding letters.

`DiacriticHoverHandles.tsx` is a separate component (not folded into
`ShapedText.tsx` itself) reusing `ShapedText`'s existing per-glyph
`glyphHitBoxes` (already computed for the Stretch tool's hit-testing) —
only the currently-hovered diacritic ever shows handles, which is what
keeps text with many marks from becoming visual clutter. The move
handle's `dragBoundFunc` captures the handle's absolute (stage-space) x
at `onDragStart` and holds it fixed for the drag's duration, rather than
returning the group-local `cx` Konva's `dragBoundFunc` contract requires
absolute coordinates for — mixing the two spaces there previously
teleported the handle sideways under any block offset/pan/zoom. The hover
hit-`Rect` is derived from the mark's actual rendered position
(`displayY`, i.e. original position + `offsetY`) and scaled size
(`box.width/height * scale`), not its original un-overridden box, so an
overridden mark's hoverable area tracks where it's actually drawn instead
of drifting away from it as `offsetY`/`scale` grow. It's active only
when the block is selected, matching every other interactive on-canvas
overlay in this app. Live handle drags follow the same debounced-history
pattern (`useDebouncedHistoryPush`) the Kashida tool already established;
the hide-button click is a discrete, immediate `pushHistory()` mutation.

This feature covers plain text, Shape Fill, and Shape Warp blocks.
`DiacriticHoverHandles.tsx` takes a list of `DiacriticPlacement`s
(`src/lib/diacriticPlacement.ts`) rather than raw hit boxes — each carries
the mark's box in its renderer's own local space plus a matched
`toCanvas`/`toLocal` pair, so all of the overlay's arithmetic (hover, the
drag rail, the hit rect, the three handles) stays in local space and only
drawing and drag-readback cross into canvas space. `ShapedText`'s adapter
is a plain translation; `ShapeWarpText`'s is
`applyShapeWarpPoint`/`invertShapeWarpPoint` (moved to
`src/lib/shapeWarpPoint.ts` to be testable — the inverse is Newton's
method, since none of the four warp modes has a closed-form inverse);
`ShapeFillText`'s is the per-tile affine transform, which deliberately
ignores the italic shear.

`invertShapeWarpPoint`'s Newton search is seeded through the inverse of the
base (unwarped) affine map, **not** at `(targetX, targetY)`. The target is
in shape space while the solver's unknowns are in glyph-run space, and
those ranges routinely differ in scale; seeding at the target lands outside
the glyph-bounds box, `clamp01` saturates, the Jacobian's y-column comes
out exactly zero, and the singular-determinant guard bails on iteration 0 —
returning the untouched seed. All four modes failed to invert at all before
this was fixed, so the seed is load-bearing, not a micro-optimisation;
`shapeWarpPoint.test.ts` pins it with a per-mode scale-mismatch case.

Two behaviours differ per block type, both deliberate. **Order:**
`ShapedText` applies an override *after* its own `warpX`/`warpY` (it is a
`ctx` transform wrapping already-warped point math), while Shape Fill and
Shape Warp apply it *before* their deformation — those deformations are
the entire point of those block types, and an override applied after would
detach the mark from its letter. **Arming:** Shape Warp shows handles on
selection like plain text, but Shape Fill requires an explicit "Diacritic
tool" checkbox (`diacriticEditMode` on `ShapeFillBlock`), because a fill
tiles its run across the whole silhouette and two marks can become 200+
instances — that checkbox also widens `glyphInstances`'s memo guard and
the block's `dragBoundFunc` pin, both of which were previously
`glyphEditTool`-only. Because overrides are keyed by glyph index, one
adjustment applies to every tiled repetition, exactly as `glyphEdits`
already does there.

`App.tsx`'s `dragDiacriticOverride`/`toggleDiacriticHidden` gate on
`supportsDiacriticOverrides(b)` rather than `b.type === "text"`. Widening
that guard is what actually makes the feature work on the two shape types —
`diacriticOverrides` lives on `BlockCommon`, so a narrower guard type-checks
perfectly while silently discarding every edit.

Text-on-path blocks remain unsupported — their glyphs are rotated to a
curve tangent, which is separate design work.

### Per-glyph move & scale (`src/lib/glyphTransform.ts`, `GlyphTransformHoverHandles.tsx`)

Plain text blocks support rigidly moving a single shaped glyph and
stretching or shrinking it as a whole in x or y — a third per-glyph system
alongside `glyphEdits` (which displaces individual *outline points* with
band falloff) and `diacriticOverrides` (uniform scale plus vertical offset,
marks only). Ticking "Move & scale glyph" in the Morph Glyph Editor arms it;
hovering a letter then shows three dots — blue to move, gold to scale x,
green to scale y.

`GlyphTransform` (`types.ts`: `offsetX`/`offsetY`/`scaleX`/`scaleY`, all
defaulting to the identity) is applied in `ShapedText.tsx`'s
`drawWarpedGlyphRun` as a `ctx.translate`/`ctx.scale` pair placed inside the
existing `ctx.translate(gx, gy)` — which is what makes the pivot the glyph's
**pen origin** (on the baseline, at the start of its advance) with no pivot
arithmetic, so a scaled letter keeps sitting on the baseline. It composes
*after* `applyGlyphEdit` and the glyph rig: stretch handles reshape the
outline, then this moves and scales the result as a unit. It is likewise the
**outermost** transform relative to a diacritic override: a mark carrying
both is first placed by its override in the glyph's own pre-transform space
and then moved/scaled by the transform, never the reverse. That ordering is
load-bearing rather than cosmetic — reversing the two `ctx` blocks multiplies
the transform's offset by the diacritic's scale, which no adapter can invert,
so `DiacriticHoverHandles` could no longer read a drag back as an unscaled
`offsetY`.

**`penX += advance` is never touched** — a moved or widened glyph does not
reflow its neighbours, matching what `hidden` already guarantees on
diacritic overrides.

Two consumers need the glyph's box in *different* spaces, so
`ShapedText.tsx`'s metrics memo emits both from one font walk.
`glyphHitBoxes` stays **raw** and `glyphTransformedHitBoxes` carries the
transform (via `transformedBox`). Only `GlyphTransformHoverHandles` gets the
transformed variant; `onGlyphBoxesChange`, the mask-derivation effect,
`selectedGlyphContours`, the diacritic placements, and
`StrokeStretchHoverHandles` all get the raw one, because every one of them
reasons in raw outline space — `applyGlyphEdit` displaces raw outline points,
so feeding it a transformed box lands the stretch band on the wrong part of
the letter and silently degrades `deriveContourMask` to a whole-glyph mask.
The block-level `bounds` in that same loop are deliberately raw too: they
must stay based on the untransformed run, or transforming one glyph would
resize the block and shift every other glyph on canvas.

A mark that itself carries a transform gets `makeGlyphTransformAdapter`
(`lib/diacriticPlacement.ts`) as its placement adapter instead of the plain
`makeOffsetAdapter`, which is how its handles reach the mark where it is
actually drawn while its `offsetY` stays in unscaled text units. The adapter
reduces to exactly `makeOffsetAdapter` at the identity transform, which is
the case for almost every glyph.

Scales are clamped to 0.2–4 in `glyphTransform.ts`, both when reading a drag
and when resolving a stored value, so a corrupted project file cannot
produce a glyph too small to grab and fix.

Arming is exclusive: while `glyphTransformMode` is on, `ShapedText` does not
mount `StrokeStretchHoverHandles` at all, so a dot is never ambiguous.
`DiacriticHoverHandles` still mounts last and stays topmost, keeping its
smaller targets winning on marks.

Transforms are keyed by glyph index and share that scheme's fragility, with
one difference worth knowing: `diacriticOverrides` are re-filtered each
render against `findDiacriticGlyphIndices`, so a stale override landing on a
base letter is dropped, but a glyph transform has no such signal — every
glyph is a legitimate target — so a stale transform applies to whatever glyph
now holds that index, exactly as `glyphEdits` already does.

A scale-handle drag snapshots the dot's starting distance from the pivot at
`onDragStart` rather than reading it from the live hit box: the box already
carries the transform the drag is updating, so reading it live makes the
scale converge to the wrong value (asking for 2× lands near 1.45× at typical
geometry). For the same reason the drag's pivot is `gx + offsetX`, not bare
`gx` — the renderer translates by the offset *before* scaling, so a moved
glyph pivots there too, and using the bare pen origin reads correct at rest
but drifts as the offset grows.

`scaleFromHandleDrag` then recovers the glyph's unscaled extent from that
snapshot (`(startDistance - gap) / startScale`) and inverts the dot's own
rest formula, so the dot stays exactly `gap` beyond the glyph's edge for the
whole gesture and the first frame returns the starting scale unchanged — no
jump on mouse-down, and no drift when an already-scaled glyph is dragged a
second time. The `gap` argument is **signed along each dot's rail**: positive
for the x dot, negative for the y dot, which sits above the glyph while
canvas y grows downward.

Plain text only. Shape Fill and Shape Warp carry the fields via
`BlockCommon` but neither renderer reads them; `App.tsx`'s
`supportsGlyphTransforms` gate rejects edits there rather than accepting
and silently discarding them.

### Stroke-schema-driven glyph editor (`src/lib/strokeSchema/`, `MorphGlyphEditor.tsx`)

The "Morph Glyph Editor" panel's Stretch tool lets a user click a shaped glyph and add anchor→drag "stretch handles" that displace real font-outline points (`lib/glyphEdits.ts`'s `applyGlyphEdit`/`applyAxisDisplacement`, band-falloff + optional contour/lasso masking). **Handle creation is schema-only** — there is no generic/freeform "Add stretch line" button anymore (removed once enough letters had authored schema data); every handle traces back to a `StretchDefinition` from an externally-authored Arabic calligraphy stroke schema (anatomical decomposition of a letterform into HEAD/BODY/EYE/TOOTH/DOT/etc. strokes, each with a safe stretch-factor range, kashida eligibility, protected zones, and a priority weight). A letter/joining-form combination with no authored schema entry simply cannot have a stretch handle added yet — that's expected, not a bug, until more schema files are supplied.

- `src/lib/strokeSchema/types.ts` is a straight TS port of the externally-supplied schema (`GlyphDescription`/`Component`/`Stroke`/`StretchZone`/`ProtectedZone`) — JSON files must match this shape field-for-field.
- `src/data/strokeSchemas/*.json` holds one file per authored (baseLetter, joiningForm) combination — e.g. `seen-medial.json`, `beh-isolated.json`. **Dropping a new file in this folder is the entire integration step** — `src/lib/strokeSchema/registry.ts` auto-loads every file via `import.meta.glob` and indexes by the JSON's own `glyph.unicode`+`glyph.joiningForm` fields (not filename), so nothing else needs to change to add a letter. As of this writing the full 28-letter alphabet + hamza is authored across all their valid contextual forms (dual-joining letters get isolated/initial/medial/final; right-joining-only letters — alif, dal, dhal, ra, zay, waw — get only isolated/final, per standard Arabic connection rules) — 104 files from one generation batch, keyed by filename convention `<letter>-<form>.json` (note: the source files use `ha`/`ya` for the letters this app calls `heh`/`yeh`, to avoid colliding with `hah`/`yeh`-adjacent names already in use — rename on import if handed more files using that convention). Per the batch's own caveat: many contextual forms still reuse the same base stroke skeleton rather than fully redesigned per-form outline geometry — the `formMetadata` block (`connectsRight`/`connectsLeft`/`derivedFrom`/`rulesNote`) records the connection rules each form was generated under, but isn't yet consumed by any rendering/editor logic.
- `src/lib/arabicJoining.ts`'s `classifyJoiningForms` determines each character's isolated/initial/medial/final cursive-joining form from Unicode letter-joining rules alone (dual-joining vs right-joining vs transparent combining marks) — independent of HarfBuzz and of any specific font, since harfbuzzjs doesn't expose which GSUB feature it picked internally.
- `src/lib/strokeSchema/glyphLookup.ts`'s `useGlyphSchemaCatalog(shapableText, glyphs)` hook maps each shaped glyph's HarfBuzz cluster (`glyph.cl`) back to a source character + joining form, looks up the registry, and (via `deriveCatalog.ts`'s `deriveStretchCatalog`) flattens any match into labeled `StretchDefinition`s. **Important:** `glyph.cl` indexes into `shapableText` (the text *after* `stripUnsupportedDiacritics()` in `harfbuzz.ts`), not the block's raw `text` — `ShapedTextResult`/`useShapedGlyphs` expose `shapableText` specifically so this mapping stays correct.
- **This intentionally does NOT become a parametric bezier rendering engine.** The schema's own `path`/`fromNode`/`toNode` coordinates describe *its own* idealized geometry, which cannot be mapped onto an arbitrary font's actual outline points — real fonts and HarfBuzz shaping remain the source of truth for letterform shape. The schema only supplies metadata (labels, kashida eligibility, min/maxFactor bounds, protected-zone advisories, priority) plus its own authored geometry (used only to *derive* an axis — see below). If asked to make the schema "actually render" the letterforms, that's a much larger, different feature (an entire custom letterform library replacing per-font glyph outlines) — confirm scope before attempting it.
- **No manual dragging — the axis is auto-derived from the schema's own geometry, sliders are the only control.** Every handle used to require the user to drag a red anchor dot and a green drag dot onto the real glyph before its slider did anything; this was removed entirely (not kept as a fallback) in favor of a Kaleam-style slider-only flow. `src/lib/strokeSchema/schemaGeometry.ts`'s `computeNodeBoundingBox(desc)` scans every stroke's authored path nodes across all components to get the schema's own bounding box; `normalizePoint`/`mapNormToRealBox` convert a schema stroke-zone's `fromNode`/`toNode` into a plain 0–1 proportion and back onto the *real* glyph's actual bounding box (flipping Y — schema convention is baseline-up, canvas convention is top-down). `deriveCatalog.ts`'s `deriveStretchCatalog` attaches this as `anchorNorm`/`dragNorm` on every `StretchDefinition`; `App.tsx`'s `addStretchHandle` maps those onto the selected glyph's real hit-box (from `glyphBoxesByBlock`) to get `anchorX/Y`/`dragOriginX/Y`, then extrapolates `dragX/Y = anchor + (dragOrigin - anchor) * maxFactor` — the "full stretch" reference point the displacement math needs. This is approximate (a proportional guess, not a per-font-verified point), not pixel-perfect, by design.
- **Plain text blocks moved back to on-canvas dragging (Shape Fill/Shape Warp did not).** `StrokeStretchHoverHandles.tsx` (modeled directly on `DiacriticHoverHandles.tsx`) is a second reversal, layered on top of the schema-derived axis the previous bullet describes: hovering a letter on a *selected plain text block* reveals one draggable dot per authored stroke zone, replacing that stroke's Morph-panel slider with direct on-canvas dragging (the panel keeps a small numeric input for typed precision instead). A dot's rest position for a given `factor` is `anchor + factor · (dragOrigin - anchor)` (`lib/strokeSchema/dragAxis.ts`) — since `dragOrigin` is already the schema-derived `factor=1` point and `dragX` the `factor=maxFactor` point (both established at handle-creation time, unchanged from before), `factor` itself doubles as the axis-interpolation parameter, with no new "manual anchor/drag positioning" reintroduced. Dragging is rail-constrained (Konva `dragBoundFunc` via `dragAxis.ts`'s `projectOntoAxis`, absolute-space, same technique `DiacriticHoverHandles.tsx`'s move handle already established) rather than free 2D movement. This is **plain text only** — same reasoning that kept the diacritic hover handles (see below) text-only: Shape Fill's tiled-row and Shape Warp's warped-envelope coordinate spaces are real, separate work. `ShapedText.tsx` also dropped the `glyphEditTool` ("Off"/"Stretch") gate entirely for its own click-to-select-glyph and mask-overlay-rendering logic — mask editing ("By stroke"/"Lasso") now arms directly via `selectedGlyphIndex` regardless of any tool state. `ShapeFillText.tsx`/`ShapeWarpText.tsx` still use `glyphEditTool` exactly as before. Hit-testing footgun worth remembering: because Konva routes a pointer only to the *topmost listening* shape and neighbouring Arabic letters (nearly all of which now have authored schemas) sit close together, each glyph's hover hit-`Rect` is sized to the union of the glyph's own box and the current rest position of every one of its dots — a stretched dot travels far outside the glyph box, and a rect that didn't follow it would fire `onMouseLeave` and unmount the dot before the cursor could reach it — while a `listening` toggle switches every *other* glyph's rect off as soon as one glyph is hovered or dragging, so those deliberately-wide rects can't steal hover from each other. For the same topmost-wins reason, `StrokeStretchHoverHandles` mounts *before* `DiacriticHoverHandles` in `ShapedText.tsx`'s JSX, so the smaller, more precise diacritic hit targets win wherever the two overlap.
- **`factor` is now absolute, not drag-relative.** The old `applyAxisDisplacement` formula treated `factor=0` as "no displacement" and scaled whatever distance the user's manual drag established — meaningless with no drag to scale. `lib/glyphEdits.ts`'s `resolveValueMultiplier(h)` remaps `factor` to `(factor - 1) / (maxFactor - 1)` for any handle with `minFactor`/`maxFactor` set (i.e. every schema-backed handle), so `factor=1` now means exactly zero displacement (the real font's own natural rendering) and `factor=maxFactor` means the full extrapolated stretch to `dragX/Y` — this also finally matches what `setBlockKashidaAmount`'s formula below already assumed. Handles without `minFactor`/`maxFactor` (none are created anymore, but old saved projects may have them) keep using `factor ?? 1` directly, unchanged. `GlyphStretchHandle` (`types.ts`) still declares all schema fields as optional purely for this old-save backward compatibility.
- The block-level "Kashida" 0–100 slider (`kashidaAmount` on `BlockCommon`, `setBlockKashidaAmount` in `App.tsx`) distributes one dial across every kashida-eligible schema-backed handle in a block, weighting each by its own `priority`: `factor = 1 + (maxFactor - 1) * (amount/100) * (priority/10)`. This is a manual dial, not automatic line-justification — the app has no "fit text to width" infrastructure to hook into.
- **Multi-letter ligatures and multiple named sliders per stroke:** a `Stroke.editBehavior.stretchZones[]` entry can carry its own `label` (`types.ts`) — `deriveStretchCatalog` emits one `StretchDefinition` per **zone**, not per stroke, so a single stroke can expose several independently named/bounded sliders (e.g. Height vs Length) instead of collapsing to one range; every pre-existing file (one zone per stroke, no zone-level label) still produces exactly one entry each, unchanged. `GlyphStretchHandle`/`StretchDefinition` carry `schemaZoneIndex`/`zoneIndex` to track which zone a handle represents. Separately, `GlyphDescription.glyph` supports `role: "ligature"` entries keyed by `baseLetterSequence` (bare-codepoint array, e.g. `["0627","0644","0644","0647"]` for "الله") instead of a single `unicode` — `registry.ts`'s `getLigatureSchema` looks these up, and `glyphLookup.ts`'s `computeClusterSpans` detects when a shaped glyph's HarfBuzz cluster spans more than one source character (several letters fused by the font's own GSUB ligature rules — confirmed real via `fonttools`: `Wessam.ttf` fuses "الله" into exactly one glyph) and routes it through the ligature lookup instead of the normal single-letter path. `src/data/strokeSchemas/allah-ligature.json` is the first (and so far only) authored ligature — confirmed working end-to-end live in the browser (Wessam font, typed "الله", Stretch tool shows 6 labeled buttons: Alif/First lam/Second lam height, Second lam shoulder, Heh loop/tail). It was hand-adapted from a richer source file that required shadda+dagger-alif marks to trigger (per that file's own `triggerRules`/`testCases`) — `fonttools` inspection confirmed no font in `public/fonts/` actually has a GSUB rule fusing the marked sequence (only the plain 4-letter one), so the marks-required trigger and its `MARKS_1` sub-component were dropped rather than imported as dead data. If handed another ligature file with a similar "requires marks/context our fonts don't actually implement" mismatch, verify against real GSUB tables (`fontTools.ttLib`) before assuming it'll work, same as this one.
- **A schema stroke's `protectedZones` are advisory text only** — they're never read by `applyGlyphEdit`/`applyAxisDisplacement`, so they don't by themselves stop a handle from displacing the whole glyph (its `fromNode`/`toNode` indices reference the schema's own idealized path, which has no correspondence to the real font's actual outline point indices — same mismatch as above). What actually scopes a handle is its own `mask` field. To avoid every schema handle defaulting to "affects the whole glyph," `src/lib/glyphContours.ts`'s `deriveContourMask` auto-derives a contour mask from wherever the handle's (now fixed, schema-derived) anchor/drag points sit on the real outline (point-in-polygon against the glyph's contours, reusing `lib/svgPath.ts`'s bezier-subdivision + point-in-polygon) — since the anchor/drag mapping is only proportional, not per-font-verified, it samples several points along the whole anchor→drag segment (not just the two endpoints) so a point landing in empty space between contours (e.g. between a letter's body and its dots) doesn't spuriously fall back to "whole glyph" when the segment as a whole clearly crosses the intended stroke's ink. Each of `ShapedText.tsx`/`ShapeFillText.tsx`/`ShapeWarpText.tsx` computes this **once, in a `useEffect` keyed off the handle's creation** (not on every drag — there is no more dragging) whenever `GlyphStretchHandle.maskAuto` is `true` and `mask` is still unset (every newly created handle starts this way, per `App.tsx`'s `addStretchHandle`). It can still legitimately land on "whole glyph" for a complex multi-letter ligature glyph where the per-letter schema proportions don't correspond well to the fused real outline — the block-level band width still limits which points move in that case, so this isn't unsafe, just less precisely scoped. Manually invoking "By stroke"/Lasso (`ShapedText.tsx` only) sets `maskAuto: false` so the user's explicit override is never clobbered.

### Text on path (`src/lib/textPath.ts`, `TextOnPathText.tsx`, `TextPathEditOverlay.tsx`)

A fifth block type, `textPath`, flows shaped text along an arbitrary curve
instead of a straight baseline. The curve is stored as a plain SVG path `d`
string (`textPathD`) — the same representation `shapeSvgPath` already uses
on `shapeFill`/`shapeWarp` blocks — rather than a bespoke point-array type,
so presets, SVG upload, and freehand pen-tool drawing all converge on one
representation and reuse `lib/svgPath.ts`'s existing parse/flatten/replay
functions wholesale.

`lib/textPath.ts` adds arc-length walking (`pathLength`/`pointAtArcLength`,
built on the same fixed-step bezier subdivision `pathToPolygon` already
provides), three preset-curve generators (`arcPathD`/`wavePathD`/
`circlePathD`), and a single-handle-per-anchor bezier editing model
(`CurveAnchor`/`anchorsToD`/`dToAnchors`) — every anchor has one *outgoing*
handle; the incoming handle for the next segment is always that anchor's
mirror image, trading a fully general independent-in/out-handle pen tool
for a much simpler one-handle-per-anchor editing UI.

`TextOnPathText.tsx` renders each glyph as a rigid unit — translate to its
arc-length position on the curve, rotate to the local tangent, draw the
outline — modeled on `ShapedText.tsx`'s glyph loop rather than
`ShapeWarpText.tsx`'s per-point remap, since text-on-path repositions whole
glyphs rather than distorting their outlines. Text always auto-scales to
span the curve's length exactly (same idea `ShapeFillText` already applies
per-row to its shape width), which means the block's `fontSize` field has
no visible effect for this block type and its slider is hidden in the
sidebar — curve length is the only size control. RTL text anchors to the
curve's *end* point by default (a `textPathReversed` flag flips this per
block when the guess is wrong for a particular curve).

`TextPathEditOverlay.tsx` is a separate component (not part of
`TextOnPathText`) providing the on-canvas pen-tool: click empty canvas to
append an anchor, drag an anchor or its handle to reshape, right-click an
anchor to remove it. It's shown only when a `textPath` block is both
selected and has `textPathEditMode` set, and is hidden during export
(`useExport.ts` toggles off every node whose id starts with
`text-path-edit-layer-`, alongside the grid and artboard background it
already hides).

Stretch-tool glyph handles and glyph rigs do not apply to `textPath`
blocks — `App.tsx`'s `rightPanelVisible` and every internal glyph-edit
mutator guard exclude `"textPath"` the same way they've always excluded
`"image"`. The anchor/drag math those tools use assumes a straight glyph
bounding box; making it work once a glyph is rotated to a curve tangent
is a real design problem, deliberately left for a future spec rather than
half-supported here.

### Font files carry custom glyphs — don't blindly replace them

`public/fonts/*.ttf|otf` are not stock font files. `FatemiMaqala.ttf` has 8 custom Private Use Area glyphs (U+E833-E840, honorific symbols used by the sidebar's "Presets" row) that were manually merged (via a Python `fontTools` script, not committed to the repo) into every *other* font file in `public/fonts/` too, so those symbols render regardless of the selected font. If a font file in `public/fonts/` is ever regenerated/replaced from an upstream source, those PUA glyphs will be lost and the Presets buttons will silently show missing-glyph boxes in every font except FatemiMaqala again.

### Sidebar structure

`Sidebar.tsx` is a large single component (selection-dependent panels: Styling, Align & Arrange, Shape Fill/Warp controls, Save/Export, Canvas Size, Arabic Helpers/Presets) that reads/writes through props from `App.tsx`. Shared low-level form pieces (`SelectRow`, `ColorRow`, `RangeRow`, `PresetKeyboard`) live in `src/components/sidebar/FormControls.tsx`; the layer list is `src/components/sidebar/LayersPanel.tsx`. `src/components/sidebar/utils.ts` has one helper (`makeId`).

The "Start from a Template" section's buttons don't apply a template
directly — each opens `TemplateWizardDialog.tsx`, a small modal with one
RTL text field per block in that template (`StarterTemplate.fields` in
`lib/templates.ts`, hand-authored per template, pre-filled with the
template's original text). Generate calls `App.tsx`'s
`generateFromTemplate`, which builds the new blocks via the pure
`buildBlocksFromTemplate(template, values)` (falls back to a field's
original text if left blank) before doing the same replace-canvas
sequence the old one-click apply used. This replaced a separate
`ConfirmDialog` "this clears the canvas" step — the wizard's own warning
text serves that purpose now, since filling out a form is already a
deliberate action and a second confirmation on top was redundant
friction.

CSS is one global stylesheet (`src/index.css`) using CSS custom properties for theming — navy+gold is the unconditional default (`:root`), with an ivory/parchment palette under `@media (prefers-color-scheme: light)` (inverted from the usual light-default/dark-override convention — check this file's structure before assuming which block is "the default").

Known CSS-layout footgun in this codebase: **CSS Grid and Flex children default to `min-width: auto`**, which refuses to shrink below content size and causes silent overflow/clipping at narrow sidebar widths. When adding a new multi-item row (grid or flex), give items `min-width: 0` explicitly or the row will overflow at the sidebar's minimum width instead of degrading gracefully.

### Undo/redo and grouping

`src/hooks/useUndoRedo.ts` is a generic snapshot-stack hook (`getSnapshot`/`applySnapshot` callbacks); `App.tsx`'s `pushHistory()` wraps it and is called at the start of nearly every mutating handler (before the state change, so undo restores pre-change state). Blocks can share a `groupId` (assigned via the Layers panel's pairwise "merge" UI or the multi-select "Group selected" action) so that dragging one moves every block with the same `groupId` together; `dissolveSingletonGroups()` cleans up groups that drop to one member after a delete.

### Export (`src/hooks/useExport.ts`)

PNG/JPEG/PDF use `stage.toDataURL()`; SVG uses `react-konva-to-svg`. All four temporarily hide the on-screen alignment grid (`Konva.Group#grid-lines`) and, if "transparent background" is checked, the artboard background rect (`#artboard-background`) via `stage.findOne(...)`, so neither ever gets baked into exported output.

### History thumbnails (`src/lib/historyStack.ts`, `HistoryPopover.tsx`)

The Undo/Redo buttons in `Sidebar.tsx` are joined by a small History icon
that opens a popover of thumbnails — one per earlier recorded point in the
edit history, most recent first, plus a live "Current" row captured fresh
each time the popover opens — letting the user jump directly to any of
them instead of only stepping one entry at a time.

`src/lib/historyStack.ts` holds the underlying data structure and is pure
(no React/Konva dependency, fully unit-tested in `historyStack.test.ts`):
a `{ past, future }` pair of `HistoryEntry<T> = { snapshot, thumbnail }`
arrays, with `pushEntry`/`moveBack`/`moveForward` as the only mutators —
`moveBack`/`moveForward` both accept a `steps` count (not just single
steps), which is what makes direct-jump possible without looping the
public undo/redo handlers (which would hit React state-batching issues if
called repeatedly in one synchronous burst).

`src/hooks/useUndoRedo.ts` wraps `historyStack.ts` and keeps its external
`pushHistory`/`handleUndo`/`handleRedo`/`canUndo`/`canRedo` surface
identical to before this feature — every existing `pushHistory()` call
site across `App.tsx` needed zero changes. It gains a required
`captureThumbnail: () => string` constructor argument (`App.tsx`'s
`captureHistoryThumbnail`, which rasterizes `stageRef.current.toDataURL()`
at `pixelRatio: 0.15` — cheap and approximate, not export-quality) called
alongside every recorded snapshot, plus `jumpBy(steps)` and
`historyEntries` for the popover.

**The popover only ever displays the past stack, never the future/redo
side** — `historyStack.ts`'s `pastTimeline` deliberately excludes it. A
redo-stack's natural array order doesn't correspond to a simple
chronological or distance ordering once you've jumped around via `jumpBy`
(each jump can stash multiple entries onto the opposite stack in one
move), so showing it as thumbnails would need a separate, more complex
ordering scheme; standard Redo (button/Ctrl+Y) remains the only way to
move forward again after a jump. Thumbnails, and history in general, are
in-session only — nothing here is persisted through save/load, matching
the undo stack's existing behavior.

### Cloud persistence (`src/lib/supabaseClient.ts`, `src/lib/cloudProjects.ts`)

Named saves (`namedProjects` in `App.tsx`) can optionally live in a
Supabase-backed cloud account instead of (or alongside) the existing
per-browser `localStorage` named-projects store — autosave and glyph rigs
remain local-only, untouched. `supabaseClient.ts`'s `supabase` export is
`null` whenever `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` aren't set
(no `.env` configured, e.g. most dev/CI environments) — every function in
`cloudProjects.ts` checks for this and degrades to a no-op/empty-result
rather than throwing, and `Sidebar.tsx` hides all cloud UI (sign-in link,
Local/Cloud toggle, cloud badges) entirely via a `cloudConfigured` prop
when unconfigured, so the app is indistinguishable from before this
feature existed until a Supabase project is actually wired up. Auth is
email-magic-link only (`supabase.auth.signInWithOtp`) — no
password/OAuth. `App.tsx` merges `localProjects` and `cloudProjects` into
one `namedProjects` list (each entry tagged `source: "local" | "cloud"`),
and every load/delete call now threads that `source` through so it hits
the right backend. Saving overwrites-by-name in both stores (a Postgres
`unique (user_id, name)` constraint plus `upsert` on the cloud side,
matching the local store's existing overwrite-by-name `Record<name, ...>`
shape) — there's no multi-device conflict resolution beyond that. See
`docs/superpowers/specs/2026-08-11-cloud-persistence-design.md` for the
full design and the SQL migration under `supabase/migrations/`.

## Deferred features

These are capabilities that have been explicitly identified as valuable but deliberately left for a future specification rather than partially supported now:

- **Per-glyph move & scale on Shape Fill, Shape Warp, and text-on-path blocks** — Implemented for plain text only. `src/lib/diacriticPlacement.ts`'s adapters are the nearest existing precedent for expressing another renderer's coordinate space, but they were authored for placing *diacritic marks*, not for a general per-glyph transform — treat them as a starting point to evaluate, not as a drop-in that makes this cheap. Each renderer's coordinate space needs its own design and verification pass. Text-on-path is excluded for the same reason every other per-glyph tool is, its glyphs being rotated to a curve tangent.

- **Per-glyph rotation** — The move/scale handles cover translation and axis-aligned scale only. Rotation needs a fourth handle and its own pivot decision.

- **Stretch tool and glyph-edit handles on text-on-path blocks** — The axis-derivation and per-glyph drag mathematics assume glyphs sit in a straight bounding box. Making them work once glyphs are rotated to follow a curve's tangent is a real design problem, not a trivial extension of the existing system.

- **Parametric bezier schema rendering** — The stroke schema currently supplies only metadata (labels, kashida eligibility, protected-zone advisories) plus its own authored geometry (used only to derive stretch axes). It does not render letterforms itself — real fonts and HarfBuzz shaping remain the source of truth. Building a full parametric rendering engine that replaces per-font glyph outlines would be a much larger, separate feature; confirm scope before attempting it.

- **Schema protectedZones enforcement** — A schema stroke's `protectedZones` are advisory text only and are never read during glyph editing. Enforcing them in the rendering would require a separate design to scope per-stroke edits by the schema's own geometry rather than by the real font's actual outline point indices.

- **Automatic line-justification via Kashida** — The Kashida block-level dial (0–100) is manual only; it distributes one slider across every kashida-eligible stroke in a block. The app currently has no "fit text to width" infrastructure to hook automatic justification into.

- **Image trace for Shape Fill blocks** — Auto-tracing a raster image into a silhouette shape (already implemented for Shape Warp via `ImageTraceDialog.tsx`) is not yet available for Shape Fill blocks — YAGNI until requested.

### Vite/Rolldown quirk

`vite.config.ts` manually aliases `opentype.js` to its prebuilt ESM file because the package has no `exports` field, which breaks Rolldown (Vite 8's bundler) resolution otherwise. If upgrading `opentype.js` or Vite, re-check this alias still resolves.

`imagetracerjs` (the image-trace Shape Warp input) has the **same** missing-`exports` problem and the same kind of alias — plus one extra fragility: its entry file is named with the version in it (`imagetracer_v1.2.6.js`), so the alias path is version-specific. `package.json` therefore pins it exactly (`"imagetracerjs": "1.2.6"`, deliberately no caret); bumping the version *requires* updating the filename in `vite.config.ts` in the same change, or resolution breaks with a confusing "cannot resolve" error.
