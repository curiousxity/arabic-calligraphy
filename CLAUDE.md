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

### Version number — bumped automatically, don't edit it by hand

`package.json`'s `version` is displayed under the wordmark in the sidebar
(`vite.config.ts` injects it as `__APP_VERSION__` via `define`, declared in
`src/vite-env.d.ts`), and a **pre-commit hook bumps its patch on every
commit** so the displayed number always tracks the code. Expect
`package.json` and `package-lock.json` to appear in every diff; that is the
mechanism working, not stray noise.

- The hook is `.githooks/pre-commit`, installed by `package.json`'s
  `prepare` script pointing `core.hooksPath` at that directory — so a fresh
  clone picks it up from `npm install`, with no husky-style dependency.
- The bump logic is `scripts/bumpVersion.mjs` (tested in
  `scripts/bumpVersion.test.mjs`). It edits `package.json` with a
  single-line regex to preserve formatting, but parses the lockfile
  properly and addresses its two version fields *by key* — `version` and
  `packages[""].version` — so a dependency that happens to share the
  project's version string is never rewritten.
- The hook deliberately **skips merges, rebases, cherry-picks, and
  reverts** (it checks for `MERGE_HEAD`, `rebase-merge`, etc. in the git
  dir). Those replay or combine existing commits, and bumping during them
  would make `package.json` conflict on essentially every one.
- Only the patch ever moves automatically, and `nextPatch` never rolls
  `0.1.9` over into `0.2.0`. Minor and major bumps stay a deliberate,
  hand-made decision about what the release means; edit `package.json`
  directly for those.
- The value is baked in at build time, so a **running dev server shows a
  stale version until it restarts**.

## Architecture

### State lives in one place: `src/App.tsx`

Nearly all editor state (the `blocks` array, selection, canvas size/preset, pan/zoom, undo history, clipboard, save/load) is owned by the single `App` component and passed down as props to `Sidebar` and `CanvasStage`. There is no context/store/reducer — just `useState` + a large number of `useCallback` handlers defined in `App.tsx` and threaded through as props. When adding a feature, the pattern is: add state/handler in `App.tsx`, pass it to `Sidebar` and/or `CanvasStage`, wire the prop through to where it's consumed.

Because handlers reference each other via closures declared later in the same function body, a handler used inside a `useEffect`/`useCallback` **must be physically defined above** the point that references it in the dependency array, or TS/runtime "used before declaration" errors occur — this bites when reordering code in `App.tsx`.

### The `Block` discriminated union (`src/types.ts`)

Everything drawn on the canvas is a `Block`: `TextBlock | ShapeFillBlock | ImageBlock | TextPathBlock`, discriminated by `type`. All four share a large `BlockCommon` (position, font fields, stroke/shadow, `groupId`, lock state, etc.) even where a variant doesn't conceptually need them (e.g. `ImageBlock` still carries unused `text`/`fontSize`/`color`/`fontFamily` because `BlockCommon` requires them) — this is an intentional simplification, not an oversight.

Because `Partial<Block>` patches spread onto a `Block` union member don't type-check cleanly across 4+ variants, the two generic update paths (`updateBlock`, `updateSelectedBlock` in `App.tsx`) cast the result `as Block`. This is a deliberate, narrow trust-the-caller escape hatch — don't propagate `as Block` elsewhere; fix the type properly if a new case needs it.

`shapeFill`/`textPath`/`image` blocks are fundamentally different rendering algorithms, not variants of one engine — see the component-by-component notes below. There was an explicit decision *not* to merge them into one engine (too much regression risk for little gain); if asked to "unify" them, favor UI-level consolidation over touching the render math.

**`shapeWarp` was a fifth block type and was deleted outright** (it drew the text once and bent it into a shape's envelope, with `envelope`/`topBottom`/`stretch`/`radial` modes). It took `ShapeWarpText.tsx`, `lib/shapeWarpPoint.ts`, and the "Trace image" input — `ImageTraceDialog.tsx`, `lib/imageTrace.ts`, and the `imagetracerjs` dependency plus its version-pinned Vite alias — with it, since tracing existed only on that block type. `applyParsedLayoutPayload` in `App.tsx` filters `type === "shapeWarp"` blocks out of any project saved before the removal, so an old save loads with those blocks dropped rather than half-rendered. Don't resurrect any of it piecemeal from git history without re-reading this note.

### Rendering: one Konva component per block type

`CanvasStage.tsx` maps `blocks` to one of `ShapedText` (text), `ShapeFillText` (shapeFill), `TextOnPathText` (textPath), or `ImageBlockView` (image), each a `react-konva` `Group`. Common per-block wiring (id, draggable, click/drag handlers) is built once as `commonProps` and spread into whichever component renders.

- **`ShapedText.tsx`** — a normal text block; single shaped run, optional per-glyph `warpX`/`warpY` distortion via `src/lib/warp.ts`.
- **`ShapeFillText.tsx`** — *tiles* the shaped text in repeating rows to fill an uploaded SVG shape's silhouette (scanline + ray-casting against a sampled polygon), auto-scaling each row to span the shape width exactly.

  `ShapedText.tsx` and `ShapeFillText.tsx` both additionally support the "Stretch" tool (`glyphEdits`/`GlyphStretchHandle` in `types.ts`, math in `lib/glyphEdits.ts`) — see the "Stroke-schema-driven glyph editor" section below.
- **`ImageBlockView.tsx`** — loads a data-URL image and draws it via Konva `Image`.

`ShapedText.tsx`, `ShapeFillText.tsx`, and `TextOnPathText.tsx` each reimplement their own SVG-path-replay-to-canvas-context helper (`replayPath`/`tracePath`) because Konva's context wrapper doesn't support `Path2D` — this duplication is known and intentional, not an oversight to "fix" by extracting a shared helper (their fill/clip logic differs enough that past attempts kept them separate).

All three draw a block's **outline before its fill**, not after. A canvas stroke straddles the path it follows, so stroking after the fill lays half the outline's width back over the letter, thickening every stem and closing counters as the width rises; filling over the stroke hides that inner half and leaves the letterform at its designed weight. `strokeWidth` therefore reads as the visible outline, and reversing the order in any one renderer would silently make that block type's outlines twice as heavy as the others'.

Selected/grouped/multi-selected blocks currently have **no persistent on-canvas outline** (a dashed selection-box `Transformer` was tried and explicitly removed per user feedback) — the two exceptions are: a small drag-to-resize corner handle shown only on the *selected* `shapeFill`/`image` block, and colored glyph-edit handles on the selected block. Don't reintroduce a general selection bounding box without checking this history.

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

This feature covers plain text and Shape Fill blocks.
`DiacriticHoverHandles.tsx` takes a list of `DiacriticPlacement`s
(`src/lib/diacriticPlacement.ts`) rather than raw hit boxes — each carries
the mark's box in its renderer's own local space plus a matched
`toCanvas`/`toLocal` pair, so all of the overlay's arithmetic (hover, the
drag rail, the hit rect, the three handles) stays in local space and only
drawing and drag-readback cross into canvas space. `ShapedText`'s adapter
is a plain translation; `ShapeFillText`'s is the per-tile affine
transform, which deliberately ignores the italic shear.

