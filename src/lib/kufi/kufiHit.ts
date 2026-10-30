/**
 * Hit-testing a packed Kufi panel: which letter a cell belongs to, and where
 * a stroke that a stretch point lengthens ends. The canvas overlay is
 * pointer-resolved (one listening node), so all of this is arithmetic on the
 * `KufiPackResult`, never a Konva node per letter. Pure: no React, no Konva,
 * no `./harfbuzz`.
 */
import { KUFI_FORMS, stretchGlyph, type KufiGlyph } from "./kufiAlphabet";
import { cellRings, rotateRows, type Ring, type Turn } from "./kufiGrid";
import type { KufiPackResult, KufiPlacement } from "./kufiPack";
import type { KufiUnit } from "./kufiWords";

type Ok = Extract<KufiPackResult, { ok: true }>;

/**
 * A handle for a stretch point: an `end` is the last cell of a stroke the
 * point lengthens, with the outward step in panel cells; a `slice` grip is
 * one cell of the slice's run itself, for a stroke with no free end (a
 * baseline joined on both sides), its step pointing along the slice's axis
 * away from the letter's middle. Dragging along the step grows the stroke.
 */
export type KufiStretchEnd = {
  kind: "end" | "slice";
  unitIndex: number;
  stretchIndex: number;
  col: number;
  row: number;
  dc: -1 | 0 | 1;
  dr: -1 | 0 | 1;
};

const glyphIndex = new Map<string, KufiGlyph>();
for (const forms of Object.values(KUFI_FORMS))
  for (const list of Object.values(forms)) for (const g of list ?? []) glyphIndex.set(g.id, g);

/** The glyph a placement names (`<skeleton>.<form>.<n>`), or null for an id the table does not have. */
export const kufiGlyphById = (id: string): KufiGlyph | null => glyphIndex.get(id) ?? null;

/** The alternates a unit may take: the packer's own rule, re-exported for the canvas. */
export { kufiFormsOf } from "./kufiPack";

/** The placement's glyph as drawn: stretched by its counts, then turned. `#` is ink. */
function placedRows(p: KufiPlacement, rows: string[] = kufiGlyphById(p.glyphId)?.rows ?? []): string[] {
  const g = kufiGlyphById(p.glyphId);
  if (!g) return [];
  return rotateRows(stretchGlyph({ ...g, rows }, p.stretch), p.turn);
}

/** Row-major panel indices of the placement's ink; cells off the panel are dropped. */
export function placementInk(result: Ok, p: KufiPlacement): number[] {
  const out: number[] = [];
  placedRows(p).forEach((line, i) => {
    const r = p.row + i;
    if (r < 0 || r >= result.rows) return;
    for (let j = 0; j < line.length; j++) {
      const c = p.col + j;
      if (line[j] === "#" && c >= 0 && c < result.cols) out.push(r * result.cols + c);
    }
  });
  return out;
}

/**
 * The placement of a unit. The packer lists placements sorted by unit index
 * and every unit placed, so the index is the fast path; a sparse list (a
 * hand-built result, a future packer that leaves a unit out) is searched.
 */
export function placementOf(result: Ok, unitIndex: number): KufiPlacement | null {
  const fast = result.placements[unitIndex];
  if (fast && fast.unitIndex === unitIndex) return fast;
  return result.placements.find((p) => p.unitIndex === unitIndex) ?? null;
}

/** Per result: which unit owns each cell (unit index + 1, 0 for none), built once. */
const owners = new WeakMap<Ok, Int16Array>();
function ownerMap(result: Ok): Int16Array {
  let m = owners.get(result);
  if (m) return m;
  m = new Int16Array(result.cols * result.rows);
  for (const p of result.placements) for (const i of placementInk(result, p)) if (m[i] === 0) m[i] = p.unitIndex + 1;
  owners.set(result, m);
  return m;
}

/** The unit whose letter covers the cell, or null on paper, a dot or a filler square. */
export function hitKufiUnit(result: Ok, col: number, row: number): number | null {
  if (col < 0 || row < 0 || col >= result.cols || row >= result.rows) return null;
  const v = ownerMap(result)[row * result.cols + col];
  return v === 0 ? null : v - 1;
}

/**
 * The slice rows (or columns) of the unstretched glyph that a stretch point
 * repeats: the run of slices identical to the marked one, on its own side of
 * the baseline, the same run `stretchGlyph` shortens from.
 */
