/**
 * Painting single cells of a packed Kufi panel, the last-resort tool: a cell
 * is turned on or off as a `KufiCellEdit`, an offset from the nearest
 * letter's placed box, and the drawn panel is updated here, in arithmetic,
 * so a click or a drag never waits on the worker. The result a paint gives
 * is what the packer gives for the same inputs: the packed lattice with the
 * edits painted over it (`applyCellEdits`) and `editsBreakPacking` by the
 * packer's own measure (`packedCells`), both shared through `kufiGrid`.
 * Pure: no React, no Konva, no `./harfbuzz`.
 */
import { applyCellEdits, packedCells } from "./kufiGrid";
import { placedBox, placementInk, placementOf } from "./kufiHit";
import type { KufiCellEdit, KufiPackResult, KufiPanelEdits } from "./kufiPack";

type Ok = Extract<KufiPackResult, { ok: true }>;

export type KufiPaint = { kind: "ok"; edits: KufiPanelEdits; result: Ok } | { kind: "same" } | { kind: "refused" };

type Cell = { col: number; row: number };

/**
 * The cells a drag crossed between two pointer samples, from `from`
 * (excluded) to `to` (included), as a 4-connected line: a Bresenham walk
 * whose diagonal steps are taken as two edge steps, so every cell the line
 * passes through is listed in order, and painting them one by one gives each
 * the 2×2 check it would have had under a slower hand. Empty when the two
 * are the same cell.
 */
export function cellsBetween(from: Cell, to: Cell): Cell[] {
  const out: Cell[] = [];
  const dx = Math.abs(to.col - from.col);
  const dy = Math.abs(to.row - from.row);
  const sx = to.col > from.col ? 1 : -1;
  const sy = to.row > from.row ? 1 : -1;
  let col = from.col;
  let row = from.row;
  let err = dx - dy;
  while (col !== to.col || row !== to.row) {
    const e2 = 2 * err;
    // Bresenham's two tests on the same error term; when both pass (a
    // diagonal step) the two edge steps are taken one after the other
    const stepCol = col !== to.col && (e2 > -dy || row === to.row);
    const stepRow = row !== to.row && (e2 < dx || col === to.col);
    if (stepCol) {
      err -= dy;
      col += sx;
      out.push({ col, row });
    }
    if (stepRow) {
      err += dx;
      row += sy;
      out.push({ col, row });
    }
  }
  return out;
}

/**
 * The unit whose placed box is nearest the cell (Chebyshev distance to the
 * box, 0 on it); ties go to the lower unit index. Null with no letters.
 */
export function nearestKufiUnit(result: Ok, col: number, row: number): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const p of result.placements) {
    const { h, w } = placedBox(p);
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

/** The index in `edits.cells` of the last edit on this cell, or -1. */
export function cellEditAt(result: Ok, edits: KufiPanelEdits | undefined, col: number, row: number): number {
  const list = edits?.cells ?? [];
  for (let i = list.length - 1; i >= 0; i--) {
    const c = cellOf(result, list[i]);
    if (c && c.col === col && c.row === row) return i;
  }
  return -1;
}

/**
 * The cell's state under `list`: the letters' own ink (what the packer owns
 * there, short of a dot or a filler square, which no placement names), with
 * the last edit on the cell painted over it. Letting `applyCellEdits` do the
 * painting keeps this the packer's order.
 */
function stateUnder(result: Ok, list: KufiCellEdit[], col: number, row: number): boolean {
  const i = row * result.cols + col;
  const cells = new Uint8Array(result.cols * result.rows);
  for (const p of result.placements) for (const k of placementInk(result, p)) cells[k] = 1;
  applyCellEdits(cells, result.cols, result.rows, (k) => placementOf(result, k), { cells: list });
  return cells[i] === 1;
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
 * cell is removed first, and a new one added only if the cell would not then
 * show the wanted state by itself: a toggle back to the packed state leaves
 * no edit behind, a toggle over a letter that has since moved onto a painted
 * cell leaves an erase, and a set replaces. The returned result is `result`
 * with the one cell changed and `editsBreakPacking` recomputed; its
 * placements are the same objects. A panel with no letters is `same`: there
 * is nothing to hang an edit on.
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
  // A cell with no edit shows the packed state, so the change needs one. A
  // cell whose edit was just removed needs one only if what it shows without
  // it is not the wanted state. (A dot or a filler square is ink no placement
  // names, so under a removed edit it reads as paper: a toggle to paper over
  // a dot that moved under a painted cell is the one case this draws wrong.)
  if (at < 0 || stateUnder(result, list, col, row) !== want) {
    const unitIndex = nearestKufiUnit(result, col, row);
    const p = unitIndex === null ? null : placementOf(result, unitIndex);
    if (unitIndex === null || !p) return { kind: "same" };
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
