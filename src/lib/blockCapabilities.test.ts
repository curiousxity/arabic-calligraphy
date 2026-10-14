import { describe, it, expect } from "vitest";
import {
  isStackBlock, supportsStrokeCuts, supportsGlyphAlternates, supportsDiacriticOverrides,
} from "./blockCapabilities";
import type { StackBlock } from "../types";

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
