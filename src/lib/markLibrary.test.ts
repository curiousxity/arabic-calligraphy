import { describe, expect, it } from "vitest";
import { findMark, MARK_GROUPS, MARK_UNITS_PER_EM, markPxBounds, markPxCmds } from "./markLibrary";

const all = MARK_GROUPS.flatMap((g) => g.items);

describe("mark library", () => {
  it("has the five groups, every id unique", () => {
    expect(MARK_GROUPS.map((g) => g.id)).toEqual(["strokes", "heads", "dots", "signs", "frames"]);
    expect(new Set(all.map((m) => m.id)).size).toBe(all.length);
    expect(all.length).toBeGreaterThan(40);
  });

  it("every outline uses only commands parseSvgPath keeps (no arcs)", () => {
    for (const m of all) expect(m.d, m.id).toMatch(/^[MLCZ0-9 .-]+$/);
  });

  it("every outline is centred on the origin and matches its stated size", () => {
    for (const m of all) {
      // At fontSize = units per em the px commands are in library units.
      const b = markPxBounds(markPxCmds(m.d, MARK_UNITS_PER_EM));
      expect(Math.abs(b.width - m.w), m.id).toBeLessThan(25);
      expect(Math.abs(b.height - m.h), m.id).toBeLessThan(25);
      expect(Math.abs(b.x + b.width / 2), m.id).toBeLessThan(15);
      expect(Math.abs(b.y + b.height / 2), m.id).toBeLessThan(15);
    }
  });

  it("scales with font size and flips about the centre", () => {
    const dot = findMark("dots-40")!;
    const small = markPxBounds(markPxCmds(dot.d, 40));
    const big = markPxBounds(markPxCmds(dot.d, 80));
    expect(big.width / small.width).toBeCloseTo(2, 5);
    const stroke = findMark("strokes-00")!;
    const plain = markPxBounds(markPxCmds(stroke.d, 100));
    const flipped = markPxBounds(markPxCmds(stroke.d, 100, true));
    expect(flipped.x).toBeCloseTo(-(plain.x + plain.width), 5);
    expect(flipped.width).toBeCloseTo(plain.width, 5);
  });

  it("an empty outline measures as nothing", () => {
    expect(markPxBounds(markPxCmds("", 50))).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});
