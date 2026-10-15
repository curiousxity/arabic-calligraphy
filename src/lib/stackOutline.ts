// A stack block as one outline: every piece placed, every join spliced.
// Pure; the renderer and the tests both call this.
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";
import type { Pt } from "./strokeCuts";
import {
  type PieceTransform, transformCmds, transformFace, transformPt, toSegments, fromSegments, cmdsCentre,
} from "./stackGeometry";
import { joinEdges, joinFloor, spliceJoin } from "./stackJoin";

export const pieceTransform = (p: StackPiece): PieceTransform =>
  ({ x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot });

export function assembleStackOutline(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], nib: { width: number; minFraction: number }
): SvgCmd[] {
  return assembleStackOutlineReport(pieces, joins, nib).cmds;
}

/**
 * `assembleStackOutline`, plus how many joins could not be spliced (a missing
 * piece or face, or a bridge edge that is not in the pool). Each join's floor
 * is `nib.minFraction` of its thinner face's own thickness (`joinFloor`);
 * `nib.width` is provenance only and is not read.
 */
export function assembleStackOutlineReport(
  pieces: readonly StackPiece[] | undefined, joins: readonly StackJoin[] | undefined,
  nib: { width: number; minFraction: number }
): { cmds: SvgCmd[]; skipped: number } {
  // `?? []`: a hand-edited save can drop either list.
  const ps = pieces ?? [], js = joins ?? [];
  const byId = new Map(ps.map((p) => [p.id, p]));
  let pool = ps.flatMap((p) => toSegments(transformCmds(p.cmds, pieceTransform(p))));
  let skipped = 0;
  for (const j of js) {
    const from = byId.get(j.from.pieceId), to = byId.get(j.to.pieceId);
    const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
    if (!from || !to || !fa || !fb) { skipped++; continue; }
    const A = transformFace(fa, pieceTransform(from));
    const B = transformFace(fb, pieceTransform(to));
    const edges = joinEdges(A, B, j.bow, joinFloor(A, B, nib.minFraction), 24, j.depth ?? 0, j.profile);
    const spliced = spliceJoin(pool, A, B, edges);
    if (spliced) pool = spliced;
    else skipped++;
  }
  return { cmds: fromSegments(pool), skipped };
}

/** The piece ids a drag of `pieceId` carries: the piece and the pieces riding
 *  on it (`parentId`, transitively), plus — unless `alone` — every letter later
 *  in reading order. A rider (a mark, or an end cap split off a letter) carries
 *  only what rides on it. */
export function chainOf(pieces: readonly StackPiece[], pieceId: string, alone: boolean): string[] {
  const p = pieces.find((x) => x.id === pieceId);
  if (!p) return [];
  const isRider = p.role === "mark" || p.parentId !== undefined;
  const ids = new Set<string>(
    isRider
      ? [p.id]
      : pieces.filter((x) => x.role === "letter" && (x.id === p.id || (!alone && x.order > p.order))).map((x) => x.id)
  );
  for (let grew = true; grew; ) {
    grew = false;
    for (const x of pieces) {
      if (!ids.has(x.id) && x.parentId !== undefined && ids.has(x.parentId)) { ids.add(x.id); grew = true; }
    }
  }
  return pieces.filter((x) => ids.has(x.id)).map((x) => x.id);
}

/**
 * For growing a join's radius: which end stays put and which pieces move.
 * A freed curve's far end rides on its body, so the rider's end moves;
 * between two letters the later one moves, carrying — unless `alone` — the
 * letters after it, as a drag of it would. Either way everything *joined*
 * beyond the moving end comes too (and what rides on it): a freed hook whose
 * far end is joined to the next letter must not stretch that join. Null when
 * the join's pieces are missing or the fixed piece would be carried too.
 */
export function radiusEnds(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], join: StackJoin, alone: boolean
): { fixed: "from" | "to"; moving: string[] } | null {
  const from = pieces.find((p) => p.id === join.from.pieceId);
  const to = pieces.find((p) => p.id === join.to.pieceId);
  if (!from || !to) return null;
  const fixed: "from" | "to" =
    from.parentId === to.id ? "to"
    : to.parentId === from.id ? "from"
    : from.order > to.order ? "to" : "from";
  const movingId = fixed === "from" ? to.id : from.id;
  const fixedId = fixed === "from" ? from.id : to.id;
  const ids = new Set(chainOf(pieces, movingId, alone));
  for (let grew = true; grew; ) {
    grew = false;
    const add = (id: string) => { if (!ids.has(id) && id !== fixedId) { ids.add(id); grew = true; } };
    for (const j of joins) {
      if (j === join) continue;
      if (ids.has(j.from.pieceId)) add(j.to.pieceId);
      if (ids.has(j.to.pieceId)) add(j.from.pieceId);
    }
    for (const x of pieces) if (x.parentId !== undefined && ids.has(x.parentId)) add(x.id);
  }
  const moving = pieces.filter((x) => ids.has(x.id)).map((x) => x.id);
  return moving.includes(fixedId) ? null : { fixed, moving };
}

/** Smallest and largest radius factor one gesture reaches. */
export const RADIUS_MIN = 0.2;
export const RADIUS_MAX = 5;

/**
 * The radius factor of a Shift-drag on a join: 1 plus the pointer's travel
 * along the line from the fixed end through the curve's midpoint, over that
 * distance. Sideways travel does nothing. Clamped to RADIUS_MIN..RADIUS_MAX.
 */
export function radiusFactor(fixed: Pt, midpoint: Pt, travel: Pt): number {
  const dx = midpoint[0] - fixed[0], dy = midpoint[1] - fixed[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return 1;
  const k = 1 + (travel[0] * dx + travel[1] * dy) / (len * len);
  return Math.min(RADIUS_MAX, Math.max(RADIUS_MIN, k));
}

/**
 * How far to move the free end so the join's curve scales by `k` about the
 * fixed end. Nothing rotates and the handles are proportional to the chord,
 * so the whole curve — bend and all — scales with it; the faces (the pen)
 * keep their size.
 */
export const radiusOffset = (fixed: Pt, moving: Pt, k: number): Pt =>
  [(k - 1) * (moving[0] - fixed[0]), (k - 1) * (moving[1] - fixed[1])];

/** The same piece with new local commands, placed so nothing on it moves:
 *  the pivot becomes the new outline centre and x/y absorb the difference. */
export function rebasePiece(p: StackPiece, cmds: SvgCmd[]): StackPiece {
  const pivot = cmdsCentre(cmds);
  const world = transformPt(pivot, pieceTransform(p));
  return { ...p, cmds, pivot, x: world[0] - pivot[0], y: world[1] - pivot[1] };
}

/** px per font unit. A hand-edited save without `unitsPerEm` draws at 1000. */
export const stackScale = (fontSize: number, unitsPerEm: number | undefined) =>
  fontSize / Math.max(unitsPerEm || 1000, 1);
