/**
 * Straight-stroke cut detection — geometry only, pure, no `./harfbuzz` and
 * no `opentype.js` import (see `docs/superpowers/specs/2026-08-21-straight-stroke-extension-design.md`).
 *
 * `findCutZones` walks a flattened glyph outline and reports x-ranges where
 * a vertical cut is "legal": crossed an even number of times, at least
 * twice; every crossed segment within `maxSlope` of parallel to the
 * baseline; steady thickness across the run. It was meant to let a
 * calligrapher lengthen a letter's own straight strokes — and the connector
 * between two joined letters — by cutting the outline and bridging the gap,
 * as a second elongation mechanism alongside the tatweel kashida.
 *
 * **This module has no application consumer.** The plan that specified it
 * (`docs/superpowers/plans/2026-08-21-straight-stroke-extension.md`) stopped
 * at Task 3, its own go/no-go coverage gate, and the gate failed: at the
 * shipped `maxSlope` and at both looser values the plan authorized trying, no
 * setting ever cleared the gate on all four gate fonts (Amiri, Scheherazade,
 * NotoSans, Kufi) at once. That is not a join-coverage failure — measured
 * against the gate's own denominator (positions where a tatweel is actually
 * legal, not every adjacent glyph pair), join coverage reaches 89–100% in
 * three of the four fonts (Scheherazade, NotoSans, Kufi). NotoSans clears
 * both bars at every tested setting including baseline; Kufi clears both
 * only at the two loosened settings, missing on isolated coverage at
 * baseline. What actually fails is the letterform-internal half:
 * Scheherazade's isolated-letter coverage never reaches the 60% bar at any
 * tested setting, getting worse as the tolerance loosens (54% → 46% → 32%),
 * and Kufi's isolated score fails at baseline. Additionally, Amiri also
 * fails the join half (0% at baseline, still only 56% at the loosened
 * ceiling — a genuine property of where its zones sit, not a metric
 * artifact), which is why the join half could not carry the gate on its own
 * despite strong join coverage in the other three fonts. Because the gate requires all four fonts to clear at once,
 * it is never met. The reason is structural — Arabic strokes as these fonts
 * actually draw them are subtly inclined nearly everywhere, so the tolerance
 * that admits a real stroke also admits a curve. Full measurement:
 * `docs/archive/stroke-zone-coverage.md`. See also CLAUDE.md,
 * "Straight-stroke cut detection (kept, unused)".
 *
 * The only caller is `scripts/measureStrokeZones.mjs`, the offline sweep
 * that produced those numbers. This module is kept rather than deleted for
 * the same reason the removed Morph Glyph Editor's Python tooling was kept:
 * it is inert, and it is the other half of "don't redo the work" should the
 * underlying font geometry ever be worth re-measuring. Do not delete it as
 * an unused module — the absence of an application consumer is the intended
 * end state of this work, not an oversight.
 */
import type { SvgCmd } from "./svgPath";
// normalizeGlyphs is type-only here and imports nothing itself, so this
// keeps the module free of `./harfbuzz` — whose static harfbuzzjs import
// throws under Vitest's Node loader before any test code runs.
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

export type Pt = [number, number];
export type Contour = Pt[];

/** Structural shape of an opentype.js PathCommand, so this module needs no
 *  dependency on opentype.js to accept one. */
type AnyCmd = {
  type: string;
  x?: number; y?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
};

/** Adapt opentype.js commands to this codebase's own SvgCmd union. The two
 *  are structurally identical; this exists so the conversion is one checked
 *  place rather than a cast at each call site. */
export function toSvgCmds(cmds: readonly AnyCmd[]): SvgCmd[] {
  const out: SvgCmd[] = [];
  for (const c of cmds) {
    switch (c.type) {
      case "M": out.push({ type: "M", x: c.x ?? 0, y: c.y ?? 0 }); break;
      case "L": out.push({ type: "L", x: c.x ?? 0, y: c.y ?? 0 }); break;
      case "C": out.push({
        type: "C", x1: c.x1 ?? 0, y1: c.y1 ?? 0,
        x2: c.x2 ?? 0, y2: c.y2 ?? 0, x: c.x ?? 0, y: c.y ?? 0,
      }); break;
      case "Q": out.push({
        type: "Q", x1: c.x1 ?? 0, y1: c.y1 ?? 0, x: c.x ?? 0, y: c.y ?? 0,
      }); break;
      case "Z": out.push({ type: "Z" }); break;
    }
  }
  return out;
}

