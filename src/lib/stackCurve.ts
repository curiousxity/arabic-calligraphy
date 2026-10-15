// Tracing a curved stroke through its outline: centerline, thickness and
// the two perpendicular cuts that free the arc. Pure — no React, no Konva,
// no ./harfbuzz. Font units throughout.
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { flattenContours, type Contour, type Pt } from "./strokeCuts";
import { splitAtCut } from "./stackGeometry";
import type { CutFace } from "../types";

/** Walk step as a fraction of the seed thickness. */
const STEP_FRACTION = 0.25;
/** The trace stops where thickness leaves [min, max] × seed, or jumps by
 *  more than THICK_JUMP between steps. The window is wide because a Diwani
 *  stroke swells to three times its thin end along one bowl (UKIJ Diwani ن:
 *  63–223 units); a junction is caught by the per-step jump, not the window. */
const THICK_MIN_RATIO = 0.35;
const THICK_MAX_RATIO = 3.0;
const THICK_JUMP = 0.4;
/** A step turning less than this is "straight". */
const TURN_EPS = 0.02;
/** Sustained turning against the curve's sense that counts as an inflection. */
const INFLECTION_TURN = 0.12;
/** A trace must turn at least this much to be a curve. */
export const MIN_TURN = Math.PI / 4;
/** …and be at least this many thicknesses long. */
export const MIN_LENGTH_THICK = 1.5;
/** Furthest a walk goes in each direction, in em. */
const MAX_LENGTH_EM = 3;
/** Width samples a converted curve carries along its join. */
export const PROFILE_SAMPLES = 16;
const EPS = 1e-6;

/** A cut in `splitAtCut`'s terms, bounded to a window about the stroke's
 *  centre so the line's far crossings (a U's other arm) are ignored. */
export type TraceCut = { cutX: number; angle: number; window: { y: number; half: number } };
export type CurveTrace = {
  /** Centerline samples in stroke order, piece-local font units. */
  centre: Pt[];
  thickness: number[];
  /** Unit direction of travel at each sample. */
  tangent: Pt[];
  /** The two cuts that free the arc, in `splitAtCut`'s terms. */
  cuts: [TraceCut, TraceCut];
  /** Parameter 0..1 of the press along the trace. */
  pressT: number;
  /** Total unsigned turning, radians. */
  turn: number;
  /** Indices of the samples the two cuts sit at: the join spans these. */
  cutIndex: [number, number];
};
export type TraceOpts = {
  /** Furthest a walk goes each way, font units (default 3 em at 1000 upm). */
  maxLength: number;
  /** Existing faces of the piece: the walk stops a thickness short of one. */
  faces?: readonly CutFace[];
  /** The most a trace may turn (default π): one cubic cannot follow more,
   *  so a longer turn is trimmed from the end farther from the press. */
  maxTurn: number;
};

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
const len = (a: Pt) => Math.hypot(a[0], a[1]);
const unit = (a: Pt): Pt => { const l = len(a); return l < EPS ? [1, 0] : [a[0] / l, a[1] / l]; };
const perp = (a: Pt): Pt => [-a[1], a[0]];
const signedAngle = (a: Pt, b: Pt) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);

/** A constant-thickness circular band from `a0` to `a1` (radians) about the
 *  origin — a bowl as a font draws one. Shared by the tests and the gate
 *  script; not used by the app. */
export function arcBand(rInner: number, rOuter: number, a0: number, a1: number, steps = 60): SvgCmd[] {
  const cmds: SvgCmd[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cmds.push({ type: i === 0 ? "M" : "L", x: Math.cos(a) * rOuter, y: Math.sin(a) * rOuter });
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cmds.push({ type: "L", x: Math.cos(a) * rInner, y: Math.sin(a) * rInner });
  }
  cmds.push({ type: "Z" });
  return cmds;
}

/** Inside the ink: inside an odd number of contours (counters are holes). */
function insideInk(contours: readonly Contour[], p: Pt): boolean {
  let n = 0;
  for (const c of contours) if (pointInPolygon(p[0], p[1], c)) n++;
  return n % 2 === 1;
}

