import { describe, expect, it } from "vitest";
import { fitPolygons, fitRing } from "./penFit";
import { sweepPath, type Pt, type Ring } from "./penSweep";
import type { SvgCmd } from "./svgPath";
import handleBlowup from "./penFit.handleBlowup.json";
import type { Polygon } from "./penSweep";

/** The fitted outline as points: each C sampled at 64 steps, each L as its end. */
function trace(cmds: SvgCmd[]): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt = [0, 0], ring: Pt[] = [];
  for (const c of cmds) {
    if (c.type === "M") { if (ring.length) out.push(ring); ring = [[c.x, c.y]]; cur = [c.x, c.y]; }
    else if (c.type === "L") { ring.push([c.x, c.y]); cur = [c.x, c.y]; }
    else if (c.type === "C") {
      for (let i = 1; i <= 64; i++) {
        const t = i / 64, u = 1 - t;
        ring.push([
          u * u * u * cur[0] + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * cur[1] + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
      cur = [c.x, c.y];
    }
  }
  if (ring.length) out.push(ring);
  return out;
}
const segDist = (p: Pt, a: Pt, b: Pt) => {
  const e: Pt = [b[0] - a[0], b[1] - a[1]], L2 = e[0] * e[0] + e[1] * e[1] || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / L2));
  return Math.hypot(a[0] + e[0] * t - p[0], a[1] + e[1] * t - p[1]);
};
const toPoly = (r: Pt[], p: Pt) => Math.min(...r.map((a, i) => segDist(p, a, r[(i + 1) % r.length])));
/** Largest distance either way between the fitted outline and the ring. */
function maxDeviation(cmds: SvgCmd[], ring: Ring): number {
  const fitted = trace(cmds).flat();
  const fittedRing = trace(cmds)[0];
  return Math.max(...fitted.map((p) => toPoly(ring, p)), ...ring.map((p) => toPoly(fittedRing, p)));
}
/** Turns of more than `deg` between one segment's end tangent and the next's start tangent. */
function cornerCount(cmds: SvgCmd[], deg: number): number {
  const segs: { a: Pt; b: Pt }[] = [];
  let cur: Pt = [0, 0], start: Pt = [0, 0];
  for (const c of cmds) {
    if (c.type === "M") { cur = [c.x, c.y]; start = cur; }
    else if (c.type === "L") { segs.push({ a: [c.x - cur[0], c.y - cur[1]], b: [c.x - cur[0], c.y - cur[1]] }); cur = [c.x, c.y]; }
    else if (c.type === "C") {
      const a: Pt = c.x1 === cur[0] && c.y1 === cur[1] ? [c.x2 - cur[0], c.y2 - cur[1]] : [c.x1 - cur[0], c.y1 - cur[1]];
      const b: Pt = c.x2 === c.x && c.y2 === c.y ? [c.x - c.x1, c.y - c.y1] : [c.x - c.x2, c.y - c.y2];
      segs.push({ a, b }); cur = [c.x, c.y];
    } else if (c.type === "Z" && (cur[0] !== start[0] || cur[1] !== start[1])) {
      segs.push({ a: [start[0] - cur[0], start[1] - cur[1]], b: [start[0] - cur[0], start[1] - cur[1]] });
      cur = start;
    }
  }
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    const u = segs[i].b, v = segs[(i + 1) % segs.length].a;
    const ang = (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])))) * 180) / Math.PI;
    if (ang > deg) n++;
  }
  return n;
}
const edge = (a: Pt, b: Pt): Pt[] => Array.from({ length: 25 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 25, a[1] + ((b[1] - a[1]) * i) / 25] as Pt);

describe("fitting curves to the ink", () => {
  it("fits a finely sampled circle within the tolerance, with few curves", () => {
    const ring: Ring = Array.from({ length: 720 }, (_, i) => [100 * Math.cos((i * Math.PI) / 360), 100 * Math.sin((i * Math.PI) / 360)] as Pt);
    const cmds = fitRing(ring, 0.25);
    expect(cmds.filter((c) => c.type === "C").length).toBeLessThanOrEqual(12);
    expect(maxDeviation(cmds, ring)).toBeLessThan(0.25);
  });

  it("keeps a square's four corners", () => {
    const sq: Ring = [...edge([0, 0], [100, 0]), ...edge([100, 0], [100, 100]), ...edge([100, 100], [0, 100]), ...edge([0, 100], [0, 0])];
    expect(cornerCount(fitRing(sq, 0.25), 80)).toBe(4);
  });

  it("fits a swept stroke's outline within a quarter unit", () => {
    const polys = sweepPath({ start: { p: [0, 0], angle: 70 }, segs: [{ c1: [-100, 120], c2: [-300, 120], to: { p: [-400, 0], angle: 70 } }] }, 48);
    expect(maxDeviation(fitPolygons(polys, 0.25), polys[0][0])).toBeLessThan(0.25);
  });

  it("keeps every handle near the ink, even where the least-squares solve goes singular", () => {
    // a small hamza's ink (2026-10-19) on which a run's handles came out tens of millions of units long:
    // Newton reparameterisation pushed every sample to the curve's ends, so the error check passed
    const polys = handleBlowup as Polygon[];
    const pts = polys.flat(2);
    const [x1, x2] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
    const [y1, y2] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
    const reach = Math.max(x2 - x1, y2 - y1);
    for (const c of fitPolygons(polys, 0.25)) {
      if (c.type !== "C") continue;
      for (const [x, y] of [[c.x1, c.y1], [c.x2, c.y2]]) {
        expect(x).toBeGreaterThan(x1 - reach);
        expect(x).toBeLessThan(x2 + reach);
        expect(y).toBeGreaterThan(y1 - reach);
        expect(y).toBeLessThan(y2 + reach);
      }
    }
    for (const ring of polys.flat()) expect(maxDeviation(fitRing(ring, 0.25), ring)).toBeLessThan(0.25);
  });
});
