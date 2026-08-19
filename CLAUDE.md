# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HarfCanvas — a browser-based Arabic calligraphy design tool (React 19 + TypeScript + Vite, canvas rendering via Konva/react-konva). Users compose text, SVG-shape, and image blocks on a resizable artboard and export to PNG/JPEG/SVG/PDF.

### Which document to write in

Three docs, three jobs. Putting content in the wrong one is how they drift
into contradicting each other.

| | holds | organised by |
|---|---|---|
| **this file** | how a subsystem works and why, and the traps in it | subsystem |
| `PROGRESS.md` | what shipped when, what is known-broken, what is blocked | date / status |
| `docs/superpowers/specs/` | the argument for a design, and its open questions | feature |

`README.md` is outward-facing and describes the product, not the code.

The rule that keeps them honest: **state a fact in one place and link to it
from the others.** A limitation explained in full here gets one line and a
pointer in `PROGRESS.md`, not a second copy that will rot.

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


### Mirror blocks — muthanna and radial (`src/lib/mirror.ts`, `MirrorBlockView.tsx`)

`mirror` is a fifth `Block` variant that draws **another block's content**
under a transform: a reflection (`mirrorX` / `mirrorY`, the classical
muthanna) or `radialCount` copies turned around a centre (a medallion or
shamsa). It is the one primitive both compositions reduce to.

- **It has no content of its own.** `sourceId` is resolved against `blocks`
  inside `CanvasStage`'s render map on every render, and `MirrorBlockView`
  mounts the *source's own renderer* (`ShapedText` / `ShapeFillText` /
  `TextOnPathText` / `ImageBlockView`) inside transform wrapper groups. That
  lookup is the entire "stays live as the source is edited" mechanism — there
  is no sync machinery, and nothing to keep in step. It also means every
  block type is mirrorable without touching the four render algorithms this
  file elsewhere refuses to merge.
- **Position is its own.** The transform applies to the source's *content*,
  never to the source's place on the canvas — the user drags a mirror
  independently, which is how the two halves of a muthanna are brought
  together.
- **One level only.** A mirror may never be a mirror's source. This is
  checked when creating (`App.tsx`'s `mirrorSourceCandidate` gates both add
  buttons) *and* when resolving (`resolveMirrorSource` returns null for a
  mirror source), so the renderer cannot recurse even from a hand-edited save.
  Nesting is a deferred feature, not an oversight.
- **The inner content is `listening={false}`**, so no per-glyph hover overlay
  can ever mount inside a mirror and the source's own drag surface cannot
  swallow the gesture. `MirrorBlockView` passes none of those overlays' arming
  props either — belt and braces, since a Konva node is non-listening when any
  ancestor is.
- **Its drag surface therefore has to be measured.** The hit `Rect` is sized
  from `contentRef.getClientRect({ relativeTo: group })`, and the measurement
  runs in a short **rAF settle loop** rather than a plain effect: shaping is
  async and completes inside the *child*, which never re-runs a parent effect.
  The loop stops once the box holds still for a few frames and is hard-capped
  either way. Until it settles the block still has a small fallback grab area,
  never a zero-size one.
- **Radial geometry** lives in `radialCopyTransforms` (pure, tested). Copy *i*
  is turned `i · 360/count` degrees and pushed `radialRadius` along its own
  spoke — Konva rotates a Group about its own `(x, y)`, so setting both on the
  wrapper group needs no pivot arithmetic. Radius 0 stacks every copy on the
  centre, each still at its own angle.
- **Orphans.** A mirror whose source is gone renders nothing and is removed:
  on load by `dropOrphanedMirrors` in `applyParsedLayoutPayload` (the
  `shapeWarp`-filter precedent beside it), and at runtime by an effect over
  `blocks` in `App.tsx`. That effect deliberately does **not** `pushHistory` —
  the action that removed the source already pushed, and its snapshot holds
  both blocks, so one undo restores the pair. It lives in an effect rather
  than inside `deleteSelectedBlock` so every route to a vanished source is
  covered (delete button, Delete key, the Layers panel's own delete, a
  reorder).
- **Sidebar.** The type panel is `Mirror` (mode select, radial count/radius,
  and a "Select source" button that moves the selection to the source).
  Content and Typography are hidden for this type — a mirror has neither of
  its own — the same way `image` already hides them.


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

### Kashida elongation (`src/lib/tatweel.ts`, Sidebar → Typography)

Widening a run is done by inserting **tatweel** (U+0640, ـ) into the block's
own text between two letters that cursively join, not by deforming outlines.
This is the deliberate replacement for the removed stroke-stretch kashida
dial, which displaced outline points but never touched `penX += advance` and
so measurably never widened anything (see "Removed subsystems"). A tatweel is
a real character the font shapes: HarfBuzz draws the connecting stroke at the
letters' designed weight and the advance grows. `tatweel.test.ts` asserts
exactly that — total shaped advance strictly increasing with the count, in
three real fonts via real harfbuzzjs. **That assertion is the point of the
suite**; a fixture-based version of it would restate the assumption instead
of testing it.

`src/lib/tatweel.ts` is pure (no React, no Konva, no font loading) and is
meant to stay that way: the fit-to-width solver — choose counts across slots
to hit an artboard target — calls `findKashidaSlots`/`applyKashida`
unchanged. See "Fit to width" below; that discipline is what let the solver
be built without touching this module at all.

Three things about the slot model are load-bearing:

- **A slot is a letter *pair*, not a character position.** An existing run of
  tatweels between two letters is one slot whose count is the run's length,
  so the stepper reads and writes the same number and `applyKashida` is
  **absolute, not additive** (`count` replaces whatever is there). One slot
  per tatweel would make the control unreadable the moment it was used once.
- **Legality comes from `lib/arabicJoining.ts`**, which survived the Phase 0
  removal for this. A letter whose `classifyJoiningForms` form is `initial`
  or `medial` joins forward by definition, and the next character that has a
  form at all is the letter it joins to — an intervening space or other
  non-joiner would have made it `final`/`isolated` instead. That is why
  combining marks need no special handling in `findKashidaSlots`: they are
  already form-`null` and skipped. The one hand-written exclusion is
  **lam-alef**, which fonts fuse into a single ligature glyph that a tatweel
  would split into two unconnected letterforms.
