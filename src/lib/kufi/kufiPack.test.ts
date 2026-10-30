import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KUFI_FORMS, dotCells, dotsOf, stretchGlyph, stretchedBase, type KufiGlyph } from "./kufiAlphabet";
import { emptyBlocks2x2, inkBlocks2x2, rotateRows, type Turn } from "./kufiGrid";
import { resolveKufiText, type KufiUnit } from "./kufiWords";
import {
  fitKufiPanel,
  kufiFormsOf,
  packKufiPanel,
  reconcileEdits,
  _internal,
  type KufiPackResult,
  type KufiPlacement,
} from "./kufiPack";

// Layouts are asserted on the work budget alone, so machine load cannot change them; the
// budget tests put the product's clock back for their own run.
beforeAll(() => _internal.setClockOverride(Infinity));
afterAll(() => _internal.setClockOverride(null));

const BAQARAH = "لا يكلف الله نفسا إلا وسعها";
const ALLAH = "الله";
const SHAHADA = "لا إله إلا الله محمد رسول الله";

type Ok = Extract<KufiPackResult, { ok: true }>;

function glyphOf(id: string): KufiGlyph {
  const [sk, form] = id.split(".");
  const g = (KUFI_FORMS as Record<string, Record<string, KufiGlyph[]>>)[sk]?.[form]?.find((x) => x.id === id);
  if (!g) throw new Error(`no glyph ${id}`);
  return g;
}

/** The panel cell of (i, j) in a box of h x w turned `turn`, top-left at (row, col): the same turn as `rotateRows`. */
function boxCell(turn: Turn, h: number, w: number, row: number, col: number, i: number, j: number): [number, number] {
  if (turn === 0) return [row + i, col + j];
  if (turn === 1) return [row + j, col + h - 1 - i];
  if (turn === 2) return [row + h - 1 - i, col + w - 1 - j];
  return [row + w - 1 - j, col + i];
}

/** A placement's glyph ink, as row-major indices, from the letter table alone. */
function glyphInk(r: Ok, p: KufiPlacement): number[] {
  const rows = rotateRows(stretchGlyph(glyphOf(p.glyphId), p.stretch), p.turn);
  const out: number[] = [];
  rows.forEach((line, i) => [...line].forEach((ch, j) => ch === "#" && out.push((p.row + i) * r.cols + p.col + j)));
  return out;
}

const grid = (r: Ok) => ({ cols: r.cols, rows: r.rows, cells: r.cells });

/** Each placement's line, by turn and baseline; a letter joined on in the same turn stays on its run's line. */
function lineKeys(r: Ok, units: KufiUnit[]): string[] {
  const keys: string[] = [];
  r.placements.forEach((p, k) => {
    if (k > 0 && units[k - 1].joinsNext && r.placements[k - 1].turn === p.turn) {
      keys.push(keys[k - 1]);
      return;
    }
    const g = glyphOf(p.glyphId);
    const rows = stretchGlyph(g, p.stretch);
    const baseRow = rows.length - 1 - stretchedBase(g, p.stretch);
    const h = rows.length;
    const base = p.turn === 0 ? p.row + baseRow : p.turn === 2 ? p.row + h - 1 - baseRow : p.turn === 1 ? p.col + h - 1 - baseRow : p.col + baseRow;
    keys.push(`${p.turn}:${base}`);
  });
  return keys;
}

/** How far along its line, in reading order, a placement's far end is. */
function along(p: KufiPlacement): number {
  const g = glyphOf(p.glyphId);
  const rows = rotateRows(stretchGlyph(g, p.stretch), p.turn);
  const h = rows.length;
  const w = rows[0].length;
  if (p.turn === 0) return -p.col; // right to left
  if (p.turn === 2) return p.col + w - 1; // upside down: left to right
  if (p.turn === 1) return -p.row; // upwards
  return p.row + h - 1; // downwards
}

/** Placements in unit order walk the structure forwards: a line is never returned to, and on a line each goes further. */
function expectReadingOrder(r: Ok, units: KufiUnit[]) {
  expect(r.placements.map((p) => p.unitIndex)).toEqual(units.map((u) => u.index));
  expect(r.placements.map((p) => p.key)).toEqual(units.map((u) => u.key));
  const keys = lineKeys(r, units);
  const left = new Set<string>();
  for (let k = 1; k < keys.length; k++) {
    if (keys[k] === keys[k - 1]) {
      expect(along(r.placements[k]), `unit ${k} goes on along its line`).toBeGreaterThan(along(r.placements[k - 1]));
      continue;
    }
    left.add(keys[k - 1]);
    expect(left.has(keys[k]), `unit ${k} does not return to an earlier line`).toBe(false);
  }
}