Two behaviours differ per block type, both deliberate. **Order:**
`ShapedText` applies an override *after* its own `warpX`/`warpY` (it is a
`ctx` transform wrapping already-warped point math), while Shape Fill
applies it *before* its deformation — that deformation is the entire point
of the block type, and an override applied after would detach the mark from
its letter. **Arming:** plain text shows handles on selection, but Shape
Fill requires an explicit "Diacritic tool" checkbox (`diacriticEditMode` on `ShapeFillBlock`), because a fill
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

Plain text only. Shape Fill carries the fields via
`BlockCommon` but its renderer doesn't read them; `App.tsx`'s
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
- **Plain text blocks moved back to on-canvas dragging (Shape Fill did not).** `StrokeStretchHoverHandles.tsx` (modeled directly on `DiacriticHoverHandles.tsx`) is a second reversal, layered on top of the schema-derived axis the previous bullet describes: hovering a letter on a *selected plain text block* reveals one draggable dot per authored stroke zone, replacing that stroke's Morph-panel slider with direct on-canvas dragging (the panel keeps a small numeric input for typed precision instead). A dot's rest position for a given `factor` is `anchor + factor · (dragOrigin - anchor)` (`lib/strokeSchema/dragAxis.ts`) — since `dragOrigin` is already the schema-derived `factor=1` point and `dragX` the `factor=maxFactor` point (both established at handle-creation time, unchanged from before), `factor` itself doubles as the axis-interpolation parameter, with no new "manual anchor/drag positioning" reintroduced. Dragging is rail-constrained (Konva `dragBoundFunc` via `dragAxis.ts`'s `projectOntoAxis`, absolute-space, same technique `DiacriticHoverHandles.tsx`'s move handle already established) rather than free 2D movement. This is **plain text only** — same reasoning that kept the diacritic hover handles (see below) text-only: Shape Fill's tiled-row coordinate space is real, separate work. `ShapedText.tsx` also dropped the `glyphEditTool` ("Off"/"Stretch") gate entirely for its own click-to-select-glyph and mask-overlay-rendering logic — mask editing ("By stroke"/"Lasso") now arms directly via `selectedGlyphIndex` regardless of any tool state. `ShapeFillText.tsx` still uses `glyphEditTool` exactly as before. Hit-testing footgun worth remembering: because Konva routes a pointer only to the *topmost listening* shape and neighbouring Arabic letters (nearly all of which now have authored schemas) sit close together, each glyph's hover hit-`Rect` is sized to the union of the glyph's own box and the current rest position of every one of its dots — a stretched dot travels far outside the glyph box, and a rect that didn't follow it would fire `onMouseLeave` and unmount the dot before the cursor could reach it — while a `listening` toggle switches every *other* glyph's rect off as soon as one glyph is hovered or dragging, so those deliberately-wide rects can't steal hover from each other. For the same topmost-wins reason, `StrokeStretchHoverHandles` mounts *before* `DiacriticHoverHandles` in `ShapedText.tsx`'s JSX, so the smaller, more precise diacritic hit targets win wherever the two overlap.
- **`factor` is now absolute, not drag-relative.** The old `applyAxisDisplacement` formula treated `factor=0` as "no displacement" and scaled whatever distance the user's manual drag established — meaningless with no drag to scale. `lib/glyphEdits.ts`'s `resolveValueMultiplier(h)` remaps `factor` to `(factor - 1) / (maxFactor - 1)` for any handle with `minFactor`/`maxFactor` set (i.e. every schema-backed handle), so `factor=1` now means exactly zero displacement (the real font's own natural rendering) and `factor=maxFactor` means the full extrapolated stretch to `dragX/Y` — this also finally matches what `setBlockKashidaAmount`'s formula below already assumed. Handles without `minFactor`/`maxFactor` (none are created anymore, but old saved projects may have them) keep using `factor ?? 1` directly, unchanged. `GlyphStretchHandle` (`types.ts`) still declares all schema fields as optional purely for this old-save backward compatibility.
- The block-level "Kashida" 0–100 slider (`kashidaAmount` on `BlockCommon`, `setBlockKashidaAmount` in `App.tsx`) distributes one dial across every kashida-eligible schema-backed handle in a block, weighting each by its own `priority`: `factor = 1 + (maxFactor - 1) * (amount/100) * (priority/10)`. This is a manual dial, not automatic line-justification — the app has no "fit text to width" infrastructure to hook into.
- **Multi-letter ligatures and multiple named sliders per stroke:** a `Stroke.editBehavior.stretchZones[]` entry can carry its own `label` (`types.ts`) — `deriveStretchCatalog` emits one `StretchDefinition` per **zone**, not per stroke, so a single stroke can expose several independently named/bounded sliders (e.g. Height vs Length) instead of collapsing to one range; every pre-existing file (one zone per stroke, no zone-level label) still produces exactly one entry each, unchanged. `GlyphStretchHandle`/`StretchDefinition` carry `schemaZoneIndex`/`zoneIndex` to track which zone a handle represents. Separately, `GlyphDescription.glyph` supports `role: "ligature"` entries keyed by `baseLetterSequence` (bare-codepoint array, e.g. `["0627","0644","0644","0647"]` for "الله") instead of a single `unicode` — `registry.ts`'s `getLigatureSchema` looks these up, and `glyphLookup.ts`'s `computeClusterSpans` detects when a shaped glyph's HarfBuzz cluster spans more than one source character (several letters fused by the font's own GSUB ligature rules — confirmed real via `fonttools`: `Wessam.ttf` fuses "الله" into exactly one glyph) and routes it through the ligature lookup instead of the normal single-letter path. `src/data/strokeSchemas/allah-ligature.json` is the first (and so far only) authored ligature — confirmed working end-to-end live in the browser (Wessam font, typed "الله", Stretch tool shows 6 labeled buttons: Alif/First lam/Second lam height, Second lam shoulder, Heh loop/tail). It was hand-adapted from a richer source file that required shadda+dagger-alif marks to trigger (per that file's own `triggerRules`/`testCases`) — `fonttools` inspection confirmed no font in `public/fonts/` actually has a GSUB rule fusing the marked sequence (only the plain 4-letter one), so the marks-required trigger and its `MARKS_1` sub-component were dropped rather than imported as dead data. If handed another ligature file with a similar "requires marks/context our fonts don't actually implement" mismatch, verify against real GSUB tables (`fontTools.ttLib`) before assuming it'll work, same as this one.
- **A schema stroke's `protectedZones` are advisory text only** — they're never read by `applyGlyphEdit`/`applyAxisDisplacement`, so they don't by themselves stop a handle from displacing the whole glyph (its `fromNode`/`toNode` indices reference the schema's own idealized path, which has no correspondence to the real font's actual outline point indices — same mismatch as above). What actually scopes a handle is its own `mask` field. To avoid every schema handle defaulting to "affects the whole glyph," `src/lib/glyphContours.ts`'s `deriveContourMask` auto-derives a contour mask from wherever the handle's (now fixed, schema-derived) anchor/drag points sit on the real outline (point-in-polygon against the glyph's contours, reusing `lib/svgPath.ts`'s bezier-subdivision + point-in-polygon) — since the anchor/drag mapping is only proportional, not per-font-verified, it samples several points along the whole anchor→drag segment (not just the two endpoints) so a point landing in empty space between contours (e.g. between a letter's body and its dots) doesn't spuriously fall back to "whole glyph" when the segment as a whole clearly crosses the intended stroke's ink. Each of `ShapedText.tsx`/`ShapeFillText.tsx` computes this **once, in a `useEffect` keyed off the handle's creation** (not on every drag — there is no more dragging) whenever `GlyphStretchHandle.maskAuto` is `true` and `mask` is still unset (every newly created handle starts this way, per `App.tsx`'s `addStretchHandle`). It can still legitimately land on "whole glyph" for a complex multi-letter ligature glyph where the per-letter schema proportions don't correspond well to the fused real outline — the block-level band width still limits which points move in that case, so this isn't unsafe, just less precisely scoped. Manually invoking "By stroke"/Lasso (`ShapedText.tsx` only) sets `maskAuto: false` so the user's explicit override is never clobbered.