function sliceRun(g: KufiGlyph, si: number): number[] {
  const s = g.stretch[si];
  const len = s.axis === "row" ? g.rows.length : (g.rows[0]?.length ?? 0);
  const sliceAt = (i: number) => (s.axis === "row" ? g.rows[i] : g.rows.map((r) => r[i]).join(""));
  const baselineRow = s.axis === "row" ? g.rows.length - 1 - g.base : -1;
  let lo = 0;
  let hi = len - 1;
  if (s.axis === "row") {
    if (s.index < baselineRow) hi = baselineRow;
    else if (s.index > baselineRow) lo = baselineRow;
  }
  const own = sliceAt(s.index);
  let a = s.index;
  let b = s.index;
  while (a - 1 >= lo && sliceAt(a - 1) === own) a--;
  while (b + 1 <= hi && sliceAt(b + 1) === own) b++;
  const out: number[] = [];
  for (let k = a; k <= b; k++) out.push(k);
  return out;
}

const endsCache = new WeakMap<Ok, Map<number, KufiStretchEnd[]>>();

/**
 * The handles of one unit's stretch points: where the strokes `stretch[i]`
 * lengthens end, or, for a point whose strokes have no free end, the cells
 * of its slice.
 *
 * The slice's whole run is marked (`@` for its ink) before stretching, so
 * the marks ride along to the drawn glyph whatever the counts, then the
 * stroke is followed along the stretch axis from each mark to its last ink
 * cell. That cell is an end when the cell beyond it is paper (or off the
 * panel): an end that runs straight into ink is a join stub or touches a
 * dot, and dragging it would read as dragging the neighbour. A stroke end
 * that meets a bar (the top of a hooked alef) still counts: pulling it moves
 * the bar with it, which is what the user means. A point with no end at all
 * (a baseline joined on both sides) gets a grip on each marked cell instead,
 * stepping along the slice's axis away from the glyph's middle, so pulling
 * outward grows the stroke as it does at an end.
 */
