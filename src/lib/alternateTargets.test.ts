import { describe, it, expect } from "vitest";
import {
  hitTestTargets,
  pointInPolygon,
  polygonBounds,
  polygonCentre,
  quadFromBox,
  type Point,
} from "./alternateTargets";

const rotated = (cx: number, cy: number, w: number, h: number, deg: number): Point[] => {
  const r = (deg * Math.PI) / 180;
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({
    x: cx + x * Math.cos(r) - y * Math.sin(r),
    y: cy + x * Math.sin(r) + y * Math.cos(r),
  }));
};

describe("quadFromBox", () => {
  it("returns the four corners, padded", () => {
    expect(quadFromBox({ x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual([
      { x: 8, y: 18 },
      { x: 42, y: 18 },
      { x: 42, y: 62 },
      { x: 8, y: 62 },
    ]);
  });
});

describe("pointInPolygon", () => {
  const square = quadFromBox({ x: 0, y: 0, width: 10, height: 10 });

  it("tells inside from outside", () => {
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false);
  });

  it("follows a rotated quad, not its axis-aligned box", () => {
    // A 20×4 bar turned 45°: its bounding box corner is outside the bar.
    const bar = rotated(50, 50, 20, 4, 45);
    expect(pointInPolygon({ x: 50, y: 50 }, bar)).toBe(true);
    expect(pointInPolygon({ x: 56, y: 56 }, bar)).toBe(true);
    expect(pointInPolygon({ x: 57, y: 43 }, bar)).toBe(false);
  });
});

describe("hitTestTargets", () => {
  const a = { key: "a", polygon: quadFromBox({ x: 0, y: 0, width: 20, height: 20 }) };
  const b = { key: "b", polygon: quadFromBox({ x: 10, y: 10, width: 20, height: 20 }) };

  it("returns the last overlapping target — the one drawn on top", () => {
    expect(hitTestTargets([a, b], { x: 15, y: 15 })?.key).toBe("b");
    expect(hitTestTargets([b, a], { x: 15, y: 15 })?.key).toBe("a");
  });

  it("returns the only match, and null outside every target", () => {
    expect(hitTestTargets([a, b], { x: 2, y: 2 })?.key).toBe("a");
    expect(hitTestTargets([a, b], { x: 100, y: 100 })).toBeNull();
    expect(hitTestTargets([], { x: 0, y: 0 })).toBeNull();
  });
});

describe("polygonBounds / polygonCentre", () => {
  it("spans every polygon, and is null for none", () => {
    expect(
      polygonBounds([quadFromBox({ x: 0, y: 0, width: 10, height: 10 }), quadFromBox({ x: 20, y: -5, width: 5, height: 5 })])
    ).toEqual({ x: 0, y: -5, width: 25, height: 15 });
    expect(polygonBounds([])).toBeNull();
  });

  it("centres a quad", () => {
    expect(polygonCentre(quadFromBox({ x: 0, y: 0, width: 10, height: 20 }))).toEqual({ x: 5, y: 10 });
  });
});
