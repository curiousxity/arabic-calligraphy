/**
 * Chaining library pieces into a connected run, and a whole phrase on one
 * line. Pieces meet at their join anchors (tarkibSchema.ts JoinEnd): the
 * next piece's entry sits on the previous piece's exit, a hair back along
 * the writing direction so the two inks overlap and merge. A curved
 * `StackJoin` is spliced only where a stroke is lengthened or a letter
 * climbs into the tier above, and only between flat cut faces. Pure. See
 * .claude/rules/tarkib.md.
 */
import type { CutFace, StackJoin, StackPiece } from "../types";
import { splitPieceAtCut } from "./stackConvert";
import { joinEdges, joinFloor } from "./stackJoin";
import { transformCmds } from "./stackGeometry";
import { assembleStackOutline, pieceTransform } from "./stackOutline";
import { flattenContours, outlineBounds, type Pt } from "./strokeCuts";
import { pointInPolygon } from "./svgPath";
import { buildPiece } from "./tarkibPieces";
import { canDraw, type FaceCut, type PieceSchema, type TarkibLibrary } from "./tarkibSchema";
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

/** The single-letter pieces that can draw `l`, where the user allows them
 *  (`use`): never a special case, a curved alif only as the `opening` letter. */
const singlesFor = (lib: TarkibLibrary, l: PhraseLetter, opening = false) =>
  (lib.single.get(key(l)) ?? []).filter((s) => canDraw(s, 0, l) && s.use !== "never" && (s.use !== "opening" || opening));

/** The run's letters with no piece to draw them (their typed characters). */
export function missingLetters(lib: TarkibLibrary, run: PhraseRun): string[] {
  return run.letters.filter((l) => singlesFor(lib, l, true).length === 0).map((l) => l.char);
}

/** Where a piece comes from, best first: the first bought vector set, the
 *  second (a lighter pen, and joins read from its own ends), the scans. A run
 *  drawn from one hand reads as one hand; the next source fills only what
 *  the first lacks. */
const SOURCES = [/^thuluth-v\d/, /^thuluth-w\d/, /./];

/** The real forms of the best source that has any (else all of `list`,
 *  stand-ins included): one hand per letter. */
function sourcePool(list: PieceSchema[]): PieceSchema[] {
  const real = list.filter((s) => !s.standIn);
  return SOURCES.map((re) => real.filter((s) => re.test(s.itemId))).find((t) => t.length) ?? list;
}

/** The single pieces the composer may swap in for `l`: the same hand as the default. */
export const variantsFor = (lib: TarkibLibrary, l: PhraseLetter, opening = false): PieceSchema[] => sourcePool(singlesFor(lib, l, opening));

/** How well `next`'s entry continues `prev`'s exit, placed as chainRun
 *  places them: the trims' miss (pickTrims: a bridge with no room, or
 *  bending tighter than BRIDGE_RADIUS), how deep the two trims cut (a deep
 *  trim eats the letter: half a unit per pen), the change in thickness (per
 *  pen) and, lightly (TURN_COST per radian), the turn between the two
 *  trimmed ends. The bought set draws a letter's forms per predecessor (its
 *  finishing nuns: after a tooth, flat from the right, after a meem's or
 *  ha's tail), and the form drawn for the neighbour meets it with a gentle
 *  bridge, shallow trims, at its weight, heading on. The turn weighs little
 *  because a wide turn can be the designer's own: a hanging ha meets a ba
 *  that rises into it in a U. An end not measured scores FIT_UNKNOWN. */
export function endFit(prev: PieceSchema, next: PieceSchema): number {
  const ex = prev.exit, en = next.entry;
  if (ex?.face?.thickness === undefined || en?.face?.thickness === undefined) return FIT_UNKNOWN;
  const w = dir(ex.angle);
  const t = pickTrims(ex.options ?? [ex.face], en.options ?? [en.face], [ex.point[0] - w[0] * OVERLAP - en.point[0], ex.point[1] - w[1] * OVERLAP - en.point[1]]);
  const turn = Math.abs(Math.atan2(Math.sin(t.a.angle - t.b.angle), Math.cos(t.a.angle - t.b.angle)));
  return t.miss + (0.5 * ((t.a.depth ?? 0) + (t.b.depth ?? 0))) / PEN + Math.abs((t.a.thickness ?? PEN) - (t.b.thickness ?? PEN)) / PEN + TURN_COST * turn;
}
const TURN_COST = 0.3;
/** endFit where an end was never measured (a touch join, or a face only the
 *  generator's guess frees): worse than a measured end that meets
 *  reasonably. One such alif brought a hairline sliver. */
const FIT_UNKNOWN = 1;
/** How much worse than the form in place a swapped-in form may fit its
 *  neighbours (endFit, summed over both). */
