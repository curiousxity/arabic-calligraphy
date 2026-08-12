import { describe, expect, it } from "vitest";
import {
  buildSnapTargets,
  computeSnap,
  rectEdges,
  type Rect,
  type SnapTarget,
} from "./snapping";

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
});

const ARTBOARD = rect(0, 0, 1000, 1000);
const NO_GUIDES = { horizontal: [], vertical: [] };

describe("rectEdges", () => {
  it("returns near edge, centre and far edge on both axes", () => {
    expect(rectEdges(rect(10, 20, 100, 50))).toEqual({
      x: [10, 60, 110],
      y: [20, 45, 70],
    });
  });
});

describe("computeSnap", () => {
  it("snaps a dragged right edge flush to another block's left edge", () => {
    const other = rect(300, 0, 100, 100);
    const targets = buildSnapTargets([other], ARTBOARD, NO_GUIDES);
    // Right edge at 297 — three short of the other block's left edge.
    const result = computeSnap(rect(197, 0, 100, 100), targets, 6);
    expect(result.dx).toBe(3);
    expect(result.dy).toBe(0);
  });

  it("snaps centre to centre", () => {
    const other = rect(0, 500, 200, 100);
    const targets = buildSnapTargets([other], ARTBOARD, NO_GUIDES);
    // A tall block whose own top and bottom are nowhere near the other's, so
    // only the centre pair is in range: dragged centre 552, other's 550.
    const result = computeSnap(rect(0, 402, 40, 300), targets, 6);
    expect(result.dy).toBe(-2);
  });

  it("leaves a rect alone when every target is outside the threshold", () => {
    const other = rect(400, 400, 100, 100);
    const targets = buildSnapTargets([other], rect(-5000, -5000, 20000, 20000), NO_GUIDES);
    const result = computeSnap(rect(100, 100, 50, 50), targets, 6);
    expect(result).toEqual({ dx: 0, dy: 0, lines: [] });
  });

  it("picks the closer of two competing targets", () => {
    const targets: SnapTarget[] = [
      { axis: "x", position: 105, kind: "edge", span: { from: 0, to: 10 } },
      { axis: "x", position: 102, kind: "edge", span: { from: 0, to: 10 } },
    ];
    const result = computeSnap(rect(100, 0, 0, 0), targets, 6);
    expect(result.dx).toBe(2);
  });

  it("snaps to the artboard's edge", () => {
    const targets = buildSnapTargets([], ARTBOARD, NO_GUIDES);
    const result = computeSnap(rect(4, 4, 100, 100), targets, 6);
    expect(result.dx).toBe(-4);
    expect(result.dy).toBe(-4);
  });

  it("snaps to a user's ruler guide", () => {
    const targets = buildSnapTargets([], ARTBOARD, { horizontal: [], vertical: [250] });
    const result = computeSnap(rect(247, 400, 100, 100), targets, 6);
    expect(result.dx).toBe(3);
    expect(result.lines[0]).toMatchObject({ axis: "x", position: 250 });
  });

  describe("tie-breaking between equidistant targets", () => {
    const equidistant = (kinds: SnapTarget["kind"][]): SnapTarget[] =>
      kinds.map((kind) => ({ axis: "x" as const, position: 100, kind }));

    it("prefers a user guide over every other kind", () => {
      const targets = [
        ...equidistant(["center", "edge", "artboard"]),
        { axis: "x" as const, position: 100, kind: "guide" as const },
      ];
      const result = computeSnap(rect(96, 0, 0, 0), targets, 6);
      expect(result.dx).toBe(4);
      expect(result.lines[0].position).toBe(100);
    });

    it("prefers an artboard edge over a block edge or centre", () => {
      const targets: SnapTarget[] = [
        { axis: "x", position: 100, kind: "center", span: { from: 0, to: 5 } },
        { axis: "x", position: 100, kind: "edge", span: { from: 10, to: 20 } },
        { axis: "x", position: 100, kind: "artboard", span: { from: 30, to: 40 } },
      ];
      const result = computeSnap(rect(96, 0, 0, 0), targets, 6);
      expect(result.lines[0]).toMatchObject({ from: 0, to: 40 });
    });

    it("prefers a block edge over a block centre", () => {
      const targets: SnapTarget[] = [
        { axis: "x", position: 100, kind: "center", span: { from: 0, to: 5 } },
        { axis: "x", position: 100, kind: "edge", span: { from: 60, to: 80 } },
      ];
      const result = computeSnap(rect(96, 0, 0, 0), targets, 6);
      expect(result.lines[0]).toMatchObject({ from: 0, to: 80 });
    });
  });

  it("spans the returned line across both the dragged rect and its target", () => {
    const other = rect(300, 500, 100, 100);
    const targets = buildSnapTargets([other], ARTBOARD, NO_GUIDES);
    const result = computeSnap(rect(197, 0, 100, 50), targets, 6);
    const line = result.lines.find((l) => l.axis === "x");
    // Vertical line at x=300, tall enough to reach from the dragged rect's top
    // (y=0) down to the other block's bottom (y=600) — not the full canvas.
    expect(line).toEqual({ axis: "x", position: 300, from: 0, to: 600 });
  });

  it("uses only the dragged rect's extent for a guide, which is already full-length", () => {
    const targets = buildSnapTargets([], ARTBOARD, { horizontal: [200], vertical: [] });
    const result = computeSnap(rect(50, 197, 100, 40), targets, 6);
    expect(result.lines).toEqual([
      { axis: "y", position: 200, from: 50, to: 150 },
    ]);
  });

  it("returns at most one snap per axis", () => {
    const targets = buildSnapTargets(
      [rect(300, 0, 100, 100), rect(302, 0, 100, 100)],
      ARTBOARD,
      NO_GUIDES
    );
    const result = computeSnap(rect(197, 400, 100, 100), targets, 6);
    expect(result.lines.filter((l) => l.axis === "x")).toHaveLength(1);
  });
});

describe("buildSnapTargets", () => {
  it("emits three lines per axis for each block plus the artboard", () => {
    const targets = buildSnapTargets([rect(0, 0, 10, 10)], ARTBOARD, NO_GUIDES);
    expect(targets.filter((t) => t.axis === "x")).toHaveLength(6);
    expect(targets.filter((t) => t.kind === "artboard")).toHaveLength(6);
  });

  it("tags ruler guides on the axis they constrain", () => {
    const targets = buildSnapTargets([], ARTBOARD, { horizontal: [5], vertical: [7] });
    expect(targets.filter((t) => t.kind === "guide")).toEqual([
      { axis: "x", position: 7, kind: "guide" },
      { axis: "y", position: 5, kind: "guide" },
    ]);
  });
});