- **Transparency inside a run** is the one thing `arabicJoining.ts` cannot
  answer (its `isTransparent` is private, and this stream may not edit that
  file), so `scanRun` uses `ARABIC_DIACRITIC_RE` from `lib/diacritics.ts` —
  the same ranges, as that module's own comment records. Marks are skipped
  only *inside* a run, never before one: a mark preceding the run belongs to
  the base letter and sits at a lower offset than the slot, which is what
  keeps a fatha on its beh when the join beside it is stretched.

The UI lives entirely between the `STREAM-D` anchors in `Sidebar.tsx`
(Typography → Kashida join + stepper) as an IIFE rather than a helper
component, because this stream owned no file to put a component in. It holds
no state: the counts come from `readKashida` of the block's current text, and
the selected slot is an **ordinal** into the slot list held in `App.tsx`
(`kashidaSlotOrdinal`) — deliberately not a text offset, since inserting
tatweels shifts every later offset but never reorders the slots. The Sidebar
clamps it against the current slot count, so an unrelated text edit can't
leave it out of range.

`App.tsx`'s `setKashidaAtSlot` routes through `updateSelectedBlock`, i.e. an
ordinary text edit with the usual `pushHistory()`. **Mutating the text is the
design, not a leak**: shaping, undo, saves, and every downstream consumer see
what they would see if the user had typed the tatweel from the Specials row.
The consequence is the glyph-index fragility already documented above — a
kashida inserted early in a string shifts the indices `diacriticOverrides` and
`GlyphTransform` are keyed by, exactly as any typed edit does. That is
surfaced to users in the guide ("apply kashida before fine-tuning marks")
rather than engineered around here.

Visible for every block type whose text is shaped for joining — the section
sits inside Typography's existing `type !== "image"` guard, so text, shapeFill
and textPath all get it with no separate gate.

Known and correct: some fonts substitute differently across a tatweel (الله
decomposes when interrupted). That is the font doing its job; offering only
legal joins is the guardrail, and the guide says so.

### Fit to width (`src/lib/fitToWidth.ts`, `lib/measureShapedText.ts`)

Chooses tatweel counts across a run's legal joins so the run spans a target
width. This is the replacement for `lib/justify.ts`, deleted with the Morph
subsystem — and the reason that one could never work is worth keeping in
view: the kashida dial it drove displaced outline points without touching
`penX += advance`, so the run's width never moved and there was nothing to
converge on. Tatweels are real characters the font shapes, so the width
genuinely changes.

Three things are load-bearing:

- **The solver is pure, and measurement is injected.** `solveFitToWidth`
  takes a `measure(text) => Promise<number>` callback rather than loading
  fonts, which is what keeps `fitToWidth.ts` importable by Vitest — the same
  discipline `tatweel.ts` and `diacritics.ts` already follow, and for the same
  reason (`harfbuzz.ts`'s static harfbuzzjs import throws under Node's ESM
  loader before any test code runs). The async half lives in
  `lib/measureShapedText.ts`, which is a five-line wrapper over `shapeText`
  plus the pure `inkExtentWidth`. **That split is why the solver's real-font
  tests exist at all**; fold the two together and the suite cannot import it.
- **`inkExtentWidth` mirrors `ShapedText`'s own metrics loop** — same pen
  walk, same `getPath(gx, gy, fontSize)` bounding boxes, same
  `fontSize / unitsPerEm` scale — so the number being optimised is the number
  the canvas draws. Summing advances would be cheaper and would measure a
  different thing: advances carry the run's trailing side bearing and miss ink
  overhanging its own advance, and both move as a join is stretched.
- **Candidates are always built from the caller's original text with
  absolute counts**, never added to the current state. That is what makes the
  operation idempotent — fitting an already-fitted run returns it unchanged
  rather than compounding — and it is only possible because `applyKashida` is
  absolute rather than additive.

`applyDistribution` applies slots **from the highest text offset down**.
`applyKashida` only rewrites text at and after `slot.index`, so working
right-to-left leaves every lower offset valid; left-to-right would shift each
later slot by whatever the earlier insertion added, and every slot after the
first would land in the wrong place.

The search does not count up from zero: one measurement at 0 tatweels and one
at 1 gives the per-tatweel delta, and `(target - width0) / delta` lands within
a step or two, after which it refines against real measurements. The
refinement is not ceremony — the delta is only *near* constant, because a font
may substitute different glyphs across a stretched join. **It never
overshoots**: text that spills past the width it was fitted to is a worse
answer than text a few pixels short, so the search settles on the last count
that fits. `MAX_REFINE_STEPS` bounds it either way.

**Distribution is even across every legal join** (`distributeKashida`,
remainder to the earliest slots). Piling the total onto one join reads as a
mistake rather than as elongation, and hits `MAX_KASHIDA_PER_SLOT` long
before a wide target is met.

**App/Sidebar.** The target defaults to the page's margin box — the content
area is what a line is meant to span — falling back to the page edges when the
margin is 0. `fitTargetWidth` in `App.tsx` holds only a user's *override*, so
`null` means "track the page" and a freeform document (no page at all) simply
requires a typed number. It is a control setting, not document state: neither
saved nor undoable, like the export scale beside it.
`fitSelectedBlockToWidth` **captures the block by id, not by reference** —
solving is async and the selection can change while it runs, so patching "the
selected block" on the way out would rewrite whatever the user selected in the
meantime. It routes through `updateBlock`, i.e. one `pushHistory()` for the
whole fit, and skips the write entirely when the result is unchanged so
clicking Fit on a fitted run costs no undo step.

Plain text only. The row sits inside the existing Kashida IIFE in Typography
under a `type === "text"` gate: a Shape Fill run is auto-scaled to span its
silhouette and a Curve run to span its curve, so on those types a width target
has nothing to act on — the same reason `fontSize` is hidden for a curve.

Inherits the glyph-index fragility every text edit has (see the kashida
section above); the guide says to fit before fine-tuning marks rather than
engineering around it.

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
lookup (what an earlier version of this function did) silently detects
nothing on real shaped text. The working detection is
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
`GlyphTransform` also uses, including that scheme's known fragility (a text
edit before a diacritic in the string can
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
`glyphHitBoxes` — only the currently-hovered diacritic ever shows handles, which is what
keeps text with many marks from becoming visual clutter.

