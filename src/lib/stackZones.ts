/**
 * Where on a stack piece a tail can be pulled from, and how a press there
 * becomes a cut. Pure; nothing here may import `./harfbuzz`.
 *
 * A `CutZone` is expressed in a frame rotated by its own `angle`: the frame
 * `rotateCmds(cmds, -angle)` produced, the one `splitAtCut` cuts in. A point
 * goes into that frame by x′ = x·cos a + y·sin a (the same projection
 * `splitPieceAtCut` uses to decide which side a face is on).
 */
import { DEFAULT_DETECT_OPTS, flattenContours, type CutZone, type DetectOpts, type Pt } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";
import type { PieceTransform } from "./stackGeometry";

/** The detector options every stack consumer uses: the stack's resolution,
 *  both stroke directions (so an alif's stem is found), and an aspect floor
 *  so a sweep never offers a cut across a stroke. */
export function stackDetectOpts(upm: number): DetectOpts {
  return { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40, baseAngles: [0, Math.PI / 2], minAspect: 1 };
}

/** Share of a zone, from its free end, that pulls a tail. The rest moves the letter. */
export const PULL_FRACTION = 0.4;
/** The pull span is never shorter than this many stroke thicknesses. */
export const PULL_MIN_THICKNESSES = 2;

export function toZoneFrame(p: Pt, angle: number): Pt {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0] * c + p[1] * s, -p[0] * s + p[1] * c];
}

