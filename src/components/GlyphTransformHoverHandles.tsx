import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import { projectOntoAxis } from "../lib/dragAxis";
import { scaleFromHandleDrag } from "../lib/glyphTransform";
import type { GlyphHitBox } from "./ShapedText";
import type { GlyphTransform } from "../types";

export type GlyphTransformHoverHandlesProps = {
  isSelected: boolean;
  /** Armed by the Morph panel's "Move & scale glyph" checkbox. */
  enabled: boolean;
  /** Already transform-aware: ShapedText applies each glyph's transform when it builds these. */
  glyphHitBoxes: GlyphHitBox[];
  glyphTransforms: GlyphTransform[];
  /** The block's own canvas-space origin — these boxes are in glyph-run space. */
  offsetX: number;
  offsetY: number;
  onUpdateGlyphTransform?: (glyphIndex: number, patch: Partial<GlyphTransform>) => void;
};

const MOVE_HANDLE_COLOR = "#38bdf8";
const SCALE_X_HANDLE_COLOR = "#d4af37";
const SCALE_Y_HANDLE_COLOR = "#22c55e";

/** How far outside the glyph box the two scale dots sit, in px. */
const SCALE_HANDLE_GAP = 10;

/**
 * On-canvas hover-only overlay for moving and scaling a whole glyph.
 *
 * Only the currently-hovered glyph shows handles — the same rule that keeps
 * the diacritic and stroke-stretch overlays from turning a line of text
 * into a field of dots.
 *
 * All arithmetic is in glyph-run space; `offsetX`/`offsetY` shift into the
 * Konva group space the overlay draws in. The one exception is
 * `dragBoundFunc`, whose contract is *absolute* (stage) coordinates — the
 * rails are therefore captured through the parent's absolute transform at
 * drag start, the technique DiacriticHoverHandles established after mixing
 * the two spaces teleported its move handle sideways under pan/zoom.
 */
