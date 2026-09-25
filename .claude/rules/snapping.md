---
paths:
  - "src/lib/snapping*.ts"
---

# Bounds-aware snapping (`src/lib/snapping.ts`, `CanvasStage.tsx`)

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
