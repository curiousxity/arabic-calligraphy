import { describe, expect, it } from "vitest";
import { leavesStub, squareCuts } from "./tarkibEnds";
import { splitAtCut } from "./stackGeometry";
import { parseSvgPath } from "./svgPath";

describe("squareCuts", () => {
  it("cuts square across a slanted stroke, not along the way in it was given", () => {
    // a bar 40 thick running at 30 degrees, entered from its right end with a
    // writing direction that is plain leftward
    const a = Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
    const pt = (x: number, y: number) => `${(x * c - y * s).toFixed(2)} ${(x * s + y * c).toFixed(2)}`;
    const bar = parseSvgPath(`M${pt(-200, -20)}L${pt(200, -20)}L${pt(200, 20)}L${pt(-200, 20)}Z`);
    const end: [number, number] = [200 * c - 15 * -s, 200 * s + 15 * c]; // near a corner of the right end
    const [cut] = squareCuts(bar, end, [-1, 0], [48], true);
    expect(cut).not.toBeNull();
    // the stroke runs along a; the exit points out along it
    expect(Math.abs(Math.cos(cut!.angle - a))).toBeGreaterThan(0.97);
    expect(cut!.thickness).toBeGreaterThan(36);
    expect(cut!.thickness).toBeLessThan(46);
  });
});

describe("leavesStub", () => {
  // a bar 40 thick running right, its end cut on a slant: the top corner at
  // x 100, the bottom at x 60
  const bar = parseSvgPath("M-100 -20L100 -20L60 20L-100 20Z");
  const keptAt = (x: number) => {
    const r = splitAtCut(bar, { cutX: x, angle: 0 })!;
    return { kept: r.near, face: r.nearFace };
  };
  it("finds the old end's corner left standing by a cut that runs out through it", () => {
    const { kept, face } = keptAt(90);
    expect(leavesStub(kept, face, [-1, 0])).toBe(true);
  });
  it("passes a cut made behind the old end, across the whole stroke", () => {
    const { kept, face } = keptAt(50);
    expect(leavesStub(kept, face, [-1, 0])).toBe(false);
  });
});
