import { describe, it, expect } from "vitest";
import type { JoiningForm } from "../arabicJoining";
import { gridFromRows, inkBlocks2x2, isConnected4 } from "./kufiGrid";
import {
  KUFI_FORMS,
  KUFI_FILLS,
  KUFI_JOINS,
  skeletonOf,
  stretchGlyph,
  stretchedBase,
  joinRow,
  joinCol,
  dotsOf,
  dotKey,
  dotCells,
  attachDotSets,
  type KufiCell,
  type KufiGlyph,
  type KufiStretch,
} from "./kufiAlphabet";

type Entry = { name: string; form: JoiningForm; g: KufiGlyph };

const ENTRIES: Entry[] = Object.entries(KUFI_FORMS).flatMap(([name, forms]) =>
  Object.entries(forms).flatMap(([form, glyphs]) =>
    (glyphs ?? []).map((g) => ({ name, form: form as JoiningForm, g }))
  )
);

const label = (e: Entry) => e.g.id;

/** Number of 4-connected ink components. */
function components(rows: string[]): number {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const seen = new Set<number>();
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (rows[y][x] !== "#" || seen.has(y * w + x)) continue;
      n++;
      const stack: Array<[number, number]> = [[x, y]];
      seen.add(y * w + x);
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || rows[ny][nx] !== "#" || seen.has(ny * w + nx)) continue;
          seen.add(ny * w + nx);
          stack.push([nx, ny]);
        }
      }
    }
  return n;
}