export const FIT_SLACK = 0.35;

/** A plain, typical form from the best source's real forms in `list`: the
 *  one nearest (by ratio) a lower-quartile width (the less flourished: a
 *  straight alif, not a curved display one) and the median height (not the
 *  longest alif, not a cramped one). Taking the narrower half outright picked
 *  the smallest nun of a sheet, which read as a zay. After `prev`, how well
 *  the form's entry fits prev's exit (endFit) counts as much as typicality
 *  (both are of a size: a log ratio, radians). A stand-in is used only when
 *  no source has a real form. */
function typical(lib: TarkibLibrary, list: PieceSchema[], prev?: PieceSchema): PieceSchema | undefined {
  const pool = sourcePool(list);
  if (!pool.length) return undefined;
  const h = (s: PieceSchema) => lib.items.get(s.itemId)?.h || 1;
  const w = (s: PieceSchema) => lib.items.get(s.itemId)?.w || 1;
  const at = (xs: number[], q: number) => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * q)];
  const tw = at(pool.map(w), 0.25), th = at(pool.map(h), 0.5);
  const off = (s: PieceSchema) => Math.abs(Math.log(w(s) / tw)) + Math.abs(Math.log(h(s) / th)) + (prev ? endFit(prev, s) : 0);
  return pool.reduce((best, s) => (off(s) < off(best) ? s : best));
}

/** `opening`: the run's first letter opens the composition (where a curved
 *  alif may stand).
 *  Multi-letter pieces where one spells the run (the calligrapher's own
 *  joins), a typical single piece elsewhere, each fitted to the one before
 *  (endFit). Null if a letter has none. */
export function defaultChoice(lib: TarkibLibrary, run: PhraseRun, opening = false): RunChoice | null {
  const ids: string[] = [];
  let prev: PieceSchema | undefined;
  for (let k = 0; k < run.letters.length; ) {
    const l = run.letters[k];
    const multi = (lib.multi.get(key(l)) ?? []).find((s) => s.use !== "never" && spells(s, run, k));
    const pick = multi ?? typical(lib, singlesFor(lib, l, opening && k === 0), prev);
    if (!pick) return null;
    ids.push(pick.id);
    prev = pick;
    k += pick.letters.length;
  }
  return { schemaIds: ids, climbs: ids.slice(1).map(() => false), stretch: {} };
}

/** The forms the composer may swap in for piece `k` of `choice` (a single
 *  letter): the same hand (variantsFor), fitting their neighbours (endFit,
 *  both sides summed) no worse than the form in place by FIT_SLACK. */
export function fittingVariants(lib: TarkibLibrary, run: PhraseRun, choice: RunChoice, k: number, opening = false): PieceSchema[] {
  const at = choice.schemaIds.slice(0, k).reduce((n, id) => n + lib.schema.get(id)!.letters.length, 0);
  const prev = k > 0 ? lib.schema.get(choice.schemaIds[k - 1]) : undefined;
  const next = k + 1 < choice.schemaIds.length ? lib.schema.get(choice.schemaIds[k + 1]) : undefined;
  const fit = (s: PieceSchema) => (prev ? endFit(prev, s) : 0) + (next ? endFit(s, next) : 0);
  const limit = fit(lib.schema.get(choice.schemaIds[k])!) + FIT_SLACK;
  return variantsFor(lib, run.letters[at], opening && at === 0).filter((s) => s.id !== choice.schemaIds[k] && fit(s) <= limit);
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
/** A trim's centre (piece-local), its stroke's thickness, and its direction. */
function trimGeometry(f: FaceCut): { centre: Pt; width: number; dir: Pt } {
  const c = Math.cos(f.angle), s = Math.sin(f.angle), y = f.window?.y ?? 0;
  return { centre: [f.cutX * c - y * s, f.cutX * s + y * c], width: f.thickness ?? PEN, dir: [c, s] };
}

/** A trim as the face a bridge starts from, `at` added: the cut's own two
 *  outline points where known (a face the generator guessed can be far wider
 *  than a pen), else its stroke's thickness square across it. An exit's trim
 *  points out along the travel and an entry's in, so both put `a` on the
 *  same side (no twist). */
function trimFace(f: FaceCut, at: Pt, entry: boolean): CutFace {
  const g = trimGeometry(f), n: Pt = [g.dir[1], -g.dir[0]], h = g.width / 2;
  const tangent = entry ? f.angle + Math.PI : f.angle;
  if (f.ends) {
    const [p, q] = f.ends.map((e): Pt => [e[0] + at[0], e[1] + at[1]]);
    const side = (p[0] - q[0]) * n[0] + (p[1] - q[1]) * n[1];
    return side >= 0 ? { a: p, b: q, tangent } : { a: q, b: p, tangent };
  }
  const m: Pt = [g.centre[0] + at[0], g.centre[1] + at[1]];
  return { a: [m[0] + n[0] * h, m[1] + n[1] * h], b: [m[0] - n[0] * h, m[1] - n[1] * h], tangent };
}

/** Units: the tightest a bridge's edge may bend. Measured on the first
 *  target: a pinch on the inside of a turn (ha into a flat-entry ba,
 *  trimmed shallow) bent at 6, the tightest join that reads clean (ha into
 *  ya, an S) at 10.4. At 20 the trims were driven deep, into a junction. */
export const BRIDGE_RADIUS = 10;

/** The tightest bend, units, on either edge of the bridge from face A to
 *  face B, drawn as the outline draws it (stackOutline.ts, bow 0). */
export function bridgeRadius(A: CutFace, B: CutFace): number {
  const { edgeA, edgeB } = joinEdges(A, B, 0, joinFloor(A, B, NIB.minFraction));
  let r = Infinity;
  for (const e of [edgeA, edgeB]) for (let i = 1; i + 1 < e.length; i++) {
    const u: Pt = [e[i][0] - e[i - 1][0], e[i][1] - e[i - 1][1]], v: Pt = [e[i + 1][0] - e[i][0], e[i + 1][1] - e[i][1]];
    const lu = Math.hypot(u[0], u[1]), lv = Math.hypot(v[0], v[1]);
    if (lu < 1e-6 || lv < 1e-6) continue;
    const turn = Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / lu / lv)));
    if (turn > 1e-6) r = Math.min(r, (lu + lv) / 2 / turn);
  }
  return r;
}

