// Converting a shaped run into stack pieces and joins. Pure: the shaped run
// is passed in (never imports ./harfbuzz).
import type * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { DiacriticOverride, StackPiece, StackJoin, CutFace } from "../types";
import type { SvgCmd } from "./svgPath";
import type { FillerShape } from "./stackArrange";
import {
  type CutPlan, type CutZone, applyCutsToCommands, toSvgCmds, flattenContours, findCutZonesSwept,
  zoneExtentX, zoneCentre, DEFAULT_DETECT_OPTS, outlineBounds,
} from "./strokeCuts";
import { findKashidaSlots, TATWEEL } from "./tatweel";
import { splitAtCut, translateCmds, cmdsCentre, transformFace, transformPt, transformCmds } from "./stackGeometry";
import { rebasePiece, pieceTransform } from "./stackOutline";
import { traceCurve, PROFILE_SAMPLES, type CurveTrace } from "./stackCurve";
import { joinCenterline, solveJoinDrag, faceThickness } from "./stackJoin";
import { pointInPolygon } from "./svgPath";
import { findDetachedMarks, buildDetachedMarkPlan, splitContours, type DetachedMarkOverride } from "./detachedMarks";
import { findDiacriticGlyphIndices } from "./diacritics";

export type ConvertInput = {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  unitsPerEm: number;
  shapableText: string;
  cutPlan: CutPlan | null;
  diacriticOverrides: readonly DiacriticOverride[];
  /** Diacritic overrides are stored in px at this size. */
  fontSize: number;
  /** Moved dots and marks, font units; each becomes a rider piece. */
  detachedMarkOverrides: readonly DetachedMarkOverride[];
  /** For the detector's per-font opt-out list. */
  fontFamily: string;
};
export type UnjoinedPair = { earlierCl: number; laterCl: number };
export type ConvertResult = { pieces: StackPiece[]; joins: StackJoin[]; unjoined: UnjoinedPair[] };

type Pt2 = [number, number];

type Placed = {
  index: number; cl: number; ax: number;
  /** Pen position in run space (font units, y-down). */
  px: number; py: number;
  cmds: SvgCmd[];
  kind: "letter" | "tatweel" | "mark";
  /** A letter's own dots, hamza or kaf stroke, split out of `cmds`, with
   *  the user's offset in font units. */
  detached: { cmds: SvgCmd[]; dx: number; dy: number }[];
};

function placeGlyphs(input: ConvertInput): Placed[] {
  const { glyphs, font, unitsPerEm: upm, cutPlan, shapableText } = input;
  const diacritics = findDiacriticGlyphIndices(glyphs, font, shapableText);
  const detected = findDetachedMarks(glyphs, font, upm, diacritics, input.fontFamily);
  const plan = buildDetachedMarkPlan(input.detachedMarkOverrides, glyphs, detected);
  const out: Placed[] = [];
  let penX = 0;
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const ax = g.ax ?? 0;
    const obj = font.glyphs.get(g.g);
    if (obj) {
      const raw = toSvgCmds(obj.getPath(0, 0, upm).commands);
      const cl = g.cl ?? 0;
      const kind: Placed["kind"] =
        ax === 0 ? "mark" : shapableText[cl] === TATWEEL ? "tatweel" : "letter";
      // A letter's detached marks leave its commands before any cut, so the
      // join sweep runs on the body only; each becomes a rider piece.
      const detached: Placed["detached"] = [];
      let body = raw;
      if (kind === "letter") {
        const list = detected.get(i) ?? [];
        if (list.length) {
          const drop = new Set(list.map((m) => m.mark));
          body = splitContours(raw).flatMap((p, k) => (drop.has(k) ? [] : p));
          for (const m of list) {
            const off = plan.contours.get(i)?.get(m.mark);
            detached.push({ cmds: m.cmds, dx: off?.[0] ?? 0, dy: off?.[1] ?? 0 });
          }
        }
      }
      const cuts = cutPlan?.surgery.get(i);
      const cmds = cuts?.length ? applyCutsToCommands(body, cuts) : body;
      // A dot drawn as its own glyph (kind "mark") moves whole.
      const whole = plan.glyphs.get(i);
      out.push({
        index: i, cl, ax,
        px: penX + (g.dx ?? 0) + (cutPlan?.shift[i] ?? 0) + (whole?.[0] ?? 0),
        py: -(g.dy ?? 0) + (whole?.[1] ?? 0),
        cmds, kind, detached,
      });
    }
    penX += ax;
  }
  return out;
}

