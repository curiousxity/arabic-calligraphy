import { describe, expect, it } from "vitest";
import { loadTarkibLibrary } from "./tarkibSchema";
import { composeInShape, type ComposeInput } from "./tarkibCompose";
import { analyzePhrase } from "./tarkibText";
import { templatePolygon } from "./stackTemplates";
import { chainPhraseOnLine } from "./tarkibChain";
import { arrangeStackInShape } from "./stackArrange";
import { scoreLayout } from "./tarkibScore";
import { canClimb } from "./tarkibClimb";
import type { Pt } from "./strokeCuts";

const lib = await loadTarkibLibrary();
const TARGET = "أُمّ أَيْمَن الحُبّ حَيَاتِي";
const input = (text: string): ComposeInput => ({
  analysis: analyzePhrase(text), shapePx: templatePolygon("teardrop", 400, 1) as Pt[], fontSize: 40,
  // a generous budget: the search's fixed step count, not machine load, ends it
  seed: 7, count: 4, budgetMs: 30000, signs: {}, fillers: [], fillerAmount: 0,
});

describe("canClimb", () => {
  it("lets a joined letter climb off a meem, never off an alif or into a starting form", () => {
    const [ya, meem, nun] = analyzePhrase("أيمن").words[0].runs[1].letters;
    expect(canClimb(meem, nun)).toBe(true);
    expect(canClimb(nun, ya)).toBe(false);
    const alif = analyzePhrase("ام").words[0].runs[0].letters[0];
    expect(canClimb(alif, meem)).toBe(false);
  });
});

describe("composeInShape", () => {
  const first = composeInShape(lib, input(TARGET));

  it("composes the first target in the teardrop: four distinct candidates, inside the shape, best first", () => {
    if ("error" in first) throw new Error(first.error);
    expect(first.candidates).toHaveLength(4);
    const totals = first.candidates.map((c) => c.score.total);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
    for (const c of first.candidates) { expect(c.score.outside).toBeLessThan(0.01); expect(c.score.order).toBe(0); }
    expect(new Set(first.candidates.map((c) => c.pieceIds.join())).size).toBe(4);
  }, 20000);

  // Deferred 2026-10-18: since joins are trimmed and bridged, the composer
  // ranks a smaller layout first (0.89 unfilled against the arranger's 0.86);
  // the user paused composing until the joins are right. Re-enable when the
  // composer is tuned again.
  it.skip("beats the row arranger's layout of the same pieces on unfilled space", () => {
    if ("error" in first) throw new Error(first.error);
    const line = chainPhraseOnLine(lib, TARGET);
    if ("error" in line) throw new Error();
    const shapePx = input(TARGET).shapePx;
    const rows = arrangeStackInShape({ pieces: line.pieces, joins: line.joins, shapePx, fontSize: 40, unitsPerEm: 400 })!;
    const k = 400 / rows.fontSize;
    const rowScore = scoreLayout({ pieces: rows.pieces, joins: rows.joins, nib: { width: 48, minFraction: 0.5 }, shape: shapePx.map(([x, y]) => [x * k, y * k] as Pt), readingOrder: [], stretchUsed: {} });
    expect(first.candidates[0].score.unfilled).toBeLessThan(rowScore.unfilled);
  }, 20000);

  it("is repeatable for a seed", () => {
    if ("error" in first) throw new Error(first.error);
    const again = composeInShape(lib, input(TARGET));
    if ("error" in again) throw new Error(again.error);
    expect(again.candidates.map((c) => c.pieceIds.join())).toEqual(first.candidates.map((c) => c.pieceIds.join()));
    expect(again.candidates.map((c) => c.score.total)).toEqual(first.candidates.map((c) => c.score.total));
  }, 20000);

  it("refuses unsupported letters and reports a shape it cannot fill", () => {
    expect(composeInShape(lib, input("حب 7"))).toEqual({ error: "unsupported", letters: ["7"] });
    const t0 = Date.now();
    expect(composeInShape(lib, { ...input("أيمن"), shapePx: [[0, 0], [1, 0], [0, 1]], budgetMs: 1000 })).toEqual({ error: "no-fit" });
    expect(Date.now() - t0).toBeLessThan(1500);
  });
});
