import { describe, it, expect } from "vitest";
import {
  toSegments, fromSegments, transformPt, transformCmds, transformFace, splitAtCut, cmdsCentre,
} from "./stackGeometry";
import { flattenContours } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";

/** A 100×20 bar from (0,-10) to (100,10): one straight horizontal stroke. */
const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: -10 }, { type: "L", x: 100, y: -10 },
  { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
];

const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

describe("segments", () => {
  it("round-trips commands, closing an open contour with an explicit edge", () => {
    const segs = toSegments(BAR);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toHaveLength(4);
    expect(area(fromSegments(segs))).toBeCloseTo(2000, 6);
  });
});

describe("transform", () => {
  const t = { x: 5, y: 7, rotation: Math.PI / 2, pivot: [50, 0] as [number, number] };
  it("rotates about the pivot then translates", () => {
    const p = transformPt([100, 0], t);
    expect(p[0]).toBeCloseTo(55, 9);
    expect(p[1]).toBeCloseTo(57, 9);
  });
  it("moves a face's points and turns its tangent", () => {
    const f = transformFace({ a: [100, -10], b: [100, 10], tangent: 0 }, t);
    expect(f.tangent).toBeCloseTo(Math.PI / 2, 9);
    expect(f.a[0]).toBeCloseTo(65, 9);
  });
  it("keeps the area of a transformed outline", () => {
    expect(area(transformCmds(BAR, t))).toBeCloseTo(2000, 6);
  });
  it("transforms a bridge edge and the matching face to bit-identical points", () => {
    const u = { x: 13.7, y: -9.1, rotation: 0.7, pivot: [33, -4] as [number, number] };
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const segs = toSegments(r.near)[0];
    const idx = segs.findIndex((s) => s.type === "L" && s.p[0][0] === 40 && s.p[1][0] === 40);
    expect(idx).toBeGreaterThanOrEqual(0);
    const moved = toSegments(transformCmds(r.near, u))[0][idx].p;
    const f = transformFace(r.nearFace, u);
    const aFirst = segs[idx].p[0][1] === r.nearFace.a[1];
    expect(moved).toEqual(aFirst ? [f.a, f.b] : [f.b, f.a]);
  });
  it("centres on the outline's bounds", () => {
    expect(cmdsCentre(BAR)).toEqual([50, 0]);
  });
});

describe("splitAtCut", () => {
  it("splits a bar into two closed halves whose areas sum to the whole", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 });
    expect(r).not.toBeNull();
    expect(area(r!.near)).toBeCloseTo(800, 6);
    expect(area(r!.far)).toBeCloseTo(1200, 6);
  });
  it("reports the same two face points on both halves, tangents opposed", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const xs = [r.nearFace.a, r.nearFace.b].map((p) => p[0]);
    expect(xs).toEqual([40, 40]);
    expect(r.farFace.a).toEqual(r.nearFace.a);
    expect(r.farFace.b).toEqual(r.nearFace.b);
    expect(Math.abs(r.farFace.tangent - r.nearFace.tangent)).toBeCloseTo(Math.PI, 9);
    expect(r.nearFace.tangent).toBe(0);
  });
  it("closes each half with a straight bridge between the face points", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const isBridge = (s: { type: string; p: [number, number][] }) =>
      s.type === "L" && s.p[0][0] === 40 && s.p[1][0] === 40;
    expect(toSegments(r.near)[0].some(isBridge)).toBe(true);
    expect(toSegments(r.far)[0].some(isBridge)).toBe(true);
  });
  it("puts the bridge edge's endpoints exactly on the face points of a tilted cut", () => {
    const tilted = transformCmds(BAR, { x: 0, y: 0, rotation: 0.3, pivot: [0, 0] });
    const r = splitAtCut(tilted, { cutX: 40, angle: 0.3 })!;
    const isFace = (q: [number, number]) =>
      [r.nearFace.a, r.nearFace.b].some((f) => f[0] === q[0] && f[1] === q[1]);
    const bridge = toSegments(r.near)[0].find(
      (s) => s.type === "L" && isFace(s.p[0]) && isFace(s.p[1])
    );
    expect(bridge).toBeDefined();
    expect(bridge!.p[0]).not.toEqual(bridge!.p[1]);
  });
  it("cuts an inclined bar in its own frame", () => {
    const tilted = transformCmds(BAR, { x: 0, y: 0, rotation: 0.3, pivot: [0, 0] });
    const r = splitAtCut(tilted, { cutX: 40, angle: 0.3 })!;
    expect(area(r.near) + area(r.far)).toBeCloseTo(2000, 4);
    expect(r.nearFace.tangent).toBeCloseTo(0.3, 9);
  });
  it("splits a curved edge without losing area", () => {
    const curved: SvgCmd[] = [
      { type: "M", x: 0, y: -10 },
      { type: "C", x1: 30, y1: -20, x2: 70, y2: -20, x: 100, y: -10 },
      { type: "L", x: 100, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" },
    ];
    const whole = area(curved);
    const r = splitAtCut(curved, { cutX: 50, angle: 0 })!;
    expect(Math.abs(area(r.near) + area(r.far) - whole) / whole).toBeLessThan(0.005);
  });
  it("sends an uncrossed contour whole to the side it lies on", () => {
    const withDot: SvgCmd[] = [
      ...BAR,
      { type: "M", x: 80, y: -30 }, { type: "L", x: 90, y: -30 },
      { type: "L", x: 90, y: -20 }, { type: "L", x: 80, y: -20 }, { type: "Z" },
    ];
    const r = splitAtCut(withDot, { cutX: 40, angle: 0 })!;
    expect(toSegments(r.near)).toHaveLength(1);
    expect(toSegments(r.far)).toHaveLength(2);
  });
  it("returns null when the cut line crosses a contour other than twice", () => {
    // A U shape: x=40 crosses it four times.
    const u: SvgCmd[] = [
      { type: "M", x: 0, y: -30 }, { type: "L", x: 100, y: -30 }, { type: "L", x: 100, y: 30 },
      { type: "L", x: 0, y: 30 }, { type: "L", x: 0, y: 10 }, { type: "L", x: 80, y: 10 },
      { type: "L", x: 80, y: -10 }, { type: "L", x: 0, y: -10 }, { type: "Z" },
    ];
    expect(splitAtCut(u, { cutX: 40, angle: 0 })).toBeNull();
  });
});