/**
 * Every lone ink cell outside the glyphs is either one of a placed letter's
 * own dots, in a whole set on its side (where authored, or the set moved one
 * cell along its line), or a lone square that could not be read as a dot.
 */
function expectDotsAreLetters(r: Ok, text: string, units: KufiUnit[]): number[] {
  const { cols, rows, cells } = r;
  const ink = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < rows && cc < cols && cells[rr * cols + cc] === 1;
  const glyph = new Uint8Array(cols * rows);
  for (const p of r.placements) for (const i of glyphInk(r, p)) glyph[i] = 1;
  const lone = new Set<number>();
  for (let i = 0; i < cols * rows; i++) {
    const rr = (i / cols) | 0;
    const cc = i % cols;
    if (cells[i] && !glyph[i] && !ink(rr - 1, cc) && !ink(rr + 1, cc) && !ink(rr, cc - 1) && !ink(rr, cc + 1)) lone.add(i);
  }
  const dotOf = new Set<number>();
  const zone = new Set<number>();
  for (const p of r.placements) {
    const u = units[p.unitIndex];
    const g = glyphOf(p.glyphId);
    const h = stretchGlyph(g, p.stretch).length;
    const w = stretchGlyph(g, p.stretch)[0].length;
    const ch = text[u.textOffset];
    const at = (c: { row: number; col: number }, shift: number) => {
      const [rr, cc] = boxCell(p.turn, h, w, p.row, p.col, c.row, c.col + shift);
      return rr * cols + cc;
    };
    // the cells where a lone square could pass for a dot: every one- or two-dot set the glyph has
    for (const [key, set] of Object.entries(g.dots ?? {})) {
      if (key.endsWith("3") || !set) continue;
      const repr: Record<string, string> = { above1: "ن", above2: "ت", below1: "ب", below2: "ي" };
      for (const c of dotCells(g, repr[key], "initial", p.stretch))
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) zone.add(at({ row: c.row + dr, col: c.col + dc }, 0));
    }
    const d = u.skeleton === "allah" || u.skeleton === "lamAlef" ? null : dotsOf(ch, u.form);
    if (!d) continue;
    const own = dotCells(g, ch, u.form, p.stretch);
    expect(own).toHaveLength(d.count);
    const drawn = [0, -1, 1].filter((shift) => own.every((c) => lone.has(at(c, shift))));
    expect(drawn.length, `${ch} (unit ${p.unitIndex}) has at most one whole set`).toBeLessThanOrEqual(1);
    if (drawn.length) for (const c of own) dotOf.add(at(c, drawn[0]));
  }
  const fillers: number[] = [];
  for (const i of lone) {
    if (dotOf.has(i)) continue;
    expect(zone.has(i), `the lone square at r${(i / cols) | 0}c${i % cols} would read as a dot`).toBe(false);
    fillers.push(i);
  }
  // two filler squares near each other read as a pair of dots
  for (const a of fillers)
    for (const b of fillers) {
      if (a === b) continue;
      const d = Math.max(Math.abs(((a / cols) | 0) - ((b / cols) | 0)), Math.abs((a % cols) - (b % cols)));
      expect(d, `filler squares r${(a / cols) | 0}c${a % cols} and r${(b / cols) | 0}c${b % cols}`).toBeGreaterThan(2);
    }
  return fillers;
}

/** The filler squares of a packed panel: lone ink that is no glyph and no letter's dot. */
function fillersOf(r: Ok, text: string): number[] {
  return expectDotsAreLetters(r, text, resolveKufiText(text).units);
}

function expectPacked(r: KufiPackResult, text: string): Ok {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("not packed");
  expect(inkBlocks2x2(grid(r))).toEqual([]);
  expect(emptyBlocks2x2(grid(r))).toEqual([]);
  const { units } = resolveKufiText(text);
  expectReadingOrder(r, units);
  expectDotsAreLetters(r, text, units);
  return r;
}

