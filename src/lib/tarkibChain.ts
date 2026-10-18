/**
 * Chaining library pieces into a connected run, and a whole phrase on one
 * line. Pieces meet at their join anchors (tarkibSchema.ts JoinEnd): the
 * next piece's entry sits on the previous piece's exit, a hair back along
 * the writing direction so the two inks overlap and merge. A curved
 * `StackJoin` is spliced only where a stroke is lengthened or a letter
 * climbs into the tier above, and only between flat cut faces. Pure. See
 * .claude/rules/tarkib.md.
 */
import type { StackJoin, StackPiece } from "../types";
import { splitPieceAtCut } from "./stackConvert";
import { transformCmds } from "./stackGeometry";
import { assembleStackOutline, pieceTransform } from "./stackOutline";
import { flattenContours, outlineBounds, type Pt } from "./strokeCuts";
import { pointInPolygon } from "./svgPath";
import { buildPiece } from "./tarkibPieces";
import { canDraw, type PieceSchema, type TarkibLibrary } from "./tarkibSchema";
import { analyzePhrase, type PhraseLetter, type PhraseRun } from "./tarkibText";

const PEN = 48;
const NIB = { width: PEN, minFraction: 0.5 };
/** How far the next piece's entry sits back along the writing direction
 *  from the previous exit: enough overlap that the inks merge without a seam. */
export const OVERLAP = 2;
/** Units between the two faces of a climbing join, along the exit's direction. */
export const JOIN_GAP = 12;
/** Space between connected runs inside a word, and between words. */
export const RUN_GAP = PEN;
export const WORD_GAP = 2 * PEN;

/** Which piece draws each stretch of the run, which joins climb, and how
 *  much each stretchable piece is lengthened (piece id -> units). */
export type RunChoice = { schemaIds: string[]; climbs: boolean[]; stretch: Record<string, number> };
export type ChainedRun = {
  pieces: StackPiece[];
  joins: StackJoin[];
  width: number;
  height: number;
  /** Each meeting of an exit and the next entry, block units. */
  meets: { exit: Pt; entry: Pt }[];
  /** The writing line: the y of the run's first join anchor (else its ink bottom). */
  baselineY: number;
};

const key = (l: PhraseLetter) => `${l.skeleton}|${l.form}`;

/** Does a multi-letter piece spell the run from letter `k` on? */
function spells(s: PieceSchema, run: PhraseRun, k: number): boolean {
  return s.letters.every((_, i) => !!run.letters[k + i] && canDraw(s, i, run.letters[k + i]));
}

/** The single-letter pieces that can draw `l`. */
const singlesFor = (lib: TarkibLibrary, l: PhraseLetter) => (lib.single.get(key(l)) ?? []).filter((s) => canDraw(s, 0, l));

/** The run's letters with no piece to draw them (their typed characters). */
export function missingLetters(lib: TarkibLibrary, run: PhraseRun): string[] {
  return run.letters.filter((l) => singlesFor(lib, l).length === 0).map((l) => l.char);
}

/** Where a piece comes from, best first: the first bought vector set, the
 *  second (a lighter pen, and joins read from its own ends), the scans. A run
 *  drawn from one hand reads as one hand; the next source fills only what
 *  the first lacks. */
const SOURCES = [/^thuluth-v\d/, /^thuluth-w\d/, /./];

/** A plain, typical form from the best source's real forms in `list`: the
 *  narrower half (the less flourished: a straight alif, not a curved display
 *  one), then the median height among those (not the longest alif, not a
 *  cramped one). A stand-in is used only when no source has a real form. */
function typical(lib: TarkibLibrary, list: PieceSchema[]): PieceSchema | undefined {
  const real = list.filter((s) => !s.standIn);
  const tier = SOURCES.map((re) => real.filter((s) => re.test(s.itemId))).find((t) => t.length);
  const pool = tier ?? list;
  const h = (s: PieceSchema) => lib.items.get(s.itemId)?.h ?? 0;
  const w = (s: PieceSchema) => lib.items.get(s.itemId)?.w ?? 0;
  const ws = pool.map(w).sort((a, b) => a - b), medW = ws[Math.floor((ws.length - 1) / 2)];
  const plain = pool.filter((s) => w(s) <= medW);
  return plain.sort((a, b) => h(a) - h(b))[Math.floor((plain.length - 1) / 2)];
}

/** Multi-letter pieces where one spells the run (the calligrapher's own
 *  joins), a typical single piece elsewhere. Null if a letter has none. */
