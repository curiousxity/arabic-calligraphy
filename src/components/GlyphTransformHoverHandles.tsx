import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import { projectOntoAxis } from "../lib/dragAxis";
import {
  resolveGlyphTransform,
  rotationFromHandleDrag,
  scaleFromHandleDrag,
  transformedBox,
} from "../lib/glyphTransform";
import type { GlyphTransformPlacement } from "../lib/diacriticPlacement";
import type { GlyphTransform } from "../types";

export type GlyphTransformHoverHandlesProps = {
  isSelected: boolean;
  /** Armed by Typography's "Move, scale & rotate glyph" checkbox. */
  enabled: boolean;
  /**
   * One entry per hoverable glyph instance on canvas, each carrying its own
   * local↔group mapping. The boxes are **raw** — this component folds the
   * transform in itself, which is what keeps the producing memo independent
   * of the live drag value.
   */
  placements: GlyphTransformPlacement[];
  glyphTransforms: GlyphTransform[];
  onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void;
};

const MOVE_HANDLE_COLOR = "#38bdf8";
const SCALE_X_HANDLE_COLOR = "#d4af37";
const SCALE_Y_HANDLE_COLOR = "#22c55e";
const ROTATE_HANDLE_COLOR = "#a855f7";

/** How far outside the glyph box the two scale dots sit, in canvas px. */
const SCALE_HANDLE_GAP = 10;

/**
 * How far diagonally past the box's upper-leading corner the rotate dot
 * sits, in canvas px.
 *
 * Diagonal, and never below the box, on purpose: kasra, kasratan and
 * shadda-kasra all live under the baseline, and `DiacriticHoverHandles`
 * mounts *after* this component with a generous vertical margin — so a
 * rotate dot placed below centre would sit beneath a mark's hit rect, and
 * Konva, which routes a pointer to the topmost listening shape, would make
 * it impossible to grab on exactly the letters most likely to want turning.
 */
const ROTATE_HANDLE_GAP = 14;

/** Smallest local-unit scale we will divide a canvas-px gap by. */
const MIN_UNIT_SCALE = 1e-3;

/**
 * On-canvas hover-only overlay for moving, scaling and rotating a whole
 * glyph.
 *
 * Only the currently-hovered glyph instance shows handles — the same rule
 * that keeps the diacritic and stroke-stretch overlays from turning a line of
 * text into a field of dots. Hover and drag state are keyed on
 * **`placement.key`**, never on `glyphIndex`: a tiling renderer draws one
 * glyph index many times, and an index-keyed hover would light every
 * repetition of that letter at once.
 *
 * All arithmetic below is in the placement's *local* space (the glyph run for
 * plain text, one tiled row's pre-fit frame for Shape Fill); `toCanvas` is
 * applied only when drawing and `toLocal` only when reading a drag back. That
 * is the whole of what varies between block types — the hit rect, the rails
 * and the four handles are identical for both, exactly as
 * `DiacriticHoverHandles` already is.
 *
 * The one exception is `dragBoundFunc`, whose contract is *absolute* (stage)
 * coordinates — the two scale rails are therefore mapped through the parent's
 * absolute transform at drag start, the technique `DiacriticHoverHandles`
 * established after mixing the two spaces teleported its move handle sideways
 * under pan/zoom. The rotate handle free-drags and so needs none of it.
 */
