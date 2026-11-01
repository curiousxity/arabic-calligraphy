import { describe, expect, it } from "vitest";
import {
  kufiCellSize,
  kufiFormCycle,
  kufiFormEdits,
  kufiPanelInputs,
  kufiPanelTextPatch,
  kufiPinEdits,
  kufiPinWordEdits,
  kufiReleasePins,
  kufiRouteEdits,
  kufiStretchEdits,
} from "./kufiPanelBlock";
import type { KufiPackResult, KufiPlacement } from "./kufiPack";
import { resolveKufiText } from "./kufiWords";

type Ok = Extract<KufiPackResult, { ok: true }>;

describe("kufiPanelBlock", () => {
  it("a cell is an eighth of the font size: 14 px at a new panel's 112", () => {
    expect(kufiCellSize(48)).toBe(6);
    expect(kufiCellSize(112)).toBe(14);
  });

  describe("releasing pins", () => {
    const pin: KufiPlacement = { unitIndex: 2, key: "kaf:medial", glyphId: "kaf.medial.0", col: 3, row: 4, turn: 0, stretch: [1] };

    it("drops every pin and the routes that stood on them, keeping forms, stretch and painted cells", () => {
      const cells = [{ unitIndex: 2, key: "kaf:medial", dx: 1, dy: 1, on: true }];
      const out = kufiReleasePins({ pinned: { 2: pin }, routes: { 1: 2 }, forms: { 4: "feh.final.1" }, stretch: { 2: [1] }, cells });
      expect(out).toEqual({ forms: { 4: "feh.final.1" }, stretch: { 2: [1] }, cells });
    });

    it("is undefined when nothing but pins was there, and leaves edits with no pins as they are", () => {
      expect(kufiReleasePins({ pinned: { 2: pin } })).toBeUndefined();
      expect(kufiReleasePins({ pinned: { 2: pin }, routes: { 0: 1 } })).toBeUndefined();
      const edits = { forms: { 4: "feh.final.1" } };
      expect(kufiReleasePins(edits)).toBe(edits);
      expect(kufiReleasePins(undefined)).toBeUndefined();
    });
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

    it("pins by unit index, not by position in the placements list", () => {
      const placed: KufiPlacement = { ...pinC, row: 15, stretch: [1] };
      const result: KufiPackResult = {
        ok: true, cols: 21, rows: 21, cells: new Uint8Array(441), editsBreakPacking: false,
        placements: [pinA, placed],
      };
      expect(kufiPinEdits({}, result, 3).pinned).toEqual({ 3: placed });
      expect(kufiPinEdits({}, result, 1)).toEqual({});
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

  describe("re-routing a word", () => {
    // لا يكلف: word 1 is units 1–4 on the bottom line (reading right to left)
    const text = "لا يكلف";
    const units = resolveKufiText(text).units;
    const place = (unitIndex: number, col: number, row: number, turn: 0 | 1 | 2 | 3 = 0): KufiPlacement => ({
      unitIndex, key: units[unitIndex].key, glyphId: `${units[unitIndex].skeleton}.${units[unitIndex].form}.0`, col, row, turn, stretch: [0],
    });
    const placements = [place(0, 18, 12), place(1, 12, 16), place(2, 7, 16), place(3, 5, 16), place(4, 0, 16)];
    const committed: Ok = { ok: true, cols: 21, rows: 21, cells: new Uint8Array(441), placements, editsBreakPacking: false };

    it("records the route and pins the word's first letter that far along its path, releasing the word's other pins", () => {
      const edits = { pinned: { 0: placements[0], 2: placements[2], 3: placements[3] }, stretch: { 2: [1] } };
      const out = kufiRouteEdits(edits, committed, units, 1, 2);
      expect(out).not.toBeNull();
      expect(out!.routes).toEqual({ 1: 2 });
      // two cells further on (right to left) from where it stands
      expect(out!.pinned).toEqual({ 0: placements[0], 1: { ...placements[1], col: 10 } });
      // other edits stay
      expect(out!.stretch).toEqual({ 2: [1] });
    });

    it("moves from the committed route, not from zero, and a route back at zero drops its entry", () => {
      // the word already stands two cells on, pinned there by the last drag
      const edits = { routes: { 1: 2, 3: 1 }, pinned: { 1: { ...placements[1], col: 10 } } };
      const routed: Ok = { ...committed, placements: placements.map((p, i) => (i === 1 ? { ...p, col: 10 } : p)) };
      const out = kufiRouteEdits(edits, routed, units, 1, 3);
      expect(out!.routes).toEqual({ 1: 3, 3: 1 });
      expect(out!.pinned?.[1]).toEqual({ ...placements[1], col: 9 });
      const back = kufiRouteEdits(edits, routed, units, 1, 0);
      expect(back!.routes).toEqual({ 3: 1 });
      expect(back!.pinned?.[1]).toEqual({ ...placements[1], col: 12 });
      // a route map emptied is dropped altogether
      expect(kufiRouteEdits({ routes: { 1: 2 } }, routed, units, 1, 0)!.routes).toBeUndefined();
    });

    it("follows the first letter's own line: a turned letter moves along rows", () => {
      const turned: Ok = { ...committed, placements: placements.map((p, i) => (i === 1 ? { ...p, turn: 1, col: 0, row: 8 } : p)) };
      const out = kufiRouteEdits(undefined, turned, units, 1, 2);
      expect(out!.pinned?.[1]).toEqual({ ...turned.placements[1], row: 6 });
    });

    it("refuses a route that would take any of the letter's box off the panel, or a word the text does not have", () => {
      expect(kufiRouteEdits(undefined, committed, units, 1, 13)).toBeNull();
      // yeh.initial.0 is 2 wide at col 12: 7 cells back puts its right edge on col 20, 8 puts it past
      expect(kufiRouteEdits(undefined, committed, units, 1, -7)).not.toBeNull();
      expect(kufiRouteEdits(undefined, committed, units, 1, -8)).toBeNull();
      expect(kufiRouteEdits(undefined, committed, units, 7, 1)).toBeNull();
      // a turned letter past the bottom edge: yeh.initial.0 turned once is 2 tall at row 8, going down 11 is off
      const turned: Ok = { ...committed, placements: placements.map((p, i) => (i === 1 ? { ...p, turn: 3, col: 0, row: 8 } : p)) };
      expect(kufiRouteEdits(undefined, turned, units, 1, 11)).not.toBeNull();
      expect(kufiRouteEdits(undefined, turned, units, 1, 12)).toBeNull();
    });

    it("a committed re-route pins every letter of the word where the packer put it", () => {
      const result: Ok = { ...committed, placements: placements.map((p, i) => (i >= 1 && i <= 4 ? { ...p, col: p.col - 2 } : p)) };
      const out = kufiPinWordEdits({ routes: { 1: 2 }, pinned: { 0: placements[0] } }, committed, result, units, 1);
      expect(out.pinned).toEqual({ 0: placements[0], 1: result.placements[1], 2: result.placements[2], 3: result.placements[3], 4: result.placements[4] });
      expect(out.routes).toEqual({ 1: 2 });
    });

    it("a committed re-route also pins every other letter the move changed, and only those", () => {
      // the word moved, and the move rearranged the لا before it: another glyph, place and stretch
      const lam = { ...placements[0], glyphId: "lamAlef.isolated.1", col: 17, stretch: [1] };
      const result: Ok = { ...committed, placements: placements.map((p, i) => (i === 0 ? lam : i >= 1 ? { ...p, col: p.col - 2 } : p)) };
      expect(kufiPinWordEdits({}, committed, result, units, 1).pinned).toEqual(Object.fromEntries(result.placements.map((p, i) => [i, p])));
      // a letter whose turn alone changed counts as moved; one that did not change is left unpinned
      const turned: Ok = { ...committed, placements: placements.map((p, i) => (i === 0 ? { ...p, turn: 2 as const } : p)) };
      expect(Object.keys(kufiPinWordEdits({}, committed, turned, units, 1).pinned!).map(Number)).toEqual([0, 1, 2, 3, 4]);
      const still = kufiPinWordEdits({}, committed, committed, units, 1);
      expect(Object.keys(still.pinned!).map(Number)).toEqual([1, 2, 3, 4]);
    });
  });
});
