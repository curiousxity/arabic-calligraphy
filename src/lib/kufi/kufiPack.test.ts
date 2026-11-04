import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { KUFI_FORMS, dotCells, dotsOf, stretchGlyph, stretchedBase, type KufiGlyph } from "./kufiAlphabet";
import { emptyBlocks2x2, inkBlocks2x2, rotateRows, type Turn } from "./kufiGrid";
import { resolveKufiText, type KufiUnit } from "./kufiWords";
import { kufiMovedUnits, kufiPinWordEdits, kufiRouteEdits } from "./kufiPanelBlock";
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
// `quality` counts only unpinned letters, so a repack of pinned letters reports less of it: layouts are compared without it
const layoutOf = (r: KufiPackResult) => {
  if (!r.ok) return r;
  const layout = { ...r };
  delete layout.quality;
  return layout;
};
const ALLAH = "الله";
const SHAHADA = "لا إله إلا الله محمد رسول الله";
const NASR = "نصر من الله";

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
  const zone = dotZoneOf(r);
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

/** The cells where a lone square or a bar could pass for a dot: every one- or two-dot set each placed glyph has, and the cells round them. */
function dotZoneOf(r: Ok): Set<number> {
  const zone = new Set<number>();
  const repr: Record<string, string> = { above1: "ن", above2: "ت", below1: "ب", below2: "ي" };
  for (const p of r.placements) {
    const g = glyphOf(p.glyphId);
    const rows = stretchGlyph(g, p.stretch);
    for (const [key, set] of Object.entries(g.dots ?? {})) {
      if (key.endsWith("3") || !set) continue;
      for (const c of dotCells(g, repr[key], "initial", p.stretch))
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const [rr, cc] = boxCell(p.turn, rows.length, rows[0].length, p.row, p.col, c.row + dr, c.col + dc);
            // a cell past an edge is no zone (an index past the right edge would wrap onto the next row)
            if (rr >= 0 && cc >= 0 && rr < r.rows && cc < r.cols) zone.add(rr * r.cols + cc);
          }
    }
  }
  return zone;
}

/**
 * Every non-letter, non-dot ink run that is not a lone square: a bar, by the
 * spec's rule. Straight, one cell wide, at least 2 long, with no ink beside
 * it but at its two ends, none of it in a dot zone, and parallel to the
 * baseline of every letter it touches. A run joining two letters of one run
 * (a join stroke or a U-turn) is the letters' own and not a bar.
 */
function expectBarsAreBars(r: Ok, text: string): number {
  const { units } = resolveKufiText(text);
  const { cols, rows, cells } = r;
  const ink = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < rows && cc < cols && cells[rr * cols + cc] === 1;
  const placedAt = new Int32Array(cols * rows).fill(-1);
  for (const p of r.placements) for (const i of glyphInk(r, p)) placedAt[i] = p.unitIndex;
  // dots and filler squares: lone ink outside the glyphs
  const lone = new Set<number>();
  for (let i = 0; i < cols * rows; i++) {
    const rr = (i / cols) | 0;
    const cc = i % cols;
    if (cells[i] && placedAt[i] < 0 && !ink(rr - 1, cc) && !ink(rr + 1, cc) && !ink(rr, cc - 1) && !ink(rr, cc + 1)) lone.add(i);
  }
  const zone = dotZoneOf(r);
  const seen = new Uint8Array(cols * rows);
  let bars = 0;
  for (let i0 = 0; i0 < cols * rows; i0++) {
    if (!cells[i0] || placedAt[i0] >= 0 || lone.has(i0) || seen[i0]) continue;
    // the 4-connected group of non-letter ink
    const group: number[] = [];
    const stack = [i0];
    seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      group.push(i);
      const rr = (i / cols) | 0;
      const cc = i % cols;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!ink(rr + dr, cc + dc)) continue;
        const j = (rr + dr) * cols + cc + dc;
        if (seen[j] || placedAt[j] >= 0) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    // the letters it touches
    const touched = new Map<number, number[]>();
    for (const i of group) {
      const rr = (i / cols) | 0;
      const cc = i % cols;
      for (const [dr, dc] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        if (!ink(rr + dr, cc + dc)) continue;
        const u = placedAt[(rr + dr) * cols + cc + dc];
        if (u >= 0) touched.set(u, [...(touched.get(u) ?? []), i]);
      }
    }
    const us = [...touched.keys()].sort((a, b) => a - b);
    if (us.length === 2 && us[1] === us[0] + 1 && units[us[0]].joinsNext) continue;
    bars++;
    const rs = group.map((i) => (i / cols) | 0);
    const cs = group.map((i) => i % cols);
    const row = rs.every((v) => v === rs[0]);
    const col = cs.every((v) => v === cs[0]);
    const where = `the bar at r${rs[0]}c${cs[0]}`;
    expect(row || col, `${where} is straight`).toBe(true);
    expect(group.length, `${where} is at least 2 long`).toBeGreaterThanOrEqual(2);
    const lo = Math.min(...(row ? cs : rs));
    const hi = Math.max(...(row ? cs : rs));
    expect(hi - lo + 1, `${where} has no gap`).toBe(group.length);
    for (const i of group) {
      const rr = (i / cols) | 0;
      const cc = i % cols;
      expect(zone.has(i), `${where} lies in a dot zone at r${rr}c${cc}`).toBe(false);
      const sides = row ? [ink(rr - 1, cc), ink(rr + 1, cc)] : [ink(rr, cc - 1), ink(rr, cc + 1)];
      expect(sides, `${where} has ink beside it at r${rr}c${cc}`).toEqual([false, false]);
    }
    for (const [u, at] of touched) {
      for (const i of at) {
        const along = row ? i % cols : (i / cols) | 0;
        expect(along === lo || along === hi, `${where} touches unit ${u} only at an end`).toBe(true);
      }
      const turn = r.placements[u].turn;
      expect(turn === 0 || turn === 2 ? row : col, `${where} runs along the baseline of unit ${u}`).toBe(true);
    }
  }
  return bars;
}