/** The nearest point on any outline segment, with that segment's direction. */
function nearestEdge(contours: readonly Contour[], p: Pt): { point: Pt; dir: Pt; dist: number } | null {
  let best: { point: Pt; dir: Pt; dist: number } | null = null;
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i++) {
      const a = c[i], b = c[i + 1];
      const ab = sub(b, a), l2 = ab[0] * ab[0] + ab[1] * ab[1];
      if (l2 < EPS) continue;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / l2));
      const q = add(a, mul(ab, t));
      const d = len(sub(p, q));
      if (!best || d < best.dist) best = { point: q, dir: unit(ab), dist: d };
    }
  }
  return best;
}

/** The nearest crossing of the ray from `from` along `dir` with the outline. */
function castRay(contours: readonly Contour[], from: Pt, dir: Pt): Pt | null {
  let bestT = Infinity;
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i++) {
      const a = c[i], b = c[i + 1];
      const e = sub(b, a);
      const den = dir[0] * e[1] - dir[1] * e[0];
      if (Math.abs(den) < EPS) continue;
      const ap = sub(a, from);
      const t = (ap[0] * e[1] - ap[1] * e[0]) / den;      // along the ray
      const u = (ap[0] * dir[1] - ap[1] * dir[0]) / den;  // along the edge
      if (t > EPS && u >= 0 && u <= 1 && t < bestT) bestT = t;
    }
  }
  return isFinite(bestT) ? add(from, mul(dir, bestT)) : null;
}

/** Cast across the stroke from `c` along ±normal of `tangent`: the stroke's
 *  centre and thickness there, or null off the ink. */
function measure(contours: readonly Contour[], c: Pt, tangent: Pt): { centre: Pt; thickness: number } | null {
  if (!insideInk(contours, c)) return null;
  const n = perp(tangent);
  const p = castRay(contours, c, n), q = castRay(contours, c, mul(n, -1));
  if (!p || !q) return null;
  return { centre: mul(add(p, q), 0.5), thickness: len(sub(p, q)) };
}

type Sample = { centre: Pt; thickness: number; tangent: Pt };

/**
 * Walk from `seed` along `dir`, re-centring at every step, until the stroke
 * ends, forks, straightens for more than a thickness, inflects, or meets a
 * face. Returns the samples after the seed (the seed itself excluded) with
 * a straight run at the end trimmed off.
 */
function walk(contours: readonly Contour[], seed: Sample, dir: Pt, thick0: number, opts: TraceOpts): Sample[] {
  const step = thick0 * STEP_FRACTION;
  const out: Sample[] = [];
  let c = seed.centre, t = dir, prevThick = thick0, travelled = 0, straight = 0, turnSign = 0;
  let straightStart = -1;
  // Turning against the established sense, accumulated until a step turns
  // with it again: a flattened curve's polyline jitters by a degree or two
  // per step, and only a sustained reversal is an inflection.
  let against = 0;
  while (travelled < opts.maxLength) {
    const ahead = add(c, mul(t, step));
    const m = measure(contours, ahead, t);
    if (!m) break;
    const ratio = m.thickness / thick0;
    if (ratio < THICK_MIN_RATIO || ratio > THICK_MAX_RATIO) break;
    if (Math.abs(m.thickness - prevThick) / prevThick > THICK_JUMP) break;
    if (opts.faces?.some((f) => len(sub(mul(add(f.a, f.b), 0.5), m.centre)) < thick0)) break;
    const nt = unit(sub(m.centre, c));
    const turn = signedAngle(t, nt);
    if (Math.abs(turn) < TURN_EPS) {
      if (straightStart < 0) straightStart = out.length;
      straight += step;
      if (straight > thick0) { out.splice(straightStart); return out; }
    } else {
      straight = 0; straightStart = -1;
      const s = Math.sign(turn);
      if (turnSign === 0) turnSign = s;
      else if (s !== turnSign) {
        against += Math.abs(turn);
        if (against > INFLECTION_TURN) break;
      } else against = 0;
    }
    out.push({ centre: m.centre, thickness: m.thickness, tangent: nt });
    travelled += step; prevThick = m.thickness; c = m.centre; t = nt;
  }
  if (straightStart >= 0 && straightStart < out.length) out.splice(straightStart);
  return out;
}

