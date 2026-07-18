import { describe, it, expect } from "vitest";
import { warpPoint, type GlyphBounds } from "./warp";

const bounds: GlyphBounds = {
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: 100,
  rawWidth: 100,
  rawHeight: 100,
};

describe("warpPoint", () => {
  it("is a no-op when warpX and warpY are both zero", () => {
    const p = warpPoint(50, 50, bounds, 100, 100, 0, 0);
    expect(p.x).toBeCloseTo(50);
    expect(p.y).toBeCloseTo(50);
  });

  it("shifts x based on warpX and the point's normalized y position", () => {
    // At y = maxY (bottom edge), ny = 1, so the x shift is at its full strength.
    const bottom = warpPoint(50, 100, bounds, 100, 100, 100, 0);
    // At the vertical center, ny = 0, so there should be no x shift.
    const center = warpPoint(50, 50, bounds, 100, 100, 100, 0);
    expect(Math.abs(bottom.x - 50)).toBeGreaterThan(0);
    expect(center.x).toBeCloseTo(50);
  });

  it("clamps the offset once a point is past the bounds, instead of scaling further", () => {
    // ny (and the resulting x-offset) clamps once y reaches maxY, so a point far
    // below the bounds gets the same offset as one exactly at the bottom edge.
    const atBottom = warpPoint(50, 100, bounds, 100, 100, 100, 0);
    const farBelow = warpPoint(50, 10_000, bounds, 100, 100, 100, 0);
    expect(farBelow.x - 50).toBeCloseTo(atBottom.x - 50);
  });
});
