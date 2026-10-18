/**
 * How well a tarkib fills its shape: the measure the composer optimises in
 * place of the calligrapher's eye (the user: "the least unfilled space").
 * Mostly the share of the shape left empty, plus penalties for ink outside
 * it, letters overlapping, reading order broken, strokes stretched past
 * their limit, and tiers of uneven height. Lower is better. Pure; library
 * units. See .claude/rules/tarkib.md.
 *
 * Measured on a grid of SCORE_CELL pens, each row filled by scanline (as
 * frameWindow does): a cell is ink when its centre is inside a piece's
 * outline (even-odd within the piece, so a counter is empty; union across
 * pieces). Joins are left out: they are short bridges inside the margin.
 */
import type { StackJoin, StackPiece } from "../types";
import { transformCmds } from "./stackGeometry";
import { pieceTransform } from "./stackOutline";
import { flattenContours, type Pt } from "./strokeCuts";

const PEN = 48;
export type TarkibScore = { total: number; unfilled: number; outside: number; overlap: number; order: number; overStretch: number; uneven: number };
/** Tunables: each term's weight in `total`. */
export const SCORE_WEIGHTS = { unfilled: 1, outside: 20, overlap: 6, order: 50, overStretch: 10, uneven: 0.5 } as const;
/** Pens: shape area within this of ink counts as filled. */
export const FILL_MARGIN = 0.5;
/** Pens: the grid cell. */
export const SCORE_CELL = 0.25;

export type ScoreInput = {
  pieces: readonly StackPiece[];
  joins: readonly StackJoin[];
  nib: { width: number; minFraction: number };
  /** The shape, units, the pieces' frame. */
  shape: readonly Pt[];
  /** Letter piece ids in reading order. */
  readingOrder: string[];
  /** Per stretched piece: units added and the zone's maximum. */
  stretchUsed: Record<string, { used: number; max: number }>;
  /** Letter ids per tier, bottom first, for the evenness term; absent = 0. */
  tiers?: string[][];
};

/** Interval runs [x0, x1) where `polys` (even-odd) cover the horizontal line y. */
function spans(polys: readonly Pt[][], y: number): number[] {
  const xs: number[] = [];
  for (const c of polys) for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
    const [xi, yi] = c[i], [xj, yj] = c[j];
    if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
  }
  return xs.sort((a, b) => a - b);
}

