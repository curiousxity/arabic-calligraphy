import React, { useMemo } from "react";
import { Group, Shape } from "react-konva";
import type Konva from "konva";
import type { kufiStarProps } from "../lib/blockRenderProps";
import { createBlockFillPainter } from "../lib/blockFill";
import { kufiCellSize } from "../lib/kufi/kufiPanelBlock";
import { starConstruction } from "../lib/kufi/kufiStarGeometry";
import { kufiStarPath, starOutlineBox } from "../lib/kufi/kufiStarPath";

export type KufiStarViewProps = ReturnType<typeof kufiStarProps> & {
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

/** The ring lists of a path made only of `M x y L x y ... Z`, which is all `kufiStarPath` writes. */
function pathRings(d: string): Array<Array<[number, number]>> {
  return d
    .split("M")
    .slice(1)
    .map((part) => {
      const n = part.replace(/[LZ]/g, " ").trim().split(/\s+/).map(Number);
      const pts: Array<[number, number]> = [];
      for (let i = 0; i + 1 < n.length; i += 2) pts.push([n[i], n[i + 1]]);
      return pts;
    });
}

/**
 * Draws a Kufi star panel: its construction as **one** traced outline in one
 * Shape, so the SVG export holds a single `<path>`. Points are in px, not
 * under `ctx.scale` (the SVG exporter loses a path drawn under a scale);
 * outline before fill; the fill through `createBlockFillPainter`. Stage 1:
 * no region text yet, so the ink is the construction lines.
 */
export const KufiStarView: React.FC<KufiStarViewProps> = (p) => {
  const cell = kufiCellSize(p.fontSize);
  const construction = useMemo(() => starConstruction(p.starFold, p.starK, p.starSize), [p.starFold, p.starK, p.starSize]);
  const rings = useMemo(
    () => pathRings(kufiStarPath(construction, construction.regions.map(() => null), p.starLines, cell)),
    [construction, p.starLines, cell]
  );
  const box = useMemo(() => starOutlineBox(construction), [construction]);
  const width = box.width * cell;
  const height = box.height * cell;

  return (
    <Group
      id={p.id}
      x={p.x}
      y={p.y}
      rotation={p.rotation}
      opacity={p.opacity ?? 1}
      draggable={p.draggable && !p.locked}
      onClick={p.onClick}
      onTap={p.onTap}
      onDblClick={p.onDblClick}
      onDragMove={p.onDragMove}
      onDragEnd={p.onDragEnd}
    >
      <Shape
        width={width}
        height={height}
        // Only the hit canvas reads this: Konva's hit pass fills a shape only when it has one.
        fill="transparent"
        hitFunc={(ctx, shape) => {
          ctx.beginPath();
          ctx.rect(0, 0, width, height);
          ctx.closePath();
          ctx.fillStrokeShape(shape);
        }}
        shadowColor={p.shadowBlur > 0 ? p.shadowColor : undefined}
        shadowBlur={p.shadowBlur}
        shadowOffsetX={p.shadowOffsetX}
        shadowOffsetY={p.shadowOffsetY}
        shadowOpacity={p.shadowOpacity}
        sceneFunc={(ctx) => {
          if (rings.length === 0) return;
          const c2d = ctx as unknown as CanvasRenderingContext2D;
          ctx.save();
          const painter = createBlockFillPainter(ctx, p.fill, p.color, { x: 0, y: 0, width, height });
          c2d.beginPath();
          for (const ring of rings) {
            ring.forEach(([x, y], i) => {
              if (i === 0) c2d.moveTo(x, y);
              else c2d.lineTo(x, y);
            });
            c2d.closePath();
          }
          c2d.fillStyle = painter.style;
          if (p.strokeWidth > 0) {
            c2d.strokeStyle = p.stroke ?? "#000";
            c2d.lineWidth = p.strokeWidth;
            c2d.lineJoin = "miter";
            c2d.stroke();
          }
          painter.fill(ctx);
          ctx.restore();
        }}
      />
    </Group>
  );
};
