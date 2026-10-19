import { describe, it, expect } from "vitest";
import {
  hasOwnFont, isStackBlock, isTarkibBlock, supportsDetachedMarks, supportsStrokeCuts, supportsGlyphAlternates, supportsDiacriticOverrides, supportsStyleSets,
} from "./blockCapabilities";
import type { StackBlock, TarkibBlock } from "../types";

const stack: StackBlock = {
  id: 1, type: "stack", text: "مصبح", x: 0, y: 0, fontSize: 53, color: "#000",
  fontFamily: "UKIJDiwani", stroke: "#000", shadowColor: "#000",
  source: { text: "مصبح", fontFamily: "UKIJDiwani" }, unitsPerEm: 1000,
  nib: { width: 110, minFraction: 0.15 }, pieces: [], joins: [],
};

describe("stack capability", () => {
  it("is its own kind and has none of the live-text capabilities", () => {
    expect(isStackBlock(stack)).toBe(true);
    expect(supportsStrokeCuts(stack)).toBe(false);
    expect(supportsGlyphAlternates(stack)).toBe(false);
    expect(supportsDiacriticOverrides(stack)).toBe(false);
  });
});

const tarkib: TarkibBlock = {
  id: 2, type: "tarkib", text: "أم", x: 0, y: 0, fontSize: 400, color: "#000",
  fontFamily: "", stroke: "#000", shadowColor: "#000",
  layout: { runs: [], wordStarts: [] },
};

describe("tarkib capability", () => {
  it("gives a tarkib no typography, kashida, alternates or diacritic tools", () => {
    expect(isTarkibBlock(tarkib)).toBe(true);
    expect(isStackBlock(tarkib)).toBe(false);
    expect(hasOwnFont(tarkib)).toBe(false);
    expect(supportsStrokeCuts(tarkib)).toBe(false);
    expect(supportsGlyphAlternates(tarkib)).toBe(false);
    expect(supportsStyleSets(tarkib)).toBe(false);
    expect(supportsDiacriticOverrides(tarkib)).toBe(false);
    expect(supportsDetachedMarks(tarkib)).toBe(false);
  });
});
