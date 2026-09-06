import { describe, it, expect } from "vitest";
import {
  layoutSquareKufi,
  cellRings,
  formAscent,
  squareColumnTarget,
  resolveWords,
  applyCellEdits,
  resolveCellOwner,
  cellEditAt,
  upsertCellEdit,
  kufiFormKey,
  KUFI_EDIT_REACH,
  type Ring,
  type KufiCellEdit,
  type KufiPlacement,
  type SquareKufiLayout,
} from "./squareKufi";
import {
  ALL_SKELETONS,
  squareKufiForm,
  skeletonFor,
  SUPPORTED_LETTERS,
  type KufiForm,
} from "./squareKufiAlphabet";
import type { JoiningForm } from "./arabicJoining";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const inkAt = (form: KufiForm, r: number, c: number) => form.rows[r]?.[c] === "#";

/** The row of a form's box that sits on the baseline. */
const baselineRow = (form: KufiForm) => form.rows.length - 1 - form.base;

/** Every filled cell reachable from the first one, moving only orthogonally. */
function connectedCount(form: KufiForm): number {
  const h = form.rows.length;
  const w = form.rows[0].length;
  let start: [number, number] | null = null;
  let total = 0;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (inkAt(form, r, c)) {
        total++;
        start ??= [r, c];
      }
    }
  }
  if (!start) return 0;
  const seen = new Set<string>([start.join(",")]);
  const queue = [start];
  while (queue.length) {
    const [r, c] = queue.pop()!;
    for (const [dr, dc] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nr = r + dr;
      const nc = c + dc;
      const k = `${nr},${nc}`;
      if (!seen.has(k) && inkAt(form, nr, nc)) {
        seen.add(k);
        queue.push([nr, nc]);
      }
    }
  }
  return total === seen.size ? total : -1;
}

const FORMS: JoiningForm[] = ["isolated", "initial", "medial", "final"];

/** Every (skeleton, form) pair the alphabet actually defines. */
function everyForm(): { name: string; form: JoiningForm; glyph: KufiForm }[] {
  const out: { name: string; form: JoiningForm; glyph: KufiForm }[] = [];
  for (const [name, set] of Object.entries(ALL_SKELETONS)) {
    for (const form of FORMS) {
      const glyph = set[form];
      if (glyph) out.push({ name, form, glyph });
    }
  }
  return out;
}

const ascii = (text: string, options = {}) => {
  const l = layoutSquareKufi(text, options);
  const rows: string[] = [];
  for (let y = 0; y < l.rows; y++) {
    let s = "";
    for (let x = 0; x < l.cols; x++) s += l.cells[y * l.cols + x] ? "#" : ".";
    rows.push(s);
  }
  return { layout: l, rows };
};

/**
 * Twice the signed area. In screen coordinates — y growing downward — a
 * visually clockwise ring gives a *positive* shoelace sum, which is the
 * opposite of the usual maths-textbook reading and worth stating rather than
 * re-deriving at each assertion.
 */
