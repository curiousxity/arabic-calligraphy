import { describe, expect, it } from "vitest";
import { KUFI_FORMS, dotCells, dotsOf, stretchGlyph, stretchedBase, type KufiGlyph } from "./kufiAlphabet";
import { emptyBlocks2x2, inkBlocks2x2, rotateRows, type Turn } from "./kufiGrid";
import { resolveKufiText, type KufiUnit } from "./kufiWords";
import {
  fitKufiPanel,
  packKufiPanel,
  reconcileEdits,
  _internal,
  type KufiPackResult,
  type KufiPlacement,
} from "./kufiPack";

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
function expectDotsAreLetters(r: Ok, text: string, units: KufiUnit[]) {
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
  for (const i of lone) {
    if (dotOf.has(i)) continue;
    expect(zone.has(i), `the lone square at r${(i / cols) | 0}c${i % cols} would read as a dot`).toBe(false);
  }
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
    else expect(r.suggestions.every((s) => packKufiPanel({ text: SHAHADA, ...s }).ok)).toBe(true);
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

describe("budgets", () => {
  it("a first draft runs within 2000 ms and a repack with previous within 200 ms", () => {
    _internal.clearCaches();
    let t = performance.now();
    const r = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21 });
    expect(performance.now() - t).toBeLessThan(2000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    t = performance.now();
    const again = packKufiPanel({ text: BAQARAH, cols: 21, rows: 21, previous: r, edits: { stretch: { 2: [1] } } });
    expect(performance.now() - t).toBeLessThan(200);
    expect(again.ok).toBe(true);
  }, 20000);

  it("300-char text returns within budget", () => {
    let text = BAQARAH;
    while (text.length <= 300) text += " " + BAQARAH;
    const size = fitKufiPanel(text);
    _internal.clearCaches();
    const t = performance.now();
    packKufiPanel({ text, ...size });
    expect(performance.now() - t).toBeLessThan(2000);
  }, 60000);
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
    const kept = reconcileEdits(edits, after);
    expect(Object.keys(kept.pinned ?? {})).toEqual(["0"]);
    expect(kept.cells?.map((e) => e.unitIndex)).toEqual([0]);
    expect(kept.stretch).toEqual({});
  }, 20000);
});

describe("fitKufiPanel", () => {
  it("returns a size that packs", () => {
    for (const text of [BAQARAH, ALLAH]) {
      const size = fitKufiPanel(text);
      expectPacked(packKufiPanel({ text, ...size }), text);
    }
  }, 30000);
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
