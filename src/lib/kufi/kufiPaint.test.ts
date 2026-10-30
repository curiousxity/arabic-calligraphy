import { describe, expect, it } from "vitest";
import { placementInk } from "./kufiHit";
import { cellEditAt, nearestKufiUnit, paintKufiCell } from "./kufiPaint";
import type { KufiPackResult, KufiPanelEdits, KufiPlacement } from "./kufiPack";

type Ok = Extract<KufiPackResult, { ok: true }>;

/**
 * The hand-laid panel of `kufiHit.test.ts`: an upright alef bar at col 1 rows
 * 1–7, a beh at col 4 rows 5–7 (".#." ".#." "###"), a quarter-turned alef
 * along row 1 cols 6–10 with its foot at (row 2, col 6). 12 × 12.
 */
function panel(cells?: Array<[col: number, row: number]>, edits?: KufiPanelEdits): Ok {
  const cols = 12;
  const rows = 12;
  const placements: KufiPlacement[] = [
    { unitIndex: 0, key: "alef:isolated", glyphId: "alef.isolated.0", col: 1, row: 1, turn: 0, stretch: [0] },
    { unitIndex: 1, key: "beh:medial", glyphId: "beh.medial.0", col: 4, row: 5, turn: 0, stretch: [] },
    { unitIndex: 2, key: "alef:final", glyphId: "alef.final.1", col: 6, row: 1, turn: 1, stretch: [0] },
  ];
  const r: Ok = { ok: true, cols, rows, cells: new Uint8Array(cols * rows), placements, editsBreakPacking: false };
  for (const p of placements) for (const i of placementInk(r, p)) r.cells[i] = 1;
  for (const [c, row] of cells ?? []) r.cells[row * cols + c] = 1;
  if (edits?.cells) for (const e of edits.cells) r.cells[(placements[e.unitIndex].row + e.dy) * cols + placements[e.unitIndex].col + e.dx] = e.on ? 1 : 0;
  return r;
}

const at = (r: Ok, col: number, row: number) => r.cells[row * r.cols + col];

describe("nearestKufiUnit", () => {
  it("picks the unit whose placed box is nearest the cell, the letter itself when on it", () => {
    const r = panel();
    expect(nearestKufiUnit(r, 1, 3)).toBe(0);
    expect(nearestKufiUnit(r, 5, 6)).toBe(1);
    // paper beside the bar
    expect(nearestKufiUnit(r, 2, 10)).toBe(0);
    // paper under the turned alef's stem, nearer to it than to the beh
    expect(nearestKufiUnit(r, 9, 3)).toBe(2);
    // below the bar and the beh, two cells from each box: the lower unit index
    expect(nearestKufiUnit(r, 2, 9)).toBe(0);
  });

  it("is null for a panel with no letters", () => {
    expect(nearestKufiUnit({ ...panel(), placements: [] }, 0, 0)).toBeNull();
  });
});

describe("cellEditAt", () => {
  it("finds the edit that paints a cell through its unit's box, or -1", () => {
    const edits: KufiPanelEdits = { cells: [{ unitIndex: 1, key: "beh:medial", dx: -2, dy: 1, on: true }, { unitIndex: 0, key: "alef:isolated", dx: 0, dy: 0, on: false }] };
    const r = panel(undefined, edits);
    expect(cellEditAt(r, edits, 2, 6)).toBe(0);
    expect(cellEditAt(r, edits, 1, 1)).toBe(1);
    expect(cellEditAt(r, edits, 1, 2)).toBe(-1);
    expect(cellEditAt(r, undefined, 2, 6)).toBe(-1);
    // an edit whose unit has changed letter does not land anywhere
    expect(cellEditAt(r, { cells: [{ unitIndex: 1, key: "seen:medial", dx: -2, dy: 1, on: true }] }, 2, 6)).toBe(-1);
  });
});

