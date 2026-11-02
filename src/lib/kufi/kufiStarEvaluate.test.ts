import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _internal } from "./kufiPack";
import { defaultStarK, starConstruction, type StarFold } from "./kufiStarGeometry";
import { _resetKufiStarEvaluation, evaluateKufiStar, OCTAGON_OFFERS, STAR_MAX_OFFERS, type KufiStarEvaluation, type KufiStarOffer } from "./kufiStarEvaluate";
import { octagonRows } from "./kufiOctagon";

// Offers are asserted on the work cap alone (STAR_EVAL_MAX_TRIES), so machine load cannot change them.
// The pack cache is shared by the tests below: every call of one text gives the same answer, since
// the cap counts real packs and a cached text spends none.
beforeAll(() => {
  _internal.setClockOverride(Infinity);
  _resetKufiStarEvaluation();
});
afterAll(() => _internal.setClockOverride(null));

const kindsOf = (o: KufiStarOffer) => starConstruction(o.inputs.fold, o.inputs.k, o.inputs.size).regions.map((r) => r.kind);
const wordsOf = (t: string) => t.split(" ").filter((w) => w !== "");
const density = (o: KufiStarOffer) => o.quality.words / o.inputs.regions.filter((t) => t !== "").length;

let allah: KufiStarEvaluation;
let two: KufiStarEvaluation;
const evalAllah = () => (allah ??= evaluateKufiStar("الله", 0));
const evalTwo = () => (two ??= evaluateKufiStar("الله محمد", 0));

