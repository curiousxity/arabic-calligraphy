/**
 * A phrase written with the pen on one line: which form each letter takes
 * and how its joins sit (the layout, which a tarkib block stores and the
 * later editing work pins), and the ink that layout draws. Runs read right
 * to left from x = 0 on the baseline y = 0. Each run sits as far right as
 * it can while keeping RUN_GAP (inside a word) or WORD_GAP (between words)
 * clear of all the ink before it, in any direction, so a word tucks in over
 * another's tail or under its head as a line of Thuluth is spaced. Pure; must not
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

/** Nuqta a run keeps clear of the ink before it in its own word. The studio reference (أم أيمن, 2026-10-19, once
 *  our letters matched its outlines) keeps every letter group 0.86 to 0.89 clear of the ink before it, inside a word
 *  or between words alike: the meem 0.89 from its alif, أيمن's alif 0.86 from أم's meem, يمن 0.87 from its alif and,
 *  with the ya's dots, 0.87 from أم's meem tail. That is a clearance of at least 0.85 everywhere. */
export const RUN_GAP = 0.85;
/** Nuqta a word keeps clear of the ink before it: the same as inside a word, on the same reference. */
export const WORD_GAP = 0.85;
/** Units a run slides at a time while looking for its place (the result is refined to SLIDE_TOL). */
const SLIDE = 4;
const SLIDE_TOL = 0.25;
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
        // Thuluth writes the alif bare: a hamza over or under an alif is left out (the user's ruling, 2026-10-19)
        if (l.hamza && letter !== "ا") {
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
/** Points along every outline edge, at most two units apart. */
function outlinePoints(polys: Polygon[][]): Pt[] {
  const out: Pt[] = [];
  for (const ps of polys) for (const poly of ps) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
    for (let j = 0; j < n; j++) out.push([p[0] + ((q[0] - p[0]) * j) / n, p[1] + ((q[1] - p[1]) * j) / n]);
  }
  return out;
}
/** Placed ink bucketed by cells `gap` wide, to ask quickly whether any of it lies within `gap` of a point. */
function nearIndex(points: Pt[], gap: number): (x: number, y: number) => boolean {
  const cells = new Map<string, Pt[]>();
  for (const p of points) {
    const k = `${Math.floor(p[0] / gap)},${Math.floor(p[1] / gap)}`;
    const c = cells.get(k);
    if (c) c.push(p); else cells.set(k, [p]);
  }
  return (x, y) => {
    const cx = Math.floor(x / gap), cy = Math.floor(y / gap);
    for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
      for (const p of cells.get(`${i},${j}`) ?? []) if (Math.hypot(p[0] - x, p[1] - y) < gap) return true;
    }
    return false;
  };
}
/** The largest x shift, at most `start`, at which `next`'s ink keeps `gap` clear of the placed ink. */
function clearShift(placed: Pt[], next: Pt[], gap: number, start: number): number {
  const near = nearIndex(placed, gap);
  const clashes = (dx: number) => next.some(([x, y]) => near(x + dx, y));
  if (!clashes(start)) return start;
  let hit = start, dx = start;
  while (clashes(dx)) { hit = dx; dx -= SLIDE; }
  // the first clear shift lies between the last clash and dx
  while (hit - dx > SLIDE_TOL) {
    const mid = (hit + dx) / 2;
    if (clashes(mid)) hit = mid; else dx = mid;
  }
  return dx;
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
  /** For each entry of `strokes`, the run it belongs to (runs overlap where a word tucks in over another). */
  strokeRuns: number[];
};

const memo = new WeakMap<PenLibrary, Map<string, LayoutGeometry>>();

/** Ink of a layout on a line, reading right to left from x = 0, baseline y = 0, in units. Memoised on the layout. */
export function layoutGeometry(lib: PenLibrary, layout: PenLayout): LayoutGeometry {
  const key = JSON.stringify(layout);
  let byKey = memo.get(lib);
  if (!byKey) memo.set(lib, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;

  const all: Polygon[][] = [], runBounds: Bounds[] = [], strokeRuns: number[] = [];
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
    if (k > 0 && Number.isFinite(b.x2)) {
      const gap = (layout.wordStarts.includes(k) ? WORD_GAP : RUN_GAP) * NUQTA;
      // reading right to left: a run never starts right of the one before it
      dx = clearShift(outlinePoints(all), outlinePoints(inks), gap, runBounds[k - 1].x2 - b.x2);
    }
    for (const ink of inks) { all.push(move(ink, dx)); strokeRuns.push(k); }
    const prevX1 = runBounds.length ? runBounds[runBounds.length - 1].x1 : 0;
    runBounds.push(Number.isFinite(b.x1) ? { x1: b.x1 + dx, y1: b.y1, x2: b.x2 + dx, y2: b.y2 } : { x1: prevX1, y1: 0, x2: prevX1, y2: 0 });
  });

  const out: LayoutGeometry = {
    strokes: all.map((ps) => fitPolygons(ps, FIT_TOL)),
    union: fitPolygons(unionPolygons(all), FIT_TOL),
    bounds: boundsOf(all),
    runs: runBounds,
    strokeRuns,
  };
  byKey.set(key, out);
  return out;
}