**The hover handlers sit on the per-placement `Group`, not on the hit
`Rect`,** and that placement is the whole reason the handles stay put. Konva
fires `mouseleave` on the old target passing the newly-entered shape as
`compareShape` (`Stage`'s pointer retarget), and `Node._fireAndBubble`
suppresses it at any node that is an *ancestor* of that new shape. With the
handlers on the Rect — a *sibling* of the handle Circles — the moment a
mounted handle covered the pointer, the next mousemove was a genuine
Rect→Circle leave: hover cleared, the handle unmounted, and it was present on
exactly every other move. The same race killed any drag whose first step was
small, because Konva only suppresses hover processing once a drag reaches
`dragging` rather than while it is merely `ready`. Hanging the handlers on
the common ancestor makes Rect→Circle an internal move that fires no leave at
all. Moving them back onto the Rect reintroduces both symptoms; the measured
numbers are under "End-to-end tests". The move
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
pattern (`useDebouncedHistoryPush`) block dragging already established;
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
instances — that checkbox is also what gates `glyphInstances`'s memo and the
block's `dragBoundFunc` pin. Because overrides are keyed by glyph index, one
adjustment applies to every tiled repetition.

`App.tsx`'s `dragDiacriticOverride`/`toggleDiacriticHidden` gate on
`supportsDiacriticOverrides(b)` rather than `b.type === "text"`. Widening
that guard is what actually makes the feature work on the two shape types —
`diacriticOverrides` lives on `BlockCommon`, so a narrower guard type-checks
perfectly while silently discarding every edit.

Text-on-path blocks remain unsupported — their glyphs are rotated to a
curve tangent, which is separate design work.

### Per-glyph move & scale (`src/lib/glyphTransform.ts`, `GlyphTransformHoverHandles.tsx`)

Plain text blocks support rigidly moving a single shaped glyph and
stretching or shrinking it as a whole in x or y — a second per-glyph system
alongside `diacriticOverrides` (uniform scale plus vertical offset, marks
only). Ticking "Move & scale glyph" in Sidebar → Typography arms it; hovering
a letter then shows three dots — blue to move, gold to scale x, green to
scale y.

`GlyphTransform` (`types.ts`: `offsetX`/`offsetY`/`scaleX`/`scaleY`, all
defaulting to the identity) is applied in `ShapedText.tsx`'s
`drawWarpedGlyphRun` as a `ctx.translate`/`ctx.scale` pair placed inside the
existing `ctx.translate(gx, gy)` — which is what makes the pivot the glyph's
**pen origin** (on the baseline, at the start of its advance) with no pivot
arithmetic, so a scaled letter keeps sitting on the baseline. It is the
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
transformed variant; the diacritic placements get the raw one, because they
reason in raw outline space and a folded-in transform would misalign them.
(Before the Morph subsystem was removed this raw/transformed split had
several more consumers on the raw side; keep it even now that it has one, or
the placements silently drift.) The block-level `bounds` in that same loop
are deliberately raw too: they
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

`GlyphTransformHoverHandles` mounts **before** `DiacriticHoverHandles` in
`ShapedText`'s JSX: Konva routes a pointer to the topmost listening shape,
these rects are glyph-sized, and a mark's hit target is smaller and sits
inside one. Mounted later they would steal hover from every mark.

Transforms are keyed by glyph index and share that scheme's fragility, but
both systems are now re-validated each render. `diacriticOverrides` are
filtered against `findDiacriticGlyphIndices`, so a stale override landing on
a base letter is dropped. A transform has no such signal — every glyph is a
legitimate target — so it instead records the **`glyphId` it was made for**,
and `ShapedText`'s `activeGlyphTransforms` drops one whose recorded id no
longer matches the glyph at that index. `glyphId` is optional on purpose: a
transform saved before the field existed cannot be validated, so it keeps the
original behaviour of applying to whatever glyph now holds its index rather
than being silently discarded. Every write goes through
`GlyphTransformHoverHandles`' one `applyPatch` helper, which is what keeps the
three drag handlers from each having to remember to stamp it.

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

### Removed subsystems — the Morph Glyph Editor and everything under it

Removed wholesale on **2026-08-14**. What went: the Morph Glyph Editor panel
and its Stretch tool, the stroke schemas (`src/lib/strokeSchema/`, 105 JSONs),
the per-font stroke spines (`src/lib/strokeSpines/`, 30 tables), glyph rigs,
join pins, the per-font nuqta table and nuqta snapping, the block-level Kashida
dial, the tatweel-gap Kashida tool, Fit width / auto-justify
(`src/lib/justify.ts`), and By-stroke/Lasso mask editing
(`src/lib/glyphContours.ts`).

**Why.** The stack's core promise — strokes that extend — was measured inert.
The kashida dial did not widen a run at all (the rendered extent was unchanged
across the dial's whole travel, so Fit width could never fit); taking a letter
as a given font actually draws it, only ~14% of authored stretch zones had a
verified spine and therefore a handle; and the strokes that did move deformed
rather than extended. The user chose removal over continued repair. Phase 1's
tatweel stream replaces the elongation story with one that works.

**Where it lives if it is ever wanted back.** `docs/archive/nuqta-measurements.md`
carries the expensive, human-verified part — the per-font nuqta table, measured
two independent ways — plus the pre-removal SHA
(`fbe942cadec8c82596948309248a99a1fbb21f90`) that every deleted file can be
recovered from. The offline Python tooling (`scripts/measureNuqta.py`,
`deriveStrokeSpines.py`, `auditSpineOrientation.py`) is deliberately **kept**:
scripts are inert, and they are the other half of "don't redo the work." Read
that archive file before resurrecting anything from git history, exactly as the
`shapeWarp` note above asks.

**What survived, and why it is where it is:**

- **Per-glyph move & scale** (`lib/glyphTransform.ts`,
  `GlyphTransformHoverHandles.tsx`) — its own section above. Its arming
  checkbox used to live in the Morph panel and now sits in Sidebar →
  Typography, plain-text-only, matching the arming rule it always had.
- **Diacritic overrides** — untouched, including the Shape Fill "Diacritic
  tool" checkbox.
- **`projectOntoAxis`** — was `lib/strokeSchema/dragAxis.ts`, now
  `src/lib/dragAxis.ts`, because the two surviving hover-handle overlays use it
  as their Konva `dragBoundFunc` rail. Its siblings `dotPositionForFactor` and
  `factorForPosition` went with the stretch tool.
- **`lib/arabicJoining.ts`** — deliberately kept **consumer-less**. Its only
  caller was the deleted `strokeSchema/glyphLookup.ts`; the tatweel stream
  needs it next. Don't delete it as dead code.

**Old saves.** `App.tsx`'s `stripMorphFields` deletes `glyphEdits`,
`glyphRigValues`, `glyphMaskEdit`, `glyphEditTool`, `selectedGlyphIndex`,
`kashidaAmount` and `kashidaEditMode` off every block in
`applyParsedLayoutPayload` — same mechanism and same reasoning as the
`shapeWarp` filter beside it. A project saved before the removal loads with
those edits dropped rather than half-rendered. The layout payload's `version`
moved 4 → 5 and no longer embeds `glyphRigs`. The `harfcanvas-glyph-rigs-v1`
localStorage key is simply orphaned; nothing reads or clears it.

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

Per-glyph tools (move & scale, diacritic overrides) do not apply to
`textPath` blocks — every internal per-glyph mutator guard excludes
`"textPath"` the same way it has always excluded `"image"`. Those tools'
hit-testing assumes a straight glyph bounding box; making it work once a
glyph is rotated to a curve tangent
is a real design problem, deliberately left for a future spec rather than
half-supported here.

<!-- ---- STREAM-G: font upload — document this feature here (see docs/superpowers/specs/PARALLEL-PHASE-2.md) ---- -->
### User-uploaded fonts (`src/lib/customFonts.ts`, `FontUploadDialog.tsx`)

A user can add their own `.ttf`/`.otf` from Typography → **Upload a font…**.
This is the runtime counterpart of the five-place source edit documented in
"Adding a new font" below, and it exists *because* the Morph removal deleted
the one step that needed offline measurement (the per-font nuqta): a font is
now just "bytes HarfBuzz can shape plus a display name," which an upload can
supply. It does **not** replace that section — a bundled font still needs all
of it, and only a bundled font gets the PUA honorifics.

- **Storage is IndexedDB**, not `localStorage`: fonts run 100KB–2MB and the
  5MB string quota is too tight. The wrapper is ~60 lines in `customFonts.ts`
  — one DB, one object store — rather than a dependency. Best-effort like
  every store here: `memoryStore` is both the fallback when IndexedDB is
  unavailable (privacy mode) *and* the authority for reads, so a rejected
  write still behaves normally for the session instead of throwing.
- **`customFonts.ts` must not import `./harfbuzz`.** That module statically
  imports harfbuzzjs, whose CJS/ESM shape throws under Vitest's Node loader
  before any test code runs — the same reason `diacritics.ts` keeps its
  distance, and what lets `customFonts.test.ts` parse real fonts from
  `public/fonts/` directly. The one thing it needs from harfbuzz —
  `clearShapeCache` when bytes change under an object URL — arrives through
  `setShapeCacheInvalidator`, wired once at the top of `useShapedGlyphs.ts`,
  which already owns both halves.
- **`resolveFontUrl(fontFamily)` (in `useShapedGlyphs.ts`) is now the only
  legitimate way to get a font's URL** — built-in, then the custom registry,
  then Noto Sans. Indexing `FONT_URLS` directly is the bug this replaces: an
  uploaded font has no entry there and would silently render as Noto Sans.
  It is **synchronous** because the shaping hook computes a URL during
  render, which is why the registry keeps a sync `customFontUrl(key)` map of
  already-created object URLs and `App.tsx` calls `primeCustomFonts()` once
  at boot. Until that resolves, a custom family answers the fallback and
  re-renders onto its own bytes a frame later — settling `customFonts` state
  is what triggers that re-render.
- **The key is `custom-<slug>-<hash>`** (FNV-1a over the file). Hashing the
  bytes is what lets two versions of one family coexist and makes
  re-uploading the same file idempotent; the label is free text and never
  part of the key, so renaming an upload cannot fork it. The key doubles as
  a CSS `font-family` and as a block's `fontFamily`, which is why
  `slugifyFamily` emits nothing that would need quoting or escaping.
- **A `FontFace` is registered from the same bytes**, which is the runtime
  replacement for a bundled font's `@font-face` rule in `index.css` — it is
  what lets the picker preview an uploaded family in itself. `FONT_OPTIONS`
  stays the static built-in list; the picker's `options` prop appends
  `customFonts`. That append is load-bearing rather than cosmetic:
  `FontSelectRow` falls back to `options[0]` for an unknown value, so a
  custom font missing from the list would leave the trigger naming the wrong
  family.
- **Projects reference fonts by key only** — bytes are never in the layout
  payload (a cloud row has limits). A key that resolves to nothing renders in
  Noto Sans *and says so*: an effect over `blocks` in `App.tsx` reports it
  through the existing transient status row, and the Typography panel shows a
  notice for the selected block. Silence here is exactly the misdiagnosis
  trap this file records for a missing `FONT_URLS` entry, so don't "tidy"
  either notice away. The block keeps its key, so re-uploading the file
  restores it.
- Deliberately out of scope: embedding bytes in saves, WOFF/WOFF2
  (harfbuzzjs wants uncompressed ttf/otf — the dialog says so rather than
  bundling a decompressor), Google-Fonts browsing, and injecting the PUA
  honorifics into an upload. The Presets row will show missing-glyph boxes in
  an uploaded font; the dialog and the guide both say so up front.
<!-- ---- /STREAM-G ---- -->

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

**Adding a new font is a five-place edit plus a glyph merge, not a file
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

(There used to be a fifth: a measured per-font nuqta in `src/lib/nuqta.ts`.
It went with the stroke subsystem — see "Removed subsystems" above. The
measurements themselves survive in `docs/archive/nuqta-measurements.md`, so
anything that needs a nuqta again starts from there rather than re-measuring.)

Then merge the ten honorific glyphs into the file (see above).

Each omission fails differently, and none of them fails loudly:
registering in `FONT_URLS` alone shapes correctly but leaves the font
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


### The artboard (`src/lib/artboard.ts`, `CanvasStage.tsx`, `useExport.ts`)

A document can have a **page**: `artboard: ArtboardConfig | null` in `App.tsx`.
`null` is freeform and is byte-for-byte the behaviour that predates the
feature — it is also what every save written before it loads as, since
`applyParsedLayoutPayload` runs `isArtboardConfig` over the payload's
`artboard` field and falls back to `null` for anything malformed *or absent*
(it must run even when the key is missing, or loading an old project would
inherit the current page). The config is part of the document: it goes in the
save payload and in `EditorSnapshot`, so choosing a page size is undoable.

`src/lib/artboard.ts` is pure — plain rectangles and arithmetic, no React and
no Konva — and fully covered by `artboard.test.ts`.

- **Size is stored in px at the config's own `dpi`**, so A4@300dpi *is*
  2480 × 3508. Stage space is pixel space, so those are also the page's
  canvas dimensions, and that is the single fact the whole design turns on:
  rasterising the page 1:1 reproduces exactly `width × height`.
  `exportPixelRatio` therefore returns **1** whenever a page is set and the
  requested scale only when it is not. The export scale slider is inert with
  a page — deliberately, since the point of choosing A4@300 is that it
  exports at 2480 × 3508 whatever the slider says. The Artboard panel shows
  the resulting pixel size rather than the Export panel (which is stream C's
  file region this phase).
- `unit` is **display only**. `toDisplayUnit`/`fromDisplayUnit` never change
  what is stored; `withDpi` does, because changing dpi keeps the *physical*
  size and rescales the pixels — reinterpreting the same pixels as a smaller
  page is not what "make this print quality" means.
- Margins are clamped to 45% of the shorter side. Not merely cosmetic: a
  margin that met itself in the middle would contribute two coincident snap
  lines through the page centre.
- Preset ids are re-derived on resize (`withSize` → `matchArtboardPreset`),
  so typing 1080 × 1080 shows "Instagram square" rather than "Custom".

**CanvasStage.** `pageRect ?? contentBox` (named `paperBox`) is what the
background fill, the alignment grid and the `kind: "artboard"` snap
candidates come from. `contentBox` — the union of the padded content *and the
current viewport* — is retained for scroll extents and for the full-length
origin-snap lines, but it was a bad page: it made all three of those depend
on the zoom level. The margin rectangle becomes snap targets through a
**second** `buildSnapTargets([], marginRect, NO_GUIDES)` call rather than a
new target kind; `lib/snapping.ts` already models a page rectangle, so it
needs no fork. Blocks may overhang the page freely — nothing clips on canvas.

**Page chrome is id-prefixed `artboard-chrome-`** (the outline and the margin
guide). `useExport`'s `withExportAdjustments` hides every node with that
prefix alongside the grid and the text-path overlays, which is what keeps it
out of exports. A new piece of on-page chrome must use that prefix or it will
silently be baked in.

**Export.** `useExport(stageRef, blocks, artboard?)` takes an optional third
argument (`{ config, clipToPage }`, defaulting to freeform), so the two call
sites that predate this feature are unchanged and unchanged in behaviour.
`exportBox` returns the page instead of the blocks' bounding box, so export
dimensions stop being emergent — dragging a block no longer resizes the PNG.
"Clip to page" off unions the page with the content instead. The PDF's px→mm
now uses the config's dpi (`pxToMm(px, dpi)`) rather than a hardcoded 96,
which is what makes an A4 document print as A4 rather than as a 656 mm poster.

**Sidebar.** A new **Artboard** panel opens the `document` tier, above
Background & Grid, and the background-colour row *moved into it* — page
colour is a property of the page. That panel also owns the margin, the
units/dpi selects, the orientation toggle, the export-size readout and the
"Clip to page" checkbox.

Out of scope, deliberately: multiple artboards, bleed marks, dimming the
overhang on canvas, and clipping during editing.

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

### In-app user guide (`src/components/guide/`)

A "?" button at the top-left of the sidebar header opens a right-side
slide-over drawer of searchable help pages. No router, no markdown
renderer, no new dependency — pages are plain TSX components, which is the
whole reason for the format: they can use the app's own CSS custom
properties and stay in the repo beside the code they describe.

- `types.ts` declares `GuideSection` (`id`/`title`/`order`/`keywords`/`Body`).
  `registry.ts` auto-loads every `./sections/*.tsx` via `import.meta.glob`
  and sorts by `order` then `title`. **Dropping a file in `sections/` is the
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
- `GuideDrawer.tsx` portals to `document.body` (the sidebar is an
  overflow-hidden scrolling column that would clip a slide-over). It is deliberately mounted from
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
  colour, alignment, line height, plus the text-only Warp and
  Move & scale sections). It is *not* called "Text" precisely because it renders for
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

### Ornament & frame library (`src/data/ornaments/`, `src/lib/ornaments.ts`, `OrnamentPicker.tsx`)

Ten built-in shapes — arches, stars, a medallion, a scalloped roundel, an
ogee cartouche, a crescent, a boteh, a border frame — so Shape Fill is
usable by someone who has no SVG collection of their own, and so decorative
frames exist at all.

**One TS module per ornament**, in `src/data/ornaments/`, each default-
exporting an `OrnamentDef` (`id`/`name`/`nameAr`/`tags`/`viewBox`/`paths`).
Not raw `.svg` assets — same reasoning as the guide sections: no loader, the
data is typed and tree-shaken. `lib/ornaments.ts` globs the folder eagerly,
so **dropping a file in is the whole integration step**; there is no list to
edit. It skips modules that export no ornament, which is what lets the
shared `_geometry.ts` helpers live beside the data they build.

Three things about the geometry are load-bearing:

- **All of it is constructed from primitives** (`_geometry.ts`: arcs,
  polygons, stars, scalloped circles), never traced from a found image.
  That is a licensing property, not a style choice — keep it true of
  anything added.
- **No `A` (elliptical arc) commands.** `lib/svgPath.ts`'s `parseSvgPath`
  degrades an arc to a straight line to its endpoint, so a circle drawn with
  `A` would fill as a diamond. `arcCommands` emits cubic approximations
  instead.
- **A hole is cut with a doubled-back bridge, not a second subpath**
  (`ringPath`, used by `border-frame`). Shape Fill hit-tests by ray-casting
  over *one* flat point list from `pathToPolygon`, so two subpaths are
  joined by two different implicit segments that enclose a wedge the ray
  count then gets wrong. Two coincident bridge edges cancel instead, under
  both SVG fill rules and under the ray cast. `ornaments.test.ts` pins this
  by asserting the frame's middle is *outside* the polygon.

`OrnamentPicker.tsx` is the modal grid (portaled to `document.body`, the
`GuideDrawer`/`TemplateWizardDialog` precedent — the sidebar is
overflow-hidden and would clip it, and nothing non-artwork may live inside
the Konva stage or it risks being baked into an export). Thumbnails are
inline `<svg>`, so no rasterization. `OrnamentPickerButton` bundles launcher
and dialog into one element with local open state, the way `GuideLauncher`
does, so the two mount sites (the add-block row and the Shape Fill panel)
need no state and opening a picker never reaches `App.tsx`, the undo stack,
or a saved layout.

Neither action forks block creation. **Fill with text** builds the SVG
markup and runs it back through the app's own `extractSvgPaths` — with
`preserveAspect`, since these are drawn assets that must not be stretched to
a square — then hands the resulting `{ pathData, w, h }` to the same
`addShapeFillBlock` the upload flow uses. **Insert as frame** base64s the
markup into a data URL and goes through `addImageBlock`; a frame is a
decoration, not a text container, so it needs no new block type. Its fill
colour is therefore **baked in at insert time** and cannot be changed
afterwards (an editable vector frame would need a real vector-shape block
type — see Deferred features); the guide page says so, and the picker shows
the colour in its thumbnails before you commit.

`ornamentSvgMarkup` is deliberately ASCII-only — no `nameAr`, no comment —
because `btoa` throws above U+00FF.

<!-- ---- STREAM-E: styles & palettes ---- -->
### Saveable text styles & palettes (`src/lib/textStyles.ts`, `src/lib/palettes.ts`, `PaletteSwatches.tsx`)

Two more instances of the `lib/exportPresets.ts` pattern, deliberately: a
named list in `localStorage`, best-effort try/catch on every read and write,
pure `upsert`/`remove` list functions, overwrite-by-name on save, and
**local-only** — neither store enters the layout payload, the undo snapshot,
or the Supabase named-project store. Keys are `harfcanvas-text-styles-v1`
and `harfcanvas-palettes-v1`.

- **A style is defined by what it refuses to carry.** `STYLE_FIELDS` in
  `textStyles.ts` is the single list both `captureStyle` and `styleToPatch`
  walk, so the two directions cannot drift; it holds only styling fields, so
  `text`, `x`/`y`, `id` and `type` can never ride along. `textStyles.test.ts`
  asserts that absence rather than only the presence of the fields — the
  round-trip test patches a *different* block and checks its text and
  position survived.
- **The field names come from `BlockCommon`, not from the spec.** The
  outline colour is `stroke` (not `strokeColor`), and there is no
  `letterSpacing` field in this codebase at all — the spec's indicative list
  named both, and both were resolved against `types.ts`. `lineHeight` lives
  on `TextBlock` only; it is captured and applied anyway, inert on the other
  types the same way `BlockCommon` is already inert in several places.
- **Palette defaults live in code, never in storage.** `loadPalettes`
  returns only the *user's* palettes and `savePalettes` writes only those;
  `allPalettes` prepends `DEFAULT_PALETTES`. So the shipped palettes cannot
  be corrupted, cannot go stale against a later release, and always list
  first — and a stored palette reusing a default's id is dropped rather than
  shadowing it.
- **`patchSelectedBlocks` in `App.tsx` is this stream's one mutating
  primitive.** `updateSelectedBlock` patches only the single selected block,
  and a style is meant to bring a whole selection into line, so this walks
  `effectiveSelectedIds` with **one** `pushHistory()` for the gesture —
  applying a style to six blocks is one undo. Managing the lists themselves
  is not history-tracked: it isn't document state.
- **`PaletteSwatches.tsx` is a component of its own rather than an addition
  to `FormControls.tsx`'s `ColorRow`**, which belongs to no stream this
  phase. It is mounted from the Styles region at the top of Typography, so
  the swatches drive the *text* colour; `ColorRow` keeps its own separate
  fixed grid of stock colours. Reaching the other `ColorRow`s (stroke,
  shadow, page) needs `FormControls.tsx` and was left for a later phase — a
  known, deliberate v1 limit, not an oversight.
<!-- ---- /STREAM-E ---- -->

### Undo/redo and grouping

`src/hooks/useUndoRedo.ts` is a generic snapshot-stack hook (`getSnapshot`/`applySnapshot` callbacks); `App.tsx`'s `pushHistory()` wraps it and is called at the start of nearly every mutating handler (before the state change, so undo restores pre-change state). Blocks can share a `groupId` (assigned via the Layers panel's pairwise "merge" UI or the multi-select "Group selected" action) so that dragging one moves every block with the same `groupId` together; `dissolveSingletonGroups()` cleans up groups that drop to one member after a delete.

