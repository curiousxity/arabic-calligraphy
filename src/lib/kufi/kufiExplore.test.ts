import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { _internal, packKufiPanel, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";
import {
  KUFI_MAX_ARRANGEMENTS,
  kufiLetterOptions,
  kufiStretchTry,
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
  it("finds the feh's fitting forms: one bar-free, two only with filler bars", () => {
    const current = draft();
    const form = (glyphId: string): KufiChange => ({ kind: "form", unitIndex: 4, glyphId });
    expect(tryKufiChange(inputs, current, form("feh.final.1")).result?.quality?.bars).toBe(0);
    // these leave a line's tail open, which filler bars close
    expect(tryKufiChange(inputs, current, form("feh.final.0")).result?.quality?.bars).toBeGreaterThan(0);
    expect(tryKufiChange(inputs, current, form("feh.final.2")).result?.quality?.bars).toBeGreaterThan(0);
  }, 30000);

  it("finds the kaf's fitting stretch", () => {
    const current = draft();
    let found: KufiTry | undefined;
    for (const c of kufiChangesOf(BAQARAH, current)) {
      if (c.kind !== "stretch" || c.unitIndex !== 2) continue;
      const t = tryKufiChange(inputs, current, c);
      if (t.result) {
        found = t;
        break;
      }
    }
    expect(found).toBeDefined();
    const c = found!.change;
    expect(c.kind).toBe("stretch");
    if (c.kind === "stretch") expect(found!.edits.pinned?.[2].stretch).toEqual(c.counts);
  }, 30000);

  it("keeps existing edits", () => {
    const current = draft();
    const first = tryKufiChange(inputs, current, { kind: "form", unitIndex: 4, glyphId: "feh.final.1" });
    expect(first.result).not.toBeNull();
    const held: KufiPanelEdits = first.edits;
    const held_inputs = { ...inputs, edits: held };
    const base = packKufiPanel(held_inputs);
    if (!base.ok) throw new Error("held edits did not pack");
    let found: KufiTry | undefined;
    for (const c of kufiChangesOf(BAQARAH, base)) {
      if (c.unitIndex === 4) continue;
      const t = tryKufiChange(held_inputs, base, c);
      if (t.result) {
        found = t;
        break;
      }
    }
    expect(found).toBeDefined();
    expect(found!.edits.forms?.[4]).toBe("feh.final.1");
  }, 30000);
});