#### Known defects in the stretch math, and the schema data nobody reads

Investigated 2026-08-12 and reproduced live in the browser. **Read this
before changing `lib/glyphEdits.ts` or the catalog derivation.** Full
write-up, including the proposed fix and its open questions, is in
`docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md`.

**Three layers of authored schema data are consumed by nothing.** Verified
by grep across `src/`:

- `protectedZones` survives only as `protectedReasons`, a string list used
  for display. The zones themselves never scope an edit.
- `preserveCurvature`, `preserveThickness`, and each zone's own `axis`
  field (`"x"` / `"path"`) are read **nowhere**.
- `styleProfile.measurementSystem.dotUnit` and `verticalLevels` appear
  **only in test fixtures** — never in real code.

`lengthDots` no longer belongs on this list — see below, it is now the
divisor behind half-nuqta quantization.

This is why stretching misbehaves. The engine is not missing information;
it has it and discards it — for the pieces still listed above.

**Symptom 1 — a cleft opens at a join — fixed 2026-08-13.** Reproduce (on
`main` before that date): default `حرف`, stretch the ra down-left; a
hairline gap appeared at the hah/ra junction, on the side dragged
*toward*. Two causes compounded, and both halves were fixed:

- `applyAxisDisplacement`'s `tAlong = along / axisLen` was **unbounded and
  signed**, with falloff only *perpendicular* to the axis and none along
  it — points past the drag origin travelled further than the drag itself,
  points behind the anchor travelled backwards. `tAlong` is now clamped to
  `[0, 1]` and eased with smoothstep (`lib/glyphEdits.ts`).

  **That clamp is shared with the glyph-rig path, and quietly changed how
  old projects render.** `applyPreparedGlyphRig` calls the same
  `applyAxisDisplacement`, and unlike a schema handle it has no `factor = 1`
  neutral — a rig axis's slider value *is* the multiplier, so any saved
  project with a nonzero rig value draws slightly differently after this
  branch than before it: outline points beyond the axis tip no longer
  overshoot, and points behind the anchor no longer move the wrong way.
  This was deliberate and is kept. It is the identical overshoot bug in the
  identical function, a rig axis tears a join exactly as a stretch handle
  does, and giving the rig its own unclamped copy of the math would mean
  maintaining two displacement engines that differ only in a bug. Recorded
  here because the visual change is small enough to be rediscovered later
  as a mystery.
- The anchor is still only a *proportional guess* — `anchorNorm` mapped
  from the schema's idealized bounding box onto the real font glyph's box
  — and still never lands exactly on the true connection point. Rather
  than trust it, `lib/joinPins.ts`'s `computeJoinPins` finds joins a
  different way: wherever two adjacent shaped glyphs' real outlines
  physically overlap, by construction correct per font, assuming nothing
  about baselines or letterform style. `applyGlyphEdit` takes the result
  as an optional 5th `pins` parameter and applies it as a guard on the
  **net** displacement (after the handle loop, not per handle — guarding
  each handle separately would let two of them each individually respect
  a pin while still summing to a net movement there), evaluated at the
  point's *original* position so a point can't escape its own guard by
  being displaced out of the pin radius first. **Plain text only.**
  `ShapeFillText` tiles its run through a per-tile affine transform, so
  computing pins in that space is separate, deliberately-deferred work —
  it passes no pins and keeps the pre-existing tearing behaviour there.
- **Marks are skipped when pairing, and that is load-bearing.** Adjacency
  in a shaped run is not adjacency between letters: HarfBuzz emits every
  tashkeel mark as its own glyph *between* the base letters it sits on, so
  the original `i`/`i+1` pairing found no join at all the moment a word was
  vocalized — measured, `حَرْف` in Amiri went 2 pins → 0, `مُحَمَّد` 4 → 0,
  purely because of the harakat. With an إعراب keyboard, a diacritics
  subsystem and a per-mark canvas overlay in this app, that switched the
  whole feature off for a core use case. `computeJoinPins` therefore pairs
  each base glyph with the *next base glyph*; a mark never receives a pin
  of its own, which is right — a mark floats above the baseline and is not
  what tears. Marks are identified with `lib/diacritics.ts`'s
  `findDiacriticGlyphIndices`, this app's one detector for the job — do not
  hand-roll a second one here, and in particular do not reach for
  cluster-to-character lookup, which that module's header explains detects
  nothing on real shaped text. Being a heuristic, it inherits that
  detector's blind spots (see the Thuluth case below), where the behaviour
  degrades to exactly what it was before this fix rather than misbehaving.