function expectPacked(r: KufiPackResult, text: string): Ok {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("not packed");
  expect(inkBlocks2x2(grid(r))).toEqual([]);
  expect(emptyBlocks2x2(grid(r))).toEqual([]);
  const { units } = resolveKufiText(text);
  expectReadingOrder(r, units);
  expectDotsAreLetters(r, text, units);
  expectBarsAreBars(r, text);
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
describe("panelStart", () => {
  it("bottom right is the default: the same cells as a pack without the field", () => {
    for (const [text, n] of [
      [ALLAH, 9],
      [BAQARAH, 21],
    ] as const)
      expect(layoutOf(packKufiPanel({ text, cols: n, rows: n, start: "bottomRight" }))).toEqual(layoutOf(packKufiPanel({ text, cols: n, rows: n })));
  }, 20000);

  it("top right starts the first word on the right side, read downward: سبحان الله at 15x13 is its 13x15 panel turned a quarter anticlockwise", () => {
    const text = "سبحان الله";
    const r = expectPacked(packKufiPanel({ text, cols: 15, rows: 13, start: "topRight" }), text);
    expect(r.placements[0].turn).toBe(3);
    // the same clockwise order one side later: right, bottom, left, top
    const turns = [...new Set(r.placements.map((p) => p.turn))];
    expect(turns).toEqual([3, 0, 1, 2].slice(0, turns.length));
    const a = expectPacked(packKufiPanel({ text, cols: 13, rows: 15 }), text);
    const turned = new Uint8Array(15 * 13);
    for (let row = 0; row < 15; row++) for (let col = 0; col < 13; col++) turned[(13 - 1 - col) * 15 + row] = a.cells[row * 13 + col];
    expect(Array.from(r.cells)).toEqual(Array.from(turned));
    // a square is its own turn, yet a tight one (Al-Baqarah at 21x21) need not pack from the other corner within the work cap: the beam's ties fall differently
    expect(packKufiPanel({ text: ALLAH, cols: 9, rows: 9, start: "topRight" }).ok).toBe(true);
  }, 20000);
});

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

  it("a pinned Fit stays within FIT_BUDGET_MS plus one pinned call", () => {
    const draft = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 });
    if (!draft.ok) throw new Error("no draft");
    const preview = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: draft, edits: { stretch: { 2: [2] } } });
    if (!preview.ok) throw new Error("no preview");
    const committed = { stretch: { 2: [2] }, pinned: { 2: preview.placements[2] } };
    _internal.clearCaches();
    const t = performance.now();
    fitKufiPanel(BAQARAH, committed);
    expect(performance.now() - t).toBeLessThan(_internal.FIT_BUDGET_MS + _internal.PINNED_CALL_MS);
  }, 60000);

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
    expect(layoutOf(again)).toEqual(layoutOf(r));
  }, 20000);
});