/**
 * The trims for one meeting: the shallowest pair (`a` on the exit, `b` on
 * the entry, `offset` B's origin in A's frame) whose bridge runs forward
 * from both ends, has room to taper between the two thicknesses (it changes
 * by at most TAPER of its length), room to turn between the two directions
 * (an arc about as wide as the stroke), and bends neither edge tighter than
 * BRIDGE_RADIUS. Where no pair bends that gently, the shallowest that meets
 * the rest: trims driven deep to chase the bend read worse than the bend
 * (the lam into the ha). Failing that too, the pair that misses least.
 * `miss` is the shortfall on all of them (0 when met), `depth` the two
 * trims' depths summed. The user: the joints "connect at various angles",
 * so the bridge has to be fitted per meeting. Memoised per option lists and
 * offset: the composer asks again and again.
 */
const TAPER = 0.6;
export type TrimPick = { a: FaceCut; b: FaceCut; miss: number; depth: number };
const trimMemo = new WeakMap<readonly FaceCut[], WeakMap<readonly FaceCut[], Map<string, TrimPick>>>();
export function pickTrims(as: readonly FaceCut[], bs: readonly FaceCut[], offset: Pt): TrimPick {
  const key = `${offset[0].toFixed(3)},${offset[1].toFixed(3)}`;
  let byB = trimMemo.get(as);
  if (!byB) trimMemo.set(as, (byB = new WeakMap()));
  let byOff = byB.get(bs);
  if (!byOff) byB.set(bs, (byOff = new Map()));
  const hit = byOff.get(key);
  if (hit) return hit;
  let best: (TrimPick & { tier: number; room: number }) | null = null;
  for (const a of as) for (const b of bs) {
    const ga = trimGeometry(a), gb = trimGeometry(b);
    const v: Pt = [gb.centre[0] + offset[0] - ga.centre[0], gb.centre[1] + offset[1] - ga.centre[1]];
    const L = Math.hypot(v[0], v[1]) || 1e-9;
    const ahead = Math.min(v[0] * ga.dir[0] + v[1] * ga.dir[1], v[0] * gb.dir[0] + v[1] * gb.dir[1]) / L;
    const turn = Math.acos(Math.max(-1, Math.min(1, ga.dir[0] * gb.dir[0] + ga.dir[1] * gb.dir[1])));
    const room = Math.max(0, 0.3 - ahead) * 4
      + Math.max(0, Math.abs(ga.width - gb.width) - TAPER * L) / PEN
      + Math.max(0, (turn * (ga.width + gb.width)) / 2 - L) / PEN;
    const miss = room + Math.max(0, BRIDGE_RADIUS - bridgeRadius(trimFace(a, [0, 0], false), trimFace(b, offset, true))) / PEN;
    const depth = (a.depth ?? 0) + (b.depth ?? 0);
    // 0: meets all; 1: meets all but the bend; 2: neither
    const tier = miss === 0 ? 0 : room === 0 ? 1 : 2;
    if (!best || tier < best.tier || (tier === best.tier && (tier < 2 ? depth < best.depth : room < best.room))) best = { a, b, miss, depth, tier, room };
  }
  const pick: TrimPick = { a: best!.a, b: best!.b, miss: best!.miss, depth: best!.depth };
  byOff.set(key, pick);
  return pick;
}

