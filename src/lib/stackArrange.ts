// Arranging a stack block's letters to fill a closed shape. Pure: geometry in
// font units, the shape in px, the scale between them found here. Never
// imports ./harfbuzz.
import type { StackPiece, StackJoin } from "../types";
import { outlineBounds } from "./strokeCuts";
import { translateCmds } from "./stackGeometry";

type Pt = [number, number];
type Box = { x1: number; y1: number; x2: number; y2: number };

export type ArrangeInput = {
  pieces: readonly StackPiece[];
  joins: readonly StackJoin[];
  /** The container outline in px, in the block's local frame (centred where
   *  the block's origin will be). */
  shapePx: readonly Pt[];
  fontSize: number;
  unitsPerEm: number;
};

export type ArrangeResult = {
  pieces: StackPiece[];
  joins: StackJoin[];
  /** The block's new size: the largest at which every letter fits. */
  fontSize: number;
  rows: number;
};

/**
 * Tunables, all fractions of an em so they read the same in every font.
 * `letterGap` is the least space left between two letters on a row (a join
 * sweeps across it); `rowGap` the least between rows; `maxSpread` caps how
 * far a row's letters are spread toward the shape's edges before they are
 * centred instead, so a wide shape does not fling two letters apart.
 */
const LETTER_GAP = 0.08;
const ROW_GAP = 0.04;
const MAX_SPREAD = 1.0;
/** Scanlines sampled across a row's band when measuring the shape's chord. */
const BAND_SAMPLES = 7;
/** How far a row creeps upward, per try, looking for a band it fits in. */
const CREEP = 0.02;

/** A letter with its riders: moved as one, its bounds measured as one. */
type Group = {
  letter: StackPiece;
  members: StackPiece[];
  /** Ink bounds relative to the letter's (x, y), rotation 0. */
  box: Box;
};

const width = (b: Box) => b.x2 - b.x1;
const height = (b: Box) => b.y2 - b.y1;

/** The pieces riding on `id`, transitively. */
function ridersOf(pieces: readonly StackPiece[], id: string): StackPiece[] {
  const out: StackPiece[] = [];
  const ids = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const p of pieces) {
      if (!ids.has(p.id) && p.parentId !== undefined && ids.has(p.parentId)) {
        ids.add(p.id); out.push(p); grew = true;
      }
    }
  }
  return out;
}

/** Letters in reading order, each with its riders and its unrotated bounds. */
export function letterGroups(pieces: readonly StackPiece[]): Group[] {
  return pieces
    .filter((p) => p.role === "letter" && p.parentId === undefined)
    .sort((a, b) => a.order - b.order)
    .map((letter) => {
      const members = [letter, ...ridersOf(pieces, letter.id)];
      const b = outlineBounds(members.flatMap((m) => translateCmds(m.cmds, m.x - letter.x, m.y - letter.y)));
      return { letter, members, box: b };
    });
}

/** The widest horizontal interval of the polygon on the scanline `y`. */
function chordAt(poly: readonly Pt[], y: number): [number, number] | null {
  const xs: number[] = [];
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) * (xj - xi)) / (yj - yi));
  }
  if (xs.length < 2) return null;
  xs.sort((a, b) => a - b);
  let best: [number, number] | null = null;
  for (let k = 0; k + 1 < xs.length; k += 2) {
    if (!best || xs[k + 1] - xs[k] > best[1] - best[0]) best = [xs[k], xs[k + 1]];
  }
  return best;
}

/** The interval the shape offers over the whole band [top, bottom]: the
 *  widest chord of each sampled scanline, intersected. Null when the band
 *  leaves the shape or the chords share nothing. */
export function bandSpan(poly: readonly Pt[], top: number, bottom: number): [number, number] | null {
  let left = -Infinity, right = Infinity;
  for (let i = 0; i < BAND_SAMPLES; i++) {
    // Both ends of the band are sampled, a hair inside, so a box's corners
    // are inside a curved edge; and a flat top or bottom edge (a rectangle)
    // is never sampled exactly on a vertex.
    const t = 0.01 + (0.98 * i) / (BAND_SAMPLES - 1);
    const c = chordAt(poly, top + (bottom - top) * t);
    if (!c) return null;
    left = Math.max(left, c[0]);
    right = Math.min(right, c[1]);
  }
  return right > left ? [left, right] : null;
}

