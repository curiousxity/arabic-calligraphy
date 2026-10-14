import React, { useMemo } from "react";
import { Group, Rect, Shape } from "react-konva";
import type Konva from "konva";
import type { stackProps } from "../lib/blockRenderProps";
import { assembleStackOutline, stackScale } from "../lib/stackOutline";
import { outlineBounds } from "../lib/strokeCuts";
import { replayPath } from "../lib/svgPath";
import { createBlockFillPainter } from "../lib/blockFill";

export type StackViewProps = ReturnType<typeof stackProps> & {
  id?: string;
  x: number;
  y: number;
  opacity?: number;
  locked?: boolean;
  draggable?: boolean;
  isSelected?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  /** Editing chrome mounted inside the block's group (Task 8). */
  editing?: React.ReactNode;
};

/**
 * Draws a stack block: one outline assembled from its pieces and joins, in
 * font units, scaled at draw time. Outline before fill, like every other
 * renderer (see CLAUDE.md, "Rendering"). Export needs nothing extra: the
 * stage snapshot and react-konva-to-svg both replay this sceneFunc.
 */
export const StackView: React.FC<StackViewProps> = (p) => {
  const scale = stackScale(p.fontSize, p.unitsPerEm);
  const outline = useMemo(
    () => assembleStackOutline(p.pieces, p.joins, p.nib),
    [p.pieces, p.joins, p.nib]
  );
  const b = useMemo(() => outlineBounds(outline), [outline]);
  const px = {
    x: b.x1 * scale,
    y: b.y1 * scale,
    width: (b.x2 - b.x1) * scale,
    height: (b.y2 - b.y1) * scale,
  };

  return (
    <Group
      id={p.id}
      x={p.x}
      y={p.y}
      rotation={p.rotation}
      opacity={p.opacity ?? 1}
      draggable={p.draggable}
      onClick={p.onClick}
      onTap={p.onTap}
      onDblClick={p.onDblClick}
      onDragMove={p.onDragMove}
      onDragEnd={p.onDragEnd}
    >
      {/* Hit area for selecting and dragging the whole block. */}
      <Rect x={px.x} y={px.y} width={px.width} height={px.height} fill="transparent" />
      <Shape
        listening={false}
        // Same shadow handling as ShapedText: Konva applies these around the
        // sceneFunc, so the outline's fill and stroke are shadowed together.
        shadowColor={p.shadowBlur > 0 ? p.shadowColor : undefined}
        shadowBlur={p.shadowBlur}
        shadowOffsetX={p.shadowOffsetX}
        shadowOffsetY={p.shadowOffsetY}
        shadowOpacity={p.shadowOpacity}
        sceneFunc={(ctx) => {
          if (outline.length === 0) return;
          ctx.save();
          // Built in block space (before the font-unit scale) so a gradient
          // spans the whole composition rather than restarting per piece.
          const painter = createBlockFillPainter(ctx, p.fill, p.color, px);
          ctx.fillStyle = painter.style;
          // The path is stored in device space as it is traced, so scaling
          // only around the tracing leaves strokeWidth in screen px.
          ctx.save();
          ctx.scale(scale, scale);
          replayPath(ctx as unknown as CanvasRenderingContext2D, outline);
          ctx.restore();
          if (p.strokeWidth > 0) {
            ctx.strokeStyle = p.stroke ?? "#000";
            ctx.lineWidth = p.strokeWidth;
            ctx.lineJoin = "round";
            ctx.stroke();
          }
          painter.fill(ctx);
          ctx.restore();
        }}
      />
      {p.editing}
    </Group>
  );
};