/**
 * The entry face with its two points labelled to match the exit face's
 * across the bridge. A join pairs a with a and b with b; two cuts made on
 * different pieces may run in opposite senses, and then the bridge's two
 * edges cross (a twisted sliver). `at` is the entry piece's offset; both
 * pieces are unrotated, so a face's world points are its own plus the offset.
 */
function alignFace(prev: StackPiece, exitIndex: number, entry: StackPiece["faces"][number], at: Pt): StackPiece["faces"][number] {
  const ex = prev.faces[exitIndex];
  const ea: Pt = [ex.a[0] + prev.x, ex.a[1] + prev.y], eb: Pt = [ex.b[0] + prev.x, ex.b[1] + prev.y];
  const na: Pt = [entry.a[0] + at[0], entry.a[1] + at[1]], nb: Pt = [entry.b[0] + at[0], entry.b[1] + at[1]];
  const m1: Pt = [(ea[0] + eb[0]) / 2, (ea[1] + eb[1]) / 2], m2: Pt = [(na[0] + nb[0]) / 2, (na[1] + nb[1]) / 2];
  const t: Pt = [m2[0] - m1[0], m2[1] - m1[1]];
  const side = (p: Pt, m: Pt) => Math.sign(t[0] * (p[1] - m[1]) - t[1] * (p[0] - m[0]));
  return side(ea, m1) === side(na, m2) ? entry : { ...entry, a: entry.b, b: entry.a };
}

const shift = (p: StackPiece, d: Pt): StackPiece => ({ ...p, x: p.x + d[0], y: p.y + d[1], homeX: p.homeX + d[0], homeY: p.homeY + d[1] });

export function chainRun(lib: TarkibLibrary, run: PhraseRun, choice: RunChoice, idPrefix: string, orderStart: number): ChainedRun {
  let pieces: StackPiece[] = [], joins: StackJoin[] = [];
  const meets: ChainedRun["meets"] = [];
  let prevExit: { world: Pt; angle: number; pieceId: string; faceIndex?: number } | null = null;
  let baselineY: number | null = null;
  let letterAt = 0;
  const schemas = choice.schemaIds.map((sid) => { const s = lib.schema.get(sid); if (!s) throw new Error(`no piece ${sid}`); return s; });
  // Every meeting whose two ends can be trimmed is redrawn as a pen stroke;
  // the rest (an end no cut frees) still join by touch.
  const spliced = schemas.map((s, k) => k + 1 < schemas.length && !!s.exit?.face && !!schemas[k + 1].entry?.face);
  // Each spliced meeting's trims, fitted to where the two pieces will sit
  // (B's origin relative to A's, as placed below, before any stretch).
  const trims = schemas.map((s, k) => {
    if (!spliced[k]) return null;
    const n = schemas[k + 1], ex = s.exit!, en = n.entry!;
    const w = dir(ex.angle);
    let off: Pt = [ex.point[0] - w[0] * OVERLAP - en.point[0], ex.point[1] - w[1] * OVERLAP - en.point[1]];
    if (choice.climbs[k]) {
      const it = lib.items.get(n.itemId)!;
      off = [ex.point[0] + w[0] * JOIN_GAP - en.point[0], ex.point[1] + w[1] * JOIN_GAP - en.point[1] - it.h - PEN / 4];
    }
    return pickTrims(ex.options ?? [ex.face!], en.options ?? [en.face!], off);
  });
  choice.schemaIds.forEach((sid, k) => {
    const s = schemas[k];
    const letters = run.letters.slice(letterAt, letterAt + s.letters.length);
    const climbIn = k > 0 && choice.climbs[k - 1];
    const id = `${idPrefix}${k}`;
    const b = buildPiece(lib, sid, letters, id, orderStart + letterAt, { splice: { entry: k > 0 && spliced[k - 1] ? trims[k - 1]!.b : false, exit: spliced[k] ? trims[k]!.a : false } });
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
        // where the letters meet; both ends trimmed back, the pen stroke spans the gap
        if (spliced[k - 1]) {
          b.piece.faces[b.entry.faceIndex!] = alignFace(pieces.find((p) => p.id === prevExit!.pieceId)!, prevExit.faceIndex!, b.piece.faces[b.entry.faceIndex!], at);
          joins.push({ id: `j${prevExit.pieceId}-${id}`, from: { pieceId: prevExit.pieceId, faceIndex: prevExit.faceIndex! }, to: { pieceId: id, faceIndex: b.entry.faceIndex! }, bow: 0 });
        }
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
      const choice = defaultChoice(lib, r, wi === 0 && ri === 0);
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