describe("routes", () => {
  it("a route is the user's record of a drag, not a placement: a pack with one is the pack without it, fresh or from a previous panel", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    _internal.clearCaches();
    const fresh = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, edits: { routes: { 1: 3 } } });
    expect(layoutOf(fresh)).toEqual(layoutOf(r));
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { routes: { 1: 3 } } });
    expect(layoutOf(again)).toEqual(layoutOf(r));
  }, 30000);

  it("a word moves along its path by its first letter's pin, the letters before it lengthening along the line to absorb the shift", () => {
    // نصر من الله at 15×9: نصر along the bottom, من up the left side, الله along the top
    const r = expectPacked(packKufiPanel({ text: NASR, cols: 15, rows: 9 }), NASR);
    const { units } = resolveKufiText(NASR);
    const meem = units.findIndex((u) => u.wordIndex === 1);
    const p = r.placements[meem];
    expect(p.turn).toBe(1);
    const k = 2;
    const on = { ...p, row: p.row - k };
    const moved = packKufiPanel({ text: NASR, cols: 15, rows: 9, previous: r, edits: { routes: { 1: k }, pinned: { [meem]: on } } });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expectPacked(moved, NASR);
    expect(moved.placements[meem]).toEqual(on);
    // the ص before the corner grew along the bottom line by the shift; الله after the corner is untouched
    const sad = units.findIndex((u) => u.key === "sad:medial");
    expect(moved.placements[sad].stretch[0]).toBe(r.placements[sad].stretch[0] + k);
    expect(moved.placements[5]).toEqual(r.placements[5]);
    // one cell up leaves the ر no room under the م: refused, not moved
    const one = packKufiPanel({ text: NASR, cols: 15, rows: 9, previous: r, edits: { routes: { 1: 1 }, pinned: { [meem]: { ...p, row: p.row - 1 } } } });
    expect(one.ok).toBe(false);
  }, 30000);

  it("where nothing can make room the packer says no rather than moving the pin", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    // the ي of يكلف, one cell on (right to left) along the bottom line: the لا before it has no stretch along the line
    const yeh = r.placements[1];
    expect(yeh.turn).toBe(0);
    const on = { ...yeh, col: yeh.col - 1 };
    const moved = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { routes: { 1: 1 }, pinned: { 1: on } } });
    expect(moved.ok).toBe(false);
    if (!moved.ok) expect(["tooShort", "tooLong", "pinConflict"]).toContain(moved.reason);
  }, 30000);
});

