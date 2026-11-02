/**
 * The "octagon inside a square" layout of the Kufi star panel: the traditional
 * square-Kufi design in which a short phrase runs round the four sides of a
 * square, one copy per side turned by a quarter (never mirrored), and the
 * words' tall strokes (alef, lam) are lengthened inward until their ends
 * draw an octagon at the centre. Nothing is drawn first and filled after:
 * the stroke ends *are* the octagon's outline, and the centre stays open.
 *
 * In cells, for a square of `size` N:
 *
 * - **Four bands**, each `BAND` (5) rows of letters on the outer edge plus
 *   one seam row inside, `DEPTH` (6) deep, arranged as a pinwheel: the
 *   bottom band runs from the left edge to `DEPTH` short of the right edge
 *   (so its line is N - DEPTH long), and the band on the right edge stands
 *   in the corner it leaves, above the bottom band's first letter. Each band
 *   is the bottom band turned clockwise about the centre, so the text reads
 *   as a square-Kufi panel's outer ring does: upright along the bottom,
 *   upward on the left, upside down along the top, downward on the right.
 * - **The interior** (N - 2 DEPTH square) is cut by its diagonals into four
 *   fields, one per band. A tall stroke (an upright reaching the band's top
 *   row, no bar at its top) runs on from the seam row straight inward through
 *   its band's field until the next cell is the open centre or a diagonal
 *   seam cell (the diagonals themselves stay paper, so the ends of two
 *   fields' strokes meet only at corners). Strokes near the middle of a side
 *   end on the octagon; the rest end on the diagonals, a staircase from the
 *   octagon's corner to the square's.
 * - **The open centre** is a stepped octagon `width` cells across (about 0.27
 *   N, the proportion of a 1444 tile-mosaic in a 2004 article on square Kufi
 *   principles), its corners cut so its flat sides are `flat` cells.
 *
 * The lattice grammar (stroke = gap = one cell, no solid 2x2) holds over the
 * whole square; the space above a short letter and between lengthened
 * strokes is the design's open space, not a hole to fill, so no filler
 * squares or bars are ever drawn (`packKufiRegion` with `bars: false`).
 * `lines` on draws each band's base row solid where its letters' feet leave
 * a gap, the frame line and the feet one stroke (a gap stays where filling
 * it would make a solid 2x2). Pure: no React, no Konva, no `./harfbuzz`.
 */
import { packKufiRegion, type KufiMask, type KufiPackResult } from "./kufiPack";

/** Letter height: a band is one 5-row line. */
export const OCTAGON_BAND = 5;
/** A band's depth: its letters and the seam row inside them. */
export const OCTAGON_DEPTH = OCTAGON_BAND + 1;
/** The smallest square: a 7-cell line (one الله) and no interior but the centre cell. */
export const OCTAGON_MIN_SIZE = 2 * OCTAGON_DEPTH + 1;
export const OCTAGON_MAX_SIZE = 60;
/** The open centre's width over the square's. */
const CENTRE_RATIO = 0.33;
/** A regular octagon's side over its width. */
const FLAT_RATIO = Math.SQRT2 - 1;

export type KufiOctagonGeometry = {
  size: number;
  /** A band's line: cells along the outer edge from its corner to the next band. */
  line: number;
  /** The open centre's width in cells (the square's parity, so it is centred). */
  width: number;
  /** The octagon's flat side in cells (the width's parity). */
  flat: number;
};

/** Nearest integer to `v` with the parity of `like`, at least `min`. */
function nearestWithParity(v: number, like: number, min: number): number {
  const lo = Math.floor(v), hi = lo + 1;
  const a = (lo - like) % 2 === 0 ? lo : lo - 1;
  const b = (hi - like) % 2 === 0 ? hi : hi + 1;
  const pick = Math.abs(v - a) <= Math.abs(v - b) ? a : b;
  return Math.max(min, pick);
}

export function octagonGeometry(size: number): KufiOctagonGeometry {
  const interior = size - 2 * OCTAGON_DEPTH;
  // the centre: never wider than leaves every stroke at least one cell, never less than the centre cell
  const width = Math.max(interior % 2 === 0 ? 0 : 1, Math.min(interior - 2, nearestWithParity(CENTRE_RATIO * size, size, 1)));
  const flat = width <= 0 ? 0 : Math.min(width, nearestWithParity(FLAT_RATIO * width, width, 2 - (width % 2)));
  return { size, line: size - OCTAGON_DEPTH, width, flat };
}

/** Doubled centred coordinate of cell index `i` (odd for an even size, even for an odd one). */
const centred = (g: KufiOctagonGeometry, i: number) => 2 * i - (g.size - 1);

/** True when cell (x, y) lies in the open centre: the stepped octagon. */
export function octagonOpen(g: KufiOctagonGeometry, x: number, y: number): boolean {
  if (g.width <= 0) return false;
  const X = Math.abs(centred(g, x)), Y = Math.abs(centred(g, y));
  const half = g.width - 1;
  return X <= half && Y <= half && X + Y <= g.flat + g.width - 2;
}

/** True when cell (x, y) lies on a diagonal of the square: a seam between two fields, paper. */
export function octagonSeam(g: KufiOctagonGeometry, x: number, y: number): boolean {
  return Math.abs(centred(g, x)) === Math.abs(centred(g, y));
}

/** True when cell (x, y) is in the bottom band's field: the interior below both diagonals. */
export function octagonBottomField(g: KufiOctagonGeometry, x: number, y: number): boolean {
  const X = Math.abs(centred(g, x)), Y = centred(g, y);
  return Y > X && y < g.size - OCTAGON_DEPTH + 1 && y >= OCTAGON_DEPTH;
}