describe("packKufiPanel", () => {
  it("packs Al-Baqarah at 21x21", () => {
    expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
  }, 20000);

  it("packs «الله» at 9x9", () => {
    expectPacked(packKufiPanel({ text: ALLAH, cols: 9, rows: 9 }), ALLAH);
  });

  it("every placement is its glyph, turned and stretched, inked where it says", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    for (const p of r.placements) for (const i of glyphInk(r, p)) expect(r.cells[i]).toBe(1);
  }, 20000);

  it("never reports a panel with holes as ok", () => {
    const tries: Array<[string, number]> = [
      [ALLAH, 10],
      [ALLAH, 11],
      [BAQARAH, 20],
      [BAQARAH, 22],
    ];
    for (const [text, n] of tries) {
      const r = packKufiPanel({ text, cols: n, rows: n });
      if (!r.ok) {
        expect(["tooShort", "tooLong"]).toContain(r.reason);
        continue;
      }
      expectPacked(r, text);
    }
  }, 60000);

  it("the Shahada: the fitted size packs, or the packer says no", () => {
    const size = fitKufiPanel(SHAHADA);
    const r = packKufiPanel({ text: SHAHADA, ...size });
    if (r.ok) expectPacked(r, SHAHADA);
    else {
      expect(["tooShort", "tooLong"]).toContain(r.reason);
      for (const s of r.suggestions) expectPacked(packKufiPanel({ text: SHAHADA, ...s }), SHAHADA);
    }
  }, 60000);

  it("empty and single-letter text return tooShort", () => {
    for (const text of ["", "ب"]) {
      const r = packKufiPanel({ text, cols: 9, rows: 9 });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("tooShort");
    }
  });

  it("a box too small gives tooLong with sizes that pack", () => {
    const r = packKufiPanel({ text: BAQARAH, cols: 10, rows: 10 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("tooLong");
    expect(r.suggestions.length).toBeGreaterThanOrEqual(1);
    for (const s of r.suggestions) expectPacked(packKufiPanel({ text: BAQARAH, ...s }), BAQARAH);
  }, 20000);
});

// Timing: the work budget decides results, so these tests assert the work each call did, plus a
// wall-clock bound three times the target: loose enough that the parallel suite cannot flake it.
// The targets themselves (2000 ms, 200 ms) are what a call takes alone; the code also stops on the
// clock, at FIRST_DRAFT_CLOCK_MS for a first draft and at the repack budget for a repack.
describe("budgets", () => {
  beforeEach(() => _internal.setClockOverride(null));
  afterEach(() => _internal.setClockOverride(Infinity));

  it("a first draft and a repack with previous stay within their work and clock budgets", () => {
    _internal.clearCaches();
    _internal.stats.work = 0;
    let t = performance.now();
    const r = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 });
    expect(performance.now() - t).toBeLessThan(3 * 2000);
    expect(_internal.stats.work).toBeLessThanOrEqual(_internal.PACK_WORK);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    _internal.stats.work = 0;
    t = performance.now();
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { 2: [1] } } });
    expect(performance.now() - t).toBeLessThan(3 * 200);
    expect(_internal.stats.work).toBeLessThanOrEqual(_internal.REPACK_WORK);
    expect(again.ok).toBe(true);
  }, 20000);

  it("a fresh pack with a genuinely conflicting pin ends within its bound (2 x CALL_BUDGET_MS, 3x for load)", () => {
    const r = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.placements[1];
    const b = { ...r.placements[2], col: a.col, row: a.row, turn: a.turn };
    _internal.clearCaches();
    const t = performance.now();
    const out = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { 1: a, 2: b } } });
    expect(performance.now() - t).toBeLessThan(3 * 2 * _internal.CALL_BUDGET_MS);
    expect(out.ok).toBe(false);
  }, 60000);

  it("a fresh pack with pins is bounded by twice a call's budget", () => {
    expect(_internal.PINNED_CALL_MS).toBe(2 * _internal.CALL_BUDGET_MS);
  });

  it("the first draft's clock stops below 2000 ms", () => {
    expect(_internal.FIRST_DRAFT_CLOCK_MS).toBeLessThan(2000);
  });

  it("300-char text returns within budget", () => {
    let text = BAQARAH;
    while (text.length <= 300) text += " " + BAQARAH;
    const size = fitKufiPanel(text);
    _internal.clearCaches();
    const t = performance.now();
    packKufiPanel({ text, ...size });
    expect(performance.now() - t).toBeLessThan(3 * 2000);
  }, 60000);
});

