/**
 * A phrase written with the pen on one line: which form each letter takes
 * and how its joins sit (the layout, which a tarkib block stores and the
 * later editing work pins), and the ink that layout draws. Runs read right
 * to left from x = 0 on the baseline y = 0, kept RUN_GAP apart inside a
 * word and WORD_GAP between words, measured ink to ink at the same height:
 * a run slides in over another's tail or under its head where their ink
 * does not meet, as a line of Thuluth is spaced. Pure; must not
 * import ./harfbuzz. See .claude/rules/tarkib.md.
 */
import { assembleRun } from "./penJoin";
import { fitPolygons } from "./penFit";
import { NUQTA, PEN, partPaths, type JoinDefault, type PenLibrary } from "./penLibrary";
import { sweepPath, unionPolygons, type PenPath, type Polygon, type Pt } from "./penSweep";
import type { SvgCmd } from "./svgPath";
import { analyzePhrase } from "./tarkibText";

export type PenRun = { forms: string[]; joins: JoinDefault[]; hamza?: { index: number; side: "above" | "below" }[] };
/** wordStarts: the run index where each word begins. */
export type PenLayout = { runs: PenRun[]; wordStarts: number[] };

/** Nuqta between runs of one word, ink to ink. */
export const RUN_GAP = 0.6;
/** Nuqta between words, ink to ink: about one nuqta between the words of the book's Fatiha lines. */
export const WORD_GAP = 1;
/** Nuqta of height within which two runs' ink counts as side by side for spacing. */
export const SPACING_CLEARANCE = 0.5;
/** Units the fitted ink may stray from the swept ink. */
const FIT_TOL = 0.25;
/** The lowest stroke opacity a block may have. */
export const STROKE_OPACITY_MIN = 0.1;

/** A block's stroke opacity: absent means 1, and never below STROKE_OPACITY_MIN. */
export function clampStrokeOpacity(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v)) return 1;
  return Math.min(1, Math.max(STROKE_OPACITY_MIN, v));
}

/** The letter a hamza or madda sits on. */
const BASE: Record<string, string> = { "أ": "ا", "إ": "ا", "آ": "ا", "ؤ": "و", "ئ": "ي" };
const HAMZA_PART = "hamza";

/** Default forms (the first library form whose letter and form match) and joins (joins.json) for a phrase. */
export function defaultLayout(lib: PenLibrary, phrase: string): PenLayout | { missing: string[] } {
  const missing: string[] = [];
  const miss = (c: string) => { if (!missing.includes(c)) missing.push(c); };
  const runs: PenRun[] = [], wordStarts: number[] = [];
  for (const word of analyzePhrase(phrase).words) {
    wordStarts.push(runs.length);
    for (const run of word.runs) {
      const forms: string[] = [];
      const hamza: NonNullable<PenRun["hamza"]> = [];
      run.letters.forEach((l, i) => {
        const letter = BASE[l.char] ?? l.char;
        const form = [...lib.forms.values()].find((f) => f.letter === letter && f.form === l.form);
        if (form) forms.push(form.id); else miss(letter);
        if (l.hamza) {
          if (lib.parts.has(HAMZA_PART)) hamza.push({ index: i, side: l.hamza }); else miss("ء");
        }
      });
      const joins = forms.slice(1).map((id, i) => lib.joins[`${forms[i]}>${id}`] ?? lib.joins["*"] ?? { gap: 0.5, rise: 0 });
      runs.push({ forms, joins, ...(hamza.length ? { hamza } : {}) });
    }
  }
  return missing.length ? { missing } : { runs, wordStarts };
}

type Bounds = { x1: number; y1: number; x2: number; y2: number };
const boundsOf = (polys: Polygon[][]): Bounds => {
  const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
  for (const ps of polys) for (const poly of ps) for (const ring of poly) for (const [x, y] of ring) {
    if (x < b.x1) b.x1 = x; if (x > b.x2) b.x2 = x; if (y < b.y1) b.y1 = y; if (y > b.y2) b.y2 = y;
  }
  return b;
};
/** Height bands (units) for spacing: the leftmost or rightmost ink in each. */
const BAND = 4;
function profile(polys: Polygon[][], pick: (a: number, b: number) => number, start: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const ps of polys) for (const poly of ps) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    // edges as well as points: a long straight edge has no points in between
    const p = ring[i], q = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.abs(q[1] - p[1]) / BAND));
    for (let j = 0; j <= n; j++) {
      const x = p[0] + ((q[0] - p[0]) * j) / n, band = Math.floor((p[1] + ((q[1] - p[1]) * j) / n) / BAND);
      out.set(band, pick(out.get(band) ?? start, x));
    }
  }
  return out;
}
/** The x shift that sets `next` (laid with its own coordinates) `gap` units left of `placed`'s ink at the
 *  nearest pair of heights within SPACING_CLEARANCE, or null when no heights pair up. */
