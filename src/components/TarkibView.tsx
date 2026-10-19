import React, { useMemo } from "react";
import { Group, Rect, Shape } from "react-konva";
import type Konva from "konva";
import type { tarkibProps } from "../lib/blockRenderProps";
import { MARK_UNITS_PER_EM, markPxBounds } from "../lib/markLibrary";
import { loadPenLibrary } from "../lib/penLibrary";
import { layoutGeometry } from "../lib/penLayout";
import { replayPath, type SvgCmd } from "../lib/svgPath";
import { createBlockFillPainter } from "../lib/blockFill";

export type TarkibViewProps = ReturnType<typeof tarkibProps> & {
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

/** How far outside its ink the writing still takes a click, in px. */
const HIT_MARGIN_PX = 5;

/** Units to px, the ink's top-left on the block's origin. Pre-scaled rather
 *  than drawn under `ctx.scale`: react-konva-to-svg loses a path whose
 *  transform scope closes (see StackView). */
function toPx(cmds: SvgCmd[], k: number, ox: number, oy: number): SvgCmd[] {
  return cmds.map((c): SvgCmd => {
    switch (c.type) {
      case "M":
      case "L":
        return { type: c.type, x: (c.x - ox) * k, y: (c.y - oy) * k };
      case "C":
        return { type: "C", x1: (c.x1 - ox) * k, y1: (c.y1 - oy) * k, x2: (c.x2 - ox) * k, y2: (c.y2 - oy) * k, x: (c.x - ox) * k, y: (c.y - oy) * k };
      case "Q":
        return { type: "Q", x1: (c.x1 - ox) * k, y1: (c.y1 - oy) * k, x: (c.x - ox) * k, y: (c.y - oy) * k };
      default:
        return c;
    }
  });
}

/**
 * Draws a tarkib block: a phrase written with the pen, redrawn from its
 * layout (penLayout.ts). Same drawing as MarkView: outline before fill,
 * gradients through the block fill painter, commands pre-scaled to px for
 * the SVG export. At stroke opacity 1 the ink is one fill; below it each
 * stroke is filled on its own at that opacity, so the ink deepens where
 * separate strokes cross. The outline always follows the whole ink.
 * See .claude/rules/tarkib.md.
 */
export const TarkibView: React.FC<TarkibViewProps> = (p) => {
  const geom = useMemo(() => {
    try {
      return layoutGeometry(loadPenLibrary(), p.layout);
    } catch (err) {
      // a save whose forms the library no longer has draws nothing rather than breaking the canvas
      console.error("tarkib layout could not be drawn", err);
      return null;
    }
  }, [p.layout]);
  const { union, strokes } = useMemo(() => {
    if (!geom || !Number.isFinite(geom.bounds.x1)) return { union: [] as SvgCmd[], strokes: [] as SvgCmd[][] };
    const k = p.fontSize / MARK_UNITS_PER_EM;
    return {
      union: toPx(geom.union, k, geom.bounds.x1, geom.bounds.y1),
      strokes: geom.strokes.map((s) => toPx(s, k, geom.bounds.x1, geom.bounds.y1)),
    };
  }, [geom, p.fontSize]);
  const px = useMemo(() => markPxBounds(union), [union]);

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
      {/* Bounds only: a sceneFunc-only Shape measures as 0×0. */}
      <Rect x={px.x} y={px.y} width={px.width} height={px.height} fill="transparent" listening={false} />
      <Shape
        hitFunc={(ctx, shape) => {
          if (union.length === 0) return;
          replayPath(ctx as unknown as CanvasRenderingContext2D, union);
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
          if (union.length === 0) return;
          ctx.save();
          const painter = createBlockFillPainter(ctx, p.fill, p.color, px);
          if (p.strokeWidth > 0) {
            replayPath(ctx as unknown as CanvasRenderingContext2D, union);
            ctx.strokeStyle = p.stroke ?? "#000";
            ctx.lineWidth = p.strokeWidth;
            ctx.lineJoin = "round";
            ctx.stroke();
          }
          ctx.fillStyle = painter.style;
          if (p.strokeOpacity >= 1) {
            replayPath(ctx as unknown as CanvasRenderingContext2D, union);
            painter.fill(ctx);
          } else {
            // on top of the block's own opacity, which Konva has already set
            ctx.globalAlpha = ctx.globalAlpha * p.strokeOpacity;
            for (const s of strokes) {
              replayPath(ctx as unknown as CanvasRenderingContext2D, s);
              painter.fill(ctx);
            }
          }
          ctx.restore();
        }}
      />
    </Group>
  );
};