describe("evaluateKufiStar", { timeout: 600_000 }, () => {
  it("الله: the repeat offers fill every wedge with الله repeated, the corners where there is room, and nothing else", () => {
    const e = evalAllah();
    const repeats = e.offers.filter((o) => o.pattern === "repeat" && o.fits);
    expect(repeats.length).toBeGreaterThan(0);
    for (const o of repeats) {
      const kinds = kindsOf(o);
      o.inputs.regions.forEach((t, i) => {
        if (kinds[i] === "centre") expect(t).toBe("");
        else if (kinds[i] === "corner") expect(t === "" || wordsOf(t).every((w) => w === "الله")).toBe(true);
        else {
          expect(wordsOf(t).length).toBeGreaterThan(0);
          expect(wordsOf(t).every((w) => w === "الله")).toBe(true);
        }
      });
      expect(o.layout.unpacked).toEqual([]);
      expect(o.quality.size).toBe(o.inputs.size);
      expect(o.quality.squares).toBe(0);
    }
    // a 4-fold star fills its corners too
    const corners = repeats.find((o) => o.inputs.fold === 4 && kindsOf(o).some((k, i) => k === "corner" && o.inputs.regions[i] !== ""));
    expect(corners).toBeDefined();
    expect(corners!.note).toContain("in the corners");
  });

  it("الله: every fold gets a dense fit on its classic star, the word three times in a 5- or 6-fold wedge, twice in a 4-fold one", () => {
    // A 4-fold wedge holds الله four times only with the heh's wall carried up, which no bar does
    // any more (2026-11-02; see kufiPackRegion.test.ts): its densest fit is two a wedge, at 28.
    const e = evalAllah();
    for (const fold of [4, 5, 6] as StarFold[]) {
      const dense = e.offers.filter((x) => x.pattern === "repeat" && x.fits && x.inputs.fold === fold && x.inputs.k === defaultStarK(fold));
      expect(dense.length, `${fold}-fold`).toBeGreaterThan(0);
      expect(dense.some((o) => wordsOf(o.inputs.regions[1]).length >= (fold === 4 ? 2 : 3)), `${fold}-fold`).toBe(true);
      for (const o of dense) expect(o.note).toMatch(/الله( ×\d+)? in every wedge/);
    }
  });

  it("الله محمد: an alternate offer puts الله in the A wedges and محمد in the B wedges, each repeated to fill", () => {
    const e = evalTwo();
    const alt = e.offers.find((o) => o.pattern === "alternate");
    expect(alt).toBeDefined();
    const kinds = kindsOf(alt!);
    alt!.inputs.regions.forEach((t, i) => {
      if (kinds[i] === "wedgeA") expect(wordsOf(t).every((w) => w === "الله") && t !== "").toBe(true);
      else if (kinds[i] === "wedgeB") expect(wordsOf(t).every((w) => w === "محمد") && t !== "").toBe(true);
      else if (kinds[i] === "centre") expect(t).toBe("");
    });
    if (!alt!.fits) expect(alt!.note).toContain("محمد does not fit");
    expect(alt!.note).not.toContain("الله does not fit");
    // the 4-fold classic star holds the pair as a repeat at 29, الله محمد in every wedge. In turn
    // (alternate) it no longer fits anywhere: محمد fits a wedge twice from 29, الله twice at 27
    // and 28 only, once up to 25, now that no bar carries the heh's wall up (2026-11-02)
    const four = e.offers.find((o) => o.pattern === "repeat" && o.fits && o.inputs.fold === 4 && o.inputs.k === defaultStarK(4));
    expect(four).toBeDefined();
    expect(four!.inputs.size).toBe(29);
    expect(wordsOf(four!.inputs.regions[1])).toEqual(["الله", "محمد"]);
    expect(e.offers.some((o) => o.pattern === "alternate" && o.fits)).toBe(false);
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

  it("the octagon squares come first: الله once to four times along a side, smallest first, each square packed and open at the centre", () => {
    const e = evalAllah();
    const oct = e.offers.filter((o) => o.pattern === "octagon");
    expect(oct.length).toBe(OCTAGON_OFFERS);
    expect(e.offers.slice(0, oct.length).every((o) => o.pattern === "octagon")).toBe(true);
    expect(e.offers.slice(oct.length).every((o) => o.pattern !== "octagon")).toBe(true);
    // the smallest squares: one الله at 15, two at 25, three at 35, four at 45 (their lines take 9, 19, 29, 39: the band's form is 9 wide)
    expect(oct.map((o) => o.inputs.size)).toEqual([15, 25, 35, 45]);
    oct.forEach((o, i) => {
      expect(o.fits).toBe(true);
      expect(o.inputs).toMatchObject({ layout: "octagon", fold: 4, k: defaultStarK(4) });
      expect(wordsOf(o.inputs.regions[0])).toEqual(Array.from({ length: i + 1 }, () => "الله"));
      expect(o.note).toContain("along each side");
      expect(o.layout.octagon).not.toBeNull();
      expect(o.layout.unpacked).toEqual([]);
      const rows = octagonRows(o.layout.octagon!);
      const mid = Math.floor(o.inputs.size / 2);
      expect(rows[mid][mid]).toBe(".");
    });
  });

  it("offers are sorted: the octagon first, then fitting first, denser first among them; misses after, saying so; at most STAR_MAX_OFFERS wedge offers, two per fold and pattern", () => {
    for (const all of [evalAllah(), evalTwo()]) {
      const e = { ...all, offers: all.offers.filter((o) => o.pattern !== "octagon") };
      expect(all.offers.length).toBeLessThanOrEqual(STAR_MAX_OFFERS + OCTAGON_OFFERS);
      expect(e.offers.length).toBeLessThanOrEqual(STAR_MAX_OFFERS);
      for (let i = 1; i < e.offers.length; i++) {
        const a = e.offers[i - 1], b = e.offers[i];
        expect(a.fits || !b.fits).toBe(true);
        const classic = (o: KufiStarOffer) => o.inputs.k === defaultStarK(o.inputs.fold);
        const corners = (o: KufiStarOffer) => o.inputs.regions.slice(2 * o.inputs.fold + 1).some((t) => t !== "");
        if (a.fits && b.fits) {
          expect(classic(a) || !classic(b)).toBe(true);
          if (classic(a) === classic(b)) {
            expect(corners(a) || !corners(b)).toBe(true);
            if (corners(a) === corners(b)) expect(density(a) >= density(b)).toBe(true);
          }
        }
      }
      for (const o of e.offers) if (!o.fits) expect(o.note).toContain("does not fit");
      const per = new Map<string, number>();
      for (const o of e.offers) per.set(`${o.inputs.fold}|${o.pattern}`, (per.get(`${o.inputs.fold}|${o.pattern}`) ?? 0) + 1);
      for (const n of per.values()) expect(n).toBeLessThanOrEqual(2);
    }
    // الله fits more than one construction, so the order among fitting offers is exercised too
    expect(evalAllah().offers.filter((o) => o.fits).length).toBeGreaterThan(1);
  });

  it("a run round the wedges needs a word for each wedge: fewer words give no run offer and say how many more", () => {
    const e = evalTwo();
    expect(e.offers.some((o) => o.pattern === "run")).toBe(false);
    expect(e.notes).toContain("Running the words round 4-fold needs 6 more words");
    expect(e.notes).toContain("Running the words round 6-fold needs 10 more words");
  });
});

describe("the size scan", { timeout: 600_000 }, () => {
  it("pins الله's dense fits: 4-fold classic ×2 at 28 with the corners filled, 5-fold classic ×3 at 34, 6-fold classic ×3 at 39", () => {
    // Measured 2026-11-02 under the work cap, with only shafts carried up by bars; the smallest
    // fits (4-fold 18, 5-fold 21, 6-fold 24, one word a wedge) are found first and give way to
    // the denser ones in the offers kept. 4-fold ×4 at 34 was an offer while the heh's wall rose.
    const e = evalAllah();
    const at = (fold: StarFold, size: number) =>
      e.offers.find((x) => x.pattern === "repeat" && x.fits && x.inputs.fold === fold && x.inputs.k === defaultStarK(fold) && x.inputs.size === size);
    expect(wordsOf(at(4, 28)!.inputs.regions[1])).toHaveLength(2);
    expect(at(4, 28)!.inputs.regions[9]).toBe("الله");
    expect(wordsOf(at(5, 34)!.inputs.regions[1])).toHaveLength(3);
    expect(wordsOf(at(6, 39)!.inputs.regions[1])).toHaveLength(3);
  });
});
