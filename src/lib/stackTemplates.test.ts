import { describe, it, expect } from "vitest";
import { STACK_TEMPLATES, templatePolygon } from "./stackTemplates";
import { GUIDE_DEFAULTS } from "./guideShapes";

const bounds = (poly: Array<[number, number]>) => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of poly) { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x); y2 = Math.max(y2, y); }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
};

describe("templatePolygon", () => {
  it("lists teardrop and almond", () => {
    expect(STACK_TEMPLATES).toEqual(["teardrop", "almond"]);
  });

  it.each(STACK_TEMPLATES)("%s: closed polygon, centred on the origin, height = ink height × factor, default aspect", (t) => {
    const poly = templatePolygon(t, 300, 1);
    expect(poly.length).toBeGreaterThan(8);
    const b = bounds(poly);
    // Height matched (a sampled polygon can miss the extremum by a sliver).
    expect(b.h).toBeCloseTo(300, 0);
    // Width follows the shape's default aspect.
    const d = GUIDE_DEFAULTS[t];
    expect(b.w / b.h).toBeCloseTo(d.width! / d.height!, 1);
    // Centred: the bounds' centre is the origin.
    expect((b.x1 + b.x2) / 2).toBeCloseTo(0, 0);
    expect((b.y1 + b.y2) / 2).toBeCloseTo(0, 0);
  });

  it("scales with the size factor", () => {
    const one = bounds(templatePolygon("almond", 200, 1));
    const two = bounds(templatePolygon("almond", 200, 2));
    expect(two.h).toBeCloseTo(one.h * 2, 0);
    expect(two.w).toBeCloseTo(one.w * 2, 0);
  });

  it("never returns a degenerate shape for a tiny ink height", () => {
    const b = bounds(templatePolygon("teardrop", 0, 1));
    expect(b.h).toBeGreaterThan(0);
  });
});
