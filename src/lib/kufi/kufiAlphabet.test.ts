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

  it("only the gapped الله is drawn in more than one piece", () => {
    expect(ENTRIES.filter((e) => (e.g.parts ?? 1) !== 1).map(label)).toEqual(["allah.isolated.2"]);
  });

  it("joinCol defaults to the outermost column", () => {
    const g = glyphById("lam.medial.0");
    expect(joinCol(g, "right")).toBe(2);
    expect(joinCol(g, "left")).toBe(0);
  });
});

describe("KUFI_FILLS", () => {
  it("has the lone square, the single dot and the dot pair", () => {
    expect(KUFI_FILLS.map((f) => f.id).sort()).toEqual(["fill.dot", "fill.dots2", "fill.square"]);
  });

  it.each(KUFI_FILLS.map((f) => [f.id, f] as const))("%s is 1-2 cells, rectangular and free of 2x2 ink", (_id, f) => {
    const ink = f.rows.join("").split("").filter((c) => c === "#").length;
    expect(ink).toBeGreaterThanOrEqual(1);
    expect(ink).toBeLessThanOrEqual(2);
    expect(f.rows.every((r) => r.length === f.rows[0].length && /^[#.]+$/.test(r))).toBe(true);
    expect(inkBlocks2x2(gridFromRows(f.rows))).toEqual([]);
    // The box is tight: ink in its first and last column.
    expect(f.rows.some((r) => r.startsWith("#"))).toBe(true);
    expect(f.rows.some((r) => r.endsWith("#"))).toBe(true);
  });

  it.each(KUFI_FILLS.map((f) => [f.id, f] as const))("%s names the letters it may sit beside", (_id, f) => {
    if (f.beside === "any") return;
    expect(f.beside.length).toBeGreaterThan(0);
    for (const ch of f.beside) expect(skeletonOf(ch.codePointAt(0)!), ch).not.toBeNull();
  });

  it("a dot sits only beside dotted letters; the square beside any", () => {
    const dot = KUFI_FILLS.find((f) => f.id === "fill.dot")!;
    const pair = KUFI_FILLS.find((f) => f.id === "fill.dots2")!;
    expect(dot.beside).toContain("ن"); // noon
    expect(dot.beside).not.toContain("ا"); // alef
    expect(pair.beside).toContain("ي"); // yeh
    expect(KUFI_FILLS.find((f) => f.id === "fill.square")!.beside).toBe("any");
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