- **Detection has a real, documented gap — not every abutting join is
  found.** `joinPins.fonts.test.ts` measured 7 fonts × 6 words (42 pairs)
  against real harfbuzzjs shaping. The 0px displacement-at-a-pinned-join
  invariance held for *every* join that was detected — no regressions, no
  partial credit. But 9 of the 42 pairs detect **no join at all**, in three
  distinct categories, all confirmed by independently re-shaping and
  counting glyphs:
  - **Correct-by-design:** `Urdu/بسم` and `Urdu/كتب` each shape to a
    single glyph — the font fuses the letters via GSUB. There is no glyph
    boundary, therefore no seam to tear, so "no pin" is the right answer.
  - **A real, currently-inert gap:** `Urdu/حرف`, `Urdu/سلام`, and
    `Thuluth/سلام` shape to multiple glyphs whose ink genuinely does not
    overlap — those letters abut rather than overlap, so
    `overlapCentroid` correctly returns null and the join goes unpinned.
    This is not a regression: it is exactly the pre-existing tearing
    behaviour, just not yet fixed for this geometry. Extending detection
    to abutting-but-not-overlapping glyphs is deliberately **not**
    improvised here — see "Deferred features" below. Urdu's two vocalized
    words land here too, for the same reason: its base glyphs abut once
    the marks are set aside.
  - **The mark detector can't see the font's marks:** `Thuluth/حَرْف` and
    `Thuluth/مُحَمَّد`. `Thuluth.ttf` maps its shaped mark glyphs to
    *Private Use Area* codepoints (U+E012, U+E016 observed for fatha and
    sukun) instead of U+064B–U+065F, and positions them by advance with
    `dx === dy === 0` rather than by GPOS — which defeats both signals
    `findDiacriticGlyphIndices` uses, so those marks read as base letters
    and break the pairing exactly as before. Its *unvocalized* words are
    unaffected. This is the same blind spot that already stops the
    per-mark diacritic overlay working on that font: the fix belongs in
    the one detector, which several features share, not in a second copy
    inside `joinPins.ts`.
  - **The mark detector flags a real letter** — the mirror image of the
    case above, found and fixed 2026-08-13, so it produces no `false`
    entry today. It is why `computeJoinPins` treats a glyph as a mark only
    when the detector flags it **and** `ax === 0`. `FatemiMaqala.ttf`
    emits `dx` of 1–4 units out of an upem of 2048 — shaper rounding
    noise — on ordinary letters, and the detector's
    cluster-plus-nonzero-`dx` fallback reads that as mark attachment: its
    unvocalized `كتب` lost the pins on glyphs 2 and 3, and `مُحَمَّد` lost
    every pin it had. A genuine mark takes no horizontal space and cannot
    participate in a join; a letter always advances the pen, which is the
    signal that separates them. **The guard is local to join pairing on
    purpose** — `lib/diacritics.ts` is shared with the per-mark canvas
    overlay and other features, and changing it needs its own verification
    pass across every consumer.

  `FatemiMaqala` and `Kufi2` were added to that matrix in the same pass and
  detect a join on all six words. `Kufi2` also confirms a *gain* from
  base-letter pairing outside the original five: it decomposes its nuqat
  into separately positioned GPOS mark glyphs, so a dot glyph severs two
  letters' adjacency under raw-neighbour pairing — `Kufi2/بسم` goes from 2
  pinned glyphs to 3 and `Kufi2/كتب` from 2 to 3 once marks are skipped.

**Symptom 2 — strokes deform rather than extend — still open, unchanged.** `fa-medial.json`'s eye
loop asks for `axis: "path"` and `preserveCurvature: true`; the catalog
collapses it to a straight chord, so the loop shears sideways and its
counter pinches shut instead of growing around its curve. Separately,
`ra-final.json` protects nodes 1→2 (`terminal-shape`,
`left-tail-terminal`) while the axis runs 0→2 — displacement is **maximum
exactly where the schema says do not deform.** The protection is inverted.

**Do not "fix" this by reaching for parametric rendering.** The stroke
schemas contain no joining geometry whatsoever (`formMetadata`'s
`connectsRight`/`connectsLeft` are prose and are consumed by nothing), so
drawing letters from skeletons would forfeit the seamless joining that
HarfBuzz plus real contextual forms currently provide for free. That
tradeoff was examined explicitly and rejected for now.

#### The nuqta is per-font and must be measured, not derived

Traditional Arabic calligraphy measures stroke length in whole and half
nuqta (the rhombic dot the nib makes), and the schemas are authored that
way — hence `lengthDots` on every stroke. Quantizing stretch to nuqta
increments needs no new schema data: a stroke's stretched length is
`lengthDots × factor`, so half-nuqta steps mean snapping the factor to
multiples of `0.5 / lengthDots`.

What it *does* need is the nuqta's size in each font, and **there is no
formula for it.** The natural guess — the alif's stem is one nuqta wide —
was measured across all fonts and **fails**: `alif ÷ dot` ranges from 0.53
(Urdu) to 1.68 (Kufi2), a 3.2× spread, where the rule predicts ~1.00.
`dot/em` itself varies ~2× across the library (0.0762 Wessam → 0.1538
Urdu), so no global constant can serve either.

The measured per-font table lives in the spec above. Two independent
methods were cross-checked and agree within ~2% on 14 of 17 fonts: the
beh (U+0628) dot contour, and a **modal-contour sweep** (scan every glyph,
keep small compact contours, take the mode — dots recur across many
letters). The modal method needs no cmap, GSUB walk, or naming convention,
and was the only one able to read `Qahiri.ttf`, whose base-codepoint
glyphs are all empty. Ruqaa and Yekan remain unresolved and need a human
eye. Quantization is to be **advisory, not compulsory** — snap by default
with a modifier to override, mirroring the existing grid snapping, and
off-grid values must round-trip through save/load unchanged.

Gotcha for any offline font analysis: `Kufi2.ttf` and `NotoSans.ttf` are
variable fonts whose `gvar` glyph count disagrees with `maxp` (825 vs 815;
1718 vs 1708). fontTools throws on `getGlyphSet()` until the `gvar` table
is dropped. Harmless to the app's own rendering path.

**The measured table now lives in code, `src/lib/nuqta.ts`**, as dot/em
ratios (`NUQTA_EM_RATIO`) rather than only in the spec — `nuqtaEmRatio`/
`nuqtaPx` look a font up and return `null` for any font not in the table.
`Ruqaa` and `HarfCanvasDiwani` are absent **deliberately**: every stroke
schema declares `calligraphicModel: "naskh"`, which fits Diwani's sloped
letterforms worst, and Ruq'ah merges dot pairs into strokes, making its
nuqta the least reliable figure measured. That `null` is the out-of-scope
mechanism for both fonts — it disables nuqta snapping *and* join pins
(`lib/joinPins.ts` needs a pin radius sized from the nuqta and gets none),
not an oversight to fill in with a guess.

