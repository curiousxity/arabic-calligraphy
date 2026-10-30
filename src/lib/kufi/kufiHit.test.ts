import { describe, expect, it } from "vitest";
import { hitKufiUnit, hitStretchEnd, kufiFormsOf, kufiGlyphById, placementInk, stretchEnds, unitRings } from "./kufiHit";
import type { KufiPackResult, KufiPlacement } from "./kufiPack";
import { resolveKufiText } from "./kufiWords";

type Ok = Extract<KufiPackResult, { ok: true }>;

/**
 * A hand-laid panel of three letters, so every expectation is read off the
 * letter table rather than off the packer:
 *
 * - unit 0: `alef.isolated.0`, a 7-cell bar, upright, at col 1 rows 1–7.
 * - unit 1: `beh.medial.0` (no stretch point) at col 4, rows 5–7.
 * - unit 2: `alef.final.1` turned a quarter: its stem runs along row 1 from
 *   col 6 to col 10, its foot at (row 2, col 6).
 */
function panel(stretch0: number[] = [0], extra: Partial<Ok> = {}): Ok {
  const cols = 12;
  const rows = 12;
  const placements: KufiPlacement[] = [
    { unitIndex: 0, key: "alef:isolated", glyphId: "alef.isolated.0", col: 1, row: 1, turn: 0, stretch: stretch0 },
    { unitIndex: 1, key: "beh:medial", glyphId: "beh.medial.0", col: 4, row: 5, turn: 0, stretch: [] },
    { unitIndex: 2, key: "alef:final", glyphId: "alef.final.1", col: 6, row: 1, turn: 1, stretch: [0] },
  ];
  const r: Ok = { ok: true, cols, rows, cells: new Uint8Array(cols * rows), placements, editsBreakPacking: false, ...extra };
  for (const p of placements) for (const i of placementInk(r, p)) r.cells[i] = 1;
  return r;
}

describe("kufiGlyphById", () => {
  it("finds a glyph by its id and returns null for an unknown one", () => {
    expect(kufiGlyphById("alef.isolated.0")?.rows).toEqual(["#", "#", "#", "#", "#", "#", "#"]);
    expect(kufiGlyphById("alef.isolated.99")).toBeNull();
    expect(kufiGlyphById("nope")).toBeNull();
  });
});

describe("kufiFormsOf", () => {
  it("lists the alternates for a unit's joining form, falling back to isolated", () => {
    const units = resolveKufiText("لا يكلف الله نفسا إلا وسعها").units;
    const lam = units.find((u) => u.key === "lam:medial")!;
    expect(kufiFormsOf(lam).map((g) => g.id)).toEqual(expect.arrayContaining(["lam.medial.0"]));
    expect(kufiFormsOf(lam).length).toBeGreaterThan(1);
    expect(kufiFormsOf({ ...lam, form: "isolated" }).every((g) => g.id.startsWith("lam.isolated."))).toBe(true);
  });
});

describe("placementInk", () => {
  it("turns and places the glyph's cells the way the packer does", () => {
    const r = panel();
    expect([...placementInk(r, r.placements[0])]).toEqual([1, 2, 3, 4, 5, 6, 7].map((row) => row * r.cols + 1));
    // beh.medial.0: ".#." ".#." "###" at (5, 4)
    expect([...placementInk(r, r.placements[1])].sort((a, b) => a - b)).toEqual(
      [5 * 12 + 5, 6 * 12 + 5, 7 * 12 + 4, 7 * 12 + 5, 7 * 12 + 6]
    );
    // alef.final.1 turned once: "#####" over "#...."
    expect([...placementInk(r, r.placements[2])].sort((a, b) => a - b)).toEqual([
      1 * 12 + 6, 1 * 12 + 7, 1 * 12 + 8, 1 * 12 + 9, 1 * 12 + 10, 2 * 12 + 6,
    ]);
  });

  it("drops cells outside the panel rather than wrapping them", () => {
    const r = panel();
    const off: KufiPlacement = { ...r.placements[0], col: 11, row: 10 };
    expect([...placementInk(r, off)]).toEqual([10 * 12 + 11, 11 * 12 + 11]);
  });
});

