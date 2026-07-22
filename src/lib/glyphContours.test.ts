import { describe, it, expect } from "vitest";
import type { PathCommand } from "opentype.js";
import { splitContours, deriveContourMask } from "./glyphContours";

// Two disjoint 10x10 squares: square A at (0,0)-(10,10), square B at (100,0)-(110,10).
const twoSquares: PathCommand[] = [
  { type: "M", x: 0, y: 0 },
  { type: "L", x: 10, y: 0 },
  { type: "L", x: 10, y: 10 },
  { type: "L", x: 0, y: 10 },
  { type: "Z" },
  { type: "M", x: 100, y: 0 },
  { type: "L", x: 110, y: 0 },
  { type: "L", x: 110, y: 10 },
  { type: "L", x: 100, y: 10 },
  { type: "Z" },
];

describe("splitContours", () => {
  it("splits path commands into one array per M...Z run", () => {
    const contours = splitContours(twoSquares);
    expect(contours).toHaveLength(2);
    expect(contours[0]).toHaveLength(5);
    expect(contours[1]).toHaveLength(5);
  });
});

describe("deriveContourMask", () => {
  it("resolves a point inside square A to contour 0", () => {
    const mask = deriveContourMask(twoSquares, [{ x: 5, y: 5 }]);
    expect(mask).toEqual({ mode: "contours", contourIndices: [0] });
  });

  it("resolves a point inside square B to contour 1", () => {
    const mask = deriveContourMask(twoSquares, [{ x: 105, y: 5 }]);
    expect(mask).toEqual({ mode: "contours", contourIndices: [1] });
  });

  it("unions contours across multiple points (anchor in A, drag in B)", () => {
    const mask = deriveContourMask(twoSquares, [
      { x: 5, y: 5 },
      { x: 105, y: 5 },
    ]);
    expect(mask).toEqual({ mode: "contours", contourIndices: [0, 1] });
  });

  it("returns undefined when no point lands inside any contour", () => {
    const mask = deriveContourMask(twoSquares, [{ x: 50, y: 50 }]);
    expect(mask).toBeUndefined();
  });
});
