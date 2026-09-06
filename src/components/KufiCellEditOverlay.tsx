import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Group, Rect, Shape } from "react-konva";
import type Konva from "konva";
import {
  layoutSquareKufi,
  applyCellEdits,
  cellEditAt,
  kufiCellSize,
  kufiOptionsFor,
  type KufiCellEdit,
} from "../lib/squareKufi";

export type KufiCellEditOverlayProps = {
  id?: string;
  x: number;
  y: number;
  rotation?: number;
  text: string;
  fontSize: number;
  kufiColumns?: number;
  kufiLineGap?: number;
  kufiWordGap?: number;
  kufiCellEdits?: KufiCellEdit[];
  /** Stage zoom, so the lattice draws one device pixel wide at any zoom. */
  stageScale: number;
  /** Called once per stroke, on mousedown — the stroke's single undo entry. */
  onBeginStroke: () => void;
  /**
   * One painted cell. `generatedOn` is what the alphabet draws there on its
   * own, which is what makes "paint a cell that was already ink" a *removal*
   * of the edit rather than a stored no-op. The overlay answers it because it
   * already holds the un-composed layout; App would have to lay the text out
   * again to find it.
   */
  onPaintCell: (edit: KufiCellEdit, generatedOn: boolean) => void;
};

/** Cells of blank lattice drawn beyond the panel, to paint into. */
const FIELD_PADDING = 4;

const LATTICE_COLOR = "rgba(212, 175, 55, 0.35)";
const HOVER_FILL = "rgba(56, 189, 248, 0.45)";

/**
 * The on-canvas cell painter for a square-kufi block — click or drag to paint
 * cells, click ink to erase it. Mounted from `CanvasStage` beside
 * `SquareKufiText` (never from inside it), which is what guarantees a mirror
 * can never grow an editor of its own.
 *
 * **One hit rect, one lattice, one highlight — never a node per cell.** A
 * padded 60×60 panel is thousands of cells, and a listening Konva node each
 * would be thousands of hit-graph entries rebuilt on every repaint. It also
 * sidesteps something structural: the `mouseleave`/`compareShape` race that
 * CLAUDE.md records the three hover-handle overlays fighting cannot occur
 * here, because nothing is hover-*mounted* — there are no sibling handles for
 * the pointer to be retargeted onto. Do not reintroduce per-cell nodes without
 * re-reading that note.
 *
 * **Two frames, and they are not the same one.** The pointer resolves to a
 * cell in the *generated* grid's frame — the one `layoutSquareKufi` returns
 * and placements are expressed in — while the drawn composition may start at a
 * negative origin once an edit has grown it. Both are handled by keeping every
 * coordinate here in the generated frame: group-local pixels are exactly
 * `generated cell × cellSize`, which is the same convention `SquareKufiText`
 * draws under. Mixing the two makes painting drift by the origin the moment
 * one edit falls outside the panel.
 */
