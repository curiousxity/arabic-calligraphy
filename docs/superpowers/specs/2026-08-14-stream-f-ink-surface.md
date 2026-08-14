# Stream F — Ink & surface

**Read `PARALLEL-PHASE-2.md` first.** Branch: `stream/f-ink-surface`.

## What exists today

Block fill is a single flat `color` string; the page background (stream A's
artboard) is a flat colour rect. No gradients, no metallic looks, no paper.
The three text renderers each fill glyph outlines through their own
`replayPath`-style draw code (deliberately unshared — CLAUDE.md), all
ultimately calling `ctx.fill()` after setting `fillStyle`, and all drawing
**stroke before fill** (load-bearing; do not reorder).

## Design

### `src/lib/blockFill.ts` (exclusively owned, pure)

```ts
export type BlockFill =
  | { type: "solid"; color: string }
  | { type: "linear"; stops: FillStop[]; angle: number }      // degrees
  | { type: "radial"; stops: FillStop[] };
export type FillStop = { offset: number; color: string };
export const GOLD_PRESETS: { id: string; name: string; fill: BlockFill }[];
// gold leaf, aged gold, silver, copper — 3–5 stop metallic gradients
export function makeCanvasFill(ctx, fill, bounds): string | CanvasGradient;
```

`makeCanvasFill` builds the `fillStyle` for a given bounding box (the
block's run bounds, so the gradient spans the whole word, not each glyph).
Pure math unit-tested via a mock ctx recording `createLinearGradient` args.

### Types + renderers (F owns all three renderers this phase)

`BlockCommon` gains optional `fill?: BlockFill` (STREAM-F anchor in
`types.ts`). **Absent means today's behaviour**: fall back to the existing
`color` field, so every existing block and save renders identically —
`color` is not migrated or removed; a solid fill in the new UI keeps
writing `color`, and `fill` is only set for gradients.

Each renderer resolves `fillStyle` once per draw from
`makeCanvasFill(ctx, fill ?? solid(color), runBounds)` at the point it
currently sets the fill colour. The italic shear / tile transforms in
`ShapeFillText` operate on the ctx, so the gradient inherits them
correctly — verify by eye. Konva's context wrapper passes gradients
through; if its typing objects, use the underlying `_context` the replay
helpers already reach for.

**Spike first, before building UI:** confirm `react-konva-to-svg`
serializes a canvas-gradient fill in the SVG export. If it flattens or
drops it, SVG export rasterizes gradient-filled blocks (embed a PNG of
just those blocks) or the Export panel warns "gradient blocks rasterize in
SVG" — decide from what the spike shows and record the decision in
CLAUDE.md. PNG/JPEG/PDF are rasters and need nothing.

### Paper & texture surfaces

`src/data/textures/` (owned): 3–4 seamless tileable paper/parchment
textures, **generated programmatically** (canvas noise + fibre speckle
script committed alongside, or pure-data), never sourced from images of
unknown licence. Small — budget ≤ 150KB total. Stream A's `ArtboardConfig`
gains nothing: surface is separate App state
`artboardSurface: { textureId: string | null; tint?: string }` (STREAM-F
anchor) drawn by a texture-patterned rect in the STREAM-F… — CanvasStage is
**not** in F's ownership; the page rect is A's. Therefore the texture
renders as a `fillPatternImage` prop *threaded into* the existing artboard
background rect via a prop A's code already spreads — if that seam doesn't
exist after A merges, report it as the contract bug rather than editing
CanvasStage. (The prep commit will confirm and, if needed, add a
`surfaceProps` pass-through to A's rect as part of anchor placement.)

### Sidebar (anchors)

Effects panel → **Fill** section: solid / linear / radial selector, stop
editor (2–4 stops), angle slider, gold preset row. Artboard panel →
**Surface** row: texture picker + tint. Export's transparent-background
option suppresses the texture like it already suppresses the background
rect.

## Testing

Unit: `makeCanvasFill` geometry per angle; presets well-formed; fallback
resolution (`fill` absent → `color`). E2E (`e2e/ink-surface.spec.ts`):
apply gold preset → block region's pixels are no longer uniform single
colour; texture on → page region non-uniform; PNG export with texture
differs from without; old save renders unchanged.

## Out of scope

Per-glyph fills; image fills for text; ink-bleed/rough-edge effects;
texture upload by users.