/**
 * Flatten to one polyline PER CONTOUR.
 *
 * Deliberately not `pathToPolygon`, which returns a single flat list for the
 * whole path. That is right for a Shape Fill silhouette and wrong for a glyph:
 * a letter with a counter has two contours, and concatenating them inserts a
 * phantom segment from one contour's end to the next one's start, which a cut
 * line can cross — corrupting both the crossing parity and the thickness.
 * Same fixed-step subdivision (8) so the two agree where they overlap.
 */
export function flattenContours(cmds: SvgCmd[], steps = 8): Contour[] {
  const contours: Contour[] = [];
  let cur: Contour = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;

  const close = () => {
    if (cur.length > 1) contours.push(cur);
    cur = [];
  };

  for (const cmd of cmds) {
    switch (cmd.type) {
      case "M":
        close();
        cx = sx = cmd.x; cy = sy = cmd.y;
        cur = [[cx, cy]];
        break;
      case "L":
        cx = cmd.x; cy = cmd.y;
        cur.push([cx, cy]);
        break;
      case "C": {
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([
            u*u*u*x0 + 3*u*u*t*cmd.x1 + 3*u*t*t*cmd.x2 + t*t*t*cmd.x,
            u*u*u*y0 + 3*u*u*t*cmd.y1 + 3*u*t*t*cmd.y2 + t*t*t*cmd.y,
          ]);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Q": {
        const x0 = cx, y0 = cy;
        for (let i = 1; i <= steps; i++) {
          const t = i / steps, u = 1 - t;
          cur.push([
            u*u*x0 + 2*u*t*cmd.x1 + t*t*cmd.x,
            u*u*y0 + 2*u*t*cmd.y1 + t*t*cmd.y,
          ]);
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Z":
        if (cur.length > 0) cur.push([sx, sy]);
        close();
        cx = sx; cy = sy;
        break;
    }
  }
  close();
  return contours;
}

/** One intersection of the vertical line x=cutX with the outline. */
export type Crossing = {
  y: number;
  /** dy/dx of the crossed segment. 0 is parallel to the baseline. */
  slope: number;
};

export function crossingsAt(contours: Contour[], cutX: number): Crossing[] {
  const out: Crossing[] = [];
  for (const c of contours) {
    for (let i = 0; i + 1 < c.length; i++) {
      const [x0, y0] = c[i];
      const [x1, y1] = c[i + 1];
      if (x0 === x1) continue;
      const lo = Math.min(x0, x1), hi = Math.max(x0, x1);
      // Half-open so a vertex shared by two segments counts once.
      if (cutX < lo || cutX >= hi) continue;
      const t = (cutX - x0) / (x1 - x0);
      out.push({ y: y0 + t * (y1 - y0), slope: (y1 - y0) / (x1 - x0) });
    }
  }
  return out.sort((a, b) => a.y - b.y);
}

export type DetectOpts = {
  /** Max |dy/dx| for a crossed segment to count as parallel to the baseline. */
  maxSlope: number;
  /** Sampling step, font units. */
  step: number;
  /** Thickness must hold within this fraction across a zone. */
  thicknessTolerance: number;
  /** Minimum zone width to be worth offering, font units. */
  minZoneWidth: number;
  /** Widest stroke inclination the sweep will try, radians either side of
   *  the baseline. */
  maxAngle: number;
  /** Angular resolution of the sweep, radians. */
  angleStep: number;
  /** How far a single edge may bow away from its own chord across a zone,
   *  as a fraction of the stroke's thickness, before the zone is read as a
   *  curve rather than a straight stroke. */
  maxEdgeBow: number;
};

/** Task 3's coverage sweep measured against these starting values and found
 *  no tested change clears the gate, so they were deliberately left as
 *  shipped — see `docs/archive/stroke-zone-coverage.md`. */
export const DEFAULT_DETECT_OPTS: DetectOpts = {
  maxSlope: 0.18,
  step: 10,
  thicknessTolerance: 0.12,
  minZoneWidth: 25,
  maxAngle: (35 * Math.PI) / 180,
  angleStep: (5 * Math.PI) / 180,
  maxEdgeBow: 0.015,
};

export type CutSample = {
  legal: boolean;
  thickness: number;
  /** Mean |dy/dx| of the crossed edges. 0 means a perfect axis-aligned fit. */
  meanAbsSlope: number;
  /** Each crossed edge's signed slope, ordered by y. Reported for callers
   *  and tests; the straightness predicate uses `ys` instead. */
  slopes: number[];
  /** Where the line crosses each edge, ordered by y. A straight stroke's
   *  crossings are collinear along the run; a curve's bow away from the
   *  chord. Kept per edge rather than averaged because a stroke that bows
   *  symmetrically moves its two edges in opposite directions, which a mean
   *  cancels out. */
  ys: number[];
  /** Midpoint of the ink the line passes through, for placing a handle. */
  midY: number;
};

const NO_CUT: CutSample = {
  legal: false, thickness: 0, meanAbsSlope: 0, slopes: [], ys: [], midY: 0,
};

export function legalCutAt(
  contours: Contour[],
  cutX: number,
  opts: DetectOpts = DEFAULT_DETECT_OPTS
): CutSample {
  const cs = crossingsAt(contours, cutX);
  if (cs.length < 2 || cs.length % 2 !== 0) return NO_CUT;
  for (const c of cs) {
    if (Math.abs(c.slope) > opts.maxSlope) return NO_CUT;
  }
  // Thickness is the total ink the line passes through: sum of the spans
  // between successive crossing pairs, so a counter's hole is excluded.
  let thickness = 0;
  for (let i = 0; i + 1 < cs.length; i += 2) thickness += cs[i + 1].y - cs[i].y;
  const meanAbsSlope =
    cs.reduce((a, c) => a + Math.abs(c.slope), 0) / cs.length;
  const midY = (cs[0].y + cs[cs.length - 1].y) / 2;
  return {
    legal: thickness > 0,
    thickness,
    meanAbsSlope,
    slopes: cs.map((c) => c.slope),
    ys: cs.map((c) => c.y),
    midY,
  };
}

/** Rotate an outline about the origin. Detection uses this to bring a stroke
 *  into its own frame, where the existing baseline-relative sweep applies
 *  unchanged. */
export function rotateContours(contours: Contour[], t: number): Contour[] {
  if (t === 0) return contours;
  const c = Math.cos(t), s = Math.sin(t);
  return contours.map((ct) =>
    ct.map(([x, y]) => [x * c - y * s, x * s + y * c] as Pt)
  );
}

/**
 * Does every crossed edge stay on a straight line across the run?
 *
 * Each edge is judged by how far its crossings bow away from the chord
 * joining the run's first and last, relative to the stroke's own thickness.
 * A stem's edge is collinear; a curve's bows, which is what makes a curve's
 * vertex look momentarily flat to any single-sample test.
 *
 * Deviation from a chord rather than drift in per-segment slope, because
 * `flattenContours` turns every curve into 8 straight segments: consecutive
 * samples land on different segments whose slopes differ discretely, so a
 * slope-drift test reads that quantization as curvature and throws away real
 * strokes. Crossing *positions* carry the signal without the quantization.
 *
 * Each edge is tracked separately, by its index in the y-ordered crossing
 * list: a stroke that bows symmetrically moves its two edges in opposite
 * directions, so their mean stays put the whole way and a mean-based test
 * would pass it.
 *
 * A run whose crossing count changes partway is refused outright — the edges
 * can no longer be matched up between samples, and the outline is doing
 * something (a counter opening, a stem meeting a bowl) that is not one
 * straight stroke.
 */
function edgesAreStraight(run: CutSample[], thickness: number, opts: DetectOpts): boolean {
  const n = run[0].ys.length;
  if (run.some((r) => r.ys.length !== n)) return false;
  // Two samples are collinear by construction, so they carry no evidence.
  if (run.length < 3) return true;

  const last = run.length - 1;
  const limit = opts.maxEdgeBow * thickness;
  for (let i = 0; i < n; i++) {
    const y0 = run[0].ys[i], y1 = run[last].ys[i];
    for (let k = 1; k < last; k++) {
      const chord = y0 + ((y1 - y0) * k) / last;
      if (Math.abs(run[k].ys[i] - chord) > limit) return false;
    }
  }
  return true;
}

/** A contiguous run of legal cut positions: one extendable stroke, one handle. */
export type CutZone = {
  glyphIndex: number;
  cluster: number;
  /** Glyph-local x range, font units. */
  fromX: number;
  toX: number;
  /** Ink thickness through the zone — for weight checks and for the UI. */
  thickness: number;
  /** Rotation of the frame `fromX`/`toX` are expressed in, radians; 0 is the
   *  baseline. The cut line is perpendicular to this, and extension runs
   *  along it. */
  angle: number;
  /** Mean |edge slope| within that frame. 0 is a perfectly aligned stroke —
   *  the sweep keeps the best-fitting angle per stroke by this number. */
  fit: number;
  /** Centre of the zone in its own frame, for placing a handle on the ink. */
  centreY: number;
};

export function findCutZones(
  contours: Contour[],
  meta: { glyphIndex: number; cluster: number },
  opts: DetectOpts = DEFAULT_DETECT_OPTS
): CutZone[] {
  let minX = Infinity, maxX = -Infinity;
  for (const c of contours) for (const [x] of c) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }
  if (!isFinite(minX) || maxX <= minX) return [];

  const zones: CutZone[] = [];
  let runStart: number | null = null;
  let run: CutSample[] = [];
  let lastX = minX - opts.step;

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

  const flush = (endX: number) => {
    if (runStart === null) return;
    const width = endX - runStart;
    if (width >= opts.minZoneWidth && run.length > 0) {
      const ts = run.map((r) => r.thickness);
      const meanT = mean(ts);
      const spread = Math.max(...ts) - Math.min(...ts);
      // A zone must hold its weight: a momentary flat on a curve does not
      // count as a straight stroke.
      if (
        meanT > 0 &&
        spread / meanT <= opts.thicknessTolerance &&
        edgesAreStraight(run, meanT, opts)
      ) {
        zones.push({
          ...meta,
          fromX: runStart,
          toX: endX,
          thickness: meanT,
          angle: 0,
          fit: mean(run.map((r) => r.meanAbsSlope)),
          centreY: mean(run.map((r) => r.midY)),
        });
      }
    }
    runStart = null;
    run = [];
  };

  for (let x = minX; x <= maxX; x += opts.step) {
    lastX = x;
    const sample = legalCutAt(contours, x, opts);
    if (sample.legal) {
      if (runStart === null) runStart = x;
      run.push(sample);
    } else {
      flush(x - opts.step);
    }
  }
  flush(lastX);
  return zones;
}

/**
 * Detect strokes at any inclination, not only those parallel to the
 * baseline.
 *
 * Each candidate angle rotates the outline into that frame and runs
 * `findCutZones` there unchanged, so an inclined stem is horizontal in its
 * own frame and passes at the shipped `maxSlope` with nothing loosened. One
 * physical stroke is found at several neighbouring angles; `dedupeZones`
 * keeps the best-fitting one, so the number of handles offered reflects
 * strokes rather than sweep resolution.
 *
 * See the "Amendment: axis-relative cuts" section of
 * `docs/superpowers/specs/2026-08-21-straight-stroke-extension-design.md`
 * for why the baseline-relative predicate alone could not work.
 */
export function findCutZonesSwept(
  contours: Contour[],
  meta: { glyphIndex: number; cluster: number },
  opts: DetectOpts = DEFAULT_DETECT_OPTS
): CutZone[] {
  const steps = Math.floor(opts.maxAngle / opts.angleStep);
  const angles = [0];
  for (let i = 1; i <= steps; i++) {
    angles.push(i * opts.angleStep, -i * opts.angleStep);
  }

  const found: CutZone[] = [];
  for (const t of angles) {
    for (const z of findCutZones(rotateContours(contours, -t), meta, opts)) {
      found.push({ ...z, angle: t });
    }
  }
  return dedupeZones(found, opts);
}

/**
 * A zone's span along the glyph's own x axis.
 *
 * `fromX`/`toX` are expressed in the rotated frame the zone was found in, so
 * on a tilted zone they are displaced from glyph space by
 * `centreY * sin(angle)` — at a typical stroke height that is wider than the
 * join window, which is enough to report a zone as sitting somewhere it does
 * not. Anything reasoning about *where on the glyph* a zone is — join
 * proximity, handle placement — must go through this rather than read the
 * raw fields.
 */
export function zoneExtentX(z: CutZone): [number, number] {
  const c = Math.cos(z.angle), s = Math.sin(z.angle);
  const a = z.fromX * c - z.centreY * s;
  const b = z.toX * c - z.centreY * s;
  return a <= b ? [a, b] : [b, a];
}

/** A zone's centre in the untilted outline's own space. Zones found at
 *  different angles are compared as places on the glyph through this, and the
 *  on-canvas handle is placed with it. */
export function zoneCentre(z: CutZone): Pt {
  const cx = (z.fromX + z.toX) / 2;
  const c = Math.cos(z.angle), s = Math.sin(z.angle);
  return [cx * c - z.centreY * s, cx * s + z.centreY * c];
}

/** Keep one zone per physical stroke: best fit first, then drop any later
 *  zone centred on ink an earlier one already claims. */
export function dedupeZones(zones: CutZone[], opts: DetectOpts): CutZone[] {
  const kept: { zone: CutZone; centre: Pt }[] = [];
  for (const z of [...zones].sort((a, b) => a.fit - b.fit)) {
    const centre = zoneCentre(z);
    const clash = kept.some(
      (k) => Math.hypot(k.centre[0] - centre[0], k.centre[1] - centre[1]) <
        opts.minZoneWidth
    );
    if (!clash) kept.push({ zone: z, centre });
  }
  return kept.map((k) => k.zone);
}

/** Rotate a command list about the origin, so a cut expressed in a stroke's
 *  own frame can be applied by the axis-aligned surgery below. */
export function rotateCmds(cmds: SvgCmd[], t: number): SvgCmd[] {
  if (t === 0) return cmds;
  const c = Math.cos(t), s = Math.sin(t);
  const r = (x: number, y: number) => ({ x: x * c - y * s, y: x * s + y * c });
  return cmds.map((cmd) => {
    switch (cmd.type) {
      case "M": case "L":
        return { ...cmd, ...r(cmd.x, cmd.y) };
      case "Q": {
        const p = r(cmd.x, cmd.y), p1 = r(cmd.x1, cmd.y1);
        return { ...cmd, x: p.x, y: p.y, x1: p1.x, y1: p1.y };
      }
      case "C": {
        const p = r(cmd.x, cmd.y), p1 = r(cmd.x1, cmd.y1), p2 = r(cmd.x2, cmd.y2);
        return { ...cmd, x: p.x, y: p.y, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y };
      }
      default:
        return cmd;
    }
  });
}

export type ResolvedCut = {
  /** Cut position along the stroke's own axis, in the frame `angle` names. */
  cutX: number;
  /** Distance to open, same units, measured along that axis. */
  d: number;
  /** The stroke's inclination, radians. 0 is a baseline-perpendicular cut. */
  angle: number;
};

/** Split a cubic at t, returning [left, right] control points. */
function splitCubic(
  p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number
): [[Pt, Pt, Pt, Pt], [Pt, Pt, Pt, Pt]] {
  const lerp = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = lerp(p0, p1), b = lerp(p1, p2), c = lerp(p2, p3);
  const d = lerp(a, b), e = lerp(b, c);
  const f = lerp(d, e);
  return [[p0, a, d, f], [f, e, c, p3]];
}

/** Split a quadratic at t, returning [left, right] control points. */
function splitQuad(p0: Pt, p1: Pt, p2: Pt, t: number): [[Pt, Pt, Pt], [Pt, Pt, Pt]] {
  const lerp = (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const a = lerp(p0, p1), b = lerp(p1, p2);
  const c = lerp(a, b);
  return [[p0, a, c], [c, b, p2]];
}

/** Bisect for the parameter where a curve crosses x=cutX. Monotone x is
 *  assumed, which validity guarantees: a legal crossing runs along the
 *  stroke rather than doubling back across it. */
function tAtX(cutX: number, at: (t: number) => number): number {
  let lo = 0, hi = 1;
  const rising = at(1) >= at(0);
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if ((at(mid) < cutX) === rising) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Open the outline by each cut's distance.
 *
 * Every cut is applied in its own frame: the commands are rotated so the
 * stroke lies along x, an axis-aligned cut is opened there, and the result is
 * rotated back. That is the same trick detection uses, and it is what makes
 * the bridged span a clean rectangle of the stroke's own weight — the reason
 * extension runs along the stroke axis rather than horizontally.
 *
 * Cuts are applied from the HIGHEST cutX down, so an earlier application
 * never shifts a later cut's position — the same reason `applyDistribution`
 * in `fitToWidth.ts` walks its slots from the highest text offset down.
 */
export function applyCutsToCommands(cmds: SvgCmd[], cuts: ResolvedCut[]): SvgCmd[] {
  let out = cmds;
  for (const cut of [...cuts].sort((a, b) => b.cutX - a.cutX)) {
    out = rotateCmds(
      applyOneCut(rotateCmds(out, -cut.angle), cut.cutX, cut.d),
      cut.angle
    );
  }
  return out;
}

function applyOneCut(cmds: SvgCmd[], cutX: number, d: number): SvgCmd[] {
  const out: SvgCmd[] = [];
  // A whole segment moves or does not; deciding per control point would
  // distort a curve whose handles reach across the cut while its endpoints
  // stay on one side.
  const off = (past: boolean) => (past ? d : 0);
  let cx = 0, cy = 0, sx = 0, sy = 0;

  /** The two points that bridge a segment crossing the cut, given where it
   *  starts. Travelling out of the near side we land on the cut and step
   *  across it; travelling back, the reverse. */
  const bridge = (fromNear: boolean, my: number) => {
    out.push({ type: "L", x: fromNear ? cutX : cutX + d, y: my });
    out.push({ type: "L", x: fromNear ? cutX + d : cutX, y: my });
  };

  for (const cmd of cmds) {
    switch (cmd.type) {
      case "M": {
        const o = off(cmd.x >= cutX);
        out.push({ type: "M", x: cmd.x + o, y: cmd.y });
        cx = sx = cmd.x; cy = sy = cmd.y;
        break;
      }
      case "L": {
        const from = cx < cutX, to = cmd.x < cutX;
        if (from !== to) {
          const t = (cutX - cx) / (cmd.x - cx);
          bridge(from, cy + t * (cmd.y - cy));
        }
        out.push({ type: "L", x: cmd.x + off(!to), y: cmd.y });
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "C": {
        const p0: Pt = [cx, cy], p1: Pt = [cmd.x1, cmd.y1];
        const p2: Pt = [cmd.x2, cmd.y2], p3: Pt = [cmd.x, cmd.y];
        const from = cx < cutX, to = cmd.x < cutX;
        if (from !== to) {
          const at = (t: number) => {
            const u = 1 - t;
            return u*u*u*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t*t*t*p3[0];
          };
          const [L, R] = splitCubic(p0, p1, p2, p3, tAtX(cutX, at));
          // The half that lies past the cut moves; the other does not.
          const lo = off(!from), ro = off(!to);
          out.push({ type: "C", x1: L[1][0]+lo, y1: L[1][1], x2: L[2][0]+lo, y2: L[2][1], x: L[3][0]+lo, y: L[3][1] });
          out.push({ type: "L", x: R[0][0]+ro, y: R[0][1] });
          out.push({ type: "C", x1: R[1][0]+ro, y1: R[1][1], x2: R[2][0]+ro, y2: R[2][1], x: R[3][0]+ro, y: R[3][1] });
        } else {
          const o = off(!to);
          out.push({ type: "C", x1: cmd.x1+o, y1: cmd.y1, x2: cmd.x2+o, y2: cmd.y2, x: cmd.x+o, y: cmd.y });
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Q": {
        const p0: Pt = [cx, cy], p1: Pt = [cmd.x1, cmd.y1], p2: Pt = [cmd.x, cmd.y];
        const from = cx < cutX, to = cmd.x < cutX;
        if (from !== to) {
          const at = (t: number) => {
            const u = 1 - t;
            return u*u*p0[0] + 2*u*t*p1[0] + t*t*p2[0];
          };
          const [L, R] = splitQuad(p0, p1, p2, tAtX(cutX, at));
          const lo = off(!from), ro = off(!to);
          out.push({ type: "Q", x1: L[1][0]+lo, y1: L[1][1], x: L[2][0]+lo, y: L[2][1] });
          out.push({ type: "L", x: R[0][0]+ro, y: R[0][1] });
          out.push({ type: "Q", x1: R[1][0]+ro, y1: R[1][1], x: R[2][0]+ro, y: R[2][1] });
        } else {
          const o = off(!to);
          out.push({ type: "Q", x1: cmd.x1+o, y1: cmd.y1, x: cmd.x+o, y: cmd.y });
        }
        cx = cmd.x; cy = cmd.y;
        break;
      }
      case "Z": {
        // The segment Z implies — last point back to the subpath's start —
        // can be the one that crosses, and is invisible in the command list.
        // A glyph contour that happens to begin past the cut hits this.
        const from = cx < cutX;
        if (from !== sx < cutX) {
          const t = (cutX - cx) / (sx - cx);
          bridge(from, cy + t * (sy - cy));
        }
        out.push({ type: "Z" });
        cx = sx; cy = sy;
        break;
      }
    }
  }
  return out;
}

export type StrokeCut = {
  /** HarfBuzz source-character offset (cluster), NOT a glyph index — a
   *  cluster survives re-shaping that changes the glyph count, where an
   *  index does not. See the design doc's Storage section. */
  cluster: number;
  /** Cut's distance from the glyph's pen origin, along the stroke's own
   *  axis, in unscaled font units. */
  localX: number;
  /** The stroke's inclination, radians. Stored because it is a property of
   *  the cut, not something re-derivable once the outline has moved. */
  angle: number;
  /** Shaped glyph id present when the cut was made — a checksum, exactly as
   *  `GlyphTransform.glyphId` is used. Optional for the same reason: a cut
   *  saved before the field existed cannot be validated, and keeps its
   *  original behaviour rather than being silently discarded. */
  glyphId?: number;
  /** Extension distance, in nuqta. */
  nuqta: number;
  /** Test-only escape hatch: an absolute distance in font units, bypassing
   *  the nuqta conversion. Never written by the app. */
  _dOverride?: number;
};

export type CutPlan = {
  /** Extra pen x per glyph index, font units. */
  shift: number[];
  /** Cuts landing inside a glyph, keyed by glyph index, in glyph-local
   *  coordinates. */
  surgery: Map<number, ResolvedCut[]>;
  /** Total width the run gained. */
  addedAdvance: number;
};

/**
 * Resolve stored cuts against a shaped run.
 *
 * A cut of distance `d` at angle `t` opens the outline along the stroke's own
 * axis, so the run's advance grows by `d * cos(t)` — not by `d`. Everything
 * downstream lays out with that number, and
 * `strokeCuts.test.ts` ties it to the outline's own measured growth in three
 * real fonts rather than asserting the arithmetic against itself.
 *
 * A cut whose cluster matches no glyph, or whose recorded `glyphId` no longer
 * matches the glyph now at that cluster, is dropped rather than applied to
 * the wrong letter.
 */
/**
 * Total width a set of cuts adds to a run.
 *
 * Extension runs along each stroke's own axis, so a cut contributes
 * `d * cos(angle)` to the advance rather than `d`. `fitToWidth`'s
 * `styledRunWidth` needs this as its own term — a cut is geometry, not
 * characters, so the shaping measurement cannot see it, and without the term
 * a fit promises a width a stretched block then visibly exceeds.
 *
 * Shared with `buildCutPlan` rather than restated there, so the fitter and
 * the renderer cannot drift — the same discipline that has `ShapedText`
 * import `ITALIC_SHEAR` from `fitToWidth` instead of keeping a copy.
 */
export function cutAdvanceTotal(cuts: StrokeCut[], nuqtaUnits: number): number {
  let total = 0;
  for (const cut of cuts) {
    const d = cut._dOverride ?? cut.nuqta * nuqtaUnits;
    if (d > 0) total += d * Math.cos(cut.angle);
  }
  return total;
}

export function buildCutPlan(
  glyphs: HarfBuzzGlyph[],
  cuts: StrokeCut[],
  nuqtaUnits: number
): CutPlan {
  const shift = new Array<number>(glyphs.length).fill(0);
  const surgery = new Map<number, ResolvedCut[]>();
  let addedAdvance = 0;

  for (const cut of cuts) {
    // A cluster can hold several glyphs — a base and the marks stacked on
    // it — so the recorded glyph id picks which one within the cluster, not
    // merely checksums the first. Matching cluster alone and then testing
    // the id against whatever came first drops perfectly valid cuts.
    let idx = -1;
    if (cut.glyphId !== undefined) {
      idx = glyphs.findIndex(
        (g) => (g.cl ?? -1) === cut.cluster && g.g === cut.glyphId
      );
      // A recorded id that matches nothing in its cluster means the run has
      // re-shaped under this cut. Drop it rather than cut the wrong letter.
      if (idx < 0) continue;
    } else {
      idx = glyphs.findIndex((g) => (g.cl ?? -1) === cut.cluster);
      if (idx < 0) continue;
    }

    const d = cut._dOverride ?? cut.nuqta * nuqtaUnits;
    if (!(d > 0)) continue;

    const list = surgery.get(idx) ?? [];
    list.push({ cutX: cut.localX, d, angle: cut.angle });
    surgery.set(idx, list);

    // Along-axis extension: the pen only ever moves by the horizontal
    // component. The vertical component displaces geometry *inside* the cut
    // glyph, and never the letters after it, which stay on the baseline.
    const advance = d * Math.cos(cut.angle);
    for (let i = idx + 1; i < glyphs.length; i++) shift[i] += advance;
    addedAdvance += advance;
  }

  return { shift, surgery, addedAdvance };
}

/**
 * Bounding box of an outline, via the same flattening the detector uses so
 * the two agree. `ShapedText`'s metrics loop boxes a *cut* outline with this
 * rather than asking opentype.js for the original glyph's box — a stretched
 * letter has to report its real ink, or snapping, alignment and Fit to width
 * all keep measuring the un-stretched run.
 */
export function outlineBounds(
  cmds: SvgCmd[]
): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of flattenContours(cmds)) {
    for (const [x, y] of c) {
      if (x < x1) x1 = x;
      if (x > x2) x2 = x;
      if (y < y1) y1 = y;
      if (y > y2) y2 = y;
    }
  }
  if (!isFinite(x1)) return { x1: 0, y1: 0, x2: 0, y2: 0 };
  return { x1, y1, x2, y2 };
}

/**
 * Move cuts to follow a text edit that inserted or removed characters.
 *
 * Cuts are keyed by cluster, i.e. a source-text offset, so inserting a
 * tatweel shifts every cut after it. The kashida stepper knows exactly where
 * it edited and by how much, so the cuts are remapped rather than left to be
 * dropped silently by the `glyphId` checksum — losing a stretch because an
 * unrelated join was widened would read as a bug.
 *
 * A cut *at* the insertion offset stays put: a tatweel goes between two
 * letters, so the letter whose own offset is the slot index keeps it. The
 * delta is signed, because `applyKashida` is absolute rather than additive
 * and lowering a count removes characters.
 */
export function remapCutsAfterInsert(
  cuts: StrokeCut[],
  atOffset: number,
  inserted: number
): StrokeCut[] {
  if (inserted === 0) return cuts;
  return cuts.map((c) =>
    c.cluster > atOffset ? { ...c, cluster: c.cluster + inserted } : c
  );
}