<!-- ---- STREAM-F: ink & surface — document this feature here (see docs/superpowers/specs/PARALLEL-PHASE-2.md) ---- -->

### Ink & surface (`src/lib/blockFill.ts`, `src/data/textures/`)

Two independent halves: a block's ink can be a **gradient** (the metallic
presets are the point of it), and the page can carry a **paper texture**.

#### Block fill

`BlockCommon` gains an optional `fill?: BlockFill`
(`solid` / `linear` + angle / `radial` + stops), re-exported through
`types.ts` from `lib/blockFill.ts`, which owns the type and all of the maths.

**Absent means today's behaviour, and that is load-bearing.** `color` is not
migrated and not removed: choosing *Flat colour* in the UI writes `color` and
clears `fill`, so a block only ever carries `fill` while it is actually a
gradient, and every project saved before this feature renders byte-identically.
`resolveFill(fill, color)` is the single place that decision lives (it also
degrades a gradient with fewer than two stops back to a solid, which is a
state the stop editor can briefly produce).

`makeCanvasFill(ctx, fill, bounds)` builds the `fillStyle` from the **block's
run bounds**, so one sweep spans the whole word rather than restarting inside
each letter.

**The hard part is that all three renderers fill inside per-glyph
transforms.** A canvas path is converted to device space as each segment is
added, but a gradient `fillStyle` is read through the CTM *at fill time* — so
a gradient set up in block space and filled inside a glyph's own translate /
rotate / scale would restart per glyph (catastrophic on a Shape Fill block,
where the run is tiled into hundreds of instances). `createBlockFillPainter`
is the answer: built while the ctx is still in the block's space, it captures
that matrix and, for each `fill()`, resets the transform to it and restores
afterwards. The already-traced path does not move; only the gradient's frame
of reference does. **A solid fill takes none of this path** — it is a plain
`ctx.fill()`, unchanged.

