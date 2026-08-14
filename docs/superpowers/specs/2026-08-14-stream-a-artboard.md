# Stream A — Artboard

**Read `PARALLEL-PHASE-1.md` first.** Branch: `stream/a-artboard`.

## What exists today

There is no page. `CanvasStage.tsx`'s `contentBox` (~line 196) is the union
of the blocks' padded bounding box and the current viewport; the
`#artboard-background` rect and the grid draw to it, snap "artboard"
targets come from it, and `useExport.ts` crops every format to it. So
export dimensions are emergent (drag a block, the PNG changes size), page
edges don't exist as compositional targets, snapping quietly depends on
zoom, and the PDF hardcodes 96dpi px→mm.

## Design

### `src/lib/artboard.ts` (new, exclusively owned, pure — no React/Konva)

```ts
export type ArtboardUnit = "px" | "mm" | "in";
export type ArtboardConfig = {
  presetId: string | null;      // null = custom
  width: number; height: number; // always stored in px at the artboard's dpi
  unit: ArtboardUnit;            // display unit only
  dpi: number;                   // 96 default; 300 for print presets
  margin: number;                // px, uniform, 0 = none
  orientation: "portrait" | "landscape";
};
export const ARTBOARD_PRESETS: ArtboardPreset[]; // A5/A4/A3 + US Letter @300dpi, IG square 1080², IG portrait 1080×1350, story 1080×1920, X header 1500×500, custom
export function artboardRect(cfg): Rect;          // page rect in stage space, centred at origin
export function marginRect(cfg): Rect | null;
export function toDisplayUnit(px, cfg): number;   // and fromDisplayUnit
export function exportPixelRatio(cfg, requestedScale): number; // dpi-aware
```

Fully unit-tested: preset round-trips, unit conversion at each dpi,
orientation swap, margin clamping.

### App state

`artboard: ArtboardConfig | null` in `App.tsx` (STREAM-A anchor). **`null`
means freeform — exactly today's behaviour**, and is what every existing
save loads as; `applyParsedLayoutPayload` reads an optional `artboard`
field from the payload and the save path writes it. Undoable like any other
document property (include in the history snapshot).

### CanvasStage

When `artboard` is set: the background rect and grid draw to
`artboardRect` instead of the derived box; a margin guide (dashed, subtle)
draws inside it; the viewport-union `contentBox` logic is bypassed for
background purposes but retained for scroll extents. Page edges, centres,
and margin lines become `buildSnapTargets`' "artboard" candidates —
replacing the current viewport-dependent ones — via the existing
`kind: "artboard"` path in `lib/snapping.ts` (do not fork the snapping
module; it already models this). Blocks may overhang the page freely;
nothing clips on canvas.

When `null`: behaviour byte-identical to today.

### Export (`useExport.ts`, exclusively owned)

When `artboard` is set: every format crops to `artboardRect` and PNG/JPEG
use `exportPixelRatio` (so an A4@300dpi preset yields 2480×3508 regardless
of the on-screen scale slider — the Export panel shows the resulting pixel
size). PDF gets real page dimensions from width/dpi instead of the 96dpi
constant. A "Clip to page" checkbox (default on) controls whether
overhanging ink is cropped; off exports the union of page and content.
When `null`: current behaviour untouched, including the bare-boolean call
convention.

### Sidebar

New **Artboard** panel in the `document` tier (STREAM-A anchor; sits where
Background & Grid's background controls live — background colour moves into
it, since page colour is a page property): preset dropdown, custom W/H +
unit + dpi fields, orientation toggle, margin field, and "No artboard
(freeform)" as the first option. Remember `min-width: 0` on grid children.

## Testing

Unit: all of `lib/artboard.ts`. E2E (`e2e/artboard.spec.ts`): pick IG
square preset → exported PNG is exactly 1080×1080; freeform still exports
content-sized; page-edge snap fires while dragging a block near the edge.

## Out of scope

Multiple artboards; bleed marks; on-canvas dimming of overhang; clipping
during editing. Note them in PROGRESS if tempted.
