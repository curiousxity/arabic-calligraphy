// Arranging a stack block's letters to fill a closed shape. Pure: geometry in
// font units, the shape in px, the scale between them found here. Never
// imports ./harfbuzz.
import type { StackPiece, StackJoin, CutFace } from "../types";
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { outlineBounds, flattenContours, findCutZonesSwept, type Contour } from "./strokeCuts";
import { translateCmds, transformPt, transformCmds, transformFace, scaleCmds, cmdsCentre, splitAtCut } from "./stackGeometry";
import { pieceTransform } from "./stackOutline";
import { stackDetectOpts, pullSpans, spanProbes, clampCutX, fromZoneFrame } from "./stackZones";
import { splitPieceAtCut } from "./stackConvert";

type Pt = [number, number];
type Box = { x1: number; y1: number; x2: number; y2: number };

/** An ornament the caller offers for the gaps: closed contours in font units
 *  at the block's unitsPerEm, origin anywhere. */
export type FillerShape = { cmds: SvgCmd[]; name: string };

export type ArrangeInput = {
  pieces: readonly StackPiece[];
  joins: readonly StackJoin[];
  /** The container outline in px, in the block's local frame (centred where
   *  the block's origin will be). */
  shapePx: readonly Pt[];
  fontSize: number;
  unitsPerEm: number;
  /** Ornaments for the gaps; omitted = no filler pass. */
  fillers?: readonly FillerShape[];
  /** How busy the filler pass is, 0 (sparsest) to 1 (every gap). Default 1. */
  fillerAmount?: number;
  /** Draw straight free stem ends out toward the boundary. Default false. */
  pullStems?: boolean;
};