/** The run as one path in run space — what the text block draws. */
export function runOutline(input: ConvertInput): SvgCmd[] {
  const scale = input.unitsPerEm / input.fontSize;
  const out: SvgCmd[] = [];
  for (const p of placeGlyphs(input)) {
    const o = input.diacriticOverrides.find((d) => d.glyphIndex === p.index);
    if (o?.hidden) continue;
    out.push(...translateCmds(markAdjusted(p.cmds, o), p.px + (o?.offsetX ?? 0) * scale, p.py + (o?.offsetY ?? 0) * scale));
    for (const d of p.detached) out.push(...translateCmds(d.cmds, p.px + d.dx, p.py + d.dy));
  }
  return out;
}

/** A mark's `scale` override, applied about its own origin as ShapedText does. */
function markAdjusted(cmds: SvgCmd[], o: DiacriticOverride | undefined): SvgCmd[] {
  const s = o?.scale ?? 1;
  if (s === 1) return cmds;
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": return { ...c, x: c.x * s, y: c.y * s };
      case "Q": return { ...c, x: c.x * s, y: c.y * s, x1: c.x1 * s, y1: c.y1 * s };
      case "C": return { ...c, x: c.x * s, y: c.y * s, x1: c.x1 * s, y1: c.y1 * s, x2: c.x2 * s, y2: c.y2 * s };
      default: return c;
    }
  });
}

const detectOpts = (upm: number) => ({ ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 });

/** Zones overlapping a window round `x`, nearest first. */
function zonesNear(cmds: SvgCmd[], x: number, window: number, upm: number): CutZone[] {
  return findCutZonesSwept(flattenContours(cmds), { glyphIndex: 0, cluster: 0 }, detectOpts(upm))
    .filter((z) => { const [a, b] = zoneExtentX(z); return a <= x + window && b >= x - window; })
    .sort((p, q) => Math.abs(zoneCentre(p)[0] - x) - Math.abs(zoneCentre(q)[0] - x));
}

