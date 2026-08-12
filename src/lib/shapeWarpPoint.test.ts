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
    it(`round-trips a point through ${mode} mode`, () => {
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

    // Regression guard for the Newton seed. Seeding the search at
    // (targetX, targetY) puts the initial guess far outside the glyph-bounds
    // box whenever shape space and glyph space differ in scale — clamp01
    // saturates, the Jacobian's y-column goes to exactly zero, the det guard
    // bails on iteration 0, and the function silently returns its own seed.
    // A wide, short run warped into a tall shape is the worst case, so it is
    // what this pins. See invertShapeWarpPoint's doc comment.
    it(`inverts ${mode} mode when glyph and shape spaces differ in scale`, () => {
      const wideShortRun: GlyphBounds = {
        minX: 0,
        minY: -90,
        maxX: 820,
        maxY: 0,
        rawWidth: 820,
        rawHeight: 90,
      };
      const p = { x: 410, y: -45 };
      const fwd = applyShapeWarpPoint(p.x, p.y, wideShortRun, 400, 400, 20, mode, 1);
      const back = invertShapeWarpPoint(fwd.x, fwd.y, wideShortRun, 400, 400, 20, mode, 1);
      expect(back.x).toBeCloseTo(p.x, 1);
      expect(back.y).toBeCloseTo(p.y, 1);
    });
  }
});
