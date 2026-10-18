import { describe, expect, it } from "vitest";
import { scoreLayout, type ScoreInput } from "./tarkibScore";
import { loadTarkibLibrary } from "./tarkibSchema";
import { chainPhraseOnLine } from "./tarkibChain";
import { templatePolygon } from "./stackTemplates";
import { cmdsCentre } from "./stackGeometry";
import type { StackPiece } from "../types";
import type { Pt } from "./strokeCuts";

const NIB = { width: 48, minFraction: 0.5 };
const square = (size: number, cx = 0, cy = 0): Pt[] =>
  [[cx - size / 2, cy - size / 2], [cx + size / 2, cy - size / 2], [cx + size / 2, cy + size / 2], [cx - size / 2, cy + size / 2]];
function squarePiece(id: string, size: number, cx = 0, cy = 0, extra: Partial<StackPiece> = {}, height = size): StackPiece {
  const w = size / 2, h = height / 2;
  const cmds = [
    { type: "M" as const, x: -w, y: -h }, { type: "L" as const, x: w, y: -h }, { type: "L" as const, x: w, y: h },
    { type: "L" as const, x: -w, y: h }, { type: "Z" as const },
  ];
  return { id, cmds, x: cx, y: cy, rotation: 0, pivot: cmdsCentre(cmds), homeX: cx, homeY: cy, order: 0, role: "letter", faces: [], ...extra };
}
const base = (over: Partial<ScoreInput>): ScoreInput =>
  ({ pieces: [], joins: [], nib: NIB, shape: square(400), readingOrder: [], stretchUsed: {}, ...over });

describe("scoreLayout", () => {
  it("an empty shape is all unfilled; a shape covered in ink is not", () => {
    expect(scoreLayout(base({})).unfilled).toBeCloseTo(1, 2);
    expect(scoreLayout(base({ pieces: [squarePiece("a", 400)], readingOrder: ["a"] })).unfilled).toBeLessThan(0.05);
  });

  it("ink within half a pen of a gap fills it", () => {
    // two full-height bars a pen apart (twice the margin) leave no unfilled band between them
    const s = scoreLayout(base({ shape: square(200), pieces: [squarePiece("a", 76, -62, 0, {}, 200), squarePiece("b", 76, 62, 0, {}, 200)], readingOrder: ["a", "b"] }));
    expect(s.unfilled).toBeLessThan(0.05);
    const apart = scoreLayout(base({ shape: square(300), pieces: [squarePiece("a", 50, -125, 0, {}, 300), squarePiece("b", 50, 125, 0, {}, 300)], readingOrder: ["a", "b"] }));
    expect(apart.unfilled).toBeGreaterThan(0.3);
  });

  it("ink outside the shape is penalised", () => {
    expect(scoreLayout(base({ pieces: [squarePiece("a", 200, 300, 0)], readingOrder: ["a"] })).outside).toBeGreaterThan(0.5);
    expect(scoreLayout(base({ pieces: [squarePiece("a", 200)], readingOrder: ["a"] })).outside).toBe(0);
  });

  it("two letters overlapping count; a letter and its own dot do not", () => {
    const two = scoreLayout(base({ pieces: [squarePiece("a", 100, 0), squarePiece("b", 100, 40)], readingOrder: ["a", "b"] }));
    expect(two.overlap).toBeGreaterThan(0.2);
    const dot = scoreLayout(base({ pieces: [squarePiece("a", 100), squarePiece("ad0", 30, 20, 0, { role: "mark", parentId: "a" })], readingOrder: ["a"] }));
    expect(dot.overlap).toBe(0);
  });

  it("a later letter right of an earlier one on the same tier breaks reading order; above it does not", () => {
    const pieces = [squarePiece("a", 40, 100, 0), squarePiece("b", 40, -100, 0)];
    expect(scoreLayout(base({ pieces, readingOrder: ["b", "a"] })).order).toBe(1);
    expect(scoreLayout(base({ pieces, readingOrder: ["a", "b"] })).order).toBe(0);
    const climbed = [squarePiece("a", 40, 0, 100), squarePiece("b", 40, 100, -100)];
    expect(scoreLayout(base({ pieces: climbed, readingOrder: ["a", "b"] })).order).toBe(0);
  });

  it("stretch beyond a zone's maximum is penalised by the pen widths over", () => {
    expect(scoreLayout(base({ stretchUsed: { a: { used: 240, max: 192 } } })).overStretch).toBeCloseTo(1, 5);
    expect(scoreLayout(base({ stretchUsed: { a: { used: 100, max: 192 } } })).overStretch).toBe(0);
  });

  it("uneven tiers cost more than even ones", () => {
    const pieces = [squarePiece("a", 100, 0, 100), squarePiece("b", 300, 0, -200)];
    const even = [squarePiece("a", 100, 0, 100), squarePiece("b", 100, 0, -100)];
    const t = [["a"], ["b"]];
    expect(scoreLayout(base({ pieces, readingOrder: ["a", "b"], tiers: t })).uneven)
      .toBeGreaterThan(scoreLayout(base({ pieces: even, readingOrder: ["a", "b"], tiers: t })).uneven);
  });

  it("scores the first target's line in a teardrop in under 50 ms", async () => {
    const lib = await loadTarkibLibrary();
    const r = chainPhraseOnLine(lib, "أُمّ أَيْمَن الحُبّ حَيَاتِي");
    if ("error" in r) throw new Error();
    const shape = templatePolygon("teardrop", 2400, 1) as Pt[];
    const order = r.pieces.filter((p) => p.role === "letter").map((p) => p.id);
    scoreLayout(base({ pieces: r.pieces, joins: r.joins, shape, readingOrder: order }));   // warm up
    const t0 = performance.now();
    const s = scoreLayout(base({ pieces: r.pieces, joins: r.joins, shape, readingOrder: order }));
    expect(performance.now() - t0).toBeLessThan(50);
    expect(s.total).toBeGreaterThan(0);
  });
});
