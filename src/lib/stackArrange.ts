// Arranging a stack block's letters to fill a closed shape. Pure: geometry in
// font units, the shape in px, the scale between them found here. Never
// imports ./harfbuzz.
import type { StackPiece, StackJoin } from "../types";
import { pointInPolygon } from "./svgPath";
import { outlineBounds } from "./strokeCuts";
import { translateCmds, transformPt } from "./stackGeometry";

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
/** Steps either side of zero when an outer letter looks for a wider band
 *  within ±¼ of its own height. */
const NUDGE_STEPS = 4;
/** The most an outer letter leans toward the shape's edge. */
const MAX_TILT = Math.PI / 6;

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
      const need = rowNeed(tryMembers, gap);
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
    const need = rowNeed(row.groups, gap);
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

/** The span the shape offers over one group's own band when its letter sits at `y`. */
function ownSpan(poly: readonly Pt[], g: Group, y: number): [number, number] | null {
  return bandSpan(poly, y + g.box.y1, y + g.box.y2);
}

/** How far an outer letter should move vertically (± a quarter of its
 *  height) so its own band is widest; ties keep the smallest move. */
function nudge(poly: readonly Pt[], g: Group, y: number): number {
  const quarter = height(g.box) / 4;
  let bestDy = 0, bestW = -Infinity;
  for (let k = -NUDGE_STEPS; k <= NUDGE_STEPS; k++) {
    const dy = (k / NUDGE_STEPS) * quarter;
    const s = ownSpan(poly, g, y + dy);
    if (!s) continue;
    const w = s[1] - s[0];
    if (w > bestW + 1e-6 || (Math.abs(w - bestW) <= 1e-6 && Math.abs(dy) < Math.abs(bestDy))) { bestW = w; bestDy = dy; }
  }
  return bestDy;
}

export type Placement = { x: number; y: number; rotation: number };

/** The signed angle from vertical of the boundary beside a group at `y`, on
 *  `side`; positive leans right going up (a positive piece rotation, y-down). */
function edgeLean(poly: readonly Pt[], g: Group, y: number, side: "left" | "right"): number {
  const h = height(g.box);
  const top = y + g.box.y1 + 0.01 * h, bottom = y + g.box.y2 - 0.01 * h;
  const ct = chordAt(poly, top), cb = chordAt(poly, bottom);
  if (!ct || !cb) return 0;
  const i = side === "right" ? 1 : 0;
  return Math.atan2(ct[i] - cb[i], bottom - top);
}

/** A group rotated by `rot` about its letter's pivot at (x, y): every box
 *  corner inside the shape and its rotated bounds clear of `neighbour`. */
function fitsRotated(poly: readonly Pt[], g: Group, x: number, y: number, rot: number, neighbour: Box | null, gap: number): boolean {
  const t = { x, y, rotation: rot, pivot: g.letter.pivot };
  const corners: Pt[] = [[g.box.x1, g.box.y1], [g.box.x2, g.box.y1], [g.box.x1, g.box.y2], [g.box.x2, g.box.y2]];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of corners) {
    const [wx, wy] = transformPt(c, t);
    if (!pointInPolygon(wx, wy, poly as Array<[number, number]>)) return false;
    x1 = Math.min(x1, wx); y1 = Math.min(y1, wy); x2 = Math.max(x2, wx); y2 = Math.max(y2, wy);
  }
  if (!neighbour) return true;
  return x2 + gap <= neighbour.x1 || x1 - gap >= neighbour.x2 || y2 <= neighbour.y1 || y1 >= neighbour.y2;
}

/** A group's bounds when rotated by `rot` about its letter's pivot, relative
 *  to the letter's origin. */
function rotatedExtents(g: Group, rot: number): Box {
  const t = { x: 0, y: 0, rotation: rot, pivot: g.letter.pivot };
  const corners: Pt[] = [[g.box.x1, g.box.y1], [g.box.x2, g.box.y1], [g.box.x1, g.box.y2], [g.box.x2, g.box.y2]];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of corners) {
    const [wx, wy] = transformPt(c, t);
    x1 = Math.min(x1, wx); y1 = Math.min(y1, wy); x2 = Math.max(x2, wx); y2 = Math.max(y2, wy);
  }
  return { x1, y1, x2, y2 };
}

