import { describe, expect, it } from "vitest";
import { smoothPolygons, smoothRing, type SmoothOpts } from "./outlineSmooth";
import { polygonArea, sweepPath, type Polygon, type Pt, type Ring } from "./penSweep";

// the app's pen: 48 units, the nuqta 1.65 pens (penLibrary.ts)
const NUQTA = 1.65 * 48;
const OPTS: SmoothOpts = { step: 0.01 * NUQTA, tol: 0.015 * NUQTA, cornerDeg: 40, cornerArm: 0.08 * NUQTA, cornerPad: 0.12 * NUQTA };

const segDist = (p: Pt, a: Pt, b: Pt) => {
  const e: Pt = [b[0] - a[0], b[1] - a[1]], L2 = e[0] * e[0] + e[1] * e[1] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / L2));
  return Math.hypot(a[0] + e[0] * t - p[0], a[1] + e[1] * t - p[1]);
};
const toRing = (r: Ring, p: Pt) => Math.min(...r.map((a, i) => segDist(p, a, r[(i + 1) % r.length])));
/** Every point of `a` within this of the ring `b`. */
const furthest = (a: Ring, b: Ring) => Math.max(...a.map((p) => toRing(b, p)));
const edge = (a: Pt, b: Pt, n = 40): Pt[] => Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt);

describe("smoothing the ink's outline", () => {
  it("takes a node-to-node ripple off a curve, moving no point more than the tolerance", () => {
    // a 2.5-nuqta circle whose edge ripples 0.008 nuqta every quarter nuqta: the wobble fitted strokes leave
    const R = 2.5 * NUQTA, amp = 0.008 * NUQTA, waves = 63;
    const ring: Ring = Array.from({ length: 2000 }, (_, i) => {
      const t = (i / 2000) * 2 * Math.PI, r = R + amp * Math.sin(waves * t);
      return [r * Math.cos(t), r * Math.sin(t)] as Pt;
    });
    const out = smoothRing(ring, OPTS);
    const off = out.map(([x, y]) => Math.abs(Math.hypot(x, y) - R));
    expect(Math.max(...off)).toBeLessThan(amp / 4);
    expect(furthest(out, ring)).toBeLessThanOrEqual(OPTS.tol + 1e-6);
  });

  it("keeps a nib pull's four corners where they are", () => {
    const ring: Ring = [[-19.7, -489], [19.7, -461.4], [19.7, 13.8], [-19.7, -13.8]];
    const out = smoothRing(ring, OPTS);
    for (const c of ring) expect(Math.min(...out.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))).toBeLessThan(1e-9);
    expect(furthest(out, ring)).toBeLessThan(1e-6);
  });

  it("smooths a square's rippled sides but keeps its corners sharp", () => {
    const s = 3 * NUQTA, amp = 0.006 * NUQTA;
    const wob = (pts: Pt[], nx: number, ny: number) => pts.map((p, i) => [p[0] + nx * amp * Math.sin(i * 1.3), p[1] + ny * amp * Math.sin(i * 1.3)] as Pt);
    const sq: Ring = [
      ...wob(edge([0, 0], [s, 0], 120), 0, 1).map((p, i) => (i === 0 ? [0, 0] as Pt : p)),
      ...wob(edge([s, 0], [s, s], 120), 1, 0).map((p, i) => (i === 0 ? [s, 0] as Pt : p)),
      ...wob(edge([s, s], [0, s], 120), 0, 1).map((p, i) => (i === 0 ? [s, s] as Pt : p)),
      ...wob(edge([0, s], [0, 0], 120), 1, 0).map((p, i) => (i === 0 ? [0, s] as Pt : p)),
    ];
    const out = smoothRing(sq, OPTS);
    for (const c of [[0, 0], [s, 0], [s, s], [0, s]] as Pt[]) {
      expect(Math.min(...out.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])))).toBeLessThan(1e-9);
    }
    // halfway along each side, the ripple is gone
    const mid = out.filter((p) => Math.abs(p[0] - s / 2) < 0.2 * NUQTA && p[1] < s / 2);
    expect(Math.max(...mid.map((p) => Math.abs(p[1])))).toBeLessThan(amp / 3);
    expect(furthest(out, sq)).toBeLessThanOrEqual(OPTS.tol + 1e-6);
  });

  it("leaves a swept stroke's outline within the tolerance and its area all but unchanged", () => {
    const polys = sweepPath({ start: { p: [0, 0], angle: 70 }, segs: [{ c1: [-100, 120], c2: [-300, 120], to: { p: [-400, 0], angle: 70 } }] }, 48);
    const out = smoothPolygons(polys, OPTS);
    expect(out.length).toBe(polys.length);
    expect(furthest(out[0][0], polys[0][0])).toBeLessThanOrEqual(OPTS.tol + 1e-6);
    expect(Math.abs(polygonArea(out) - polygonArea(polys)) / polygonArea(polys)).toBeLessThan(0.005);
  });

  it("keeps every polygon's holes, and passes rings too small to smooth through unchanged", () => {
    const hole: Ring = Array.from({ length: 200 }, (_, i) => [NUQTA * Math.cos((i * Math.PI) / 100), NUQTA * Math.sin((i * Math.PI) / 100)] as Pt);
    const outer: Ring = Array.from({ length: 400 }, (_, i) => [3 * NUQTA * Math.cos((i * Math.PI) / 200), 3 * NUQTA * Math.sin((i * Math.PI) / 200)] as Pt);
    const tiny: Ring = [[0, 0], [1, 0], [0, 1]];
    const out = smoothPolygons([[outer, hole], [tiny]] as Polygon[], OPTS);
    expect(out.map((p) => p.length)).toEqual([2, 1]);
    expect(out[1][0]).toEqual(tiny);
  });
});