export function scoreLayout(input: ScoreInput): TarkibScore {
  const cell = SCORE_CELL * PEN;
  const byId = new Map(input.pieces.map((p) => [p.id, p]));
  const groupOf = (p: StackPiece): string => {
    let q = p;
    for (let n = 0; q.parentId && byId.has(q.parentId) && n < 8; n++) q = byId.get(q.parentId)!;
    return q.id;
  };
  const placed = input.pieces.map((p) => {
    const polys = flattenContours(transformCmds(p.cmds, pieceTransform(p))) as Pt[][];
    let top = Infinity, bottom = -Infinity;
    for (const c of polys) for (const [, y] of c) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    return { group: groupOf(p), polys, top, bottom };
  });

  // grid over the shape and all ink
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of [input.shape, ...placed.flatMap((p) => p.polys)]) for (const [x, y] of pts) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  const inShape = new Uint8Array(cols * rows), ink = new Uint8Array(cols * rows), multi = new Uint8Array(cols * rows);
  const firstGroup: (string | undefined)[] = new Array(cols * rows);
  const fill = (xs: number[], row: number, mark: (i: number) => void) => {
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), c1 = Math.min(cols - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let c = c0; c <= c1; c++) mark(row * cols + c);
    }
  };
  for (let r = 0; r < rows; r++) {
    const y = y0 + (r + 0.5) * cell;
    fill(spans([input.shape as Pt[]], y), r, (i) => { inShape[i] = 1; });
    for (const p of placed) if (y >= p.top && y <= p.bottom) fill(spans(p.polys, y), r, (i) => {
      ink[i] = 1;
      if (firstGroup[i] === undefined) firstGroup[i] = p.group; else if (firstGroup[i] !== p.group) multi[i] = 1;
    });
  }

  // chamfer distance from ink, in cells x3 (3 straight, 4 diagonal)
  const BIG = 1 << 20, dist = new Int32Array(cols * rows);
  for (let i = 0; i < dist.length; i++) dist[i] = ink[i] ? 0 : BIG;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; let d = dist[i];
    if (c > 0) d = Math.min(d, dist[i - 1] + 3);
    if (r > 0) { d = Math.min(d, dist[i - cols] + 3); if (c > 0) d = Math.min(d, dist[i - cols - 1] + 4); if (c < cols - 1) d = Math.min(d, dist[i - cols + 1] + 4); }
    dist[i] = d;
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c; let d = dist[i];
    if (c < cols - 1) d = Math.min(d, dist[i + 1] + 3);
    if (r < rows - 1) { d = Math.min(d, dist[i + cols] + 3); if (c < cols - 1) d = Math.min(d, dist[i + cols + 1] + 4); if (c > 0) d = Math.min(d, dist[i + cols - 1] + 4); }
    dist[i] = d;
  }
  const margin = 3 * (FILL_MARGIN * PEN) / cell;
  let shapeCells = 0, empty = 0, inkCells = 0, out = 0, over = 0;
  for (let i = 0; i < ink.length; i++) {
    if (inShape[i]) { shapeCells++; if (dist[i] > margin) empty++; }
    if (ink[i]) { inkCells++; if (!inShape[i]) out++; if (multi[i]) over++; }
  }

  // reading order on each letter group's ink box
  const boxes = new Map<string, { x0: number; x1: number; top: number; bottom: number }>();
  for (const p of placed) for (const pts of p.polys) for (const [x, y] of pts) {
    const b = boxes.get(p.group);
    if (!b) boxes.set(p.group, { x0: x, x1: x, top: y, bottom: y });
    else { b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.top = Math.min(b.top, y); b.bottom = Math.max(b.bottom, y); }
  }
  // a later letter more than a pen to the right of an earlier one, and not
  // wholly above it (a climbed letter may sit right), reads out of order
  let order = 0;
  const ro = input.readingOrder.filter((id) => boxes.has(id));
  for (let i = 0; i < ro.length; i++) for (let j = i + 1; j < ro.length; j++) {
    const a = boxes.get(ro[i])!, b = boxes.get(ro[j])!;
    if ((b.x0 + b.x1) / 2 > (a.x0 + a.x1) / 2 + PEN && b.bottom > a.top) order++;
  }

  let overStretch = 0;
  for (const s of Object.values(input.stretchUsed)) overStretch += Math.max(0, s.used - s.max) / PEN;

  let uneven = 0;
  if (input.tiers && input.tiers.length > 1) {
    const hs = input.tiers.map((ids) => {
      let t = Infinity, u = -Infinity;
      for (const p of placed) if (ids.includes(p.group)) for (const pts of p.polys) for (const [, y] of pts) { t = Math.min(t, y); u = Math.max(u, y); }
      return Number.isFinite(t) ? u - t : 0;
    });
    const mean = hs.reduce((s, h) => s + h, 0) / hs.length;
    uneven = mean > 0 ? Math.sqrt(hs.reduce((s, h) => s + (h - mean) ** 2, 0) / hs.length) / mean : 0;
  }

  const unfilled = shapeCells ? empty / shapeCells : 1;
  const outside = inkCells ? out / inkCells : 0, overlap = inkCells ? over / inkCells : 0;
  const w = SCORE_WEIGHTS;
  return {
    total: w.unfilled * unfilled + w.outside * outside + w.overlap * overlap + w.order * order + w.overStretch * overStretch + w.uneven * uneven,
    unfilled, outside, overlap, order, overStretch, uneven,
  };
}

