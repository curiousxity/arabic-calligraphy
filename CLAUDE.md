# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HarfCanvas — a browser-based Arabic calligraphy design tool (React 19 + TypeScript + Vite, canvas rendering via Konva/react-konva). Users compose text, SVG-shape, and image blocks on a resizable artboard and export to PNG/JPEG/SVG/PDF.

### Which document to write in

Four docs, four jobs. Putting content in the wrong one is how they drift
into contradicting each other.

| | holds | organised by |
|---|---|---|
| **this file** | cross-cutting architecture, commands, and a one-line index of every subsystem note | — |
| `.claude/rules/<subsystem>.md` | how a subsystem works and why, and the traps in it — with `paths:` frontmatter so it loads only when relevant | subsystem |
| `PROGRESS.md` | what shipped when, what is known-broken, what is blocked | date / status |
| `docs/superpowers/specs/` | the argument for a design, and its open questions | feature |

`README.md` is outward-facing and describes the product, not the code.

The rule that keeps them honest: **state a fact in one place and link to it
from the others.** A limitation explained in full in a subsystem note gets one
line and a pointer in `PROGRESS.md`, not a second copy that will rot.

**A new feature's write-up goes in a new `.claude/rules/` file, not here** —
give it a `paths:` list (a rule with no `paths` loads on every session, which
defeats the point) and add one line to "Subsystem notes" at the bottom.

## Commands