Its `strokeWithFill` (faux bold, the one stroke that uses the fill style)
therefore takes *two* widths: `local` in the caller's own space and `block`
in the block's, because `lineWidth` is read in whatever space is current when
the stroke is issued.

Each renderer builds one painter per draw at the point it used to set
`ctx.fillStyle`:

- **`ShapedText`** after the run-centring translate and the italic shear, so
  the gradient shears with the text. Its second (outline) pass fills too, and
  `ctx.restore()` has popped the style by then — hence the explicit
  re-assignment before that call, which was previously filling with whatever
  style the shared context happened to be carrying.
- **`ShapeFillText`** in the silhouette's own pre-tile space, bounds
  `0,0,shapeWidth,shapeHeight`.
- **`TextOnPathText`** in the Shape's space, bounds the curve's bounding box,
  before the glyph loop rotates each letter to its tangent.

`CanvasStage.tsx` and `MirrorBlockView.tsx` pass `fill` alongside `color`.
That was **not** in stream F's ownership table and no other Phase 2 stream
owns those files — the prep commit's anchors covered the page-surface seam but
not this one. Recorded here rather than silently; it is one prop line in each
of four places.

#### SVG export — the spike, and what it found

`react-konva-to-svg` does **not** drop a canvas gradient: svgcanvas emits a
real `<linearGradient gradientUnits="userSpaceOnUse">` in `<defs>`. But it
bakes path points into the document's **root** space and leaves gradient
coordinates *untransformed*, so there a gradient is read in root space rather
than through the CTM — the opposite convention to a real canvas.

