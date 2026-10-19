import { describe, expect, it } from "vitest";
import { polygonArea, sweepPath, type NibNode, type PenPath, type Pt } from "./penSweep";

const lerp = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const node = (x: number, y: number, angle = 90, extra: Partial<NibNode> = {}): NibNode => ({ p: [x, y], angle, ...extra });
const line = (a: NibNode, b: NibNode): PenPath => ({ start: a, segs: [{ c1: lerp(a.p, b.p, 1 / 3), c2: lerp(a.p, b.p, 2 / 3), to: b }] });

describe("the nib sweep", () => {
  it("sweeps a straight horizontal pull into a parallelogram of length x pen x sin(angle)", () => {
    const area = polygonArea(sweepPath(line(node(0, 0, 60), node(-300, 0, 60)), 48));
    const want = 300 * 48 * Math.sin(Math.PI / 3);
    expect(Math.abs(area - want) / want).toBeLessThan(0.01);
  });

  it("draws a downstroke thin and a horizontal thick with the nib near vertical", () => {
    const down = polygonArea(sweepPath(line(node(0, 0, 80), node(0, 300, 80)), 48));
    const across = polygonArea(sweepPath(line(node(0, 0, 80), node(-300, 0, 80)), 48));
    expect(down / across).toBeLessThan(0.2);
  });

  it("sweeps a nib turning in place into two quarter discs", () => {
    // no travel, angle 0 -> 90: area = pi * pen^2 / 8
    const p: PenPath = { start: node(0, 0, 0), segs: [{ c1: [0, 0], c2: [0, 0], to: node(0, 0, 90) }] };
    const r = polygonArea(sweepPath(p, 48)) / ((Math.PI * 48 * 48) / 8);
    expect(r).toBeGreaterThan(0.98);
    expect(r).toBeLessThan(1.03);
  });

  it("thins a pull written with a third of the nib, keeping the chosen end down", () => {
    const full = polygonArea(sweepPath(line(node(0, 0, 90), node(-300, 0, 90)), 48));
    const third = sweepPath(line(node(0, 0, 90, { width: 1 / 3, keep: "b" }), node(-300, 0, 90, { width: 1 / 3, keep: "b" })), 48);
    expect(polygonArea(third) / full).toBeCloseTo(1 / 3, 2);
    // "b" end down: the ink hugs the -direction side, below the centre line for angle 90 (y down)
    expect(Math.min(...third[0][0].map((q) => q[1]))).toBeGreaterThan(-1);
  });

  it("survives a stroke run along the nib", () => {
    const polys = sweepPath(line(node(0, 0, 0), node(-300, 0, 0)), 48);
    expect(polys.flat(2).every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))).toBe(true);
    expect(polygonArea(polys)).toBeLessThan(300 * 2);
  });

  it("sweeps a curve into one piece with no holes", () => {
    const p: PenPath = { start: node(0, 0, 70), segs: [{ c1: [-100, 120], c2: [-300, 120], to: node(-400, 0, 70) }] };
    const polys = sweepPath(p, 48);
    expect(polys).toHaveLength(1);
    expect(polys[0]).toHaveLength(1);
  });
});
