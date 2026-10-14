import { describe, it, expect } from "vitest";
import { parseSvgPath, pathToPolygon } from "./svgPath";
import { buildArcTable, pathBoundingBox, pathLength, pointAtArcLengthFromTable } from "./textPath";
import { GUIDE_DEFAULTS, guidePathD, isClosedPath } from "./guideShapes";
import type { GuideShape } from "../types";

const SHAPES: GuideShape[] = ["circle", "ellipse", "arc", "wave", "line", "pen", "teardrop", "almond"];

describe("guidePathD", () => {
  it("builds a parseable path for every shape", () => {
    for (const s of SHAPES) {
      const cmds = parseSvgPath(guidePathD(s, GUIDE_DEFAULTS[s]));
      expect(cmds.length).toBeGreaterThanOrEqual(2);
      expect(pathLength(cmds)).toBeGreaterThan(0);
    }
  });

  it("closes circle and ellipse, and leaves the others open", () => {
    const closed = (s: GuideShape) => isClosedPath(parseSvgPath(guidePathD(s, GUIDE_DEFAULTS[s])));
    expect(closed("circle")).toBe(true);
    expect(closed("ellipse")).toBe(true);
    expect(closed("arc")).toBe(false);
    expect(closed("wave")).toBe(false);
    expect(closed("line")).toBe(false);
    expect(closed("pen")).toBe(false);
  });

  it("gives a circle its circumference to within 1%", () => {
    const cmds = parseSvgPath(guidePathD("circle", { width: 300 }));
    expect(Math.abs(pathLength(cmds) - Math.PI * 300) / (Math.PI * 300)).toBeLessThan(0.01);
  });

  it("is centred on the origin", () => {
    const box = pathBoundingBox(parseSvgPath(guidePathD("ellipse", { width: 360, height: 240 })));
    expect(box.x + box.width / 2).toBeCloseTo(0, 0);
    expect(box.y + box.height / 2).toBeCloseTo(0, 0);
    expect(box.width).toBeCloseTo(360, 0);
    expect(box.height).toBeCloseTo(240, 0);
  });

  it("starts a circle at the top centre and runs clockwise (rightward first)", () => {
    const table = buildArcTable(parseSvgPath(guidePathD("circle", { width: 200 })), false);
    const p0 = pointAtArcLengthFromTable(table, 0);
    const p1 = pointAtArcLengthFromTable(table, 5);
    expect(p0.x).toBeCloseTo(0, 3);
    expect(p0.y).toBeCloseTo(-100, 3);
    expect(p1.x).toBeGreaterThan(0);
  });

  it("sets an arc's length from its sweep", () => {
    const len = (sweep: number) => pathLength(parseSvgPath(guidePathD("arc", { width: 200, sweep })));
    expect(len(180) / (Math.PI * 100)).toBeCloseTo(1, 2);
    expect(len(90) / len(180)).toBeCloseTo(0.5, 2);
  });

  it("makes a wave about twice its amplitude tall", () => {
    const box = pathBoundingBox(parseSvgPath(guidePathD("wave", { width: 400, amplitude: 50 })));
    expect(box.height).toBeGreaterThan(80);
    expect(box.height).toBeLessThan(110);
  });

  it("teardrop and almond are closed, centred, start at the top, and match their size", () => {
    for (const s of ["teardrop", "almond"] as const) {
      const cmds = parseSvgPath(guidePathD(s, GUIDE_DEFAULTS[s]));
      expect(isClosedPath(cmds)).toBe(true);
      const first = cmds[0];
      expect(first.type).toBe("M");
      if (first.type === "M") { expect(first.x).toBeCloseTo(0, 6); expect(first.y).toBeCloseTo(-(GUIDE_DEFAULTS[s].height ?? 0) / 2, 6); }
      const poly = pathToPolygon(cmds, 16);
      const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(GUIDE_DEFAULTS[s].width ?? 0, 0);
      expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(GUIDE_DEFAULTS[s].height ?? 0, 0);
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(0, 0);
    }
  });
});
