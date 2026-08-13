import { describe, it, expect } from "vitest";
import { insideContours, joinGuard, overlapCentroid, type JoinPin } from "./joinPins";

/** Axis-aligned rectangle as a closed polygon, in the [x, y] pair form svgPath uses. */
const rect = (
  x: number,
  y: number,
  w: number,
  h: number
): Array<[number, number]> => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
  [x, y],
];

describe("insideContours", () => {
  it("uses the even-odd rule, so a counter is outside the letter", () => {
    const outer = rect(0, 0, 100, 100);
    const counter = rect(40, 40, 20, 20);
    expect(insideContours(10, 10, [outer, counter])).toBe(true);
    expect(insideContours(50, 50, [outer, counter])).toBe(false);
    expect(insideContours(200, 200, [outer, counter])).toBe(false);
  });
});

describe("overlapCentroid", () => {
  it("finds the middle of the region two shapes share", () => {
    const a = [rect(0, 0, 100, 100)];
    const b = [rect(80, 0, 100, 100)];
    const c = overlapCentroid(a, b);
    expect(c).not.toBeNull();
    // Shared strip is x in [80, 100], y in [0, 100].
    expect(c!.x).toBeGreaterThan(80);
    expect(c!.x).toBeLessThan(100);
    expect(c!.y).toBeCloseTo(50, 0);
  });

  it("returns null when the shapes do not touch", () => {
    expect(overlapCentroid([rect(0, 0, 10, 10)], [rect(50, 50, 10, 10)])).toBeNull();
  });

  it("returns null when their bounding boxes overlap but their ink does not", () => {
    // An L, and a square sitting in the L's notch. The bounding boxes
    // overlap almost completely; the ink does not touch at all. This is the
    // case a naive bounding-box test would call a join.
    const ell: Array<[number, number]> = [
      [0, 0],
      [100, 0],
      [100, 20],
      [20, 20],
      [20, 100],
      [0, 100],
      [0, 0],
    ];
    expect(overlapCentroid([ell], [rect(40, 40, 50, 50)])).toBeNull();
  });
});

describe("joinGuard", () => {
  const pin: JoinPin = { x: 0, y: 0, radius: 10 };

  it("is 1 — full displacement — with no pins at all", () => {
    expect(joinGuard(5, 5, undefined)).toBe(1);
    expect(joinGuard(5, 5, [])).toBe(1);
  });

  it("is exactly 0 at the pin, so the join cannot move at all", () => {
    expect(joinGuard(0, 0, [pin])).toBe(0);
  });

  it("is 1 outside the pin radius, so the rest of the letter is untouched", () => {
    expect(joinGuard(10, 0, [pin])).toBe(1);
    expect(joinGuard(40, 0, [pin])).toBe(1);
  });

  it("ramps smoothly between, with no crease at the release point", () => {
    const mid = joinGuard(5, 0, [pin]);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    // smoothstep is flat at both ends: near the boundary it approaches 1
    // faster than a straight line would.
    expect(joinGuard(9, 0, [pin])).toBeGreaterThan(0.9);
    expect(joinGuard(1, 0, [pin])).toBeLessThan(0.1);
  });

  it("takes the strictest pin when a point sits near two joins", () => {
    const pins: JoinPin[] = [pin, { x: 6, y: 0, radius: 10 }];
    expect(joinGuard(3, 0, pins)).toBeLessThanOrEqual(joinGuard(3, 0, [pin]));
  });
});
