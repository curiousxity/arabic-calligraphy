import { describe, it, expect } from "vitest";
import { NUQTA_EM_RATIO, nuqtaEmRatio, nuqtaPx } from "./nuqta";

/**
 * The in-scope half of `FONT_URLS` (src/hooks/useShapedGlyphs.ts), which is
 * the real source of truth for which fonts the app ships.
 *
 * It is written out rather than imported **deliberately**: that module
 * statically imports `../lib/harfbuzz`, which throws under Vitest's Node ESM
 * loader the moment this file evaluates it ("Method Promise.prototype.then
 * called on incompatible receiver") — the same constraint that keeps
 * `diacritics.ts` and `justify.ts` free of a static harfbuzz import. Adding a
 * font is already a multi-place edit (CLAUDE.md); the nuqta table is one more.
 */
const IN_SCOPE_FONTS = [
  "AlFatemi",
  "Amiri",
  "FatemiMaqala",
  "Kufi",
  "Kufi2",
  "Lateef",
  "NotoSans",
  "Qahiri",
  "Scheherazade",
  "TahaNaskhRegular",
  "Thuluth",
  "ThuluthDeco",
  "Urdu",
  "Wessam",
  "Yekan",
];

describe("nuqta table", () => {
  it("covers exactly the in-scope fonts", () => {
    expect(Object.keys(NUQTA_EM_RATIO).sort()).toEqual([...IN_SCOPE_FONTS].sort());
  });

  it("returns null for a font that was measured out of scope", () => {
    expect(nuqtaEmRatio("Ruqaa")).toBeNull();
    expect(nuqtaEmRatio("HarfCanvasDiwani")).toBeNull();
    expect(nuqtaPx("Ruqaa", 100)).toBeNull();
  });

  it("returns null for an unknown font rather than guessing", () => {
    expect(nuqtaEmRatio("NoSuchFont")).toBeNull();
    expect(nuqtaPx("NoSuchFont", 100)).toBeNull();
  });

  it("scales the ratio by font size", () => {
    // Amiri: 135/1000 upem.
    expect(nuqtaEmRatio("Amiri")).toBeCloseTo(0.135, 4);
    expect(nuqtaPx("Amiri", 200)).toBeCloseTo(27, 4);
  });

  it("keeps every ratio inside the measured range", () => {
    for (const [font, ratio] of Object.entries(NUQTA_EM_RATIO)) {
      expect(ratio, font).toBeGreaterThan(0.07);
      expect(ratio, font).toBeLessThan(0.16);
    }
  });
});