export function defaultChoice(lib: TarkibLibrary, run: PhraseRun): RunChoice | null {
  const ids: string[] = [];
  for (let k = 0; k < run.letters.length; ) {
    const l = run.letters[k];
    const multi = (lib.multi.get(key(l)) ?? []).find((s) => spells(s, run, k));
    const pick = multi ?? typical(lib, singlesFor(lib, l));
    if (!pick) return null;
    ids.push(pick.id);
    k += pick.letters.length;
  }
  return { schemaIds: ids, climbs: ids.slice(1).map(() => false), stretch: {} };
}

const dir = (a: number): Pt => [Math.cos(a), Math.sin(a)];

/** How far a letter's dots may be pushed to clear other ink, and the step. */
const DOT_STEP = PEN / 4, DOT_REACH = 4 * PEN;

/**
 * Move each letter's dots, together, straight away from the letter (up if
 * they sit above its centre, down if below) until none touches any letter's
 * ink in the run. A ya tooth's dots otherwise fall inside the next letter's
 * stroke, which runs under the tooth. Probes are each dot's centre and its
 * rhombus's four tips, pulled in a little.
 */
function clearDots(pieces: StackPiece[]): StackPiece[] {
  const ink = pieces.filter((p) => p.role === "letter")
    .flatMap((p) => flattenContours(transformCmds(p.cmds, pieceTransform(p))) as Pt[][]);
  const hits = (x: number, y: number) => ink.some((poly) => pointInPolygon(x, y, poly));
  const byParent = new Map<string, StackPiece[]>();
  for (const p of pieces) if (p.role === "mark" && p.parentId) byParent.set(p.parentId, [...(byParent.get(p.parentId) ?? []), p]);
  const moved = new Map<string, number>();
  for (const [parentId, dots] of byParent) {
    const parent = pieces.find((p) => p.id === parentId)!;
    const up = dots[0].y + dots[0].pivot[1] < parent.y + parent.pivot[1];
    const sgn = up ? -1 : 1;
    const probes = (d: StackPiece, dy: number): Pt[] => {
      const b = outlineBounds(d.cmds), cx = d.x + (b.x1 + b.x2) / 2, cy = d.y + dy + (b.y1 + b.y2) / 2;
      const rx = (b.x2 - b.x1) * 0.4, ry = (b.y2 - b.y1) * 0.4;
      return [[cx, cy], [cx + rx, cy], [cx - rx, cy], [cx, cy + ry], [cx, cy - ry]];
    };
    let dy = 0;
    while (Math.abs(dy) < DOT_REACH && dots.some((d) => probes(d, dy).some(([x, y]) => hits(x, y)))) dy += sgn * DOT_STEP;
    for (const d of dots) moved.set(d.id, dy);
  }
  return pieces.map((p) => (moved.get(p.id) ? { ...p, y: p.y + moved.get(p.id)!, homeY: p.homeY + moved.get(p.id)! } : p));
}
const shift = (p: StackPiece, d: Pt): StackPiece => ({ ...p, x: p.x + d[0], y: p.y + d[1], homeX: p.homeX + d[0], homeY: p.homeY + d[1] });

