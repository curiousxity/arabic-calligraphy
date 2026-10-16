import { describe, expect, it } from "vitest";
import { DEFAULT_DETECT_OPTS, type CutZone, type Pt } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";
import {
  cutAtPress, fromZoneFrame, invertTransform, markPullSpans, markStrokeAxis, MARK_MOVE_FRACTION, pullSpans, spanProbes,
  stackDetectOpts, toZoneFrame, zoneRect,
} from "./stackZones";

const zone = (over: Partial<CutZone> = {}): CutZone => ({
  glyphIndex: 0, cluster: 0, fromX: 100, toX: 500, thickness: 40, angle: 0, fit: 0, centreY: -200, ...over,
});

describe("zone frame", () => {
  it("round-trips a point through a tilted frame", () => {
    const a = 0.4;
    const p: [number, number] = [123, -456];
    const q = fromZoneFrame(toZoneFrame(p, a), a);
    expect(q[0]).toBeCloseTo(p[0], 9);
    expect(q[1]).toBeCloseTo(p[1], 9);
  });

  it("matches the frame splitAtCut cuts in: x′ = x·cos a + y·sin a", () => {
    const a = 0.3;
    const [x] = toZoneFrame([10, 20], a);
    expect(x).toBeCloseTo(10 * Math.cos(a) + 20 * Math.sin(a), 12);
  });

  it("inverts a piece transform", () => {
    const t = { x: 30, y: -10, rotation: 0.7, pivot: [50, 60] as [number, number] };
    const local: [number, number] = [12, 34];
    const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
    const dx = local[0] - t.pivot[0], dy = local[1] - t.pivot[1];
    const world: [number, number] = [dx * c - dy * s + t.pivot[0] + t.x, dx * s + dy * c + t.pivot[1] + t.y];
    const back = invertTransform(world, t);
    expect(back[0]).toBeCloseTo(local[0], 9);
    expect(back[1]).toBeCloseTo(local[1], 9);
  });
});

describe("zoneRect", () => {
  it("spans the zone's x range and the stroke thickness about centreY", () => {
    const r = zoneRect(zone(), 100, 500);
    expect(r).toHaveLength(4);
    const xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(100);
    expect(Math.max(...xs)).toBeCloseTo(500);
    expect(Math.min(...ys)).toBeCloseTo(-220);
    expect(Math.max(...ys)).toBeCloseTo(-180);
  });

  it("is rotated by the zone's angle", () => {
    const r = zoneRect(zone({ angle: Math.PI / 2 }), 100, 500);
    // x′ along the zone becomes y in glyph space.
    const ys = r.map((p) => p[1]);
    expect(Math.min(...ys)).toBeCloseTo(100);
    expect(Math.max(...ys)).toBeCloseTo(500);
  });
});

describe("pullSpans", () => {
  it("offers the outer part of both ends and leaves the middle to move the letter", () => {
    expect(pullSpans(zone())).toEqual([[100, 260], [340, 500]]);   // 40% of 400 = 160 ≥ 2·40
  });

  it("the span is at least two stroke thicknesses", () => {
    expect(pullSpans(zone({ thickness: 90 }))).toEqual([[100, 280], [320, 500]]);   // 2·90 = 180 > 40% of 400
  });

  it("a short or thick zone is one span, never two that overlap", () => {
    expect(pullSpans(zone({ thickness: 120 }))).toEqual([[100, 500]]);   // 2·120 = 240 > half
    expect(pullSpans(zone({ fromX: 715, toX: 777, thickness: 217 }))).toEqual([[715, 777]]);
  });

  it("an empty zone offers nothing", () => {
    expect(pullSpans(zone({ fromX: 100, toX: 100 }))).toEqual([]);
  });
});

describe("spanProbes", () => {
  it("probes both ends, kept inside the zone, and the middle", () => {
    const p = spanProbes(zone(), [100, 260]);
    expect(p).toHaveLength(3);
    expect(p[0]).toBeGreaterThan(100);
    expect(p[1]).toBe(180);
    expect(p[2]).toBe(260);
  });
});

describe("cutAtPress", () => {
  it("cuts at the press point's x in the zone frame", () => {
    expect(cutAtPress(zone(), [420, -200])).toEqual({ cutX: 420, angle: 0 });
  });

  it("keeps the cut a little inside the zone", () => {
    const z = zone();
    expect(cutAtPress(z, [0, -200]).cutX).toBeGreaterThan(100);
    expect(cutAtPress(z, [900, -200]).cutX).toBeLessThan(500);
  });

  it("uses the zone's angle", () => {
    const a = 0.5;
    const local = fromZoneFrame([300, -200], a);
    const c = cutAtPress(zone({ angle: a }), local);
    expect(c.angle).toBe(a);
    expect(c.cutX).toBeCloseTo(300, 9);
  });
});

describe("stackDetectOpts", () => {
  it("sweeps both bases with the stack's resolution and an aspect floor", () => {
    const o = stackDetectOpts(2000);
    expect(o.baseAngles).toEqual([0, Math.PI / 2]);
    expect(o.minAspect).toBe(1);
    expect(o.step).toBe(20);
    expect(o.minZoneWidth).toBe(50);
    expect(o.maxSlope).toBe(DEFAULT_DETECT_OPTS.maxSlope);
  });
});

describe("markStrokeAxis / markPullSpans", () => {
  // A 300 × 40 bar tilted −30°: a fatha's shape, stripped to its axis.
  const tilt = -Math.PI / 6;
  const bar = (len: number, wid: number): SvgCmd[] => {
    const pts: Pt[] = [[0, -wid / 2], [len, -wid / 2], [len, wid / 2], [0, wid / 2]].map((p) => fromZoneFrame(p as Pt, tilt));
    return [{ type: "M", x: pts[0][0], y: pts[0][1] }, ...pts.slice(1).map((p) => ({ type: "L" as const, x: p[0], y: p[1] })), { type: "Z" }];
  };

  it("finds the long axis, the centroid and the width of a tilted stroke", () => {
    const a = markStrokeAxis(bar(300, 40))!;
    expect(Math.abs(Math.sin(a.angle - tilt))).toBeLessThan(1e-9);   // same line, either direction
    expect(a.to - a.from).toBeCloseTo(300, 6);
    expect(a.width).toBeCloseTo(40, 6);
    expect(a.centre).toBeCloseTo((a.from + a.to) / 2, 6);
  });

  it("is null for a mark not clearly longer than wide", () => {
    expect(markStrokeAxis(bar(100, 40))).toBeNull();
    expect(markStrokeAxis([])).toBeNull();
  });

  it("offers the two ends and keeps the middle for moving", () => {
    const a = markStrokeAxis(bar(300, 40))!;
    const spans = markPullSpans(a);
    expect(spans.map((s) => s.side)).toEqual(["near", "far"]);
    const L = a.to - a.from;
    expect(spans[1].span[0] - spans[0].span[1]).toBeCloseTo(MARK_MOVE_FRACTION * L, 6);
    expect(spans[0].span[0]).toBe(a.from);
    expect(spans[1].span[1]).toBe(a.to);
  });
});
