import React, { useRef, useState } from "react";
import { Group, Circle, Rect, Line } from "react-konva";
import type { StretchDefinition } from "../lib/strokeSchema/deriveCatalog";
import { mapNormToRealBox } from "../lib/strokeSchema/schemaGeometry";
import {
  dotPositionForFactor,
  factorForPosition,
  projectOntoAxis,
  type AxisPoint,
} from "../lib/strokeSchema/dragAxis";
import type { GlyphEdit, GlyphStretchHandle } from "../types";
import type { GlyphHitBox } from "./ShapedText";

export type StrokeStretchHoverHandlesProps = {
  isSelected: boolean;
  /** One or more StretchDefinitions per glyph index that has an authored schema — absent/empty for a glyph with none. */
  glyphSchemaCatalog: Record<number, StretchDefinition[]>;
  glyphEdits: GlyphEdit[];
  glyphHitBoxes: GlyphHitBox[];
  /** Group-local x/y to add to a hit box's own x/y — same offset DiacriticHoverHandles already uses. */
  offsetX: number;
  offsetY: number;
  onSetStretchFactor?: (
    glyphIndex: number,
    definition: StretchDefinition,
    factor: number
  ) => void;
  onDeleteStretchHandle?: (glyphIndex: number, handleId: string) => void;
};

const DOT_COLOR = "#22c55e";
const DOT_ACTIVE_COLOR = "#16a34a";
const GUIDE_COLOR = "#22c55e";

function findHandle(
  edits: GlyphEdit[],
  glyphIndex: number,
  def: StretchDefinition
): GlyphStretchHandle | undefined {
  return edits
    .find((e) => e.glyphIndex === glyphIndex)
    ?.stretches.find(
      (h) => h.schemaStrokeId === def.strokeId && (h.schemaZoneIndex ?? 0) === def.zoneIndex
    );
}

/**
 * On-canvas hover-only overlay for setting a stroke's stretch `factor`
 * directly, replacing the Morph panel's per-stroke sliders for plain text
 * blocks (Shape Fill / Shape Warp keep the sliders). Modeled on
 * DiacriticHoverHandles.tsx: only the currently-hovered letter's dots ever
 * show, to keep text with many authored strokes from turning into visual
 * clutter. A dot's rest position for a given `factor` is
 * `anchor + factor · (dragOrigin - anchor)` (lib/strokeSchema/dragAxis.ts) —
 * `dragOrigin` is already the schema's `factor=1` reference point by
 * construction (App.tsx's `setStretchFactor`), so `factor` doubles directly
 * as the axis-interpolation parameter.
 */