describe("paintKufiCell", () => {
  it("toggling paper paints it, as an offset from the nearest letter's box, and the drawn panel shows it", () => {
    const r = panel();
    const out = paintKufiCell(r, undefined, 2, 10);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.edits.cells).toEqual([{ unitIndex: 0, key: "alef:isolated", dx: 1, dy: 9, on: true }]);
    expect(at(out.result, 2, 10)).toBe(1);
    expect(at(r, 2, 10)).toBe(0);
    expect(out.result.placements).toBe(r.placements);
    // the hand-laid panel is full of 2×2s of paper, so with an edit on it the packer's rule reports a break
    expect(out.result.editsBreakPacking).toBe(true);
  });

  it("toggling a painted cell again removes its edit rather than stacking an erase on it", () => {
    const edits: KufiPanelEdits = { cells: [{ unitIndex: 0, key: "alef:isolated", dx: 1, dy: 9, on: true }], stretch: { 0: [1] } };
    const r = panel(undefined, edits);
    const out = paintKufiCell(r, edits, 2, 10);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.edits.cells).toBeUndefined();
    expect(out.edits.stretch).toEqual({ 0: [1] });
    expect(at(out.result, 2, 10)).toBe(0);
    // no edit left, nothing to report
    expect(out.result.editsBreakPacking).toBe(false);
  });

  it("toggling a letter's ink erases it", () => {
    const r = panel();
    const out = paintKufiCell(r, undefined, 1, 4);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.edits.cells).toEqual([{ unitIndex: 0, key: "alef:isolated", dx: 0, dy: 3, on: false }]);
    expect(at(out.result, 1, 4)).toBe(0);
  });

  describe("whether the painted cells leave a gap (the packer's rule)", () => {
    /** A 5×5 checkerboard: no 2×2 of paper or ink, no two paper cells side by side on the frame. One letter, for the edits to hang on. */
    function packed(): Ok {
      const rows = ["#.#.#", ".#.#.", "#.#.#", ".#.#.", "#.#.#"];
      const cells = Uint8Array.from(rows.flatMap((r) => Array.from(r, (c) => (c === "#" ? 1 : 0))));
      const placements: KufiPlacement[] = [{ unitIndex: 0, key: "alef:isolated", glyphId: "alef.isolated.0", col: 0, row: 0, turn: 0, stretch: [0] }];
      return { ok: true, cols: 5, rows: 5, cells, placements, editsBreakPacking: false };
    }

    it("a painted cell that closes no 2×2 is sound", () => {
      const out = paintKufiCell(packed(), undefined, 1, 0);
      expect(out.kind).toBe("ok");
      if (out.kind === "ok") expect(out.result.editsBreakPacking).toBe(false);
    });

    it("an erased cell that opens a 2×2 of paper, or a double break in the frame, is a gap", () => {
      const corner = paintKufiCell(packed(), undefined, 0, 0);
      expect(corner.kind).toBe("ok");
      if (corner.kind === "ok") expect(corner.result.editsBreakPacking).toBe(true);
      const r = packed();
      r.cells[1 * 5 + 1] = 0; // (1, 1) off: the window at (1..2, 1..2) now has one ink cell, (2, 2)
      const hole = paintKufiCell(r, undefined, 2, 2);
      expect(hole.kind).toBe("ok");
      if (hole.kind === "ok") expect(hole.result.editsBreakPacking).toBe(true);
    });
  });

  it("refuses a cell that would make a 2×2 of ink", () => {
    // the beh's baseline "###" at row 7 cols 4–6 with its tooth at (5, 5) and (5, 6): (4, 6) would close a 2×2
    const r = panel();
    expect(at(r, 5, 6)).toBe(1);
    expect(at(r, 4, 7)).toBe(1);
    expect(at(r, 5, 7)).toBe(1);
    expect(paintKufiCell(r, undefined, 4, 6)).toEqual({ kind: "refused" });
    // erasing is never refused
    expect(paintKufiCell(r, undefined, 5, 6).kind).toBe("ok");
  });

  it("painting to a given state skips a cell already in it, so a drag paints or erases as its first cell decided", () => {
    const r = panel();
    expect(paintKufiCell(r, undefined, 1, 4, true)).toEqual({ kind: "same" });
    expect(paintKufiCell(r, undefined, 2, 10, false)).toEqual({ kind: "same" });
    const on = paintKufiCell(r, undefined, 2, 10, true);
    expect(on.kind).toBe("ok");
    if (on.kind !== "ok") return;
    // the next cell of the drag is painted on top of the first's edits
    const next = paintKufiCell(on.result, on.edits, 2, 11, true);
    expect(next.kind).toBe("ok");
    if (next.kind !== "ok") return;
    expect(next.edits.cells).toHaveLength(2);
    expect(at(next.result, 2, 10)).toBe(1);
    expect(at(next.result, 2, 11)).toBe(1);
  });

  it("an edit already at the cell is replaced, never doubled", () => {
    const edits: KufiPanelEdits = { cells: [{ unitIndex: 0, key: "alef:isolated", dx: 0, dy: 3, on: false }] };
    const r = panel(undefined, edits);
    const out = paintKufiCell(r, edits, 1, 4, true);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.edits.cells).toEqual([{ unitIndex: 0, key: "alef:isolated", dx: 0, dy: 3, on: true }]);
  });

  it("a cell off the panel is nothing", () => {
    expect(paintKufiCell(panel(), undefined, -1, 0)).toEqual({ kind: "same" });
    expect(paintKufiCell(panel(), undefined, 0, 12)).toEqual({ kind: "same" });
  });
});