export function convertRunToStack(input: ConvertInput): ConvertResult {
  const { unitsPerEm: upm, shapableText } = input;
  const scale = upm / input.fontSize;
  const placed = placeGlyphs(input);

  // Letters, in text order.
  const letters = placed.filter((p) => p.kind === "letter").sort((a, b) => a.cl - b.cl);
  type Draft = { placed: Placed; cmds: SvgCmd[]; faces: CutFace[]; id: string; order: number };
  const drafts: Draft[] = letters.map((p, order) => ({ placed: p, cmds: [...p.cmds], faces: [], id: `p${p.index}`, order }));
  const ownerOf = (cl: number): Draft | undefined => {
    let best: Draft | null = null;
    for (const d of drafts) if (d.placed.cl <= cl && (!best || d.placed.cl > best.placed.cl)) best = d;
    return best ?? (drafts[0] as Draft | undefined);
  };

  // Tatweels ride with the letter before them in the text.
  for (const t of placed.filter((p) => p.kind === "tatweel")) {
    const o = ownerOf(t.cl - 1);
    if (!o) continue;
    o.cmds.push(...translateCmds(t.cmds, t.px - o.placed.px, t.py - o.placed.py));
  }

  // Joins: each adjacent letter pair the text actually joins.
  const slots = findKashidaSlots(shapableText);
  const joins: StackJoin[] = [];
  const unjoined: UnjoinedPair[] = [];
  const window = upm / 20;
  for (let k = 0; k + 1 < drafts.length; k++) {
    const E = drafts[k], L = drafts[k + 1];
    const joined = slots.some((s) => s.index > E.placed.cl && s.index <= L.placed.cl);
    if (!joined) continue;
    // The shared edge: the later (visually left) letter's right edge, in run space.
    const xShared = L.placed.px + L.placed.ax;
    const onE = zonesNear(E.cmds, xShared - E.placed.px, window, upm).map((z) => ({ z, host: E, other: L }));
    const onL = zonesNear(L.cmds, xShared - L.placed.px, window, upm).map((z) => ({ z, host: L, other: E }));
    const candidates = [...onE, ...onL].sort(
      (p, q) => Math.abs(zoneCentre(p.z)[0] + p.host.placed.px - xShared) - Math.abs(zoneCentre(q.z)[0] + q.host.placed.px - xShared)
    );
    let made = false;
    for (const { z, host } of candidates) {
      const split = splitAtCut(host.cmds, { cutX: (z.fromX + z.toX) / 2, angle: z.angle });
      if (!split) continue;
      // Near = x < cut in the stroke's frame = visually left = the later letter.
      const dx = host.placed.px - (host === E ? L : E).placed.px;
      const dy = host.placed.py - (host === E ? L : E).placed.py;
      if (host === E) {
        E.cmds = split.far;
        E.faces.push(split.farFace);
        L.cmds.push(...translateCmds(split.near, dx, dy));
        L.faces.push({ a: [split.nearFace.a[0] + dx, split.nearFace.a[1] + dy], b: [split.nearFace.b[0] + dx, split.nearFace.b[1] + dy], tangent: split.nearFace.tangent });
      } else {
        L.cmds = split.near;
        L.faces.push(split.nearFace);
        E.cmds.push(...translateCmds(split.far, dx, dy));
        E.faces.push({ a: [split.farFace.a[0] + dx, split.farFace.a[1] + dy], b: [split.farFace.b[0] + dx, split.farFace.b[1] + dy], tangent: split.farFace.tangent });
      }
      joins.push({ id: `j${E.id}-${L.id}`, from: { pieceId: E.id, faceIndex: E.faces.length - 1 }, to: { pieceId: L.id, faceIndex: L.faces.length - 1 }, bow: 0 });
      made = true;
      break;
    }
    if (!made) unjoined.push({ earlierCl: E.placed.cl, laterCl: L.placed.cl });
  }

  // Marks: separate pieces riding with the letter of their cluster.
  const markPieces: StackPiece[] = [];
  for (const m of placed.filter((p) => p.kind === "mark")) {
    const o = input.diacriticOverrides.find((d) => d.glyphIndex === m.index);
    if (o?.hidden) continue;
    const parent = ownerOf(m.cl);
    if (!parent) continue;
    const cmds = markAdjusted(m.cmds, o);
    markPieces.push({
      id: `m${m.index}`, cmds, x: m.px + (o?.offsetX ?? 0) * scale, y: m.py + (o?.offsetY ?? 0) * scale, rotation: 0,
      pivot: cmdsCentre(cmds), homeX: 0, homeY: 0, order: parent.order, role: "mark", parentId: parent.id, faces: [],
    });
  }

  // A letter's own dots, hamza or kaf stroke: rider pieces on the letter.
  for (const d of drafts) {
    d.placed.detached.forEach((m, k) => {
      markPieces.push({
        id: `d${d.placed.index}-${k}`, cmds: m.cmds, x: d.placed.px + m.dx, y: d.placed.py + m.dy, rotation: 0,
        pivot: cmdsCentre(m.cmds), homeX: 0, homeY: 0, order: d.order, role: "mark", parentId: d.id, faces: [],
      });
    });
  }

  const letterPieces: StackPiece[] = drafts.map((d) => ({
    id: d.id, cmds: d.cmds, x: d.placed.px, y: d.placed.py, rotation: 0, pivot: cmdsCentre(d.cmds),
    homeX: 0, homeY: 0, order: d.order, role: "letter", faces: d.faces,
  }));

  // Centre the composition on the run's ink so the block does not jump.
  const all = [...letterPieces, ...markPieces];
  if (all.length === 0) return { pieces: [], joins, unjoined };
  const b = outlineBounds(all.flatMap((p) => translateCmds(p.cmds, p.x, p.y)));
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  const pieces = all.map((p) => ({ ...p, x: p.x - cx, y: p.y - cy, homeX: p.x - cx, homeY: p.y - cy }));
  return { pieces, joins, unjoined };
}

