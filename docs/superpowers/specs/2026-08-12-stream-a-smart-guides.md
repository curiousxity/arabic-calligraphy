# Stream A — Bounds-aware smart guides

**Read `PARALLEL.md` first.** Branch: `stream/a-smart-guides`.

## What exists today

Snapping is already implemented, and this feature extends it rather than
introducing it. `CanvasStage.tsx`'s `makeDragMoveHandler` (around line 236)
currently:

- builds `xTargets` from the content-box centre, every user-dropped vertical
  ruler guide, and every *other block's `x`*; `yTargets` likewise;
- calls a local `findNearest(value, targets, threshold)` with
  `threshold = SNAP_GUIDE_PX / stageScale` (`SNAP_GUIDE_PX = 6`);
- writes the snapped position back with `e.target.position(...)`, records it in
  `snapGuides` state, and renders one full-height and one full-width magenta
  dashed `Line` at the snapped coordinate (around line 886);
- separately applies grid snapping in the drag-*end* handler when
  `snapToGrid` is set.

## The actual gap

Everything above snaps a block's **origin** to another block's **origin**. A
block's origin is not its visual edge — `ShapedText` offsets its bounding box
by `align` (`bx = align === "left" ? 0 : align === "right" ? -bw : -bw / 2`),
so two blocks whose origins coincide can have visibly unaligned edges, and
"put this text's right edge against that image's left edge" is not expressible
at all. There is also no snapping to the artboard's own edges.

So this stream is: **snap rectangles, not origins.**

## Design

### `src/lib/snapping.ts` (new, exclusively owned)

One pure module, no React and no Konva imports, so it is fully unit-testable.

```ts
export type Rect = { x: number; y: number; width: number; height: number };

/** A candidate line a dragged rect can snap to, in stage space. */
export type SnapTarget = {
  axis: "x" | "y";
  position: number;
  /** Which edge of the source produced it — drives the rendered line's extent. */
  kind: "edge" | "center" | "guide" | "artboard";
  /** Stage-space extent of the source, used to draw a line only as long as it needs to be. */
  span?: { from: number; to: number };
};

export type SnapResult = {
  dx: number;
  dy: number;
  lines: { axis: "x" | "y"; position: number; from: number; to: number }[];
};

export function rectEdges(r: Rect): { x: [number, number, number]; y: [number, number, number] };
export function buildSnapTargets(others: Rect[], artboard: Rect, guides: { horizontal: number[]; vertical: number[] }): SnapTarget[];
export function computeSnap(dragged: Rect, targets: SnapTarget[], threshold: number): SnapResult;
```

`computeSnap` considers all three of the dragged rect's x-edges (left, centre,
right) against every x target and picks the single closest pair within
`threshold`, returning the `dx` that closes it — and likewise for y. One snap
per axis, never two, or a block can be pulled two directions at once.

The returned `lines` carry a `from`/`to` extent covering the union of the
dragged rect and the matched target's span, so a guide line is drawn spanning
just the two blocks it relates rather than the current ±100000 full-canvas
line. Keep the existing magenta dashed styling and the `1 / stageScale`
stroke-width convention.

### Ties and precedence

When two targets are equidistant, prefer in this order: existing user guide,
artboard edge, other-block edge, other-block centre. A user who deliberately
dropped a ruler guide means it. Make this explicit in the comparison rather
than relying on array order.

### `CanvasStage.tsx` changes (exclusively owned by this stream)

1. **Capture targets once at drag start, not per frame.** Add an
   `onDragStart` alongside the existing `onDragMove`/`onDragEnd` in
   `commonProps`, which walks the other blocks once via
   `stage.findOne('#block-' + id).getClientRect({ relativeTo: stage })` — the
   same call `App.tsx`'s `getSelectedNodeRects` already uses — and stashes the
   resulting `SnapTarget[]` in a ref. `getClientRect` traverses a block's whole
   subtree; doing it for every block on every drag frame at 60fps will visibly
   stutter on a busy canvas. Exclude the dragged block and all of its
   co-movers (`getCoMovers`) from the targets.

2. **Snap the rect, move the node.** In `makeDragMoveHandler`, get the dragged
   node's current client rect, call `computeSnap`, and apply `dx`/`dy` to the
   node's *position*. The rect and the position differ by a constant offset
   during a drag, so adding the delta is correct and avoids having to model
   each block type's origin-to-bounds relationship.

3. **Keep origin-to-origin snapping.** Add rect targets to the existing origin
   targets; do not remove what works. Grid snapping in `onDragEnd` is
   untouched.

4. **Render multiple lines.** Replace the two nullable `snapGuides.x`/`.y`
   values with the `lines` array from `SnapResult`, rendered with the existing
   styling. Clear on drag end exactly as now.

5. **Artboard targets** come from `contentBox` — its four edges and two
   centres.

### Distribution badges — last task, droppable

After everything above works, and only then: when the dragged rect sits
between two others with gaps equal to within the threshold, draw a small pair
of equal-spacing markers. Everything before this point is independently
useful; if this task proves fiddly, stop and report it undone rather than
destabilising the rest.

### Toggle

Add one `CheckboxRow` — "Snap to block edges", default **on** — in
`Sidebar.tsx`'s Background & Grid panel beside the existing snap-to-grid
control, backed by one `useState<boolean>` in `App.tsx` between the `STREAM-A`
anchors and threaded through `CanvasStage`'s props. When off, fall back to
exactly today's origin-only behaviour. Do not persist it.

## Constraints worth restating

- **No selection bounding box.** A dashed selection `Transformer` was tried
  and removed on user feedback (see `CLAUDE.md`). Snap lines appear only
  during a drag and vanish on release.
- **Do not touch any renderer.** All geometry comes from `getClientRect`.
- Locked blocks and pan mode already bail out at the top of the drag handler;
  keep that guard first.

## Tests (`src/lib/snapping.test.ts`)

Cover at minimum: a right-edge-to-left-edge snap; centre-to-centre; a target
outside the threshold producing `dx === 0`; two competing targets resolving to
the closer one; the tie-break precedence order; and the returned line extent
spanning both rects. Pure rects only — no Konva, no jsdom canvas.

## Guide section

`src/components/guide/sections/smart-guides.tsx`, `id: "smart-guides"`,
`order: 40`, title "Aligning blocks". Cover: what snapping does now that it
did not before (edges, not just centres), the ruler guides you can drag out
and double-click to remove, the grid toggle, and how to switch edge snapping
off. Per `PARALLEL.md`, write it for a calligrapher.

## Done when

The four verification commands pass, and by hand in `npm run dev`: dragging a
text block near an image snaps its visible right edge flush to the image's
left edge with a magenta line spanning only those two blocks; the same works
for top/bottom/centres; a block snaps to the artboard edge; turning the new
checkbox off restores origin-only snapping.