type Row = {
  groups: Group[];
  /** The row's union box, in row space: group g sits at (0, dy_g) where dy
   *  keeps the letters' original vertical relation (their baseline). */
  dys: number[];
  box: Box;
  /** Where the row's box bottom sits, block space. */
  bottom: number;
};

function rowBox(groups: Group[], dys: number[]): Box {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  groups.forEach((g, i) => {
    x1 = Math.min(x1, g.box.x1); x2 = Math.max(x2, g.box.x2);
    y1 = Math.min(y1, g.box.y1 + dys[i]); y2 = Math.max(y2, g.box.y2 + dys[i]);
  });
  return { x1, y1, x2, y2 };
}

/**
 * Pack the groups into rows, bottom up, reading order first at the bottom.
 * A row takes letters while their widths (plus gaps) fit the shape's span
 * over the row's band; the band is searched afresh whenever the row grows
 * taller, creeping up from the cursor until the shape takes it. Null when
 * the shape runs out before the letters do.
 */
function pack(groups: Group[], poly: readonly Pt[], upm: number): Row[] | null {
  const ys = poly.map((p) => p[1]);
  const top = Math.min(...ys), bottom = Math.max(...ys);
  const gap = LETTER_GAP * upm, rowGap = ROW_GAP * upm, creep = CREEP * upm;
  /** The lowest band at or above `cursor`, `h` tall, whose span takes `need`. */
  const findBand = (cursor: number, h: number, need: number): { bottom: number; span: [number, number] } | null => {
    for (let b = cursor; b - h >= top; b -= creep) {
      const span = bandSpan(poly, b - h, b);
      if (span && span[1] - span[0] >= need) return { bottom: b, span };
    }
    return null;
  };
  const rows: Row[] = [];
  let cursor = bottom;
  let i = 0;
  while (i < groups.length) {
    let members = [groups[i]], dys = [0];
    let box = rowBox(members, dys);
    let band = findBand(cursor, height(box), width(box));
    if (!band) return null;
    i++;
    while (i < groups.length) {
      const g = groups[i];
      const tryMembers = [...members, g], tryDys = [...dys, g.letter.y - members[0].letter.y];
      const tryBox = rowBox(tryMembers, tryDys);
      const need = tryMembers.reduce((s, m) => s + width(m.box), 0) + gap * (tryMembers.length - 1);
      const tryBand = findBand(cursor, height(tryBox), need);
      if (!tryBand) break;
      members = tryMembers; dys = tryDys; box = tryBox; band = tryBand;
      i++;
    }
    rows.push({ groups: members, dys, box, bottom: band.bottom });
    cursor = band.bottom - height(box) - rowGap;
  }
  return rows;
}

/** Spread the rows over the shape's height: the slack above the top row is
 *  shared out as equal margins, each row lifted only as far as its band still
 *  takes it, and never past the row above. */
function spreadRows(rows: Row[], poly: readonly Pt[], upm: number): void {
  const top = Math.min(...poly.map((p) => p[1]));
  const last = rows[rows.length - 1];
  const slack = last.bottom - height(last.box) - top;
  if (slack <= 0) return;
  const gap = LETTER_GAP * upm;
  const share = slack / (rows.length + 1);
  let ceiling = Infinity;
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r];
    const need = row.groups.reduce((s, g) => s + width(g.box), 0) + gap * (row.groups.length - 1);
    let lift = Math.min(share * (r + 1), row.bottom - height(row.box) - top);
    if (ceiling < Infinity) lift = Math.min(lift, ceiling);
    // Back off until the lifted band still fits the row's letters.
    for (let k = 0; k < 8 && lift > 0; k++) {
      const b = row.bottom - lift;
      const span = bandSpan(poly, b - height(row.box), b);
      if (span && span[1] - span[0] >= need) break;
      lift = k === 7 ? 0 : lift / 2;
    }
    row.bottom -= lift;
    ceiling = lift;
  }
}