export function stretchEnds(result: Ok, unitIndex: number): KufiStretchEnd[] {
  let perUnit = endsCache.get(result);
  if (!perUnit) endsCache.set(result, (perUnit = new Map()));
  const hit = perUnit.get(unitIndex);
  if (hit) return hit;
  const p = placementOf(result, unitIndex);
  const g = p ? kufiGlyphById(p.glyphId) : null;
  const out: KufiStretchEnd[] = [];
  if (p && g) {
    const { cols, rows, cells } = result;
    const ink = (r: number, c: number, grid: string[]) => grid[r]?.[c] === "#" || grid[r]?.[c] === "@";
    const inside = (r: number, c: number) => r >= 0 && c >= 0 && r < rows && c < cols;
    g.stretch.forEach((s, si) => {
      const run = new Set(sliceRun(g, si));
      const marked = g.rows.map((line, y) =>
        s.axis === "row"
          ? run.has(y)
            ? line.replace(/#/g, "@")
            : line
          : [...line].map((ch, x) => (run.has(x) && ch === "#" ? "@" : ch)).join("")
      );
      const grid = placedRows(p, marked);
      // a row slice crosses upright strokes; a quarter turn lays them along the row
      const vertical = (s.axis === "row") === (p.turn % 2 === 0);
      const dirs: Array<[number, number]> = vertical ? [[-1, 0], [1, 0]] : [[0, -1], [0, 1]];
      const seen = new Set<string>();
      const ends: KufiStretchEnd[] = [];
      const marks: Array<[number, number]> = [];
      grid.forEach((line, i) => {
        for (let j = 0; j < line.length; j++) {
          if (line[j] !== "@") continue;
          marks.push([p.row + i, p.col + j]);
          for (const [di, dj] of dirs) {
            let ei = i;
            let ej = j;
            while (ink(ei + di, ej + dj, grid)) {
              ei += di;
              ej += dj;
            }
            const row = p.row + ei;
            const col = p.col + ej;
            const key = `${row},${col}`;
            if (seen.has(key) || !inside(row, col)) continue;
            seen.add(key);
            if (inside(row + di, col + dj) && cells[(row + di) * cols + col + dj] !== 0) continue;
            ends.push({ kind: "end", unitIndex, stretchIndex: si, col, row, dc: dj as -1 | 0 | 1, dr: di as -1 | 0 | 1 });
          }
        }
      });
      if (ends.length > 0) {
        out.push(...ends);
        return;
      }
      // no free end: the slice's own cells, stepping away from the glyph's middle
      const h = grid.length;
      const w = grid[0]?.length ?? 0;
      const midRow = p.row + (h - 1) / 2;
      const midCol = p.col + (w - 1) / 2;
      for (const [row, col] of marks) {
        if (!inside(row, col)) continue;
        const away = vertical ? Math.sign(row - midRow) || 1 : Math.sign(col - midCol) || 1;
        out.push({
          kind: "slice",
          unitIndex,
          stretchIndex: si,
          col,
          row,
          dc: (vertical ? 0 : away) as -1 | 0 | 1,
          dr: (vertical ? away : 0) as -1 | 0 | 1,
        });
      }
    });
  }
  perUnit.set(unitIndex, out);
  return out;
}

/**
 * The handle covering the cell: an end cell or the paper cell just beyond
 * it, or a slice grip's own cell. Checked before `hitKufiUnit`, so a press
 * on a handle is a stretch and never a click on the letter.
 */
export function hitStretchEnd(result: Ok, col: number, row: number): KufiStretchEnd | null {
  for (const p of result.placements) {
    for (const e of stretchEnds(result, p.unitIndex)) {
      if (e.col === col && e.row === row) return e;
      if (e.kind === "end" && e.col + e.dc === col && e.row + e.dr === row) return e;
    }
  }
  return null;
}

/**
 * The handle for moving a word along its path: one cell of the word's first
 * letter, the leading cell (on the edge met first in reading order, on the
 * baseline side), with the line's reading step. Shown on hover like a stretch
 * end; a press on it drags the word, a press anywhere else on the letter is
 * the letter's own (a click, or a drag of the whole panel).
 */
export type KufiRouteHandle = {
  kind: "route";
  unitIndex: number;
  wordIndex: number;
  col: number;
  row: number;
  dc: -1 | 0 | 1;
  dr: -1 | 0 | 1;
};

/** Anything the overlay draws a small square for and starts a drag from. */
export type KufiHandle = KufiStretchEnd | KufiRouteHandle;

/**
 * Where a handle's square is drawn, in cell units: an end's on the edge its
 * stroke grows across, a slice grip's on its cell, a route handle's on the
 * word's leading edge (the side the word reads away from). Two handles may
 * share a cell (a first letter's leading corner is often a stroke's end);
 * they never share a square, so the pointer's place in the cell tells them
 * apart.
 */
export function handleCentre(h: KufiHandle): { x: number; y: number } {
  const shift = h.kind === "end" ? 0.5 : h.kind === "route" ? -0.5 : 0;
  return { x: h.col + 0.5 + h.dc * shift, y: h.row + 0.5 + h.dr * shift };
}

/** The handle whose square is nearest a point in cell units (the earlier of two at one distance), or null from none. */
export function nearestHandleAt<T extends KufiHandle>(handles: T[], x: number, y: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const h of handles) {
    const c = handleCentre(h);
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/** The handle nearest a cell, or null from none. */
export function nearestHandle<T extends { col: number; row: number }>(ends: T[], col: number, row: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const e of ends) {
    const d = Math.hypot(e.col - col, e.row - row);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/**
 * The step a line is read along, by the turn of the letters on it: right to
 * left along the bottom (turn 0), up the left side, left to right along the
 * top, down the right side (the packer's `Line` for each `SIDE_ROT`).
 */
export function kufiReadingStep(turn: Turn): [dc: -1 | 0 | 1, dr: -1 | 0 | 1] {
  switch (turn) {
    case 0:
      return [-1, 0];
    case 1:
      return [0, -1];
    case 2:
      return [1, 0];
    default:
      return [0, 1];
  }
}

/** The index of the unit that opens word `wordIndex`, or null for a word the text does not have. */
export function firstUnitOfWord(units: KufiUnit[], wordIndex: number): number | null {
  const i = units.findIndex((u) => u.wordIndex === wordIndex);
  return i < 0 ? null : i;
}

/**
 * The word whose first letter covers the cell, or null on any other letter,
 * on paper, a dot or a filler. The overlay offers that word's route handle
 * (`routeHandleOf`) among the letter's handles while it is hovered.
 */
export function hitWordStart(result: Ok, units: KufiUnit[], col: number, row: number): number | null {
  const unitIndex = hitKufiUnit(result, col, row);
  if (unitIndex === null) return null;
  const u = units[unitIndex];
  if (!u) return null;
  return firstUnitOfWord(units, u.wordIndex) === unitIndex ? u.wordIndex : null;
}

/**
 * The route handle of a word: on its first letter's leading cell. Of the
 * letter's ink on the leading edge of its box (the edge met first in reading
 * order, as `routeOffsetFor` measures from), the cell nearest the line's
 * outer edge, where the baseline runs: the bottom row for the bottom line,
 * the left column for the left side, and so on by the turn. Null for a word
 * the text does not have or whose first letter is not placed.
 */
export function routeHandleOf(result: Ok, units: KufiUnit[], wordIndex: number): KufiRouteHandle | null {
  const unitIndex = firstUnitOfWord(units, wordIndex);
  const p = unitIndex === null ? null : placementOf(result, unitIndex);
  if (unitIndex === null || !p) return null;
  const [dc, dr] = kufiReadingStep(p.turn);
  const { h, w } = placedBox(p);
  const leadCol = dc < 0 ? p.col + w - 1 : p.col;
  const leadRow = dr < 0 ? p.row + h - 1 : p.row;
  // the outer edge of the line: toward which the baseline lies, by turn
  const outer = (col: number, row: number) => (p.turn === 0 ? row : p.turn === 1 ? -col : p.turn === 2 ? -row : col);
  let best: { col: number; row: number } | null = null;
  for (const i of placementInk(result, p)) {
    const col = i % result.cols;
    const row = Math.floor(i / result.cols);
    if (dc !== 0 ? col !== leadCol : row !== leadRow) continue;
    if (!best || outer(col, row) > outer(best.col, best.row)) best = { col, row };
  }
  if (!best) return null;
  return { kind: "route", unitIndex, wordIndex, col: best.col, row: best.row, dc, dr };
}

/**
 * The route handle covering the cell: the handle's own cell, or the cell
 * just beyond it against the reading direction (where the square is drawn,
 * half over the edge) when no letter owns that cell. Null elsewhere, so the
 * rest of a first letter stays the letter's own.
 */
export function hitRouteHandle(result: Ok, units: KufiUnit[], col: number, row: number): KufiRouteHandle | null {
  const own = hitWordStart(result, units, col, row);
  if (own !== null) {
    const h = routeHandleOf(result, units, own);
    return h && h.col === col && h.row === row ? h : null;
  }
  if (hitKufiUnit(result, col, row) !== null) return null;
  // paper: the cell beyond a handle is reached by stepping along the reading direction
  for (const [dc, dr] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
    const w = hitWordStart(result, units, col + dc, row + dr);
    if (w === null) continue;
    const h = routeHandleOf(result, units, w);
    if (h && h.col === col + dc && h.row === row + dr && h.dc === dc && h.dr === dr) return h;
  }
  return null;
}

/** The placed box's extent: the rows and columns it covers on the panel, after stretching and turning. */
export function placedBox(p: KufiPlacement): { h: number; w: number } {
  const rows = placedRows(p);
  return { h: rows.length, w: rows[0]?.length ?? 0 };
}

/**
 * How far along the word's path the cell is, in cells, from the leading edge
 * of its first letter's box (the edge met first in reading order); further
 * on in reading order is positive. The pointer is projected onto the path,
 * so its distance across the line does not count. A drag's route is the
 * difference between this at the pointer and at the press. 0 for a word the
 * text does not have.
 */
export function routeOffsetFor(result: Ok, units: KufiUnit[], wordIndex: number, col: number, row: number): number {
  const first = firstUnitOfWord(units, wordIndex);
  const p = first === null ? null : placementOf(result, first);
  if (!p) return 0;
  const [dc, dr] = kufiReadingStep(p.turn);
  const { h, w } = placedBox(p);
  // the leading edge: the box's far side when reading runs toward smaller indices
  const leadCol = dc < 0 ? p.col + w - 1 : p.col;
  const leadRow = dr < 0 ? p.row + h - 1 : p.row;
  return (col - leadCol) * dc + (row - leadRow) * dr;
}

/** The outline of one unit's ink, as closed rings in cell coordinates (`cellRings`). */
export function unitRings(result: Ok, unitIndex: number): Ring[] {
  const p = placementOf(result, unitIndex);
  if (!p) return [];
  const mask = new Array<boolean>(result.cols * result.rows).fill(false);
  for (const i of placementInk(result, p)) mask[i] = true;
  return cellRings(mask, result.cols, result.rows);
}
