import React, { useMemo, useState } from "react";
import { Group, Circle, Rect } from "react-konva";
import type { HarfBuzzGlyph } from "../lib/harfbuzz";
import { findDiacriticGlyphIndices } from "../lib/diacritics";
import type { DiacriticOverride } from "../types";
import type { GlyphHitBox } from "./ShapedText";

export type DiacriticHoverHandlesProps = {
  isSelected: boolean;
  glyphs: HarfBuzzGlyph[];
  shapableText: string;
  glyphHitBoxes: GlyphHitBox[];
  diacriticOverrides: DiacriticOverride[];
  /** Group-local x/y to add to a hit box's own x/y — same `bx + localDrawX` / `by + localDrawY` offset the rest of ShapedText.tsx already uses to place its own overlays. */
  offsetX: number;
  offsetY: number;
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
 * grabbing, while the actual render-time scale (ShapedText.tsx's
 * drawWarpedGlyphRun) pivots around the glyph's pen-origin (gx, gy) —
 * a deliberate, minor approximation: the handle sits where it's easy to
 * grab, not exactly where the glyph visually pivots from.
 */
export const DiacriticHoverHandles: React.FC<DiacriticHoverHandlesProps> = ({
  isSelected,
  glyphs,
  shapableText,
  glyphHitBoxes,
  diacriticOverrides,
  offsetX,
  offsetY,
  fontSize,
  onDragDiacriticOverride,
  onToggleDiacriticHidden,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const diacriticIndices = useMemo(
    () => findDiacriticGlyphIndices(glyphs, shapableText),
    [glyphs, shapableText]
  );

  if (!isSelected) return null;

  const diacriticBoxes = glyphHitBoxes.filter((b) => diacriticIndices.has(b.glyphIndex));
  const handleSpacing = fontSize * 0.25;

  return (
    <Group>
      {diacriticBoxes.map((box) => {
        const override = diacriticOverrides.find((o) => o.glyphIndex === box.glyphIndex);
        const cx = offsetX + box.x + box.width / 2;
        const cy = offsetY + box.y + box.height / 2;
        const displayY = cy + (override?.offsetY ?? 0);
        const isHovered = hoveredIndex === box.glyphIndex;

        return (
          <Group key={box.glyphIndex}>
            <Rect
              x={offsetX + box.x - 4}
              y={offsetY + box.y - 4}
              width={box.width + 8}
              height={box.height + 8}
              fill="transparent"
              onMouseEnter={() => setHoveredIndex(box.glyphIndex)}
              onMouseLeave={() =>
                setHoveredIndex((v) => (v === box.glyphIndex ? null : v))
              }
            />

            {isHovered && (
              <>
                <Circle
                  x={cx}
                  y={displayY}
                  radius={5}
                  fill={MOVE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  dragBoundFunc={(pos) => ({ x: cx, y: pos.y })}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const newOffsetY = e.target.y() - cy;
                    onDragDiacriticOverride?.(box.glyphIndex, { offsetY: newOffsetY });
                  }}
                />

                <Circle
                  x={cx + handleSpacing}
                  y={displayY}
                  radius={4}
                  fill={RESIZE_HANDLE_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  draggable
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onDragMove={(e) => {
                    e.cancelBubble = true;
                    const pos = e.target.position();
                    const dist = Math.hypot(pos.x - cx, pos.y - displayY);
                    const nextScale = Math.max(
                      0.3,
                      Math.min(3, dist / Math.max(handleSpacing, 1))
                    );
                    onDragDiacriticOverride?.(box.glyphIndex, { scale: nextScale });
                  }}
                />

                <Circle
                  x={cx - handleSpacing}
                  y={displayY}
                  radius={4}
                  fill={override?.hidden ? HIDE_BUTTON_COLOR_ACTIVE : HIDE_BUTTON_COLOR}
                  stroke="#ffffff"
                  strokeWidth={1.5}
                  onMouseDown={(e) => {
                    e.cancelBubble = true;
                  }}
                  onClick={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(box.glyphIndex);
                  }}
                  onTap={(e) => {
                    e.cancelBubble = true;
                    onToggleDiacriticHidden?.(box.glyphIndex);
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
