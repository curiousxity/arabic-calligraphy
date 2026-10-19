import { describe, expect, it } from "vitest";
import { assembleRun, joinCubic } from "./penJoin";
import { NUQTA, type Form, type Part, type PenLibrary } from "./penLibrary";
import type { PenPath, Pt } from "./penSweep";

type C = [Pt, Pt, Pt, Pt];
const curvatureAt = (c: C, t: number) => {
  const u = 1 - t;
  const d1: Pt = [3 * u * u * (c[1][0] - c[0][0]) + 6 * u * t * (c[2][0] - c[1][0]) + 3 * t * t * (c[3][0] - c[2][0]), 3 * u * u * (c[1][1] - c[0][1]) + 6 * u * t * (c[2][1] - c[1][1]) + 3 * t * t * (c[3][1] - c[2][1])];
  const d2: Pt = [6 * u * (c[2][0] - 2 * c[1][0] + c[0][0]) + 6 * t * (c[3][0] - 2 * c[2][0] + c[1][0]), 6 * u * (c[2][1] - 2 * c[1][1] + c[0][1]) + 6 * t * (c[3][1] - 2 * c[2][1] + c[1][1])];
  return (d1[0] * d2[1] - d1[1] * d2[0]) / Math.hypot(d1[0], d1[1]) ** 3;
};
/** Degrees between the tangent arriving at the end of segment k-1 and the one leaving at the start of segment k. */
const turnDeg = (path: PenPath, k: number) => {
  const prev = path.segs[k - 1], seg = path.segs[k];
  const node = prev.to.p;
  const inc: Pt = [node[0] - prev.c2[0], node[1] - prev.c2[1]], out: Pt = [seg.c1[0] - node[0], seg.c1[1] - node[1]];
  return (Math.acos(Math.max(-1, Math.min(1, (inc[0] * out[0] + inc[1] * out[1]) / Math.hypot(...inc) / Math.hypot(...out)))) * 180) / Math.PI;
};

// A three-letter run: a tooth that descends and turns left, a middle bowl, a finishing flat.
const parts: Part[] = [
  { id: "tooth", name: "tooth", paths: [{ start: { p: [0, -2] }, segs: [{ c1: [0, -1], c2: [-0.2, 0], to: { p: [-1, 0] } }] }] },
  { id: "mid", name: "mid", paths: [{ start: { p: [0, 0] }, segs: [{ c1: [-1, 0.5], c2: [-2, 0.5], to: { p: [-3, 0] } }] }] },
  { id: "flat", name: "flat", paths: [{ start: { p: [0, 0] }, segs: [{ c1: [-1, 0], c2: [-2, 0.3], to: { p: [-3, 0.2] } }] }] },
];
const anchors = { above: [0, -1] as Pt, below: [0, 1] as Pt };
const forms: Form[] = [
  { id: "t.starting", letter: "ب", form: "starting", parts: [{ part: "tooth", at: [0, 0], body: true }], dots: [[-0.5, 1]], anchors },
  { id: "t.middle", letter: "ب", form: "middle", parts: [{ part: "mid", at: [0, 0], body: true }], anchors },
  { id: "t.finishing", letter: "ب", form: "finishing", parts: [{ part: "flat", at: [0, 0], body: true }], anchors },
];
const fixture: PenLibrary = { parts: new Map(parts.map((p) => [p.id, p])), forms: new Map(forms.map((f) => [f.id, f])), joins: { "*": { gap: 0.5, rise: 0 } } };

describe("joins and the word as one pen path", () => {
  it("joins with matching direction and curvature at both ends", () => {
    const { c1, c2, g2 } = joinCubic([0, 0], [-1, 0], 0.004, [-200, -60], [-1, 0.3], -0.002);
    expect(g2).toBe(true);
    const c: C = [[0, 0], c1, c2, [-200, -60]];
    expect(curvatureAt(c, 0)).toBeCloseTo(0.004, 4);
    expect(curvatureAt(c, 1)).toBeCloseTo(-0.002, 4);
  });

  it("falls back to chord-thirds when no positive handles match the curvatures", () => {
    const { c1, c2, g2 } = joinCubic([0, 0], [-1, 0], 0.5, [-200, 0], [-1, 0], 0.5);
    expect(g2).toBe(false);
    expect(Math.hypot(c1[0], c1[1])).toBeCloseTo(200 / 3, 6);
    expect(Math.hypot(c2[0] + 200, c2[1])).toBeCloseTo(200 / 3, 6);
  });

  it("assembles a connected run into one body path with no corner at any join", () => {
    const run = assembleRun(fixture, ["t.starting", "t.middle", "t.finishing"], [{ gap: 0.5, rise: 0 }, { gap: 0.3, rise: 1 }], [0, 0]);
    expect(run.body!.segs).toHaveLength(5);
    expect(run.joinSegs).toEqual([1, 3]);
    for (const k of run.joinSegs) {
      expect(turnDeg(run.body!, k)).toBeLessThan(0.5);
      expect(turnDeg(run.body!, k + 1)).toBeLessThan(0.5);
    }
    expect(run.dots).toHaveLength(1);
  });

  it("climbs: a positive rise places the next letter higher", () => {
    const flat = assembleRun(fixture, ["t.starting", "t.middle"], [{ gap: 0.5, rise: 0 }], [0, 0]);
    const up = assembleRun(fixture, ["t.starting", "t.middle"], [{ gap: 0.5, rise: 1 }], [0, 0]);
    expect(up.origins[1][1] - flat.origins[1][1]).toBeCloseTo(-NUQTA, 6);
    expect(up.origins[1][0]).toBeCloseTo(flat.origins[1][0], 6);
  });
});