function signedArea2(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

// ---------------------------------------------------------------------------
// the alphabet's structural rules
// ---------------------------------------------------------------------------

describe("square-kufi alphabet", () => {
  it("gives every form a rectangular box with ink in it", () => {
    for (const { name, form, glyph } of everyForm()) {
      const width = glyph.rows[0]?.length ?? 0;
      expect(glyph.rows.length, `${name}.${form} has no rows`).toBeGreaterThan(0);
      expect(width, `${name}.${form} has zero width`).toBeGreaterThan(0);
      for (const row of glyph.rows) {
        expect(row.length, `${name}.${form} is ragged`).toBe(width);
        expect(/^[#.]*$/.test(row), `${name}.${form} has a stray character`).toBe(true);
      }
      expect(
        glyph.rows.join("").includes("#"),
        `${name}.${form} is blank`
      ).toBe(true);
    }
  });

  it("draws every letter as one connected stroke", () => {
    // A letterform that falls into two pieces is a letter with a floating
    // fragment on the canvas — there is no second pen lift in square kufi.
    for (const { name, form, glyph } of everyForm()) {
      expect(connectedCount(glyph), `${name}.${form} is not connected`).toBeGreaterThan(0);
    }
  });

  it("keeps every stroke one cell wide", () => {
    // The whole grammar of square kufi is stroke = gap = one unit. A 2x2 block
    // of ink is a stroke drawn double weight, which reads as a blot.
    for (const { name, form, glyph } of everyForm()) {
      for (let r = 0; r + 1 < glyph.rows.length; r++) {
        for (let c = 0; c + 1 < glyph.rows[0].length; c++) {
          const solid =
            inkAt(glyph, r, c) &&
            inkAt(glyph, r, c + 1) &&
            inkAt(glyph, r + 1, c) &&
            inkAt(glyph, r + 1, c + 1);
          expect(solid, `${name}.${form} has a 2x2 block at ${r},${c}`).toBe(false);
        }
      }
    }
  });

  it("puts ink where every join it claims will land", () => {
    // This is the alphabet's contract with the layout: because every join is a
    // run of baseline cells, a form that joins must have ink at the baseline
    // row's own end column, or the bridge arrives at nothing.
    for (const { name, form, glyph } of everyForm()) {
      const joinsRight = form === "final" || form === "medial";
      const joinsLeft = form === "initial" || form === "medial";
      if (!joinsRight && !joinsLeft) continue;
      const br = baselineRow(glyph);
      expect(br, `${name}.${form} baseline row is outside its box`).toBeGreaterThanOrEqual(0);
      expect(br).toBeLessThan(glyph.rows.length);
      const width = glyph.rows[0].length;
      if (joinsRight) {
        expect(inkAt(glyph, br, width - 1), `${name}.${form} has no right join`).toBe(true);
      }
      if (joinsLeft) {
        expect(inkAt(glyph, br, 0), `${name}.${form} has no left join`).toBe(true);
      }
    }
  });

  it("falls back down the joining chain rather than dropping a letter", () => {
    // ر is right-joining, so it has no medial form. Asking for one must still
    // draw something: a hand-edited string is not a reason to lose a letter.
    expect(squareKufiForm("reh", "medial")).not.toBeNull();
    expect(squareKufiForm("reh", "medial")).toBe(squareKufiForm("reh", "final"));
  });

  it("actually draws every letter it claims to map", () => {
    // The table and the layout have to agree, and they reach the alphabet by
    // different routes — the layout goes through arabicJoining's classification
    // first. An entry that classification never yields a form for is dead: it
    // reads as supported here and comes out in `unsupported` on the canvas,
    // which is exactly how ء, ں and ے were once being dropped.
    for (const char of SUPPORTED_LETTERS) {
      expect(skeletonFor(char), `no skeleton for ${char}`).not.toBeNull();
    }
    expect(layoutSquareKufi(SUPPORTED_LETTERS).unsupported).toEqual([]);
  });

  it("draws a non-joining letter as its isolated form", () => {
    // ء has joining type U, so it comes back with no form at all. Reading that
    // as "undrawable" rather than as "isolated" loses the letter silently.
    const l = layoutSquareKufi("ء");
    expect(l.unsupported).toEqual([]);
    expect(l.cells.some(Boolean)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

describe("layoutSquareKufi", () => {
  it("returns an empty grid for text with nothing drawable in it", () => {
    for (const text of ["", "   ", "\n"]) {
      const l = layoutSquareKufi(text);
      expect(l.cols).toBe(0);
      expect(l.rows).toBe(0);
      expect(l.cells).toEqual([]);
    }
  });

  it("sets the first character rightmost", () => {
    // RTL is the whole reason the placement pass walks from the right edge; a
    // regression here reverses the word and still produces a plausible grid.
    const { layout, rows } = ascii("اد");
    const alefColumn = layout.cols - 1;
    // ا is seven cells tall, د three — so only the alef reaches the top row.
    expect(rows[0][alefColumn]).toBe("#");
    expect(rows[0][0]).toBe(".");
  });

  it("bridges a joined pair along the baseline and leaves an unjoined one open", () => {
    // به joins (both letters are dual-joining); اد does not, alef never
    // joining forward. Neither pair has a descender, so the grid's last row is
    // the baseline row in both.
    const joined = ascii("به");
    const open = ascii("اد");
    const baselineOf = (r: string[]) => r[r.length - 1];

    // The joined run's baseline has no gap in it at all — the bridge fills it.
    expect(baselineOf(joined.rows)).not.toContain(".");

    // The unjoined one keeps the letterGap between the two boxes.
    expect(baselineOf(open.rows)).toContain(".");
  });

  it("draws لا as one ligature rather than a lam and an alef", () => {
    const lamAlef = layoutSquareKufi("لا");
    const separate = layoutSquareKufi("لد");
    // The ligature is a single three-wide box; a lam plus another letter is
    // two boxes and a gap, so it cannot be narrower.
    expect(lamAlef.cols).toBe(3);
    expect(separate.cols).toBeGreaterThan(lamAlef.cols);
  });

  it("drops tashkeel silently and reports what it truly cannot draw", () => {
    const withMarks = layoutSquareKufi("بَسْم");
    const plain = layoutSquareKufi("بسم");
    expect(withMarks.unsupported).toEqual([]);
    expect(withMarks.cols).toBe(plain.cols);
    expect(withMarks.rows).toBe(plain.rows);

    const latin = layoutSquareKufi("بA1");
    expect(latin.unsupported).toEqual(["A", "1"]);
  });

  it("aligns every line on one baseline, whatever each line contains", () => {
    // A line of short letters must not float: the ascent is measured over the
    // whole block so a wrapped panel reads as one field, not stacked strips.
    const { layout, rows } = ascii("الف مم", { columns: 8 });
    expect(rows.length).toBe(layout.rows);
    const tall = formAscent(squareKufiForm("alef", "isolated")!);
    // Two lines, each `tall + descent` high, with the line gap between them.
    expect(layout.rows).toBeGreaterThanOrEqual(tall * 2);
  });

  it("wraps to the column limit and keeps every line flush right", () => {
    const wide = layoutSquareKufi("السلام عليكم");
    const wrapped = ascii("السلام عليكم", { columns: 20 });
    expect(wrapped.layout.cols).toBeLessThan(wide.cols);
    expect(wrapped.layout.cols).toBeLessThanOrEqual(20);
    expect(wrapped.layout.rows).toBeGreaterThan(layoutSquareKufi("السلام عليكم").rows);

    // Flush right: some row of every line has ink in the last column.
    const lineCount = 2;
    const lineHeight = wrapped.layout.rows / lineCount;
    for (let line = 0; line < lineCount; line++) {
      const start = Math.floor(line * lineHeight);
      const end = Math.floor((line + 1) * lineHeight);
      const touchesRightEdge = wrapped.rows
        .slice(start, end)
        .some((row) => row[wrapped.layout.cols - 1] === "#");
      expect(touchesRightEdge, `line ${line} is not flush right`).toBe(true);
    }
  });

  it("breaks a word that cannot fit a line, and says that it did", () => {
    const l = layoutSquareKufi("السلام", { columns: 6 });
    expect(l.hardBreaks).toBeGreaterThan(0);
    expect(l.cols).toBeLessThanOrEqual(6);
  });

  it("reports no break when one over-wide letter is all that was left", () => {
    // ط alone cannot fit a two-column limit, so it takes an over-wide line of
    // its own — but nothing was *split*, so no join was lost and the Sidebar
    // must not tell the user to widen the panel to close a break that never
    // happened.
    const l = layoutSquareKufi("ط", { columns: 2 });
    expect(l.rows).toBeGreaterThan(0);
    expect(l.hardBreaks).toBe(0);
  });

  it("keeps a single letter wider than the limit rather than looping forever", () => {
    // ط is six cells wide; a two-column limit cannot hold it, and the honest
    // answer is an overwide line, not an empty grid or a hang.
    const l = layoutSquareKufi("ططط", { columns: 2 });
    expect(l.cols).toBe(6);
    expect(l.rows).toBeGreaterThan(0);
  });
});

describe("squareColumnTarget", () => {
  it("finds a wrap width whose panel is close to square", () => {
    const text = "لا إله إلا الله محمد رسول الله";
    const columns = squareColumnTarget(text);
    const panel = layoutSquareKufi(text, { columns });
    const band = layoutSquareKufi(text);

    // The band is a long strip; the answer must be much closer to square.
    expect(Math.abs(panel.cols / panel.rows - 1)).toBeLessThan(
      Math.abs(band.cols / band.rows - 1)
    );
    expect(panel.cols / panel.rows).toBeGreaterThan(0.5);
    expect(panel.cols / panel.rows).toBeLessThan(2);
  });

  it("answers 0 for text with nothing to lay out", () => {
    expect(squareColumnTarget("")).toBe(0);
  });

  it("fits a long passage to a near-square panel without an exhaustive sweep", () => {
    // The sweep is bounded (COLUMN_SWEEP_BUDGET) because it used to cost a
    // layout per column — seconds of blocked main thread on a passage this
    // long. The bound must not cost the answer: the panel still has to come
    // out close to square.
    const text = "الخط العربي جميل والكتابة فن رفيع في كل زمان ومكان ".repeat(12);
    const columns = squareColumnTarget(text);
    expect(columns).toBeGreaterThan(0);
    const fitted = layoutSquareKufi(text, { columns });
    expect(Math.abs(fitted.cols / fitted.rows - 1)).toBeLessThan(0.1);
  });

  it("never proposes a width narrower than the widest letter", () => {
    // ط is six cells wide; a narrower panel could only be reached by breaking
    // a letter, which the layout will not do.
    expect(squareColumnTarget("ططط ططط")).toBeGreaterThanOrEqual(6);
  });
});

// ---------------------------------------------------------------------------
// outline tracing
// ---------------------------------------------------------------------------

describe("cellRings", () => {
  const grid = (rows: string[]) => ({
    cells: rows.flatMap((r) => Array.from(r, (c) => c === "#")),
    cols: rows[0].length,
    rows: rows.length,
  });

  it("traces one cell as one clockwise square", () => {
    const g = grid(["#"]);
    const rings = cellRings(g.cells, g.cols, g.rows);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
    expect(signedArea2(rings[0])).toBeGreaterThan(0);
  });

  it("collapses a straight run to its corners", () => {
    // Five cells in a row is a rectangle: four points, not twelve.
    const g = grid(["#####"]);
    const rings = cellRings(g.cells, g.cols, g.rows);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(4);
  });

  it("winds a hole against its outer ring", () => {
    // This is what lets the renderer use plain nonzero fill and still get the
    // counter of ه and ص. Same winding on both would fill the hole solid.
    const g = grid(["###", "#.#", "###"]);
    const rings = cellRings(g.cells, g.cols, g.rows);
    expect(rings).toHaveLength(2);
    const areas = rings.map(signedArea2);
    expect(Math.sign(areas[0])).not.toBe(Math.sign(areas[1]));
  });

  it("traces two separated shapes as two rings", () => {
    const g = grid(["#.#"]);
    expect(cellRings(g.cells, g.cols, g.rows)).toHaveLength(2);
  });

  it("traces a real letter's outline without leaving loose ends", () => {
    const l = layoutSquareKufi("الله");
    const rings = cellRings(l.cells, l.cols, l.rows);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      // Every edge is axis-aligned — a cell grid has no diagonals in it.
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        expect(x0 === x1 || y0 === y1).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// hand-painted cells
//
// Note that the four structural assertions at the top of this file are about
// the *authored alphabet*, which a hand edit never passes through. Painted
// cells legitimately break that grammar — a 2×2 block, a floating island — and
// must not be validated against it. That is the point of the feature.
// ---------------------------------------------------------------------------

/** Every unit of a run, by the index a placement and an edit both name. */
function unitsByIndex(text: string) {
  const { words } = resolveWords(text);
  const map = new Map<number, ReturnType<typeof resolveWords>["words"][0][0]>();
  for (const word of words) for (const unit of word) map.set(unit.index, unit);
  return map;
}

const composedAt = (
  g: { cols: number; rows: number; cells: boolean[]; originX: number; originY: number },
  x: number,
  y: number
) => {
  const cx = x - g.originX;
  const cy = y - g.originY;
  if (cx < 0 || cy < 0 || cx >= g.cols || cy >= g.rows) return false;
  return g.cells[cy * g.cols + cx];
};

/** A one-letter stand-in layout, for exercising the tracer over a composition. */
function gridLayout(rows: string[]): SquareKufiLayout {
  const cols = rows[0].length;
  return {
    cols,
    rows: rows.length,
    cells: rows.flatMap((r) => Array.from(r, (c) => c === "#")),
    unsupported: [],
    hardBreaks: 0,
    placements: [
      {
        unitIndex: 0,
        unitKey: "stand-in",
        x: 0,
        y: 0,
        width: cols,
        height: rows.length,
        baselineY: rows.length - 1,
      },
    ],
  };
}

describe("kufi placements", () => {
  it("places every letter where its ink actually landed", () => {
    // The load-bearing one. Placements are emitted from inside the same pass
    // that writes the cells; anything re-deriving them afterwards drifts by a
    // cell or two and still type-checks, and every hand edit then lands beside
    // the letter it was painted onto rather than on it.
    const text = "السلام عليكم ورحمة الله";
    const layout = layoutSquareKufi(text, { columns: 20 }, { placements: true });
    const units = unitsByIndex(text);

    expect(layout.placements.length).toBe(units.size);
    expect(new Set(layout.placements.map((p) => p.unitIndex)).size).toBe(units.size);

    for (const p of layout.placements) {
      const unit = units.get(p.unitIndex)!;
      expect(unit, `no unit for placement ${p.unitIndex}`).toBeTruthy();
      expect(p.unitKey).toBe(kufiFormKey(unit.form));
      expect(p.width).toBe(unit.width);
      expect(p.height).toBe(unit.form.rows.length);

      unit.form.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== "#") continue;
          const x = p.x + c;
          const y = p.y + r;
          expect(
            layout.cells[y * layout.cols + x],
            `unit ${p.unitIndex} has no ink at ${x},${y} (row ${r}, col ${c})`
          ).toBe(true);
        }
      });
    }
  });

  it("costs nothing unless the caller asks", () => {
    expect(layoutSquareKufi("الله").placements).toEqual([]);
    expect(layoutSquareKufi("").placements).toEqual([]);
    expect(layoutSquareKufi("الله", {}, { placements: true }).placements.length).toBe(4);
  });
});

describe("resolveCellOwner", () => {
  const box = (
    unitIndex: number,
    x: number,
    y: number,
    width: number,
    height: number
  ): KufiPlacement => ({
    unitIndex,
    unitKey: `k${unitIndex}`,
    x,
    y,
    width,
    height,
    baselineY: y + height - 1,
  });

  it("gives a cell to the nearest letter, measured to the box and not its centre", () => {
    // A wide letter spanning 0..5 and a one-cell letter at 10. The cell at 7 is
    // two cells from the wide letter's edge and three from the small one, so it
    // belongs to the wide letter — while centre-to-cell would say the opposite
    // (4.5 against 3) and hand it to the letter it is visibly further from.
    const placements = [box(0, 0, 0, 6, 2), box(1, 10, 0, 1, 1)];
    expect(resolveCellOwner(placements, 7, 0)?.unitIndex).toBe(0);
    expect(resolveCellOwner(placements, 9, 0)?.unitIndex).toBe(1);
  });

  it("gives a cell inside a letter's box to that letter", () => {
    const placements = [box(0, 0, 0, 6, 2), box(1, 10, 0, 1, 1)];
    expect(resolveCellOwner(placements, 3, 1)?.unitIndex).toBe(0);
  });

  it("breaks a tie by the lower unit index, not by emission order", () => {
    const placements = [box(3, 4, 0, 1, 1), box(1, 0, 0, 1, 1)];
    // Cell 2 is two cells from each.
    expect(resolveCellOwner(placements, 2, 0)?.unitIndex).toBe(1);
    expect(resolveCellOwner([], 0, 0)).toBeNull();
  });
});

describe("applyCellEdits", () => {
  it("keeps an edit on its letter through a rewrap and a spacing change", () => {
    // The whole point of anchoring to a letter. The same edit is resolved
    // under three layouts whose absolute grids share almost nothing.
    const text = "بسم الله الرحمن الرحيم";
    const configs = [{ columns: 0 }, { columns: 16 }, { columns: 0, wordGap: 6 }];

    const base = layoutSquareKufi(text, configs[0], { placements: true });
    const anchor = base.placements[5];
    // One row above the letter's baseline and one column left of its box.
    const edit: KufiCellEdit = {
      unitIndex: anchor.unitIndex,
      unitKey: anchor.unitKey,
      dx: -1,
      dy: -1,
      on: true,
    };

    const absolute = new Set<string>();
    for (const options of configs) {
      const layout = layoutSquareKufi(text, options, { placements: true });
      const p = layout.placements.find((q) => q.unitIndex === anchor.unitIndex)!;
      const composed = applyCellEdits(layout, [edit]);
      expect(composed.applied).toBe(1);
      expect(composed.dropped).toBe(0);
      expect(composedAt(composed, p.x - 1, p.baselineY - 1)).toBe(true);
      absolute.add(`${p.x - 1},${p.baselineY - 1}`);
    }
    // …and the letter really did move: one anchor, three different grids.
    expect(absolute.size).toBe(configs.length);
  });

  it("drops an edit whose letter now draws a different shape, and counts it", () => {
    const text = "الله";
    const layout = layoutSquareKufi(text, {}, { placements: true });
    const p = layout.placements[0];
    const composed = applyCellEdits(layout, [
      { unitIndex: p.unitIndex, unitKey: "not-this-form", dx: 0, dy: -1, on: true },
    ]);
    expect(composed.applied).toBe(0);
    expect(composed.dropped).toBe(1);
    expect(composed.cells).toEqual(layout.cells);
  });

  it("drops an edit whose letter is gone entirely", () => {
    const layout = layoutSquareKufi("الله", {}, { placements: true });
    const composed = applyCellEdits(layout, [{ unitIndex: 99, dx: 0, dy: 0, on: true }]);
    expect(composed.dropped).toBe(1);
  });

  it("applies an edit that carries no key at all", () => {
    // The glyphId-optionality rule: an edit saved before the fingerprint
    // existed cannot be checked, and dropping it would be worse than applying
    // it to whatever letter now holds its index. A naive "always compare the
    // key" implementation loses exactly these.
    const layout = layoutSquareKufi("الله", {}, { placements: true });
    const p = layout.placements[0];
    const composed = applyCellEdits(layout, [
      { unitIndex: p.unitIndex, dx: -1, dy: -1, on: true },
    ]);
    expect(composed.applied).toBe(1);
    expect(composed.dropped).toBe(0);
    expect(composedAt(composed, p.x - 1, p.baselineY - 1)).toBe(true);
  });

  it("grows the grid around a cell painted outside it, generated ink and all", () => {
    const text = "الله";
    const layout = layoutSquareKufi(text, {}, { placements: true });
    // The leftmost letter — last in logical order, first at the left edge.
    const p = layout.placements.reduce((a, b) => (b.x < a.x ? b : a));
    expect(p.x).toBe(0);
    const dy = -8;
    const composed = applyCellEdits(layout, [
      { unitIndex: p.unitIndex, unitKey: p.unitKey, dx: -2, dy, on: true },
    ]);

    const expectedY = Math.min(0, p.baselineY + dy);
    expect(expectedY).toBeLessThan(0);
    expect(composed.originX).toBe(-2);
    expect(composed.originY).toBe(expectedY);
    expect(composed.cols).toBe(layout.cols + 2);
    expect(composed.rows).toBe(layout.rows - expectedY);

    // Every generated cell still sits where it did relative to its letter…
    for (let y = 0; y < layout.rows; y++) {
      for (let x = 0; x < layout.cols; x++) {
        expect(composedAt(composed, x, y), `generated cell ${x},${y} moved`).toBe(
          layout.cells[y * layout.cols + x]
        );
      }
    }
    // …and the painted one is at its own place in the grown grid.
    expect(composedAt(composed, p.x - 2, p.baselineY + dy)).toBe(true);
  });

  it("refuses an edit that reaches further than a letter's neighbourhood", () => {
    const layout = layoutSquareKufi("الله", {}, { placements: true });
    const p = layout.placements[0];
    const far = applyCellEdits(layout, [
      {
        unitIndex: p.unitIndex,
        unitKey: p.unitKey,
        dx: KUFI_EDIT_REACH + 1,
        dy: 0,
        on: true,
      },
    ]);
    expect(far.applied).toBe(0);
    expect(far.dropped).toBe(1);
    expect(far.cols).toBe(layout.cols);
    expect(far.originX).toBe(0);

    // And it is refused at the point it would be made, too, so a far click
    // paints nothing rather than storing an edit dropped on every render.
    expect(
      cellEditAt(layout.placements, p.x + KUFI_EDIT_REACH + 1, p.baselineY, true)
    ).toBeNull();
    expect(cellEditAt(layout.placements, p.x, p.baselineY, true)).not.toBeNull();
  });

  it("erases a generated cell without moving anything", () => {
    const layout = layoutSquareKufi("الله", {}, { placements: true });
    const p = layout.placements[0];
    const composed = applyCellEdits(layout, [
      { unitIndex: p.unitIndex, unitKey: p.unitKey, dx: 0, dy: 0, on: false },
    ]);
    expect(composed.originX).toBe(0);
    expect(composed.originY).toBe(0);
    expect(composed.cols).toBe(layout.cols);
    expect(composedAt(composed, p.x, p.baselineY)).toBe(false);
    expect(layout.cells[p.baselineY * layout.cols + p.x]).toBe(true);
  });

  it("changes nothing at all when there are no edits", () => {
    const layout = layoutSquareKufi("الله", {}, { placements: true });
    const composed = applyCellEdits(layout, []);
    expect(composed.cells).toBe(layout.cells);
    expect(composed.applied).toBe(0);
    expect(composed.dropped).toBe(0);
  });
});

describe("upsertCellEdit", () => {
  const edit = (dx: number, on: boolean): KufiCellEdit => ({ unitIndex: 1, dx, dy: 0, on });

  it("replaces the edit already on that cell rather than stacking one", () => {
    const list = upsertCellEdit([edit(2, true)], edit(2, false), true);
    expect(list).toEqual([edit(2, false)]);
  });

  it("removes an edit that asks for exactly what the alphabet draws", () => {
    // Paint a cell that is already ink and the entry goes away, rather than
    // being stored as a no-op that grows the array forever as a user paints
    // and unpaints — the zero-is-a-removal rule setStrokeCut follows.
    expect(upsertCellEdit([edit(2, true)], edit(2, true), true)).toEqual([]);
    expect(upsertCellEdit([], edit(2, false), false)).toEqual([]);
  });

  it("leaves other cells' edits alone", () => {
    const list = upsertCellEdit([edit(2, true), edit(5, true)], edit(2, true), true);
    expect(list).toEqual([edit(5, true)]);
  });
});

describe("cellRings over a hand-edited grid", () => {
  it("winds a hole punched by an erase against its outer ring", () => {
    const layout = gridLayout(["###", "###", "###"]);
    const composed = applyCellEdits(layout, [
      { unitIndex: 0, unitKey: "stand-in", dx: 1, dy: -1, on: false },
    ]);
    expect(composedAt(composed, 1, 1)).toBe(false);
    const rings = cellRings(composed.cells, composed.cols, composed.rows);
    expect(rings).toHaveLength(2);
    const areas = rings.map(signedArea2);
    expect(Math.sign(areas[0])).not.toBe(Math.sign(areas[1]));
  });

  it("closes every ring around a paint that only touches ink diagonally", () => {
    // A cell sharing one corner with the letter is a pinch — the branch in the
    // tracer that has to choose between two ways out of a vertex. Nothing
    // stops a user painting one, so it must come out closed and axis-aligned.
    const layout = gridLayout(["##", "##"]);
    const composed = applyCellEdits(layout, [
      { unitIndex: 0, unitKey: "stand-in", dx: 2, dy: -2, on: true },
    ]);
    expect(composed.cols).toBe(3);
    const rings = cellRings(composed.cells, composed.cols, composed.rows);
    expect(rings.length).toBeGreaterThan(0);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[(i + 1) % ring.length];
        expect(x0 === x1 || y0 === y1).toBe(true);
      }
    }
  });
});
