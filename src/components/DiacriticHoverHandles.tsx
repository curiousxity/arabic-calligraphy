import React, { useRef, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import { projectOntoAxis } from "../lib/dragAxis";
import type { DiacriticPlacement } from "../lib/diacriticPlacement";
import type { DiacriticOverride } from "../types";

export type DiacriticHoverHandlesProps = {
  isSelected: boolean;
  /**
   * One entry per hoverable diacritic instance on canvas, already filtered
   * to real diacritics by the calling renderer. Each carries its own
   * local↔canvas mapping, so this component's arithmetic stays in local
   * space regardless of whether the host block warps, tiles, or neither.
   */
  placements: DiacriticPlacement[];
  diacriticOverrides: DiacriticOverride[];
  fontSize: number;
  onDragDiacriticOverride?: (glyphIndex: number, patch: Partial<DiacriticOverride>) => void;
  onToggleDiacriticHidden?: (glyphIndex: number) => void;
};

const MOVE_HANDLE_COLOR = "#38bdf8";
const RESIZE_HANDLE_COLOR = "#d4af37";
const HIDE_BUTTON_COLOR = "#ef4444";
const HIDE_BUTTON_COLOR_ACTIVE = "#9ca3af";

/**
 * On-canvas hover-only overlay for adjusting individual diacritic marks.
 * Only the currently-hovered diacritic ever shows handles — that's what
 * keeps text with many marks from turning into visual clutter. Handles
 * are positioned at each diacritic's bounding-box center for easy
 * grabbing, while the actual render-time scale pivots around the glyph's
 * pen-origin — a deliberate, minor approximation: the handle sits where
 * it's easy to grab, not exactly where the glyph visually pivots from.
 *
 * All arithmetic below is in the placement's *local* space (the glyph run
 * for text and shape-warp blocks, one tiled glyph instance for shape-fill
 * blocks); `toCanvas` is applied only when drawing and `toLocal` only when
 * reading a drag back. That is the whole of what varies between block
 * types — hover state, the rail, the hit rect, and the three handles are
 * identical for all of them.
 */
export const DiacriticHoverHandles: React.FC<DiacriticHoverHandlesProps> = ({
  isSelected,
  placements,
  diacriticOverrides,
  fontSize,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
}) => {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  // Sticky-hover while a handle for this placement is actively being
  // dragged: the move handle can travel well outside the (generous but
  // still bounded) hit-rect during a normal drag, so rect containment
  // alone can't be trusted mid-gesture — this keeps the handle mounted
  // regardless of pointer position until the drag ends.
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  // The move handle's rail, in absolute (stage) space, captured once at
  // drag start. Konva's dragBoundFunc receives and returns absolute
  // coordinates while everything else here is local, and mixing the two
  // previously teleported this handle sideways under any block
  // offset/pan/zoom. Under a warp the rail is not vertical on screen even
  // though it is vertical in local space, so it is stored as two mapped
  // endpoints rather than a single fixed x.
  const railRef = useRef<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);

  if (!isSelected) return null;

  const handleSpacing = fontSize * 0.25;
  // The hit-rect has to cover the full reach of all three handles, not just
  // the diacritic's own (typically tiny) bounding box: the gold/resize and
  // red/hide handles sit at rest `handleSpacing` to either side of center,
  // and the blue/move handle can be dragged a normal vertical distance away
  // while the gesture is in progress.
  const hitRectHorizontalMargin = handleSpacing + 12;
  const hitRectVerticalMargin = fontSize * 0.5;

  return (
    <Group>
      {placements.map((placement) => {
        const override = diacriticOverrides.find((o) => o.glyphIndex === placement.glyphIndex);
        const { box } = placement;
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const overrideScale = override?.scale ?? 1;
        const displayY = cy + (override?.offsetY ?? 0);
        const isHovered = hoveredKey === placement.key || draggingKey === placement.key;

        // Local-space hit rect derived from the mark's actual rendered
        // position/size (displayY + scaled box), not its original
        // un-overridden box — otherwise a mark moved via offsetY or
        // enlarged via scale drifts out from under its own hit area.
        const scaledWidth = box.width * overrideScale;
        const scaledHeight = box.height * overrideScale;
        const rx1 = cx - scaledWidth / 2 - hitRectHorizontalMargin * overrideScale;
        const ry1 = displayY - scaledHeight / 2 - hitRectVerticalMargin * overrideScale;
        const rx2 = cx + scaledWidth / 2 + hitRectHorizontalMargin * overrideScale;
        const ry2 = displayY + scaledHeight / 2 + hitRectVerticalMargin * overrideScale;

        // A rotated or warped local rect is not an axis-aligned rect on
        // canvas, and Konva's Rect cannot express one. Map all four
        // corners and take their bounding box: slightly larger than the
        // true region, which only ever makes the mark easier to hover.
        const corners = [
          placement.toCanvas(rx1, ry1),
          placement.toCanvas(rx2, ry1),
          placement.toCanvas(rx1, ry2),
          placement.toCanvas(rx2, ry2),
        ];
        const xs = corners.map((c) => c.x);
        const ys = corners.map((c) => c.y);

        const moveAt = placement.toCanvas(cx, displayY);
        const resizeAt = placement.toCanvas(cx + handleSpacing, displayY);
        const hideAt = placement.toCanvas(cx - handleSpacing, displayY);

        // A non-invertible warp (Newton's method bailing on a near-singular
        // Jacobian) would otherwise mount a Circle at NaN, which Konva
        // silently renders at the origin. Drop the placement instead.
        if (![...xs, ...ys, moveAt.x, moveAt.y, resizeAt.x, resizeAt.y, hideAt.x, hideAt.y].every(Number.isFinite)) {
          return null;
        }

        return (
          <Group key={placement.key}>
            <Rect
              name="diacritic-hit"
              x={Math.min(...xs)}
              y={Math.min(...ys)}
              width={Math.max(...xs) - Math.min(...xs)}
              height={Math.max(...ys) - Math.min(...ys)}
              fill="transparent"
              onMouseEnter={() => setHoveredKey(placement.key)}
              onMouseLeave={() => setHoveredKey((v) => (v === placement.key ? null : v))}
            />

            {isHovered && (
              <>
                <Circle
                  x={moveAt.x}
                  y={moveAt.y}
                  radius={5}
                  fill={MOVE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => {
                    const rail = railRef.current;
                    if (!rail) return pos;
                    return projectOntoAxis(rail.a, rail.b, pos);
                  }}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    const parent = e.target.getParent();
                    if (parent) {
                      // The rail is "hold local x, vary local y". Two local
                      // points a font-size apart define it; mapping both
                      // through toCanvas and then the parent's absolute
                      // transform expresses it in the space dragBoundFunc
                      // actually speaks.
                      const transform = parent.getAbsoluteTransform();
                      const lo = placement.toCanvas(cx, displayY - fontSize);
                      const hi = placement.toCanvas(cx, displayY + fontSize);
                      railRef.current = {
                        a: transform.point(lo),
                        b: transform.point(hi),
                      };
                    }
                    setDraggingKey(placement.key);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.y)) return;
                    onDragDiacriticOverride?.(placement.glyphIndex, {
                      offsetY: local.y - cy,
                    });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    railRef.current = null;
                    setDraggingKey((v) => (v === placement.key ? null : v));
                  }}
                />

                <Circle
                  x={resizeAt.x}
                  y={resizeAt.y}
                  radius={4}
                  fill={RESIZE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragStart={(e) => {
                    e.cancelBubble = true;
                    setDraggingKey(placement.key);
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const pos = e.target.position();
                    const local = placement.toLocal(pos.x, pos.y);
                    if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return;
                    const dist = Math.hypot(local.x - cx, local.y - displayY);
                    const nextScale = Math.max(
                      0.3,
                      Math.min(3, dist / Math.max(handleSpacing, 1))
                    );
                    onDragDiacriticOverride?.(placement.glyphIndex, { scale: nextScale });
                  }}
                  onDragEnd={(e) => {
                    e.cancelBubble = true;
                    setDraggingKey((v) => (v === placement.key ? null : v));
                  }}
                />

                <Circle
                  x={hideAt.x}
                  y={hideAt.y}
                  radius={4}
                  fill={override?.hidden ? HIDE_BUTTON_COLOR_ACTIVE : HIDE_BUTTON_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(placement.glyphIndex);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(placement.glyphIndex);
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

export default DiacriticHoverHandles;
