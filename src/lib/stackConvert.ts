// Converting a shaped run into stack pieces and joins. Pure: the shaped run
// is passed in (never imports ./harfbuzz).
import type * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import type { DiacriticOverride, StackPiece, StackJoin, CutFace } from "../types";
import type { SvgCmd } from "./svgPath";
import {
  type CutPlan, type CutZone, applyCutsToCommands, toSvgCmds, flattenContours, findCutZonesSwept,
  zoneExtentX, zoneCentre, DEFAULT_DETECT_OPTS, outlineBounds,
} from "./strokeCuts";
import { findKashidaSlots, TATWEEL } from "./tatweel";
import { splitAtCut, translateCmds, cmdsCentre } from "./stackGeometry";
import { rebasePiece } from "./stackOutline";
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

  const n = 1 + pieces.filter((x) => x.id.startsWith(`${p.id}t`)).length;
  const capId = `${p.id}t${n}`;

  // Which fragment holds an existing face: decided by its midpoint in the cut's frame.
  const c = Math.cos(-cut.angle), sn = Math.sin(-cut.angle);
  const isNearSide = (f: CutFace) => {
    const mx = (f.a[0] + f.b[0]) / 2, my = (f.a[1] + f.b[1]) / 2;
    return mx * c - my * sn < cut.cutX;
  };
  const bodyIdxs: number[] = [], capIdxs: number[] = [];
  p.faces.forEach((f, i) => (isNearSide(f) === capIsNear ? capIdxs : bodyIdxs).push(i));

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