/** The cut perpendicular to the stroke at `s`: `angle` is the stroke's
 *  direction, `cutX` the centre's x in the frame rotated by −angle. */
function cutAt(s: Sample): TraceCut {
  const angle = Math.atan2(s.tangent[1], s.tangent[0]);
  const c = Math.cos(angle), sn = Math.sin(angle);
  return {
    angle,
    cutX: s.centre[0] * c + s.centre[1] * sn,
    window: { y: -s.centre[0] * sn + s.centre[1] * c, half: s.thickness },
  };
}

/**
 * Trace the curved stroke under `press`. Null when the press is off the ink,
 * the stroke does not turn (`MIN_TURN`), the trace is too short, or either
 * end cut would not split the outline cleanly.
 */
export function traceCurve(cmds: SvgCmd[], press: Pt, partial: Partial<TraceOpts> = {}): CurveTrace | null {
  return traceContours(flattenContours(cmds), cmds, press, partial);
}

/** `traceCurve` on an outline already flattened (the hover traces one letter many times). */
function traceContours(contours: readonly Contour[], cmds: SvgCmd[], press: Pt, partial: Partial<TraceOpts>): CurveTrace | null {
  const opts: TraceOpts = { maxLength: MAX_LENGTH_EM * 1000, maxTurn: Math.PI, ...partial };
  if (!insideInk(contours, press)) return null;
  const edge = nearestEdge(contours, press);
  if (!edge) return null;
  // The nearest edge is usually a side of the stroke; near a stroke's end it
  // may be the end cap, whose direction is across the stroke. The stroke's
  // own direction is whichever of the two gives the thinner cast across.
  const along = measure(contours, press, edge.dir), across = measure(contours, press, perp(edge.dir));
  const pick = along && across ? (along.thickness <= across.thickness ? "along" : "across") : along ? "along" : across ? "across" : null;
  if (!pick) return null;
  const m0 = pick === "along" ? along! : across!;
  const tangent = pick === "along" ? edge.dir : perp(edge.dir);
  const seed: Sample = { centre: m0.centre, thickness: m0.thickness, tangent };
  const fwd = walk(contours, seed, seed.tangent, seed.thickness, opts);
  const back = walk(contours, seed, mul(seed.tangent, -1), seed.thickness, opts);
  // Backward samples travel the other way; flip their tangents into stroke order.
  let samples: Sample[] = [
    ...back.map((s) => ({ ...s, tangent: mul(s.tangent, -1) })).reverse(),
    seed,
    ...fwd,
  ];
  if (samples.length < 3) return null;
  let si = back.length;
  samples[si] = { ...seed, tangent: unit(sub(samples[Math.min(si + 1, samples.length - 1)].centre, samples[Math.max(si - 1, 0)].centre)) };
  const stepTurn = (i: number) => Math.abs(signedAngle(samples[i - 1].tangent, samples[i].tangent));
  let turn = 0;
  for (let i = 1; i < samples.length; i++) turn += stepTurn(i);
  // One cubic follows at most `maxTurn`: trim the end farther from the press
  // first, a sample at a time, until the turn fits.
  while (turn > opts.maxTurn && samples.length > 3) {
    if (si >= samples.length - 1 - si) { turn -= stepTurn(1); samples = samples.slice(1); si--; }
    else { turn -= stepTurn(samples.length - 1); samples = samples.slice(0, -1); }
  }
  let length = 0;
  for (let i = 1; i < samples.length; i++) length += len(sub(samples[i].centre, samples[i - 1].centre));
  if (turn < MIN_TURN || length < MIN_LENGTH_THICK * seed.thickness) return null;
  // Cuts half a thickness in from each end.
  const inset = seed.thickness / 2;
  let fromStart = samples.length - 1;
  for (let i = 1, d = 0; i < samples.length; i++) { d += len(sub(samples[i].centre, samples[i - 1].centre)); if (d >= inset) { fromStart = i; break; } }
  let fromEnd = 0;
  for (let i = samples.length - 2, d = 0; i >= 0; i--) { d += len(sub(samples[i].centre, samples[i + 1].centre)); if (d >= inset) { fromEnd = i; break; } }
  if (fromEnd <= fromStart) return null;
  const cuts: [TraceCut, TraceCut] = [cutAt(samples[fromStart]), cutAt(samples[fromEnd])];
  if (!splitAtCut(cmds, cuts[0]) || !splitAtCut(cmds, cuts[1])) return null;
  return {
    centre: samples.map((s) => s.centre),
    thickness: samples.map((s) => s.thickness),
    tangent: samples.map((s) => s.tangent),
    cuts,
    pressT: si / (samples.length - 1),
    turn,
    cutIndex: [fromStart, fromEnd],
  };
}