So nothing rasterizes and the Export panel needs no warning. Instead
`createBlockFillPainter` detects that context by its own `getSerializedSvg`,
pre-multiplies the gradient geometry by the block matrix (`mapGeometry`), and
skips the transform-reset dance entirely. `e2e/ink-surface.spec.ts` pins both
halves: the def exists with the preset's own stops, *and* its coordinates land
inside the exported viewBox — a regression here would leave the def present
and the letters flat.

#### Paper surfaces

`src/data/textures/` — every texture is **generated arithmetic**, never a
photograph: `_noise.ts` has tileable value noise, fbm and speckle, and
`defs/*.ts` compose them into parchment, laid paper, washi and linen. Zero
bytes of assets. Two things about it:

- **`defs/` is a folder of its own** because `index.ts` globs it eagerly; a
  flat glob of the folder would pick up the registry itself (an import cycle
  that boots to a blank page — it did), the shared helpers, and the test file.
- **Seamlessness is the one defect that is invisible in a single tile and
  ruins the whole page.** `tileNoise` takes separate x/y lattice sizes for
  exactly this reason: stretching a feature by scaling the *coordinate*
  instead throws the lattice out of phase with the tile. `textures.test.ts`
  asserts `grain(0, v) === grain(1, v)` on every texture, which is what caught
  `Math.sign` flipping on floating-point dust at linen's tile edge.

