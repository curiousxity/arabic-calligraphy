import React, { useLayoutEffect, useMemo, useRef } from "react";
import { Group, Line, Shape, Text } from "react-konva";
import type Konva from "konva";
import type { kufiStarProps } from "../lib/blockRenderProps";
import { createBlockFillPainter } from "../lib/blockFill";
import { kufiCellSize } from "../lib/kufi/kufiPanelBlock";
import { starConstruction } from "../lib/kufi/kufiStarGeometry";
import { kufiStarBox, kufiStarLayoutPath } from "../lib/kufi/kufiStarPath";
import { KUFI_STAR_NO_TEXT, kufiStarInputs, kufiStarStatus, kufiStarTextCount } from "../lib/kufi/kufiStarLayout";
import { useKufiStarLayout } from "../hooks/useKufiStarLayout";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import { KUFI_UNFIT_FRAME_STYLE } from "../lib/kufi/kufiPanelStatus";

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

const STATUS_TYPE = 13;
const STATUS_W = 260;

/**
 * The star's status line, centred near the bottom of its box: editor chrome
 * only (`EXPORT_HIDDEN`), drawn at the inverse of the stage's zoom (13 px type
 * at any zoom), as `KufiUnfitFrame` draws a panel's.
 */
const KufiStarStatusLine: React.FC<{ width: number; height: number; color: string; text: string }> = ({
  width,
  height,
  color,
  text,
}) => {
  const ui = useRef<Konva.Group>(null);
  useLayoutEffect(() => {
    const g = ui.current;
    if (!g) return;
    const k = Math.abs(g.getParent()?.getAbsoluteScale().x ?? 1) || 1;
    g.scale({ x: 1 / k, y: 1 / k });
    g.getLayer()?.batchDraw();
  });
  return (
    <Group name={EXPORT_HIDDEN} listening={false}>
      <Group ref={ui} x={width / 2} y={height}>
        <Text
          name="kufi-star-status"
          x={-STATUS_W / 2}
          y={-STATUS_TYPE * 2}
          width={STATUS_W}
          align="center"
          text={text}
          fontSize={STATUS_TYPE}
          fill={color}
          listening={false}
        />
      </Group>
    </Group>
  );
};

/**
 * Draws a Kufi star panel: its layout as **one** traced outline in one
 * Shape, so the SVG export holds a single `<path>`. Points are in px, not
 * under `ctx.scale` (the SVG exporter loses a path drawn under a scale);
 * outline before fill; the fill through `createBlockFillPainter`. The text
 * is packed in the worker (`useKufiStarLayout`). In the octagon layout the
 * square is one grid (`kufiOctagonPath`); in the wedges layout a region of a
 * kind shares the kind's packing and is placed through its own frame, so the
 * copies are the same cells by rotation. A region that did not pack (the
 * octagon's side, when its text does not) draws no ink, only a dashed
 * outline of its polygon as editor chrome (so it is not blank paper with the
 * lines off), and the status line says so.
 */
export const KufiStarView: React.FC<KufiStarViewProps> = (p) => {
  const cell = kufiCellSize(p.fontSize);
  const { layout, failed } = useKufiStarLayout(p);
  const inputs = useMemo(
    () => kufiStarInputs(p),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the five layout fields, not the props object
    [p.starLayout, p.starFold, p.starK, p.starSize, p.starRegions]
  );
  const rings = useMemo(() => pathRings(kufiStarLayoutPath(inputs, layout, p.starLines, cell)), [inputs, layout, p.starLines, cell]);
  // With no region text there is nothing to arrange; only the outline warning can apply.
  const noText = kufiStarTextCount(inputs) === 0;
  const status = kufiStarStatus(noText ? KUFI_STAR_NO_TEXT : layout, !noText && failed, p.strokeWidth);
  const box = useMemo(() => kufiStarBox(inputs), [inputs]);
  // Each unpacked region's polygon in px (origin at the box's top-left, as the path): the octagon's square, or a wedge.
  const unpackedOutlines = useMemo(() => {
    const unpacked = layout?.unpacked ?? [];
    if (unpacked.length === 0) return [];
    if (inputs.layout === "octagon") return [[0, 0, box.width * cell, 0, box.width * cell, box.height * cell, 0, box.height * cell]];
    const construction = starConstruction(inputs.fold, inputs.k, inputs.size);
    return unpacked.flatMap((i) => {
      const polygon = construction.regions[i]?.polygon;
      return polygon ? [polygon.flatMap((q) => [(q.x - box.minX) * cell, (q.y - box.minY) * cell])] : [];
    });
  }, [layout, inputs, box, cell]);
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
      {unpackedOutlines.length > 0 && (
        <Group name={EXPORT_HIDDEN} listening={false}>
          {unpackedOutlines.map((points, i) => (
            <Line
              key={i}
              name="kufi-star-unpacked"
              points={points}
              closed
              stroke={p.color}
              {...KUFI_UNFIT_FRAME_STYLE}
              dash={[...KUFI_UNFIT_FRAME_STYLE.dash]}
              listening={false}
            />
          ))}
        </Group>
      )}
      {status &&<KufiStarStatusLine width={width} height={height} color={p.color} text={status} />}
    </Group>
  );
};
