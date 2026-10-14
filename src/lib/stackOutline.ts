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

/** The piece ids a drag of `pieceId` carries: the piece and its marks, plus
 *  — unless `alone` — every piece later in reading order and their marks. */
export function chainOf(pieces: readonly StackPiece[], pieceId: string, alone: boolean): string[] {
  const p = pieces.find((x) => x.id === pieceId);
  if (!p) return [];
  if (p.role === "mark") return [p.id];
  const letters = new Set(
    pieces.filter((x) => x.role === "letter" && (x.id === p.id || (!alone && x.order > p.order))).map((x) => x.id)
  );
  return pieces.filter((x) => letters.has(x.id) || (x.parentId !== undefined && letters.has(x.parentId))).map((x) => x.id);
}

/** The same piece with new local commands, placed so nothing on it moves:
 *  the pivot becomes the new outline centre and x/y absorb the difference. */
export function rebasePiece(p: StackPiece, cmds: SvgCmd[]): StackPiece {
  const pivot = cmdsCentre(cmds);
  const world = transformPt(pivot, pieceTransform(p));
  return { ...p, cmds, pivot, x: world[0] - pivot[0], y: world[1] - pivot[1] };
}