```bash
npm run dev       # start dev server
npm run build     # tsc -b && vite build
npm run lint      # eslint .
npm test          # vitest run (all tests, single pass)
npx vitest run path/to/file.test.ts   # run a single test file
npx vitest        # watch mode
npx tsc --noEmit -p tsconfig.app.json # typecheck only, no build output
npm run e2e       # playwright test (browser suite — see "End-to-end tests")
npm run e2e:ui    # playwright's interactive runner
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
- **`ImageBlockView.tsx`** — loads a data-URL image and draws it via Konva `Image`.

`ShapedText.tsx`, `ShapeFillText.tsx`, and `TextOnPathText.tsx` each reimplement their own SVG-path-replay-to-canvas-context helper (`replayPath`/`tracePath`) because Konva's context wrapper doesn't support `Path2D` — this duplication is known and intentional, not an oversight to "fix" by extracting a shared helper (their fill/clip logic differs enough that past attempts kept them separate).

All three draw a block's **outline before its fill**, not after. A canvas stroke straddles the path it follows, so stroking after the fill lays half the outline's width back over the letter, thickening every stem and closing counters as the width rises; filling over the stroke hides that inner half and leaves the letterform at its designed weight. `strokeWidth` therefore reads as the visible outline, and reversing the order in any one renderer would silently make that block type's outlines twice as heavy as the others'.

Selected/grouped/multi-selected blocks currently have **no persistent on-canvas outline** (a dashed selection-box `Transformer` was tried and explicitly removed per user feedback) — the two exceptions are: a small drag-to-resize corner handle shown only on the *selected* `shapeFill`/`image` block, and the coloured per-glyph hover handles (move/scale, diacritics) on the selected block. Don't reintroduce a general selection bounding box without checking this history.

### Arabic text shaping pipeline (`src/lib/harfbuzz.ts` + `src/hooks/useShapedGlyphs.ts`)

Text is shaped with real HarfBuzz compiled to WASM (`harfbuzzjs` npm package, loaded async), not a JS approximation. `shapeText(text, fontUrl)` loads the font bytes, shapes via HarfBuzz (`rtl` direction, `arab` script), and returns glyph IDs/advances plus the font parsed by `opentype.js` (used afterward to fetch actual glyph outlines for Konva drawing). Results are cached by `text|fontUrl` in-memory (`shapeCache`); call `clearShapeCache()` if a font file changes at the same URL. `FONT_URLS` (in `useShapedGlyphs.ts`) maps font-family keys to `/fonts/*.ttf|otf` — this is the single place new fonts get registered for the app to shape with.

Most of `src/lib/` has real test coverage — `*.test.ts` files beside the
modules they cover. One convention in there is worth knowing before adding
another:

- **Anything that needs real shaping must use real harfbuzzjs and real fonts
  from `public/fonts/`**, never hand-written `{ g, cl }` fixtures.
  `diacritics.test.ts` is the precedent. This is not a style preference: a
  fabricated-fixture suite is exactly what let the cluster-lookup bug ship
  unnoticed once. Copy its `shapeReal` helper rather than inventing a second
  loading mechanism — harfbuzzjs must be pulled in via `createRequire`,
  because a static ESM import of it throws under Vitest's Node ESM loader
  before any test code runs.

(A second convention used to live here: some suites were *characterizations*
rather than guards, pinning measured reality so a change became visible.
Every one of them belonged to the removed stroke subsystem and went with it.
The idea is still a good one if a future measurement wants pinning.)

### Undo/redo and grouping

`src/hooks/useUndoRedo.ts` is a generic snapshot-stack hook (`getSnapshot`/`applySnapshot` callbacks); `App.tsx`'s `pushHistory()` wraps it and is called at the start of nearly every mutating handler (before the state change, so undo restores pre-change state). Blocks can share a `groupId` (assigned via the Layers panel's pairwise "merge" UI or the multi-select "Group selected" action) so that dragging one moves every block with the same `groupId` together; `dissolveSingletonGroups()` cleans up groups that drop to one member after a delete.

### Vite/Rolldown quirk

`vite.config.ts` manually aliases `opentype.js` to its prebuilt ESM file because the package has no `exports` field, which breaks Rolldown (Vite 8's bundler) resolution otherwise. If upgrading `opentype.js` or Vite, re-check this alias still resolves.

`imagetracerjs` had the **same** missing-`exports` problem and its own version-numbered entry filename, needing a second alias pinned in lockstep with the dependency. Both are gone — the package was removed along with Shape Warp and its "Trace image" input. If image tracing ever returns, that alias and the exact version pin have to return with it.

## Subsystem notes — `.claude/rules/`

Each subsystem's full write-up — how it works, why, and the traps in it —
lives in its own file under `.claude/rules/`. Each file carries `paths:`
frontmatter, so Claude Code loads it automatically when a matching file is
read; it does not cost context otherwise. **Before changing a subsystem
through a file its globs don't cover (typically `App.tsx`, `Sidebar.tsx`,
`CanvasStage.tsx` or a renderer), open its note first.** The one-liners
below are the trap most likely to bite, not a substitute for the note.

- **Deployment** — [`.claude/rules/deployment.md`](.claude/rules/deployment.md). Cloudflare Workers, deploys on push to `main`. Needs **both** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets — wrangler's error names the wrong one. `hb.wasm` must serve as `application/wasm`. Supabase is off in production.
- **Mirror blocks** — [`.claude/rules/mirror-blocks.md`](.claude/rules/mirror-blocks.md). A mirror draws its source's own renderer live; props go through `blockRenderProps.ts` (hand-mapping dropped fields four times). One level only; orphans removed by an effect that deliberately does not `pushHistory`.
- **Kashida elongation** — [`.claude/rules/kashida.md`](.claude/rules/kashida.md). Inserts real tatweel characters; `applyKashida` is absolute, a slot is a letter pair. Any tatweel-inserting handler must go through `kashidaTextPatch` so text-offset-keyed data (stroke cuts) is remapped.
- **Fit to width** — [`.claude/rules/fit-to-width.md`](.claude/rules/fit-to-width.md). Pure solver with injected measurement (keeps it Vitest-importable); never overshoots; renderer imports `ITALIC_SHEAR`/`fauxBoldStrokeWidth` from it. Style terms come from `runStyleForBlock` only.
- **Per-instance diacritic control** — [`.claude/rules/diacritics.md`](.claude/rules/diacritics.md). Marks are found by glyph identity plus a per-cluster allowance, never by cluster lookup. Hover handlers belong on the per-placement `Group`, not the hit `Rect` (Konva leave race). Capability guards live in `blockCapabilities.ts`.
- **Per-glyph move, scale & rotate** — [`.claude/rules/glyph-transform.md`](.claude/rules/glyph-transform.md). Rotation sits *inside* the scale (outside passes every test at rotation 0 and ships broken). Boxes are raw, transforms applied by the overlay; pivots via `glyphPivot`; stale transforms filtered by `filterActiveGlyphTransforms`. Shape Fill caps placements to one per glyph index.
- **Removed: Morph Glyph Editor** — [`.claude/rules/removed-subsystems.md`](.claude/rules/removed-subsystems.md). Removed 2026-08-14 (kashida dial never widened anything). Read `docs/archive/nuqta-measurements.md` before resurrecting anything; `stripMorphFields` drops its fields from old saves. `arabicJoining.ts` is kept deliberately.
- **Straight-stroke cuts** — [`.claude/rules/stroke-cuts.md`](.claude/rules/stroke-cuts.md). Cut lines are perpendicular to the stroke (swept angles), straightness is per-edge bow. Cuts are stored in font units; `strokeCuts.ts` must not import `./harfbuzz`.
- **Square kufi** — [`.claude/rules/square-kufi.md`](.claude/rules/square-kufi.md). Loads no font — text → forms → cells → one traced outline. Alphabet table is checked structurally (no 2×2, joins on baseline). `layoutSquareKufi` has proven perf cliffs; cell edits are anchored to letters; options only via `kufiOptionsFor`.
- **Text on path** — [`.claude/rules/text-on-path.md`](.claude/rules/text-on-path.md). Curve stored as SVG `d`; text auto-scales to curve length (`fontSize` inert). Per-glyph tools deliberately excluded.
- **User-uploaded fonts** — [`.claude/rules/custom-fonts.md`](.claude/rules/custom-fonts.md). IndexedDB-backed; `customFonts.ts` must not import `./harfbuzz`. Always resolve URLs through `resolveFontUrl`, never index `FONT_URLS` directly.
- **Bundled fonts & PUA glyphs** — [`.claude/rules/bundled-fonts.md`](.claude/rules/bundled-fonts.md). Font files carry ten merged honorific glyphs — derive the list from `PRESETS`, never a range. Adding a font is a four-place edit (file, `@font-face`, `FONT_OPTIONS`, `FONT_URLS`) plus the glyph merge; OFL renames apply.
- **Bounds-aware snapping** — [`.claude/rules/snapping.md`](.claude/rules/snapping.md). Pure `snapping.ts`; targets measured once per gesture on the first move frame; snap re-run in `onDragEnd`; at most one snap per axis.
- **Artboard** — [`.claude/rules/artboard.md`](.claude/rules/artboard.md). Size stored in px at the config's dpi, so export ratio is 1 with a page. `null` is freeform and what old saves load as. Editor-only nodes carry the `EXPORT_HIDDEN` name.
- **Canvas pan and zoom** — [`.claude/rules/pan-zoom.md`](.claude/rules/pan-zoom.md). Zoom is exponential in wheel travel; `ZOOM_STEP` is the single dial. Grid draws at `1 / stageScale`.
- **In-app user guide** — [`.claude/rules/user-guide.md`](.claude/rules/user-guide.md). Dropping a file in `guide/sections/` is the whole integration (glob, no index). Guide state never reaches `App.tsx`. Written for calligraphers, not developers.
- **Sidebar structure** — [`.claude/rules/sidebar.md`](.claude/rules/sidebar.md). Panels in three tiers (document / canvas / selected); type panel is named after the block type, shared styling is `Typography`. Grid/flex children need `min-width: 0`. Renaming a button means updating `e2e/` selectors.
- **Ornament & frame library** — [`.claude/rules/ornaments.md`](.claude/rules/ornaments.md). One TS module per ornament, auto-globbed. Built from primitives only (licensing); no SVG `A` commands; holes via doubled-back bridge.
- **Name designs** — [`.claude/rules/name-designs.md`](.claude/rules/name-designs.md). No new primitive — composes mirrors and image frames from a measured run. Medallion radius is driven by run *height*. One `pushHistory()` per design; block captured by id.
- **Text styles & palettes** — [`.claude/rules/styles-palettes.md`](.claude/rules/styles-palettes.md). Local-only `localStorage` lists; `STYLE_FIELDS` is the single field list. Palette defaults live in code, never storage.
- **Ink & surface** — [`.claude/rules/ink-surface.md`](.claude/rules/ink-surface.md). Absent `fill` means flat `color` (old saves byte-identical). Gradients go through `createBlockFillPainter` or they restart per glyph. Textures are generated and must tile seamlessly.
- **Export** — [`.claude/rules/export.md`](.claude/rules/export.md). Handlers accept a bare boolean for back-compat. `handleCopyPNG` must not `await` before `clipboard.write` (Safari). Export-all uses one adjustments pass.
- **History thumbnails** — [`.claude/rules/history-thumbnails.md`](.claude/rules/history-thumbnails.md). Pure `historyStack.ts`; popover shows the past stack only. In-session only.
- **Cloud persistence** — [`.claude/rules/cloud.md`](.claude/rules/cloud.md). `supabase` is `null` without env vars and everything degrades to no-ops; cloud UI hidden via `cloudConfigured`.
- **End-to-end tests** — [`.claude/rules/e2e-tests.md`](.claude/rules/e2e-tests.md). Chromium only; specs live in `e2e/` (never `src/`); typecheck with `npx tsc --noEmit -p e2e/tsconfig.json`. `window.__HARF__` bridge is dev-only and read-only. Assert pixels coarsely.
- **Deferred features** — [`.claude/rules/deferred-features.md`](.claude/rules/deferred-features.md). Per-glyph tools on text-on-path, dots/tashkeel and spirals in square kufi, image trace. Stroke stretching on Shape Fill / text-on-path is **declined** (both renderers renormalise span).
