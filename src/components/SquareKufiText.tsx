import React, { useMemo } from "react";
import { Group, Shape, Rect } from "react-konva";
import type Konva from "konva";
import {
  layoutSquareKufi,
  cellRings,
  kufiCellSize,
  kufiOptionsFor,
  applyCellEdits,
  type KufiCellEdit,
  type KufiComposition,
} from "../lib/squareKufi";
import { createBlockFillPainter, type BlockFill } from "../lib/blockFill";

export type SquareKufiTextProps = {
  id?: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  /** Gradient ink. Absent renders the flat `color`, exactly as every other block. */
  fill?: BlockFill;
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  rotation?: number;

  kufiColumns?: number;
  /** Plain stacked lines, or boustrophedon. Absent is `"lines"`. */
  kufiComposition?: KufiComposition;
  kufiLineGap?: number;
  kufiWordGap?: number;
  /** Cells painted or erased by hand. Absent draws the generated grid exactly. */
  kufiCellEdits?: KufiCellEdit[];

  locked?: boolean;
  draggable?: boolean;
  onClick?: () => void;
  onTap?: () => void;
  onDblClick?: () => void;
  onDragMove?: (e: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (e: Konva.KonvaEventObject<DragEvent>) => void;
};

/**
 * Renders a square-kufi block: Arabic text set as strokes on a lattice.
 *
 * The shortest renderer in the app, and for a structural reason — there is no
 * font here. `lib/squareKufi.ts` answers with a grid of filled cells and the
 * closed rings around them, so this component only scales cell coordinates by
 * the cell size and traces them. No shaping, no `useShapedGlyphs`, no outline
 * fetch, and so none of the per-glyph loops the other four renderers are built
 * around.
 *
 * **The outline is traced once around the whole composition, not per cell.**
 * Stroking cell by cell would draw every internal seam and turn the block into
 * a visible grid; `cellRings` hands back the boundary of the union instead, so
 * `strokeWidth` reads as an outline around the letterforms the way it does
 * everywhere else. Holes come back wound against their outer ring, which is
 * what lets the fill below be an ordinary nonzero `fill()` with no even-odd
 * flag to push through Konva's context wrapper.
 *
 * Outline before fill, as in every other renderer here — see CLAUDE.md for
 * why reversing the two thickens every stroke by half the outline's width.
 */
/** Stable empty list, so an unedited block's memos never see a new array. */
const NO_CELL_EDITS: KufiCellEdit[] = [];

export const SquareKufiText: React.FC<SquareKufiTextProps> = ({
  id,
  text,
  x,
  y,
  fontSize,
  color,
  fill,
  opacity = 1,
  stroke = "#000000",
  strokeWidth = 0,
  shadowColor = "#000000",
  shadowBlur = 0,
  shadowOffsetX = 0,
  shadowOffsetY = 0,
  shadowOpacity = 0.35,
  rotation = 0,
  kufiColumns,
  kufiComposition,
  kufiLineGap,
  kufiWordGap,
  kufiCellEdits,
  locked,
  draggable = true,
  onClick,
  onTap,
  onDblClick,
  onDragMove,
  onDragEnd,
}) => {
  const edits = kufiCellEdits ?? NO_CELL_EDITS;

  const options = useMemo(
    () => kufiOptionsFor({ kufiColumns, kufiComposition, kufiLineGap, kufiWordGap }),
    [kufiColumns, kufiComposition, kufiLineGap, kufiWordGap]
  );

  // Placements are asked for only when there is a hand edit to resolve — see
  // `layoutSquareKufi`'s third argument for why they are not free.
  const layout = useMemo(
    () => layoutSquareKufi(text, options, { placements: edits.length > 0 }),
    [text, options, edits.length]
  );
  const composed = useMemo(() => applyCellEdits(layout, edits), [layout, edits]);
  const rings = useMemo(
    () => cellRings(composed.cells, composed.cols, composed.rows),
    [composed]
  );

  const cell = kufiCellSize(fontSize);
  const width = composed.cols * cell;
  const height = composed.rows * cell;
  // A painted cell can sit left of or above the generated grid, so the whole
  // composition starts at a negative origin. Both nodes carry that offset (see
  // `ComposedKufiGrid`) and everything below draws at plain `cx * cell` in the
  // shifted frame, which keeps the block's self-rect around its real ink.
  const originPx = { x: composed.originX * cell, y: composed.originY * cell };

  // An empty block still needs somewhere to grab it, or clearing the text
  // strands the block on the canvas with no way to select it again.
  const hitWidth = Math.max(width, cell * 4);
  const hitHeight = Math.max(height, cell * 4);

  return (
    <Group
      id={id}
      x={x}
      y={y}
      rotation={rotation}
      draggable={draggable && !locked}
      onClick={onClick}
      onTap={onTap}
      onDblClick={onDblClick}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      opacity={opacity}
    >
      <Rect
        x={originPx.x}
        y={originPx.y}
        width={hitWidth}
        height={hitHeight}
        fill="transparent"
        strokeEnabled={false}
        listening
      />

      <Shape
        x={originPx.x}
        y={originPx.y}
        width={hitWidth}
        height={hitHeight}
        listening={false}
        shadowColor={shadowBlur > 0 ? shadowColor : undefined}
        shadowBlur={shadowBlur}
        shadowOffsetX={shadowOffsetX}
        shadowOffsetY={shadowOffsetY}
        shadowOpacity={shadowOpacity}
        sceneFunc={(ctx) => {
          if (rings.length === 0) return;
          const c2d = ctx as unknown as CanvasRenderingContext2D;

          // Nothing below this is drawn under a transform of its own, so the
          // painter's block-space dance is a no-op here — it is still the one
          // way a gradient gets built, and building it over the whole grid is
          // what makes a single sweep span the composition.
          const painter = createBlockFillPainter(c2d, fill, color, {
            x: 0,
            y: 0,
            width,
            height,
          });

          c2d.beginPath();
          for (const ring of rings) {
            ring.forEach(([cx, cy], i) => {
              const px = cx * cell;
              const py = cy * cell;
              if (i === 0) c2d.moveTo(px, py);
              else c2d.lineTo(px, py);
            });
            c2d.closePath();
          }

          c2d.fillStyle = painter.style;
          if (strokeWidth > 0) {
            c2d.strokeStyle = stroke;
            c2d.lineWidth = strokeWidth;
            c2d.stroke();
          }
          painter.fill(c2d);
        }}
      />
    </Group>
  );
};

export default SquareKufiText;