export type CurveRegion = {
  trace: CurveTrace;
  /** The apex third of the trace widened to the stroke, as a closed polygon. */
  polygon: Pt[];
  /** A point inside the apex; a press here seeds the same trace. */
  apex: Pt;
};

/** Segment midpoints along every contour, every `stride`-th one: the seeds. */
function seedPoints(contours: readonly Contour[], stride: number): Pt[] {
  const out: Pt[] = [];
  for (const c of contours) for (let i = 0; i + 1 < c.length; i += stride) out.push(mul(add(c[i], c[i + 1]), 0.5));
  return out;
}

/**
 * The curves a hover should offer: traces seeded along the outline (a
 * quarter of the way across the stroke from each seed edge), kept when they
 * turn at least `MIN_TURN`, deduplicated so one bowl yields one region (two
 * traces share a region when either's middle sample lies within a thickness
 * of a sample of the other; the longer wins).
 */
export function curveRegions(cmds: SvgCmd[], partial: Partial<TraceOpts> = {}): CurveRegion[] {
  const contours = flattenContours(cmds);
  const verts = contours.reduce((n, c) => n + c.length, 0);
  const stride = Math.max(1, Math.round(verts / 40));
  const traces: CurveTrace[] = [];
  // A seed within a thickness of a trace already found would retrace it.
  const covered = (p: Pt) => traces.some((t) => t.centre.some((c, i) => len(sub(c, p)) < t.thickness[i]));
  for (const p of seedPoints(contours, stride)) {
    if (covered(p)) continue;
    const e = nearestEdge(contours, p);
    if (!e) continue;
    // Step a hair inside along the inward normal, then measure across to
    // find the stroke's centre; seed a quarter of the way across.
    const n = perp(e.dir);
    const inward = insideInk(contours, add(e.point, mul(n, 0.5))) ? n : insideInk(contours, add(e.point, mul(n, -0.5))) ? mul(n, -1) : null;
    if (!inward) continue;
    const m = measure(contours, add(e.point, mul(inward, 0.5)), e.dir);
    if (!m) continue;
    const seed = add(e.point, mul(sub(m.centre, e.point), 0.5));
    if (covered(seed)) continue;
    const t = traceContours(contours, cmds, seed, partial);
    if (t) traces.push(t);
  }
  traces.sort((a, b) => b.centre.length - a.centre.length);
  const kept: CurveTrace[] = [];
  const nearAny = (p: Pt, t: CurveTrace, th: number) => t.centre.some((c) => len(sub(c, p)) < th);
  const shares = (a: CurveTrace, b: CurveTrace) => {
    const ma = a.centre[Math.floor(a.centre.length / 2)], mb = b.centre[Math.floor(b.centre.length / 2)];
    return nearAny(ma, b, a.thickness[0]) || nearAny(mb, a, b.thickness[0]);
  };
  for (const t of traces) if (!kept.some((k) => shares(k, t))) kept.push(t);
  return kept.map((trace) => {
    const n = trace.centre.length;
    const i0 = Math.floor(n / 3), i1 = Math.min(Math.ceil((2 * n) / 3), n - 1);
    const left: Pt[] = [], right: Pt[] = [];
    for (let i = i0; i <= i1; i++) {
      const h = perp(trace.tangent[i]);
      const half = trace.thickness[i] / 2;
      left.push(add(trace.centre[i], mul(h, half)));
      right.push(add(trace.centre[i], mul(h, -half)));
    }
    return { trace, polygon: [...left, ...right.reverse()], apex: trace.centre[Math.floor(n / 2)] };
  });
}