/** A short checksum of a pack's layout (placements and cells), to hold a panel to what an earlier packer gave. */
function layoutHash(r: KufiPackResult): string {
  if (!r.ok) return `fail:${r.reason}`;
  const s = JSON.stringify([r.cols, r.rows, r.placements, Array.from(r.cells).join(""), r.editsBreakPacking]);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

describe("a moved word rearranging the panel", () => {
  const PANELS: Array<[string, number, number]> = [
    [NASR, 15, 9],
    ["سبحان الله", 13, 15],
    ["إن شاء الله", 13, 13],
    ["قل هو الله أحد", 11, 22],
    ["بسم الله الرحمن الرحيم", 17, 19],
    ["الحمد لله", 13, 13],
    [BAQARAH, 21, 21],
  ];
  /** Every move of `route` cells the panel lets a word make (the box stays on the panel), with the panel it starts from. */
  const movesOf = (route: number) =>
    PANELS.flatMap(([text, cols, rows]) => {
      const committed = expectPacked(packKufiPanel({ text, cols, rows }), text);
      const units = resolveKufiText(text).units;
      const words = Math.max(...units.map((u) => u.wordIndex)) + 1;
      return Array.from({ length: words }, (_, w) => w).flatMap((w) => {
        const edits = kufiRouteEdits(undefined, committed, units, w, route);
        return edits ? [{ text, cols, rows, committed, units, w, edits }] : [];
      });
    });
  const nasr = () => {
    const committed = expectPacked(packKufiPanel({ text: NASR, cols: 15, rows: 9 }), NASR);
    return { committed, units: resolveKufiText(NASR).units };
  };

  it("نصر at +2, which no round of the repack packs, packs by rearranging the rest, its first letter at its pin", () => {
    const { committed, units } = nasr();
    const edits = kufiRouteEdits(undefined, committed, units, 0, 2)!;
    expect(edits).not.toBeNull();
    const moved = packKufiPanel({ text: NASR, cols: 15, rows: 9, previous: committed, edits });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expectPacked(moved, NASR);
    expect(moved.placements[0]).toEqual(edits.pinned![0]);
    // the rest did rearrange: the م of the next word moved too
    expect(moved.placements[3]).not.toEqual(committed.placements[3]);
  }, 30000);

  it("a repack the clock cut short never reaches the step", () => {
    const { committed, units } = nasr();
    const edits = kufiRouteEdits(undefined, committed, units, 0, 2)!;
    const input = { text: NASR, cols: 15, rows: 9, previous: committed, edits };
    const reached = (pack: () => void) => {
      const before = _internal.stats.rearranges;
      pack();
      return _internal.stats.rearranges - before;
    };
    // work-bounded, the rounds end on their work and the step packs the move
    expect(reached(() => expect(packKufiPanel(input).ok).toBe(true))).toBe(1);
    // the product's clock, racing ahead a second on every reading: the rounds stop on the clock,
    // nothing packs, and the move is refused as it was before the step (the rest retry asks again)
    _internal.setClockOverride(null);
    const real = performance.now.bind(performance);
    let skew = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => real() + (skew += 1000));
    try {
      expect(reached(() => expect(packKufiPanel(input).ok).toBe(false))).toBe(0);
    } finally {
      spy.mockRestore();
      _internal.setClockOverride(Infinity);
    }
    // a deadline already past: every round starts, but each search ends on the clock
    _internal.setClockOverride(0);
    try {
      expect(reached(() => packKufiPanel(input))).toBe(0);
    } finally {
      _internal.setClockOverride(Infinity);
    }
  }, 30000);

  it("a move that packed before packs the same, cell for cell (يكلف at +2 on Al-Baqarah)", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    const units = resolveKufiText(BAQARAH).units;
    const moved = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: kufiRouteEdits(undefined, r, units, 1, 2)! });
    // the packer's result before the rearranging step: the first round packs, nothing outside the word changed
    expect(layoutHash(moved)).toBe("951deba1");
    if (!moved.ok) return;
    moved.placements.forEach((p, k) => {
      if (units[k].wordIndex !== 1) expect(p, `unit ${k}`).toEqual(r.placements[k]);
    });
  }, 30000);

  it("a move of one cell still never packs, on any bundled panel", () => {
    const moves = movesOf(1);
    expect(moves.length).toBeGreaterThan(10);
    for (const { text, cols, rows, committed, w, edits } of moves)
      expect(packKufiPanel({ text, cols, rows, previous: committed, edits }).ok, `${text} word ${w}`).toBe(false);
  }, 120000);

  it("letters the user pinned stay at their pins while the rest rearranges", () => {
    const { committed, units } = nasr();
    const allah = committed.placements[5];
    const edits = kufiRouteEdits({ pinned: { 5: allah } }, committed, units, 0, 2)!;
    const moved = packKufiPanel({ text: NASR, cols: 15, rows: 9, previous: committed, edits });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expectPacked(moved, NASR);
    expect(moved.placements[5]).toEqual(allah);
    expect(moved.placements[0]).toEqual(edits.pinned![0]);
    expect(moved.placements[3]).not.toEqual(committed.placements[3]);
  }, 30000);

  it("the committed move, pinned where it moved letters, reopens identical with no previous panel", () => {
    const { committed, units } = nasr();
    const edits = kufiRouteEdits(undefined, committed, units, 0, 2)!;
    const moved = expectPacked(packKufiPanel({ text: NASR, cols: 15, rows: 9, previous: committed, edits }), NASR);
    const saved = kufiPinWordEdits(edits, committed, moved, units, 0);
    // the move changed letters outside the word, so the panel is pinned whole, الله too though it did not move
    expect(Object.keys(saved.pinned!).map(Number).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    _internal.clearCaches();
    const reopened = packKufiPanel({ text: NASR, cols: 15, rows: 9, edits: saved });
    expect(layoutOf(reopened)).toEqual(layoutOf(moved));
  }, 30000);

  it("every two-cell move that packs, on every bundled panel, reopens identical from its committed edits", () => {
    let packed = 0;
    let whole = 0;
    for (const route of [-2, 2])
      for (const { text, cols, rows, committed, units, w, edits } of movesOf(route)) {
        const moved = packKufiPanel({ text, cols, rows, previous: committed, edits });
        if (!moved.ok) continue;
        packed++;
        const saved = kufiPinWordEdits(edits, committed, moved, units, w);
        const pinned = Object.keys(saved.pinned ?? {}).length;
        if (kufiMovedUnits(committed, moved, units, w).length > 0) {
          whole++;
          expect(pinned, `${text} word ${w} at ${route}`).toBe(units.length);
        } else expect(pinned, `${text} word ${w} at ${route}`).toBe(units.filter((u) => u.wordIndex === w).length);
        _internal.clearCaches();
        const reopened = packKufiPanel({ text, cols, rows, edits: saved });
        expect(layoutOf(reopened), `${text} word ${w} at ${route}`).toEqual(layoutOf(moved));
      }
    // nasr's two, إن شاء الله, قل هو الله أحد, Bismillah and two on Al-Baqarah; all but Al-Baqarah's word 1 changed other letters
    expect(packed).toBe(7);
    expect(whole).toBe(6);
  }, 300000);

  it("an edit other than a move never reaches the step: a stretch repacks as before, packed or not", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    expect(layoutHash(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { 2: [1] } } }))).toBe("ed03f64d");
    expect(layoutHash(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { 0: [1] } } }))).toBe("fail:tooShort");
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

  it("a letter typed next to an identical one leaves the edit on the letter it was made on", () => {
    // A ي joined before the لا: the new unit 0 and the ي of يكلف (unit 1, now 2) share a key,
    // and an alignment that takes the earliest match would move the edit onto the typed letter.
    const before = resolveKufiText(BAQARAH).units;
    const after = resolveKufiText("ي" + BAQARAH).units;
    expect(after[0].key).toBe(before[1].key);
    expect(after[2].key).toBe(before[1].key);
    const kept = reconcileEdits({ stretch: { 1: [1] }, forms: { 1: before[1].key.replace(":", ".") + ".0" } }, before, after);
    expect(kept.stretch).toEqual({ 2: [1] });
    expect(Object.keys(kept.forms ?? {})).toEqual(["2"]);
  });

  it("deleting one of two identical neighbours drops that letter's edits and keeps the other's", () => {
    const before = resolveKufiText("ي" + BAQARAH).units;
    const after = resolveKufiText(BAQARAH).units;
    const kept = reconcileEdits({ stretch: { 0: [2], 2: [1] } }, before, after);
    expect(kept.stretch).toEqual({ 1: [1] });
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

  it("fits «الله أكبر», which packs only in a rectangle", () => {
    const size = fitKufiPanel("الله أكبر");
    expect(size.cols).not.toBe(size.rows);
    expectPacked(packKufiPanel({ text: "الله أكبر", ...size }), "الله أكبر");
  }, 60000);

  it("keeps the square sizes of the texts that pack in one", () => {
    expect(fitKufiPanel(ALLAH)).toEqual({ cols: 9, rows: 9 });
    expect(fitKufiPanel("الحمد لله")).toEqual({ cols: 13, rows: 13 });
    expect(fitKufiPanel(BAQARAH)).toEqual({ cols: 21, rows: 21 });
  }, 60000);

  it("suggests a rectangle when only rectangles pack", () => {
    const r = packKufiPanel({ text: "الله أكبر", cols: 13, rows: 13 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.suggestions.length).toBeGreaterThanOrEqual(1);
    for (const s of r.suggestions) expectPacked(packKufiPanel({ text: "الله أكبر", ...s }), "الله أكبر");
  }, 60000);

  it("accepts a very wide box: no proportion is capped", () => {
    expect(() => packKufiPanel({ text: ALLAH, cols: 41, rows: 9 })).not.toThrow();
  }, 60000);
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
  const panel = (o: Partial<{ packed: boolean; squares: number; bars: number; cut: number; grow: number; score: number }>) =>
    ({ packed: true, squares: 0, bars: 0, cut: 0, grow: 0, score: 0, ...o }) as unknown as F;

  it("is packed, then fewest squares, then fewest bars, then least cut, then least growth, then score, strictly in that order", () => {
    const b = _internal.better;
    expect(b(panel({ packed: true, squares: 3, cut: 9, grow: 99 }), panel({ packed: false }))).toBe(true);
    expect(b(panel({ squares: 0, cut: 9 }), panel({ squares: 1, cut: 0 }))).toBe(true);
    // one bar is preferred to a square, and any lengthening or shortening to a bar
    expect(b(panel({ squares: 0, bars: 3 }), panel({ squares: 1, bars: 0 }))).toBe(true);
    expect(b(panel({ bars: 0, cut: 9, grow: 99 }), panel({ bars: 1 }))).toBe(true);
    expect(b(panel({ bars: 1 }), panel({ bars: 0, cut: 9 }))).toBe(false);
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

  it("the centre place takes the star forms and the centre-only ones (الله: the forms whose heh never grows, and the Cairo 9x5); panel and star lists are unchanged", () => {
    const u = resolveKufiText("الله").units[0];
    expect(kufiFormsOf(u).map((g) => g.id)).toEqual(["allah.isolated.0", "allah.isolated.1", "allah.isolated.2"]);
    expect(kufiFormsOf(u, "star").map((g) => g.id)).toEqual(["allah.isolated.3", "allah.isolated.5", "allah.isolated.6"]);
    expect(kufiFormsOf(u, "centre").map((g) => g.id)).toEqual(["allah.isolated.3", "allah.isolated.5", "allah.isolated.6", "allah.isolated.7"]);
    // a letter with no star or centre forms takes the panel's in the centre
    const m = resolveKufiText("محمد").units[0];
    expect(kufiFormsOf(m, "centre")).toEqual(kufiFormsOf(m));
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

describe("panels that packed before bars", () => {
  // the cells as packed before filler bars existed: bars are tried only where a panel does not pack without them
  it("panels that packed before bars keep every cell", () => {
    const before: Array<[string, number, string]> = [
      [ALLAH, 9, "111010101101010101101010101101010101101010101001010101111010101101010101111111111"],
      [
        "الحمد لله",
        13,
        "1010111111101101010101010111101010101011000101010101111010101010110101010101011110101010101100000101010110111010111011000101010001111110101110110000000000011111111111101",
      ],
      [
        BAQARAH,
        21,
        "111111111111111010111100010001010101010101101011101010101010111100010100000001010010111011101111101010111000000001010101010101111010101110101010101101010001010101000000111110111110101011111100000100000101010101111110101110101011101100000101010000000000111110101110101010101000000100100101010101111010111111111110101000000000000000000101101110101111111010111101010101000000010010101110101110111110111100010100010100000101111111111111101010111",
      ],
    ];
    for (const [text, n, cells] of before) {
      const r = expectPacked(packKufiPanel({ text, cols: n, rows: n }), text);
      expect(Array.from(r.cells).join(""), text).toBe(cells);
    }
  }, 60000);
});

describe("filler bars", () => {
  for (const text of ["سبحان الله", "بسم الله الرحمن الرحيم", "قل هو الله أحد"])
    it(`Fit packs «${text}»`, () => {
      const size = fitKufiPanel(text);
      const r = expectPacked(packKufiPanel({ text, ...size }), text);
      expect(r.quality).toHaveProperty("bars");
    }, 90000);

  it("packs «بسم الله الرحمن الرحيم» at 17×19, its near miss, with bars that are bars", () => {
    const text = "بسم الله الرحمن الرحيم";
    const r = expectPacked(packKufiPanel({ text, cols: 17, rows: 19 }), text);
    expect(r.quality!.bars).toBeGreaterThan(0);
    expect(expectBarsAreBars(r, text)).toBe(r.quality!.bars);
  }, 20000);

  it("a panel that packs without bars is the panel packed with the bar phase switched off", () => {
    const fitted = (text: string) => {
      _internal.setBarsOff(true);
      try {
        return fitKufiPanel(text);
      } finally {
        _internal.setBarsOff(false);
      }
    };
    const cases: Array<[string, number, number]> = [
      [ALLAH, 9, 9],
      ["الحمد لله", 13, 13],
      [BAQARAH, 21, 21],
      [NASR, 15, 9],
      ["الله أكبر", 11, 13],
      ["الله أكبر", 15, 12],
      ["الله أكبر", fitted("الله أكبر").cols, fitted("الله أكبر").rows],
    ];
    for (const [text, cols, rows] of cases) {
      _internal.clearCaches();
      _internal.setBarsOff(true);
      let off: KufiPackResult;
      try {
        off = packKufiPanel({ text, cols, rows });
      } finally {
        _internal.setBarsOff(false);
      }
      expect(off.ok, `${text} ${cols}x${rows} packs without bars`).toBe(true);
      _internal.clearCaches();
      const on = expectPacked(packKufiPanel({ text, cols, rows }), text);
      expect(on.quality?.bars, `${text} ${cols}x${rows}`).toBe(0);
      expect(Array.from(on.cells).join(""), `${text} ${cols}x${rows}`).toBe(off.ok ? Array.from(off.cells).join("") : "");
    }
  }, 120000);

  it("never draws a bar where a panel packs without one", () => {
    const r = expectPacked(packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 }), BAQARAH);
    expect(r.quality?.bars).toBe(0);
  }, 20000);

  it("a repack of a bar-closed panel still packs (a drag preview is not refused)", () => {
    const text = "سبحان الله";
    const size = fitKufiPanel(text);
    const first = expectPacked(packKufiPanel({ text, ...size }), text);
    const again = packKufiPanel({ text, ...size, edits: {}, previous: first });
    expectPacked(again, text);
  }, 90000);

  it("Fit stops on a count of sizes under the clock override, so a loaded machine fits Bismillah at 17×19 too", () => {
    const text = "بسم الله الرحمن الرحيم";
    _internal.clearCaches();
    // a clock that races ahead a second on every reading: Fit's 9 s are gone after the tenth reading
    const real = performance.now.bind(performance);
    let skew = 0;
    const spy = vi.spyOn(performance, "now").mockImplementation(() => real() + (skew += 1000));
    try {
      _internal.stats.fitSizes = 0;
      expect(fitKufiPanel(text)).toEqual({ cols: 17, rows: 19 });
      expect(_internal.stats.fitSizes).toBeLessThanOrEqual(_internal.FIT_MAX_SIZES);
    } finally {
      spy.mockRestore();
    }
  }, 90000);
});

// A panel Fit returns is one the editor must be able to work on: packed again cold, repacked
// from itself as a drag preview starts, and pinned letter by letter as a saved panel reloads.
describe("a panel Fit returns survives a repack", () => {
  const cases: Array<[string, number, number]> = [
    ["سبحان الله", 13, 15],
    ["بسم الله الرحمن الرحيم", 17, 19],
    ["قل هو الله أحد", 11, 22],
    ["إن شاء الله", 13, 13],
    ["الله أكبر", 9, 13],
  ];
  for (const [text, cols, rows] of cases)
    it(`«${text}» at ${cols}×${rows}: packed cold, repacked from itself and pinned in place, it is the same panel`, () => {
      _internal.clearCaches();
      expect(fitKufiPanel(text)).toEqual({ cols, rows });
      // Fit's own panel, from its cache
      const fit = expectPacked(packKufiPanel({ text, cols, rows }), text);
      _internal.clearCaches();
      expect(layoutOf(packKufiPanel({ text, cols, rows }))).toEqual(layoutOf(fit));
      expect(layoutOf(packKufiPanel({ text, cols, rows, previous: fit }))).toEqual(layoutOf(fit));
      const pinned = Object.fromEntries(fit.placements.map((p, k) => [k, p]));
      _internal.clearCaches();
      const reloaded = expectPacked(packKufiPanel({ text, cols, rows, edits: { pinned } }), text);
      expect(reloaded.placements).toEqual(fit.placements);
      expect(Array.from(reloaded.cells).join("")).toBe(Array.from(fit.cells).join(""));
    }, 90000);

  it("«إن شاء الله» at 13×13, closed by bars, takes a stretch edit", () => {
    const text = "إن شاء الله";
    const fit = expectPacked(packKufiPanel({ text, cols: 13, rows: 13 }), text);
    expect(fit.quality!.bars).toBeGreaterThan(0);
    let packs = 0;
    for (const [k, p] of fit.placements.entries())
      for (let i = 0; i < p.stretch.length; i++)
        for (const d of [-1, 1]) {
          const stretch = p.stretch.slice();
          stretch[i] += d;
          const r = packKufiPanel({ text, cols: 13, rows: 13, previous: fit, edits: { stretch: { [k]: stretch } } });
          if (r.ok) {
            expectPacked(r, text);
            packs++;
          }
        }
    expect(packs).toBeGreaterThan(0);
  }, 90000);
});

describe("quality", () => {
  it("reports a packed panel's filler, shortening and lengthening", () => {
    const result = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality).toEqual({ squares: 0, bars: 0, cut: expect.any(Number), grow: expect.any(Number) });
    expect(result.quality!.cut).toBeGreaterThanOrEqual(0);
    expect(result.quality!.grow).toBeGreaterThanOrEqual(0);
  });
});
