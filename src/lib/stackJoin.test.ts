import { describe, it, expect } from "vitest";
import {
  joinCenterline, joinEdges, joinFloor, joinHandles, faceThickness, solveJoinDrag, spliceJoin, MIN_HANDLE,
} from "./stackJoin";
import { splitAtCut, toSegments, fromSegments, type Seg } from "./stackGeometry";
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
  it("bow lengthens A's handle and shortens B's, both still along their tangents", () => {
    const [, p1a, p2a] = joinCenterline(A, B, 0);
    const [, p1b, p2b] = joinCenterline(A, B, 0.5);
    expect(p1b[0]).toBeGreaterThan(p1a[0]);     // A's handle (+x) is longer
    expect(p2b[0]).toBeGreaterThan(p2a[0]);     // B's handle (−x from 100) is shorter
    expect(p1b[1]).toBeCloseTo(0, 9);
    expect(p2b[1]).toBeCloseTo(-50, 9);
  });
  it("bow moves an S-curve's midpoint along A's tangent by chord/4 · bow", () => {
    const up: CutFace = { a: [0, -110], b: [0, -90], tangent: Math.PI };
    const midOf = (bow: number) => {
      const [p0, p1, p2, p3] = joinCenterline(A, up, bow);
      return [(p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8];
    };
    const m0 = midOf(0), m1 = midOf(0.5);
    expect(m1[0] - m0[0]).toBeCloseTo((100 / 4) * 0.5, 6);   // A's tangent is +x; chord is 100
    expect(m1[1] - m0[1]).toBeCloseTo(0, 6);
  });
});