Quantization (`src/lib/strokeSchema/quantize.ts`) snaps the stroke's
**added** length, not its absolute length: `factor = 1 +
round((factor - 1) / step) * step`, where `step = 0.5 / lengthDots`. A
stroke's natural `lengthDots` is generally not itself a half-nuqta
multiple (beh's body is 4.2), so snapping the *absolute* length to a
half-nuqta grid would move `factor = 1` off the font's own natural
rendering — silently breaking the rule that factor 1 renders exactly as
it does today. The added-length formula maps `factor = 1` to itself
exactly at every step size, which is what keeps that rule intact.
Wired into `App.tsx`'s `setStretchFactor` — the single funnel every
stretch path (drag, typed field, kashida dial) goes through — behind a
"Snap strokes to nuqta" checkbox (default on), with Alt bypassing it
mid-drag and the typed precision field passing `{ snap: false }`.
Snapping happens at edit time only, never on load and never in a
renderer, so an off-grid value a user saved deliberately round-trips
through save/load unchanged.

### Text on path (`src/lib/textPath.ts`, `TextOnPathText.tsx`, `TextPathEditOverlay.tsx`)

A fourth block type, `textPath`, flows shaped text along an arbitrary curve
instead of a straight baseline. The curve is stored as a plain SVG path `d`
string (`textPathD`) — the same representation `shapeSvgPath` already uses
on `shapeFill` blocks — rather than a bespoke point-array type,
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
outline — modeled on `ShapedText.tsx`'s glyph loop rather than a
per-point remap, since text-on-path repositions whole
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

`public/fonts/*.ttf|otf` are not stock font files. `FatemiMaqala.ttf` has custom Private Use Area glyphs (honorific symbols used by the sidebar's "Presets" row) that were manually merged (via a Python `fontTools` script, not committed to the repo) into every *other* font file in `public/fonts/` too, so those symbols render regardless of the selected font. If a font file in `public/fonts/` is ever regenerated/replaced from an upstream source, those PUA glyphs will be lost and the Presets buttons will silently show missing-glyph boxes in every font except FatemiMaqala again.

**There are TEN of those glyphs, and they are not a contiguous range.** The
authoritative list is `PRESETS` in `src/lib/presets.ts`:

    E833 E834 E835 E836 E837 E838 E839 E840 E841 E842

`E83A`–`E83F` are unused, and `E841`/`E842` sit *past* `E840`. Earlier
revisions of this file described them as "8 glyphs, U+E833-E840", which is
wrong twice over — a merge script written from that range silently omits
the last two, and the only symptom is the final two Presets buttons
rendering as missing-glyph boxes in the affected font. That exact bug was
hit and fixed on 2026-08-12. **Derive the list from `PRESETS`, never from a
range.**

**Adding a new font is a four-place edit plus a glyph merge, not a file
copy.** There is no single font registry — a font must be added to *all
four* of these or it half-works in a way that is easy to misdiagnose:

1. the file itself in `public/fonts/`;
2. an `@font-face` rule at the top of `src/index.css` — this is what the
   sidebar's dropdown uses to preview each font's own name;
3. `FONT_OPTIONS` in `src/components/Sidebar.tsx` — a hand-ordered array of
   `{ value, label, cssFamily }`, and **the only thing that decides whether
   a font appears in the picker at all**;
4. `FONT_URLS` in `src/hooks/useShapedGlyphs.ts` — what HarfBuzz actually
   shapes with.

Then merge the ten honorific glyphs into the file (see above).
Registering in `FONT_URLS` alone shapes correctly but leaves the font
invisible in the UI; adding to `FONT_OPTIONS` alone makes it selectable but
`FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans` silently falls back to Noto
Sans, so the picker shows a name that renders as a different font.

`HarfCanvasDiwani.ttf` is the worked example of all of this, added
2026-08-12. It is a **modified version of Layla Diwani** (OFL, Mohammed
Isam): the ten honorifics were merged in, and the family / full / PostScript
names were changed because the upstream reserves the name `LaylaDiwani`
under the OFL, and a Modified Version may not carry a Reserved Font Name.
Four of the ten codepoints (U+E833–E836) were already mapped by the original
to its own contextual variants; only those *cmap entries* were replaced —
the original glyphs remain in the file, and its GSUB is unaffected because
substitutions reference glyph names rather than codepoints. Provenance and
the full licence live beside it in `public/fonts/HarfCanvasDiwani-OFL.txt`;
keep that file with the font. Known limitation: the upstream has **no GPOS
table**, so mark positioning relies on advances alone and the
diacritic-detection fallback in `lib/diacritics.ts` that keys on nonzero
GPOS `dx`/`dy` cannot fire on it.

Two traps when merging those PUA glyphs into a third-party font:

- **The target range may already be occupied.** Fonts built in FontForge
  routinely auto-assign PUA codepoints to unencoded contextual variants.
  Layla Diwani, evaluated 2026-08-12, already maps U+E833–E836 — four of
  the eight honorific slots. Overwriting those *cmap entries* is safe in
  practice because GSUB substitutions reference glyph names rather than
  codepoints, so the font's internal contextual logic keeps working; but
  the collision must be checked and handled deliberately, not assumed away.
- **OFL Reserved Font Names.** Merging glyphs creates a Modified Version.
  If the upstream font declares a Reserved Font Name (Layla Diwani reserves
  `LaylaDiwani` among others), the modified file **must be renamed** — its
  `name` table included — or redistribution breaches the licence.

`Diwani.ttf` was **deleted** on 2026-08-12. It mapped **zero Arabic
codepoints**: its cmaps were 8-bit legacy tables of the old "Arabic
letterforms on Latin byte positions" kind, so HarfBuzz could not shape with
it at all. It was also never registered in `FONT_URLS`, which is why the
breakage went unnoticed. Do not restore it from git history expecting a
working Diwani — **`HarfCanvasDiwani.ttf` replaces it** (see above). Worth
knowing if another Diwani is ever sought: Google Fonts has none, and most
named Diwani faces (DecoType Diwani, Diwani Letter, Diwani Bent) are
proprietary or free-for-personal-use only, so they cannot be vendored here.

<!-- ---- STREAM-A: smart guides — document this feature here (see docs/superpowers/specs/PARALLEL.md) ---- -->

### Bounds-aware snapping (`src/lib/snapping.ts`, `CanvasStage.tsx`)

Dragging a block snaps its **visible rectangle** — left/centre/right and
top/centre/bottom — to the other blocks' rectangles, the artboard's own
edges and centres, and the user's ruler guides. This is distinct from the
origin-to-origin snapping that came before it and which still runs
alongside: a block's origin is not its visual edge (`ShapedText` offsets
its box by `align`), so two blocks with coinciding origins can look
unaligned, and "this text's right edge against that image's left edge"
was not expressible at all.

`src/lib/snapping.ts` is pure — plain rectangles, no React and no Konva —
and fully tested in `snapping.test.ts`. `buildSnapTargets` flattens the
candidates into `SnapTarget`s; `computeSnap` returns the `dx`/`dy` that
closes the nearest gap plus the lines to draw. **At most one snap per
axis**, or a block gets pulled two directions at once. Equidistant
targets break ties by kind — user guide, then artboard, then block edge,
then block centre — explicitly via `KIND_PRIORITY` rather than by array
order, because a user who deliberately dropped a ruler guide means it.

Four things about the `CanvasStage` side are load-bearing:

- **Targets are measured once per gesture, into a ref, on the drag's
  first move frame.** `getClientRect` traverses a block's entire subtree;
  rebuilding every block's rect on every frame visibly stutters a busy
  canvas at 60fps. This belongs in `onDragStart` — but **the block
  renderers forward only `onDragMove`/`onDragEnd` to their Konva groups**,
  so there is no drag-start event to hang it on without editing them, and
  they were off-limits. The first move frame is equivalent: nothing but
  the dragged block has moved by then. `snapTargetsForRef` holds the
  block id the measurement belongs to; `onDragEnd` clears it. The dragged
  block and all of its `getCoMovers` are excluded.
- **The snap is re-run in `onDragEnd`, not just on move frames.** Konva's
  mouse-up sets the node straight to the raw pointer position before
  firing `dragend`, so without this a block released mid-snap lands a
  fraction off the line it was visibly stuck to. `resolveDragPosition` is
  shared by both handlers for exactly this reason.
- **The snap is computed on the rect but applied to the node's
  `position`.** During a drag those two differ by a constant offset, so
  adding the delta is exact — and it avoids having to model each block
  type's own origin-to-bounds relationship, which is precisely the
  per-renderer work this feature was scoped to avoid.
- **Origin snapping was kept, not replaced.** Each axis goes to whichever
  of the two pulls is nearer, a bounds match winning an exact tie. Grid
  snapping still happens separately in `onDragEnd` and is untouched.

`snapGuides` is now a `SnapLine[]` rather than a nullable x/y pair, and a
line carries a `from`/`to` extent spanning the union of the dragged rect
and its matched target — so a guide line covers just the two blocks it
relates instead of the old ±100000 full-canvas line. Origin-snap lines
have no target rect to union with, so they still span the whole
`contentBox`. Styling (magenta, dashed, `1 / stageScale`) is unchanged.

The "Snap to block edges" checkbox (Background & Grid panel) is
`snapToBlockEdges` in `App.tsx`, defaulting **on** and deliberately not
persisted. Off restores exactly the previous origin-only behaviour.

Note that the "artboard" targets come from `contentBox`, which is unioned
with the current viewport — so at a zoom level where the viewport is
larger than the content, those edges sit at the viewport's edge rather
than at any drawn boundary. This matches what the pre-existing
centre-of-`contentBox` origin target already did.

`findEqualGaps` adds the equal-spacing markers: when the dragged rect
sits between two others with gaps even to within the threshold, a capped
bar is drawn across each gap. **Advisory only — nothing snaps to them**,
and at most one pair per axis (the most even), because a crowded canvas
satisfies the condition several ways at once and drawing them all is
noise.

<!-- ---- /STREAM-A ---- -->

### Canvas pan and zoom (`CanvasStage.tsx`, `lib/canvasBounds.ts`)

A wheel event zooms only when `ctrlKey`/`metaKey` is set — which is how
browsers report a trackpad pinch as well as an explicit ctrl+wheel; a
plain wheel or two-finger scroll pans instead.

The zoom multiplier comes from `zoomFactorFromWheel(deltaY, deltaMode)`,
which is **exponential in the wheel's actual travel** rather than a fixed
step per event. This distinction is the whole reason that function exists:
a trackpad pinch fires dozens of small-delta events per second while a
mouse wheel fires a few large ones, so the fixed ±10%-per-event this used
to do made pinching rocket through the entire zoom range. `deltaMode` is
normalized because Firefox commonly reports travel in lines rather than
pixels, and a single event's factor is clamped to 1.25 so one fast flick
cannot skip several zoom levels.

`ZOOM_STEP` (currently 1.15) is the single dial for how fast zooming
feels: the +/- buttons apply it per click, and `ZOOM_PER_PIXEL` is
*derived* from it so that one 100px mouse detent produces exactly the same
step. Tune that one constant rather than either input path, or the two
drift apart. Tested in `canvasBounds.test.ts`, which asserts the
button/detent equality against `ZOOM_STEP` itself so the test survives
retuning.

<!-- ---- STREAM-D: user guide — document this feature here (see docs/superpowers/specs/PARALLEL.md) ---- -->
### In-app user guide (`src/components/guide/`)

A "?" button at the top-left of the sidebar header opens a right-side
slide-over drawer of searchable help pages. No router, no markdown
renderer, no new dependency — pages are plain TSX components, which is the
whole reason for the format: they can use the app's own CSS custom
properties and stay in the repo beside the code they describe.

- `types.ts` declares `GuideSection` (`id`/`title`/`order`/`keywords`/`Body`).
  `registry.ts` auto-loads every `./sections/*.tsx` via `import.meta.glob`,
  exactly as `src/lib/strokeSchema/registry.ts` does for stroke schemas, and
  sorts by `order` then `title`. **Dropping a file in `sections/` is the
  entire integration step** — there is no index to edit, so nothing ever has
  to be registered. Don't replace the glob with an explicit list.
- `registry.ts` also exports `filterGuideSections(sections, query)`, matching
  case-insensitively against `title` *and* `keywords`. `keywords` exists
  precisely so a user typing "tashkeel" finds a page titled "Type and text";
  when adding a section, list the words a calligrapher would type, not the
  words in the heading.
- `GuideLauncher.tsx` is the button plus the drawer, mounted as a single
  element from `Sidebar.tsx`'s header panel. Open/closed state is local to
  that component **by design** — reading the guide is not an edit, so it must
  never reach `App.tsx`'s state, the undo stack, or the saved-layout payload.
- `GuideDrawer.tsx` portals to `document.body` (same reason
  `MorphGlyphEditor` does — the sidebar is an overflow-hidden scrolling
  column that would clip a slide-over). It is deliberately mounted from
  `Sidebar.tsx` and **not** from `CanvasStage.tsx`: anything inside the Konva
  stage risks being baked into an export.
- The active section is *derived* (`filtered.find(id) ?? filtered[0]`) rather
  than stored, so narrowing the filter past the current selection can't leave
  the body pane showing a page that is no longer in the list.
- Focus moves to the search field on open and is restored on unmount to
  whatever was focused before (the "?" button). The drawer captures
  `document.activeElement` at mount instead of taking a ref, which keeps it
  independent of where it is mounted from.
- `sections/*.tsx` are written for calligraphers: no file paths, no type
  names, no architecture. `order` values leave gaps (10, 20, 30, 50, 70, 90,
  100) for feature pages added later.

<!-- ---- /STREAM-D ---- -->

### Sidebar structure

`Sidebar.tsx` is a large single component that reads/writes through props from `App.tsx`. Shared low-level form pieces (`SelectRow`, `ColorRow`, `RangeRow`, `CheckboxRow`, `PresetKeyboard`) live in `src/components/sidebar/FormControls.tsx`; the layer list is `src/components/sidebar/LayersPanel.tsx`. `src/components/sidebar/utils.ts` has one helper (`makeId`).

Its panels are ordered in **three tiers by scope**, each introduced by a
`SidebarTier` rule (a quiet labelled divider, deliberately lighter than a
panel title so it groups without competing):

| Tier | Panels |
|---|---|
| `document` | Start from a Template · Background & Grid · Project & Export |
| `canvas` | Block Controls · Layers · Align & Arrange |
| `selected` | Content · *type panel* · Typography · Transform · Effects |

Then Shortcuts, outside any tier. The point of the split is that every
panel which appears and disappears with the selection sits in one
contiguous run, instead of interleaving with the permanent ones.

Two naming rules in the `selected` tier are worth knowing before adding a
panel there:

- **The *type panel* is named after the block type** — `Shape Fill`,
  `Curve`, `Image` — and holds only what is specific to it (a Shape Fill
  block's scale/spacing/rotation rows, a Curve block's preset and pen-tool
  controls). It renders directly under Content, above the
  shared panels, because for those types it is the panel that matters
  most. A plain text block has no type panel; its controls are the shared
  ones.
- **`Typography` is the shared styling panel** (font family, size,
  colour, alignment, line height, plus the text-only Warp and Kashida
  sections). It is *not* called "Text" precisely because it renders for
  shape and curve blocks too, where a panel named "Text" sitting beside
  one named "Shape Fill" reads as two competing type panels.

`Transform` is therefore left holding only rotation — the one transform
every type shares. Anything type-specific that lands there belongs in the
type panel instead.

`Content` owns everything that puts characters into the block: the RTL
textarea, the Arabic Keyboard toggle, and the `PresetKeyboard` rows
(إعراب, Presets, Specials, Urdu-Farsi) that were once a separate "Arabic
Helpers" panel. That name is gone — character insertion lives in exactly
one place now.

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

<!-- ---- STREAM-B: kashida auto-justify — document this feature here (see docs/superpowers/specs/PARALLEL.md) ---- -->

### Kashida auto-justify (`src/lib/justify.ts`)

The block-level Kashida dial described above stays exactly as it was — this
feature only decides *which* dial value to pass it. Sidebar → Typography →
**Fit width** offers "Fit to composition" and "Match block"; both reduce to a
single target width, which `App.tsx`'s `justifyBlock` solves for and applies
through the **existing** `setBlockKashidaAmount`. That one call already carries
the factor distribution, the debounced history push, and the re-render, so no
renderer, no type, and no other handler changes.

**The trap this feature is built around: nothing else in the app knows how wide
a *stretched* run is.** `ShapedText.tsx`'s glyph-metrics memo takes each glyph's
box from the raw font outline and never applies `glyphEdits`, and
`penX += advance` is deliberately untouched by stretching — so the block's
bounds, its hit boxes, and its Konva client rect are all the *unstretched* width
and do not move when the dial does. A solver reading any of them converges
silently to nonsense. `measureStretchedRunWidth` therefore replays
`ShapedText`'s *drawing* loop (pen advance, `dx`/`dy`, `fontSize / unitsPerEm`
scale, per-contour index) and pushes every outline coordinate through
`applyGlyphEdit` before taking the extent. That function is **imported, never
reimplemented** — a divergence there would optimise a width the user never sees,
and nothing would fail loudly. Glyph rigs, per-glyph transforms, diacritic
overrides, and warp are deliberately excluded: the dial doesn't move them, so
they are a constant offset the solver cannot see anyway. `measureStretchedRunWidth`
must also be handed the **same `joinPins`** `ShapedText` is rendering with (both
come from `lib/joinPins.ts`'s `computeJoinPins`) — for exactly the same reason it
imports rather than reimplements `applyGlyphEdit`: measuring unpinned ink while
the renderer pins it would optimise a width the render never actually produces.

`applyKashidaAmountToEdits` used to duplicate `setBlockKashidaAmount`'s
`factor = 1 + (maxFactor - 1) * (amount/100) * (priority/10)` formula by hand,
because the solver has to evaluate dozens of candidate dial positions without
touching state. That duplication is gone: the formula now lives once, in
`src/lib/kashidaFactor.ts`'s `kashidaFactorForHandle`, and both
`setBlockKashidaAmount` and `applyKashidaAmountToEdits` call it. **The two
call sites must stay fed the same inputs**; if they ever diverged again the
solver would report a width that applying its own answer would not produce —
nuqta quantization (see above) is exactly the kind of change that would have
silently split them apart if the formula still lived twice.

`solveKashidaAmount` bisects `[0, 100]` (width is monotonically non-decreasing
in the dial, which is what makes that safe), default tolerance 0.5px. Both ends
are special-cased rather than bisected into: already wide enough at 0 returns 0,
so a fit never *adds* stretch that wasn't asked for; still short at 100 returns
`{ amount: 100, reachable: false }` and the sidebar reports the shortfall in one
quiet line rather than throwing or doing nothing.

**"Fit to composition" targets the other blocks, not an artboard.** This app has
no fixed artboard — `CanvasStage` derives its content box from the blocks' own
bounding box — so "fit to the canvas" is circular: widening the block widens the
canvas. The target is `getBlocksBoundingBox` over every block *except* the one
being justified, less the margin per side (editor state in `App.tsx`, not on the
block, not persisted). "Match block" needs exactly two selected blocks and uses
the other one's client rect.

`App.tsx` reaches `lib/justify.ts` through a dynamic `import()`, and `justify.ts`
reaches `shapeText`/`FONT_URLS` the same way. That is not stylistic: a static
`harfbuzzjs` import in this module's graph throws under Vitest's Node ESM loader
the moment `justify.test.ts` evaluates it — the same constraint that keeps
`diacritics.ts` harfbuzz-free, and what lets `justify.test.ts` shape real text
with real harfbuzzjs against real fonts instead of hand-written glyph fixtures.

Gated to the block types `setBlockKashidaAmount` already accepts (everything but
`image` and `textPath`). Note that `measureStretchedRunWidth` measures the
straight shaped run, so on a Shape Fill block it is the *underlying run's*
ink width, which that renderer then tiles — the fit is exact only for plain
text blocks.
<!-- ---- /STREAM-B ---- -->

### Undo/redo and grouping

`src/hooks/useUndoRedo.ts` is a generic snapshot-stack hook (`getSnapshot`/`applySnapshot` callbacks); `App.tsx`'s `pushHistory()` wraps it and is called at the start of nearly every mutating handler (before the state change, so undo restores pre-change state). Blocks can share a `groupId` (assigned via the Layers panel's pairwise "merge" UI or the multi-select "Group selected" action) so that dragging one moves every block with the same `groupId` together; `dissolveSingletonGroups()` cleans up groups that drop to one member after a delete.