/**
 * An outer letter leaning into the edge beside it: the edge's lean, clamped
 * to `MAX_TILT`, halved until the leaning letter fits. Room for the lean is
 * reserved, not hoped for: the letter's *rotated* bounds sit one gap inside
 * the chord, and since a leaning box is taller than an upright one the
 * letter is lifted by the overhang below its row bottom, which must fit the
 * `headroom` to the row above. Returns the tilt and the (x, y) it needs.
 */
function leanIntoEdge(
  poly: readonly Pt[], g: Group, y: number, side: "left" | "right", edge: number, gap: number, headroom: number
): Placement {
  let rot = Math.max(-MAX_TILT, Math.min(MAX_TILT, edgeLean(poly, g, y, side)));
  for (let k = 0; k < 7; k++) {
    if (k === 6) rot = 0;
    const ext = rotatedExtents(g, rot);
    const below = Math.max(0, ext.y2 - g.box.y2), above = Math.max(0, g.box.y1 - ext.y1);
    const yy = y - below;
    // The chord over the leaning letter's own (taller) band, else the caller's edge.
    const sp = rot === 0 ? null : bandSpan(poly, yy + ext.y1, yy + ext.y2);
    const e = sp ? sp[side === "right" ? 1 : 0] : edge;
    const x = side === "right" ? e - gap - ext.x2 : e + gap - ext.x1;
    if (rot === 0) return { x, y: yy, rotation: 0 };
    if (below + above <= headroom && fitsRotated(poly, g, x, yy, rot, null, 0)) return { x, y: yy, rotation: rot };
    rot /= 2;
  }
  return { x: side === "right" ? edge - gap - g.box.x2 : edge + gap - g.box.x1, y, rotation: 0 };
}

/** The width a row of these groups needs: ink, gaps between, and — for a
 *  row of three or more, which hugs the edges — one gap at each edge. */
function rowNeed(groups: readonly Group[], gap: number): number {
  const ink = groups.reduce((s, g) => s + width(g.box), 0);
  return ink + gap * (groups.length - 1) + (groups.length >= 3 ? 2 * gap : 0);
}

/**
 * Each group's new letter position. A row of one or two is centred in the
 * row's span, its letters spread up to `MAX_SPREAD` apart. A row of three or
 * more hugs the shape: each outer letter is measured against its *own* band
 * (not the row's union band, which a tall neighbour narrows) and slid out to
 * one gap inside the chord there; the inner letters share the rest equally.
 */
