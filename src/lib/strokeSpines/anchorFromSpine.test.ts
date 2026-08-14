import { describe, it, expect } from "vitest";
import { spineToBlockSpace } from "./anchorFromSpine";
import type { StrokeSpine } from "./types";

const spine: StrokeSpine = {
  strokeId: "S_BODY_1",
  zoneIndex: 0,
  points: [
    { x: 100, y: 200, radius: 40 },
    { x: 300, y: 260, radius: 60 },
    { x: 500, y: 200, radius: 50 },
  ],
};

const opts = { gx: 10, gy: 90, fontSize: 100, unitsPerEm: 1000 };

describe("spineToBlockSpace", () => {
  it("scales by fontSize/unitsPerEm, offsets by the pen origin, and flips Y", () => {
    const out = spineToBlockSpace(spine, opts)!;
    // 100 font units at 100px/1000upm = 10px, plus gx 10 => 20.
    // y is font-units-up; canvas is down, so 200 => 90 - 20 = 70.
    expect(out.anchor).toEqual({ x: 20, y: 70 });
    expect(out.dragOrigin).toEqual({ x: 60, y: 70 });
    expect(out.points).toHaveLength(3);
    expect(out.points[1]).toEqual({ x: 40, y: 64 });
  });

  it("sizes the band from the widest radius on the spine, not a constant", () => {
    // Widest radius 60 units = 6px, so a full stroke width of 12px.
    expect(spineToBlockSpace(spine, opts)!.bandWidth).toBeCloseTo(12, 6);
  });

  it("keeps the band usable when a spine is hairline thin", () => {
    const thin: StrokeSpine = {
      ...spine,
      points: [
        { x: 0, y: 0, radius: 0.01 },
        { x: 10, y: 0, radius: 0.01 },
      ],
    };
    expect(spineToBlockSpace(thin, opts)!.bandWidth).toBeGreaterThanOrEqual(4);
  });

  it("returns null for a degenerate spine rather than an unusable axis", () => {
    expect(spineToBlockSpace({ ...spine, points: [spine.points[0]] }, opts)).toBeNull();
    expect(
      spineToBlockSpace(
        { ...spine, points: [spine.points[0], { ...spine.points[0] }] },
        opts
      )
    ).toBeNull();
  });

  it("scales with fontSize", () => {
    const big = spineToBlockSpace(spine, { ...opts, fontSize: 200 })!;
    expect(big.anchor.x).toBe(10 + 20);
    expect(big.bandWidth).toBeCloseTo(24, 6);
  });
});