export const StrokeStretchHoverHandles: React.FC<StrokeStretchHoverHandlesProps> = ({
  isSelected,
  glyphSchemaCatalog,
  glyphEdits,
  glyphHitBoxes,
  offsetX,
  offsetY,
  onSetStretchFactor,
  onDeleteStretchHandle,
}) => {
  const [hoveredGlyphIndex, setHoveredGlyphIndex] = useState<number | null>(null);
  const [draggingRowKey, setDraggingRowKey] = useState<string | null>(null);
  const railRef = useRef<{ anchorAbs: AxisPoint; dragOriginAbs: AxisPoint } | null>(null);

  if (!isSelected) return null;

  const glyphIndicesWithSchema = Object.keys(glyphSchemaCatalog)
    .map(Number)
    .filter((i) => (glyphSchemaCatalog[i]?.length ?? 0) > 0);

  const draggingGlyphIndex =
    draggingRowKey != null ? Number(draggingRowKey.split(":")[0]) : null;
  const visibleGlyphIndex = hoveredGlyphIndex ?? draggingGlyphIndex;

  return (
    <Group>
      {glyphIndicesWithSchema.map((glyphIndex) => {
        const box = glyphHitBoxes.find((b) => b.glyphIndex === glyphIndex);
        if (!box) return null;

        // Small fixed margin, not a fraction of the glyph's own box — in a
        // normal run of Arabic text nearly every letter has an authored
        // schema (CLAUDE.md: full 28-letter alphabet), so adjacent glyphs
        // sit close together and a large proportional margin makes
        // neighbouring hit-Rects overlap heavily. Konva routes a pointer to
        // the topmost listening shape (later glyphIndex wins ties), so a
        // wide margin let a later letter's rect steal hover — and the mouse
        // event itself — away from an earlier letter directly underneath
        // it. A small fixed pad is enough slack for a cursor sitting just
        // outside the glyph's ink without reintroducing that overlap.
        const hitMargin = 4;
        // Once some glyph is hovered/dragging, only its own rect keeps
        // listening — every other glyph's (possibly still slightly
        // overlapping) rect stops intercepting the pointer, so hover can't
        // be stolen by a neighbour mid-interaction. Cursor must fully leave
        // the active glyph's rect (firing its own onMouseLeave, which clears
        // visibleGlyphIndex) before any other glyph can pick up hover again.
        const rectListening = visibleGlyphIndex == null || visibleGlyphIndex === glyphIndex;

        return (
          <Group key={glyphIndex}>
            <Rect
              x={offsetX + box.x - hitMargin}
              y={offsetY + box.y - hitMargin}
              width={box.width + hitMargin * 2}
              height={box.height + hitMargin * 2}
              fill="transparent"
              listening={rectListening}
              onMouseEnter={() => setHoveredGlyphIndex(glyphIndex)}
              onMouseLeave={() =>
                setHoveredGlyphIndex((v) => (v === glyphIndex ? null : v))
              }
            />

            {visibleGlyphIndex === glyphIndex &&
              glyphSchemaCatalog[glyphIndex].map((def) => {
                const rowKey = `${glyphIndex}:${def.strokeId}:${def.zoneIndex}`;
                const handle = findHandle(glyphEdits, glyphIndex, def);
                const anchorLocal: AxisPoint = handle
                  ? { x: handle.anchorX, y: handle.anchorY }
                  : mapNormToRealBox(def.anchorNorm, box);
                const dragOriginLocal: AxisPoint = handle
                  ? { x: handle.dragOriginX, y: handle.dragOriginY }
                  : mapNormToRealBox(def.dragNorm, box);
                const factor = handle?.factor ?? 1;
                const dotLocal = dotPositionForFactor(anchorLocal, dragOriginLocal, factor);
                const isDragging = draggingRowKey === rowKey;

                return (
                  <Group key={rowKey}>
                    {isDragging && (
                      <Line
                        points={[
                          offsetX + anchorLocal.x,
                          offsetY + anchorLocal.y,
                          offsetX + dotLocal.x,
                          offsetY + dotLocal.y,
                        ]}
                        stroke={GUIDE_COLOR}
                        strokeWidth={1}
                        dash={[4, 3]}
                        listening={false}
                      />
                    )}
                    <Circle
                      x={offsetX + dotLocal.x}
                      y={offsetY + dotLocal.y}
                      radius={5}
                      fill={isDragging ? DOT_ACTIVE_COLOR : DOT_COLOR}
                      stroke="#ffffff"
                      strokeWidth={1.5}
                      draggable
                      onMouseDown={(e) => {
                        e.cancelBubble = true;
                      }}
                      onDragStart={(e) => {
                        e.cancelBubble = true;
                        const parent = e.target.getParent();
                        if (!parent) return;
                        const transform = parent.getAbsoluteTransform();
                        railRef.current = {
                          anchorAbs: transform.point({
                            x: offsetX + anchorLocal.x,
                            y: offsetY + anchorLocal.y,
                          }),
                          dragOriginAbs: transform.point({
                            x: offsetX + dragOriginLocal.x,
                            y: offsetY + dragOriginLocal.y,
                          }),
                        };
                        setDraggingRowKey(rowKey);
                      }}
                      dragBoundFunc={(pos) => {
                        const rail = railRef.current;
                        if (!rail) return pos;
                        return projectOntoAxis(rail.anchorAbs, rail.dragOriginAbs, pos);
                      }}
                      onDragMove={(e) => {
                        e.cancelBubble = true;
                        const localPos = e.target.position();
                        const nextFactor = factorForPosition(
                          { x: offsetX + anchorLocal.x, y: offsetY + anchorLocal.y },
                          { x: offsetX + dragOriginLocal.x, y: offsetY + dragOriginLocal.y },
                          localPos,
                          def.minFactor,
                          def.maxFactor
                        );
                        onSetStretchFactor?.(glyphIndex, def, nextFactor);
                      }}
                      onDragEnd={(e) => {
                        e.cancelBubble = true;
                        railRef.current = null;
                        setDraggingRowKey((v) => (v === rowKey ? null : v));
                      }}
                      onDblClick={(e) => {
                        e.cancelBubble = true;
                        if (handle) onDeleteStretchHandle?.(glyphIndex, handle.id);
                      }}
                      onDblTap={(e) => {
                        e.cancelBubble = true;
                        if (handle) onDeleteStretchHandle?.(glyphIndex, handle.id);
                      }}
                    />
                  </Group>
                );
              })}
          </Group>
        );
      })}
    </Group>
  );
};

export default StrokeStretchHoverHandles;
