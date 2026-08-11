import { describe, it, expect, vi } from "vitest";
import type { HarfBuzzGlyph } from "./harfbuzz";
import { findDiacriticGlyphIndices } from "./diacritics";

// Mock harfbuzzjs to prevent WASM initialization errors in the Node.js test
// environment. This is scoped to only this test file via vi.mock hoisting.
vi.mock("harfbuzzjs", () => ({
  default: Promise.resolve({
    createBlob: vi.fn(),
    createFace: vi.fn(),
    createFont: vi.fn(),
    createBuffer: vi.fn(),
    shape: vi.fn(),
  }),
}));

describe("findDiacriticGlyphIndices", () => {
  it("identifies a diacritic glyph by its cluster's source character", () => {
    // "بَ" — beh (U+0628) followed by fatha (U+064E). Two shaped glyphs,
    // each glyph's own cluster equal to its source character's index.
    const shapableText = "بَ";
    const glyphs: HarfBuzzGlyph[] = [
      { g: 10, cl: 0 }, // beh
      { g: 20, cl: 1 }, // fatha
    ];
    const result = findDiacriticGlyphIndices(glyphs, shapableText);
    expect(result.has(0)).toBe(false);
    expect(result.has(1)).toBe(true);
  });

  it("returns an empty set when no glyph is a diacritic", () => {
    const shapableText = "بت"; // beh, teh — two plain letters
    const glyphs: HarfBuzzGlyph[] = [
      { g: 10, cl: 0 },
      { g: 11, cl: 1 },
    ];
    expect(findDiacriticGlyphIndices(glyphs, shapableText).size).toBe(0);
  });

  it("identifies multiple diacritics in one run", () => {
    // "بِّ" — beh, shadda (U+0651), kasra (U+0650).
    const shapableText = "بِّ";
    const glyphs: HarfBuzzGlyph[] = [
      { g: 10, cl: 0 },
      { g: 21, cl: 1 },
      { g: 22, cl: 2 },
    ];
    const result = findDiacriticGlyphIndices(glyphs, shapableText);
    expect(result.has(0)).toBe(false);
    expect(result.has(1)).toBe(true);
    expect(result.has(2)).toBe(true);
    expect(result.size).toBe(2);
  });

  it("treats a missing cluster as index 0 (HarfBuzzGlyph.cl is optional)", () => {
    const shapableText = "َ"; // fatha alone
    const glyphs: HarfBuzzGlyph[] = [{ g: 20 }];
    expect(findDiacriticGlyphIndices(glyphs, shapableText).has(0)).toBe(true);
  });

  it("returns an empty set for an empty glyph array", () => {
    expect(findDiacriticGlyphIndices([], "").size).toBe(0);
  });
});