The surface is App state (`artboardSurface: { textureId, tint }`), **not**
part of `ArtboardConfig` — a freeform canvas gets paper too. It is saved with
the document and read back tolerantly (`readArtboardSurface`), but it is
**not in the undo snapshot**: `EditorSnapshot` sits outside this stream's
anchors. Worth revisiting.

It reaches the canvas through the prep commit's `surfaceRectProps` seam —
props spread last into the existing `#artboard-background` rect, as
`fillPriority: "pattern"` plus a `fillPatternImage`. Because it is that same
rect, the export path's existing "hide the background when transparent" rule
suppresses the texture with no export-side change at all. The tint is **baked
into the tile's pixels** rather than layered under them, since Konva picks
either a colour or a pattern for a shape, never both.

<!-- ---- /STREAM-F ---- -->

### Export (`src/hooks/useExport.ts`)

PNG/JPEG/PDF use `stage.toDataURL()`; SVG uses `react-konva-to-svg`. All four temporarily hide the on-screen alignment grid (`Konva.Group#grid-lines`) and, if "transparent background" is checked, the artboard background rect (`#artboard-background`) via `stage.findOne(...)`, so neither ever gets baked into exported output.


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
pattern as the named-project store) and the pure
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
per-browser `localStorage` named-projects store — autosave remains
local-only, untouched. `supabaseClient.ts`'s `supabase` export is
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

### End-to-end tests (`e2e/`, `playwright.config.ts`, `src/lib/testBridge.ts`)

`npm run e2e` runs the browser suite; `npm run e2e:ui` opens Playwright's
interactive runner. Chromium only. The config's `webServer` starts
`npm run dev` on port 5173 with `--strictPort` (and reuses a server already
listening there), so a clean checkout needs nothing but
`npx playwright install chromium`.

Two setup details that are easy to undo by accident:

- **Vitest and Playwright both claim `*.spec.ts`.** `vite.config.ts` carries
  a `test.exclude` listing `e2e/**` for exactly this reason. Keep e2e specs
  in `e2e/`, never under `src/`.
- **Playwright transpiles without typechecking**, so nothing in the normal
  loop would catch a type error in a spec. `e2e/tsconfig.json` exists for
  that: `npx tsc --noEmit -p e2e/tsconfig.json`. It is not wired into
  `tsconfig.json`'s project references because it needs the DOM lib that
  `tsconfig.node.json` deliberately omits.