export function fromZoneFrame(p: Pt, angle: number): Pt {
  const c = Math.cos(angle), s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/** Piece-local point from a world (block font-unit) point: the inverse of `transformPt`. */
export function invertTransform(w: Pt, t: PieceTransform): Pt {
  const c = Math.cos(-t.rotation), s = Math.sin(-t.rotation);
  const dx = w[0] - t.pivot[0] - t.x, dy = w[1] - t.pivot[1] - t.y;
  return [dx * c - dy * s + t.pivot[0], dx * s + dy * c + t.pivot[1]];
}

/** The stroke's rectangle between `from` and `to` along the zone, piece-local. */
export function zoneRect(z: CutZone, from: number, to: number): Pt[] {
  const h = z.thickness / 2;
  return [
    [from, z.centreY - h], [to, z.centreY - h], [to, z.centreY + h], [from, z.centreY + h],
  ].map((p) => fromZoneFrame(p as Pt, z.angle));
}

/**
 * The stretches of a zone, in its frame, where a press pulls a tail: the
 * outer part of each end. The middle of a long stroke moves the letter — on
 * a lam the stem is most of the ink, and "press on the stroke" has to mean
 * one thing. An end beside a join is offered too: pulling there draws the
 * connecting stroke out into a sweep, which on a font whose only straight
 * runs are the connector stubs is the only tail there is.
 */
export function pullSpans(z: CutZone): [number, number][] {
  const L = z.toX - z.fromX;
  if (L <= 0) return [];
  const len = Math.min(L / 2, Math.max(PULL_FRACTION * L, PULL_MIN_THICKNESSES * z.thickness));
  if (len >= L / 2) return [[z.fromX, z.toX]];
  return [[z.fromX, z.fromX + len], [z.toX - len, z.toX]];
}

/** The cut a press at `local` (piece-local) makes in zone `z`: the press's
 *  x in the zone's frame, kept a little inside the zone so the cut line is
 *  never marginal. */
export function cutAtPress(z: CutZone, local: Pt): { cutX: number; angle: number } {
  return { cutX: clampCutX(z, toZoneFrame(local, z.angle)[0]), angle: z.angle };
}

/** `x` (zone frame) kept a little inside the zone. */
export function clampCutX(z: CutZone, x: number): number {
  const m = Math.min(z.thickness / 4, (z.toX - z.fromX) / 10);
  return Math.min(z.toX - m, Math.max(z.fromX + m, x));
}

/** The cut x values a span is checked at before it is offered: both ends
 *  (clamped) and the middle. A zone's legality is a stroke-cut notion (an
 *  even number of crossings); splitting a piece needs exactly one contour
 *  crossed exactly twice, which a cut through a counter is not. */
export function spanProbes(z: CutZone, span: [number, number]): number[] {
  return [clampCutX(z, span[0]), (span[0] + span[1]) / 2, clampCutX(z, span[1])];
}

/**
 * A mark's own stroke: its long axis, from the outline's second moments.
 * A fatha or kasra is one tapered pen stroke, widest in the middle, so the
 * stroke detector (which wants parallel edges) finds nothing on it in most
 * fonts; the axis is the direction the pen travelled instead. In the axis
 * frame (`toZoneFrame`) the ink spans `from`..`to` along x, `centre` is the
 * x of the ink's centroid — where a stretch cuts, across the widest part —
 * and `width` is the ink's extent across. Null when the ink is not clearly
 * longer than it is wide (a dot, a damma's loop, a sukun's ring).
 */
export type MarkAxis = { angle: number; from: number; to: number; centre: number; centreY: number; width: number };

/** Length over width a mark needs before it reads as a stroke to stretch.
 *  Measured over the 19 bundled faces that draw tashkeel: fatha and kasra
 *  run 4.0 (Yekan) to 13 (Thuluth); damma tops out at 3.4 (AlFatemi), and
 *  shadda, sukun, dots and the kaf stroke stay at 2.6 or under. */
export const MARK_MIN_ASPECT = 3.7;
/** Share of a mark's length, round its centre, that moves it rather than pulls. */
export const MARK_MOVE_FRACTION = 0.4;

/** The aspect a kaf's stroke needs instead: it is a short wedge, 1.5 to 2.0
 *  long over wide in the bundled faces, and is only ever tested on a piece
 *  conversion flagged as one (`StackPiece.markKind`), never on a dot. */
export const KAF_STROKE_MIN_ASPECT = 1.3;

export function markStrokeAxis(cmds: SvgCmd[], minAspect = MARK_MIN_ASPECT): MarkAxis | null {
  const contours = flattenContours(cmds);
  // Area-weighted centroid and second moments; signed areas let a counter subtract.
  let A = 0, cx = 0, cy = 0, sxx = 0, syy = 0, sxy = 0;
  for (const c of contours) {
    for (let i = 0; i < c.length; i++) {
      const [x0, y0] = c[i], [x1, y1] = c[(i + 1) % c.length];
      const k = x0 * y1 - x1 * y0;
      A += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
      sxx += (x0 * x0 + x0 * x1 + x1 * x1) * k;
      syy += (y0 * y0 + y0 * y1 + y1 * y1) * k;
      sxy += (x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * k;
    }
  }
  if (Math.abs(A) < 1e-9) return null;
  A /= 2; cx /= 6 * A; cy /= 6 * A;
  const ixx = sxx / (12 * A) - cx * cx, iyy = syy / (12 * A) - cy * cy, ixy = sxy / (24 * A) - cx * cy;
  const angle = 0.5 * Math.atan2(2 * ixy, ixx - iyy);
  let from = Infinity, to = -Infinity, lo = Infinity, hi = -Infinity;
  for (const c of contours) for (const p of c) {
    const [u, v] = toZoneFrame(p, angle);
    from = Math.min(from, u); to = Math.max(to, u); lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  const width = hi - lo;
  if (!(width > 0) || (to - from) / width < minAspect) return null;
  return { angle, from, to, centre: toZoneFrame([cx, cy], angle)[0], centreY: (lo + hi) / 2, width };
}

/** The two ends of a mark a press pulls, each with the side of the centre
 *  cut it takes away: `near` is x < centre in the axis frame. */
export function markPullSpans(a: MarkAxis): { span: [number, number]; side: "near" | "far" }[] {
  const m = (MARK_MOVE_FRACTION / 2) * (a.to - a.from);
  const ends: { span: [number, number]; side: "near" | "far" }[] = [
    { span: [a.from, a.centre - m], side: "near" },
    { span: [a.centre + m, a.to], side: "far" },
  ];
  return ends.filter((s) => s.span[1] > s.span[0]);
}

/**
 * A damma's tail: where its neck is and which way the tail runs. A damma is
 * a loop with a tail, 1.5 to 3.4 long over wide, so it never passes the
 * fatha gate, and a cut across its centroid lands in the loop. Along the long
 * axis the loop is the wide end (and, where the font draws one, holds the
 * counter); walking from it toward the narrow end, the neck is the first
 * sample past the counter where the ink is under `TAIL_NECK_FRACTION` of its
 * widest. Null when there is no clear neck, or the tail past it is under a
 * quarter of the length. `side` is the tail's side of the cut, for
 * `splitPieceAtCut`'s `capSide`; `span` is the part a press pulls.
 */
export type MarkTail = { angle: number; cut: number; side: "near" | "far"; span: [number, number]; centreY: number; width: number };
export const TAIL_NECK_FRACTION = 0.7;
export const TAIL_MIN_SHARE = 0.12;
export const TAIL_MAX_SHARE = 0.6;

export function markTail(cmds: SvgCmd[]): MarkTail | null {
  const axis = markStrokeAxis(cmds, 1);
  if (!axis) return null;
  const { angle, from, to } = axis;
  const contours = flattenContours(cmds).map((c) => c.map((q) => toZoneFrame(q, angle)));
  const N = 48;
  const samples: { u: number; lo: number; hi: number; crossings: number }[] = [];
  for (let i = 1; i < N; i++) {
    const u = from + ((to - from) * i) / N;
    let lo = Infinity, hi = -Infinity, crossings = 0;
    for (const c of contours) {
      for (let k = 0; k < c.length; k++) {
        const [x0, y0] = c[k], [x1, y1] = c[(k + 1) % c.length];
        if ((x0 < u) === (x1 < u)) continue;
        const v = y0 + ((u - x0) / (x1 - x0)) * (y1 - y0);
        lo = Math.min(lo, v); hi = Math.max(hi, v); crossings++;
      }
    }
    samples.push({ u, lo, hi, crossings });
  }
  const width = (s: (typeof samples)[number]) => (s.crossings ? s.hi - s.lo : 0);
  const half = samples.length / 2;
  const mean = (xs: typeof samples) => xs.reduce((t, s) => t + width(s), 0) / Math.max(xs.length, 1);
  // The loop is the wider half; the tail runs the other way.
  const headAtFrom = mean(samples.slice(0, half)) >= mean(samples.slice(half));
  const walk = headAtFrom ? samples : [...samples].reverse();
  const widest = Math.max(...samples.map(width));
  // Past the last sample that crosses a counter (more than two crossings).
  let start = 0;
  walk.forEach((s, i) => { if (s.crossings > 2) start = i + 1; });
  const neckAt = walk.findIndex((s, i) => i >= start && s.crossings === 2 && width(s) < TAIL_NECK_FRACTION * widest);
  if (neckAt < 0) return null;
  const cut = walk[neckAt].u;
  const end = headAtFrom ? to : from;
  if (Math.abs(end - cut) < 0.25 * (to - from)) return null;
  // The tail must be a real share of the ink. Measured on the bundled faces:
  // a true damma tail is 20 to 45%; Yekan's walk lands in the loop (most of
  // the ink) and Blaka's, Rabat's and Rana Kufi's shave a corner (a sliver).
  const total = samples.reduce((t, x) => t + width(x), 0);
  const tail = walk.slice(neckAt).reduce((t, x) => t + width(x), 0);
  const share = total > 0 ? tail / total : 0;
  if (share < TAIL_MIN_SHARE || share > TAIL_MAX_SHARE) return null;
  const s = walk[neckAt];
  return {
    angle, cut, side: headAtFrom ? "far" : "near",
    span: headAtFrom ? [cut, to] : [from, cut],
    centreY: (s.lo + s.hi) / 2, width: Math.max(s.hi - s.lo, 1),
  };
}

/**
 * How one mark piece is cut and pulled, or null when it is not a stroke to
 * stretch. One rule per kind: a damma by its tail (`markTail`, cut at the
 * neck, only the tail pulls); a kaf's stroke and every other mark by the
 * long axis (`markStrokeAxis`, cut at the centroid, either end pulls), the
 * kaf's at its own lower aspect. The cut is checked with `splitAtCut` (passed
 * in, so this module keeps no runtime geometry import), so a plan that
 * comes back always splits. The zone is in the cut's frame, for drawing the
 * press spans.
 */
export type MarkCutPlan = {
  zone: CutZone;
  cut: { cutX: number; angle: number };
  ends: { span: [number, number]; side: "near" | "far" }[];
};

export function markCutPlan(
  cmds: SvgCmd[], kind: "kafStroke" | "damma" | undefined, splits: (cmds: SvgCmd[], cut: { cutX: number; angle: number }) => boolean
): MarkCutPlan | null {
  if (kind === "damma") {
    const t = markTail(cmds);
    if (!t) return null;
    const cut = { cutX: t.cut, angle: t.angle };
    if (!splits(cmds, cut)) return null;
    const [from, to] = t.span;
    return {
      zone: { fromX: from, toX: to, centreY: t.centreY, thickness: t.width, angle: t.angle } as CutZone,
      cut, ends: [{ span: t.span, side: t.side }],
    };
  }
  const a = markStrokeAxis(cmds, kind === "kafStroke" ? KAF_STROKE_MIN_ASPECT : MARK_MIN_ASPECT);
  if (!a) return null;
  const cut = { cutX: a.centre, angle: a.angle };
  if (!splits(cmds, cut)) return null;
  return {
    zone: { fromX: a.from, toX: a.to, centreY: a.centreY, thickness: a.width, angle: a.angle } as CutZone,
    cut, ends: markPullSpans(a),
  };
}
