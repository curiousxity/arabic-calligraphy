import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _internal } from "./kufiPack";
import { STAR_KS, starConstruction } from "./kufiStarGeometry";
import { _resetKufiStarEvaluation, evaluateKufiStar, STAR_MAX_OFFERS, type KufiStarOffer } from "./kufiStarEvaluate";

// Offers are asserted on the work cap alone (STAR_EVAL_MAX_TRIES), so machine load cannot change them.
beforeAll(() => _internal.setClockOverride(Infinity));
afterAll(() => _internal.setClockOverride(null));
beforeEach(() => _resetKufiStarEvaluation());

const kindsOf = (o: KufiStarOffer) => starConstruction(o.inputs.fold, o.inputs.k, o.inputs.size).regions.map((r) => r.kind);

describe("evaluateKufiStar", { timeout: 120_000 }, () => {
  it("الله: a repeat offer fits, with الله in every wedge and nothing else", () => {
    const e = evaluateKufiStar("الله", 0);
    const repeat = e.offers.find((o) => o.pattern === "repeat" && o.fits);
    expect(repeat).toBeDefined();
    const kinds = kindsOf(repeat!);
    repeat!.inputs.regions.forEach((t, i) => expect(t).toBe(kinds[i].startsWith("wedge") ? "الله" : ""));
    expect(repeat!.layout.unpacked).toEqual([]);
    expect(repeat!.quality.size).toBe(repeat!.inputs.size);
  });

  it("الله محمد: an alternate offer puts الله in the A wedges and محمد in the B wedges, does not fit, and says محمد does not", () => {
    const e = evaluateKufiStar("الله محمد", 0);
    // on a star whose wedge fits الله (not the 4-fold classic one, which fits it at no size)
    const alt = e.offers.find((o) => o.pattern === "alternate" && !(o.inputs.fold === 4 && o.inputs.k === STAR_KS[4][0]));
    expect(alt).toBeDefined();
    const kinds = kindsOf(alt!);
    alt!.inputs.regions.forEach((t, i) =>
      expect(t).toBe(kinds[i] === "wedgeA" ? "الله" : kinds[i] === "wedgeB" ? "محمد" : "")
    );
    expect(alt!.fits).toBe(false);
    expect(alt!.note).toContain("محمد does not fit");
    expect(alt!.note).not.toContain("الله does not fit");
  });

  it("empty or blank text gives no offers", () => {
    expect(evaluateKufiStar("", 0).offers).toEqual([]);
    expect(evaluateKufiStar("   ", 0).offers).toEqual([]);
  });

  it("a word with no Kufi form is reported and placed nowhere", () => {
    const e = evaluateKufiStar("الله abc", 0);
    expect(e.words).toEqual([
      { text: "الله", drawable: true },
      { text: "abc", drawable: false },
    ]);
    expect(e.offers.length).toBeGreaterThan(0);
    for (const o of e.offers) for (const t of o.inputs.regions) expect(t).not.toContain("abc");
  });

  it("offers are sorted: fitting first, then fewer filler squares and bars, then smaller size; at most six", () => {
    const e = evaluateKufiStar("الله محمد", 0);
    expect(e.offers.length).toBeLessThanOrEqual(STAR_MAX_OFFERS);
    for (let i = 1; i < e.offers.length; i++) {
      const a = e.offers[i - 1], b = e.offers[i];
      expect(a.fits || !b.fits).toBe(true);
      if (a.fits && b.fits) {
        const qa = a.quality.squares + a.quality.bars, qb = b.quality.squares + b.quality.bars;
        expect(qa <= qb).toBe(true);
        if (qa === qb) expect(a.quality.size <= b.quality.size).toBe(true);
      }
    }
    // الله fits more than one construction, so the order among fitting offers is exercised too.
    const fitting = evaluateKufiStar("الله", 0).offers.filter((o) => o.fits);
    expect(fitting.length).toBeGreaterThan(1);
    for (let i = 1; i < fitting.length; i++) {
      const qa = fitting[i - 1].quality, qb = fitting[i].quality;
      expect(qa.squares + qa.bars <= qb.squares + qb.bars).toBe(true);
      if (qa.squares + qa.bars === qb.squares + qb.bars) expect(qa.size <= qb.size).toBe(true);
    }
    // ...and the ones that do not fit come after, saying so.
    const all = evaluateKufiStar("الله", 0).offers;
    expect(all.slice(0, fitting.length).every((o) => o.fits)).toBe(true);
    for (const o of all.slice(fitting.length)) expect(o.note).toContain("does not fit");
  });

  it("a run round the wedges needs a word for each wedge: fewer words give no run offer and say how many more", () => {
    const e = evaluateKufiStar("الله محمد", 0);
    expect(e.offers.some((o) => o.pattern === "run")).toBe(false);
    expect(e.notes).toContain("Running the words round 4-fold needs 6 more words");
    expect(e.notes).toContain("Running the words round 6-fold needs 10 more words");
  });
});

describe("the size scan", { timeout: 120_000 }, () => {
  it("finds الله repeated in every wedge at its measured size: 4-fold alternative 23, 5-fold classic 27, 6-fold classic 32", () => {
    const e = evaluateKufiStar("الله", 0);
    for (const [fold, k, size] of [[4, STAR_KS[4][1], 23], [5, STAR_KS[5][0], 27], [6, STAR_KS[6][0], 32]] as const) {
      const o = e.offers.find((x) => x.pattern === "repeat" && x.inputs.fold === fold && x.inputs.k === k);
      expect(o, `${fold}-fold`).toBeDefined();
      expect(o!.fits).toBe(true);
      expect(o!.inputs.size).toBe(size);
    }
  });
});