function clearShift(placed: Polygon[][], next: Polygon[][], gap: number): number | null {
  const left = profile(placed, Math.min, Infinity), right = profile(next, Math.max, -Infinity);
  const reach = Math.ceil((SPACING_CLEARANCE * NUQTA) / BAND);
  let shift: number | null = null;
  for (const [band, r] of right) {
    for (let d = -reach; d <= reach; d++) {
      const l = left.get(band + d);
      if (l === undefined) continue;
      const s = l - gap - r;
      if (shift === null || s < shift) shift = s;
    }
  }
  return shift;
}
const move = (polys: Polygon[], dx: number): Polygon[] => polys.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x + dx, y] as Pt)));

export type LayoutGeometry = {
  /** One entry per ink stroke: each run's body, each separate stroke, drawn part, hamza and dot. */
  strokes: SvgCmd[][];
  /** All of the ink as one outline. */
  union: SvgCmd[];
  bounds: Bounds;
  /** Each run's ink bounds, in layout order. */
  runs: Bounds[];
};

const memo = new WeakMap<PenLibrary, Map<string, LayoutGeometry>>();

/** Ink of a layout on a line, reading right to left from x = 0, baseline y = 0, in units. Memoised on the layout. */
export function layoutGeometry(lib: PenLibrary, layout: PenLayout): LayoutGeometry {
  const key = JSON.stringify(layout);
  let byKey = memo.get(lib);
  if (!byKey) memo.set(lib, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;

  const all: Polygon[][] = [], runBounds: Bounds[] = [];
  let cursor = 0;
  layout.runs.forEach((run, k) => {
    const r = assembleRun(lib, run.forms, run.joins, [0, 0]);
    const paths: PenPath[] = [...(r.body ? [r.body] : []), ...r.strokes];
    const drawn: Polygon[] = [...r.drawn];
    for (const h of run.hamza ?? []) {
      const f = lib.forms.get(run.forms[h.index])!, a = h.side === "above" ? f.anchors.above : f.anchors.below;
      const p = partPaths(lib, HAMZA_PART, [r.origins[h.index][0] + a[0] * NUQTA, r.origins[h.index][1] + a[1] * NUQTA]);
      paths.push(...p.strokes);
      drawn.push(...p.drawn);
    }
    paths.push(...r.dots);
    const inks: Polygon[][] = [...paths.map((p) => sweepPath(p, PEN)), ...drawn.map((d) => [d])].filter((ps) => ps.length > 0);
    const b = boundsOf(inks);
    let dx = Number.isFinite(b.x2) ? -b.x2 : 0;
    if (k > 0) {
      const gap = (layout.wordStarts.includes(k) ? WORD_GAP : RUN_GAP) * NUQTA;
      const shift = clearShift(all, inks, gap);
      // ink that never sits beside the phrase so far (a lone dot well above it) keeps the bounding boxes apart
      dx = shift ?? cursor - gap - (Number.isFinite(b.x2) ? b.x2 : 0);
    }
    for (const ink of inks) all.push(move(ink, dx));
    const placed = Number.isFinite(b.x1) ? { x1: b.x1 + dx, y1: b.y1, x2: b.x2 + dx, y2: b.y2 } : { x1: cursor, y1: 0, x2: cursor, y2: 0 };
    runBounds.push(placed);
    cursor = Math.min(cursor, placed.x1);
  });

  const out: LayoutGeometry = {
    strokes: all.map((ps) => fitPolygons(ps, FIT_TOL)),
    union: fitPolygons(unionPolygons(all), FIT_TOL),
    bounds: boundsOf(all),
    runs: runBounds,
  };
  byKey.set(key, out);
  return out;
}
