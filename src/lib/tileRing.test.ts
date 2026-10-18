import { describe, it, expect } from "vitest";
import { MARK_GROUPS } from "./markLibrary";
import { frameWindow } from "./frameWindow";
import { outlineBounds } from "./strokeCuts";
import { parseSvgPath } from "./svgPath";
import { ringCounts, tileRing } from "./tileRing";

const tiles = MARK_GROUPS.flatMap((g) => g.items).filter((m) => m.tile);

describe("tileRing", () => {
  it("the library has a border tile", () => {
    expect(tiles.length).toBeGreaterThan(0);
  });

  for (const t of tiles) {
    it(`${t.name}: the ring is centred, the right size, and its opening holds the box`, () => {
      const spec = t.tile!;
      const w = 3000, h = 900;
      const { cols, side } = ringCounts(spec, w, h);
      const d = tileRing(t.d, spec, cols, side);
      const b = outlineBounds(parseSvgPath(d));
      const W = cols * spec.period, H = 2 * spec.band + side * spec.period;
      // the tile's ink spills a little past its period (the seam overlap)
      expect(Math.abs(b.x2 - b.x1 - W)).toBeLessThan(spec.period * 0.1);
      expect(Math.abs(b.y2 - b.y1 - H)).toBeLessThan(spec.period * 0.1);
      expect(Math.abs(b.x1 + b.x2)).toBeLessThan(2);
      expect(Math.abs(b.y1 + b.y2)).toBeLessThan(2);
      // the opening, clear of ink, holds the asked-for box
      const win = frameWindow(d)!;
      expect(win.w).toBeGreaterThanOrEqual(w * 0.97);
      expect(win.h).toBeGreaterThanOrEqual(h * 0.97);
    });
  }

  it("never fewer than two tiles across or one down a side", () => {
    expect(ringCounts({ period: 400, band: 400 }, 0, 0)).toEqual({ cols: 2, side: 1 });
  });
});