/** Cut a piece's stroke. The fragment with the smaller bounds is the end cap:
 *  it becomes its own letter piece riding on the body (`parentId`, same
 *  order) and is joined to it. The body keeps the original id whichever side
 *  of the cut it is on, so existing joins on the body stay valid; faces and
 *  join references follow whichever fragment now holds them. */
export function splitPieceAtCut(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], pieceId: string, cut: { cutX: number; angle: number }
): { pieces: StackPiece[]; joins: StackJoin[] } | null {
  const p = pieces.find((x) => x.id === pieceId);
  if (!p || p.role !== "letter") return null;
  const split = splitAtCut(p.cmds, cut);
  if (!split) return null;
  const boundsArea = (cmds: SvgCmd[]) => { const b = outlineBounds(cmds); return (b.x2 - b.x1) * (b.y2 - b.y1); };
  const capIsNear = boundsArea(split.near) <= boundsArea(split.far);
  const bodyCmds = capIsNear ? split.far : split.near;
  const capCmds = capIsNear ? split.near : split.far;
  const bodyNewFace = capIsNear ? split.farFace : split.nearFace;
  const capNewFace = capIsNear ? split.nearFace : split.farFace;

  // One past the highest cap number ever given to this piece, so a deleted
  // cap (a freed curve drops its arc) never has its id handed out again.
  const n = 1 + pieces.reduce((m, x) => {
    const match = new RegExp(`^${p.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}t(\\d+)`).exec(x.id);
    return match ? Math.max(m, Number(match[1])) : m;
  }, 0);
  const capId = `${p.id}t${n}`;

  // Which fragment holds an existing face: the one whose outline carries its
  // points. (The old test — which side of the infinite cut line the face's
  // midpoint lies on — put a face on the far arm of a U with the wrong
  // fragment once cuts became windowed segments.)
  const carries = (cmds: SvgCmd[], f: CutFace) => {
    const pts = flattenContours(cmds).flat();
    const on = (q: Pt2) => pts.some((v) => Math.abs(v[0] - q[0]) < 1e-6 && Math.abs(v[1] - q[1]) < 1e-6);
    return on(f.a) && on(f.b);
  };
  const c = Math.cos(-cut.angle), sn = Math.sin(-cut.angle);
  const isNearSide = (f: CutFace) => {
    const mx = (f.a[0] + f.b[0]) / 2, my = (f.a[1] + f.b[1]) / 2;
    return mx * c - my * sn < cut.cutX;
  };
  const bodyIdxs: number[] = [], capIdxs: number[] = [];
  p.faces.forEach((f, i) => {
    const onCap = carries(capCmds, f) ? true : carries(bodyCmds, f) ? false : isNearSide(f) === capIsNear;
    (onCap ? capIdxs : bodyIdxs).push(i);
  });

  const body: StackPiece = { ...rebasePiece(p, bodyCmds), faces: [...bodyIdxs.map((i) => p.faces[i]), bodyNewFace] };
  const cap: StackPiece = {
    ...rebasePiece({ ...p, id: capId }, capCmds),
    role: "letter", parentId: p.id, order: p.order,
    faces: [...capIdxs.map((i) => p.faces[i]), capNewFace],
  };
  const remap = (ref: { pieceId: string; faceIndex: number }) =>
    ref.pieceId !== p.id ? ref
      : capIdxs.includes(ref.faceIndex) ? { pieceId: capId, faceIndex: capIdxs.indexOf(ref.faceIndex) }
      : { pieceId: p.id, faceIndex: bodyIdxs.indexOf(ref.faceIndex) };
  const newJoins: StackJoin[] = [
    ...joins.map((j) => ({ ...j, from: remap(j.from), to: remap(j.to) })),
    { id: `j${p.id}-${capId}`, from: { pieceId: p.id, faceIndex: body.faces.length - 1 }, to: { pieceId: capId, faceIndex: cap.faces.length - 1 }, bow: 0 },
  ];
  return { pieces: pieces.map((x) => (x.id === p.id ? body : x)).concat(cap), joins: newJoins };
}