describe("cell edits", () => {
  it("say when painted cells break packing", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    expect(r.editsBreakPacking).toBe(false);
    const p = r.placements[5];
    const erase = [];
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) erase.push({ unitIndex: 5, key: p.key, dx, dy, on: false });
    const broken = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { cells: erase } });
    expect(broken.ok).toBe(true);
    if (broken.ok) expect(broken.editsBreakPacking).toBe(true);
    // painting a cell that is already ink changes nothing
    const inked = glyphInk(r, p)[0];
    const harmless = { unitIndex: 5, key: p.key, dx: (inked % r.cols) - p.col, dy: ((inked / r.cols) | 0) - p.row, on: true };
    const fine = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { cells: [harmless] } });
    expect(fine.ok).toBe(true);
    if (fine.ok) expect(fine.editsBreakPacking).toBe(false);
  }, 20000);
});

describe("pins", () => {
  it("pinning a unit at its placement and repacking keeps that placement identical", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    for (const k of [0, 5, 12]) {
      const pin = r.placements[k];
      const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { pinned: { [k]: pin } } });
      expect(again.ok).toBe(true);
      if (again.ok) expect(again.placements[k]).toEqual(pin);
    }
  }, 30000);

  it("a fresh pack with a pin either keeps the pin exactly or says no", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    let honoured = 0;
    for (const k of [0, 6, 12]) {
      const pin = r.placements[k];
      const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { [k]: pin } } });
      if (!again.ok) continue;
      expectPacked(again, BAQARAH);
      expect(again.placements[k]).toEqual(pin);
      honoured++;
    }
    expect(honoured).toBeGreaterThan(0);
  }, 30000);

  it("a pin that cannot be honoured gives pinConflict, never a moved pin", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const off = { ...r.placements[5], row: 30 };
    const a = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { 5: off } } });
    expect(a).toEqual({ ok: false, reason: "pinConflict", suggestions: [] });
    const wrongKey = { ...r.placements[5], key: "beh:medial" };
    const b = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { 5: wrongKey } } });
    expect(b.ok).toBe(false);
    if (!b.ok) expect(b.reason).toBe("pinConflict");
  }, 20000);

  it("a repack with previous and no new edit is the same panel", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r });
    expect(again).toEqual(r);
  }, 20000);
});

describe("routes", () => {
  it("a route is the user's record of a drag, not a placement: a pack with one is the pack without it, fresh or from a previous panel", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    _internal.clearCaches();
    const fresh = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { routes: { 1: 3 } } });
    expect(fresh).toEqual(r);
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { routes: { 1: 3 } } });
    expect(again).toEqual(r);
  }, 30000);

  it("a word moves along its path by its first letter's pin; where nothing can make room the packer says no rather than moving the pin", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    // the ي of يكلف, one cell on (right to left) along the bottom line: the لا before it has no stretch along the line
    const yeh = r.placements[1];
    expect(yeh.turn).toBe(0);
    const on = { ...yeh, col: yeh.col - 1 };
    const moved = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { routes: { 1: 1 }, pinned: { 1: on } } });
    if (moved.ok) {
      expect(moved.placements[1]).toEqual(on);
      // words 0 and 1 keep their lines
      expect(moved.placements[0]).toEqual(r.placements[0]);
    } else expect(["tooShort", "tooLong", "pinConflict"]).toContain(moved.reason);
  }, 30000);
});

describe("implicit pins", () => {
  it("a repack that cannot keep previous placements never reports a pin conflict the user did not make", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    for (const k of [0, 5, 13]) {
      const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { [k]: [1] } } });
      if (!again.ok) expect(again.reason, `unit ${k}`).not.toBe("pinConflict");
    }
  }, 20000);

  it("a pin whose stretch the glyph cannot take is a conflict, not a quiet correction", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const bad = { ...r.placements[3], stretch: [-9] };
    const a = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { 3: bad } } });
    expect(a).toEqual({ ok: false, reason: "pinConflict", suggestions: [] });
  }, 20000);
});

describe("stability", () => {
  it("after stretch[k]=[1] with previous, every placement off unit k's line is unchanged", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const { units } = resolveKufiText(BAQARAH);
    const k = 2; // the ك of يكلف, on the bottom line
    expect(glyphOf(r.placements[k].glyphId).stretch.length).toBeGreaterThan(0);
    expect(r.placements[k].stretch).not.toEqual([1]);
    const again = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { [k]: [1] } } }), BAQARAH);
    expect(again.placements[k].stretch).toEqual([1]);
    const keys = lineKeys(r, units);
    r.placements.forEach((p, i) => {
      if (keys[i] !== keys[k]) expect(again.placements[i], `unit ${i}`).toEqual(p);
    });
  }, 20000);
});

