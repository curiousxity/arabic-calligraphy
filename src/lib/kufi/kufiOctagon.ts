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
 *   fields, one per band. A tall stroke (a shaft: a tall letter's upright
 *   reaching the band's top row, nothing beside its top, `octagonShafts`;
 *   never a heh's wall or a bowl's side; a word's shafts all together or
 *   none) runs on from the seam row straight inward through
 *   its band's field until the next cell is the open centre or a diagonal
 *   seam cell (the diagonals themselves stay paper, so the ends of two
 *   fields' strokes meet only at corners). Strokes under the octagon's flat
 *   side all end at the same depth; the strokes beside them end one cell
 *   deeper per column, the octagon's 45-degree edge, and the rest end on the
 *   diagonals, a staircase from the octagon's corner to the square's.
 * - **The open centre** is a stepped octagon `width` cells across, its
 *   corners cut so its flat sides are `flat` cells, in the proportion of a
 *   regular octagon. Its size is chosen from the band's strokes
 *   (`octagonGeometry`): a 45-degree edge and a diagonal cross at one stroke
 *   per field, the **crossing stroke**, whose end lies on both, so the
 *   octagon's edge and the diagonal staircase are one line of stroke ends
 *   (with the edge crossing between two strokes, the octagon read as a
 *   cross: the strokes beyond the crossing stop at the diagonal short of the
 *   edge, and the next field's strokes are not at those rows). Each stroke
 *   names one such octagon; the one nearest `CENTRE_RATIO` (half) of the
 *   square is taken, and that ratio alone decides where no stroke can.
 *
 * The lattice grammar (stroke = gap = one cell, no solid 2x2) holds over the
 * whole square; the space above a short letter and between lengthened
 * strokes is the design's open space, not a hole to fill, so no filler
 * squares or bars are ever drawn (`packKufiRegion` with `bars: false`).
 * `lines` on draws each band's base row solid where its letters' feet leave
 * a gap, the frame line and the feet one stroke (a gap stays where filling
 * it would make a solid 2x2). Pure: no React, no Konva, no `./harfbuzz`.
 */
import { kufiGlyphById, kufiShaftTops, stretchGlyph, type KufiGlyph } from "./kufiAlphabet";
import { COL_MAX, kufiFormsOf, packKufiRegion, type KufiMask, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";
import { resolveKufiText, type KufiUnit } from "./kufiWords";

/** Letter height: a band is one 5-row line. */
export const OCTAGON_BAND = 5;
/** A band's depth: its letters and the seam row inside them. */
export const OCTAGON_DEPTH = OCTAGON_BAND + 1;
/** The smallest square: a 7-cell line and no interior but the centre cell (one الله needs 15: its band form is 9 wide). */
export const OCTAGON_MIN_SIZE = 2 * OCTAGON_DEPTH + 1;
export const OCTAGON_MAX_SIZE = 60;
/** The open centre's width over the square's: the aim among the strokes' octagons, the rule where there are none. */
const CENTRE_RATIO = 0.5;
/** How far from the aim, over the square's side, a stroke's octagon may be and still be taken. */
const CENTRE_SLACK = 0.25;
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

/** A regular octagon's flat for `width`: nearest to `FLAT_RATIO` of it, of its parity, never wider. */
function regularFlat(width: number): number {
  return width <= 0 ? 0 : Math.min(width, nearestWithParity(FLAT_RATIO * width, width, 2 - (width % 2)));
}

/**
 * The open centre of a square of `size` whose bottom band lengthens the
 * strokes in columns `strokeCols` (any columns: the geometry is four-fold).
 *
 * In doubled centred coordinates (`centred`) a stroke's column is X, the
 * diagonal seam it meets is at Y = |X|, so its end on the diagonal is at
 * Y = |X| + 2, and the octagon's 45-degree edge puts the end of the stroke
 * at Y = flat + width - |X|. The stroke is the crossing stroke of the
 * octagon with flat + width = 2 |X| + 2: of that sum, the width is the
 * square's parity nearest sum / sqrt 2 (the flat the rest), the pair
 * nearest a regular octagon's proportion. Of the strokes' octagons that fit
 * (never wider than the interior less two, so every stroke keeps a cell)
 * and lie within `CENTRE_SLACK` of the square of `CENTRE_RATIO` of it, the
 * one nearest that aim is taken, the wider on a tie; with none, the ratio's
 * own width, a regular flat, capped the same way (the centre cell at 13).
 */
export function octagonGeometry(size: number, strokeCols: readonly number[] = []): KufiOctagonGeometry {
  const interior = size - 2 * OCTAGON_DEPTH;
  const maxWidth = Math.max(interior % 2 === 0 ? 0 : 1, interior - 2);
  const aim = CENTRE_RATIO * size;
  let best: { width: number; flat: number } | null = null;
  for (const c of strokeCols) {
    const X = Math.abs(2 * c - (size - 1));
    if (X === 0) continue;
    const sum = 2 * X + 2;
    // the stroke's octagon: of the two widths of the square's parity about sum / sqrt 2, the pair nearer a regular octagon
    let own: { width: number; flat: number } | null = null;
    const lo = Math.floor(sum / Math.SQRT2);
    for (const width of [nearestWithParity(lo, size, 0), nearestWithParity(lo + 1, size, 0)]) {
      const flat = sum - width;
      if (width < 1 || flat < 1 || flat > width || width > maxWidth) continue;
      if (!own || Math.abs(flat / width - FLAT_RATIO) < Math.abs(own.flat / own.width - FLAT_RATIO)) own = { width, flat };
    }
    if (!own) continue;
    const d = Math.abs(own.width - aim), dBest = best ? Math.abs(best.width - aim) : Infinity;
    if (d > CENTRE_SLACK * size) continue;
    if (d < dBest || (d === dBest && best && own.width > best.width)) best = own;
  }
  if (!best) {
    const width = Math.max(interior % 2 === 0 ? 0 : 1, Math.min(maxWidth, nearestWithParity(aim, size, 1)));
    best = { width, flat: regularFlat(width) };
  }
  return { size, line: size - OCTAGON_DEPTH, ...best };
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
  /**
   * Tall strokes lengthened per side; how many end on the octagon (the next
   * cell open: under a flat side or on a 45-degree edge) and how many on a
   * diagonal beyond the crossing stroke, the staircase to the square's corner.
   */
  strokes: { lengthened: number; onOctagon: number; onDiagonal: number };
  /** The band's words with a shaft: those whose shafts rise, and those left at the band's height. */
  words: { risen: number; still: number };
};

/** A shaft of the band: its column, and whether it can rise (false under the next band's corner or with ink beside its top). */
type Shaft = { col: number; free: boolean; corner: boolean };

/**
 * The band's shafts by word: per placement, the band's top-row cells that
 * are a shaft's top (`kufiShaftTops`, the notion a region's bars share),
 * each marked free to rise or not, and under the corner or not.
 */
function wordShafts(band: Extract<KufiPackResult, { ok: true }>, units: KufiUnit[]): Map<number, Shaft[]> {
  const { cols: L, rows: R, cells, placements } = band;
  const ink = (x: number, y: number) => x >= 0 && x < L && y >= 0 && y < R && cells[y * L + x] === 1;
  const words = new Map<number, Shaft[]>();
  for (const p of placements) {
    const found = kufiGlyphById(p.glyphId);
    const word = units[p.unitIndex]?.wordIndex;
    if (!found || word === undefined) continue;
    const list = words.get(word) ?? [];
    words.set(word, list);
    const tops = kufiShaftTops(found.skeleton, stretchGlyph(found.glyph, p.stretch));
    for (let j = 0; j < tops.length; j++) {
      if (tops[j] < 0) continue;
      // a region's lines are upright; a shaft below the band's top row, under the corner or with ink beside its top reaches nothing
      const c = p.col + j;
      const top = p.turn === 0 && p.row + tops[j] === 0;
      const corner = top && c < OCTAGON_DEPTH;
      list.push({ col: c, free: top && !corner && !ink(c - 1, 0) && !ink(c + 1, 0), corner });
    }
  }
  return words;
}

/** The band's words with a shaft: risen (every shaft free) or still. */
function octagonWords(band: Extract<KufiPackResult, { ok: true }>, text: string): { risen: number; still: number } {
  const out = { risen: 0, still: 0 };
  for (const list of wordShafts(band, resolveKufiText(text).units).values()) {
    if (list.length === 0) continue;
    if (list.every((s) => s.free)) out.risen++;
    else out.still++;
  }
  return out;
}

/**
 * The columns of a packed band (of `text`) that lengthen inward: each holds
 * a **shaft**, the upright of a tall letter (`KUFI_SHAFT_LETTERS`: an alef,
 * a lam, a kaf's or tah's stem, the ligatures' own), reaching the band's top
 * row, two cells or more, with paper beside its top. Which letter the top
 * cell belongs to is read from the band's placements (the glyph drawn at
 * its stretch), not from the ink alone: a heh's wall rises as high as a lam
 * and is capped by the heh's bar, a box's or bowl's side likewise, and a
 * tooth letter's tooth may be stretched to the band's top with nothing
 * beside it, yet none of them is a shaft, and lengthening one stretches the
 * letter or turns it into another (a tooth into a lam). So الله lengthens
 * its alef and both lams and never the heh's wall, as the references do:
 * the lams rise above the heh, whose wall ends at its bar. A capped top
 * (a lam's hook, an alef's head) is not lengthened either: the stroke would
 * rise past its own head.
 *
 * **A word's shafts rise together or not at all** (the user, 2026-11-02: a
 * lone lengthened shaft beside its unlengthened siblings read as another
 * letter's stem). A shaft under the next band's corner (the band's first
 * `DEPTH` columns) or with ink beside its top cannot rise, so a word with
 * one such gives no stroke at all. The corner word, whose heh fills the
 * corner, is packed with its heh wide enough for its first lam to stand
 * clear of the corner (`packOctagonBand`); only where the line has no room
 * for that does it stay at the band's height.
 */
export function octagonShafts(band: Extract<KufiPackResult, { ok: true }>, text: string): number[] {
  const out: number[] = [];
  for (const list of wordShafts(band, resolveKufiText(text).units).values())
    if (list.length > 0 && list.every((s) => s.free)) out.push(...list.map((s) => s.col));
  return out.sort((a, b) => a - b);
}

/**
 * The corner word's widening: the edits that pack it with its corner letter
 * (the band's leftmost, its heh) wide enough for the word's first shaft to
 * stand at `DEPTH`, clear of the next band, or null where no shaft of the
 * corner word lies under the corner, or nothing can widen it.
 *
 * The user, 2026-11-03: each side began with a stubby word. The band's
 * corner word has its heh in the corner and its first lam under the next
 * band (column 4 of the corner's 0 to 5), and since a word's shafts rise
 * together or not at all, none of it rose while every other word did. A
 * heh's box is the one column of الله that widens without a hole, and the
 * traditional way the word is stretched, so the corner heh is widened by
 * what the lam needs (two cells for الله) and the word's shafts then rise
 * into the corner bay as the side's other end word's do, mirrored. The
 * widening is the glyph's column slice (`COL_MAX` at most) left of every
 * shaft of the word; the placed form keeps its other counts, else the
 * unit's first band form with such a slice is taken.
 */
function cornerWidening(band: Extract<KufiPackResult, { ok: true }>, units: KufiUnit[]): KufiPanelEdits | null {
  if (band.placements.length === 0) return null;
  // the corner letter: the band's leftmost placement; the corner word is its word
  const p = band.placements.reduce((a, b) => (b.col < a.col ? b : a));
  const unit = units[p.unitIndex];
  if (!unit) return null;
  const shafts = wordShafts(band, units).get(unit.wordIndex) ?? [];
  const under = shafts.filter((s) => s.corner).map((s) => s.col);
  // what the first shaft needs to stand at the corner's edge, and what the letter needs to stand in the corner itself
  // (the packer leaves a line's odd cell empty at the band's start rather than widen a heh by one)
  const d = (under.length > 0 ? OCTAGON_DEPTH - Math.min(...under) : 0) + p.col;
  if (d <= 0) return null;
  const placed = kufiGlyphById(p.glyphId)?.glyph ?? null;
  // a column slice of the corner letter's glyph that lies left of every shaft of the word
  const slice = (g: KufiGlyph) => g.stretch.findIndex((s) => s.axis === "col" && shafts.every((sh) => sh.col > p.col + s.index));
  const forms = [placed, ...kufiFormsOf(unit, "star")].filter((g): g is KufiGlyph => !!g && slice(g) >= 0);
  for (const g of forms) {
    const k = slice(g);
    const counts = g.stretch.map((_, i) => (g === placed ? (p.stretch[i] ?? 0) : 0));
    counts[k] += d;
    if (counts[k] > COL_MAX) continue;
    return { forms: { [p.unitIndex]: g.id }, stretch: { [p.unitIndex]: counts } };
  }
  return null;
}

/**
 * Packs `text` along one side of a square of `size`: the band's mask, no
 * bars, and the corner word's heh widened so its shafts clear the next
 * band (`cornerWidening`) wherever the line has room for that, else the
 * plain packing (the corner word then stays at the band's height, and the
 * layout's `words.still` says so).
 */
export function packOctagonBand(size: number, text: string): KufiPackResult {
  const mask = octagonBandMask(size);
  let best = packKufiRegion({ text, mask, bars: false });
  if (!best.ok) return best;
  const { units } = resolveKufiText(text);
  // the better band: fewer words left at the band's height, then its corner letter nearer the corner itself
  const rank = (b: Extract<KufiPackResult, { ok: true }>) => [octagonWords(b, text).still, Math.min(...b.placements.map((p) => p.col))];
  // packed again while the corner letter can widen and each packing betters the last (a line's slack may
  // put the widened letter a cell short of the corner, which the next widening fills)
  for (let pass = 0; pass <= COL_MAX; pass++) {
    const edits = cornerWidening(best, units);
    if (!edits) break;
    const next = packKufiRegion({ text, mask, bars: false, edits });
    if (!next.ok) break;
    const [a, b] = [rank(next), rank(best)];
    if (!(a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]))) break;
    best = next;
  }
  return best;
}

/**
 * The line `text` takes along a side at its band forms' authored widths
 * (joined letters share a column, a gap stands between the rest), and the
 * widening its corner word needs (`cornerWidening`, from the forms alone):
 * the estimate a fresh switch to the layout and the offers' scan start from.
 */
export function octagonLineFor(text: string): { line: number; widen: number } {
  const { units } = resolveKufiText(text);
  const formOf = (u: KufiUnit) => kufiFormsOf(u, "star")[0] ?? null;
  const widthOf = (g: KufiGlyph | null) => g?.rows[0]?.length ?? 1;
  let line = 0;
  units.forEach((u, i) => {
    line += widthOf(formOf(u)) + (i === 0 ? 0 : units[i - 1].joinsNext ? -1 : 1);
  });
  // the corner word, laid from the band's corner: its last unit leftmost
  const last = units.length > 0 ? units[units.length - 1].wordIndex : -1;
  const corner = units.filter((u) => u.wordIndex === last).reverse();
  let col = 0;
  const shafts: number[] = [];
  corner.forEach((u, i) => {
    const g = formOf(u);
    if (i > 0) col += widthOf(formOf(corner[i - 1])) + (u.joinsNext ? -1 : 1);
    if (!g) return;
    kufiShaftTops(u.skeleton, g.rows).forEach((top, j) => {
      if (top === 0) shafts.push(col + j);
    });
  });
  const under = shafts.filter((c) => c < OCTAGON_DEPTH);
  if (under.length === 0 || corner.length === 0) return { line, widen: 0 };
  const d = OCTAGON_DEPTH - Math.min(...under);
  const slice = (g: KufiGlyph) => g.stretch.some((s) => s.axis === "col" && shafts.every((c) => c > s.index));
  return { line, widen: d <= COL_MAX && kufiFormsOf(corner[0], "star").some(slice) ? d : 0 };
}

/** Packs `text` along one side; null when it does not pack a line of this size (the reason is in `band`). */
export function layoutKufiOctagon(size: number, text: string): { layout: KufiOctagonLayout | null; band: KufiPackResult } {
  const band = packOctagonBand(size, text);
  if (!band.ok) return { layout: null, band };
  return { layout: octagonFromBand(size, band, text), band };
}

/** The square built on one side's packing of `text` (`octagonBandMask(size)`): the four turns and the lengthened strokes. */
export function octagonFromBand(size: number, band: Extract<KufiPackResult, { ok: true }>, text: string): KufiOctagonLayout {
  const N = size, L = size - OCTAGON_DEPTH;
  const cells = new Uint8Array(N * N);
  const quarter = new Uint8Array(N * N); // the bottom band and its field
  const ink = (x: number, y: number) => band.cells[y * L + x] === 1;
  // the bottom band's letters, feet on the bottom edge
  for (let r = 0; r < OCTAGON_BAND; r++)
    for (let c = 0; c < L; c++) if (ink(c, r)) quarter[(N - OCTAGON_BAND + r) * N + c] = 1;
  // its tall strokes: each word's shafts under the interior, all of them or none
  const strokeCols = octagonShafts(band, text);
  const g = octagonGeometry(size, strokeCols);
  // lengthened inward from the seam row until the next cell is the open centre or a diagonal seam cell
  const strokes = { lengthened: 0, onOctagon: 0, onDiagonal: 0 };
  for (const c of strokeCols) {
    let y = N - OCTAGON_DEPTH;
    let n = 0;
    while (y >= 0 && octagonBottomField(g, c, y) && !octagonOpen(g, c, y)) {
      quarter[y * N + c] = 1;
      n++;
      y--;
    }
    if (n > 0) {
      strokes.lengthened++;
      if (y >= 0 && octagonOpen(g, c, y)) strokes.onOctagon++;
      else if (y >= 0 && octagonSeam(g, c, y)) strokes.onDiagonal++;
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
  return { geometry: g, cells, frame, band, strokes, words: octagonWords(band, text) };
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
