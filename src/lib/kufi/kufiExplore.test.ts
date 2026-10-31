import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _internal, packKufiPanel, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";
import {
  KUFI_MAX_ARRANGEMENTS,
  kufiChangesOf,
  pickArrangements,
  tryKufiChange,
  type KufiChange,
  type KufiTry,
} from "./kufiExplore";

beforeAll(() => _internal.setClockOverride(Infinity));
afterAll(() => _internal.setClockOverride(null));

type Ok = Extract<KufiPackResult, { ok: true }>;
const BAQARAH = "لا يكلف الله نفسا إلا وسعها";
const inputs = { text: BAQARAH, cols: 21, rows: 21 };

function draft(): Ok {
  const r = packKufiPanel(inputs);
  if (!r.ok) throw new Error("first draft did not pack");
  return r;
}

describe("kufiChangesOf", () => {
  it("lists forms before stretches", () => {
    const changes = kufiChangesOf(BAQARAH, draft());
    expect(changes[0].kind).toBe("form");
    const firstStretch = changes.findIndex((c) => c.kind === "stretch");
    expect(firstStretch).toBeGreaterThan(0);
    expect(changes.slice(firstStretch).every((c) => c.kind === "stretch")).toBe(true);
  });
});

describe("tryKufiChange", () => {
  it("finds the feh's fitting form", () => {
    const current = draft();
    const form = (glyphId: string): KufiChange => ({ kind: "form", unitIndex: 4, glyphId });
    expect(tryKufiChange(inputs, current, form("feh.final.1")).result).not.toBeNull();
    expect(tryKufiChange(inputs, current, form("feh.final.0")).result).toBeNull();
    expect(tryKufiChange(inputs, current, form("feh.final.2")).result).toBeNull();
  }, 30000);

  it("finds the kaf's fitting stretch", () => {
    const current = draft();
    const tries = kufiChangesOf(BAQARAH, current)
      .filter((c) => c.kind === "stretch" && c.unitIndex === 2)
      .map((c) => tryKufiChange(inputs, current, c));
    const packed = tries.filter((t) => t.result);
    expect(packed.length).toBeGreaterThan(0);
    for (const t of packed) {
      const c = t.change;
      if (c.kind === "stretch") expect(t.edits.pinned?.[2].stretch).toEqual(c.counts);
    }
  }, 60000);

  it("keeps existing edits", () => {
    const current = draft();
    const first = tryKufiChange(inputs, current, { kind: "form", unitIndex: 4, glyphId: "feh.final.1" });
    expect(first.result).not.toBeNull();
    const held: KufiPanelEdits = first.edits;
    const held_inputs = { ...inputs, edits: held };
    const base = packKufiPanel(held_inputs);
    if (!base.ok) throw new Error("held edits did not pack");
    const other = kufiChangesOf(BAQARAH, base).filter((c) => c.unitIndex !== 4);
    const t = other.map((c) => tryKufiChange(held_inputs, base, c)).find((x) => x.result);
    expect(t).toBeDefined();
    expect(t!.edits.forms?.[4]).toBe("feh.final.1");
  }, 120000);
});

describe("pickArrangements", () => {
  const mk = (cells: number[], squares: number, cut = 0, grow = 0): Ok => ({
    ok: true,
    cols: 3,
    rows: 3,
    cells: Uint8Array.from(cells),
    placements: [],
    editsBreakPacking: false,
    quality: { squares, cut, grow },
  });
  const change: KufiChange = { kind: "form", unitIndex: 0, glyphId: "x" };
  const t = (result: Ok | null): KufiTry => ({ change, edits: {}, result });
  const current = mk([0, 0, 0, 0, 0, 0, 0, 0, 0], 0);

  it("picks distinct arrangements best first", () => {
    const a = mk([1, 0, 0, 0, 0, 0, 0, 0, 0], 1);
    const b = mk([0, 1, 0, 0, 0, 0, 0, 0, 0], 0, 2);
    const dup = mk([0, 1, 0, 0, 0, 0, 0, 0, 0], 0, 1);
    const c = mk([0, 0, 1, 1, 1, 0, 0, 0, 0], 0, 1);
    const same = mk([0, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    const picks = pickArrangements(current, [t(a), t(null), t(same), t(b), t(dup), t(c)]);
    // dup and c tie on quality; c is the further from the current panel, so it goes first
    expect(picks.map((p) => p.result)).toEqual([c, dup, a]);
    expect(picks[0].changedCells).toBe(3);
    expect(picks[1].changedCells).toBe(1);
    expect(pickArrangements(current, [t(a), t(b), t(c)], 2)).toHaveLength(2);
    expect(KUFI_MAX_ARRANGEMENTS).toBe(6);
  });
});