describe("reconcileEdits", () => {
  it("text edit keeps matching edits and drops stale ones", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const before = resolveKufiText(BAQARAH).units;
    const edits = {
      pinned: { 0: r.placements[0], 3: r.placements[3] },
      cells: [
        { unitIndex: 0, key: before[0].key, dx: 0, dy: 0, on: true },
        { unitIndex: 3, key: before[3].key, dx: 0, dy: 0, on: false },
      ],
      stretch: { 3: [1] },
    };
    // unit 3 is the ل of يكلف: make it a ب
    const after = resolveKufiText(BAQARAH.replace("يكلف", "يكبف")).units;
    expect(after[3].key).not.toBe(before[3].key);
    const kept = reconcileEdits(edits, before, after);
    expect(Object.keys(kept.pinned ?? {})).toEqual(["0"]);
    expect(kept.cells?.map((e) => e.unitIndex)).toEqual([0]);
    expect(kept.stretch).toEqual({});
  }, 20000);

  it("follows its letter when a letter is inserted before it", () => {
    const before = resolveKufiText(BAQARAH).units;
    const after = resolveKufiText("ب " + BAQARAH).units;
    const kept = reconcileEdits(
      {
        stretch: { 3: [1] },
        forms: { 3: "lam.medial.1" },
        routes: { 1: 2 },
        cells: [{ unitIndex: 3, key: before[3].key, dx: 0, dy: 0, on: true }],
      },
      before,
      after
    );
    expect(kept.stretch).toEqual({ 4: [1] });
    expect(kept.forms).toEqual({ 4: "lam.medial.1" });
    expect(kept.routes).toEqual({ 2: 2 });
    expect(kept.cells).toEqual([{ unitIndex: 4, key: before[3].key, dx: 0, dy: 0, on: true }]);
  });

  it("drops the edits of a deleted letter and moves the rest", () => {
    const before = resolveKufiText(BAQARAH).units;
    const after = resolveKufiText(BAQARAH.replace("يكلف", "يكف")).units;
    const kept = reconcileEdits({ stretch: { 3: [1], 5: [0, 1] } }, before, after);
    // the lam (unit 3) is gone; the allah that was unit 5 is now unit 4
    expect(kept.stretch).toEqual({ 4: [0, 1] });
  });
});

describe("a joining letter's shapes", () => {
  it("never include one without the stub it joins by", () => {
    const list = KUFI_FORMS.beh.medial!;
    const stubless: KufiGlyph = { id: "beh.medial.99", rows: [".#.", ".#."], base: 0, stretch: [] };
    list.push(stubless);
    try {
      const ctx = _internal.makeCtx("ببب", 9, 9, {}, new Map(), 100);
      expect(ctx.letters[1].cands.some((sh) => sh.g.id === "beh.medial.99")).toBe(false);
    } finally {
      list.pop();
    }
  });
});

describe("drawn dots", () => {
  it("stay within a gap of their band, as during the search", () => {
    // the tall initial ظ: its dot would sit two rows above a 7-row stem, out of its band
    const ctx = _internal.makeCtx("ظا", 15, 15, {}, new Map(), 1e9);
    let st = _internal.initState(ctx);
    const pick = (li: number, id: string) => {
      const cands: Parameters<typeof _internal.materialize>[2][] = [];
      _internal.expand(ctx, st, 0, li, cands);
      const c = cands.find((x) => x.mv.shape.g.id === id && x.mv.shape.counts.every((n) => n === 0) && (x.mv.mode !== 1 || x.mv.off === 0));
      expect(c, id).toBeDefined();
      st = _internal.materialize(ctx, st, c!);
    };
    pick(0, "tah.initial.3");
    pick(1, "alef.final.0");
    const f = _internal.finish(ctx, st);
    expect([...f.kind].filter((k) => k === 3)).toEqual([]);
  });
});

describe("fitKufiPanel", () => {
  it("returns a size that packs", () => {
    for (const text of [BAQARAH, ALLAH]) {
      const size = fitKufiPanel(text);
      expectPacked(packKufiPanel({ text, ...size }), text);
    }
  }, 30000);
});

// The reference 21x21 panel's choices, as the packer writes them (see "the scorer" below): its
// strokes change length in two places only, the lam of يكلف cut by 2 and the alef of نفسا grown by 4.
const REF_DEVIATION = 6;
/** Rows of the reference's bottom-right لا (lamAlef.isolated.1, unstretched). */
const REF_LA_ROWS = 9;

