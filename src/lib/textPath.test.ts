import { describe, it, expect } from "vitest";
import { parseSvgPath } from "./svgPath";
import { pathLength, pointAtArcLength, arcPathD, wavePathD, circlePathD } from "./textPath";

describe("pathLength", () => {
  it("measures a straight line exactly", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    expect(pathLength(cmds)).toBeCloseTo(100, 5);
  });

  it("approximates a quarter-circle arc within 1%", () => {
    const R = 100;
    const k = 0.5522847498;
    const d = `M ${R} 0 C ${R} ${R * k} ${R * k} ${R} 0 ${R}`;
    const cmds = parseSvgPath(d);
    const expected = (Math.PI / 2) * R;
    expect(pathLength(cmds)).toBeGreaterThan(expected * 0.99);
    expect(pathLength(cmds)).toBeLessThan(expected * 1.01);
  });
});

describe("pointAtArcLength", () => {
  it("returns the start point at s=0, unreversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 0, false);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.angle).toBeCloseTo(0, 5);
  });

  it("returns the end point at s=length, unreversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 100, false);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("interpolates the midpoint, unreversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 50, false);
    expect(p.x).toBeCloseTo(50, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("anchors s=0 to the curve's end point when reversed", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 0, true);
    expect(p.x).toBeCloseTo(100, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it("clamps s beyond the path length to the end point", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, 500, false);
    expect(p.x).toBeCloseTo(100, 5);
  });

  it("clamps negative s to the start point", () => {
    const cmds = parseSvgPath("M 0 0 L 100 0");
    const p = pointAtArcLength(cmds, -50, false);
    expect(p.x).toBeCloseTo(0, 5);
  });
});

describe("arcPathD", () => {
  it("starts and ends at the given width, height", () => {
    const cmds = parseSvgPath(arcPathD(200, 50));
    expect(cmds[0]).toMatchObject({ type: "M", x: 0, y: 50 });
    const last = cmds[cmds.length - 1] as { x: number; y: number };
    expect(last.x).toBeCloseTo(200, 5);
    expect(last.y).toBeCloseTo(50, 5);
  });
});

describe("wavePathD", () => {
  it("starts at the origin and ends at the given width, mid-height", () => {
    const cmds = parseSvgPath(wavePathD(400, 100));
    expect(cmds[0]).toMatchObject({ type: "M", x: 0, y: 50 });
    const last = cmds[cmds.length - 1] as { x: number; y: number };
    expect(last.x).toBeCloseTo(400, 5);
    expect(last.y).toBeCloseTo(50, 5);
  });
});

describe("circlePathD", () => {
  it("produces a path whose length is close to 3/4 of the circle's circumference", () => {
    const r = 100;
    const cmds = parseSvgPath(circlePathD(2 * r, 2 * r));
    const expected = 1.5 * Math.PI * r; // 270° of circumference 2*pi*r
    const length = pathLength(cmds);
    expect(length).toBeGreaterThan(expected * 0.98);
    expect(length).toBeLessThan(expected * 1.02);
  });
});

import { anchorsToD, dToAnchors, type CurveAnchor } from "./textPath";

describe("anchorsToD / dToAnchors round-trip", () => {
  it("round-trips a two-anchor straight segment (corner points, zero-length handles)", () => {
    const anchors: CurveAnchor[] = [
      { x: 0, y: 0, handleX: 0, handleY: 0 },
      { x: 100, y: 0, handleX: 100, handleY: 0 },
    ];
    const d = anchorsToD(anchors);
    const back = dToAnchors(parseSvgPath(d));
    expect(back).toHaveLength(2);
    expect(back[0]).toMatchObject({ x: 0, y: 0 });
    expect(back[1]).toMatchObject({ x: 100, y: 0 });
  });

  it("round-trips a curved segment with an authored handle", () => {
    const anchors: CurveAnchor[] = [
      { x: 0, y: 0, handleX: 20, handleY: -30 },
      { x: 100, y: 0, handleX: 100, handleY: 0 },
    ];
    const d = anchorsToD(anchors);
    const back = dToAnchors(parseSvgPath(d));
    expect(back[0]).toMatchObject({ x: 0, y: 0, handleX: 20, handleY: -30 });
    expect(back[1].x).toBeCloseTo(100, 5);
    expect(back[1].y).toBeCloseTo(0, 5);
  });

  it("produces a single-point path for one anchor", () => {
    const d = anchorsToD([{ x: 5, y: 5, handleX: 5, handleY: 5 }]);
    expect(d).toBe("M 5 5");
  });

  it("returns an empty anchor list for an empty path", () => {
    expect(dToAnchors([])).toEqual([]);
  });
});