/** The marks offered as gap fillers, in the rotation the arranger cycles through. */
export const FILLER_MARKS: readonly { name: string; cp: number }[] = [
  { name: "fatha", cp: 0x064e }, { name: "kasra", cp: 0x0650 }, { name: "shadda", cp: 0x0651 },
  { name: "damma", cp: 0x064f }, { name: "sukun", cp: 0x0652 }, { name: "fathatan", cp: 0x064b },
  { name: "dammatan", cp: 0x064c }, { name: "kasratan", cp: 0x064d }, { name: "star", cp: 0x066d },
  { name: "dot", cp: 0x06ec },
];

/** A pen-drawn teardrop the nib's width across: a circle with a short tail
 *  rising to the upper right. The filler for fonts without tashkeel. */
export function teardropShape(nibWidth: number): FillerShape {
  const r = Math.max(nibWidth, 1) / 2;
  const k = 0.5523 * r;
  const cmds: SvgCmd[] = [
    { type: "M", x: r, y: 0 },
    { type: "C", x1: r, y1: k, x2: k, y2: r, x: 0, y: r },
    { type: "C", x1: -k, y1: r, x2: -r, y2: k, x: -r, y: 0 },
    { type: "C", x1: -r, y1: -k, x2: -k, y2: -r, x: 0, y: -r },
    { type: "C", x1: k, y1: -r, x2: 1.6 * r, y2: -1.6 * r, x: 1.8 * r, y: -2 * r },
    { type: "C", x1: 1.6 * r, y1: -1.2 * r, x2: r, y2: -0.6 * r, x: r, y: 0 },
    { type: "Z" },
  ];
  return { name: "teardrop", cmds };
}

/** The filler outlines a font offers: each of `FILLER_MARKS` the font
 *  actually draws (a real glyph with commands), plus the teardrop when fewer
 *  than two survive (Qahiri and RanaKufi carry only hamza-above). */
export function fillerShapes(font: opentype.Font, upm: number, nibWidth: number): FillerShape[] {
  const out: FillerShape[] = [];
  for (const m of FILLER_MARKS) {
    const g = font.charToGlyph(String.fromCodePoint(m.cp));
    if (!g || g.index === 0) continue;
    const cmds = toSvgCmds(g.getPath(0, 0, upm).commands);
    if (cmds.length < 3) continue;
    out.push({ name: m.name, cmds });
  }
  if (out.length < 2) out.push(teardropShape(nibWidth));
  return out;
}

/** Which of `pieces` holds the world point `p` in its ink (odd contour count: counters are holes). */
function pieceAt(pieces: readonly StackPiece[], p: Pt2): StackPiece | undefined {
  return pieces.find((q) => {
    let n = 0;
    for (const c of flattenContours(transformCmds(q.cmds, pieceTransform(q)))) if (pointInPolygon(p[0], p[1], c)) n++;
    return n % 2 === 1;
  });
}

/**
 * Swap two pieces' *ids* and the join refs that name them — never their
 * `parentId`s. The letter's riders point at the body's id and must keep
 * doing so whichever fragment now carries it; the fragment that takes the
 * body's id becomes the body (rides on nothing, keeps the letter's order).
 */
function swapIds(pieces: StackPiece[], joins: StackJoin[], bodyId: string, other: string, order: number): { pieces: StackPiece[]; joins: StackJoin[] } {
  const sw = (id: string) => (id === bodyId ? other : id === other ? bodyId : id);
  return {
    pieces: pieces.map((p) => {
      if (p.id === other) return { ...p, id: bodyId, parentId: undefined, role: "letter" as const, order };
      if (p.id === bodyId) return { ...p, id: other };
      return p;
    }),
    joins: joins.map((j) => ({ ...j, from: { ...j.from, pieceId: sw(j.from.pieceId) }, to: { ...j.to, pieceId: sw(j.to.pieceId) } })),
  };
}

const boxArea = (cmds: SvgCmd[]) => { const b = outlineBounds(cmds); return (b.x2 - b.x1) * (b.y2 - b.y1); };