/** Total change from authored stroke lengths: |count| summed over every slice of every letter. */
const deviation = (r: Ok) => r.placements.reduce((a, p) => a + p.stretch.reduce((b, n) => b + Math.abs(n), 0), 0);

describe("natural stroke lengths", () => {
  it("Al-Baqarah fills its space with strokes, not filler squares", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    expect(fillersOf(r, BAQARAH)).toEqual([]);
  }, 20000);

  it("Al-Baqarah packs no further from authored lengths than the reference does", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    expect(deviation(r)).toBeLessThanOrEqual(REF_DEVIATION);
  }, 20000);

  it("the bottom-right لا is not cut below the reference's height", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const la = r.placements[0];
    expect(la.glyphId.startsWith("lamAlef.")).toBe(true);
    expect(stretchGlyph(glyphOf(la.glyphId), la.stretch).length).toBeGreaterThanOrEqual(REF_LA_ROWS);
  }, 20000);

  it("no letter of وسعها is stretched more than in the reference (where none is)", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const { units } = resolveKufiText(BAQARAH);
    const last = units.filter((u) => u.wordIndex === units[units.length - 1].wordIndex);
    expect(last).toHaveLength(5);
    for (const u of last) {
      const grown = r.placements[u.index].stretch.reduce((a, n) => a + Math.max(0, n), 0);
      expect(grown, `${r.placements[u.index].glyphId}`).toBe(0);
    }
  }, 20000);

  it("a user's stretch edit is kept and still packs", () => {
    // the edit is the user's: the packer keeps it, and still packs where it can
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { 2: [1] } } });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.placements[2].stretch).toEqual([1]);
  }, 20000);
});

describe("the ranking of packed panels", () => {
  type F = Parameters<typeof _internal.better>[0];
  const panel = (o: Partial<{ packed: boolean; squares: number; cut: number; grow: number; score: number }>) =>
    ({ packed: true, squares: 0, cut: 0, grow: 0, score: 0, ...o }) as unknown as F;

  it("is packed, then fewest squares, then least cut, then least growth, then score, strictly in that order", () => {
    const b = _internal.better;
    expect(b(panel({ packed: true, squares: 3, cut: 9, grow: 99 }), panel({ packed: false }))).toBe(true);
    expect(b(panel({ squares: 0, cut: 9 }), panel({ squares: 1, cut: 0 }))).toBe(true);
    // one cell of cut outranks any amount of growth
    expect(b(panel({ cut: 0, grow: 500 }), panel({ cut: 1, grow: 0 }))).toBe(true);
    expect(b(panel({ cut: 1, grow: 0 }), panel({ cut: 0, grow: 500 }))).toBe(false);
    expect(b(panel({ grow: 1, score: 99 }), panel({ grow: 2, score: 0 }))).toBe(true);
    expect(b(panel({ score: 1 }), panel({ score: 2 }))).toBe(true);
  });

  it("the user's stretch edits, pins and form choices are not counted as deviation", () => {
    const short = KUFI_FORMS.lamAlef.isolated!.find((g) => g.id === "lamAlef.isolated.3")!;
    // a form edit: its natural length is its own, so the short لا the user chose is not a cut
    const byForm = _internal.makeCtx(BAQARAH, 21, 21, { forms: { 0: short.id } }, new Map(), 100);
    const own = byForm.letters[0].cands.find((sh) => sh.counts.every((n) => n === 0))!;
    expect(_internal.devOf(byForm.letters[0], own)).toBe(0);
    const unchosen = _internal.makeCtx(BAQARAH, 21, 21, {}, new Map(), 100);
    const sameShape = unchosen.letters[0].cands.find((sh) => sh.g.id === short.id && sh.counts.every((n) => n === 0))!;
    expect(_internal.devOf(unchosen.letters[0], sameShape)).toBeGreaterThan(0);
    // a stretch edit and a pin: the length is the user's
    const byStretch = _internal.makeCtx(BAQARAH, 21, 21, { stretch: { 3: [-2] } }, new Map(), 100);
    for (const sh of byStretch.letters[3].cands) expect(_internal.devOf(byStretch.letters[3], sh)).toBe(0);
    const free = _internal.makeCtx(BAQARAH, 21, 21, {}, new Map(), 100);
    const cutLam = free.letters[3].cands.find((sh) => sh.g.id === "lam.medial.0" && sh.counts[0] === -2)!;
    expect(_internal.devOf(free.letters[3], cutLam)).toBeGreaterThan(0);
  });
});