describe("hitKufiUnit", () => {
  it("returns the unit whose letter covers the cell, and null on paper", () => {
    const r = panel();
    expect(hitKufiUnit(r, 1, 3)).toBe(0);
    expect(hitKufiUnit(r, 5, 6)).toBe(1);
    expect(hitKufiUnit(r, 4, 7)).toBe(1);
    expect(hitKufiUnit(r, 8, 1)).toBe(2);
    expect(hitKufiUnit(r, 6, 2)).toBe(2);
    expect(hitKufiUnit(r, 0, 0)).toBeNull();
    expect(hitKufiUnit(r, 3, 7)).toBeNull();
    expect(hitKufiUnit(r, -1, 3)).toBeNull();
    expect(hitKufiUnit(r, 1, 12)).toBeNull();
  });

  it("a filler square belongs to no unit", () => {
    const r = panel();
    r.cells[9 * r.cols + 9] = 1;
    expect(hitKufiUnit(r, 9, 9)).toBeNull();
  });
});

describe("stretchEnds / hitStretchEnd", () => {
  it("a letter without a stretch point has no ends", () => {
    const r = panel();
    expect(stretchEnds(r, 1)).toEqual([]);
    expect(hitStretchEnd(r, 5, 5)).toBeNull();
    expect(hitStretchEnd(r, 4, 7)).toBeNull();
  });

  it("an upright bar has an end at its top and at its foot, each pointing outward", () => {
    const r = panel();
    const ends = stretchEnds(r, 0);
    expect(ends).toHaveLength(2);
    expect(ends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitIndex: 0, stretchIndex: 0, col: 1, row: 1, dc: 0, dr: -1 }),
        expect.objectContaining({ unitIndex: 0, stretchIndex: 0, col: 1, row: 7, dc: 0, dr: 1 }),
      ])
    );
    expect(hitStretchEnd(r, 1, 1)).toMatchObject({ unitIndex: 0, stretchIndex: 0, dr: -1 });
    expect(hitStretchEnd(r, 1, 7)).toMatchObject({ unitIndex: 0, stretchIndex: 0, dr: 1 });
    // the empty cell just beyond an end is part of its handle
    expect(hitStretchEnd(r, 1, 0)).toMatchObject({ unitIndex: 0, dr: -1 });
    expect(hitStretchEnd(r, 1, 8)).toMatchObject({ unitIndex: 0, dr: 1 });
    // the middle of the stroke is the letter, not a handle
    expect(hitStretchEnd(r, 1, 4)).toBeNull();
    expect(hitStretchEnd(r, 2, 4)).toBeNull();
  });

  it("a turned letter's stem ends run along the row", () => {
    const r = panel();
    const ends = stretchEnds(r, 2);
    expect(ends).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unitIndex: 2, stretchIndex: 0, col: 10, row: 1, dc: 1, dr: 0 }),
        expect.objectContaining({ unitIndex: 2, stretchIndex: 0, col: 6, row: 1, dc: -1, dr: 0 }),
      ])
    );
    expect(hitStretchEnd(r, 11, 1)).toMatchObject({ unitIndex: 2, dc: 1 });
    expect(hitStretchEnd(r, 8, 1)).toBeNull();
    // the foot is not on the stem's axis: a letter hit, not a handle
    expect(hitStretchEnd(r, 6, 2)).toBeNull();
  });

  it("an end with ink just beyond it (a join, a dot) is no handle", () => {
    const r = panel();
    r.cells[0 * r.cols + 1] = 1;
    expect(stretchEnds(r, 0).map((e) => e.row)).toEqual([7]);
    expect(hitStretchEnd(r, 1, 1)).toBeNull();
  });

  it("an end on the panel's edge still has a handle on the end cell itself", () => {
    const r = panel();
    const p = { ...r.placements[0], row: 0 };
    const moved: Ok = { ...r, placements: [p, r.placements[1], r.placements[2]], cells: new Uint8Array(r.cols * r.rows) };
    for (const q of moved.placements) for (const i of placementInk(moved, q)) moved.cells[i] = 1;
    expect(hitStretchEnd(moved, 1, 0)).toMatchObject({ unitIndex: 0, dr: -1 });
  });

  it("follows the stroke as it is stretched or shortened", () => {
    const grown = panel([2]);
    expect(stretchEnds(grown, 0).map((e) => e.row).sort()).toEqual([1, 9]);
    const cut = panel([-2]);
    expect(stretchEnds(cut, 0).map((e) => e.row).sort()).toEqual([1, 5]);
  });

  it("a handle wins over the letter under it", () => {
    const r = panel();
    expect(hitKufiUnit(r, 1, 1)).toBe(0);
    expect(hitStretchEnd(r, 1, 1)).not.toBeNull();
  });
});

describe("unitRings", () => {
  it("traces one closed ring round a bar and none for a unit with no ink", () => {
    const r = panel();
    const rings = unitRings(r, 0);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toEqual(expect.arrayContaining([[1, 1], [2, 1], [2, 8], [1, 8]]));
    expect(unitRings(r, 7)).toEqual([]);
  });
});
