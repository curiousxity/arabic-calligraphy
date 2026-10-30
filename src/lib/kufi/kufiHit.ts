/**
 * Hit-testing a packed Kufi panel: which letter a cell belongs to, and where
 * a stroke that a stretch point lengthens ends. The canvas overlay is
 * pointer-resolved (one listening node), so all of this is arithmetic on the
 * `KufiPackResult`, never a Konva node per letter. Pure: no React, no Konva,
 * no `./harfbuzz`.
 */
import { KUFI_FORMS, stretchGlyph, type KufiGlyph } from "./kufiAlphabet";
import { cellRings, rotateRows, type Ring } from "./kufiGrid";
import type { KufiPackResult, KufiPlacement } from "./kufiPack";

type Ok = Extract<KufiPackResult, { ok: true }>;

/** One end of a stroke a stretch point lengthens: the end cell, and the outward step in panel cells. */
export type KufiStretchEnd = {
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
 * Where the strokes that `stretch[i]` lengthens end, for one unit.
 *
 * The slice's whole run is marked (`@` for its ink) before stretching, so
 * the marks ride along to the drawn glyph whatever the counts, then the
 * stroke is followed along the stretch axis from each mark to its last ink
 * cell. That cell is an end when the cell beyond it is paper (or off the
 * panel): an end that runs straight into ink is a join stub or touches a
 * dot, and dragging it would read as dragging the neighbour. A stroke end
 * that meets a bar (the top of a hooked alef) still counts: pulling it moves
 * the bar with it, which is what the user means.
 */
export function stretchEnds(result: Ok, unitIndex: number): KufiStretchEnd[] {
  let perUnit = endsCache.get(result);
  if (!perUnit) endsCache.set(result, (perUnit = new Map()));
  const hit = perUnit.get(unitIndex);
  if (hit) return hit;
  const p = result.placements[unitIndex];
  const g = p ? kufiGlyphById(p.glyphId) : null;
  const out: KufiStretchEnd[] = [];
  if (p && g) {
    const { cols, rows, cells } = result;
    const ink = (r: number, c: number, grid: string[]) => grid[r]?.[c] === "#" || grid[r]?.[c] === "@";
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
      grid.forEach((line, i) => {
        for (let j = 0; j < line.length; j++) {
          if (line[j] !== "@") continue;
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
            if (seen.has(key) || row < 0 || col < 0 || row >= rows || col >= cols) continue;
            seen.add(key);
            const br = row + di;
            const bc = col + dj;
            const beyondInk = br >= 0 && bc >= 0 && br < rows && bc < cols && cells[br * cols + bc] !== 0;
            if (beyondInk) continue;
            out.push({ unitIndex, stretchIndex: si, col, row, dc: dj as -1 | 0 | 1, dr: di as -1 | 0 | 1 });
          }
        }
      });
    });
  }
  perUnit.set(unitIndex, out);
  return out;
}

/**
 * The stretch end whose handle covers the cell: the end cell itself or the
 * paper cell just beyond it. Checked before `hitKufiUnit`, so a press on an
 * end is a stretch and never a click on the letter.
 */
export function hitStretchEnd(result: Ok, col: number, row: number): KufiStretchEnd | null {
  for (let k = 0; k < result.placements.length; k++) {
    for (const e of stretchEnds(result, k)) {
      if (e.col === col && e.row === row) return e;
      if (e.col + e.dc === col && e.row + e.dr === row) return e;
    }
  }
  return null;
}

/** The outline of one unit's ink, as closed rings in cell coordinates (`cellRings`). */
export function unitRings(result: Ok, unitIndex: number): Ring[] {
  const p = result.placements[unitIndex];
  if (!p) return [];
  const mask = new Array<boolean>(result.cols * result.rows).fill(false);
  for (const i of placementInk(result, p)) mask[i] = true;
  return cellRings(mask, result.cols, result.rows);
}