### Export (`src/hooks/useExport.ts`)

PNG/JPEG/PDF use `stage.toDataURL()`; SVG uses `react-konva-to-svg`. All four temporarily hide the on-screen alignment grid (`Konva.Group#grid-lines`) and, if "transparent background" is checked, the artboard background rect (`#artboard-background`) via `stage.findOne(...)`, so neither ever gets baked into exported output.

<!-- ---- STREAM-C: export — document this feature here (see docs/superpowers/specs/PARALLEL.md) ---- -->

#### Export options, clipboard copy, export-all, and presets

Every handler in `useExport.ts` now takes `boolean | { scale?, transparent?,
baseName? }`. The bare boolean is still accepted **on purpose**: it is what
`App.tsx`'s existing JSX call sites pass (`handleExportPNG(transparentExport)`),
and with no options supplied each handler is byte-identical to what it did
before — `scale` defaults to the old hardcoded `pixelRatio: 2`, `baseName` to
`calligraphy`, JPEG quality stays `0.92`, and the PDF keeps its 96dpi px→mm
conversion.

`handleCopyPNG(opts)` writes a PNG to the system clipboard and **returns a
`{ ok }` result rather than throwing**, matching how the rest of the hook
already reports "no stage"/"no blocks" by returning early; the sidebar shows
`reason` verbatim. Two non-obvious pieces:

