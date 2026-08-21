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
};

/** Task 3's coverage sweep measured against these starting values and found
 *  no tested change clears the gate, so they were deliberately left as
 *  shipped — see `docs/archive/stroke-zone-coverage.md`. */
export const DEFAULT_DETECT_OPTS: DetectOpts = {
  maxSlope: 0.18,
  step: 10,
  thicknessTolerance: 0.12,
  minZoneWidth: 25,
};

export function legalCutAt(
  contours: Contour[],
  cutX: number,
  opts: DetectOpts = DEFAULT_DETECT_OPTS
): { legal: boolean; thickness: number } {
  const cs = crossingsAt(contours, cutX);
  if (cs.length < 2 || cs.length % 2 !== 0) return { legal: false, thickness: 0 };
  for (const c of cs) {
    if (Math.abs(c.slope) > opts.maxSlope) return { legal: false, thickness: 0 };
  }
  // Thickness is the total ink the line passes through: sum of the spans
  // between successive crossing pairs, so a counter's hole is excluded.
  let thickness = 0;
  for (let i = 0; i + 1 < cs.length; i += 2) thickness += cs[i + 1].y - cs[i].y;
  return { legal: thickness > 0, thickness };
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
  let runThickness: number[] = [];
  let lastX = minX - opts.step;

  const flush = (endX: number) => {
    if (runStart === null) return;
    const width = endX - runStart;
    if (width >= opts.minZoneWidth && runThickness.length > 0) {
      const mean = runThickness.reduce((a, b) => a + b, 0) / runThickness.length;
      const spread = Math.max(...runThickness) - Math.min(...runThickness);
      // A zone must hold its weight: a momentary flat on a curve does not
      // count as a straight stroke.
      if (mean > 0 && spread / mean <= opts.thicknessTolerance) {
        zones.push({ ...meta, fromX: runStart, toX: endX, thickness: mean });
      }
    }
    runStart = null;
    runThickness = [];
  };

  for (let x = minX; x <= maxX; x += opts.step) {
    lastX = x;
    const { legal, thickness } = legalCutAt(contours, x, opts);
    if (legal) {
      if (runStart === null) runStart = x;
      runThickness.push(thickness);
    } else {
      flush(x - opts.step);
    }
  }
  flush(lastX);
  return zones;
}