export function chainRun(lib: TarkibLibrary, run: PhraseRun, choice: RunChoice, idPrefix: string, orderStart: number): ChainedRun {
  let pieces: StackPiece[] = [], joins: StackJoin[] = [];
  const meets: ChainedRun["meets"] = [];
  let prevExit: { world: Pt; angle: number; pieceId: string; faceIndex?: number } | null = null;
  let baselineY: number | null = null;
  let letterAt = 0;
  choice.schemaIds.forEach((sid, k) => {
    const s = lib.schema.get(sid);
    if (!s) throw new Error(`no piece ${sid}`);
    const letters = run.letters.slice(letterAt, letterAt + s.letters.length);
    const climbIn = k > 0 && choice.climbs[k - 1], climbOut = choice.climbs[k] ?? false;
    const id = `${idPrefix}${k}`;
    const b = buildPiece(lib, sid, letters, id, orderStart + letterAt, { splice: { entry: climbIn, exit: climbOut } });
    letterAt += s.letters.length;

    let at: Pt = [0, 0];
    if (prevExit) {
      if (!b.entry) throw new Error(`${sid} has no entry to join`);
      const w = dir(prevExit.angle);
      if (climbIn) {
        // Into the tier above: the faces apart along the stroke, the piece lifted clear.
        const h = outlineBounds(b.piece.cmds);
        at = [prevExit.world[0] + w[0] * JOIN_GAP - b.entry.point[0], prevExit.world[1] + w[1] * JOIN_GAP - b.entry.point[1] - (h.y2 - h.y1) - PEN / 4];
        if (prevExit.faceIndex === undefined || b.entry.faceIndex === undefined) throw new Error(`${sid}: a climb needs flat faces at both ends`);
        joins.push({ id: `j${prevExit.pieceId}-${id}`, from: { pieceId: prevExit.pieceId, faceIndex: prevExit.faceIndex }, to: { pieceId: id, faceIndex: b.entry.faceIndex }, bow: 0 });
      } else {
        at = [prevExit.world[0] - w[0] * OVERLAP - b.entry.point[0], prevExit.world[1] - w[1] * OVERLAP - b.entry.point[1]];
      }
      meets.push({ exit: prevExit.world, entry: [at[0] + b.entry.point[0], at[1] + b.entry.point[1]] });
    }
    pieces.push(shift(b.piece, at), ...b.dots.map((d) => shift(d, at)));
    let exitWorld: Pt | null = b.exit ? [at[0] + b.exit.point[0], at[1] + b.exit.point[1]] : null;
    if (baselineY === null) baselineY = b.exit ? exitWorld![1] : b.entry ? at[1] + b.entry.point[1] : null;

    // Lengthen: split at the zone, move the far part along the stroke.
    const amount = choice.stretch[id] ?? 0;
    const zone = b.piece.stretch?.[0];
    if (amount > 0 && zone) {
      const split = splitPieceAtCut(pieces, joins, id, zone, zone.side);
      if (split) {
        const cap = split.pieces.find((p) => p.parentId === id && p.id.startsWith(`${id}t`) && !pieces.some((q) => q.id === p.id))!;
        const v: Pt = [dir(zone.angle)[0] * amount, dir(zone.angle)[1] * amount];
        pieces = split.pieces.map((p) => (p.id === cap.id ? shift(p, v) : p));
        joins = split.joins;
        // the exit rides on the far part when it lies past the cut
        if (b.exit && b.exit.point[0] * Math.cos(zone.angle) + b.exit.point[1] * Math.sin(zone.angle) > zone.cutX)
          exitWorld = [exitWorld![0] + v[0], exitWorld![1] + v[1]];
      }
    }
    const exitFace = b.exit?.faceIndex === undefined ? undefined
      : pieces.find((p) => p.id === id)!.faces.length > b.exit.faceIndex ? b.exit.faceIndex : undefined;
    prevExit = b.exit ? { world: exitWorld!, angle: b.exit.angle, pieceId: id, faceIndex: exitFace } : null;
  });
  pieces = clearDots(pieces);
  const bb = outlineBounds(assembleStackOutline(pieces, joins, NIB));
  return { pieces, joins, width: bb.x2 - bb.x1, height: bb.y2 - bb.y1, meets, baselineY: baselineY ?? bb.y2 };
}

export type LineResult = { pieces: StackPiece[]; joins: StackJoin[]; pieceIds: string[] } | { error: "unsupported"; letters: string[] };

/** The whole phrase on one line, right to left, runs on a shared baseline. */
export function chainPhraseOnLine(lib: TarkibLibrary, text: string): LineResult {
  const a = analyzePhrase(text);
  const missing = [...a.unsupported];
  for (const w of a.words) for (const r of w.runs) for (const c of missingLetters(lib, r)) if (!missing.includes(c)) missing.push(c);
  if (missing.length) return { error: "unsupported", letters: missing };
  let pieces: StackPiece[] = [], joins: StackJoin[] = [];
  const pieceIds: string[] = [];
  let cursor = 0, order = 0;
  a.words.forEach((w, wi) => {
    w.runs.forEach((r, ri) => {
      const choice = defaultChoice(lib, r);
      if (!choice) throw new Error(`no pieces for ${r.letters.map((l) => l.char).join("")}`);
      const c = chainRun(lib, r, choice, `w${wi}r${ri}p`, order);
      order += r.letters.length;
      const bb = outlineBounds(assembleStackOutline(c.pieces, c.joins, NIB));
      const d: Pt = [cursor - bb.x2, -c.baselineY];
      pieces = pieces.concat(c.pieces.map((p) => shift(p, d)));
      joins = joins.concat(c.joins);
      pieceIds.push(...choice.schemaIds);
      cursor = bb.x1 + d[0] - (ri === w.runs.length - 1 ? WORD_GAP : RUN_GAP);
    });
  });
  // centre the line on the origin, as a stack centres its ink
  const bb = outlineBounds(assembleStackOutline(pieces, joins, NIB));
  const c: Pt = [-(bb.x1 + bb.x2) / 2, -(bb.y1 + bb.y2) / 2];
  return { pieces: pieces.map((p) => shift(p, c)), joins, pieceIds };
}
