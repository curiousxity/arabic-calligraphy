// A stack block as one outline: every piece placed, every join spliced.
// Pure; the renderer and the tests both call this.
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";
import {
  type PieceTransform, transformCmds, transformFace, transformPt, toSegments, fromSegments, cmdsCentre,
} from "./stackGeometry";
import { joinEdges, spliceJoin } from "./stackJoin";

export const pieceTransform = (p: StackPiece): PieceTransform =>
  ({ x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot });

export function assembleStackOutline(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], nib: { width: number; minFraction: number }
): SvgCmd[] {
  const byId = new Map(pieces.map((p) => [p.id, p]));
  let pool = pieces.flatMap((p) => toSegments(transformCmds(p.cmds, pieceTransform(p))));
  const floor = nib.width * nib.minFraction;
  for (const j of joins) {
    const from = byId.get(j.from.pieceId), to = byId.get(j.to.pieceId);
    const fa = from?.faces[j.from.faceIndex], fb = to?.faces[j.to.faceIndex];
    if (!from || !to || !fa || !fb) continue;
    const A = transformFace(fa, pieceTransform(from));
    const B = transformFace(fb, pieceTransform(to));
    const spliced = spliceJoin(pool, A, B, joinEdges(A, B, j.bow, floor));
    if (spliced) pool = spliced;
  }
  return fromSegments(pool);
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