/**
 * Free the curved stroke under `press` (piece-local) and replace it with a
 * join. Two cuts with `splitPieceAtCut`; the fragment holding the trace's
 * middle is the arc and is dropped (with the joins the splits made to it);
 * the far fragment rides on the body as a pulled tail does; one join from
 * the body's new face to the far's, its bend solved so the cubic's midpoint
 * lands on the traced midpoint (`rest`), its width the trace's own
 * (`profile`). The body keeps the piece's id — swapped off the arc when the
 * arc is the largest fragment — so joins to neighbours survive. Null when
 * nothing under the press is a curve or a cut will not split cleanly.
 */
export function bendCurveAt(
  pieces: readonly StackPiece[], joins: readonly StackJoin[], pieceId: string, pressOrTrace: Pt2 | CurveTrace
): { pieces: StackPiece[]; joins: StackJoin[]; joinId: string } | null {
  const piece = pieces.find((p) => p.id === pieceId);
  if (!piece || piece.role !== "letter") return null;
  // The hover already traced the curve the press lands on; a bare press traces afresh.
  const trace = Array.isArray(pressOrTrace) ? traceCurve(piece.cmds, pressOrTrace, { faces: piece.faces }) : pressOrTrace;
  if (!trace) return null;
  const T = pieceTransform(piece);
  const n = trace.centre.length;
  const midW = transformPt(trace.centre[Math.floor(n / 2)], T);
  const endW = transformPt(trace.centre[n - 1], T);

  // First cut: the body keeps the id, the far side is a cap riding on it.
  const r1 = splitPieceAtCut(pieces, joins, pieceId, trace.cuts[0]);
  if (!r1) return null;
  const cap1 = r1.pieces[r1.pieces.length - 1];
  // Second cut on whichever fragment holds the trace's far end.
  const holder = pieceAt([r1.pieces.find((p) => p.id === pieceId)!, cap1], endW);
  if (!holder) return null;
  const r2 = splitPieceAtCut(r1.pieces, r1.joins, holder.id, trace.cuts[1]);
  if (!r2) return null;
  const cap2 = r2.pieces[r2.pieces.length - 1];
  const fragments = [r2.pieces.find((p) => p.id === pieceId)!, r2.pieces.find((p) => p.id === cap1.id)!, cap2];
  // The arc is the fragment holding the trace's middle.
  const arc = pieceAt(fragments, midW);
  if (!arc) return null;
  let ps = r2.pieces, js = r2.joins;
  let arcId = arc.id;
  // The body id must not sit on the arc: give it to the largest other fragment.
  if (arc.id === pieceId) {
    const others = fragments.filter((p) => p.id !== arc.id);
    const biggest = others.reduce((a, b) => (boxArea(b.cmds) > boxArea(a.cmds) ? b : a));
    ({ pieces: ps, joins: js } = swapIds(ps, js, arc.id, biggest.id, piece.order));
    arcId = biggest.id;   // the arc now carries the fragment's old id
  }
  // The joins the two splits made to the arc name the faces to join; they go with it.
  const toArc = js.filter((j) => j.from.pieceId === arcId || j.to.pieceId === arcId);
  if (toArc.length !== 2) return null;
  const endRefs = toArc.map((j) => (j.from.pieceId === arcId ? j.to : j.from));
  js = js.filter((j) => !toArc.includes(j));
  // Whatever rode on the arc (the far fragment, a cap cut from it) now rides on the body.
  ps = ps.filter((p) => p.id !== arcId).map((p) => (p.parentId === arcId ? { ...p, parentId: pieceId } : p));
  const bodyRef = endRefs.find((r) => r.pieceId === pieceId) ?? endRefs[0];
  const farRef = endRefs.find((r) => r !== bodyRef)!;
  // The far fragment rides on the body, whatever the splits made it ride on.
  ps = ps.map((p) => (p.id === farRef.pieceId ? { ...p, parentId: pieceId, role: "letter" as const, order: piece.order } : p));
  const body = ps.find((p) => p.id === pieceId)!;
  let far = ps.find((p) => p.id === farRef.pieceId)!;
  const A = transformFace(body.faces[bodyRef.faceIndex], pieceTransform(body));
  let B = transformFace(far.faces[farRef.faceIndex], pieceTransform(far));
  // The two faces come from two different cuts, so their point orders are
  // independent; a join's ribbon runs a→a and b→b, and faces that disagree
  // about which point is on the left of travel twist it into a figure-eight
  // that cancels its own ink. Orient the far face to the body's.
  const leftOf = (f: CutFace, dir: Pt2) => Math.sign(dir[0] * (f.a[1] - (f.a[1] + f.b[1]) / 2) - dir[1] * (f.a[0] - (f.a[0] + f.b[0]) / 2));
  const travelA: Pt2 = [Math.cos(A.tangent), Math.sin(A.tangent)];
  const travelB: Pt2 = [-Math.cos(B.tangent), -Math.sin(B.tangent)];   // arriving at B
  if (leftOf(A, travelA) !== leftOf(B, travelB)) {
    const f = far.faces[farRef.faceIndex];
    const swapped: CutFace = { a: f.b, b: f.a, tangent: f.tangent };
    far = { ...far, faces: far.faces.map((x, i) => (i === farRef.faceIndex ? swapped : x)) };
    ps = ps.map((p) => (p.id === far.id ? far : p));
    B = transformFace(swapped, pieceTransform(far));
  }
  // Fit the bend: three Gauss–Newton steps of the drag solver toward the traced midpoint.
  const chord = Math.hypot(B.a[0] + B.b[0] - A.a[0] - A.b[0], B.a[1] + B.b[1] - A.a[1] - A.b[1]) / 2;
  let bend = { bow: 0, depth: 0 };
  for (let k = 0; k < 3; k++) {
    const cl = joinCenterline(A, B, bend.bow, bend.depth);
    const m: Pt2 = [
      0.125 * cl[0][0] + 0.375 * cl[1][0] + 0.375 * cl[2][0] + 0.125 * cl[3][0],
      0.125 * cl[0][1] + 0.375 * cl[1][1] + 0.375 * cl[2][1] + 0.125 * cl[3][1],
    ];
    bend = solveJoinDrag(bend, A.tangent, B.tangent, chord, [midW[0] - m[0], midW[1] - m[1]]);
  }
  // The width profile: the traced thickness between the two cuts over the
  // faces' interpolated thickness; `joinEdges` draws profile × that width
  // square across the travel. The join runs from the body's face to the
  // far's; the trace runs i0→i1, and when the body sits at the trace's far
  // end the profile reads backwards.
  const tA = faceThickness(A), tB = faceThickness(B);
  const [i0, i1] = trace.cutIndex;
  const Am: Pt2 = [(A.a[0] + A.b[0]) / 2, (A.a[1] + A.b[1]) / 2];
  const start0 = transformPt(trace.centre[i0], T), start1 = transformPt(trace.centre[i1], T);
  const reversed = Math.hypot(Am[0] - start1[0], Am[1] - start1[1]) < Math.hypot(Am[0] - start0[0], Am[1] - start0[1]);
  const cum: number[] = [0];
  for (let i = i0 + 1; i <= i1; i++) cum.push(cum[cum.length - 1] + Math.hypot(trace.centre[i][0] - trace.centre[i - 1][0], trace.centre[i][1] - trace.centre[i - 1][1]));
  const total = cum[cum.length - 1] || 1;
  const profile = Array.from({ length: PROFILE_SAMPLES }, (_, k) => {
    if (k === 0 || k === PROFILE_SAMPLES - 1) return 1;
    const t = k / (PROFILE_SAMPLES - 1), d = (reversed ? 1 - t : t) * total;
    let s = 1; while (s < cum.length - 1 && cum[s] < d) s++;
    const f = cum[s] === cum[s - 1] ? 0 : (d - cum[s - 1]) / (cum[s] - cum[s - 1]);
    const th = trace.thickness[i0 + s - 1] * (1 - f) + trace.thickness[i0 + s] * f;
    const lin = tA * (1 - t) + tB * t;
    return lin > 1e-6 ? Math.max(0.2, Math.min(4, th / lin)) : 1;
  });
  const joinId = `j${pieceId}-${far.id}c`;
  js = [...js, {
    id: joinId, from: { pieceId, faceIndex: bodyRef.faceIndex }, to: { pieceId: far.id, faceIndex: farRef.faceIndex },
    bow: bend.bow, depth: bend.depth, rest: { ...bend }, profile,
  }];
  return { pieces: ps, joins: js, joinId };
}
