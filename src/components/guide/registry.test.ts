import { describe, it, expect } from "vitest";
import { guideSections, filterGuideSections } from "./registry";
import type { GuideSection } from "./types";

const stub = (
  id: string,
  title: string,
  order: number,
  keywords: string[] = []
): GuideSection => ({ id, title, order, keywords, Body: () => null });

describe("guideSections", () => {
  it("loads the section files in the sections folder", () => {
    // The drawer must work with whatever files happen to be present, so this
    // asserts the glob found something rather than a specific set.
    expect(guideSections.length).toBeGreaterThan(0);
  });

  it("is sorted by order", () => {
    const orders = guideSections.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("has unique ids", () => {
    const ids = guideSections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("filterGuideSections", () => {
  const sections = [
    stub("marks", "Marks", 10, ["tashkeel", "harakat"]),
    stub("layers", "Layers and arranging", 20, ["group", "lock"]),
  ];

  it("returns everything for an empty or whitespace query", () => {
    expect(filterGuideSections(sections, "")).toEqual(sections);
    expect(filterGuideSections(sections, "   ")).toEqual(sections);
  });

  it("matches on the title", () => {
    expect(filterGuideSections(sections, "arrang").map((s) => s.id)).toEqual([
      "layers",
    ]);
  });

  it("matches on a keyword the title never mentions", () => {
    expect(filterGuideSections(sections, "tashkeel").map((s) => s.id)).toEqual([
      "marks",
    ]);
  });

  it("ignores case on both sides of the match", () => {
    expect(filterGuideSections(sections, "TASHKEEL").map((s) => s.id)).toEqual([
      "marks",
    ]);
    expect(filterGuideSections(sections, "layers").map((s) => s.id)).toEqual([
      "layers",
    ]);
  });

  it("returns nothing when a query matches neither field", () => {
    expect(filterGuideSections(sections, "kerning")).toEqual([]);
  });

  it("preserves the incoming order", () => {
    expect(filterGuideSections(sections, "a").map((s) => s.id)).toEqual([
      "marks",
      "layers",
    ]);
  });
});