export const KufiCellEditOverlay: React.FC<KufiCellEditOverlayProps> = ({
  id,
  x,
  y,
  rotation = 0,
  text,
  fontSize,
  kufiColumns,
  kufiLineGap,
  kufiWordGap,
  kufiCellEdits,
  stageScale,
  onBeginStroke,
  onPaintCell,
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  /** null when not painting; otherwise the state every cell in this stroke gets. */
  const strokeMode = useRef<boolean | null>(null);

  const edits = useMemo(() => kufiCellEdits ?? [], [kufiCellEdits]);
  const options = useMemo(
    () => kufiOptionsFor({ kufiColumns, kufiLineGap, kufiWordGap }),
    [kufiColumns, kufiLineGap, kufiWordGap]
  );
  const layout = useMemo(
    () => layoutSquareKufi(text, options, { placements: true }),
    [text, options]
  );
  const composed = useMemo(() => applyCellEdits(layout, edits), [layout, edits]);

  const cell = kufiCellSize(fontSize);

  // The paintable field, in generated-frame cells.
  const field = useMemo(() => {
    const x0 = composed.originX - FIELD_PADDING;
    const y0 = composed.originY - FIELD_PADDING;
    return {
      x0,
      y0,
      x1: composed.originX + composed.cols - 1 + FIELD_PADDING,
      y1: composed.originY + composed.rows - 1 + FIELD_PADDING,
    };
  }, [composed]);

  /** What is drawn at a generated-frame cell right now, edits included. */
  const composedAt = useCallback(
    (gx: number, gy: number) => {
      const cx = gx - composed.originX;
      const cy = gy - composed.originY;
      if (cx < 0 || cy < 0 || cx >= composed.cols || cy >= composed.rows) return false;
      return composed.cells[cy * composed.cols + cx];
    },
    [composed]
  );

  /** What the alphabet itself draws there, before any hand edit. */
  const generatedAt = useCallback(
    (gx: number, gy: number) => {
      if (gx < 0 || gy < 0 || gx >= layout.cols || gy >= layout.rows) return false;
      return layout.cells[gy * layout.cols + gx];
    },
    [layout]
  );

  const cellUnderPointer = useCallback(() => {
    const group = groupRef.current;
    const pos = group?.getRelativePointerPosition();
    if (!pos) return null;
    return { x: Math.floor(pos.x / cell), y: Math.floor(pos.y / cell) };
  }, [cell]);

  const paint = useCallback(
    (gx: number, gy: number, on: boolean) => {
      const edit = cellEditAt(layout.placements, gx, gy, on);
      // No letter near enough to anchor the cell to — see KUFI_EDIT_REACH.
      if (!edit) return;
      if (composedAt(gx, gy) === on) return;
      onPaintCell(edit, generatedAt(gx, gy));
    },
    [layout.placements, composedAt, generatedAt, onPaintCell]
  );

  // Konva does not capture the pointer, so a fast drag that leaves the hit
  // rect never delivers a mouseup to it and would strand paint mode on.
  useEffect(() => {
    const stage = groupRef.current?.getStage();
    if (!stage) return;
    const end = () => {
      strokeMode.current = null;
    };
    stage.on("mouseup.kufiCellEdit touchend.kufiCellEdit", end);
    return () => {
      stage.off("mouseup.kufiCellEdit touchend.kufiCellEdit", end);
      strokeMode.current = null;
    };
  }, []);

  const handleDown = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    const c = cellUnderPointer();
    if (!c) return;
    // The whole stroke paints one way, decided by the cell it started on —
    // toggling per cell would undo half of a drag that crosses ink.
    const mode = !composedAt(c.x, c.y);
    strokeMode.current = mode;
    onBeginStroke();
    paint(c.x, c.y, mode);
  };

  const handleMove = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    const c = cellUnderPointer();
    if (!c) return;
    setHover((prev) => (prev && prev.x === c.x && prev.y === c.y ? prev : c));
    if (strokeMode.current !== null) paint(c.x, c.y, strokeMode.current);
  };

  const handleUp = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    strokeMode.current = null;
  };

  // Nothing is drawn, so there is no letter to anchor a cell to and nothing
  // useful to paint on. The block keeps its own drag surface in that case.
  if (layout.placements.length === 0) return null;

  const px = (c: number) => c * cell;
  const fieldW = px(field.x1 - field.x0 + 1);
  const fieldH = px(field.y1 - field.y0 + 1);

  return (
    <Group ref={groupRef} id={id} x={x} y={y} rotation={rotation}>
      <Rect
        x={px(field.x0)}
        y={px(field.y0)}
        width={fieldW}
        height={fieldH}
        fill="transparent"
        onMouseDown={handleDown}
        onTouchStart={handleDown}
        onMouseMove={handleMove}
        onTouchMove={handleMove}
        onMouseUp={handleUp}
        onTouchEnd={handleUp}
        onMouseLeave={() => setHover(null)}
      />

      <Shape
        listening={false}
        sceneFunc={(ctx) => {
          const c2d = ctx as unknown as CanvasRenderingContext2D;
          c2d.beginPath();
          for (let gx = field.x0; gx <= field.x1 + 1; gx++) {
            c2d.moveTo(px(gx), px(field.y0));
            c2d.lineTo(px(gx), px(field.y1 + 1));
          }
          for (let gy = field.y0; gy <= field.y1 + 1; gy++) {
            c2d.moveTo(px(field.x0), px(gy));
            c2d.lineTo(px(field.x1 + 1), px(gy));
          }
          // One device pixel at any zoom, the idiom the alignment grid and the
          // snap guides already use — a stroke width is in stage units.
          c2d.strokeStyle = LATTICE_COLOR;
          c2d.lineWidth = 1 / stageScale;
          c2d.stroke();
        }}
      />

      {hover && (
        <Rect
          listening={false}
          x={px(hover.x)}
          y={px(hover.y)}
          width={cell}
          height={cell}
          fill={HOVER_FILL}
        />
      )}
    </Group>
  );
};

export default KufiCellEditOverlay;
