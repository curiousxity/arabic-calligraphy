import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { _internal, type KufiPackResult } from "./kufiPack";
import { cellRings } from "./kufiGrid";
import { STAR_KS, starConstruction } from "./kufiStarGeometry";
import { kufiStarPath } from "./kufiStarPath";
import { kufiStarKey, kufiStarStatus, layoutKufiStar, octagonSizeFor, type KufiStarInputs } from "./kufiStarLayout";

// Layouts are asserted on the work budget alone, so machine load cannot change them.
beforeAll(() => _internal.setClockOverride(Infinity));
afterAll(() => _internal.setClockOverride(null));
beforeEach(() => _internal.resetRegionPacks());

type Ok = Extract<KufiPackResult, { ok: true }>;

/** 4-fold alternative at size 23, where الله packs a wedge. */
const c = starConstruction(4, STAR_KS[4][1], 23);
const wedgeA = c.regions.filter((r) => r.kind === "wedgeA");
const withText = (fill: (i: number) => string): KufiStarInputs => ({
  layout: "wedges",
  fold: 4,
  k: STAR_KS[4][1],
  size: 23,
  regions: c.regions.map((r) => fill(r.index)),
});
const allahInWedgeA = withText((i) => (c.regions[i].kind === "wedgeA" ? "الله" : ""));

describe("layoutKufiStar", { timeout: 120_000 }, () => {
  it("every region of a kind shares one mask, so one packing serves them all", () => {
    for (const kind of ["wedgeA", "wedgeB", "corner"] as const) {
      const of = c.regions.filter((r) => r.kind === kind);
      expect(of.length).toBe(4);
      for (const r of of) {
        expect(r.mask.cols).toBe(of[0].mask.cols);
        expect(r.mask.rows).toBe(of[0].mask.rows);
        expect(Array.from(r.mask.cells)).toEqual(Array.from(of[0].mask.cells));
      }
    }
  });

  it("الله in every wedgeA packs once and every copy is the same packing", () => {
    const layout = layoutKufiStar(allahInWedgeA);
    expect(_internal.regionPacks()).toBe(1);
    expect(layout.unpacked).toEqual([]);
    const first = layout.regions[wedgeA[0].index].result as Ok;
    for (const r of wedgeA) {
      const got = layout.regions[r.index];
      expect(got.text).toBe("الله");
      expect(got.result?.ok).toBe(true);
      expect(Array.from((got.result as Ok).cells)).toEqual(Array.from(first.cells));
    }
  });

  it("an empty region is null; a region whose text does not pack is listed in unpacked", () => {
    // محمد packs no wedge at any size up to 60 (task 3).
    const inputs = withText((i) => (i === 1 ? "الله" : i === 2 ? "محمد" : ""));
    const layout = layoutKufiStar(inputs);
    expect(layout.regions.length).toBe(c.regions.length);
    expect(layout.regions[0]).toEqual({ text: "", result: null });
    expect(layout.regions[1].result?.ok).toBe(true);
    expect(layout.regions[2].result?.ok).toBe(false);
    expect(layout.unpacked).toEqual([2]);
    expect(kufiStarStatus(layout, false)).toBe("1 region doesn't fit");
  });

  it("equal inputs give equal layouts, so a reopened panel is identical", () => {
    const a = layoutKufiStar(allahInWedgeA);
    const again = { ...allahInWedgeA, regions: [...allahInWedgeA.regions] };
    expect(layoutKufiStar(again)).toEqual(a);
    expect(kufiStarKey(again)).toBe(kufiStarKey(allahInWedgeA));
  });

  it("the path of a layout holds one M per traced ring and no NaN", () => {
    const layout = layoutKufiStar(allahInWedgeA);
    const cells = layout.regions.map((r) => (r.result?.ok ? r.result.cells : null));
    const d = kufiStarPath(c, cells, false, 10);
    const ok = layout.regions[wedgeA[0].index].result as Ok;
    const rings = cellRings(Array.from(ok.cells, (v) => v !== 0), ok.cols, ok.rows).length;
    expect(rings).toBeGreaterThan(0);
    expect(d.split("M").length - 1).toBe(rings * wedgeA.length);
    expect(d).not.toContain("NaN");
  });
});

describe("octagonSizeFor", () => {
  it("is the line the band forms take at their authored widths (joined letters sharing a column), the corner word's widening, and the band's depth", () => {
    // الله: 9 wide, its corner heh two wider; محمد: 4 + 5 + 5 + 4 less three joins, no tall letter to clear the corner;
    // الحمد لله: 15 + 1 + 7 (the first medial ح form, 5 wide), and لله's heh two wider (the old estimate counted a gap at
    // every join: 27 and 36); the scan from two below finds 32, where the line has room
    expect(octagonSizeFor("الله")).toBe(17);
    expect(octagonSizeFor("محمد")).toBe(21);
    expect(octagonSizeFor("الحمد لله")).toBe(31);
    expect(octagonSizeFor("الله الله الله الله")).toBe(47);
    expect(octagonSizeFor("")).toBe(13);
  });
});

describe("kufiStarKey and kufiStarStatus", () => {
  it("the key changes with any input", () => {
    const base = kufiStarKey(allahInWedgeA);
    expect(kufiStarKey({ ...allahInWedgeA, size: 25 })).not.toBe(base);
    expect(kufiStarKey({ ...allahInWedgeA, k: 3 })).not.toBe(base);
    expect(kufiStarKey({ ...allahInWedgeA, regions: allahInWedgeA.regions.map(() => "") })).not.toBe(base);
  });

  it("names what the panel is waiting on or how many regions did not pack", () => {
    const none = { regions: [], unpacked: [] };
    expect(kufiStarStatus(none, false)).toBeNull();
    expect(kufiStarStatus(null, false)).toBe("Arranging…");
    expect(kufiStarStatus(null, true)).toBe("Couldn't arrange this text");
    expect(kufiStarStatus({ regions: [], unpacked: [1, 3] }, false)).toBe("2 regions don't fit");
  });

  it("warns that an outline wider than 0 exports as a separate path, as the Kufi panel does", () => {
    const none = { regions: [], unpacked: [] };
    const warning = "The outline exports as a separate path.";
    expect(kufiStarStatus(none, false, 0)).toBeNull();
    expect(kufiStarStatus(none, false, 2)).toBe(warning);
    expect(kufiStarStatus({ regions: [], unpacked: [1] }, false, 0.5)).toBe(`1 region doesn't fit
${warning}`);
    expect(kufiStarStatus(null, true, 1)).toBe(`Couldn't arrange this text
${warning}`);
  });
});
