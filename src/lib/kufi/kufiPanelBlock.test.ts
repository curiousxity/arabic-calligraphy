import { describe, expect, it } from "vitest";
import {
  kufiCellSize,
  kufiFormCycle,
  kufiFormEdits,
  kufiPanelInputs,
  kufiPanelTextPatch,
  kufiPinEdits,
  kufiStretchEdits,
} from "./kufiPanelBlock";
import type { KufiPackResult, KufiPlacement } from "./kufiPack";
import { resolveKufiText } from "./kufiWords";

describe("kufiPanelBlock", () => {
  it("a cell is an eighth of the font size", () => {
    expect(kufiCellSize(48)).toBe(6);
  });

  it("maps a block to the packer's inputs", () => {
    const edits = { routes: { 0: 1 } };
    expect(kufiPanelInputs({ text: "الله", panelCols: 9, panelRows: 10, panelEdits: edits })).toEqual({
      text: "الله",
      cols: 9,
      rows: 10,
      edits,
    });
  });

  it("a text change carries the edits to their letter's new index", () => {
    const before = "الله";
    const after = "و الله";
    const oldUnits = resolveKufiText(before).units;
    const last = oldUnits.length - 1;
    const panelEdits = { stretch: { [last]: [1] } };
    const patch = kufiPanelTextPatch({ text: before, panelEdits }, after);
    const newUnits = resolveKufiText(after).units;
    expect(patch.text).toBe(after);
    expect(patch.panelEdits?.stretch).toEqual({ [newUnits.length - 1]: [1] });
  });

  it("leaves a block with no edits alone", () => {
    expect(kufiPanelTextPatch({ text: "الله" }, "لله")).toEqual({ text: "لله" });
  });

  describe("planning an edit", () => {
    const pinA: KufiPlacement = { unitIndex: 0, key: "lamAlef:isolated", glyphId: "lamAlef.isolated.1", col: 18, row: 12, turn: 0, stretch: [0] };
    const pinC: KufiPlacement = { unitIndex: 3, key: "lam:medial", glyphId: "lam.medial.0", col: 5, row: 16, turn: 0, stretch: [-2] };
    const edits = { forms: { 3: "lam.medial.0" }, stretch: { 2: [1], 3: [-2] }, pinned: { 0: pinA, 3: pinC }, routes: { 1: 2 }, cells: [] };

    it("a stretch fixes the unit's counts and releases only its own pin", () => {
      const out = kufiStretchEdits(edits, 3, [1]);
      expect(out.stretch).toEqual({ 2: [1], 3: [1] });
      expect(out.pinned).toEqual({ 0: pinA });
      expect(out.forms).toEqual(edits.forms);
      expect(out.routes).toEqual(edits.routes);
      expect(kufiStretchEdits(undefined, 4, [0, 2])).toEqual({ stretch: { 4: [0, 2] } });
    });

    it("a form swap fixes the form and drops the unit's stretch and pin, which belonged to the old glyph", () => {
      const out = kufiFormEdits(edits, 3, "lam.medial.1");
      expect(out.forms).toEqual({ 3: "lam.medial.1" });
      expect(out.stretch).toEqual({ 2: [1] });
      expect(out.pinned).toEqual({ 0: pinA });
      expect(kufiFormEdits(undefined, 1, "yeh.initial.2")).toEqual({ forms: { 1: "yeh.initial.2" } });
    });

    it("a committed edit pins the unit where the packer put it", () => {
      const placed: KufiPlacement = { ...pinC, row: 15, stretch: [1] };
      const result: KufiPackResult = {
        ok: true, cols: 21, rows: 21, cells: new Uint8Array(441), editsBreakPacking: false,
        placements: [pinA, pinA, pinA, placed],
      };
      const out = kufiPinEdits(kufiStretchEdits(edits, 3, [1]), result, 3);
      expect(out.pinned).toEqual({ 0: pinA, 3: placed });
      expect(out.stretch).toEqual({ 2: [1], 3: [1] });
    });

    it("the form cycle runs through the other alternates from the current one, wrapping", () => {
      const text = "لا يكلف الله نفسا إلا وسعها";
      const cycle = kufiFormCycle(text, 3, "lam.medial.0");
      expect(cycle.length).toBeGreaterThan(0);
      expect(cycle).not.toContain("lam.medial.0");
      expect(cycle.every((id) => id.startsWith("lam.medial."))).toBe(true);
      // from the second form, the first comes last
      const fromNext = kufiFormCycle(text, 3, cycle[0]);
      expect(fromNext[fromNext.length - 1]).toBe("lam.medial.0");
      // a glyph the unit cannot take (a stale save) cycles from the start
      expect(kufiFormCycle(text, 3, "lam.medial.99")).toEqual(["lam.medial.0", ...cycle]);
    });

    it("a unit with a single form has nothing to cycle to", () => {
      const text = "لا يكلف الله نفسا إلا وسعها";
      // feh:medial has one glyph
      expect(kufiFormCycle(text, 7, "feh.medial.0")).toEqual([]);
      expect(kufiFormCycle(text, 99, "x")).toEqual([]);
    });
  });
});
