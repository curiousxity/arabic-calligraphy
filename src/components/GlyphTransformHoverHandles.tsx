import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import { projectOntoAxis } from "../lib/strokeSchema/dragAxis";
import { scaleFromDrag } from "../lib/glyphTransform";
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
  const dragStartRef = useRef<{
    scaleX: number;
    scaleY: number;
    offsetX: number;
    offsetY: number;
    pointerX: number;
    pointerY: number;
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

        // The pen origin is the scale pivot — the same point the renderer
        // pivots on, so a drag reads back the scale the glyph will draw at.
        const pivotX = box.gx;
        const pivotY = box.gy;

        // The hit rect covers the glyph plus every dot's rest position, so
        // a dot dragged outward can't leave the rect, fire onMouseLeave,
        // and unmount itself mid-gesture.
        const rx1 = Math.min(box.x, scaleYAt.x, scaleXAt.x) - SCALE_HANDLE_GAP;
        const ry1 = Math.min(box.y, scaleYAt.y, scaleXAt.y) - SCALE_HANDLE_GAP;
        const rx2 = Math.max(box.x + box.width, scaleXAt.x, scaleYAt.x) + SCALE_HANDLE_GAP;
        const ry2 = Math.max(box.y + box.height, scaleXAt.y, scaleYAt.y) + SCALE_HANDLE_GAP;

        const beginDrag = (pointer: { x: number; y: number }) => {
          dragStartRef.current = {
            scaleX: transform?.scaleX ?? 1,
            scaleY: transform?.scaleY ?? 1,
            offsetX: transform?.offsetX ?? 0,
            offsetY: transform?.offsetY ?? 0,
            pointerX: pointer.x,
            pointerY: pointer.y,
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
              // other glyph's rect off while one is active stops them
              // stealing hover from each other.
              listening={hoveredIndex === null || isActive}
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
                    // Rest distance is measured at scale 1, so divide the
                    // current dot distance by the scale it was drawn at.
                    const restDistance =
                      (scaleXAt.x + offsetX - (pivotX + offsetX)) / (start.scaleX || 1);
                    const dragDistance = pos.x - (pivotX + offsetX);
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      scaleX: scaleFromDrag(restDistance, dragDistance),
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
                    const restDistance =
                      (scaleYAt.y + offsetY - (pivotY + offsetY)) / (start.scaleY || 1);
                    const dragDistance = pos.y - (pivotY + offsetY);
                    onUpdateGlyphTransform?.(box.glyphIndex, {
                      scaleY: scaleFromDrag(restDistance, dragDistance),
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