export const GlyphTransformHoverHandles: React.FC<GlyphTransformHoverHandlesProps> = ({
  isSelected,
  enabled,
  placements,
  glyphTransforms,
  onUpdateGlyphTransform,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Sticky-hover while a handle is being dragged: a move handle travels
  // well outside the hit rect during a normal gesture, so containment
  // alone can't be trusted mid-drag.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const railRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(
    null
  );
  // The transform as it stood when this drag began. Reading it live from
  // props during onDragMove would compound each frame's scale onto the
  // previous one and run away exponentially.
  //
  // `startDistanceX`/`startDistanceY`/`pivotX`/`pivotY` are likewise
  // snapshotted here rather than recomputed from the live box on every
  // move: the drawn box is derived from `glyphTransforms`, so each
  // `onUpdateGlyphTransform` call re-renders a new, already-scaled box.
  // Deriving "rest distance" from that live box every frame feeds the
  // previous frame's scale back into the current frame's math and the
  // gesture converges on the wrong value instead of tracking the pointer
  // linearly. The rest position at scale 1 never changes during a single
  // gesture, so it only needs to be read once.
  const dragStartRef = useRef<{
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    pointerX: number;
    pointerY: number;
    startDistanceX: number;
    startDistanceY: number;
    gapX: number;
    gapY: number;
    pivotX: number;
    pivotY: number;
    rotation: number;
    rotPivotX: number;
    rotPivotY: number;
  } | null>(null);

  if (!isSelected || !enabled) return null;

  return (
    <Group>
      {placements.map((placement) => {
        const transform = glyphTransforms.find((t) => t.glyphIndex === placement.glyphIndex);
        const isActive = hoveredKey === placement.key || draggingKey === placement.key;

        // Every write stamps the glyph the transform was actually made for.
        // Transforms are keyed by glyph index, and a text edit before this
        // glyph shifts that index after re-shaping — `glyphId` is the
        // identity signal that lets `filterActiveGlyphTransforms` notice and
        // drop a transform that has drifted onto some other letter, the way
        // the renderers already re-validate diacritic overrides. Going
        // through one helper is what keeps all four drag handlers below from
        // having to remember to include it.
        const applyPatch = (patch: Partial<GlyphTransform>) =>
          onUpdateGlyphTransform?.(placement.glyphIndex, {
            glyphId: placement.glyphId,
            ...patch,
          });

        // The box as currently drawn, in the placement's own local space.
        // Folded in here rather than by the producer: a pre-folded box would
        // make the producing memo depend on the live drag value, which on a
        // tiling renderer means re-mapping the whole instance array every
        // frame of a gesture.
        const box = transformedBox(placement.box, placement.gx, placement.gy, transform);

        // A canvas-px gap has to be expressed in local units, and on Shape
        // Fill a compressed row's local unit is a fraction of a pixel — a
        // gap left at face value there would put both scale dots inside the
        // letter they are meant to sit clear of.
        const usx = Math.max(Math.abs(placement.unitScaleX ?? 1), MIN_UNIT_SCALE);
        const usy = Math.max(Math.abs(placement.unitScaleY ?? 1), MIN_UNIT_SCALE);
        const gapX = SCALE_HANDLE_GAP / usx;
        const gapY = SCALE_HANDLE_GAP / usy;
        const diagX = ROTATE_HANDLE_GAP / Math.SQRT2 / usx;
        const diagY = ROTATE_HANDLE_GAP / Math.SQRT2 / usy;

        // Handle rest positions, in local space.
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const scaleXAt = { x: box.x + box.width + gapX, y: cy };
        const scaleYAt = { x: cx, y: box.y - gapY };
        // Diagonally past the corner the other two dots leave free.
        const rotateAt = { x: box.x - diagX, y: box.y - diagY };

        // The scale pivot is the renderer's own pivot: it translates to the
        // pen origin, THEN to the transform's offset, THEN scales (see
        // `transformedBox`) — so once a glyph has been moved, the pen origin
        // alone is no longer the point the renderer actually scales about.
        // Folding in the current offset keeps this in agreement with it.
        const pivotX = placement.gx + (transform?.offsetX ?? 0);
        const pivotY = placement.gy + (transform?.offsetY ?? 0);

        // The hit rect covers the glyph plus every dot's rest position, so
        // a dot dragged outward can't leave the rect, fire onMouseLeave,
        // and unmount itself mid-gesture.
        const rx1 = Math.min(box.x, scaleYAt.x, scaleXAt.x, rotateAt.x) - gapX;
        const ry1 = Math.min(box.y, scaleYAt.y, scaleXAt.y, rotateAt.y) - gapY;
        const rx2 = Math.max(box.x + box.width, scaleXAt.x, scaleYAt.x, rotateAt.x) + gapX;
        const ry2 = Math.max(box.y + box.height, scaleXAt.y, scaleYAt.y, rotateAt.y) + gapY;

        // A local rect is not axis-aligned on canvas once the placement's
        // adapter turns or scales it, and Konva's Rect cannot express one.
        // Map all four corners and take their bounding box — slightly larger
        // than the true region, which only ever makes the glyph easier to
        // hover. Same treatment `DiacriticHoverHandles` already gives its own.
        const corners = [
          placement.toCanvas(rx1, ry1),
          placement.toCanvas(rx2, ry1),
          placement.toCanvas(rx1, ry2),
          placement.toCanvas(rx2, ry2),
        ];
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);
        // Hoisted: the hit rect needs each bound twice (position, then extent),
        // and this runs per placement on every frame of a drag.
        const hitX = Math.min(...xs);
        const hitY = Math.min(...ys);
        const hitW = Math.max(...xs) - hitX;
        const hitH = Math.max(...ys) - hitY;

        const moveAt = placement.toCanvas(cx, cy);
        const scaleXDot = placement.toCanvas(scaleXAt.x, scaleXAt.y);
        const scaleYDot = placement.toCanvas(scaleYAt.x, scaleYAt.y);
        const rotateDot = placement.toCanvas(rotateAt.x, rotateAt.y);

        // A degenerate adapter (a zero row scale, a corrupted stored value)
        // would otherwise mount a Circle at NaN, which Konva silently draws
        // at the origin. Drop the placement instead.
        if (
          ![
            ...xs,
            ...ys,
            moveAt.x,
            moveAt.y,
            scaleXDot.x,
            scaleXDot.y,
            scaleYDot.x,
            scaleYDot.y,
            rotateDot.x,
            rotateDot.y,
          ].every(Number.isFinite)
        ) {
          return null;
        }

        const beginDrag = (pointer: { x: number; y: number }) => {
          const local = placement.toLocal(pointer.x, pointer.y);
          const scaleX = transform?.scaleX ?? 1;
          const scaleY = transform?.scaleY ?? 1;
          dragStartRef.current = {
            scaleX,
            scaleY,
            offsetX: transform?.offsetX ?? 0,
            offsetY: transform?.offsetY ?? 0,
            pointerX: local.x,
            pointerY: local.y,
            // Where each dot sits right now, relative to the pivot.
            // `scaleFromHandleDrag` recovers the glyph's unscaled extent
            // from this plus the scale it was drawn at. Snapshotted once
            // here — see the dragStartRef comment above for why this must
            // not be recomputed from the live box on every move.
            startDistanceX: scaleXAt.x - pivotX,
            startDistanceY: scaleYAt.y - pivotY,
            gapX,
            gapY,
            pivotX,
            pivotY,
            rotation: resolveGlyphTransform(transform).rotation,
            // The turn's own pivot, in this placement's local space.
            // `transformedBox` rotates the raw outline box about its centre
            // and takes the AABB, and that operation leaves the centre
            // exactly where it was — so the drawn box's centre *is* the point
            // the renderer turns the glyph about, at any scale, offset or
            // angle. No separate pivot needs threading through.
            rotPivotX: cx,
            rotPivotY: cy,
          };
          setDraggingKey(placement.key);
        };

        const endDrag = () => {
          railRef.current = null;
          dragStartRef.current = null;
          setDraggingKey((v) => (v === placement.key ? null : v));
        };

        return (
          // The hover handlers belong on this Group, not on the Rect below —
          // the identical placement `DiacriticHoverHandles` depends on, and
          // for the identical reason. Konva suppresses `mouseleave` at any
          // ancestor of the newly-entered shape, so with the handlers here a
          // Rect->Circle move fires no leave; with them on the Rect, the
          // moment a dot mounted under the pointer the next mousemove cleared
          // the hover key and unmounted the dot, giving both the
          // every-other-frame flicker and the death of any drag whose first
          // step was small.
          <Group
            key={placement.key}
            onMouseEnter={() => setHoveredKey(placement.key)}
            onMouseLeave={() => setHoveredKey((v) => (v === placement.key ? null : v))}
          >
            <Rect
              name="glyph-transform-hit"
              x={hitX}
              y={hitY}
              width={hitW}
              height={hitH}
              fill="transparent"
              // Konva routes a pointer only to the topmost listening shape,
              // and these rects are deliberately wide. Switching every
              // other glyph's rect off while one is hovered OR dragging
              // stops them stealing hover from each other — gating on
              // hover alone would re-arm every neighbour the moment a
              // drag carries the pointer outside this rect, popping a
              // neighbour's dots up mid-gesture.
              listening={(hoveredKey === null && draggingKey === null) || isActive}
            />

            {isActive && (
              <>
                <Circle
                  x={moveAt.x}
                  y={moveAt.y}
                  radius={5}
                  fill={MOVE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return;
                    applyPatch({
                      offsetX: start.offsetX + (local.x - start.pointerX),
                      offsetY: start.offsetY + (local.y - start.pointerY),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />

                <Circle
                  x={scaleXDot.x}
                  y={scaleXDot.y}
                  radius={4}
                  fill={SCALE_X_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    return rail ? projectOntoAxis(rail.a, rail.b, pos) : pos;
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      // The rail is "hold local y, vary local x". Two local
                      // points define it; mapping both through toCanvas and
                      // then the parent's absolute transform expresses it in
                      // the space dragBoundFunc actually speaks.
                      const tr = parent.getAbsoluteTransform();
                      railRef.current = {
                        a: tr.point(placement.toCanvas(pivotX, scaleXAt.y)),
                        b: tr.point(placement.toCanvas(pivotX + 100, scaleXAt.y)),
                      };
                    }
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.x)) return;
                    // Both the rest distance and the pivot come from the
                    // drag-start snapshot, not the live (already-updated)
                    // box — see the dragStartRef comment above.
                    applyPatch({
                      scaleX: scaleFromHandleDrag(
                        start.startDistanceX,
                        local.x - start.pivotX,
                        start.gapX,
                        start.scaleX
                      ),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />

                <Circle
                  x={scaleYDot.x}
                  y={scaleYDot.y}
                  radius={4}
                  fill={SCALE_Y_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    return rail ? projectOntoAxis(rail.a, rail.b, pos) : pos;
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      const tr = parent.getAbsoluteTransform();
                      railRef.current = {
                        a: tr.point(placement.toCanvas(scaleYAt.x, pivotY)),
                        b: tr.point(placement.toCanvas(scaleYAt.x, pivotY - 100)),
                      };
                    }
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.y)) return;
                    applyPatch({
                      // Negative gap: this dot sits *above* the glyph while
                      // canvas y grows downward, so every distance along
                      // this rail is signed the other way.
                      scaleY: scaleFromHandleDrag(
                        start.startDistanceY,
                        local.y - start.pivotY,
                        -start.gapY,
                        start.scaleY
                      ),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />

                {/*
                  The rotate dot free-drags — it has no rail, so no
                  `dragBoundFunc` and therefore no reason to reach for
                  `getAbsoluteTransform()`. `e.target.position()` reports in
                  the overlay's own group space and `toLocal` brings it into
                  the placement's; the two scale handles need the absolute
                  transform only because `dragBoundFunc`'s contract is in
                  stage coordinates, and mixing those spaces is what once
                  teleported a handle sideways under pan and zoom.

                  The bearing is read in *local* space because that is the
                  space the glyph's own turn happens in — on plain text the
                  adapter is a pure translation, so this is bearing-identical
                  to reading it in group space, and on Shape Fill the row
                  frame is a similarity, which also preserves angles.
                */}
                <Circle
                  x={rotateDot.x}
                  y={rotateDot.y}
                  radius={4}
                  fill={ROTATE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return;
                    applyPatch({
                      // The *change* in bearing since the grab, not the
                      // bearing itself — which is what makes the first frame
                      // return the angle unchanged (no jump on mouse-down)
                      // and lets the dot be grabbed anywhere on its circle.
                      rotation: rotationFromHandleDrag(
                        { x: start.rotPivotX, y: start.rotPivotY },
                        { x: start.pointerX, y: start.pointerY },
                        { x: local.x, y: local.y },
                        start.rotation
                      ),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />
              </>
            )}
          </Group>
        );
      })}
    </Group>
  );
};

export default GlyphTransformHoverHandles;
