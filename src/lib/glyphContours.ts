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
 * passesMask). Returns undefined (whole-glyph fallback, matching prior
 * behavior) when none of the points land inside any contour — e.g. a point
 * still sitting on the default bounding-box edge before the user has dragged
 * it onto the actual stroke.
 */
export function deriveContourMask(
  commands: PathCommand[],
  points: { x: number; y: number }[]
): GlyphStretchMask | undefined {
  const polygons = contoursToPolygons(splitContours(commands));
  const contourIndices = new Set<number>();

  for (const p of points) {
    for (let i = 0; i < polygons.length; i++) {
      if (pointInPolygon(p.x, p.y, polygons[i])) contourIndices.add(i);
    }
  }

  if (contourIndices.size === 0) return undefined;
  return { mode: "contours", contourIndices: Array.from(contourIndices).sort((a, b) => a - b) };
}
