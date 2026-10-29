import { describe, expect, it } from "vitest";
import { kufiCellSize, kufiPanelInputs, kufiPanelTextPatch } from "./kufiPanelBlock";
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
});
