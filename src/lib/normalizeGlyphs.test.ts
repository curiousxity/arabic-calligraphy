import { describe, it, expect } from "vitest";
import { normalizeGlyphs } from "./normalizeGlyphs";

describe("normalizeGlyphs", () => {
  it("returns an empty array for non-array input", () => {
    // @ts-expect-error deliberately passing a malformed shape to test the runtime guard
    expect(normalizeGlyphs(null)).toEqual([]);
    // @ts-expect-error deliberately passing a malformed shape to test the runtime guard
    expect(normalizeGlyphs(undefined)).toEqual([]);
  });

  it("drops entries without a numeric glyph id", () => {
    const result = normalizeGlyphs([
      { g: 5 },
      { g: "not a number" } as never,
      {},
      { cl: 1 },
    ]);
    expect(result).toEqual([{ g: 5, cl: 0, ax: 0, ay: 0, dx: 0, dy: 0 }]);
  });

  it("defaults missing optional numeric fields to 0", () => {
    const result = normalizeGlyphs([{ g: 3 }]);
    expect(result).toEqual([{ g: 3, cl: 0, ax: 0, ay: 0, dx: 0, dy: 0 }]);
  });

  it("preserves provided numeric fields", () => {
    const result = normalizeGlyphs([
      { g: 7, cl: 2, ax: 12.5, ay: -1, dx: 0.5, dy: -0.25 },
    ]);
    expect(result).toEqual([
      { g: 7, cl: 2, ax: 12.5, ay: -1, dx: 0.5, dy: -0.25 },
    ]);
  });
});
