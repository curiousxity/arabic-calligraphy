/**
 * Where on a stack piece a tail can be pulled from, and how a press there
 * becomes a cut. Pure; nothing here may import `./harfbuzz`.
 *
 * A `CutZone` is expressed in a frame rotated by its own `angle`: the frame
 * `rotateCmds(cmds, -angle)` produced, the one `splitAtCut` cuts in. A point
 * goes into that frame by x′ = x·cos a + y·sin a (the same projection
 * `splitPieceAtCut` uses to decide which side a face is on).
 */
import { DEFAULT_DETECT_OPTS, type CutZone, type DetectOpts, type Pt } from "./strokeCuts";
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
