import { describe, it, expect } from "vitest";
import { parseSvgPath, pathToPolygon, pointInPolygon } from "./svgPath";

describe("parseSvgPath", () => {
  it("parses an absolute move+line+close", () => {
    const cmds = parseSvgPath("M0 0 L10 0 L10 10 Z");
    expect(cmds).toEqual([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
      { type: "Z" },
    ]);
  });

  it("resolves relative commands against the current point", () => {
    const cmds = parseSvgPath("m5 5 l10 0 l0 10 z");
    expect(cmds).toEqual([
      { type: "M", x: 5, y: 5 },
      { type: "L", x: 15, y: 5 },
      { type: "L", x: 15, y: 15 },
      { type: "Z" },
    ]);
  });

  it("expands horizontal and vertical lineto shorthands", () => {
    const cmds = parseSvgPath("M0 0 H10 V10");
    expect(cmds).toEqual([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
    ]);
  });

  it("parses cubic and quadratic curves", () => {
    const cmds = parseSvgPath("M0 0 C1 1 2 2 3 3 Q4 4 5 5");
    expect(cmds).toEqual([
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 1, y1: 1, x2: 2, y2: 2, x: 3, y: 3 },
      { type: "Q", x1: 4, y1: 4, x: 5, y: 5 },
    ]);
  });

  it("resets to the subpath start on Z, so a following relative move is correct", () => {
    const cmds = parseSvgPath("M0 0 L10 0 L10 10 Z m1 1 l1 0");
    // After Z, current point returns to (0,0); the relative "m1 1" moves to (1,1).
    expect(cmds[4]).toEqual({ type: "M", x: 1, y: 1 });
    expect(cmds[5]).toEqual({ type: "L", x: 2, y: 1 });
  });

  it("returns an empty array for an empty string or input with no command letters", () => {
    expect(parseSvgPath("")).toEqual([]);
    expect(parseSvgPath("1 2 3")).toEqual([]);
  });
});

describe("pathToPolygon", () => {
  it("passes M/L points through unchanged", () => {
    const poly = pathToPolygon([
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 10, y: 0 },
      { type: "L", x: 10, y: 10 },
    ]);
    expect(poly).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
  });

  it("subdivides a cubic curve into `steps` sample points", () => {
    const poly = pathToPolygon(
      [
        { type: "M", x: 0, y: 0 },
        { type: "C", x1: 0, y1: 10, x2: 10, y2: 10, x: 10, y: 0 },
      ],
      4
    );
    // 1 point from M, then 4 subdivided points from C
    expect(poly).toHaveLength(5);
    // The curve should end exactly at its declared endpoint.
    const [lastX, lastY] = poly[poly.length - 1];
    expect(lastX).toBeCloseTo(10);
    expect(lastY).toBeCloseTo(0);
  });
});

describe("pointInPolygon", () => {
  const square: Array<[number, number]> = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it("returns true for a point inside the polygon", () => {
    expect(pointInPolygon(5, 5, square)).toBe(true);
  });

  it("returns false for a point outside the polygon", () => {
    expect(pointInPolygon(15, 5, square)).toBe(false);
    expect(pointInPolygon(-5, 5, square)).toBe(false);
  });
});
