/**
 * A schema piece as a stack piece, ready to chain (tarkibChain.ts): its
 * outline in library units, cut at the ends that will be spliced to a
 * curved join, its two join anchors, and the dots its letters need when the
 * piece does not draw them. Pure. See .claude/rules/tarkib.md.
 */
import type { CutFace, StackPiece } from "../types";
import { cmdsCentre, splitAtCut } from "./stackGeometry";
import type { Pt } from "./strokeCuts";
import { parseSvgPath, type SvgCmd } from "./svgPath";
import type { TarkibLibrary } from "./tarkibSchema";
import type { PhraseLetter } from "./tarkibText";

const PEN = 48;

/** A join end on a built piece, piece-local: where the neighbour meets it,
 *  the writing direction, and the face index when the end was cut for a splice. */
export type BuiltEnd = { point: Pt; angle: number; faceIndex?: number };
export type BuiltPiece = { piece: StackPiece; entry?: BuiltEnd; exit?: BuiltEnd; dots: StackPiece[] };

function stackPiece(id: string, cmds: SvgCmd[], order: number, role: StackPiece["role"], faces: CutFace[] = []): StackPiece {
  return { id, cmds, x: 0, y: 0, rotation: 0, pivot: cmdsCentre(cmds), homeX: 0, homeY: 0, order, role, faces };
}

/** Where a letter's dots sit around its anchor: side by side, or a triangle
 *  pointing away from the letter. Offsets in units. */
function dotLayout(count: number, side: "above" | "below"): Pt[] {
  const away = side === "above" ? -1 : 1, h = 0.6 * PEN;
  if (count === 1) return [[0, 0]];
  if (count === 2) return [[-h, 0], [h, 0]];
  return [[-h, 0], [h, 0], [0, away * PEN]];
}

export function buildPiece(
  lib: TarkibLibrary, schemaId: string, letters: PhraseLetter | PhraseLetter[], id: string, order: number,
  opts: { splice?: { entry?: boolean; exit?: boolean } } = {}
): BuiltPiece {
  const s = lib.schema.get(schemaId);
  const item = lib.items.get(schemaId);
  if (!s || !item) throw new Error(`no piece ${schemaId}`);
  let cmds = parseSvgPath(item.d);
  const faces: CutFace[] = [];
  let entry: BuiltEnd | undefined = s.entry && { point: s.entry.point, angle: s.entry.angle };
  let exit: BuiltEnd | undefined = s.exit && { point: s.exit.point, angle: s.exit.angle };
  // An entry keeps the far side of its cut, an exit the near (tarkibSchema.ts FaceCut).
  for (const [end, keep, want] of [["entry", "far", opts.splice?.entry], ["exit", "near", opts.splice?.exit]] as const) {
    if (!want) continue;
    const face = s[end]?.face;
    if (!face) throw new Error(`${schemaId}: no face at its ${end} to splice`);
    const r = splitAtCut(cmds, face);
    if (!r) throw new Error(`${schemaId}: its ${end} face no longer cuts`);
    cmds = keep === "far" ? r.far : r.near;
    faces.push(keep === "far" ? r.farFace : r.nearFace);
    const built = { point: s[end]!.point, angle: s[end]!.angle, faceIndex: faces.length - 1 };
    if (end === "entry") entry = built; else exit = built;
  }
  const piece = { ...stackPiece(id, cmds, order, "letter", faces), ...(s.stretch.length ? { stretch: s.stretch } : {}) };

  const dots: StackPiece[] = [];
  if (!s.ownDots) {
    const nuqta = parseSvgPath(lib.nuqtaD);
    const ls = Array.isArray(letters) ? letters : [letters];
    ls.forEach((l, k) => {
      const at = s.letters[k];
      if (!at || l.dots.count === 0) return;
      const base = l.dots.side === "above" ? at.above : at.below;
      // the anchor is half a pen clear of the ink; a dot's centre sits a little farther
      const clear = (l.dots.side === "above" ? -1 : 1) * 0.3 * PEN;
      for (const [dx, dy] of dotLayout(l.dots.count, l.dots.side)) {
        const d = stackPiece(`${id}d${dots.length}`, nuqta, order, "mark");
        dots.push({ ...d, x: base[0] + dx, y: base[1] + clear + dy, homeX: base[0] + dx, homeY: base[1] + clear + dy, parentId: id });
      }
    });
  }
  return { piece, ...(entry ? { entry } : {}), ...(exit ? { exit } : {}), dots };
}