export type ArrangeResult = {
  pieces: StackPiece[];
  joins: StackJoin[];
  /** The block's new size: the largest at which every letter fits. */
  fontSize: number;
  rows: number;
  /** Filler pieces added. */
  fillers: number;
  /** Stems cut and pulled (or existing caps slid). */
  stems: number;
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
/** Filler grid cell, filler padding, and the one shrink step tried after natural size. */
const FILLER_CELL = 0.2;
const FILLER_GAP = 0.03;
const FILLER_SHRINK = 0.6;
/** The extra space kept between two fillers at the sparsest amount; it falls
 *  to zero as the amount rises to 1. Only filler-to-filler: a filler still
 *  slips into a narrow gutter beside the ink at any amount. */
const FILLER_SPREAD = 0.8;
/** Stem pull: march step, the least pull worth a cut, and the most. All ems. */
const STEM_STEP = 0.02;
const STEM_MIN = 0.1;
const STEM_MAX = 3;

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

/** A rider the arranger swung with its leaning letter (it carries the
 *  letter's own rotation) put back where it sits when the letter is upright:
 *  its pivot swung about the letter's pivot by −rotation. A rider the user
 *  rotated alone keeps a different angle and is left as it is. Without this
 *  a re-run would re-swing the already swung offset, and the dot would walk
 *  away from its letter on every Fill. */
function unswing(letter: StackPiece, m: StackPiece): StackPiece {
  if (letter.rotation === 0 || m.rotation !== letter.rotation) return m;
  const lp: Pt = [letter.pivot[0] + letter.x, letter.pivot[1] + letter.y];
  const vx = m.pivot[0] + m.x - lp[0], vy = m.pivot[1] + m.y - lp[1];
  const c = Math.cos(-letter.rotation), sn = Math.sin(-letter.rotation);
  const nx = lp[0] + vx * c - vy * sn, ny = lp[1] + vx * sn + vy * c;
  return { ...m, x: nx - m.pivot[0], y: ny - m.pivot[1], rotation: 0 };
}

/** Letters in reading order, each with its riders and its unrotated bounds. */
export function letterGroups(pieces: readonly StackPiece[]): Group[] {
  return pieces
    .filter((p) => p.role === "letter" && p.parentId === undefined)
    .sort((a, b) => a.order - b.order)
    .map((letter) => {
      const members = [letter, ...ridersOf(pieces, letter.id).map((m) => unswing(letter, m))];
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
 *  row of two or more, whose outer letters sit one gap inside the edges —
 *  one gap at each edge. */
function rowNeed(groups: readonly Group[], gap: number): number {
  const ink = groups.reduce((s, g) => s + width(g.box), 0);
  return ink + gap * (groups.length - 1) + (groups.length >= 2 ? 2 * gap : 0);
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
  // And no two letters may touch: hugging, nudging and leaning each move a
  // letter after the row was measured, so the layout is checked as placed
  // and the scale shrinks until it is clear.
  const boxes = groups.map((g) => {
    const p = pos.get(g.letter.id)!;
    const e = rotatedExtents(g, p.rotation);
    return { x1: e.x1 + p.x, y1: e.y1 + p.y, x2: e.x2 + p.x, y2: e.y2 + p.y };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = 0; j < i; j++) {
    const a = boxes[i], b = boxes[j];
    if (!(a.x2 <= b.x1 || a.x1 >= b.x2 || a.y2 <= b.y1 || a.y1 >= b.y2)) return null;
  }
  return { rows, pos };
}

/**
 * Busy the gaps. The shape is scanned on a grid, bottom row first, right to
 * left; at each cell the candidates are tried in a rotation that starts at
 * the cell's index (so neighbours differ), each at natural size then shrunk.
 * A candidate is accepted when its padded box's four corners and centre are
 * inside the shape, none of them is inside any ink contour, and the box
 * stays `amount`'s spread clear of every filler already placed.
 * Deterministic for the same input.
 */
function fillGaps(
  poly: readonly Pt[], ink: readonly Contour[], fillers: readonly FillerShape[], upm: number, order: number, amount: number
): StackPiece[] {
  if (fillers.length === 0) return [];
  const cell = FILLER_CELL * upm, pad = FILLER_GAP * upm;
  const spread = (1 - Math.min(1, Math.max(0, amount))) * FILLER_SPREAD * upm;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cands = fillers.map((f) => ({ name: f.name, cmds: f.cmds, box: outlineBounds(f.cmds) }));
  const inside = (x: number, y: number) => pointInPolygon(x, y, poly as Array<[number, number]>);
  const placed: Box[] = [];
  const out: StackPiece[] = [];
  let cellIndex = 0;
  for (let cy = maxY - cell / 2; cy > minY; cy -= cell) {
    for (let cx = maxX - cell / 2; cx > minX; cx -= cell, cellIndex++) {
      let hit = false;
      for (let k = 0; k < cands.length && !hit; k++) {
        const cand = cands[(cellIndex + k) % cands.length];
        for (const shrink of [1, FILLER_SHRINK]) {
          const cmds = shrink === 1 ? cand.cmds : scaleCmds(cand.cmds, shrink);
          const pivot = cmdsCentre(cmds);
          const x = cx - pivot[0], y = cy - pivot[1];
          const b = cand.box;
          const wb: Box = { x1: b.x1 * shrink + x - pad, y1: b.y1 * shrink + y - pad, x2: b.x2 * shrink + x + pad, y2: b.y2 * shrink + y + pad };
          const probes = boxProbes(wb);
          if (!probes.every(([px, py]) => inside(px, py))) continue;
          if (boxMeetsInk(wb, probes, ink)) continue;
          if (placed.some((o) => !(wb.x2 + spread <= o.x1 || wb.x1 - spread >= o.x2 || wb.y2 + spread <= o.y1 || wb.y1 - spread >= o.y2))) continue;
          placed.push(wb);
          out.push({
            id: `f${out.length + 1}`, cmds, x, y, rotation: 0, pivot, homeX: x, homeY: y,
            order, role: "mark", filler: true, faces: [],
          });
          hit = true;
          break;
        }
      }
    }
  }
  return out;
}

/** A box's corners, edge midpoints and centre. */
function boxProbes(b: Box): Pt[] {
  const mx = (b.x1 + b.x2) / 2, my = (b.y1 + b.y2) / 2;
  return [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2], [mx, b.y1], [mx, b.y2], [b.x1, my], [b.x2, my], [mx, my]];
}

/** A box meets ink if one of its probes is inside a contour, or a contour
 *  vertex is inside the box — a letter's corner, or a dot thinner than the
 *  spacing of the probes, poking in between them. */
function boxMeetsInk(b: Box, probes: readonly Pt[], ink: readonly Contour[]): boolean {
  return probes.some(([px, py]) => ink.some((c) => pointInPolygon(px, py, c))) ||
    ink.some((c) => c.some(([vx, vy]) => vx > b.x1 && vx < b.x2 && vy > b.y1 && vy < b.y2));
}

/** Every piece's ink as flattened world-space contours (font units). */
function inkContours(pieces: readonly StackPiece[]): Contour[] {
  return pieces.flatMap((p) => flattenContours(transformCmds(p.cmds, pieceTransform(p))));
}

/** A straight stroke's free end: where to cut, and which way (piece-local unit) it points. */
type StemEnd = { cutX: number; angle: number; dir: Pt };

/** The free ends of a letter's straight strokes: each zone's end that will
 *  split and has no face of the letter within a thickness. A long zone is
 *  cut at the inner edge of its end's pull span; a short one (under four
 *  thicknesses, where `pullSpans` offers one span — an Amiri alif is 3.7)
 *  is cut at its middle, and `pullStemEnds` checks the cap lands on the
 *  end's side. */
function freeEnds(letter: StackPiece, upm: number): StemEnd[] {
  const zones = findCutZonesSwept(flattenContours(letter.cmds), { glyphIndex: 0, cluster: 0 }, stackDetectOpts(upm));
  const out: StemEnd[] = [];
  for (const z of zones) {
    const spans = pullSpans(z);
    if (spans.length === 0) continue;
    const two = spans.length === 2;
    const mid = clampCutX(z, (z.fromX + z.toX) / 2);
    const ends: { span: [number, number]; end: "from" | "to"; cutX: number }[] = [
      { span: spans[0], end: "from", cutX: two ? spans[0][1] : mid },
      { span: spans[two ? 1 : 0], end: "to", cutX: two ? spans[1][0] : mid },
    ];
    for (const { span, end, cutX } of ends) {
      if (!spanProbes(z, span).every((cx) => splitAtCut(letter.cmds, { cutX: cx, angle: z.angle }) !== null)) continue;
      if (splitAtCut(letter.cmds, { cutX, angle: z.angle }) === null) continue;
      const tip = fromZoneFrame([end === "to" ? z.toX : z.fromX, z.centreY], z.angle);
      const blocked = letter.faces.some((f) => Math.hypot((f.a[0] + f.b[0]) / 2 - tip[0], (f.a[1] + f.b[1]) / 2 - tip[1]) < z.thickness);
      if (blocked) continue;
      const o = fromZoneFrame([0, 0], z.angle), u = fromZoneFrame([1, 0], z.angle);
      const sgn = end === "to" ? 1 : -1;
      out.push({ cutX, angle: z.angle, dir: [sgn * (u[0] - o[0]), sgn * (u[1] - o[1])] });
    }
  }
  return out;
}

const rotateVec = (v: Pt, a: number): Pt => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const worldBounds = (p: StackPiece): Box => outlineBounds(transformCmds(p.cmds, pieceTransform(p)));

/** How far `cap` can move along `dir` (world unit) before its padded box
 *  leaves the shape or touches `obstacles`; in font units, capped. */
function marchDistance(poly: readonly Pt[], cap: StackPiece, dir: Pt, obstacles: readonly Contour[], upm: number): number {
  const step = STEM_STEP * upm, pad = LETTER_GAP * upm, max = STEM_MAX * upm;
  const b = worldBounds(cap);
  const clear = (d: number) => {
    const wb: Box = { x1: b.x1 - pad + dir[0] * d, x2: b.x2 + pad + dir[0] * d, y1: b.y1 - pad + dir[1] * d, y2: b.y2 + pad + dir[1] * d };
    const probes = boxProbes(wb);
    return probes.every(([px, py]) => pointInPolygon(px, py, poly as Array<[number, number]>)) && !boxMeetsInk(wb, probes, obstacles);
  };
  let d = 0;
  while (d + step <= max && clear(d + step)) d += step;
  return d;
}

/**
 * The axis an existing cap slides along: the vector between the two faces'
 * centres when they are apart, else — a cap back at its cut, after Reset —
 * the normal of the body's face (a face is the stroke's cross-section, so
 * its normal is the stroke's axis), pointed away from the body's pivot.
 */
export function capSlideAxis(bodyFace: CutFace, capFace: CutFace, bodyPivot: Pt): Pt {
  const vx = (capFace.a[0] + capFace.b[0] - bodyFace.a[0] - bodyFace.b[0]) / 2;
  const vy = (capFace.a[1] + capFace.b[1] - bodyFace.a[1] - bodyFace.b[1]) / 2;
  const len = Math.hypot(vx, vy);
  if (len > 1e-6) return [vx / len, vy / len];
  const ex = bodyFace.b[0] - bodyFace.a[0], ey = bodyFace.b[1] - bodyFace.a[1];
  const el = Math.hypot(ex, ey) || 1;
  let nx = -ey / el, ny = ex / el;
  const mx = (bodyFace.a[0] + bodyFace.b[0]) / 2 - bodyPivot[0], my = (bodyFace.a[1] + bodyFace.b[1]) / 2 - bodyPivot[1];
  if (nx * mx + ny * my < 0) { nx = -nx; ny = -ny; }
  return [nx, ny];
}

/**
 * Draw straight free stem ends out toward the boundary. For each letter: an
 * existing cap (a `letter` piece riding on it) is slid along its join's
 * axis; otherwise each free end is cut (`splitPieceAtCut`) and the cap
 * marched until a gap short of the shape or of any other ink. A cut that
 * could not move at least `STEM_MIN` is undone. Returns the new pieces and
 * joins and how many stems moved.
 */
function pullStemEnds(
  pieces: StackPiece[], joins: StackJoin[], letterIds: readonly string[], poly: readonly Pt[], upm: number
): { pieces: StackPiece[]; joins: StackJoin[]; stems: number } {
  let ps = pieces, js = joins, stems = 0;
  const contoursOf = (ids: Set<string>) => inkContours(ps.filter((p) => !ids.has(p.id)));
  for (const id of letterIds) {
    const letter = ps.find((p) => p.id === id)!;
    const caps = ps.filter((p) => p.parentId === id && p.role === "letter");
    if (caps.length > 0) {
      for (const cap of caps) {
        const j = js.find((x) => (x.from.pieceId === id && x.to.pieceId === cap.id) || (x.to.pieceId === id && x.from.pieceId === cap.id));
        if (!j) continue;
        const bodyRef = j.from.pieceId === id ? j.from : j.to, capRef = j.from.pieceId === id ? j.to : j.from;
        const fa = letter.faces[bodyRef.faceIndex], fb = cap.faces[capRef.faceIndex];
        if (!fa || !fb) continue;
        const A = transformFace(fa, pieceTransform(letter)), B = transformFace(fb, pieceTransform(cap));
        const dir = capSlideAxis(A, B, transformPt(letter.pivot, pieceTransform(letter)));
        const d = marchDistance(poly, cap, dir, contoursOf(new Set([id, cap.id])), upm);
        if (d < STEM_MIN * upm) continue;
        ps = ps.map((p) => (p.id === cap.id ? { ...p, x: p.x + dir[0] * d, y: p.y + dir[1] * d } : p));
        stems++;
      }
      continue;
    }
    for (const end of freeEnds(letter, upm)) {
      const split = splitPieceAtCut(ps, js, id, { cutX: end.cutX, angle: end.angle });
      if (!split) continue;
      const cap = split.pieces[split.pieces.length - 1];
      const body = split.pieces.find((p) => p.id === id)!;
      const dir = rotateVec(end.dir, letter.rotation);
      // The cap must be the fragment on the end's side; `splitPieceAtCut` picks by area.
      const cc = transformPt(cap.pivot, pieceTransform(cap)), bc = transformPt(body.pivot, pieceTransform(body));
      if ((cc[0] - bc[0]) * dir[0] + (cc[1] - bc[1]) * dir[1] <= 0) continue;
      const others = inkContours(split.pieces.filter((p) => p.id !== id && p.id !== cap.id));
      const d = marchDistance(poly, cap, dir, others, upm);
      if (d < STEM_MIN * upm) continue;
      ps = split.pieces.map((p) => (p.id === cap.id ? { ...p, x: p.x + dir[0] * d, y: p.y + dir[1] * d } : p));
      js = split.joins;
      stems++;
      break;   // one pull per letter per run; the next run slides it further
    }
  }
  return { pieces: ps, joins: js, stems };
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
  // Incoming fillers are dropped here too, so a caller that forgets to strip
  // them never accumulates a second layer.
  const arranged = input.pieces.filter((p) => !p.filler).map((p) => moved.get(p.id) ?? p);
  const polyFU = input.shapePx.map((p): Pt => [p[0] / (base * lo), p[1] / (base * lo)]);
  const maxOrder = groups.reduce((m, g) => Math.max(m, g.letter.order), 0);
  let arrangedPieces = arranged;
  // Every join back to its rest: the tangent-matched default, or for a curve
  // freed from a letter the bend that reproduces the letter.
  let arrangedJoins: StackJoin[] = input.joins.map((j) => ({ ...j, bow: j.rest?.bow ?? 0, depth: j.rest?.depth ?? 0 }));
  let stems = 0;
  if (input.pullStems) {
    const r = pullStemEnds(arrangedPieces, arrangedJoins, groups.map((g) => g.letter.id), polyFU, upm);
    arrangedPieces = r.pieces; arrangedJoins = r.joins; stems = r.stems;
  }
  const fills = fillGaps(polyFU, inkContours(arrangedPieces), input.fillers ?? [], upm, maxOrder, input.fillerAmount ?? 1);
  return {
    pieces: [...arrangedPieces, ...fills],
    joins: arrangedJoins,
    fontSize: input.fontSize * lo,
    rows: rows.length,
    fillers: fills.length,
    stems,
  };
}
