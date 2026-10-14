import { describe, it, expect } from "vitest";
import { joinCenterline, joinEdges, spliceJoin } from "./stackJoin";
import { splitAtCut, toSegments, fromSegments } from "./stackGeometry";
import { flattenContours } from "./strokeCuts";
import type { CutFace } from "../types";
import type { SvgCmd } from "./svgPath";

const A: CutFace = { a: [0, -10], b: [0, 10], tangent: 0 };
/** 100 to the right and 50 up, facing back. */
const B: CutFace = { a: [100, -60], b: [100, -40], tangent: Math.PI };
const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);

describe("joinCenterline", () => {
  it("starts and ends at the face midpoints, leaving and arriving along the tangents", () => {
    const [p0, p1, p2, p3] = joinCenterline(A, B, 0);
    expect(p0).toEqual([0, 0]);
    expect(p3).toEqual([100, -50]);
    expect(p1[1]).toBeCloseTo(0, 9);       // handle along A's tangent (+x)
    expect(p1[0]).toBeGreaterThan(0);
    expect(p2[1]).toBeCloseTo(-50, 9);     // handle along B's tangent (−x)
    expect(p2[0]).toBeLessThan(100);
  });
  it("bow lengthens both handles without turning them", () => {
    const [, p1a, p2a] = joinCenterline(A, B, 0);
    const [, p1b, p2b] = joinCenterline(A, B, 0.5);
    expect(p1b[0]).toBeGreaterThan(p1a[0]);
    expect(p2b[0]).toBeLessThan(p2a[0]);
    expect(p1b[1]).toBeCloseTo(0, 9);
  });
});

describe("joinEdges", () => {
  it("lands exactly on the four face points", () => {
    const { edgeA, edgeB } = joinEdges(A, B, 0, 3);
    expect(dist(edgeA[0], A.a)).toBeLessThan(1e-9);
    expect(dist(edgeB[0], A.b)).toBeLessThan(1e-9);
    expect(dist(edgeA[edgeA.length - 1], B.a)).toBeLessThan(1e-9);
    expect(dist(edgeB[edgeB.length - 1], B.b)).toBeLessThan(1e-9);
  });
  it("is full width where the curve crosses the nib and never thinner than the floor", () => {
    // Both faces have a vertical vector and face each other across a climb:
    // A leaves to the right, `up` sits 100 above and leaves to the left, so
    // the S-curve between them runs vertically — along the nib — mid-way.
    const up: CutFace = { a: [0, -110], b: [0, -90], tangent: Math.PI };
    const { edgeA, edgeB } = joinEdges(A, up, 0, 4, 40);
    // Thickness is what the eye sees: the edge-to-edge vector projected onto
    // the curve's normal, not its raw length (which stays ~20 on a vertical
    // nib however the curve turns).
    const thick: number[] = [];
    for (let i = 1; i < edgeA.length - 1; i++) {
      const c = (k: number): [number, number] => [(edgeA[k][0] + edgeB[k][0]) / 2, (edgeA[k][1] + edgeB[k][1]) / 2];
      const d = [c(i + 1)[0] - c(i - 1)[0], c(i + 1)[1] - c(i - 1)[1]];
      const len = Math.hypot(d[0], d[1]);
      const n = [-d[1] / len, d[0] / len];
      const v = [edgeB[i][0] - edgeA[i][0], edgeB[i][1] - edgeA[i][1]];
      thick.push(Math.abs(v[0] * n[0] + v[1] * n[1]));
    }
    expect(dist(edgeA[0], edgeB[0])).toBeCloseTo(20, 6);
    expect(Math.min(...thick)).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(Math.min(...thick)).toBeLessThan(20);   // it does thin on the climb
  });
  it("collapses to the face points when the faces coincide", () => {
    const { edgeA, edgeB } = joinEdges(A, { ...A, tangent: Math.PI }, 0, 3, 8);
    for (const p of edgeA) expect(dist(p, A.a)).toBeLessThan(1e-9);
    for (const p of edgeB) expect(dist(p, A.b)).toBeLessThan(1e-9);
  });
});

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

describe("spliceJoin", () => {
  it("re-joins a split bar into exactly the original single contour", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const pool = [...toSegments(r.near), ...toSegments(r.far)];
    const edges = joinEdges(r.nearFace, r.farFace, 0, 3, 4);
    const out = spliceJoin(pool, r.nearFace, r.farFace, edges)!;
    expect(out).toHaveLength(1);
    expect(area(fromSegments(out))).toBeCloseTo(2000, 6);
    // No bridge edge survives: nothing spans (40,−10)↔(40,10) any more. (The
    // zero-chord join also emits zero-length L's at x≈40; those are not bridges.)
    const spansFace = (s: { type: string; p: [number, number][] }) =>
      s.type === "L" && dist(s.p[0], s.p[1]) > 19 &&
      Math.abs(s.p[0][0] - 40) < 1e-6 && Math.abs(s.p[1][0] - 40) < 1e-6;
    expect(out[0].some(spansFace)).toBe(false);
  });
  it("makes one closed contour when the far half has moved", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const lifted = toSegments(r.far).map((c) => c.map((s) => ({ ...s, p: s.p.map(([x, y]) => [x + 30, y - 60] as [number, number]) })));
    const farFace = { a: [70, -70] as [number, number], b: [70, -50] as [number, number], tangent: Math.PI };
    const pool = [...toSegments(r.near), ...lifted];
    const out = spliceJoin(pool, r.nearFace, farFace, joinEdges(r.nearFace, farFace, 0, 3))!;
    expect(out).toHaveLength(1);
    expect(area(fromSegments(out))).toBeGreaterThan(2000);
  });
  it("returns null when a face's bridge is not in the pool", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const pool = toSegments(r.near);
    expect(spliceJoin(pool, r.nearFace, r.farFace, joinEdges(r.nearFace, r.farFace, 0, 3))).toBeNull();
  });
});