/** `parts` > 1 only for a glyph drawn in separate pieces (the gapped alef of الله). */
function structuralProblems(rows: string[], parts = 1): string[] {
  const out: string[] = [];
  if (rows.length === 0 || rows[0].length === 0) out.push("empty");
  if (rows.some((r) => r.length !== rows[0]?.length)) out.push("not rectangular");
  if (rows.some((r) => /[^#.]/.test(r))) out.push("stray character");
  if (!rows.some((r) => r.includes("#"))) out.push("no ink");
  if (parts === 1 && !isConnected4(rows)) out.push("not 4-connected");
  if (parts > 1 && components(rows) !== parts) out.push(`not ${parts} pieces`);
  if (inkBlocks2x2(gridFromRows(rows)).length > 0) out.push("2x2 ink block");
  return out;
}

const joinsRight = (f: JoiningForm) => f === "final" || f === "medial";
const joinsLeft = (f: JoiningForm) => f === "initial" || f === "medial";

/** Join ink: right join = ink in the rightmost column at its join row, left join likewise at the leftmost. */
function joinProblems(form: JoiningForm, g: KufiGlyph, rows: string[]): string[] {
  const out: string[] = [];
  const w = rows[0].length;
  const rc = joinCol(g, "right", rows);
  const lc = joinCol(g, "left", rows);
  if (rc < 0 || rc >= w || lc < 0 || lc >= w) out.push("join column outside the box");
  if (joinsRight(form) && rows[joinRow(g, "right", rows)]?.[rc] !== "#") out.push("no right-join ink");
  if (joinsLeft(form) && rows[joinRow(g, "left", rows)]?.[lc] !== "#") out.push("no left-join ink");
  if (g.inset?.right && !joinsRight(form)) out.push("right inset on a form that does not join right");
  if (g.inset?.left && !joinsLeft(form)) out.push("left inset on a form that does not join left");
  return out;
}

/** The slice may only cross strokes that run straight through it. */
function sliceIsThroughRunning(rows: string[], s: KufiStretch): boolean {
  const h = rows.length;
  const w = rows[0].length;
  const at = (x: number, y: number) => rows[y][x] === "#";
  let crossed = 0;
  if (s.axis === "col") {
    for (let y = 0; y < h; y++) {
      if (!at(s.index, y)) continue;
      crossed++;
      if (!at(s.index - 1, y) || !at(s.index + 1, y)) return false;
    }
  } else {
    for (let x = 0; x < w; x++) {
      if (!at(x, s.index)) continue;
      crossed++;
      if (!at(x, s.index - 1) || !at(x, s.index + 1)) return false;
    }
  }
  return crossed > 0;
}

describe("KUFI_FORMS: every glyph", () => {
  it("has at least one glyph per listed form", () => {
    for (const [name, forms] of Object.entries(KUFI_FORMS)) {
      for (const [form, glyphs] of Object.entries(forms)) {
        expect(glyphs?.length, `${name}.${form}`).toBeGreaterThan(0);
      }
    }
  });

  it("has a unique id", () => {
    const ids = ENTRIES.map(label);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ENTRIES.map((e) => [label(e), e] as const))(
    "%s is rectangular, non-empty, 4-connected and free of 2x2 ink",
    (_id, e) => {
      expect(structuralProblems(e.g.rows, e.g.parts)).toEqual([]);
    }
  );

  it.each(ENTRIES.map((e) => [label(e), e] as const))("%s keeps ink at its join cells", (_id, e) => {
    expect(joinProblems(e.form, e.g, e.g.rows)).toEqual([]);
  });

  it.each(ENTRIES.map((e) => [label(e), e] as const))("%s has a sane base", (_id, e) => {
    expect(Number.isInteger(e.g.base)).toBe(true);
    expect(e.g.base).toBeGreaterThanOrEqual(0);
    expect(e.g.base).toBeLessThan(e.g.rows.length);
  });

  it.each(ENTRIES.map((e) => [label(e), e] as const))(
    "%s has interior, through-running stretch slices",
    (_id, e) => {
      const h = e.g.rows.length;
      const w = e.g.rows[0].length;
      for (const s of e.g.stretch) {
        const len = s.axis === "col" ? w : h;
        expect(s.index, `${s.axis} ${s.index}`).toBeGreaterThan(0);
        expect(s.index, `${s.axis} ${s.index}`).toBeLessThan(len - 1);
        expect(sliceIsThroughRunning(e.g.rows, s), `${s.axis} ${s.index}`).toBe(true);
        // A column slice sits between the join stubs, so an inset keeps its distance from the edge.
        if (s.axis === "col") {
          expect(s.index, "slice inside the right inset").toBeLessThan(w - 1 - (e.g.inset?.right ?? 0));
          expect(s.index, "slice inside the left inset").toBeGreaterThan(e.g.inset?.left ?? 0);
        }
      }
    }
  );

  it.each(ENTRIES.map((e) => [label(e), e] as const))("%s loses exactly `min` copies of each slice", (_id, e) => {
    e.g.stretch.forEach((s, i) => {
      const min = s.min ?? 0;
      expect(Number.isInteger(min) && min >= 0, `min ${min}`).toBe(true);
      const counts = e.g.stretch.map((_, j) => (j === i ? -min : 0));
      const rows = stretchGlyph(e.g, counts);
      const h = e.g.rows.length;
      const w = e.g.rows[0].length;
      expect(rows.length, `${s.axis} ${s.index}`).toBe(s.axis === "row" ? h - min : h);
      expect(rows[0].length, `${s.axis} ${s.index}`).toBe(s.axis === "col" ? w - min : w);
    });
  });

  it.each(ENTRIES.map((e) => [label(e), e] as const))(
    "%s still passes every check shortened to its minimum",
    (_id, e) => {
      const counts = e.g.stretch.map((s) => -(s.min ?? 0));
      const rows = stretchGlyph(e.g, counts);
      expect(structuralProblems(rows, e.g.parts)).toEqual([]);
      expect(joinProblems(e.form, stretchedJoins(e.g, counts), rows)).toEqual([]);
      expect(stretchedBase(e.g, counts)).toBeGreaterThanOrEqual(0);
      expect(stretchedBase(e.g, counts)).toBeLessThan(rows.length);
    }
  );

  it.each(ENTRIES.map((e) => [label(e), e] as const))(
    "%s still passes every check stretched by 1 and by 3",
    (_id, e) => {
      for (const n of [1, 3]) {
        const counts = e.g.stretch.map(() => n);
        const rows = stretchGlyph(e.g, counts);
        expect(structuralProblems(rows, e.g.parts), `x${n}`).toEqual([]);
        expect(joinProblems(e.form, stretchedJoins(e.g, counts), rows), `x${n}`).toEqual([]);
      }
    }
  );
});

/** The glyph as it stands after stretching: a join row moves down by every row repeated above it. */
function stretchedJoins(g: KufiGlyph, counts: number[]): KufiGlyph {
  const shift = (row: number) =>
    g.stretch.reduce(
      (acc, s, i) => (s.axis === "row" && s.index < row ? acc + Math.max(-(s.min ?? 0), counts[i] ?? 0) : acc),
      0
    );
  const right = joinRow(g, "right", g.rows);
  const left = joinRow(g, "left", g.rows);
  return {
    ...g,
    base: stretchedBase(g, counts),
    joins: { right: right + shift(right), left: left + shift(left) },
  };
}

describe("stretchGlyph", () => {
  const g: KufiGlyph = {
    id: "t",
    rows: ["#...#", "#...#", "#####"],
    base: 0,
    stretch: [{ axis: "col", index: 2 }],
  };

  it("repeats the marked column", () => {
    expect(stretchGlyph(g, [2])).toEqual(["#.....#", "#.....#", "#######"]);
  });

  it("is the identity for zero or missing counts", () => {
    expect(stretchGlyph(g, [0])).toEqual(g.rows);
    expect(stretchGlyph(g, [])).toEqual(g.rows);
  });

  it("grows base only for rows repeated below the baseline", () => {
    const bowl: KufiGlyph = {
      id: "n",
      rows: ["#.#", "#.#", "#.#", "###"],
      base: 2,
      stretch: [{ axis: "row", index: 2 }],
    };
    expect(stretchedBase(bowl, [3])).toBe(5);
    expect(stretchedBase(g, [3])).toBe(0);
    const stem: KufiGlyph = { id: "s", rows: ["#", "#", "#"], base: 0, stretch: [{ axis: "row", index: 1 }] };
    expect(stretchedBase(stem, [2])).toBe(0);
  });

  it("treats negative counts as zero when the slice has no minimum", () => {
    expect(stretchGlyph(g, [-2])).toEqual(g.rows);
    expect(stretchedBase(g, [-2])).toBe(0);
  });

  it("removes copies of a slice down to its minimum, and no further", () => {
    const stem: KufiGlyph = {
      id: "m",
      rows: [".#.", ".#.", ".#.", ".#.", "###"],
      base: 0,
      stretch: [{ axis: "row", index: 1, min: 2 }],
    };
    expect(stretchGlyph(stem, [-1])).toEqual([".#.", ".#.", ".#.", "###"]);
    expect(stretchGlyph(stem, [-2])).toEqual([".#.", ".#.", "###"]);
    expect(stretchGlyph(stem, [-5])).toEqual([".#.", ".#.", "###"]);
    expect(stretchGlyph(stem, [2])).toEqual([".#.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"]);
  });

  it("removes a column slice", () => {
    const wide: KufiGlyph = {
      id: "w",
      rows: ["#....#", "######"],
      base: 0,
      stretch: [{ axis: "col", index: 2, min: 3 }],
    };
    expect(stretchGlyph(wide, [-3])).toEqual(["#.#", "###"]);
  });

  it("raises the box when a row below the baseline is removed", () => {
    const bowl: KufiGlyph = {
      id: "n",
      rows: ["#.#", "#.#", "#.#", "#.#", "###"],
      base: 4,
      stretch: [{ axis: "row", index: 2, min: 2 }],
    };
    expect(stretchedBase(bowl, [-2])).toBe(2);
    expect(stretchedBase(bowl, [-9])).toBe(2);
    expect(stretchGlyph(bowl, [-2])).toEqual(["#.#", "#.#", "###"]);
  });

  it("never removes the baseline row or a row across it", () => {
    // Rows 0-3 are identical, but row 1 is the baseline: the slice below it may only lose rows 2-3.
    const bowl: KufiGlyph = {
      id: "n2",
      rows: ["#.#", "#.#", "#.#", "#.#", "###"],
      base: 3,
      stretch: [{ axis: "row", index: 2, min: 3 }],
    };
    expect(stretchGlyph(bowl, [-3])).toEqual(["#.#", "#.#", "###"]);
    expect(stretchedBase(bowl, [-3])).toBe(1);
  });

  it("lets a lift standing on the line lose rows down to the line", () => {
    const lift: KufiGlyph = {
      id: "l",
      rows: ["..#", "###", "#..", "#.."],
      base: 0,
      stretch: [{ axis: "row", index: 2, min: 1 }],
    };
    expect(stretchGlyph(lift, [-1])).toEqual(["..#", "###", "#.."]);
    expect(stretchedBase(lift, [-1])).toBe(0);
  });

  it("repeats a marked row", () => {
    const tall: KufiGlyph = { id: "r", rows: ["#", "#", "#"], base: 0, stretch: [{ axis: "row", index: 1 }] };
    expect(stretchGlyph(tall, [2])).toEqual(["#", "#", "#", "#", "#"]);
  });

  it("applies a row and a column stretch together", () => {
    const both: KufiGlyph = {
      id: "b",
      rows: [".#...", ".#...", ".###.", ".#.#.", "#####"],
      base: 0,
      stretch: [
        { axis: "col", index: 2 },
        { axis: "row", index: 1 },
      ],
    };
    expect(stretchGlyph(both, [1, 1])).toEqual([
      ".#....",
      ".#....",
      ".#....",
      ".####.",
      ".#..#.",
      "######",
    ]);
  });
});

describe("KUFI_FORMS: coverage", () => {
  it("has the two ligatures", () => {
    expect(KUFI_FORMS.lamAlef.isolated?.length).toBeGreaterThan(0);
    expect(KUFI_FORMS.lamAlef.final?.length).toBeGreaterThan(0);
    expect(KUFI_FORMS.allah.isolated?.length).toBeGreaterThan(0);
  });

  it.each(["heh", "kaf", "lamAlef"] as const)("%s has alternates in some form", (name) => {
    const most = Math.max(...Object.values(KUFI_FORMS[name]).map((gs) => gs?.length ?? 0));
    expect(most).toBeGreaterThanOrEqual(2);
  });

  it("every skeleton has an isolated form", () => {
    for (const [name, forms] of Object.entries(KUFI_FORMS)) {
      expect(forms.isolated?.length, name).toBeGreaterThan(0);
    }
  });

  it("dual-joining skeletons have all four forms", () => {
    const dual = ["beh", "noon", "yeh", "jeem", "seen", "sad", "tah", "ain", "feh", "qaf", "kaf", "lam", "meem", "heh"] as const;
    for (const name of dual) {
      for (const form of ["isolated", "initial", "medial", "final"] as const) {
        expect(KUFI_FORMS[name][form]?.length, `${name}.${form}`).toBeGreaterThan(0);
      }
    }
  });

  it("right-joining skeletons have only isolated and final", () => {
    for (const name of ["alef", "dal", "reh", "waw", "lamAlef"] as const) {
      expect(Object.keys(KUFI_FORMS[name]).sort(), name).toEqual(["final", "isolated"]);
    }
  });
});

const BY_ID = new Map(ENTRIES.map((e) => [e.g.id, e.g]));
const glyphById = (id: string): KufiGlyph => {
  const g = BY_ID.get(id);
  if (!g) throw new Error(`no glyph ${id}`);
  return g;
};

describe("KUFI_FORMS: pieces read off the reference panel", () => {
  it("lams and the tall alefs shorten to the 5-row band depth", () => {
    for (const id of ["lam.initial.0", "lam.medial.0", "lam.isolated.1", "lam.final.2", "alef.isolated.0", "alef.final.0"]) {
      const g = glyphById(id);
      const counts = g.stretch.map((s) => -(s.min ?? 0));
      const rows = stretchGlyph(g, counts);
      expect(rows.length - stretchedBase(g, counts), id).toBe(5);
    }
    expect(stretchGlyph(glyphById("lam.medial.0"), [-2])).toEqual([".#.", ".#.", ".#.", ".#.", "###"]);
  });

  it("has the lifted tooth: two rows up, stepping down to the line at its join", () => {
    for (const sk of ["beh", "noon", "yeh"] as const) {
      const g = KUFI_FORMS[sk].initial?.find((x) => x.rows.join("/") === "....#/....#/#####/#..../#....");
      expect(g, sk).toBeDefined();
      expect(joinRow(g!, "left")).toBe(4);
    }
  });

  it("has a narrow medial kaf, and one whose top bar reaches over the letter before it", () => {
    const g = glyphById("kaf.medial.2");
    expect(g.rows).toEqual([".#######", ".#......", ".###....", "...#....", "######.."]);
    expect(g.inset).toEqual({ right: 2 });
    expect(joinCol(g, "right")).toBe(5);
    expect(joinCol(g, "left")).toBe(0);
    expect(glyphById("kaf.medial.1").rows).toEqual([".###.", ".#...", ".###.", "...#.", "#####"]);
  });

  it("has a final feh with a full-height end stroke", () => {
    const g = glyphById("feh.final.3");
    expect(g.rows).toEqual(["#.###.", "#.#.#.", "#.###.", "#...#.", "######"]);
    expect(g.base).toBe(0);
  });

  it("has a medial heh joined at its top", () => {
    const g = glyphById("heh.medial.2");
    expect(g.rows).toEqual([".####", ".#.#.", ".###.", ".#.#.", "####."]);
    expect(joinRow(g, "right")).toBe(0);
    expect(joinRow(g, "left")).toBe(4);
  });

  it("has a hooked initial noon whose head bends over its dot", () => {
    expect(glyphById("noon.initial.2").rows).toEqual(["###", "..#", "..#", "..#", "###"]);
  });

  it("has the الله form with the gapped alef, in three pieces", () => {
    const g = glyphById("allah.isolated.2");
    expect(g.rows).toEqual(["###.#.#.#", "..#.#.#..", "###.#.#.#", "#.#.#.#.#", "#######.#"]);
    expect(g.parts).toBe(3);
  });

  it("only the gapped الله and the الله under its bar are drawn in more than one piece", () => {
    expect(ENTRIES.filter((e) => (e.g.parts ?? 1) !== 1).map(label)).toEqual(["allah.isolated.2", "allah.isolated.4"]);
  });

  it("has a الله of three uprights, the heh on the second lam, and the same under its bar", () => {
    const g = glyphById("allah.isolated.3");
    expect(g.rows).toEqual(["###.#.#", "..#.#.#", "###.#.#", "#.#.#.#", "#######"]);
    expect(g.parts).toBeUndefined();
    expect(glyphById("allah.isolated.4").rows).toEqual(["#######", ".......", ...g.rows]);
    expect(glyphById("allah.isolated.4").parts).toBe(2);
  });

  it("joinCol defaults to the outermost column", () => {
    const g = glyphById("lam.medial.0");
    expect(joinCol(g, "right")).toBe(2);
    expect(joinCol(g, "left")).toBe(0);
  });
});

describe("KUFI_FILLS", () => {
  it("has only the lone square: dots are iʿjām, never filler", () => {
    expect(KUFI_FILLS.map((f) => f.id)).toEqual(["fill.square"]);
    expect(KUFI_FILLS[0].rows).toEqual(["#"]);
    expect(KUFI_FILLS[0].beside).toBe("any");
  });
});

describe("attachDotSets", () => {
  it("throws on a dot-set id that matches no glyph", () => {
    expect(() => attachDotSets({ "beh.isolated.99": { below1: [[4, 2]] } })).toThrow(/beh\.isolated\.99/);
  });

  it("attaches a known id", () => {
    const glyph = KUFI_FORMS.beh.isolated![0];
    const before = glyph.dots;
    try {
      attachDotSets({ "beh.isolated.0": { below1: [[4, 2]] } });
      expect(glyph.dots?.below1).toEqual([{ row: 4, col: 2 }]);
    } finally {
      glyph.dots = before;
    }
  });
});

describe("KUFI_JOINS", () => {
  it("has the join that turns back on itself", () => {
    const j = KUFI_JOINS.find((x) => x.id === "join.uturn.0");
    expect(j).toBeDefined();
    expect(j!.rows).toEqual(["##", "#.", "#.", "#.", "#.", "#.", "##"]);
    expect(j!.turn).toBe(180);
    expect(j!.from).toEqual([6, 1]);
    expect(j!.to).toEqual([0, 1]);
  });

  it.each(KUFI_JOINS.map((j) => [j.id, j] as const))(
    "%s stays valid stretched by 1 and 3 and shortened to its minimum",
    (_id, j) => {
      const asGlyph: KufiGlyph = { id: j.id, rows: j.rows, base: 0, stretch: j.stretch };
      for (const s of j.stretch) expect(sliceIsThroughRunning(j.rows, s)).toBe(true);
      expect(j.from[0]).toBe(j.rows.length - 1);
      expect(j.to[0]).toBe(0);
      const cases = [j.stretch.map(() => 1), j.stretch.map(() => 3), j.stretch.map((s) => -(s.min ?? 0)), []];
      for (const counts of cases) {
        const rows = stretchGlyph(asGlyph, counts);
        expect(structuralProblems(rows), counts.join()).toEqual([]);
        expect(rows[rows.length - 1][j.from[1]], `from ${counts.join()}`).toBe("#");
        expect(rows[0][j.to[1]], `to ${counts.join()}`).toBe("#");
      }
    }
  );
});

describe("skeletonOf", () => {
  it("shares one skeleton between letters that differ only by dots", () => {
    expect(skeletonOf(0x0628)).toBe(skeletonOf(0x062a));
    expect(skeletonOf(0x0628)).toBe("beh");
    expect(skeletonOf(0x062c)).toBe(skeletonOf(0x062e));
    expect(skeletonOf(0x0633)).toBe(skeletonOf(0x0634));
  });

  it("maps the alef family, teh marbuta and alef maksura", () => {
    for (const cp of [0x0627, 0x0622, 0x0623, 0x0625]) expect(skeletonOf(cp)).toBe("alef");
    expect(skeletonOf(0x0629)).toBe("heh");
    expect(skeletonOf(0x0649)).toBe("yeh");
    expect(skeletonOf(0x0646)).toBe("noon");
    expect(skeletonOf(0x0621)).toBe("hamza");
  });

  it("maps the Persian and Urdu extensions onto their Arabic letter", () => {
    expect(skeletonOf(0x067e)).toBe("beh");
    expect(skeletonOf(0x06af)).toBe("kaf");
    expect(skeletonOf(0x06cc)).toBe("yeh");
  });

  it("returns null for non-letters, harakat and tatweel", () => {
    expect(skeletonOf(0x0041)).toBeNull();
    expect(skeletonOf(0x064e)).toBeNull();
    expect(skeletonOf(0x0640)).toBeNull();
    expect(skeletonOf(0x0020)).toBeNull();
  });

  it("every skeleton it returns is in KUFI_FORMS", () => {
    for (let cp = 0x0600; cp <= 0x06ff; cp++) {
      const s = skeletonOf(cp);
      if (s) expect(KUFI_FORMS[s], s).toBeDefined();
    }
  });
});

/* ------------------------------------------------------------------ */
/* Dots (iʿjām) and the packer's alternates                            */
/* ------------------------------------------------------------------ */

/** Every dotted letter, with the count and side it needs. */
const DOTTED: Array<[char: string, count: 1 | 2 | 3, side: "above" | "below"]> = [
  ["ب", 1, "below"],
  ["ت", 2, "above"],
  ["ث", 3, "above"],
  ["ج", 1, "below"],
  ["خ", 1, "above"],
  ["ذ", 1, "above"],
  ["ز", 1, "above"],
  ["ش", 3, "above"],
  ["ض", 1, "above"],
  ["ظ", 1, "above"],
  ["غ", 1, "above"],
  ["ف", 1, "above"],
  ["ق", 2, "above"],
  ["ن", 1, "above"],
  ["ي", 2, "below"],
  ["ة", 2, "above"],
  ["پ", 3, "below"],
  ["چ", 3, "below"],
  ["ژ", 3, "above"],
];

/** Letters that only ever take their isolated and final forms. */
const RIGHT_JOINING_DOTTED = new Set(["ذ", "ز", "ة", "ژ"]);

const FORMS_ALL: JoiningForm[] = ["isolated", "initial", "medial", "final"];

/** Every (letter, form, glyph) a dotted letter can be drawn with. */
const DOTTED_CASES = DOTTED.flatMap(([ch, count, side]) => {
  const sk = skeletonOf(ch.codePointAt(0)!)!;
  const forms = RIGHT_JOINING_DOTTED.has(ch) ? (["isolated", "final"] as JoiningForm[]) : FORMS_ALL;
  return forms.flatMap((form) =>
    (KUFI_FORMS[sk][form] ?? []).map((g) => ({ ch, form, g, count, side, name: `${ch} ${g.id}` }))
  );
});

const inkSet = (rows: string[]) => {
  const s = new Set<string>();
  rows.forEach((r, y) => [...r].forEach((c, x) => c === "#" && s.add(`${y},${x}`)));
  return s;
};

/** Problems with a dot set against its glyph's rows (`baseRow` = the baseline row, top = 0). */
function dotProblems(rows: string[], baseRow: number, dots: KufiCell[], count: number, side: "above" | "below"): string[] {
  const out: string[] = [];
  const ink = inkSet(rows);
  if (dots.length !== count) out.push(`count ${dots.length}, wants ${count}`);
  if (dots.length === 0) return out;
  for (const d of dots) {
    if (!Number.isInteger(d.row) || !Number.isInteger(d.col)) out.push(`non-integer dot ${d.row},${d.col}`);
    if (ink.has(`${d.row},${d.col}`)) out.push(`dot on ink ${d.row},${d.col}`);
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
      if (ink.has(`${d.row + dr},${d.col + dc}`)) out.push(`dot 4-adjacent to ink ${d.row},${d.col}`);
    // One gap clear all round, as a real panel draws them: no ink even diagonally.
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if ((dr || dc) && ink.has(`${d.row + dr},${d.col + dc}`)) out.push(`dot touches ink diagonally ${d.row},${d.col}`);
  }
  // Dots of a set are one empty cell apart: no two touch, even diagonally.
  for (let i = 0; i < dots.length; i++)
    for (let j = i + 1; j < dots.length; j++)
      if (Math.max(Math.abs(dots[i].row - dots[j].row), Math.abs(dots[i].col - dots[j].col)) < 2)
        out.push(`dots touch ${i},${j}`);
  // The shape of the set: a pair side by side; three as a pair with a third centred beyond it.
  const nearRow = side === "above" ? Math.max(...dots.map((d) => d.row)) : Math.min(...dots.map((d) => d.row));
  const near = dots.filter((d) => d.row === nearRow).sort((a, b) => a.col - b.col);
  if (count === 2 && !(near.length === 2 && near[1].col - near[0].col === 2)) out.push("pair is not side by side, one gap apart");
  if (count === 3) {
    const far = dots.find((d) => d.row !== nearRow);
    const farRow = side === "above" ? nearRow - 2 : nearRow + 2;
    if (!(near.length === 2 && near[1].col - near[0].col === 2 && far && far.row === farRow && far.col === near[0].col + 1))
      out.push("three dots are not a pair with a centred third beyond it");
  }
  // The side: every dot on its side of the baseline, with the letter's ink on the far side of it.
  const minC = Math.min(...dots.map((d) => d.col)) - 1;
  const maxC = Math.max(...dots.map((d) => d.col)) + 1;
  const inSpan = [...ink].map((k) => k.split(",").map(Number)).filter(([, c]) => c >= minC && c <= maxC);
  if (side === "above") {
    if (dots.some((d) => d.row >= baseRow)) out.push("an above dot sits on or below the baseline");
    if (!inSpan.some(([r]) => r > nearRow)) out.push("no letter ink under the above dots");
  } else {
    if (dots.some((d) => d.row < baseRow)) out.push("a below dot sits above the baseline");
    if (!inSpan.some(([r]) => r < nearRow)) out.push("no letter ink over the below dots");
  }
  // Glyph and dots together: still no solid 2x2 anywhere.
  const all = new Set([...ink, ...dots.map((d) => `${d.row},${d.col}`)]);
  for (const k of all) {
    const [r, c] = k.split(",").map(Number);
    if (all.has(`${r},${c + 1}`) && all.has(`${r + 1},${c}`) && all.has(`${r + 1},${c + 1}`)) out.push(`2x2 with dots at ${r},${c}`);
  }
  return out;
}

describe("dotsOf", () => {
  it.each(DOTTED)("%s has %i dot(s) %s", (ch, count, side) => {
    expect(dotsOf(ch, "medial")).toEqual({ count, side });
    expect(dotsOf(ch, "isolated")).toEqual({ count, side });
  });

  it("gives undotted letters no dots", () => {
    for (const ch of "ءآأإاحدرسصطعكلمهوىئؤٹڈڑکگ") expect(dotsOf(ch), ch).toBeNull();
  });

  it("dots the Persian yeh only where it joins forward", () => {
    expect(dotsOf("ی", "initial")).toEqual({ count: 2, side: "below" });
    expect(dotsOf("ی", "medial")).toEqual({ count: 2, side: "below" });
    expect(dotsOf("ی", "final")).toBeNull();
    expect(dotsOf("ی", "isolated")).toBeNull();
    expect(dotsOf("ی")).toBeNull();
  });

  it("returns null for non-letters", () => {
    expect(dotsOf("A")).toBeNull();
    expect(dotsOf(" ")).toBeNull();
    expect(dotsOf("")).toBeNull();
  });

  it("names a set by side and count", () => {
    expect(dotKey({ count: 2, side: "above" })).toBe("above2");
    expect(dotKey({ count: 1, side: "below" })).toBe("below1");
  });
});

describe("KufiGlyph.dots", () => {
  it("covers every form of every dotted letter", () => {
    expect(DOTTED_CASES.length).toBeGreaterThan(100);
  });

  it.each(DOTTED_CASES.map((c) => [c.name, c] as const))(
    "%s: its dots have the count and side the letter needs, one gap clear of the letter",
    (_n, c) => {
      const dots = dotCells(c.g, c.ch, c.form);
      expect(dotProblems(c.g.rows, c.g.rows.length - 1 - c.g.base, dots, c.count, c.side)).toEqual([]);
    }
  );

  it.each(DOTTED_CASES.map((c) => [c.name, c] as const))(
    "%s: its dots stay valid with the glyph stretched by 1 and 3 and shortened to its minimum",
    (_n, c) => {
      const cases = [c.g.stretch.map(() => 1), c.g.stretch.map(() => 3), c.g.stretch.map((s) => -(s.min ?? 0))];
      for (const counts of cases) {
        const rows = stretchGlyph(c.g, counts);
        const dots = dotCells(c.g, c.ch, c.form, counts);
        const baseRow = rows.length - 1 - stretchedBase(c.g, counts);
        expect(dotProblems(rows, baseRow, dots, c.count, c.side), counts.join()).toEqual([]);
      }
    }
  );

  it("a glyph carries exactly the dot sets its letters need, and no others", () => {
    const need = new Map<string, Set<string>>();
    for (const c of DOTTED_CASES) {
      if (!need.has(c.g.id)) need.set(c.g.id, new Set());
      need.get(c.g.id)!.add(dotKey({ count: c.count, side: c.side }));
    }
    for (const e of ENTRIES) {
      expect(Object.keys(e.g.dots ?? {}).sort(), e.g.id).toEqual([...(need.get(e.g.id) ?? [])].sort());
    }
  });

  it("gives an undotted letter no cells", () => {
    expect(dotCells(glyphById("beh.medial.0"), "ٹ", "medial")).toEqual([]);
    expect(dotCells(glyphById("jeem.medial.0"), "ح", "medial")).toEqual([]);
    expect(dotCells(glyphById("yeh.final.0"), "ى", "final")).toEqual([]);
    expect(dotCells(glyphById("yeh.final.0"), "ی", "final")).toEqual([]);
  });

  it("dots the Persian yeh's joining forms like ي", () => {
    const g = glyphById("yeh.medial.0");
    expect(dotCells(g, "ی", "medial")).toEqual(dotCells(g, "ي", "medial"));
  });

  it("sits the lifted yeh's pair under its raised bar, as the reference panel does", () => {
    expect(dotCells(glyphById("yeh.initial.1"), "ي", "initial")).toEqual([
      { row: 4, col: 2 },
      { row: 4, col: 4 },
    ]);
  });

  it("sits the hooked noon's dot inside its hook, as the reference panel does", () => {
    expect(dotCells(glyphById("noon.initial.2"), "ن", "initial")).toEqual([{ row: 2, col: 0 }]);
  });

  it("keeps a pair rigid when the glyph stretches between its dots", () => {
    const g = glyphById("beh.isolated.0");
    const a = dotCells(g, "ت", "isolated");
    const b = dotCells(g, "ت", "isolated", [4]);
    expect(b[1].col - b[0].col).toBe(a[1].col - a[0].col);
  });
});

describe("the packer's alternates", () => {
  it("every الله form widens sideways at a column slice", () => {
    for (const g of KUFI_FORMS.allah.isolated ?? []) {
      expect(g.stretch.some((s) => s.axis === "col"), g.id).toBe(true);
      const i = g.stretch.findIndex((s) => s.axis === "col");
      const counts = g.stretch.map((_, j) => (j === i ? 3 : 0));
      expect(stretchGlyph(g, counts)[0].length, g.id).toBe(g.rows[0].length + 3);
    }
  });

  it("has a join that turns the line a quarter turn", () => {
    const j = KUFI_JOINS.find((x) => x.turn === 90);
    expect(j).toBeDefined();
    expect(j!.id).toBe("join.turn90.0");
  });

  it.each(["beh", "noon", "yeh", "lam", "ain"] as const)("%s has a medial entered at its top, for the U-turn", (sk) => {
    const top = (KUFI_FORMS[sk].medial ?? []).filter((g) => joinRow(g, "right") === 0);
    expect(top.length).toBeGreaterThan(0);
    for (const g of top) {
      // The left join stays on the line, and nothing but the top stub reaches the right column.
      expect(joinRow(g, "left")).toBe(g.rows.length - 1 - g.base);
      const right = g.rows.map((r) => r[r.length - 1]).join("");
      expect(right, g.id).toBe("#" + ".".repeat(g.rows.length - 1));
    }
  });

  /** The body stands two rows up and one stroke steps down to the line at the joining side. */
  const lifted = (g: KufiGlyph, side: "right" | "left") => {
    const b = g.rows.length - 1 - g.base;
    const c = joinCol(g, side);
    const only = (r: string) => [...r].every((ch, x) => (x === c ? ch === "#" : ch === "."));
    return joinRow(g, side) === b && only(g.rows[b]) && only(g.rows[b - 1]) && g.rows[b - 2].replace(/\./g, "").length > 1;
  };

  it.each(["seen", "sad", "jeem", "ain", "meem", "beh"] as const)("%s has a lifted initial", (sk) => {
    expect((KUFI_FORMS[sk].initial ?? []).some((g) => lifted(g, "left"))).toBe(true);
  });

  it.each(["beh", "dal", "reh"] as const)("%s has a lifted final", (sk) => {
    expect((KUFI_FORMS[sk].final ?? []).some((g) => lifted(g, "right"))).toBe(true);
  });
});
