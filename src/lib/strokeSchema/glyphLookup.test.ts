import { describe, it, expect } from "vitest";
import { computeClusterSpans } from "./glyphLookup";
import { getLigatureSchema } from "./registry";

describe("computeClusterSpans", () => {
  it("gives every cluster a span of 1 when each glyph maps to exactly one character", () => {
    // "بسم" (3 glyphs, one per character) — clusters happen to come out in
    // reverse (RTL glyph-array) order, exactly like real HarfBuzz output.
    const spans = computeClusterSpans([2, 1, 0], 3);
    expect(spans.get(0)).toBe(1);
    expect(spans.get(1)).toBe(1);
    expect(spans.get(2)).toBe(1);
  });

  it("detects a ligature span when multiple characters collapse onto one cluster", () => {
    // "الله" (4 characters) where the 3 middle characters (ل ل ه, indices 1-3)
    // fuse into a single glyph sharing cluster 1; the leading alef (index 0)
    // stays its own glyph. Clusters given in reverse (RTL) order: 1, 0.
    const spans = computeClusterSpans([1, 0], 4);
    expect(spans.get(0)).toBe(1);
    expect(spans.get(1)).toBe(3);
  });

  it("is agnostic to the glyph array's own order — sorts by cluster value, not array position", () => {
    const forward = computeClusterSpans([0, 1], 4);
    const reversed = computeClusterSpans([1, 0], 4);
    expect(forward).toEqual(reversed);
  });

  it("extends the last cluster's span to the end of the text", () => {
    const spans = computeClusterSpans([0], 5);
    expect(spans.get(0)).toBe(5);
  });
});

describe("getLigatureSchema", () => {
  it("returns undefined for a letter sequence with no authored ligature schema", () => {
    expect(getLigatureSchema(["0627", "0644", "0644", "0647"])).toBeUndefined();
  });
});
