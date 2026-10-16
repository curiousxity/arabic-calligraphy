import React, { useMemo } from "react";
import { Group, Rect, Shape } from "react-konva";
import type Konva from "konva";
import type { markProps } from "../lib/blockRenderProps";
import { markPxBounds, markPxCmds } from "../lib/markLibrary";
import { replayPath } from "../lib/svgPath";
import { createBlockFillPainter } from "../lib/blockFill";

export type MarkViewProps = ReturnType<typeof markProps> & {
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
};

/**
 * Draws a mark block: one library outline, centred on the block's origin.
 * Same drawing as StackView — outline before fill, gradients through the
 * block fill painter, commands pre-scaled to px for the SVG export.
 */
/** How far outside its ink a mark still takes a click, in px. */
const HIT_MARGIN_PX = 5;

export const MarkView: React.FC<MarkViewProps> = (p) => {
  const cmds = useMemo(
    () => markPxCmds(p.markD, p.fontSize, p.markFlipX, p.markScaleX, p.markScaleY),
    [p.markD, p.fontSize, p.markFlipX, p.markScaleX, p.markScaleY]
  );
  const px = useMemo(() => markPxBounds(cmds), [cmds]);

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
      {/* Bounds only: a sceneFunc-only Shape measures as 0×0. Not a hit
          area — a frame's open middle must let a click reach the text
          inside it, so only the ink (plus a margin, for a small dot) hits. */}
      <Rect x={px.x} y={px.y} width={px.width} height={px.height} fill="transparent" listening={false} />
      <Shape
        hitFunc={(ctx, shape) => {
          if (cmds.length === 0) return;
          replayPath(ctx as unknown as CanvasRenderingContext2D, cmds);
          ctx.fillStyle = shape.colorKey;
          ctx.fill();
          ctx.lineWidth = HIT_MARGIN_PX * 2;
          ctx.lineJoin = "round";
          ctx.strokeStyle = shape.colorKey;
          ctx.stroke();
        }}
        shadowColor={p.shadowBlur > 0 ? p.shadowColor : undefined}
        shadowBlur={p.shadowBlur}
        shadowOffsetX={p.shadowOffsetX}
        shadowOffsetY={p.shadowOffsetY}
        shadowOpacity={p.shadowOpacity}
        sceneFunc={(ctx) => {
          if (cmds.length === 0) return;
          ctx.save();
          const painter = createBlockFillPainter(ctx, p.fill, p.color, px);
          ctx.fillStyle = painter.style;
          replayPath(ctx as unknown as CanvasRenderingContext2D, cmds);
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
    </Group>
  );
};
