import type { PathCommand } from "opentype.js";
import { pathToPolygon, pointInPolygon, type SvgCmd } from "./svgPath";
import type { GlyphStretchMask } from "../types";

/** Splits a glyph's path commands into its closed sub-paths (contours), one array per "M...Z" run. */
export function splitContours(commands: PathCommand[]): PathCommand[][] {
  const contours: PathCommand[][] = [];
  let current: PathCommand[] = [];
  for (const cmd of commands) {
    if (cmd.type === "M") {
      if (current.length) contours.push(current);
      current = [cmd];
    } else {
      current.push(cmd);
    }
  }
  if (current.length) contours.push(current);
  return contours;
}

/**
 * Subdivides each contour's beziers into a flat point polygon for hit-testing
 * — opentype.js's PathCommand and lib/svgPath.ts's SvgCmd are structurally
 * identical (same type/x/y/x1/y1/x2/y2 shape), so pathToPolygon's existing
 * bezier-subdivision math applies directly with no conversion.
 */
export function contoursToPolygons(
  contours: PathCommand[][],
  steps = 8
): Array<[number, number]>[] {
  return contours.map((c) => pathToPolygon(c as unknown as SvgCmd[], steps));
}

/**
 * Auto-derives a contour mask from wherever a stretch handle's anchor/drag
 * points actually sit on the real glyph outline — used so a schema-backed
 * handle self-scopes to the stroke it's touching instead of defaulting to
 * "affects the whole glyph" (see the no-mask fallback in lib/glyphEdits.ts's
 * passesMask). Since these points are only approximately mapped from the
 * schema's own normalized geometry onto the real glyph's bounding box (no
 * per-font correspondence), an endpoint can land in empty space between
 * contours (e.g. between a letter's body and its dots) even when the axis
 * is otherwise correctly aimed at the intended stroke — so every point along
 * the anchor-to-drag segment is sampled, not just the two endpoints, to
 * raise the odds of landing on ink. Returns undefined (whole-glyph fallback,
 * matching prior behavior) when no sampled point lands inside any contour.
 */
export function deriveContourMask(
  commands: PathCommand[],
  points: { x: number; y: number }[],
  samplesPerSegment = 8
): GlyphStretchMask | undefined {
  const polygons = contoursToPolygons(splitContours(commands));
  const contourIndices = new Set<number>();

  const testPoint = (x: number, y: number) => {
    for (let i = 0; i < polygons.length; i++) {
      if (pointInPolygon(x, y, polygons[i])) contourIndices.add(i);
    }
  };

  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    testPoint(a.x, a.y);
    const b = points[i + 1];
    if (!b) continue;
    for (let s = 1; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      testPoint(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }

  if (contourIndices.size === 0) return undefined;
  return { mode: "contours", contourIndices: Array.from(contourIndices).sort((a, b) => a - b) };
}
