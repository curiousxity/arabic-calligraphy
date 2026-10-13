import { describe, it, expect } from "vitest";
import { layoutVerse, verseAnchor } from "./verseLayout";

const g = { target: 300, lineGap: 1.5, columnGap: 1, fontSize: 40 };

describe("layoutVerse", () => {
  it("stacks rows on one column at lineGap × fontSize", () => {
    const pos = layoutVerse(3, { ...g, layout: "stacked" }, { x: 10, y: 20 });
    expect(pos).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 80 },
      { x: 10, y: 140 },
    ]);
  });

  it("pairs bayt lines with the first misra' on the right", () => {
    const pos = layoutVerse(4, { ...g, layout: "bayt" }, { x: 0, y: 0 });
    const half = (300 + 40) / 2;
    expect(pos[0]).toEqual({ x: half, y: 0 });
    expect(pos[1]).toEqual({ x: -half, y: 0 });
    expect(pos[2]).toEqual({ x: half, y: 60 });
    expect(pos[3]).toEqual({ x: -half, y: 60 });
  });

  it("centres an odd last bayt line on its own row", () => {
    const pos = layoutVerse(3, { ...g, layout: "bayt" }, { x: 5, y: 0 });
    expect(pos[2]).toEqual({ x: 5, y: 60 });
  });

  it("returns nothing for an empty verse", () => {
    expect(layoutVerse(0, { ...g, layout: "stacked" }, { x: 0, y: 0 })).toEqual([]);
  });
});

describe("verseAnchor", () => {
  it("is the inverse of layoutVerse, so laying out again never moves the verse", () => {
    for (const layout of ["stacked", "bayt"] as const) {
      for (const count of [1, 2, 3, 4]) {
        const anchor = { x: 37, y: -12 };
        const pos = layoutVerse(count, { ...g, layout }, anchor);
        expect(verseAnchor(pos, layout)).toEqual(anchor);
      }
    }
  });

  it("follows a dragged verse", () => {
    const pos = layoutVerse(2, { ...g, layout: "bayt" }, { x: 0, y: 0 }).map((p) => ({
      x: p.x + 50,
      y: p.y + 7,
    }));
    expect(verseAnchor(pos, "bayt")).toEqual({ x: 50, y: 7 });
  });
});
