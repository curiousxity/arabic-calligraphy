import type * as opentype from "opentype.js";
import type { PathCommand } from "opentype.js";
import { pointInPolygon } from "./svgPath";
import { contoursToPolygons, splitContours } from "./glyphContours";
// Types only, from `normalizeGlyphs` rather than `harfbuzz` — importing the
// latter drags in harfbuzzjs, which throws under Vitest's Node ESM loader the
// moment this module is evaluated. Same reasoning as lib/justify.ts.
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

/**
 * A point at which two adjacent shaped letters actually connect, plus the
 * radius over which a stroke edit's displacement is suppressed around it.
 * Coordinates are in the shaped run's own local space — the same space
 * `applyGlyphEdit` receives, i.e. `outlinePoint + (gx, gy)`.
 */
export type JoinPin = { x: number; y: number; radius: number };

/** The pin radius, as a multiple of the font's measured nuqta. Tunable — see the spec's open questions. */
export const PIN_RADIUS_NUQTA = 0.5;

/** Even-odd containment across a glyph's whole contour set, so a counter (a hole) reads as outside the ink. */
export function insideContours(
  x: number,
  y: number,
  polygons: Array<[number, number]>[]
): boolean {
  let crossings = 0;
  for (const poly of polygons) {
    if (pointInPolygon(x, y, poly)) crossings++;
  }
  return crossings % 2 === 1;
}

function bounds(polygons: Array<[number, number]>[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * The centroid of the region where two glyphs' ink physically overlaps —
 * i.e. where they connect.
 *
 * After shaping, two cursively connected Arabic letters' outlines genuinely
 * overlap; the connection is simply wherever that overlap is. Deriving the
 * pin this way assumes nothing about baselines, slopes or letterform style,
 * so it is correct per font by construction — unlike the schema's
 * `anchorNorm`, which is a proportional guess mapped from an idealized
 * bounding box and is exactly what tore the seam in the first place.
 *
 * Sampled on a grid inside the two glyphs' bounding-box intersection rather
 * than solved analytically: polygon clipping would need a new dependency,
 * and the pin only has to be accurate to a fraction of a nuqta for the guard
 * radius to cover the join.
 *
 * Returns null when they do not overlap — an unconnected pair (a
 * right-joining letter followed by anything, a space, a mark) simply gets no
 * pin, which is the correct outcome, not a failure.
 */
export function overlapCentroid(
  a: Array<[number, number]>[],
  b: Array<[number, number]>[],
  samples = 24
): { x: number; y: number } | null {
  if (!a.length || !b.length) return null;

  const ba = bounds(a);
  const bb = bounds(b);
  const minX = Math.max(ba.minX, bb.minX);
  const maxX = Math.min(ba.maxX, bb.maxX);
  const minY = Math.max(ba.minY, bb.minY);
  const maxY = Math.min(ba.maxY, bb.maxY);
  if (!(maxX > minX) || !(maxY > minY)) return null;

  let sumX = 0;
  let sumY = 0;
  let hits = 0;

  for (let i = 0; i < samples; i++) {
    const x = minX + ((i + 0.5) / samples) * (maxX - minX);
    for (let j = 0; j < samples; j++) {
      const y = minY + ((j + 0.5) / samples) * (maxY - minY);
      if (insideContours(x, y, a) && insideContours(x, y, b)) {
        sumX += x;
        sumY += y;
        hits++;
      }
    }
  }

  if (hits === 0) return null;
  return { x: sumX / hits, y: sumY / hits };
}

/**
 * How much of a stroke edit's displacement a point is allowed to keep: 0
 * exactly at a join, ramping smoothly to 1 at the pin radius and beyond.
 *
 * Smoothstep rather than a linear ramp so there is no visible crease where
 * the guard releases — the same easing the band falloff in
 * lib/glyphEdits.ts already uses. When a point sits near two joins the
 * strictest pin wins, so a medial letter pinned on both sides holds both.
 */
export function joinGuard(x: number, y: number, pins: JoinPin[] | undefined): number {
  if (!pins?.length) return 1;

  let guard = 1;
  for (const pin of pins) {
    const radius = Math.max(pin.radius, 1e-6);
    const d = Math.hypot(x - pin.x, y - pin.y);
    if (d >= radius) continue;
    const t = d / radius;
    guard = Math.min(guard, t * t * (3 - 2 * t));
  }
  return guard;
}

/**
 * Every join in a shaped run, keyed by the glyph index each one constrains.
 *
 * A join between glyphs i and i+1 is recorded against **both** of them: each
 * glyph's own edits have to leave the shared seam alone, or one letter pulls
 * away from a neighbour that stayed put.
 *
 * The walk mirrors the renderers' *drawing* loop exactly — same pen advance,
 * same `dx`/`dy` handling, same `fontSize`-scaled outline — so the pins land
 * in the same local space `applyGlyphEdit` is called in
 * (`ShapedText.tsx`'s `drawWarpedGlyphRun`, and `lib/justify.ts`'s
 * `measureStretchedRunWidth`, which both call this). Both of those callers
 * must use the same pins, or the auto-justify solver would measure a width
 * the renderer does not draw.
 *
 * `pinRadius` is in the same pixel space, and should come from the font's
 * measured nuqta (`lib/nuqta.ts`'s `nuqtaPx`) times `PIN_RADIUS_NUQTA`. A
 * font with no measured nuqta is out of scope for this feature: pass no
 * pins at all rather than guessing a radius.
 */
export function computeJoinPins(args: {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  fontSize: number;
  unitsPerEm: number;
  pinRadius: number;
}): Map<number, JoinPin[]> {
  const { glyphs, font, fontSize, pinRadius } = args;
  const pins = new Map<number, JoinPin[]>();
  if (!font || glyphs.length < 2 || !(pinRadius > 0)) return pins;

  const upm = Math.max(args.unitsPerEm || 1000, 1);
  const scale = fontSize / upm;

  // Outline polygons per glyph, in run-local space, computed once.
  const polygons: Array<Array<[number, number]>[]> = [];
  let penX = 0;
  for (const g of glyphs) {
    const glyphObj = font.glyphs.get(g.g);
    if (!glyphObj) {
      polygons.push([]);
      penX += g.ax ?? 0;
      continue;
    }
    const gx = (penX + (g.dx ?? 0)) * scale;
    const gy = -(g.dy ?? 0) * scale;
    const commands = glyphObj.getPath(gx, gy, fontSize).commands as PathCommand[];
    polygons.push(contoursToPolygons(splitContours(commands)));
    penX += g.ax ?? 0;
  }

  const add = (glyphIndex: number, pin: JoinPin) => {
    const list = pins.get(glyphIndex);
    if (list) list.push(pin);
    else pins.set(glyphIndex, [pin]);
  };

  for (let i = 0; i < glyphs.length - 1; i++) {
    const centre = overlapCentroid(polygons[i], polygons[i + 1]);
    if (!centre) continue;
    const pin: JoinPin = { x: centre.x, y: centre.y, radius: pinRadius };
    add(i, pin);
    add(i + 1, pin);
  }

  return pins;
}
