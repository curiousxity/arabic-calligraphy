import { describe, expect, it } from "vitest";
import {
  handleCentre,
  hitKufiUnit,
  hitRouteHandle,
  hitStretchEnd,
  hitWordStart,
  kufiFormsOf,
  kufiIsCentreUnit,
  kufiGlyphById,
  kufiReadingStep,
  nearestHandle,
  nearestHandleAt,
  placementInk,
  placementOf,
  routeHandleOf,
  routeOffsetFor,
  stretchEnds,
  unitRings,
} from "./kufiHit";
import { _internal, packKufiPanel, type KufiPackResult, type KufiPlacement } from "./kufiPack";
import { resolveKufiText, type KufiUnit } from "./kufiWords";

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

  it("an end the caller rejects never takes the cell from another end sharing it", () => {
    // two upright bars in one column with one paper cell between them: (1, 8)
    // is beyond the first bar's foot and beyond the second bar's top
    const cols = 4;
    const rows = 17;
    const placements: KufiPlacement[] = [
      { unitIndex: 0, key: "alef:isolated", glyphId: "alef.isolated.0", col: 1, row: 1, turn: 0, stretch: [0] },
      { unitIndex: 1, key: "alef:isolated", glyphId: "alef.isolated.0", col: 1, row: 9, turn: 0, stretch: [0] },
    ];
    const r: Ok = { ok: true, cols, rows, cells: new Uint8Array(cols * rows), placements, editsBreakPacking: false };
    for (const p of placements) for (const i of placementInk(r, p)) r.cells[i] = 1;
    expect(hitStretchEnd(r, 1, 8)).toMatchObject({ unitIndex: 0, dr: 1 });
    expect(hitStretchEnd(r, 1, 8, (e) => e.unitIndex !== 0)).toMatchObject({ unitIndex: 1, dr: -1 });
    expect(hitStretchEnd(r, 1, 8, () => false)).toBeNull();
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

describe("a slice with no free end", () => {
  /**
   * `beh.isolated.0` ("#...#" / "#...#" / "#####") at col 3, row 2, with ink
   * just beyond both ends of its baseline, as a joined neighbour would be: no
   * stroke end is free, so the slice's run (columns 1–3, the "..#" columns
   * the column stretch repeats) carries the handle instead.
   */
  function joined(): Ok {
    const cols = 12;
    const rows = 8;
    const placements: KufiPlacement[] = [
      { unitIndex: 0, key: "beh:isolated", glyphId: "beh.isolated.0", col: 3, row: 2, turn: 0, stretch: [0] },
    ];
    const r: Ok = { ok: true, cols, rows, cells: new Uint8Array(cols * rows), placements, editsBreakPacking: false };
    for (const i of placementInk(r, placements[0])) r.cells[i] = 1;
    r.cells[4 * cols + 2] = 1;
    r.cells[4 * cols + 8] = 1;
    return r;
  }

  it("gets a grip on each cell of the slice's run, pointing away from the letter's middle", () => {
    const r = joined();
    const grips = stretchEnds(r, 0);
    expect(grips.every((g) => g.kind === "slice" && g.stretchIndex === 0 && g.dr === 0)).toBe(true);
    expect(grips.map((g) => [g.col, g.row, g.dc])).toEqual(
      expect.arrayContaining([
        [4, 4, -1],
        [5, 4, 1],
        [6, 4, 1],
      ])
    );
    expect(grips).toHaveLength(3);
  });

  it("is hit on the run's cells only, never on the gap beside them", () => {
    const r = joined();
    expect(hitStretchEnd(r, 5, 4)).toMatchObject({ kind: "slice", unitIndex: 0, col: 5, row: 4 });
    expect(hitStretchEnd(r, 4, 4)).toMatchObject({ kind: "slice", dc: -1 });
    expect(hitStretchEnd(r, 5, 3)).toBeNull();
    expect(hitStretchEnd(r, 3, 4)).toBeNull();
    expect(hitStretchEnd(r, 2, 4)).toBeNull();
  });

  it("an end, when there is one, is a stroke end and not a grip", () => {
    const r = panel();
    expect(stretchEnds(r, 0).every((e) => e.kind === "end")).toBe(true);
  });
});

describe("placementOf", () => {
  it("looks a unit up by its index even when the placements are sparse", () => {
    const r = panel();
    const sparse: Ok = { ...r, placements: [r.placements[0], r.placements[2]] };
    expect(placementOf(sparse, 2)).toBe(r.placements[2]);
    expect(placementOf(sparse, 1)).toBeNull();
    expect(placementOf(r, 1)).toBe(r.placements[1]);
    // ends and outlines carry the right unit
    expect(stretchEnds(sparse, 2).every((e) => e.unitIndex === 2)).toBe(true);
    expect(stretchEnds(sparse, 2).length).toBeGreaterThan(0);
    expect(unitRings(sparse, 2)).toHaveLength(1);
    expect(hitKufiUnit(sparse, 8, 1)).toBe(2);
  });
});

/** The hand-laid panel's letters as two words: the lone alef, then the beh joined to the alef. */
const twoWords = (): KufiUnit[] =>
  [0, 1, 1].map((wordIndex, index) => ({ index, textOffset: index, key: "", skeleton: "alef", form: "isolated", joinsNext: false, wordIndex }));

describe("hitWordStart", () => {
  it("names the word whose first letter covers the cell, and nothing for a later letter, paper or a filler", () => {
    const r = panel();
    const units = twoWords();
    expect(hitWordStart(r, units, 1, 3)).toBe(0);
    // the beh opens the second word; the turned alef closes it
    expect(hitWordStart(r, units, 5, 6)).toBe(1);
    expect(hitWordStart(r, units, 8, 1)).toBeNull();
    expect(hitWordStart(r, units, 0, 0)).toBeNull();
    r.cells[9 * r.cols + 9] = 1;
    expect(hitWordStart(r, units, 9, 9)).toBeNull();
  });

  it("a unit the text does not have is no word start", () => {
    expect(hitWordStart(panel(), [], 1, 3)).toBeNull();
  });
});

describe("kufiReadingStep / routeOffsetFor", () => {
  it("reads right to left along the bottom, up the left, left to right along the top, down the right", () => {
    expect(kufiReadingStep(0)).toEqual([-1, 0]);
    expect(kufiReadingStep(1)).toEqual([0, -1]);
    expect(kufiReadingStep(2)).toEqual([1, 0]);
    expect(kufiReadingStep(3)).toEqual([0, 1]);
  });

  it("measures the pointer along the word's path from its first letter's leading edge, further on positive", () => {
    const r = panel();
    const units = twoWords();
    // word 0: the upright bar at col 1 reads right to left; its leading (right) edge is col 1
    expect(routeOffsetFor(r, units, 0, 1, 3)).toBe(0);
    expect(routeOffsetFor(r, units, 0, 0, 5)).toBe(1);
    expect(routeOffsetFor(r, units, 0, 3, 3)).toBe(-2);
    // the row does not count: the pointer is projected onto the path
    expect(routeOffsetFor(r, units, 0, 1, 11)).toBe(0);
    // word 1 opens with the beh (box cols 4–6, right to left): its leading edge is col 6
    expect(routeOffsetFor(r, units, 1, 6, 6)).toBe(0);
    expect(routeOffsetFor(r, units, 1, 4, 6)).toBe(2);
  });

  it("follows a turned first letter up its line", () => {
    const r = panel();
    // the quarter-turned alef (unit 2) alone as a word: box rows 1–2, reading upward, leading edge row 2
    const units = [0, 1, 2].map((wordIndex, index) => ({ ...twoWords()[0], index, wordIndex }));
    expect(routeOffsetFor(r, units, 2, 8, 2)).toBe(0);
    expect(routeOffsetFor(r, units, 2, 8, 0)).toBe(2);
    expect(routeOffsetFor(r, units, 2, 8, 5)).toBe(-3);
  });

  it("is 0 for a word the text does not have", () => {
    expect(routeOffsetFor(panel(), twoWords(), 7, 0, 0)).toBe(0);
  });
});

describe("nearestHandle", () => {
  it("picks the handle closest to a cell, and none from an empty list", () => {
    const r = panel();
    const ends = stretchEnds(r, 0);
    expect(nearestHandle(ends, 1, 2)).toMatchObject({ row: 1 });
    expect(nearestHandle(ends, 3, 6)).toMatchObject({ row: 7 });
    expect(nearestHandle([], 0, 0)).toBeNull();
  });

  it("ranks a word's route handle with the stretch ends; listed first, it takes a tie", () => {
    const r = panel();
    const units = twoWords();
    // the bar's free foot is both its lower stretch end and the word's leading cell
    const handles = [routeHandleOf(r, units, 0)!, ...stretchEnds(r, 0)];
    expect(nearestHandle(handles, 1, 7)).toMatchObject({ kind: "route" });
    expect(nearestHandle(handles, 1, 6)).toMatchObject({ kind: "route" });
    expect(nearestHandle(handles, 1, 1)).toMatchObject({ kind: "end", row: 1 });
  });
});

describe("handleCentre / nearestHandleAt", () => {
  it("draws an end on the edge its stroke grows across, a grip on its cell, a route handle on the word's leading edge", () => {
    expect(handleCentre({ kind: "end", unitIndex: 0, stretchIndex: 0, col: 1, row: 7, dc: 0, dr: 1 })).toEqual({ x: 1.5, y: 8 });
    expect(handleCentre({ kind: "slice", unitIndex: 0, stretchIndex: 0, col: 3, row: 4, dc: 1, dr: 0 })).toEqual({ x: 3.5, y: 4.5 });
    // reading right to left, the word begins on the right: its square sits on the cell's right edge
    expect(handleCentre({ kind: "route", unitIndex: 0, wordIndex: 0, col: 1, row: 7, dc: -1, dr: 0 })).toEqual({ x: 2, y: 7.5 });
  });

  it("two handles on one cell are told apart by where in the cell the pointer is", () => {
    const r = panel();
    const units = twoWords();
    const handles = [routeHandleOf(r, units, 0)!, ...stretchEnds(r, 0)];
    expect(stretchEnds(r, 0).some((e) => e.col === 1 && e.row === 7 && e.dr === 1)).toBe(true);
    expect(nearestHandleAt(handles, 1.9, 7.5)).toMatchObject({ kind: "route" });
    expect(nearestHandleAt(handles, 1.5, 7.95)).toMatchObject({ kind: "end", row: 7, dr: 1 });
    expect(nearestHandleAt(handles, 1.5, 1.2)).toMatchObject({ kind: "end", row: 1 });
    expect(nearestHandleAt([], 0, 0)).toBeNull();
  });
});

describe("routeHandleOf / hitRouteHandle", () => {
  it("sits on the first letter's leading cell, on the baseline side, with the word's reading step", () => {
    const r = panel();
    const units = twoWords();
    // word 0: the upright bar at col 1 reads right to left; its leading edge is col 1, its baseline the bottom
    expect(routeHandleOf(r, units, 0)).toEqual({ kind: "route", unitIndex: 0, wordIndex: 0, col: 1, row: 7, dc: -1, dr: 0 });
    // word 1 opens with the beh (box cols 4–6): its leading column is 6, inked only on the baseline row
    expect(routeHandleOf(r, units, 1)).toMatchObject({ unitIndex: 1, wordIndex: 1, col: 6, row: 7 });
    expect(routeHandleOf(r, units, 7)).toBeNull();
  });

  it("a turned first letter's handle is on its leading row", () => {
    const r = panel();
    // the quarter-turned alef (unit 2) alone as a word: reading upward, leading edge row 2, where only its foot is inked
    const units = [0, 1, 2].map((wordIndex, index) => ({ ...twoWords()[0], index, wordIndex }));
    expect(routeHandleOf(r, units, 2)).toMatchObject({ unitIndex: 2, col: 6, row: 2, dc: 0, dr: -1 });
  });

  it("is hit on its own cell or the paper cell just beyond it, and nowhere else on the letter", () => {
    const r = panel();
    const units = twoWords();
    expect(hitRouteHandle(r, units, 1, 7)).toMatchObject({ wordIndex: 0 });
    expect(hitRouteHandle(r, units, 2, 7)).toMatchObject({ wordIndex: 0 });
    expect(hitRouteHandle(r, units, 1, 3)).toBeNull();
    expect(hitRouteHandle(r, units, 6, 7)).toMatchObject({ wordIndex: 1 });
    expect(hitRouteHandle(r, units, 5, 7)).toBeNull();
    expect(hitRouteHandle(r, units, 0, 0)).toBeNull();
    // the cell beyond is another letter's ink: that letter keeps its press
    const touching: Ok = { ...r, cells: r.cells.slice() };
    touching.cells[7 * r.cols + 2] = 1;
    expect(hitRouteHandle(touching, units, 2, 7)).toMatchObject({ wordIndex: 0 });
    const withLetter: Ok = {
      ...r,
      placements: [...r.placements, { unitIndex: 3, key: "beh:medial", glyphId: "beh.medial.0", col: 2, row: 5, turn: 0, stretch: [] }],
    };
    expect(hitRouteHandle(withLetter, [...units, { ...units[2], index: 3, wordIndex: 2 }], 2, 7)).toBeNull();
  });
});

describe("the centre word's letters", () => {
  const TAWHID2 = "لا إله إلا الله لا إله إلا الله";
  const packed = () => {
    _internal.setClockOverride(Infinity);
    try {
      const r = packKufiPanel({ text: TAWHID2, cols: 21, rows: 17, centre: true });
      if (!r.ok) throw new Error("the fixture did not pack");
      return r;
    } finally {
      _internal.setClockOverride(null);
    }
  };

  it("are known from the result's centre; a result without one has none", () => {
    const r = packed();
    const from = r.centre!.unitFrom;
    expect(kufiIsCentreUnit(r, from)).toBe(true);
    expect(kufiIsCentreUnit(r, from - 1)).toBe(false);
    const plain = { ...r, centre: undefined };
    expect(kufiIsCentreUnit(plain, from)).toBe(false);
  });

  it("take no hit, no stretch end and no route handle, while the band letters keep theirs", () => {
    const r = packed();
    const from = r.centre!.unitFrom;
    const units = resolveKufiText(TAWHID2).units;
    for (const i of placementInk(r, r.placements[from])) expect(hitKufiUnit(r, i % r.cols, Math.floor(i / r.cols))).toBeNull();
    expect(stretchEnds(r, from)).toEqual([]);
    expect(routeHandleOf(r, units, units[from].wordIndex)).toBeNull();
    // a band letter's ink hits a band letter (its own, or at a shared join stub the one joined before it)
    for (const p of r.placements.slice(0, from))
      for (const i of placementInk(r, p)) {
        const hit = hitKufiUnit(r, i % r.cols, Math.floor(i / r.cols));
        expect(hit).not.toBeNull();
        expect(hit!).toBeLessThan(from);
      }
    expect(routeHandleOf(r, units, 0)).not.toBeNull();
    const plain = { ...r, centre: undefined };
    const i = placementInk(r, r.placements[from])[0];
    expect(hitKufiUnit(plain, i % r.cols, Math.floor(i / r.cols))).toBe(from);
  });
});