- `navigator.clipboard?.write` and `ClipboardItem` are both absent in
  non-secure contexts and some browsers, so they are feature-detected up front
  and reported — a copy button that silently does nothing is worse than one
  that explains itself.
- The `ClipboardItem` is handed a **promise** of the blob, not an awaited blob.
  Safari only honours `clipboard.write` when the item is constructed
  synchronously inside the user-gesture task, and the render is async; the
  promise form is equally valid in Chrome and Firefox, so there is one path.
  Nothing in `handleCopyPNG` awaits before `clipboard.write`, which is what
  keeps that call inside the gesture — inserting an `await` above it breaks
  Safari and nothing else, so it will look fine in testing.
- The data URL is decoded to a `Blob` with `atob`, not `fetch(dataURL)`, since
  a `connect-src` CSP can block fetching `data:` URLs.

`handleExportAll(opts)` writes several formats from a **single**
`withExportAdjustments` pass instead of one pass per format, with both lazy
imports (`react-konva-to-svg`, `jspdf`) awaited *inside* that pass so the stage
is still in export state when they resolve. It honours an `opts.formats` list
(all four by default). Transparency is applied to PNG and SVG only; the
background node is briefly turned back on around the JPEG and PDF rasterizes,
because neither format has an alpha channel and a transparent request would
otherwise come out black. The downloads are sequenced with a short `await`
between them — browsers throttle downloads fired in one tick, and that is
cheaper than adding a zip dependency.

