import { describe, it, expect } from "vitest";
import type { JoiningForm } from "../arabicJoining";
import { gridFromRows, inkBlocks2x2, isConnected4 } from "./kufiGrid";
import {
  KUFI_FORMS,
  skeletonOf,
  stretchGlyph,
  stretchedBase,
  joinRow,
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

function structuralProblems(rows: string[]): string[] {
  const out: string[] = [];
  if (rows.length === 0 || rows[0].length === 0) out.push("empty");
  if (rows.some((r) => r.length !== rows[0]?.length)) out.push("not rectangular");
  if (rows.some((r) => /[^#.]/.test(r))) out.push("stray character");
  if (!rows.some((r) => r.includes("#"))) out.push("no ink");
  if (!isConnected4(rows)) out.push("not 4-connected");
  if (inkBlocks2x2(gridFromRows(rows)).length > 0) out.push("2x2 ink block");
  return out;
}

const joinsRight = (f: JoiningForm) => f === "final" || f === "medial";
const joinsLeft = (f: JoiningForm) => f === "initial" || f === "medial";

/** Join ink: right join = ink in the rightmost column at its join row, left join likewise at the leftmost. */
function joinProblems(form: JoiningForm, g: KufiGlyph, rows: string[]): string[] {
  const out: string[] = [];
  const w = rows[0].length;
  if (joinsRight(form) && rows[joinRow(g, "right", rows)]?.[w - 1] !== "#") out.push("no right-join ink");
  if (joinsLeft(form) && rows[joinRow(g, "left", rows)]?.[0] !== "#") out.push("no left-join ink");
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
      expect(structuralProblems(e.g.rows)).toEqual([]);
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
      }
    }
  );

  it.each(ENTRIES.map((e) => [label(e), e] as const))(
    "%s still passes every check stretched by 1 and by 3",
    (_id, e) => {
      for (const n of [1, 3]) {
        const counts = e.g.stretch.map(() => n);
        const rows = stretchGlyph(e.g, counts);
        expect(structuralProblems(rows), `x${n}`).toEqual([]);
        expect(joinProblems(e.form, stretchedJoins(e.g, counts), rows), `x${n}`).toEqual([]);
      }
    }
  );
});

/** The glyph as it stands after stretching: a join row moves down by every row repeated above it. */
function stretchedJoins(g: KufiGlyph, counts: number[]): KufiGlyph {
  const shift = (row: number) =>
    g.stretch.reduce((acc, s, i) => (s.axis === "row" && s.index < row ? acc + (counts[i] ?? 0) : acc), 0);
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