/** A quarter turn clockwise about the square's centre, cell to cell. */
export function octagonTurn(size: number, x: number, y: number): [x: number, y: number] {
  return [size - 1 - y, x];
}

/** The mask one band's text is packed into: one line, `BAND` rows deep. */
export function octagonBandMask(size: number): KufiMask {
  const line = Math.max(0, size - OCTAGON_DEPTH);
  return { cols: line, rows: OCTAGON_BAND, cells: new Uint8Array(line * OCTAGON_BAND).fill(1) };
}

export type KufiOctagonLayout = {
  geometry: KufiOctagonGeometry;
  /** Row-major `size * size`, 1 = ink: the four bands and their lengthened strokes. */
  cells: Uint8Array;
  /** The cells the frame lines add (`lines` on): gaps in each band's base row. */
  frame: Uint8Array;
  /** The bottom band's packing (the other three are its turns). */
  band: Extract<KufiPackResult, { ok: true }>;
  /** Tall strokes lengthened per side, and how many of them end on the octagon rather than a diagonal. */
  strokes: { lengthened: number; onOctagon: number };
};

/**
 * The row of the upright that column `c` of a packed band may lengthen
 * inward, or null: its topmost ink must be the top of an upright (two cells
 * or more; a bar beside its top is fine, so the lam the heh of الله hangs
 * off rises above the heh's box as the traditional form does), with paper
 * above it and beside that paper up to the band's top, so the lengthened
 * stroke touches nothing.
 */
function strokeTop(cells: Uint8Array, cols: number, c: number): number | null {
  const ink = (x: number, y: number) => x >= 0 && x < cols && cells[y * cols + x] === 1;
  let r0 = 0;
  while (r0 < OCTAGON_BAND && !ink(c, r0)) r0++;
  if (r0 + 1 >= OCTAGON_BAND || !ink(c, r0 + 1)) return null;
  for (let r = 0; r < r0; r++) if (ink(c - 1, r) || ink(c + 1, r)) return null;
  return r0;
}

/** Packs `text` along one side; null when it does not pack a line of this size (the reason is in `band`). */
export function layoutKufiOctagon(size: number, text: string): { layout: KufiOctagonLayout | null; band: KufiPackResult } {
  const band = packKufiRegion({ text, mask: octagonBandMask(size), bars: false });
  if (!band.ok) return { layout: null, band };
  return { layout: octagonFromBand(size, band), band };
}

/** The square built on one side's packing (`octagonBandMask(size)`): the four turns and the lengthened strokes. */
export function octagonFromBand(size: number, band: Extract<KufiPackResult, { ok: true }>): KufiOctagonLayout {
  const g = octagonGeometry(size);
  const N = size, L = g.line;
  const cells = new Uint8Array(N * N);
  const quarter = new Uint8Array(N * N); // the bottom band and its field
  const ink = (x: number, y: number) => band.cells[y * L + x] === 1;
  // the bottom band's letters, feet on the bottom edge
  for (let r = 0; r < OCTAGON_BAND; r++)
    for (let c = 0; c < L; c++) if (ink(c, r)) quarter[(N - OCTAGON_BAND + r) * N + c] = 1;
  // its tall strokes, lengthened inward: a column under the interior whose top cell is an upright
  const strokes = { lengthened: 0, onOctagon: 0 };
  for (let c = OCTAGON_DEPTH; c < L; c++) {
    const r0 = strokeTop(band.cells, L, c);
    if (r0 === null) continue;
    let y = N - OCTAGON_BAND + r0 - 1;
    let n = 0;
    while (y >= 0 && octagonBottomField(g, c, y) && !octagonOpen(g, c, y)) {
      quarter[y * N + c] = 1;
      n++;
      y--;
    }
    if (n > 0) {
      strokes.lengthened++;
      if (y >= 0 && octagonOpen(g, c, y)) strokes.onOctagon++;
    }
  }
  // the frame: the base row's gaps, where closing one makes no solid 2x2
  const quarterFrame = new Uint8Array(N * N);
  const base = N - 1;
  const q = (x: number, y: number) => x >= 0 && x < N && y >= 0 && y < N && quarter[y * N + x] === 1;
  for (let c = 0; c < L; c++) {
    if (q(c, base)) continue;
    const solidWith = (d: number) => q(c + d, base) && q(c + d, base - 1) && q(c, base - 1);
    if (!solidWith(-1) && !solidWith(1)) quarterFrame[base * N + c] = 1;
  }
  // the four copies by rotation
  const frame = new Uint8Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const inkHere = quarter[y * N + x] === 1, frameHere = quarterFrame[y * N + x] === 1;
      if (!inkHere && !frameHere) continue;
      let [tx, ty] = [x, y];
      for (let t = 0; t < 4; t++) {
        if (inkHere) cells[ty * N + tx] = 1;
        else frame[ty * N + tx] = 1;
        [tx, ty] = octagonTurn(N, tx, ty);
      }
    }
  return { geometry: g, cells, frame, band, strokes };
}

/** The ink drawn: the layout's cells, plus its frame when `lines` is on. */
export function octagonInk(layout: KufiOctagonLayout, lines: boolean): Uint8Array {
  if (!lines) return layout.cells;
  const out = new Uint8Array(layout.cells);
  for (let i = 0; i < out.length; i++) if (layout.frame[i]) out[i] = 1;
  return out;
}

/** The layout as rows of `#` and `.`, for tests and snapshots. */
export function octagonRows(layout: KufiOctagonLayout, lines = false): string[] {
  const N = layout.geometry.size;
  const ink = octagonInk(layout, lines);
  return Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (ink[y * N + x] ? "#" : ".")).join(""));
}