export const GlyphTransformHoverHandles: React.FC<GlyphTransformHoverHandlesProps> = ({
  isSelected,
  enabled,
  glyphHitBoxes,
  glyphTransforms,
  offsetX,
  offsetY,
  onUpdateGlyphTransform,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  // Sticky-hover while a handle is being dragged: a move handle travels
  // well outside the hit rect during a normal gesture, so containment
  // alone can't be trusted mid-drag.
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const railRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(
    null
  );
  // The transform as it stood when this drag began. Reading it live from
  // props during onDragMove would compound each frame's scale onto the
  // previous one and run away exponentially.
  //
  // `startDistanceX`/`startDistanceY`/`pivotX`/`pivotY` are likewise
  // snapshotted here rather than recomputed from the live `box` on every
  // move: `glyphHitBoxes` is memoized on `glyphTransforms`, so each
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
    pivotX: number;
    pivotY: number;
  } | null>(null);

  if (!isSelected || !enabled) return null;

  return (
    <Group>
      {glyphHitBoxes.map((box) => {
        const transform = glyphTransforms.find((t) => t.glyphIndex === box.glyphIndex);
        const isActive = hoveredIndex === box.glyphIndex || draggingIndex === box.glyphIndex;

        // Handle rest positions, in glyph-run space, on the box as
        // currently drawn (ShapedText already folded the transform into
        // these boxes, so the dots follow a transformed glyph).
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const scaleXAt = { x: box.x + box.width + SCALE_HANDLE_GAP, y: cy };
        const scaleYAt = { x: cx, y: box.y - SCALE_HANDLE_GAP };

        // The scale pivot is the renderer's own pivot: it translates to the
        // pen origin, THEN to the transform's offset, THEN scales (see
        // `drawWarpedGlyphRun`/`transformedBox`) — so once a glyph has been
        // moved, the pen origin alone (`box.gx`/`box.gy`) is no longer the
        // point the renderer actually scales about. Folding in the current
        // offset keeps this in agreement with `transformedBox`.
        const pivotX = box.gx + (transform?.offsetX ?? 0);
        const pivotY = box.gy + (transform?.offsetY ?? 0);

        // The hit rect covers the glyph plus every dot's rest position, so
        // a dot dragged outward can't leave the rect, fire onMouseLeave,
        // and unmount itself mid-gesture.
        const rx1 = Math.min(box.x, scaleYAt.x, scaleXAt.x) - SCALE_HANDLE_GAP;
        const ry1 = Math.min(box.y, scaleYAt.y, scaleXAt.y) - SCALE_HANDLE_GAP;
        const rx2 = Math.max(box.x + box.width, scaleXAt.x, scaleYAt.x) + SCALE_HANDLE_GAP;
        const ry2 = Math.max(box.y + box.height, scaleXAt.y, scaleYAt.y) + SCALE_HANDLE_GAP;

        const beginDrag = (pointer: { x: number; y: number }) => {
          const scaleX = transform?.scaleX ?? 1;
          const scaleY = transform?.scaleY ?? 1;
          dragStartRef.current = {
            scaleX,
            scaleY,
            offsetX: transform?.offsetX ?? 0,
            offsetY: transform?.offsetY ?? 0,
            pointerX: pointer.x,
            pointerY: pointer.y,
            // Where each dot sits right now, relative to the pivot.
            // `scaleFromHandleDrag` recovers the glyph's unscaled extent
            // from this plus the scale it was drawn at. Snapshotted once
            // here — see the dragStartRef comment above for why this must
            // not be recomputed from the live box on every move.
            startDistanceX: scaleXAt.x - pivotX,
            startDistanceY: scaleYAt.y - pivotY,
            pivotX,
            pivotY,
          };
          setDraggingIndex(box.glyphIndex);
        };

        const endDrag = () => {
          railRef.current = null;
          dragStartRef.current = null;
          setDraggingIndex((v) => (v === box.glyphIndex ? null : v));
        };

        return (
          <Group key={box.glyphIndex}>
            <Rect
              x={rx1 + offsetX}
              y={ry1 + offsetY}
              width={rx2 - rx1}
              height={ry2 - ry1}
              fill="transparent"
              // Konva routes a pointer only to the topmost listening shape,
              // and these rects are deliberately wide. Switching every
              // other glyph's rect off while one is hovered OR dragging
              // stops them stealing hover from each other — gating on
              // hover alone would re-arm every neighbour the moment a
              // drag carries the pointer outside this rect, popping a
              // neighbour's dots up mid-gesture.
              listening={(hoveredIndex === null && draggingIndex === null) || isActive}
              onMouseEnter={() => setHoveredIndex(box.glyphIndex)}
              onMouseLeave={() =>
                setHoveredIndex((v) => (v === box.glyphIndex ? null : v))
              }
            />

            {isActive && (
              <>
                <Circle
                  x={cx + offsetX}
                  y={cy + offsetY}
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
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      offsetX: start.offsetX + (pos.x - start.pointerX),
                      offsetY: start.offsetY + (pos.y - start.pointerY),
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    endDrag();
                  }}
                />

                <Circle
                  x={scaleXAt.x + offsetX}
                  y={scaleXAt.y + offsetY}
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
                      const tr = parent.getAbsoluteTransform();
                      railRef.current = {
                        a: tr.point({ x: pivotX + offsetX, y: scaleXAt.y + offsetY }),
                        b: tr.point({
                          x: pivotX + offsetX + 100,
                          y: scaleXAt.y + offsetY,
                        }),
                      };
                    }
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    // Both the rest distance and the pivot come from the
                    // drag-start snapshot, not the live (already-updated)
                    // box — see the dragStartRef comment above.
                    const dragDistance = pos.x - (start.pivotX + offsetX);
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      scaleX: scaleFromHandleDrag(
                        start.startDistanceX,
                        dragDistance,
                        SCALE_HANDLE_GAP,
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
                  x={scaleYAt.x + offsetX}
                  y={scaleYAt.y + offsetY}
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
                        a: tr.point({ x: scaleYAt.x + offsetX, y: pivotY + offsetY }),
                        b: tr.point({
                          x: scaleYAt.x + offsetX,
                          y: pivotY + offsetY - 100,
                        }),
                      };
                    }
                    beginDrag(e.target.position());
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const start = dragStartRef.current;
                    if (!start) return;
                    const pos = e.target.position();
                    // Both the rest distance and the pivot come from the
                    // drag-start snapshot, not the live (already-updated)
                    // box — see the dragStartRef comment above.
                    const dragDistance = pos.y - (start.pivotY + offsetY);
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      // Negative gap: this dot sits *above* the glyph while
                      // canvas y grows downward, so every distance along
                      // this rail is signed the other way.
                      scaleY: scaleFromHandleDrag(
                        start.startDistanceY,
                        dragDistance,
                        -SCALE_HANDLE_GAP,
                        start.scaleY
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
