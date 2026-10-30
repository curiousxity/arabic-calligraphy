/**
 * Painting single cells of a packed Kufi panel, the last-resort tool: a cell
 * is turned on or off as a `KufiCellEdit`, an offset from the nearest
 * letter's placed box (`applyCellEdits` in the packer reads it back the same
 * way), and the drawn panel is updated here, in arithmetic, so a click or a
 * drag never waits on the worker. The result a paint gives is what the
 * packer gives for the same inputs: the cells with the edits applied over
 * the packed lattice, and `editsBreakPacking` by the packer's rule (a 2×2 of
 * paper or of ink, or a double break in the frame). Pure: no React, no
 * Konva, no `./harfbuzz`.
 */
import { emptyBlocks2x2, inkBlocks2x2 } from "./kufiGrid";
import { kufiGlyphById, placementOf } from "./kufiHit";
import { stretchGlyph } from "./kufiAlphabet";
import type { KufiCellEdit, KufiPackResult, KufiPanelEdits, KufiPlacement } from "./kufiPack";

type Ok = Extract<KufiPackResult, { ok: true }>;

export type KufiPaint = { kind: "ok"; edits: KufiPanelEdits; result: Ok } | { kind: "same" } | { kind: "refused" };

/** The placed box's rows and columns (the glyph stretched, then turned). */
function boxSize(p: KufiPlacement): { h: number; w: number } {
  const g = kufiGlyphById(p.glyphId);
  if (!g) return { h: 0, w: 0 };
  const rows = stretchGlyph(g, p.stretch);
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  return p.turn % 2 === 0 ? { h, w } : { h: w, w: h };
}

/**
 * The unit whose placed box is nearest the cell (Chebyshev distance to the
 * box, 0 on it); ties go to the lower unit index. Null with no letters.
 */
export function nearestKufiUnit(result: Ok, col: number, row: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const p of result.placements) {
    const { h, w } = boxSize(p);
    const dc = col < p.col ? p.col - col : col >= p.col + w ? col - (p.col + w - 1) : 0;
    const dr = row < p.row ? p.row - row : row >= p.row + h ? row - (p.row + h - 1) : 0;
    const d = Math.max(dc, dr);
    if (d < bestD || (d === bestD && best !== null && p.unitIndex < best)) {
      best = p.unitIndex;
      bestD = d;
    }
  }
  return best;
}

/** The panel cell an edit lands on, or null when its unit is gone or another letter now. */
function cellOf(result: Ok, e: KufiCellEdit): { col: number; row: number } | null {
  const p = placementOf(result, e.unitIndex);
  if (!p || p.key !== e.key) return null;
  return { col: p.col + e.dx, row: p.row + e.dy };
}

/** The index in `edits.cells` of the edit on this cell, or -1. */
export function cellEditAt(result: Ok, edits: KufiPanelEdits | undefined, col: number, row: number): number {
  const list = edits?.cells ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = cellOf(result, list[i]);
    if (c && c.col === col && c.row === row) return i;
  }
  return -1;
}

/** The packer's rule for `editsBreakPacking`: no 2×2 of paper or of ink, and no double break in the frame. */
function packedCells(cells: Uint8Array, cols: number, rows: number): boolean {
  const grid = { cols, rows, cells };
  if (inkBlocks2x2(grid).length || emptyBlocks2x2(grid).length) return false;
  for (let c = 0; c + 1 < cols; c++) {
    if (!cells[c] && !cells[c + 1]) return false;
    const b = (rows - 1) * cols + c;
    if (!cells[b] && !cells[b + 1]) return false;
  }
  for (let r = 0; r + 1 < rows; r++) {
    if (!cells[r * cols] && !cells[(r + 1) * cols]) return false;
    if (!cells[r * cols + cols - 1] && !cells[(r + 1) * cols + cols - 1]) return false;
  }
  return true;
}

/** True when inking the cell would complete a 2×2 of ink. */
function makesInk2x2(result: Ok, col: number, row: number): boolean {
  const ink = (c: number, r: number) => c >= 0 && r >= 0 && c < result.cols && r < result.rows && result.cells[r * result.cols + c] === 1;
  for (const dc of [-1, 1]) for (const dr of [-1, 1]) if (ink(col + dc, row) && ink(col, row + dr) && ink(col + dc, row + dr)) return true;
  return false;
}

/**
 * Paints one cell. With `on` undefined the cell toggles; with `on` given it
 * is set, and a cell already in that state is `same` (a drag paints every
 * cell it crosses the way its first cell went). Turning a cell on that would
 * make a 2×2 of ink is `refused`; erasing never is. An edit already on the
 * cell is removed first: a toggle back to the packed state leaves no edit
 * behind, and a set replaces it. The returned result is `result` with the
 * one cell changed and `editsBreakPacking` recomputed; its placements are
 * the same objects.
 */
export function paintKufiCell(result: Ok, edits: KufiPanelEdits | undefined, col: number, row: number, on?: boolean): KufiPaint {
  if (col < 0 || row < 0 || col >= result.cols || row >= result.rows) return { kind: "same" };
  const i = row * result.cols + col;
  const was = result.cells[i] === 1;
  const want = on ?? !was;
  if (want === was) return { kind: "same" };
  if (want && makesInk2x2(result, col, row)) return { kind: "refused" };
  const at = cellEditAt(result, edits, col, row);
  const list = (edits?.cells ?? []).filter((_, k) => k !== at);
  // no edit left on the cell: the packed state is what the toggle asked for
  if (at < 0 || on !== undefined) {
    const unitIndex = nearestKufiUnit(result, col, row);
    const p = unitIndex === null ? null : placementOf(result, unitIndex);
    if (unitIndex === null || !p) return { kind: "refused" };
    list.push({ unitIndex, key: p.key, dx: col - p.col, dy: row - p.row, on: want });
  }
  const cells = result.cells.slice();
  cells[i] = want ? 1 : 0;
  const out: KufiPanelEdits = { ...edits };
  if (list.length) out.cells = list;
  else delete out.cells;
  return {
    kind: "ok",
    edits: out,
    result: { ...result, cells, editsBreakPacking: list.length > 0 && !packedCells(cells, result.cols, result.rows) },
  };
}
