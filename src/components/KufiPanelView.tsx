import React, { useMemo, useState } from "react";
import { Group, Shape } from "react-konva";
import type Konva from "konva";
import type { kufiPanelProps } from "../lib/blockRenderProps";
import { cellRings } from "../lib/kufi/kufiGrid";
import type { KufiPackResult, KufiPanelEdits } from "../lib/kufi/kufiPack";
import { createBlockFillPainter } from "../lib/blockFill";
import { useKufiPanelLayout } from "../hooks/useKufiPanelLayout";
import { kufiCellSize, kufiPanelInputs } from "../lib/kufi/kufiPanelBlock";
import { KufiPanelEditOverlay } from "./KufiPanelEditOverlay";

type Ok = Extract<KufiPackResult, { ok: true }>;

export type KufiPanelViewProps = ReturnType<typeof kufiPanelProps> & {
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
  /**
   * A canvas edit (a form swap, a stretch) to commit: the edits to save,
   * the packed panel they draw, and the key of the inputs they were made
   * against. Mounts the edit overlay on the selected panel; a mirror passes
   * none and gets no overlay.
   */
  onEditPanel?: (fromKey: string, edits: KufiPanelEdits, result: Ok) => void;
  /** Why a canvas edit changed nothing, for the Kufi panel's status line; dropped if the inputs have moved on from `fromKey`. */
  onPanelNotice?: (fromKey: string, text: string) => void;
  /** A still click on a letter (its unit index) or on paper (null): the sidebar lists that letter's options. */
  onSelectLetter?: (unitIndex: number | null) => void;
};

const noNotice = () => {};

/**
 * Draws a square-Kufi panel: the packed lattice as **one** outline.
 *
 * `cellRings` traces the boundary of the whole union of inked cells, never
 * cell by cell (which would stroke every seam and export thousands of
 * squares). Outer rings run clockwise in y-down and holes counter-clockwise,
 * so a plain nonzero fill empties the counters, and the SVG export is a
 * single `<path>` a laser cutter can follow.
 *
 * Points are scaled to px here rather than under `ctx.scale` (the SVG
 * exporter loses a path drawn under a scale), outline before fill as in every
 * renderer, gradients through `createBlockFillPainter` over the whole panel.
 * A panel that does not pack (`ok: false`), or whose first draft has not
 * arrived from the worker yet, draws no ink; its hit area keeps the block
 * grabbable at its box size.
 *
 * While a stroke is being dragged the selected panel draws the overlay's
 * live preview instead of its committed layout (`KufiPanelEditOverlay`);
 * the preview is cleared on release, when the commit is already in the
 * layout cache, so the drawn panel never falls back to the old one between.
 */
export const KufiPanelView: React.FC<KufiPanelViewProps> = (p) => {
  const result = useKufiPanelLayout(p);
  const cell = kufiCellSize(p.fontSize);
  const [preview, setPreview] = useState<Ok | null>(null);
  const shown = preview ?? result;
  const inputs = useMemo(
    () => kufiPanelInputs(p),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the four layout fields, not the props object
    [p.text, p.panelCols, p.panelRows, p.panelEdits]
  );

  const rings = useMemo(() => {
    if (!shown?.ok) return [];
    return cellRings(Array.from(shown.cells, (v) => v !== 0), shown.cols, shown.rows);
  }, [shown]);

  const cols = shown?.ok ? shown.cols : p.panelCols;
  const rows = shown?.ok ? shown.rows : p.panelRows;
  const width = Math.max(cols, 1) * cell;
  const height = Math.max(rows, 1) * cell;

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
      {/* One node, so the SVG export holds the panel's outline and nothing
          else (a separate transparent hit Rect would export as a second
          path, which a laser cutter reads as a cut). Its width and height
          give it bounds (a sceneFunc-only Shape measures 0×0), and the hit
          area is the whole box, so a panel with no ink is still grabbable. */}
      <Shape
        width={width}
        height={height}
        // Only the hit canvas reads this (the sceneFunc paints its own
        // fill): Konva's hit pass fills a shape only when it has one.
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
            ring.forEach(([cx, cy], i) => {
              if (i === 0) c2d.moveTo(cx * cell, cy * cell);
              else c2d.lineTo(cx * cell, cy * cell);
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
      {p.isSelected && p.onEditPanel && result?.ok && (
        <KufiPanelEditOverlay
          result={shown?.ok ? shown : result}
          committed={result}
          inputs={inputs}
          cell={cell}
          color={p.color}
          onPreview={setPreview}
          onCommit={p.onEditPanel}
          onNotice={p.onPanelNotice ?? noNotice}
          onSelectLetter={p.onSelectLetter}
        />
      )}
    </Group>
  );
};