`src/lib/exportPresets.ts` holds `ExportPreset` (id/name/scale/transparent/
formats) plus `loadPresets`/`savePresets` (best-effort `localStorage` under
`harfcanvas-export-presets-v1`, same try/catch-and-fall-back-to-defaults
pattern as the named-project and glyph-rig stores) and the pure
`upsertPreset`/`removePreset` list functions, which is where the test coverage
is — jsdom can't rasterize, so the canvas-touching handlers aren't unit
testable. `loadPresets` filters out malformed entries and falls back to
`DEFAULT_PRESETS` when nothing usable survives. Presets are **local-only** and
deliberately not wired into the Supabase store, which is for named projects;
they are not part of a saved project either.

Preset state lives in `App.tsx` and is threaded to `Sidebar.tsx` like every
other piece of state. Selecting a preset loads its values into the scale /
transparency / format controls (so what it will do is visible before running),
while Run always exports from the preset's own stored values. Saving
overwrites by name, matching the named-project store.

<!-- ---- /STREAM-C ---- -->

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

- **Per-glyph move & scale on Shape Fill and text-on-path blocks** — Implemented for plain text only. `src/lib/diacriticPlacement.ts`'s adapters are the nearest existing precedent for expressing another renderer's coordinate space, but they were authored for placing *diacritic marks*, not for a general per-glyph transform — treat them as a starting point to evaluate, not as a drop-in that makes this cheap. Each renderer's coordinate space needs its own design and verification pass. Text-on-path is excluded for the same reason every other per-glyph tool is, its glyphs being rotated to a curve tangent.

- **Per-glyph rotation** — The move/scale handles cover translation and axis-aligned scale only. Rotation needs a fourth handle and its own pivot decision.

- **Stretch tool and glyph-edit handles on text-on-path blocks** — The axis-derivation and per-glyph drag mathematics assume glyphs sit in a straight bounding box. Making them work once glyphs are rotated to follow a curve's tangent is a real design problem, not a trivial extension of the existing system.

- **Parametric bezier schema rendering** — The stroke schema currently supplies only metadata (labels, kashida eligibility, protected-zone advisories) plus its own authored geometry (used only to derive stretch axes). It does not render letterforms itself — real fonts and HarfBuzz shaping remain the source of truth. Building a full parametric rendering engine that replaces per-font glyph outlines would be a much larger, separate feature; confirm scope before attempting it. **Scoped and deferred again 2026-08-12:** it was considered as the route to Kaleam-style stroke editing and rejected for now, because the schemas carry no joining geometry — drawing from skeletons would forfeit seamless letter joining, which is the property the request was actually about. Repairing the existing displacement engine to honour the schema comes first; see the "Known defects" section above and `docs/superpowers/specs/2026-08-12-per-stroke-editing-design.md`. Note also that `public/fonts/` already ships `Thuluth.ttf`, `ThuluthDeco.ttf` and `Ruqaa.ttf`, so those proportions do **not** require a parametric engine.

- **Schema protectedZones enforcement** — A schema stroke's `protectedZones` are advisory text only and are never read during glyph editing. Enforcing them in the rendering would require a separate design to scope per-stroke edits by the schema's own geometry rather than by the real font's actual outline point indices.

- **Join-pin detection for abutting-but-not-overlapping glyphs** — `lib/joinPins.ts`'s `overlapCentroid` finds a join only where two adjacent glyphs' real outlines physically overlap; measured 2026-08-13 (`joinPins.fonts.test.ts`, 7 fonts × 6 words), 5 of 42 pairs (`Urdu/حرف`, `Urdu/سلام`, `Urdu/حَرْف`, `Urdu/مُحَمَّد`, `Thuluth/سلام`) shape to multiple glyphs that merely abut, so no pin is placed and those joins keep the pre-existing tearing behaviour. Deliberately **not** improvised with a dilation radius: dilate enough to catch abutting letters and false joins start getting manufactured between letters that merely pass near each other without connecting, and the spec already rejected a baseline-scan heuristic for assuming Naskh-shaped geometry. Extending detection to this case is new design work, not a tuning knob on the existing one.

- **Mark detection for fonts that encode marks in the Private Use Area** — `lib/diacritics.ts`'s `findDiacriticGlyphIndices` keys on a mark's own cmap codepoint, with a nonzero-GPOS-offset fallback. `Thuluth.ttf` defeats both (PUA codepoints, marks positioned by advance), so on that font the per-mark diacritic overlay does not arm and, since 2026-08-13, join pins on vocalized text find nothing either. A third signal — e.g. reading the font's own GDEF glyph classes, which mark up mark glyphs directly — would fix both features at once, but it touches the detector every diacritic feature depends on and deserves its own real-font verification pass rather than being bolted on beside a join fix.

- **Join pins on Shape Fill and text-on-path blocks** — Plain text only, per the 2026-08-13 decision. `ShapeFillText` tiles its run through a per-tile affine transform; computing pins in that space is separate work, deliberately deferred rather than attempted alongside the plain-text fix.

- **Automatic line-justification via Kashida** — The Kashida block-level dial (0–100) is manual only; it distributes one slider across every kashida-eligible stroke in a block. The app currently has no "fit text to width" infrastructure to hook automatic justification into.

- **Image trace** — Auto-tracing a raster image into a silhouette shape existed on Shape Warp blocks and was removed with that block type. Rebuilding it for Shape Fill means restoring `lib/imageTrace.ts`, `ImageTraceDialog.tsx`, and the `imagetracerjs` dependency from git history; the tracing itself was block-type agnostic, producing the same `{ pathData, w, h }` shape `extractSvgPaths` returns.

### Vite/Rolldown quirk

`vite.config.ts` manually aliases `opentype.js` to its prebuilt ESM file because the package has no `exports` field, which breaks Rolldown (Vite 8's bundler) resolution otherwise. If upgrading `opentype.js` or Vite, re-check this alias still resolves.

`imagetracerjs` had the **same** missing-`exports` problem and its own version-numbered entry filename, needing a second alias pinned in lockstep with the dependency. Both are gone — the package was removed along with Shape Warp and its "Trace image" input. If image tracing ever returns, that alias and the exact version pin have to return with it.
