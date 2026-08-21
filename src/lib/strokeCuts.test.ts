import { describe, it, expect } from "vitest";
import { flattenContours, crossingsAt, legalCutAt } from "./strokeCuts";
import type { SvgCmd } from "./svgPath";

/** A 100x20 horizontal bar — the model of an extendable straight stroke. */
const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: 0 },
  { type: "L", x: 100, y: 0 },
  { type: "L", x: 100, y: 20 },
  { type: "L", x: 0, y: 20 },
  { type: "Z" },
];

/** A bar with a square hole — models a counter, two contours. */
const BAR_WITH_HOLE: SvgCmd[] = [
  ...BAR,
  { type: "M", x: 40, y: 5 },
  { type: "L", x: 60, y: 5 },
  { type: "L", x: 60, y: 15 },
  { type: "L", x: 40, y: 15 },
  { type: "Z" },
];

describe("flattenContours", () => {
  it("keeps contours separate rather than concatenating them", () => {
    expect(flattenContours(BAR)).toHaveLength(1);
    expect(flattenContours(BAR_WITH_HOLE)).toHaveLength(2);
  });
});

describe("crossingsAt", () => {
  it("finds the two horizontal edges of a bar", () => {
    const cs = crossingsAt(flattenContours(BAR), 50);
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => c.y).sort((a, b) => a - b)).toEqual([0, 20]);
    for (const c of cs) expect(Math.abs(c.slope)).toBeLessThan(1e-9);
  });

  it("does not invent a crossing on a phantom segment between contours", () => {
    // x=50 passes through the hole: outer top, hole top, hole bottom, outer
    // bottom = 4 crossings. Concatenating the contours would add a spurious
    // segment from (0,20) to (40,5) and change this count.
    expect(crossingsAt(flattenContours(BAR_WITH_HOLE), 50)).toHaveLength(4);
  });
});

describe("legalCutAt", () => {
  it("accepts a cut through a flat bar and reports its thickness", () => {
    const r = legalCutAt(flattenContours(BAR), 50);
    expect(r.legal).toBe(true);
    expect(r.thickness).toBeCloseTo(20, 6);
  });

  it("rejects a cut through a gap", () => {
    expect(legalCutAt(flattenContours(BAR), 150).legal).toBe(false);
  });

  it("rejects a cut whose crossings are steep", () => {
    const wedge: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 80 },
      { type: "L", x: 100, y: 100 },
      { type: "L", x: 0, y: 20 },
      { type: "Z" },
    ];
    expect(legalCutAt(flattenContours(wedge), 50).legal).toBe(false);
  });
});

import { findCutZones, DEFAULT_DETECT_OPTS } from "./strokeCuts";

describe("findCutZones", () => {
  const meta = { glyphIndex: 3, cluster: 1 };

  it("finds one zone spanning a flat bar", () => {
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 5, minZoneWidth: 10,
    });
    expect(zones).toHaveLength(1);
    expect(zones[0].glyphIndex).toBe(3);
    expect(zones[0].cluster).toBe(1);
    expect(zones[0].thickness).toBeCloseTo(20, 1);
    expect(zones[0].toX - zones[0].fromX).toBeGreaterThan(50);
  });

  it("finds no zone on a circle", () => {
    // Every cut through a circle crosses steeply sloped segments.
    const r = 50;
    const pts: SvgCmd[] = [{ type: "M", x: r, y: 0 }];
    for (let i = 1; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      pts.push({ type: "L", x: r * Math.cos(a), y: r * Math.sin(a) });
    }
    pts.push({ type: "Z" });
    expect(findCutZones(flattenContours(pts), meta)).toHaveLength(0);
  });

  it("rejects a zone narrower than minZoneWidth", () => {
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 5, minZoneWidth: 500,
    });
    expect(zones).toHaveLength(0);
  });
});
