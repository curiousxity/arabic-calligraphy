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
    // no star fills its corners with الله alone: a 4-fold wedge holds the four-upright word up to 27 and its
    // corner from 29 (2026-11-02; it did at 28 on the merged form), 5- and 6-fold corners later still
    expect(repeats.some((o) => kindsOf(o).some((k, i) => k === "corner" && o.inputs.regions[i] !== ""))).toBe(false);
  });

  it("الله: every fold's classic star holds the word once a wedge; the one dense fit is the 5-fold alternative star, three a wedge at 42, every copy tall", () => {
    // On the star's الله (five rows, or tall with its shafts two above the heh's box), with a word's
    // shafts carried up together or not at all and every copy in a region on forms of one stem
    // (2026-11-02; see kufiPackRegion.test.ts), a 4-fold wedge holds the word once (20 to 27) and
    // never twice; the classic 5- and 6-fold wedges once (the 5-fold ×3 at 40 and 6-fold ×2 at 40
    // mixed five-row copies with a tall one and are refused; the 6-fold five-row pairs at 34 to 38
    // lie below the fill estimate's jump); the 5-fold {10/2} wedge three times at 42, two under
    // their bars on the line and one bare above them, its shafts in the star point's notch.
    const e = evalAllah();
    for (const fold of [4, 5, 6] as StarFold[]) {
      const classic = e.offers.filter((x) => x.pattern === "repeat" && x.fits && x.inputs.fold === fold && x.inputs.k === defaultStarK(fold));
      expect(classic.length, `${fold}-fold`).toBeGreaterThan(0);
      for (const o of classic) {
        expect(wordsOf(o.inputs.regions[1]), `${fold}-fold ${o.inputs.size}`).toHaveLength(1);
        expect(o.note).toMatch(/الله in every wedge/);
      }
    }
    const dense = e.offers.filter((x) => x.pattern === "repeat" && x.fits && wordsOf(x.inputs.regions[1]).length > 1);
    expect(dense.map((o) => [o.inputs.fold, o.inputs.k, o.inputs.size])).toEqual([[5, 2, 42]]);
    expect(wordsOf(dense[0].inputs.regions[1])).toHaveLength(3);
    expect(dense[0].quality.cut).toBe(0);
    expect(dense[0].note).toBe("الله ×3 in every wedge (5-fold, alternative star, size 42)");
    const forms = dense[0].layout.regions.flatMap((r) => (r.result?.ok ? r.result.placements.map((p) => p.glyphId) : []));
    expect(forms.every((id) => id === "allah.isolated.5" || id === "allah.isolated.6")).toBe(true);
    expect(forms).toContain("allah.isolated.5");
    expect(forms).toContain("allah.isolated.6");
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
    // the 4-fold classic star holds the pair as a repeat at 30, الله محمد in every wedge and الله in
    // the corners (the reference's four filled corners). In turn (alternate) it fits nowhere: محمد
    // fits a wedge twice from 29, الله once up to 27 only (2026-11-02, the four-upright word)
    const four = e.offers.find((o) => o.pattern === "repeat" && o.fits && o.inputs.fold === 4 && o.inputs.k === defaultStarK(4));
    expect(four).toBeDefined();
    expect(four!.inputs.size).toBe(30);
    expect(wordsOf(four!.inputs.regions[1])).toEqual(["الله", "محمد"]);
    expect(four!.inputs.regions[9]).toBe("الله");
    expect(four!.note).toContain("in the corners");
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
    // the smallest squares with every word rising: one الله at 17, two at 27, three at 37, four at 47 (their lines take
    // 11, 21, 31, 41: the band's form is 9 wide, and the corner word's heh two wider so its first lam clears the next band)
    expect(oct.map((o) => o.inputs.size)).toEqual([17, 27, 37, 47]);
    for (const o of oct) expect(o.layout.octagon!.words).toEqual({ risen: wordsOf(o.inputs.regions[0]).length, still: 0 });
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
  it("pins الله's fits: 4-fold classic ×1 at 23 (tall) and 20, 5-fold classic ×1 at 24 and alternative ×3 at 42, 6-fold classic ×1 at 30", () => {
    // Measured 2026-11-02 under the work cap, on the star's الله with a word's shafts carried up
    // together or not at all, the tall form preferred and every copy in a region on one stem: a
    // 4-fold wedge holds the five-row word at 20 (a cut stem, two cells) and the tall one from 23,
    // so the scan goes on from 20 and offers 23 too, ranked first. The dense classic fits that
    // mixed the forms (5-fold ×3 at 40, 6-fold ×2 at 40) are gone; the 5-fold {10/2} star's ×3 at
    // 42 is reached inside the cap because a task whose sizes keep failing after a fit is set
    // aside (`PATIENCE`), where before the classic 5-fold scan to 60 spent the whole budget. The
    // merged form's fits (4-fold 18 and ×2 at 28 with the corners filled, 5-fold 21 and ×3 at
    // 34, 6-fold 24 and ×3 at 39) went earlier.
    const e = evalAllah();
    const at = (fold: StarFold, size: number, k = defaultStarK(fold)) =>
      e.offers.find((x) => x.pattern === "repeat" && x.fits && x.inputs.fold === fold && x.inputs.k === k && x.inputs.size === size);
    expect(wordsOf(at(4, 23)!.inputs.regions[1])).toHaveLength(1);
    expect(at(4, 23)!.quality.cut).toBe(0);
    expect(wordsOf(at(4, 20)!.inputs.regions[1])).toHaveLength(1);
    expect(at(4, 20)!.inputs.regions[9]).toBe("");
    expect(at(4, 20)!.quality.cut).toBe(16); // two cells a word, eight wedges
    expect(e.offers.indexOf(at(4, 23)!)).toBeLessThan(e.offers.indexOf(at(4, 20)!));
    expect(wordsOf(at(5, 24)!.inputs.regions[1])).toHaveLength(1);
    expect(at(5, 24)!.quality.cut).toBe(0);
    expect(wordsOf(at(5, 42, 2)!.inputs.regions[1])).toHaveLength(3);
    expect(at(5, 42, 2)!.quality.cut).toBe(0);
    expect(wordsOf(at(6, 30)!.inputs.regions[1])).toHaveLength(1);
    expect(at(6, 30)!.quality.cut).toBe(0);
    expect(at(5, 40)).toBeUndefined();
    expect(at(6, 40)).toBeUndefined();
    // every wedge offer of الله draws the word tall where its wedge has room for a tall form: the tall forms
    // (.5 bare, .6 under its bar) at 23, 24, 30 and 42, the five-row one at 20 alone
    const forms = (o: KufiStarOffer) => new Set(o.layout.regions.flatMap((r) => (r.result?.ok ? r.result.placements.map((p) => p.glyphId) : [])));
    expect(forms(at(4, 23)!)).toEqual(new Set(["allah.isolated.5"]));
    expect(forms(at(5, 24)!)).toEqual(new Set(["allah.isolated.5"]));
    expect(forms(at(6, 30)!)).toEqual(new Set(["allah.isolated.6"]));
    expect(forms(at(5, 42, 2)!)).toEqual(new Set(["allah.isolated.5", "allah.isolated.6"]));
    expect(forms(at(4, 20)!)).toEqual(new Set(["allah.isolated.3"]));
    // no offer of الله mixes the five-row form with a tall one in one region
    for (const o of e.offers)
      for (const r of o.layout.regions) {
        if (!r.result?.ok) continue;
        const stems = new Set(r.result.placements.map((p) => (p.glyphId === "allah.isolated.3" ? "five-row" : "tall")));
        expect(stems.size, `${o.note}`).toBeLessThanOrEqual(1);
      }
  });
});