describe("pickArrangements", () => {
  const mk = (cells: number[], squares: number, cut = 0, grow = 0): Ok => ({
    ok: true,
    cols: 3,
    rows: 3,
    cells: Uint8Array.from(cells),
    placements: [],
    editsBreakPacking: false,
    quality: { squares, bars: 0, cut, grow },
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

  it("ranks a try with no quality after one with quality", () => {
    const bare = mk([1, 0, 0, 0, 0, 0, 0, 0, 0], 0);
    delete bare.quality;
    const rated = mk([0, 1, 0, 0, 0, 0, 0, 0, 0], 5, 5, 5);
    expect(pickArrangements(current, [t(bare), t(rated)]).map((p) => p.result)).toEqual([rated, bare]);
  });

  it("ranks fewer bars ahead of less shortening", () => {
    const withBar = mk([1, 0, 0, 0, 0, 0, 0, 0, 0], 0, 0, 0);
    withBar.quality = { squares: 0, bars: 1, cut: 0, grow: 0 };
    const shortened = mk([0, 1, 0, 0, 0, 0, 0, 0, 0], 0, 3, 0);
    expect(pickArrangements(current, [t(withBar), t(shortened)]).map((p) => p.result)).toEqual([shortened, withBar]);
    expect(pickArrangements(current, [t(shortened), t(withBar)]).map((p) => p.result)).toEqual([shortened, withBar]);
  });

  it("chooses the second pick for distance from the first pick", () => {
    const first = mk([1, 1, 1, 0, 0, 0, 0, 0, 0], 0, 0);
    // near: 2 from current but only 1 from the first pick; far: 2 from current and 5 from the first
    const near = mk([1, 1, 0, 0, 0, 0, 0, 0, 0], 0, 1);
    const far = mk([0, 0, 0, 0, 0, 0, 1, 1, 0], 0, 1);
    const picks = pickArrangements(current, [t(first), t(near), t(far)]);
    expect(picks.map((p) => p.result)).toEqual([first, far, near]);
  });
});

describe("kufiLetterOptions", () => {
  it("marks the feh's fitting form and leaves untried ones unknown", () => {
    const current = draft();
    const unit = 4;
    const tries = kufiChangesOf(BAQARAH, current)
      .filter((c) => c.unitIndex === unit && c.kind === "form")
      .map((c) => tryKufiChange(inputs, current, c));
    const known = kufiLetterOptions(BAQARAH, current, { key: "k", tries, done: false, failed: false }, unit);
    const byId = new Map(known.forms.map((f) => [f.glyphId, f]));
    expect(known.forms).toHaveLength(4);
    expect(byId.get("feh.final.1")?.fits).toBe(true);
    expect(byId.get("feh.final.1")?.try?.result).not.toBeNull();
    // fits with filler bars (see tryKufiChange above)
    expect(byId.get("feh.final.0")?.fits).toBe(true);
    // the current glyph is listed, fitting, with no try
    expect(byId.get("feh.final.3")).toEqual({ glyphId: "feh.final.3", fits: true, try: null });
    // no stretch tried yet: not known, so no entry
    expect(known.stretch.size).toBe(0);

    const none = kufiLetterOptions(BAQARAH, current, null, unit);
    expect(none.forms.filter((f) => f.fits === null).map((f) => f.glyphId)).toEqual(["feh.final.0", "feh.final.1", "feh.final.2"]);
  }, 30000);

  it("lists a slice's fitting counts once every step of it is tried", () => {
    const current = draft();
    const unit = 2;
    const planned = kufiChangesOf(BAQARAH, current).filter((c) => c.unitIndex === unit && c.kind === "stretch");
    const si = planned[0].kind === "stretch" ? planned[0].stretchIndex : -1;
    const slice = planned.filter((c) => c.kind === "stretch" && c.stretchIndex === si);
    const tries = slice.map((c) => tryKufiChange(inputs, current, c));
    const partial = kufiLetterOptions(BAQARAH, current, { key: "k", tries: tries.slice(0, -1), done: false, failed: false }, unit);
    expect(partial.stretch.has(si)).toBe(false);
    const full = kufiLetterOptions(BAQARAH, current, { key: "k", tries, done: false, failed: false }, unit);
    const fitting = tries.filter((t) => t.result).map((t) => (t.change.kind === "stretch" ? t.change.counts[si] : NaN));
    expect(full.stretch.get(si)).toEqual(fitting);
    // the kaf's right end packs at +1 and +2 (see the e2e notes)
    expect(fitting).toEqual(expect.arrayContaining([1, 2]));
    expect(kufiStretchTry({ key: "k", tries, done: false, failed: false }, unit, si, 2)?.result).not.toBeNull();
  }, 60000);
});

describe("a centre word", () => {
  const TAWHID2 = "لا إله إلا الله لا إله إلا الله";
  it("gets no change to try, and its letter's options are its drawn form alone", () => {
    const r = packKufiPanel({ text: TAWHID2, cols: 21, rows: 17, centre: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const from = r.centre!.unitFrom;
    const changes = kufiChangesOf(TAWHID2, r);
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.some((c) => c.unitIndex >= from)).toBe(false);
    expect(kufiLetterOptions(TAWHID2, r, null, from)).toEqual({ forms: [{ glyphId: r.placements[from].glyphId, fits: true, try: null }], stretch: new Map() });
  });

  it("a band letter's forms are its spiral forms: the ح of محمد lists its five embracing lengths, the initial meem its one tall form", () => {
    const SHAHADA = "لا إله إلا الله محمد رسول الله";
    const r = packKufiPanel({ text: SHAHADA, cols: 24, rows: 19, centre: true, start: "topRight" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // units 7..10 are محمد: meem, ha, meem, dal
    expect(kufiLetterOptions(SHAHADA, r, null, 8).forms.map((f) => f.glyphId)).toEqual(["jeem.medial.2", "jeem.medial.3", "jeem.medial.4", "jeem.medial.5", "jeem.medial.6"]);
    expect(kufiLetterOptions(SHAHADA, r, null, 7).forms).toEqual([{ glyphId: "meem.initial.2", fits: true, try: null }]);
    const changes = kufiChangesOf(SHAHADA, r);
    expect(changes.filter((c) => c.kind === "form" && c.unitIndex === 7)).toEqual([]);
    expect(changes.filter((c) => c.kind === "form" && c.unitIndex === 8).length).toBe(4);
    // the dal keeps the panel's forms
    expect(changes.filter((c) => c.kind === "form" && c.unitIndex === 10).map((c) => (c as { glyphId: string }).glyphId)).toContain("dal.final.1");
  }, 30000);
});