describe("the natural-length phase", () => {
  it("runs on a panel the greedy pass already packs", () => {
    _internal.clearCaches();
    const before = _internal.stats.naturalRuns;
    expectPacked(packKufiPanel({ text: ALLAH, cols: 9, rows: 9 }), ALLAH);
    expect(_internal.stats.naturalRuns).toBeGreaterThan(before);
  });

  it("leaves no single-letter move that gives a better packed panel", () => {
    for (const [text, n] of [
      [ALLAH, 9],
      [BAQARAH, 21],
    ] as const) {
      const ctx = _internal.makeCtx(text, n, n, {}, new Map(), _internal.PACK_BUDGET_MS);
      const f = _internal.search(ctx)!;
      expect(f.packed).toBe(true);
      ctx.workMax = Infinity;
      ctx.deadline = Infinity;
      ctx.out = false;
      const plan = _internal.planOf(ctx, f.st);
      const pre = _internal.prefixesOf(ctx, plan)!;
      for (let li = 0; li < plan.length; li++)
        for (const mv of _internal.movesAt(ctx, pre[li], li)) {
          const p2 = plan.slice();
          p2[li] = mv;
          const s = _internal.replayFrom(ctx, pre[li], p2, li);
          if (!s) continue;
          const g = _internal.finish(ctx, s);
          expect(g.packed && _internal.better(g, f), `${text}: letter ${li} as ${mv.shape.g.id}[${mv.shape.counts}]`).toBe(false);
        }
    }
  }, 120000);

  it("reaches the reference's layout for Al-Baqarah with room to spare: under 85% of the work cap", () => {
    const ctx = _internal.makeCtx(BAQARAH, 21, 21, {}, new Map(), _internal.PACK_BUDGET_MS * 0.85);
    ctx.deadline = Infinity;
    const f = _internal.search(ctx)!;
    expect({ packed: f.packed, squares: f.squares }).toEqual({ packed: true, squares: 0 });
    const ids = _internal.placedList(f.st).map((p) => `${p.shape.g.id}[${p.shape.counts}]`);
    expect(ids[0]).toBe("lamAlef.isolated.1[0]");
    expect(ids[9]).toBe("alef.final.0[4]");
  }, 20000);
});

describe("pins taken from a packed panel, packed fresh (a saved panel reloaded)", () => {
  it("each unit pinned at its packed placement packs, with that placement", () => {
    _internal.clearCaches();
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    for (let k = 0; k < r.placements.length; k++) {
      const pin = r.placements[k];
      const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { [k]: pin } } });
      expect(again.ok, `unit ${k} ${pin.glyphId}`).toBe(true);
      if (again.ok) expect(again.placements[k]).toEqual(pin);
    }
  }, 120000);

  it("every unit pinned reproduces the panel exactly", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const pinned = Object.fromEntries(r.placements.map((p, k) => [k, p]));
    _internal.clearCaches();
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned } });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.placements).toEqual(r.placements);
    expect([...again.cells]).toEqual([...r.cells]);
  }, 30000);

  it("a committed stretch (+2, pinned where the repack put it) packs again after a reload", () => {
    // the canvas flow: a draft, a stretch previewed as a repack from it, then committed with a pin
    const draft = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const k = 2;
    const preview = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: draft, edits: { stretch: { [k]: [2] } } }), BAQARAH);
    const committed = { stretch: { [k]: [2] }, pinned: { [k]: preview.placements[k] } };
    _internal.clearCaches();
    const reloaded = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: committed });
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) expect(reloaded.placements[k]).toEqual(preview.placements[k]);
  }, 30000);
});

