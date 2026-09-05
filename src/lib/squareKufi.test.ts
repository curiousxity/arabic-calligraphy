import { describe, it, expect } from "vitest";
import {
  layoutSquareKufi,
  cellRings,
  formAscent,
  squareColumnTarget,
  type Ring,
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