const midpoint = ([p0, p1, p2, p3]: [number, number][]) =>
  [(p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8];
/** A U: both outward tangents point +x, B 100 below A (a cap swung back
 *  under its body). Chord 100. */
const U_B: CutFace = { a: [0, 90], b: [0, 110], tangent: 0 };
/** An S: 100 above A, leaving to the left. Chord 100. */
const S_B: CutFace = { a: [0, -110], b: [0, -90], tangent: Math.PI };

describe("depth: the second degree of freedom", () => {
  it("bow 0, depth 0.5 on parallel tangents moves the midpoint along A's tangent by chord/4 x 0.5", () => {
    const m0 = midpoint(joinCenterline(A, U_B, 0, 0));
    const m1 = midpoint(joinCenterline(A, U_B, 0, 0.5));
    // (3/8)(h0 + h1) along A's tangent, and h0 + h1 grows by 2 (chord/3) 0.5.
    expect(m1[0] - m0[0]).toBeCloseTo((3 / 8) * 2 * (100 / 3) * 0.5, 9);
    expect(m1[0] - m0[0]).toBeCloseTo(12.5, 9);
    expect(m1[1] - m0[1]).toBeCloseTo(0, 9);
  });
  it("bow alone cannot move a U's midpoint; depth alone cannot move an S's", () => {
    const u0 = midpoint(joinCenterline(A, U_B, 0)), u1 = midpoint(joinCenterline(A, U_B, 0.4));
    expect(Math.hypot(u1[0] - u0[0], u1[1] - u0[1])).toBeCloseTo(0, 9);
    const s0 = midpoint(joinCenterline(A, S_B, 0, 0)), s1 = midpoint(joinCenterline(A, S_B, 0, 0.4));
    expect(Math.hypot(s1[0] - s0[0], s1[1] - s0[1])).toBeCloseTo(0, 9);
  });
  it("never lets a handle fall below MIN_HANDLE x chord, however extreme the inputs", () => {
    for (const [bow, depth] of [[5, 0], [-5, 0], [0, -5], [3, -4], [-3, -4], [0.9, 0], [-0.9, -0.5]]) {
      const [h0, h1] = joinHandles(100, bow, depth);
      expect(h0).toBeGreaterThanOrEqual(MIN_HANDLE * 100 - 1e-12);
      expect(h1).toBeGreaterThanOrEqual(MIN_HANDLE * 100 - 1e-12);
      const [p0, p1, p2, p3] = joinCenterline(A, U_B, bow, depth);
      expect(dist(p0, p1)).toBeGreaterThanOrEqual(MIN_HANDLE * 100 - 1e-9);
      expect(dist(p3, p2)).toBeGreaterThanOrEqual(MIN_HANDLE * 100 - 1e-9);
    }
    // ...and a drag solved towards nonsense stays clamped too.
    for (const d of [[-1e4, 3e3], [1e4, -1e4], [-500, 0]] as [number, number][]) {
      for (const tB of [0, Math.PI, Math.PI / 2, 0.05]) {
        const r = solveJoinDrag({ bow: 0, depth: 0 }, 0, tB, 100, d);
        const [h0, h1] = joinHandles(100, r.bow, r.depth);
        // The solved pair is exactly what joinHandles then draws: no hidden clamp.
        expect((h0 - h1) / (200 / 3)).toBeCloseTo(r.bow, 9);
        expect(h0).toBeGreaterThanOrEqual(MIN_HANDLE * 100 - 1e-9);
        expect(h1).toBeGreaterThanOrEqual(MIN_HANDLE * 100 - 1e-9);
      }
    }
  });
});

describe("solveJoinDrag: the bow handle is a 2-D target", () => {
  const moved = (B: CutFace, start: { bow: number; depth: number }, d: [number, number]) => {
    const [q0, , , q3] = joinCenterline(A, B, 0);
    const chord = dist(q0, q3);
    const m0 = midpoint(joinCenterline(A, B, start.bow, start.depth));
    const r = solveJoinDrag(start, A.tangent, B.tangent, chord, d);
    const m1 = midpoint(joinCenterline(A, B, r.bow, r.depth));
    return [m1[0] - m0[0], m1[1] - m0[1]];
  };
  it("follows the pointer along A's tangent on an S (opposed tangents)", () => {
    const [dx, dy] = moved(S_B, { bow: 0, depth: 0 }, [12, 0]);
    expect(dx).toBeGreaterThan(12 * 0.95);   // the ridge costs ~3.4%
    expect(dx).toBeLessThanOrEqual(12 + 1e-9);
    expect(Math.abs(dy)).toBeLessThan(1e-9);
  });
  it("follows the pointer along A's tangent on a U (parallel tangents), which bow alone could not", () => {
    const [dx, dy] = moved(U_B, { bow: 0, depth: 0 }, [20, 0]);
    expect(dx).toBeGreaterThan(20 * 0.95);
    expect(Math.abs(dy)).toBeLessThan(1e-9);
    // A pull no handle length can follow (along the chord) moves nothing.
    const [ex, ey] = moved(U_B, { bow: 0, depth: 0 }, [0, 20]);
    expect(Math.hypot(ex, ey)).toBeLessThan(1e-9);
  });
  it("follows a 2-D pull on a quarter turn (perpendicular tangents)", () => {
    const turn: CutFace = { a: [90, -100], b: [110, -100], tangent: Math.PI / 2 };
    const [dx, dy] = moved(turn, { bow: 0, depth: 0 }, [6, 4]);
    // Within 10% of the pointer: the ridge costs ~6.6% here. (A quarter turn
    // needs Δh ≈ 2.7 × the pointer's travel, which is why the gain cap is 3.)
    expect(Math.hypot(dx - 6, dy - 4)).toBeLessThan(0.1 * Math.hypot(6, 4));
  });
  it("does not run away a few degrees off an exact S: a pull along the chord stays bounded", () => {
    // Opposed tangents tilted by 0.06 rad; chord 100 (vertical); pull 10 along it.
    const tilted: CutFace = { a: [0, -110], b: [0, -90], tangent: Math.PI + 0.06 };
    const start = { bow: 0, depth: 0 };
    const r = solveJoinDrag(start, A.tangent, tilted.tangent, 100, [0, 10]);
    const [s0, s1] = joinHandles(100, 0, 0), [h0, h1] = joinHandles(100, r.bow, r.depth);
    expect(Math.abs(h0 - s0)).toBeLessThanOrEqual(15 + 1e-9);
    expect(Math.abs(h1 - s1)).toBeLessThanOrEqual(15 + 1e-9);
    const m0 = midpoint(joinCenterline(A, tilted, 0, 0)), m1 = midpoint(joinCenterline(A, tilted, r.bow, r.depth));
    expect(Math.hypot(m1[0] - m0[0], m1[1] - m0[1])).toBeLessThanOrEqual(2);
  });
  it("on an exact S follows a 10 px pull across the chord to within 1 px", () => {
    const [dx, dy] = moved(S_B, { bow: 0, depth: 0 }, [10, 0]);
    expect(Math.hypot(dx - 10, dy)).toBeLessThan(1);
  });
  it("starts from the drag-start bend, so zero travel changes nothing", () => {
    const r = solveJoinDrag({ bow: 0.3, depth: -0.2 }, 0, Math.PI, 100, [0, 0]);
    expect(r.bow).toBeCloseTo(0.3, 12);
    expect(r.depth).toBeCloseTo(-0.2, 12);
  });
});

describe("joinFloor", () => {
  it("is minFraction of the thinner face's thickness across its own stroke", () => {
    // A: a 20-tall face on a +x stroke is 20 thick. (b - a) = (6, 8) on a
    // +x stroke is 8 thick, whatever its length (10).
    const tilted: CutFace = { a: [100, 0], b: [106, 8], tangent: Math.PI };
    expect(faceThickness(A)).toBeCloseTo(20, 12);
    expect(faceThickness(tilted)).toBeCloseTo(8, 12);
    expect(joinFloor(A, tilted, 0.5)).toBeCloseTo(4, 12);
    expect(joinFloor(A, tilted, 1)).toBeLessThanOrEqual(Math.min(faceThickness(A), faceThickness(tilted)));
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
    // No ribbon twist: the normal component of the rung keeps one sign for the
    // whole join and never drops below the floor.
    const alongs: number[] = [];
    for (let i = 1; i < edgeA.length - 1; i++) {
      const c = (k: number): [number, number] => [(edgeA[k][0] + edgeB[k][0]) / 2, (edgeA[k][1] + edgeB[k][1]) / 2];
      const d = [c(i + 1)[0] - c(i - 1)[0], c(i + 1)[1] - c(i - 1)[1]];
      const len = Math.hypot(d[0], d[1]);
      const n = [-d[1] / len, d[0] / len];
      alongs.push((edgeB[i][0] - edgeA[i][0]) * n[0] + (edgeB[i][1] - edgeA[i][1]) * n[1]);
    }
    expect(new Set(alongs.map(Math.sign)).size).toBe(1);
    for (const a of alongs) expect(Math.abs(a)).toBeGreaterThanOrEqual(4 - 1e-6);
  });
  it("a 90-degree climb thins then thickens monotonically", () => {
    // B sits 100 above A and 40 along, so the
    // S rises to within a few degrees of vertical once, mid-way, rather than
    // passing through vertical twice (B straight above does that). The floor
    // is below the real minimum, so it never flattens the dip.
    const climbB: CutFace = { a: [40, -110], b: [40, -90], tangent: Math.PI };
    const { edgeA, edgeB } = joinEdges(A, climbB, 0, 0.01, 40);
    const c = (k: number): [number, number] => [(edgeA[k][0] + edgeB[k][0]) / 2, (edgeA[k][1] + edgeB[k][1]) / 2];
    const thick: number[] = [];
    for (let i = 1; i < edgeA.length - 1; i++) {
      const d = [c(i + 1)[0] - c(i - 1)[0], c(i + 1)[1] - c(i - 1)[1]];
      const len = Math.hypot(d[0], d[1]);
      const n = [-d[1] / len, d[0] / len];
      thick.push(Math.abs((edgeB[i][0] - edgeA[i][0]) * n[0] + (edgeB[i][1] - edgeA[i][1]) * n[1]));
    }
    const k = thick.indexOf(Math.min(...thick));
    expect(k).toBeGreaterThan(0);
    expect(k).toBeLessThan(thick.length - 1);
    expect(thick[k]).toBeGreaterThan(0.01);   // the floor did not bind
    expect(thick[0]).toBeGreaterThan(thick[k] * 2);   // a real dip, not noise
    for (let i = 1; i <= k; i++) expect(thick[i]).toBeLessThanOrEqual(thick[i - 1] + 1e-9);
    for (let i = k + 1; i < thick.length; i++) expect(thick[i]).toBeGreaterThanOrEqual(thick[i - 1] - 1e-9);
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
    // The bar's 4 edges, two of them split at the cut: 6 segments, and none of
    // them the zero-length join edges.
    expect(out[0]).toHaveLength(6);
    expect(out[0].every((s) => dist(s.p[0], s.p[s.p.length - 1]) > 1e-9)).toBe(true);
    expect(area(fromSegments(out))).toBeCloseTo(2000, 6);
    // No bridge edge survives: nothing spans (40,−10)↔(40,10) any more. (The
    // zero-chord join also emits zero-length L's at x≈40; those are not bridges.)
    const spansFace = (s: { type: string; p: [number, number][] }) =>
      s.type === "L" && dist(s.p[0], s.p[1]) > 19 &&
      Math.abs(s.p[0][0] - 40) < 1e-6 && Math.abs(s.p[1][0] - 40) < 1e-6;
    expect(out[0].some(spansFace)).toBe(false);
  });
  it("splices when the two bridges run the same direction", () => {
    const r = splitAtCut(BAR, { cutX: 40, angle: 0 })!;
    const flip = (c: Seg[]): Seg[] => c.map((s) => ({ ...s, p: [...s.p].reverse() })).reverse();
    const pool = [...toSegments(r.near), ...toSegments(r.far).map(flip)];
    const out = spliceJoin(pool, r.nearFace, r.farFace, joinEdges(r.nearFace, r.farFace, 0, 3, 4))!;
    expect(out).toHaveLength(1);
    expect(area(fromSegments(out))).toBeCloseTo(2000, 6);
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