function placeRow(row: Row, poly: readonly Pt[], upm: number, headroom: number): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const b = row.bottom;
  const span = bandSpan(poly, b - height(row.box), b) ?? [row.box.x1, row.box.x2];
  const widths = row.groups.map((g) => width(g.box));
  const n = row.groups.length;
  const minGap = LETTER_GAP * upm;
  const y0 = b - row.box.y2; // row space y=0 lands here
  const ys = row.dys.map((dy) => y0 + dy);
  const first = row.groups[0], last = row.groups[n - 1];
  if (n === 1) {
    out.set(first.letter.id, { x: (span[0] + span[1]) / 2 - (first.box.x1 + first.box.x2) / 2, y: ys[0], rotation: 0 });
    return out;
  }
  if (n === 2) {
    // Each letter leans into its edge with room reserved, then both are
    // drawn toward the centre until they are at most MAX_SPREAD apart.
    const pf = leanIntoEdge(poly, first, ys[0], "right", span[1], minGap, headroom);
    const pl = leanIntoEdge(poly, last, ys[1], "left", span[0], minGap, headroom);
    const ef = rotatedExtents(first, pf.rotation), el = rotatedExtents(last, pl.rotation);
    const apart = (pf.x + ef.x1) - (pl.x + el.x2);
    const pull = Math.max(0, (apart - MAX_SPREAD * upm) / 2);
    out.set(first.letter.id, { ...pf, x: pf.x - pull });
    out.set(last.letter.id, { ...pl, x: pl.x + pull });
    return out;
  }
  // Three or more: the outer letters hug the shape at their own band, nudged
  // and leaning; the inner letters share the width between them equally.
  ys[0] += nudge(poly, first, ys[0]);
  ys[n - 1] += nudge(poly, last, ys[n - 1]);
  const rightEdge = (ownSpan(poly, first, ys[0]) ?? span)[1];
  const leftEdge = (ownSpan(poly, last, ys[n - 1]) ?? span)[0];
  const pf = leanIntoEdge(poly, first, ys[0], "right", rightEdge, minGap, headroom);
  const pl = leanIntoEdge(poly, last, ys[n - 1], "left", leftEdge, minGap, headroom);
  out.set(first.letter.id, pf);
  out.set(last.letter.id, pl);
  const innerRight = pf.x + rotatedExtents(first, pf.rotation).x1;
  const innerLeft = pl.x + rotatedExtents(last, pl.rotation).x2;
  const innerTotal = widths.slice(1, n - 1).reduce((s, w) => s + w, 0);
  const gap = Math.max(minGap, (innerRight - innerLeft - innerTotal) / (n - 1));
  let right = innerRight - gap;
  for (let i = 1; i < n - 1; i++) {
    const g = row.groups[i];
    out.set(g.letter.id, { x: right - g.box.x2, y: ys[i], rotation: 0 });
    right -= widths[i] + gap;
  }
  return out;
}

/**
 * The arranged layout at one scale, or null when it does not fit. `scale` is
 * px per font unit, so the shape is read in font units as `shapePx / scale`.
 */
function arrangeAt(groups: Group[], shapePx: readonly Pt[], scale: number, upm: number): { rows: Row[]; pos: Map<string, Placement> } | null {
  const poly = shapePx.map((p): Pt => [p[0] / scale, p[1] / scale]);
  const rows = pack(groups, poly, upm);
  if (!rows) return null;
  spreadRows(rows, poly, upm);
  const pos = new Map<string, Placement>();
  rows.forEach((row, i) => {
    // Room between this row's top and the next row's bottom (the shape bounds the top row).
    const next = rows[i + 1];
    const headroom = next ? row.bottom - height(row.box) - next.bottom : Infinity;
    for (const [id, p] of placeRow(row, poly, upm, headroom)) pos.set(id, p);
  });
  // Bisection fits rows plus tilt: a leaning letter must still be inside.
  // (Upright letters were measured against the chord by bandSpan already,
  // which samples a hair inside; a point test on the chord itself would
  // reject a box that exactly fits.)
  for (const g of groups) {
    const p = pos.get(g.letter.id)!;
    if (p.rotation !== 0 && !fitsRotated(poly, g, p.x, p.y, p.rotation, null, 0)) return null;
  }
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
    const pl = pos.get(g.letter.id)!;
    const dx = pl.x - g.letter.x, dy = pl.y - g.letter.y;
    const lp: Pt = [g.letter.pivot[0] + pl.x, g.letter.pivot[1] + pl.y];
    const c = Math.cos(pl.rotation), s = Math.sin(pl.rotation);
    for (const m of g.members) {
      const mx = m.x + dx, my = m.y + dy;
      if (m === g.letter || pl.rotation === 0) { moved.set(m.id, { ...m, x: mx, y: my, rotation: pl.rotation }); continue; }
      // A rider turns with its letter: its pivot swings about the letter's pivot.
      const vx = m.pivot[0] + mx - lp[0], vy = m.pivot[1] + my - lp[1];
      const nx = lp[0] + vx * c - vy * s, ny = lp[1] + vx * s + vy * c;
      moved.set(m.id, { ...m, x: nx - m.pivot[0], y: ny - m.pivot[1], rotation: pl.rotation });
    }
  }
  return {
    pieces: input.pieces.map((p) => moved.get(p.id) ?? p),
    joins: input.joins.map((j) => ({ ...j, bow: 0, depth: 0 })),
    fontSize: input.fontSize * lo,
    rows: rows.length,
  };
}