/** Each group's new letter position: the row's letters right to left across
 *  its span, spread to the edges (up to `MAX_SPREAD` apart), one alone centred. */
function placeRow(row: Row, poly: readonly Pt[], upm: number): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const b = row.bottom;
  const span = bandSpan(poly, b - height(row.box), b) ?? [row.box.x1, row.box.x2];
  const widths = row.groups.map((g) => width(g.box));
  const total = widths.reduce((s, w) => s + w, 0);
  const n = row.groups.length;
  const minGap = LETTER_GAP * upm;
  let gap = n > 1 ? (span[1] - span[0] - total) / (n - 1) : 0;
  gap = Math.max(minGap, Math.min(gap, MAX_SPREAD * upm));
  const used = total + gap * (n - 1);
  // Right edge of the row's ink, centred in the span when the spread is capped.
  let right = (span[0] + span[1]) / 2 + used / 2;
  const y0 = b - row.box.y2; // row space y=0 lands here
  row.groups.forEach((g, i) => {
    const x = right - g.box.x2; // letter x such that its box's right edge is at `right`
    const y = y0 + row.dys[i];
    out.set(g.letter.id, [x, y]);
    right -= widths[i] + gap;
  });
  return out;
}

/**
 * The arranged layout at one scale, or null when it does not fit. `scale` is
 * px per font unit, so the shape is read in font units as `shapePx / scale`.
 */
function arrangeAt(groups: Group[], shapePx: readonly Pt[], scale: number, upm: number): { rows: Row[]; pos: Map<string, Pt> } | null {
  const poly = shapePx.map((p): Pt => [p[0] / scale, p[1] / scale]);
  const rows = pack(groups, poly, upm);
  if (!rows) return null;
  spreadRows(rows, poly, upm);
  const pos = new Map<string, Pt>();
  for (const row of rows) for (const [id, p] of placeRow(row, poly, upm)) pos.set(id, p);
  return { rows, pos };
}

/**
 * Arrange the stack's letters inside `shapePx`. Rows run bottom to top in
 * reading order, right to left within a row (the way a stacked Diwani name
 * climbs), each letter keeping its riders and losing its tilt, every join
 * back at its tangent-matched default. The block is scaled to the largest
 * size at which everything fits. Null when there are no letters, the shape
 * is degenerate, or nothing fits even very small.
 */
export function arrangeStackInShape(input: ArrangeInput): ArrangeResult | null {
  const groups = letterGroups(input.pieces);
  if (groups.length === 0 || input.shapePx.length < 3) return null;
  const upm = Math.max(input.unitsPerEm || 1000, 1);
  const base = input.fontSize / upm;
  const fits = (k: number) => arrangeAt(groups, input.shapePx, base * k, upm);

  // Bracket the largest fitting scale, then bisect it.
  let lo = 1;
  let found = fits(lo);
  for (let n = 0; !found && n < 12; n++) { lo /= 2; found = fits(lo); }
  if (!found) return null;
  let hi = lo * 2;
  for (let n = 0; n < 12 && fits(hi); n++) { lo = hi; found = fits(lo); hi *= 2; }
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2;
    const r = fits(mid);
    if (r) { lo = mid; found = r; } else hi = mid;
  }
  const { rows, pos } = found!;

  const moved = new Map<string, StackPiece>();
  for (const g of groups) {
    const [nx, ny] = pos.get(g.letter.id)!;
    const dx = nx - g.letter.x, dy = ny - g.letter.y;
    for (const m of g.members) moved.set(m.id, { ...m, x: m.x + dx, y: m.y + dy, rotation: 0 });
  }
  return {
    pieces: input.pieces.map((p) => moved.get(p.id) ?? p),
    joins: input.joins.map((j) => ({ ...j, bow: 0, depth: 0 })),
    fontSize: input.fontSize * lo,
    rows: rows.length,
  };
}