**The bridge.** Konva draws everything into one `<canvas>`, so the DOM says
almost nothing about the artboard. `src/lib/testBridge.ts` publishes
`window.__HARF__ = { getBlocks, getSelectedIds, getStage }` in **dev builds
only** — `import.meta.env.DEV` is substituted with `false` in a production
build, so the assignment is unreachable and dropped (verified: no `__HARF__`
anywhere in `dist/`). `App.tsx` wires it in one `useEffect` keyed on
`[blocks, effectiveSelectedIds]`; re-installing on change is cheaper than
threading refs and keeps the closures fresh.

It is deliberately **read-only**. Tests drive the app the way a user does
and use the bridge only to check what happened; a setter here would let a
test pass while the interaction it claims to cover is broken. `getStage` is
what makes on-screen geometry reachable — `node.getClientRect()` already
folds in the stage's pan/zoom, so adding the container's own offset lands a
Konva node in the same page coordinates `page.mouse` speaks.

Appearance is asserted in **pixels, not through the bridge**: `e2e/harf.ts`'s
`inkPixels` reads `getImageData` off the live stage canvas and counts dark
pixels. Reading the live canvas rather than a screenshot keeps the
coordinate space identical to the mouse helpers' and needs no PNG decoder.
Keep such assertions coarse — "is there ink in this region" — never
exact-image, or font rasterisation differences across machines will flake.

**Trusted drags reach Konva's hover-mounted handles.** This was the open
question the harness was built to settle, and the answer is yes: both the
plain block drag and the diacritic move-handle drag pass. The older
conclusion that scripted drags "fall through to the block underneath" was an
artifact of extension-injected synthetic events; Playwright drives real CDP
input.

Two real defects sat behind that headline and `e2e/harf.ts` worked around
both. **Both are fixed** (see "Per-instance diacritic control" for the fix),
and the workarounds went with them, as the note here always said they should.
They are recorded because the measurements are the reason the fix is shaped
the way it is:

- **A hover-mounted diacritic handle flickered off on alternate mouse
  moves.** The hover hit `Rect` and the handle `Circle` were siblings, so as
  soon as the mounted handle covered the pointer, the next mousemove
  retargeted hover to the `Circle` and fired `mouseleave` on the `Rect`,
  clearing `hoveredKey` and unmounting the handle. Measured: over eight
  0.5px moves across a mark, the handle was mounted on exactly every other
  one, and `stage.getIntersection` alternated `Circle` /
  `Rect.diacritic-hit` in lockstep. `armDiacriticMoveHandle` used to
  re-issue the same move until the pointer sat on a mounted handle; its
  remaining loop is only for *overlapping* hit rects, which is a separate
  and still-real thing.
- **A drag whose first step was small lost the handle mid-gesture.** Konva
  suppresses its enter/leave processing only once a drag's status reaches
  `dragging`, not while it is merely `ready` — so the first mousemove still
  retargeted hover, the overlay unmounted the node the drag was attached to,
  and the gesture died attached to an orphan. Measured at the app's default
  2.75x zoom: first steps of 2px and 10px lost it, 20px and 40px completed
  normally. `dragFromHere` was therefore pinned to a single jump; it now
  drags in 24 interpolated steps, which is both the honest gesture and the
  regression test. `draggingKey`, the sticky-hover flag meant to prevent
  this, could never do it: it is set in `onDragStart`, which runs *after*
  the `mouseleave` that has already unmounted the handle. It is kept as
  belt-and-braces for a handle dragged outside its own hit rect.

`shapeText` used to throw on empty text (`JSON.parse` of an empty shaping
result), logging a `console.error` whenever a user cleared the Content
textarea. It now returns the empty result before building any HarfBuzz
objects, so a "no console errors" assertion is no longer pinned to the boot
test — `core.spec.ts` asserts it across a clear/retype/clear cycle.

Every stream from Phase 1 of the 2026-08-14 program on owns its own
`e2e/<stream>.spec.ts`, so those files never conflict; the shared helpers
live in `e2e/harf.ts`.

## Deferred features

These are capabilities that have been explicitly identified as valuable but deliberately left for a future specification rather than partially supported now:

- **Per-glyph move & scale on Shape Fill and text-on-path blocks** — Implemented for plain text only. `src/lib/diacriticPlacement.ts`'s adapters are the nearest existing precedent for expressing another renderer's coordinate space, but they were authored for placing *diacritic marks*, not for a general per-glyph transform — treat them as a starting point to evaluate, not as a drop-in that makes this cheap. Each renderer's coordinate space needs its own design and verification pass. Text-on-path is excluded for the same reason every other per-glyph tool is, its glyphs being rotated to a curve tangent.

- **Per-glyph rotation** — The move/scale handles cover translation and axis-aligned scale only. Rotation needs a fourth handle and its own pivot decision.

- **Mark detection for fonts that encode marks in the Private Use Area** — `lib/diacritics.ts`'s `findDiacriticGlyphIndices` keys on a mark's own cmap codepoint, with a nonzero-GPOS-offset fallback. `Thuluth.ttf` defeats both (PUA codepoints, marks positioned by advance), so on that font the per-mark diacritic overlay does not arm. A third signal — e.g. reading the font's own GDEF glyph classes, which mark up mark glyphs directly — would fix it, but it touches the detector every diacritic feature depends on and deserves its own real-font verification pass.

- **Image trace** — Auto-tracing a raster image into a silhouette shape existed on Shape Warp blocks and was removed with that block type. Rebuilding it for Shape Fill means restoring `lib/imageTrace.ts`, `ImageTraceDialog.tsx`, and the `imagetracerjs` dependency from git history; the tracing itself was block-type agnostic, producing the same `{ pathData, w, h }` shape `extractSvgPaths` returns.

### Vite/Rolldown quirk

`vite.config.ts` manually aliases `opentype.js` to its prebuilt ESM file because the package has no `exports` field, which breaks Rolldown (Vite 8's bundler) resolution otherwise. If upgrading `opentype.js` or Vite, re-check this alias still resolves.

`imagetracerjs` had the **same** missing-`exports` problem and its own version-numbered entry filename, needing a second alias pinned in lockstep with the dependency. Both are gone — the package was removed along with Shape Warp and its "Trace image" input. If image tracing ever returns, that alias and the exact version pin have to return with it.
