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
- **`ImageBlockView.tsx`** — loads a data-URL image and draws it via Konva `Image`.

`ShapeFillText.tsx` and `ShapeWarpText.tsx` each reimplement their own SVG-path-replay-to-canvas-context helper (`replayPath`/`tracePath`) because Konva's context wrapper doesn't support `Path2D` — this duplication is known and intentional, not an oversight to "fix" by extracting a shared helper (their fill/clip logic differs enough that past attempts kept them separate).

Selected/grouped/multi-selected blocks currently have **no persistent on-canvas outline** (a dashed selection-box `Transformer` was tried and explicitly removed per user feedback) — the two exceptions are: a small drag-to-resize corner handle shown only on the *selected* `shapeFill`/`image` block, and colored glyph-edit handles for `shapeWarp`. Don't reintroduce a general selection bounding box without checking this history.

### Arabic text shaping pipeline (`src/lib/harfbuzz.ts` + `src/hooks/useShapedGlyphs.ts`)

Text is shaped with real HarfBuzz compiled to WASM (`harfbuzzjs` npm package, loaded async), not a JS approximation. `shapeText(text, fontUrl)` loads the font bytes, shapes via HarfBuzz (`rtl` direction, `arab` script), and returns glyph IDs/advances plus the font parsed by `opentype.js` (used afterward to fetch actual glyph outlines for Konva drawing). Results are cached by `text|fontUrl` in-memory (`shapeCache`); call `clearShapeCache()` if a font file changes at the same URL. `FONT_URLS` (in `useShapedGlyphs.ts`) maps font-family keys to `/fonts/*.ttf|otf` — this is the single place new fonts get registered for the app to shape with.

`src/lib/normalizeGlyphs.ts` and `src/lib/svgPath.ts` have their own `*.test.ts` files — these are the two lib modules with actual test coverage; `warp.ts` also has a test.

### Font files carry custom glyphs — don't blindly replace them

`public/fonts/*.ttf|otf` are not stock font files. `FatemiMaqala.ttf` has 8 custom Private Use Area glyphs (U+E833-E840, honorific symbols used by the sidebar's "Presets" row) that were manually merged (via a Python `fontTools` script, not committed to the repo) into every *other* font file in `public/fonts/` too, so those symbols render regardless of the selected font. If a font file in `public/fonts/` is ever regenerated/replaced from an upstream source, those PUA glyphs will be lost and the Presets buttons will silently show missing-glyph boxes in every font except FatemiMaqala again.

### Sidebar structure

`Sidebar.tsx` is a large single component (selection-dependent panels: Styling, Align & Arrange, Shape Fill/Warp controls, Save/Export, Canvas Size, Arabic Helpers/Presets) that reads/writes through props from `App.tsx`. Shared low-level form pieces (`SelectRow`, `ColorRow`, `RangeRow`, `PresetKeyboard`) live in `src/components/sidebar/FormControls.tsx`; the layer list is `src/components/sidebar/LayersPanel.tsx`. `src/components/sidebar/utils.ts` has one helper (`makeId`).

CSS is one global stylesheet (`src/index.css`) using CSS custom properties for theming — navy+gold is the unconditional default (`:root`), with an ivory/parchment palette under `@media (prefers-color-scheme: light)` (inverted from the usual light-default/dark-override convention — check this file's structure before assuming which block is "the default").

Known CSS-layout footgun in this codebase: **CSS Grid and Flex children default to `min-width: auto`**, which refuses to shrink below content size and causes silent overflow/clipping at narrow sidebar widths. When adding a new multi-item row (grid or flex), give items `min-width: 0` explicitly or the row will overflow at the sidebar's minimum width instead of degrading gracefully.

### Two files exist but are not wired into the app

`src/components/SidebarPresets.tsx`, `src/components/CircularShapedText.tsx`, and `src/lib/opentype-mini.ts` are not imported anywhere in `src/` — they're leftover/unused. Don't assume they're load-bearing; don't delete them without checking with the user first (unclear if they're intentionally kept for future use).

### Undo/redo and grouping

`src/hooks/useUndoRedo.ts` is a generic snapshot-stack hook (`getSnapshot`/`applySnapshot` callbacks); `App.tsx`'s `pushHistory()` wraps it and is called at the start of nearly every mutating handler (before the state change, so undo restores pre-change state). Blocks can share a `groupId` (assigned via the Layers panel's pairwise "merge" UI or the multi-select "Group selected" action) so that dragging one moves every block with the same `groupId` together; `dissolveSingletonGroups()` cleans up groups that drop to one member after a delete.

### Export (`src/hooks/useExport.ts`)

PNG/JPEG/PDF use `stage.toDataURL()`; SVG uses `react-konva-to-svg`. All four temporarily hide the on-screen alignment grid (`Konva.Group#grid-lines`) and, if "transparent background" is checked, the artboard background rect (`#artboard-background`) via `stage.findOne(...)`, so neither ever gets baked into exported output.

### Vite/Rolldown quirk

`vite.config.ts` manually aliases `opentype.js` to its prebuilt ESM file because the package has no `exports` field, which breaks Rolldown (Vite 8's bundler) resolution otherwise. If upgrading `opentype.js` or Vite, re-check this alias still resolves.