describe("pins taken from a packed panel: determinism and conflicts", () => {
  it("with the clock override a repack never reads the wall clock", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const edits = { stretch: { 2: [1] } };
    const quiet = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits });
    expect(quiet.ok).toBe(true);
    // a clock that races ahead a second on every reading: a heavily loaded machine
    const real = performance.now.bind(performance);
    let skew = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => real() + (skew += 1000));
    try {
      const loaded = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits });
      expect(loaded).toEqual(quiet);
    } finally {
      spy.mockRestore();
    }
  }, 30000);

  it("two pins on the same cells still give pinConflict after the fallbacks", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const a = r.placements[1];
    // unit 2 pinned on top of unit 1
    const b = { ...r.placements[2], col: a.col, row: a.row, turn: a.turn };
    const out = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { pinned: { 1: a, 2: b } } });
    expect(out).toEqual({ ok: false, reason: "pinConflict", suggestions: [] });
  }, 60000);

  it("fitKufiPanel takes the same pinned path, so a reloaded edit keeps its size", () => {
    const draft = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const preview = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: draft, edits: { stretch: { 2: [2] } } }), BAQARAH);
    const committed = { stretch: { 2: [2] }, pinned: { 2: preview.placements[2] } };
    _internal.clearCaches();
    expect(fitKufiPanel(BAQARAH, committed)).toEqual({ cols: 21, rows: 21 });
  }, 60000);
});

describe("the form rule", () => {
  it("is the packer's own, shared under a public name", () => {
    const { units } = resolveKufiText(BAQARAH);
    for (const u of units) expect(kufiFormsOf(u).length).toBeGreaterThan(0);
    expect(kufiFormsOf({ skeleton: "lam", form: "medial" }).map((g) => g.id)).toContain("lam.medial.0");
    // a form a skeleton lacks falls back to its isolated list
    expect(kufiFormsOf({ skeleton: "alef", form: "medial" }).every((g) => g.id.startsWith("alef.isolated."))).toBe(true);
  });
});

describe("the clock override (tests only)", () => {
  it("lets a layout test run on its work budget alone, and leaves the product's clock alone", () => {
    _internal.setClockOverride(null);
    expect(Number.isFinite(_internal.makeCtx(BAQARAH, 21, 21, {}, new Map(), 100).deadline)).toBe(true);
    _internal.setClockOverride(Infinity);
    try {
      expect(_internal.makeCtx(BAQARAH, 21, 21, {}, new Map(), 100).deadline).toBe(Infinity);
    } finally {
      // the rest of this file runs work-bounded
      _internal.setClockOverride(Infinity);
    }
  });
});

describe("the scorer", () => {
  it("accepts the reference panel's own arrangement as packed", () => {
    // The reference 21x21 panel, written as this packer's choices, in reading order:
    // [glyph, counts, mode (1 opens template line t at offset off, 0 continues, 2 joins with jext, 3 U-turns with climb), t | jext | climb, off]
    const plan: Array<[string, number[], number, number?, number?]> = [
      ["lamAlef.isolated.1", [0], 1, 0, 0],
      ["yeh.initial.1", [0, 0], 0],
      ["kaf.medial.2", [0], 2, 0],
      ["lam.medial.0", [-2], 2, 0],
      ["feh.final.3", [0], 2, 0],
      ["allah.isolated.2", [0, 0], 1, 1, 0],
      ["noon.initial.2", [0, 0], 1, 2, 0],
      ["feh.medial.0", [], 2, 1],
      ["seen.medial.0", [0], 2, 0],
      ["alef.final.0", [4], 2, 0],
      ["alef.isolated.0", [0], 0],
      ["lamAlef.isolated.0", [0], 0],
      ["waw.isolated.0", [], 1, 3, 2],
      ["seen.initial.0", [0], 1, 4, 0],
      ["ain.medial.0", [], 2, 0],
      ["heh.medial.2", [], 3, 0],
      ["alef.final.0", [0], 2, 0],
    ];
    const ctx = _internal.makeCtx(BAQARAH, 21, 21, {}, new Map(), 1e9);
    let st = _internal.initState(ctx);
    plan.forEach(([id, counts, mode, a = 0, off = 0], li) => {
      const cands: Parameters<typeof _internal.materialize>[2][] = [];
      _internal.expand(ctx, st, 0, li, cands);
      const c = cands.find(
        (x) =>
          x.mv.shape.g.id === id &&
          x.mv.shape.counts.join() === counts.join() &&
          x.mv.mode === mode &&
          (mode !== 1 || (x.mv.t === a && x.mv.off === off)) &&
          (mode !== 2 || x.mv.jext === a) &&
          (mode !== 3 || x.mv.climb === a)
      );
      expect(c, `letter ${li} ${id}`).toBeDefined();
      st = _internal.materialize(ctx, st, c!);
    });
    const f = _internal.finish(ctx, st);
    expect({ holes: f.holes, edge: f.edge, ink2: f.ink2, failed: f.st.failed, packed: f.packed }).toEqual({
      holes: 0,
      edge: 0,
      ink2: 0,
      failed: 0,
      packed: true,
    });
  });
});
