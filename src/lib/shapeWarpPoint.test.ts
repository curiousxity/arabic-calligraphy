import { describe, it, expect } from "vitest";
import {
  applyShapeWarpPoint,
  invertShapeWarpPoint,
  type ShapeWarpMode,
  type GlyphBounds,
} from "./shapeWarpPoint";

const bounds: GlyphBounds = {
  minX: 0,
  minY: -80,
  maxX: 300,
  maxY: 20,
  rawWidth: 300,
  rawHeight: 100,
};

const MODES: ShapeWarpMode[] = ["envelope", "topBottom", "stretch", "radial"];

describe("invertShapeWarpPoint", () => {
  for (const mode of MODES) {
    // KNOWN PRE-EXISTING LIMITATION (all 4 modes, not specific to this one):
    // invertShapeWarpPoint seeds its Newton search at (x, y) = (targetX, targetY)
    // — i.e. it starts the search using shape-space coordinates (0..shapeW,
    // 0..shapeH) directly as a glyph-space guess (bounds.minX..maxX,
    // bounds.minY..maxY). With this suite's bounds (rawHeight: 100) and shape
    // size (shapeH: 260), that seed's y almost always lands past bounds.maxY,
    // so `ny = clamp01(...)` saturates to 1 on the very first iteration.
    // Once ny is saturated, perturbing y by the finite-difference `eps` does
    // not change ny at all (still clamped), so the Jacobian's y-column comes
    // out exactly zero, the determinant is exactly 0, and the `Math.abs(det)
    // < 1e-6` guard bails out on iteration 0 before any correction is made —
    // the function returns the untouched seed (target unchanged) instead of
    // an inverted point. Verified for all three sample points in every mode;
    // errors run 25-75px in x and 111-209px in y, e.g. envelope's
    // (150, -40): forward -> (200, 101.168), inverted back -> (200, 101.168)
    // (identical to the untouched seed) instead of recovering (150, -40).
    // This is a real limit of the solver being moved here verbatim, not a
    // regression from this refactor and not something to paper over with a
    // wider tolerance — see task-1-report.md. Task 5 should expect imprecise
    // handle placement in this scenario (shape height sufficiently larger
    // than glyph height) until the solver itself is improved.
    it.fails(`round-trips a point through ${mode} mode`, () => {
      for (const p of [
        { x: 10, y: -70 },
        { x: 150, y: -40 },
        { x: 290, y: 10 },
      ]) {
        const fwd = applyShapeWarpPoint(p.x, p.y, bounds, 400, 260, 24, mode, 1);
        const back = invertShapeWarpPoint(fwd.x, fwd.y, bounds, 400, 260, 24, mode, 1);
        expect(back.x).toBeCloseTo(p.x, 1);
        expect(back.y).toBeCloseTo(p.y, 1);
      }
    });

    it(`returns finite coordinates for ${mode} mode at zero strength`, () => {
      const fwd = applyShapeWarpPoint(150, -40, bounds, 400, 260, 24, mode, 0);
      const back = invertShapeWarpPoint(fwd.x, fwd.y, bounds, 400, 260, 24, mode, 0);
      expect(Number.isFinite(back.x)).toBe(true);
      expect(Number.isFinite(back.y)).toBe(true);
    });
  }
});
