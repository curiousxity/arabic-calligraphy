/**
 * THROWAWAY spike 4c. Not committed.
 *
 * A rule-based square-Kufi arranger: text plus a box size in, a panel out,
 * with no hand placements. It follows the rules read off the user's
 * Al-Baqarah 21x21 panel (task-4b-report.md):
 *
 * - Text runs clockwise round the frame from the bottom right, every
 *   baseline on the outer edge: bottom (upright, right to left), left
 *   (turned 90, upwards), top (upside down, left to right), right (turned
 *   270, downwards). Then a second ring inside, and so on: the core.
 * - A line holds whole pieces (runs of joined letters). A word never bends
 *   round a corner; it may only break between pieces, or turn back on itself
 *   with the U-turn join into a top-joined letter.
 * - Each piece slides along its line from the line's start until its ink
 *   neither overlaps nor touches anything placed before it. That is how bands
 *   interlock: a short letter lets the next line's ink come within one gap.
 * - Tall strokes stretch or shorten (table minimums only), wide strokes
 *   stretch, alternates swap: all chosen by search.
 * - Holes left over are plugged by a dot beside a dotted letter or a lone
 *   square, one isolated cell each, only where it closes a hole.
 *
 * Search: simulated annealing over the choices (which line each piece goes
 * on, alternates, stretch counts, line offsets, U-turns), with restarts in a
 * time budget, scored on holes (empty 2x2), edge gaps, fills and penalties.
 *
 * Run: KUFI_LOCAL=<folder with refs/ and spike2/ref21.txt> [KUFI_BROWSER=<chromium exe>]
 *      npx --yes tsx scripts/kufi/arrange.ts [baqarah|allah|shahada|all] [seconds-per-size]
 */
import fs from "node:fs";
import { execFileSync, fork } from "node:child_process";
import {
  KUFI_FORMS,
  KUFI_JOINS,
  joinCol,
  stretchGlyph,
  stretchedBase,
  type KufiGlyph,
} from "../../src/lib/kufi/kufiAlphabet";
import { resolveKufiText } from "../../src/lib/kufi/kufiWords";

// The local material (reference panels, output sheets) lives outside the
// repo: KUFI_LOCAL names its folder (with `refs/` and `spike2/ref21.txt` in
// it; `spike3/` is written). KUFI_BROWSER is a headless-capable Chromium
// browser executable, used only to render the sheets to PNG.
const LOCAL = process.env.KUFI_LOCAL;
if (!LOCAL) {
  console.error("arrange.ts: set KUFI_LOCAL to the folder holding the local Kufi material (refs/, spike2/ref21.txt).");
  process.exit(2);
}
const OUT = `${LOCAL}/spike3`;
const REFS = `${LOCAL}/refs`;
const BROWSER = process.env.KUFI_BROWSER;
fs.mkdirSync(OUT, { recursive: true });

const D = 5; // band depth
const MAX_COL = 8; // most extra columns a slice may take
const ONE_DOT = "بجخذزضظغفنإ";
const TWO_DOTS = "تقيةثشپچژ";

// ---------------------------------------------------------------------------
// Letters and pieces
// ---------------------------------------------------------------------------

type Letter = {
  ch: string;
  key: string;
  cands: KufiGlyph[]; // shapes for an ordinary position
  entry: KufiGlyph[]; // shapes entered at their top (after a U-turn)
  joinsNext: boolean;
  word: number;
  dotted: boolean;
};
type Piece = { letters: number[]; word: number };
type Phrase = { text: string; letters: Letter[]; pieces: Piece[]; words: string[] };

function formsOf(skeleton: string, form: string): KufiGlyph[] {
  const table = KUFI_FORMS as Record<string, Record<string, KufiGlyph[] | undefined>>;
  return table[skeleton]?.[form] ?? table[skeleton]?.isolated ?? [];
}

function phraseOf(text: string): Phrase {
  const { units, unsupported } = resolveKufiText(text);
  if (unsupported.length) throw new Error(`unsupported: ${unsupported.join(" ")}`);
  const letters: Letter[] = units.map((u) => {
    const all = formsOf(u.skeleton, u.form);
    const ch = text.slice(u.textOffset, u.textOffset + (u.skeleton === "allah" ? 4 : u.skeleton === "lamAlef" ? 2 : 1));
    return {
      ch,
      key: u.key,
      cands: all.filter((g) => g.joins?.right !== 0),
      entry: all.filter((g) => g.joins?.right === 0),
      joinsNext: u.joinsNext,
      word: u.wordIndex,
      dotted: [...ch].some((c) => ONE_DOT.includes(c) || TWO_DOTS.includes(c)),
    };
  });
  const pieces: Piece[] = [];
  letters.forEach((l, i) => {
    const prev = letters[i - 1];
    if (prev && prev.joinsNext) pieces[pieces.length - 1].letters.push(i);
    else pieces.push({ letters: [i], word: l.word });
  });
  return { text, letters, pieces, words: text.split(/\s+/) };
}

// ---------------------------------------------------------------------------
// Genome
// ---------------------------------------------------------------------------

type Genome = {
  alt: number[]; // per letter
  cnt: number[][]; // per letter, per stretch slice
  inc: number[]; // per piece: lines skipped before it (0 = same line as the previous piece)
  uturn: number[]; // per letter: 1 = U-turn after this letter (eligible joints only)
  jext: number[]; // per letter: extra cells in the join run after this letter (0 = stubs overlap)
  climb: number[]; // per letter: U-turn stem count
  off: number[]; // per line: baseline offset (index into OFFSETS)
  start: number[]; // per line: cells skipped at the line's start
};

const RING0_OFF = [0, 1, 2];
const RINGK_OFF = [-2, -1, 0, 1, 2];
const MAX_START = 6;

type Ctx = { N: number; P: Phrase; rings: number; nLines: number; eligible: boolean[] };

function ctxOf(N: number, P: Phrase): Ctx {
  const rings = Math.max(1, Math.floor((N - 1) / (2 * (D + 1))) + 1);
  const eligible = P.letters.map((l, i) => l.joinsNext && P.letters[i + 1]?.entry.length > 0);
  return { N, P, rings, nLines: rings * 4, eligible };
}

const rint = (n: number) => Math.floor(Math.random() * n);
const clone = (g: Genome): Genome => ({
  alt: g.alt.slice(),
  cnt: g.cnt.map((c) => c.slice()),
  inc: g.inc.slice(),
  uturn: g.uturn.slice(),
  jext: g.jext.slice(),
  climb: g.climb.slice(),
  off: g.off.slice(),
  start: g.start.slice(),
});

function glyphOf(ctx: Ctx, g: Genome, i: number, entry: boolean): KufiGlyph {
  const l = ctx.P.letters[i];
  const list = entry ? l.entry : l.cands;
  return list[g.alt[i] % list.length];
}

function randomGenome(ctx: Ctx): Genome {
  const { P } = ctx;
  const g: Genome = {
    alt: P.letters.map((l) => rint(Math.max(l.cands.length, 1))),
    cnt: P.letters.map(() => [0, 0]),
    inc: P.pieces.map((_, i) => (i === 0 ? 0 : Math.random() < 0.4 ? 1 : 0)),
    uturn: P.letters.map(() => 0),
    jext: P.letters.map(() => 0),
    climb: P.letters.map(() => 0),
    off: new Array<number>(ctx.nLines).fill(0).map((_, k) => (k < 4 ? 0 : 2)),
    start: new Array<number>(ctx.nLines).fill(0),
  };
  // Spread the pieces round the lines by rough width.
  let line = 0;
  let used = 0;
  P.pieces.forEach((p, pi) => {
    const w = p.letters.reduce((s, i) => s + (P.letters[i].cands[0]?.rows[0].length ?? 3) - 1, 1) + 1;
    const cap = Math.max(4, ctx.N - 2 * Math.floor(line / 4) * (D + 1) - (line % 2 === 1 ? 2 * (D + 1) : 0));
    if (pi > 0 && used + w > cap) {
      g.inc[pi] = 1;
      line++;
      used = 0;
    } else if (pi > 0) g.inc[pi] = 0;
    used += w;
  });
  return g;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Rot = 0 | 90 | 180 | 270;
type Line = { rot: Rot; base: number };

/** Panel [row, col] of upright (x, y): x to the right as drawn upright, y up from the baseline. */
function at(N: number, L: Line, x: number, y: number): [number, number] {
  switch (L.rot) {
    case 0: return [L.base - y, x];
    case 180: return [L.base + y, N - 1 - x];
    case 90: return [x, L.base + y];
    case 270: return [N - 1 - x, L.base - y];
  }
}

function templateLine(ctx: Ctx, g: Genome, k: number): Line {
  const ring = Math.floor(k / 4);
  const side = k % 4;
  const off = ring === 0 ? RING0_OFF[g.off[k]] : RINGK_OFF[g.off[k]];
  const dist = ring * (D + 1) + off;
  const N = ctx.N;
  switch (side) {
    case 0: return { rot: 0, base: N - 1 - dist };
    case 1: return { rot: 90, base: dist };
    case 2: return { rot: 180, base: dist };
    default: return { rot: 270, base: N - 1 - dist };
  }
}

type Cell = { x: number; y: number; l: number }; // l = letter index, -1 = join piece
type Shape = { rows: string[]; baseRow: number; g: KufiGlyph };

function shapeOf(gl: KufiGlyph, counts: number[]): Shape {
  const c = gl.stretch.map((s, i) => {
    const n = counts[i] ?? 0;
    return s.axis === "col" ? Math.max(0, Math.min(MAX_COL, n)) : n;
  });
  const rows = stretchGlyph(gl, c);
  return { rows, baseRow: rows.length - 1 - stretchedBase(gl, c), g: gl };
}
const joinH = (s: Shape, side: "right" | "left") => s.baseRow - (s.g.joins?.[side] ?? s.baseRow);

type Seg = {
  cells: Cell[];
  stubs: Set<string>;
  ok: boolean;
  lastStub: [number, number] | null;
  firstStub: [number, number];
  xs: Int16Array;
  ys: Int16Array;
  minX: number;
  maxX: number;
};

/** Panel row/col as an affine map of upright (x, y): [ar, br, cr, ac, bc, cc]. */
function affine(N: number, L: Line): [number, number, number, number, number, number] {
  switch (L.rot) {
    case 0: return [0, -1, L.base, 1, 0, 0];
    case 180: return [0, 1, L.base, -1, 0, N - 1];
    case 90: return [1, 0, 0, 0, 1, L.base];
    case 270: return [-1, 0, N - 1, 0, -1, L.base];
  }
}

/** A run of joined letters in its own upright frame: first letter's box right edge at x = 0, baseline y = 0. */
const segCache = new Map<string, Seg>();
function buildSeg(ctx: Ctx, g: Genome, idx: number[], entryFirst: boolean): Seg {
  const key = (entryFirst ? "E" : "") + idx.map((i) => `${i}:${g.alt[i]}:${g.cnt[i][0]}:${g.cnt[i][1]}:${g.jext[i]}`).join("|");
  const hit = segCache.get(key);
  if (hit) return hit;
  if (segCache.size > 200000) segCache.clear();
  const seg = buildSegRaw(ctx, g, idx, entryFirst);
  segCache.set(key, seg);
  return seg;
}
function buildSegRaw(ctx: Ctx, g: Genome, idx: number[], entryFirst: boolean): Seg {
  const cells: Cell[] = [];
  const own = new Map<string, number>();
  const stubs = new Set<string>();
  let ok = true;
  let prev: { s: Shape; x0: number; yb: number } | null = null;
  let firstStub: [number, number] = [0, 0];
  idx.forEach((li, k) => {
    const gl = glyphOf(ctx, g, li, k === 0 && entryFirst);
    const s = shapeOf(gl, g.cnt[li]);
    const w = s.rows[0].length;
    let x0: number;
    let yb: number;
    if (!prev) {
      x0 = -(w - 1);
      yb = 0;
      firstStub = [x0 + joinCol(gl, "right", s.rows), yb + joinH(s, "right")];
    } else {
      const sx0 = prev.x0 + joinCol(prev.s.g, "left", prev.s.rows);
      const sy = prev.yb + joinH(prev.s, "left");
      const e = g.jext[idx[k - 1]] ?? 0;
      const sx = sx0 - e;
      for (let x = sx0; x >= sx; x--) {
        stubs.add(`${x},${sy}`);
        if (x !== sx0 && x !== sx) {
          own.set(`${x},${sy}`, -1);
          cells.push({ x, y: sy, l: -1 });
        }
      }
      x0 = sx - joinCol(gl, "right", s.rows);
      yb = sy - joinH(s, "right");
    }
    s.rows.forEach((row, i) => {
      for (let j = 0; j < row.length; j++) {
        if (row[j] !== "#") continue;
        const x = x0 + j;
        const y = yb + s.baseRow - i;
        const key = `${x},${y}`;
        const o = own.get(key);
        if (o !== undefined) {
          if (!stubs.has(key) || o === -1) ok = false;
          continue;
        }
        own.set(key, li);
        cells.push({ x, y, l: li });
      }
    });
    prev = { s, x0, yb };
  });
  // letters may touch only at a shared stub
  for (const c of cells)
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const k2 = `${c.x + dx},${c.y + dy}`;
      const o = own.get(k2);
      if (o !== undefined && o !== c.l && !stubs.has(k2) && !stubs.has(`${c.x},${c.y}`)) ok = false;
    }
  let lastStub: [number, number] | null = null;
  if (prev) {
    const p = prev as { s: Shape; x0: number; yb: number };
    lastStub = [p.x0 + joinCol(p.s.g, "left", p.s.rows), p.yb + joinH(p.s, "left")];
  }
  const xs = Int16Array.from(cells.map((c) => c.x));
  const ys = Int16Array.from(cells.map((c) => c.y));
  let minX = 0, maxX = 0;
  if (cells.length) {
    minX = Math.min(...xs);
    maxX = Math.max(...xs);
  }
  return { cells, stubs, ok, lastStub, firstStub, xs, ys, minX, maxX };
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

type Placement = { seg: number; line: number; text: string; rot: Rot; cells: Array<[number, number]> };
type Result = {
  N: number;
  owner: Int16Array; // 0 empty, >0 unit id, -1 fill dot, -2 fill square
  wordOf: Int16Array; // word index of the ink, -1 for fills
  score: number;
  holes: number;
  edge: number;
  ink2: number;
  holesBefore: number;
  failed: number;
  dots: number;
  squares: number;
  placements: Placement[];
  lines: string[];
};

function count2x2(N: number, owner: Int16Array, ink: boolean): number {
  let n = 0;
  for (let r = 0; r + 1 < N; r++)
    for (let c = 0; c + 1 < N; c++) {
      const a = owner[r * N + c] !== 0, b = owner[r * N + c + 1] !== 0, d = owner[(r + 1) * N + c] !== 0, e = owner[(r + 1) * N + c + 1] !== 0;
      if (ink ? a && b && d && e : !a && !b && !d && !e) n++;
    }
  return n;
}
/** Two neighbouring empty cells on the outer frame: a break wider than one gap. */
function edgeGaps(N: number, owner: Int16Array): number {
  let n = 0;
  for (let i = 0; i + 1 < N; i++) {
    if (!owner[i] && !owner[i + 1]) n++;
    if (!owner[(N - 1) * N + i] && !owner[(N - 1) * N + i + 1]) n++;
    if (!owner[i * N] && !owner[(i + 1) * N]) n++;
    if (!owner[i * N + N - 1] && !owner[(i + 1) * N + N - 1]) n++;
  }
  return n;
}

/**
 * Fills: one isolated cell (a dot within two cells of a dotted letter's ink,
 * else a lone square), placed only where it closes at least FILL_MIN windows
 * (empty 2x2 inside the panel, or a double break on the frame).
 */
const FILL_MIN = 3;
function emptyAt(owner: Int16Array, N: number, r: number, c: number): boolean {
  return r < 0 || c < 0 || r >= N || c >= N || owner[r * N + c] === 0;
}
function isoAt(owner: Int16Array, N: number, r: number, c: number): boolean {
  return (
    emptyAt(owner, N, r, c) && emptyAt(owner, N, r + 1, c) && emptyAt(owner, N, r - 1, c) &&
    emptyAt(owner, N, r, c + 1) && emptyAt(owner, N, r, c - 1)
  );
}
/** Windows a fill at (r, c) would close: empty 2x2 inside the panel, plus double breaks on the frame. */
function closesAt(owner: Int16Array, N: number, r: number, c: number): number {
  let n = 0;
  for (let r0 = r - 1; r0 <= r; r0++)
    for (let c0 = c - 1; c0 <= c; c0++) {
      if (r0 < 0 || c0 < 0 || r0 + 1 >= N || c0 + 1 >= N) continue;
      const i = r0 * N + c0;
      if (owner[i] === 0 && owner[i + 1] === 0 && owner[i + N] === 0 && owner[i + N + 1] === 0) n++;
    }
  if (r === 0 || r === N - 1) n += (c > 0 && owner[r * N + c - 1] === 0 ? 1 : 0) + (c < N - 1 && owner[r * N + c + 1] === 0 ? 1 : 0);
  if (c === 0 || c === N - 1) n += (r > 0 && owner[(r - 1) * N + c] === 0 ? 1 : 0) + (r < N - 1 && owner[(r + 1) * N + c] === 0 ? 1 : 0);
  return n;
}
function nearDotted(owner: Int16Array, N: number, dottedUnits: Set<number>, r: number, c: number): boolean {
  for (let dr = -2; dr <= 2; dr++)
    for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if (rr >= 0 && cc >= 0 && rr < N && cc < N && owner[rr * N + cc] > 0 && dottedUnits.has(owner[rr * N + cc])) return true;
    }
  return false;
}
/** Other fills within two cells of (r, c). */
function fillCount(owner: Int16Array, N: number, r: number, c: number): number {
  let n = 0;
  for (let dr = -2; dr <= 2; dr++)
    for (let dc = -2; dc <= 2; dc++) {
      const rr = r + dr, cc = c + dc;
      if ((dr || dc) && rr >= 0 && cc >= 0 && rr < N && cc < N && owner[rr * N + cc] < 0) n++;
    }
  return n;
}
function fillPass(N: number, owner: Int16Array, dottedUnits: Set<number>, mask?: Uint8Array): { dots: number; squares: number } {
  const cand: number[] = [];
  const score: number[] = [];
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if (owner[r * N + c] !== 0 || (mask && !mask[r * N + c]) || !isoAt(owner, N, r, c)) continue;
      const n = closesAt(owner, N, r, c);
      if (n >= FILL_MIN) {
        cand.push(r * N + c);
        score.push(n);
      }
    }
  const order = cand.map((_, k) => k).sort((x, y) => score[y] - score[x]);
  let dots = 0, squares = 0;
  for (const k of order) {
    const i = cand[k];
    const r = (i / N) | 0, c = i % N;
    if (!isoAt(owner, N, r, c) || closesAt(owner, N, r, c) < FILL_MIN) continue;
    // it must sit by a letter, and not in a cluster of fills (a pair at most)
    let letterNear = false, fillsNear = 0, mate = -1;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        const o = owner[rr * N + cc];
        if (o > 0) letterNear = true;
        else if (o < 0) {
          fillsNear++;
          mate = rr * N + cc;
        }
      }
    if (!letterNear || fillsNear > 1) continue;
    if (mate >= 0 && fillCount(owner, N, (mate / N) | 0, mate % N) > 0) continue;
    const dot = nearDotted(owner, N, dottedUnits, r, c);
    owner[i] = dot ? -1 : -2;
    if (dot) dots++;
    else squares++;
  }
  return { dots, squares };
}

type Grids = { N: number; owner: Int16Array; wordOf: Int16Array; blocked: Uint8Array };
const NB: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function fits(G: Grids, cells: Array<[number, number]>, u: number, allow: Set<number> | null): boolean {
  const { N, owner } = G;
  for (const [r, c] of cells) {
    if (r < 0 || c < 0 || r >= N || c >= N) return false;
    const o = owner[r * N + c];
    if (o !== 0 && !(allow && allow.has(r * N + c))) return false;
  }
  for (const [r, c] of cells)
    for (const [dr, dc] of NB) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
      const o = owner[rr * N + cc];
      if (o !== 0 && o !== u) return false;
    }
  return true;
}
/** `blocked`: inked, or touching ink. A fresh piece may use neither. */
function put(G: Grids, cells: Array<[number, number]>, u: number, word: number) {
  const { N, owner, wordOf, blocked } = G;
  for (const [r, c] of cells) {
    owner[r * N + c] = u;
    wordOf[r * N + c] = word;
    blocked[r * N + c] = 1;
    if (r > 0) blocked[(r - 1) * N + c] = 1;
    if (r + 1 < N) blocked[(r + 1) * N + c] = 1;
    if (c > 0) blocked[r * N + c - 1] = 1;
    if (c + 1 < N) blocked[r * N + c + 1] = 1;
  }
}
function fitsFast(G: Grids, seg: Seg, dx: number, A: [number, number, number, number, number, number]): boolean {
  const { N, blocked } = G;
  const [ar, br, cr, ac, bc, cc] = A;
  const { xs, ys } = seg;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i] + dx, y = ys[i];
    const r = ar * x + br * y + cr, c = ac * x + bc * y + cc;
    if (r < 0 || c < 0 || r >= N || c >= N || blocked[r * N + c]) return false;
  }
  return true;
}
function placeCells(N: number, seg: Seg, dx: number, A: [number, number, number, number, number, number]): Array<[number, number]> {
  const [ar, br, cr, ac, bc, cc] = A;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < seg.xs.length; i++) {
    const x = seg.xs[i] + dx, y = seg.ys[i];
    out.push([ar * x + br * y + cr, ac * x + bc * y + cc]);
  }
  return out;
}

const W = { fail: 300, ink2: 300, hole: 10, edge: 6, dot: 8, square: 25, split: 2, uturn: 1, stretch: Number(process.env.STRETCH ?? 0.04) };

// ---------------------------------------------------------------------------
// Incremental placement: a panel is built one piece at a time on a State
// ---------------------------------------------------------------------------

type State = {
  owner: Int16Array; // 0 empty, >0 unit id, -1 fill dot, -2 fill square
  wordOf: Int16Array;
  blocked: Uint8Array;
  lines: Array<Line | null>; // geometry fixed when a line is first used
  cursor: number[];
  line: number; // line of the last piece placed
  lastWord: number;
  pending: { cell: [number, number]; unit: number } | null;
  unit: number;
  failed: number;
  splits: number;
  uturns: number;
  stretch: number;
  dotted: number[];
  placements: Placement[] | null;
};

const MAX_LINES = 16;

function initState(ctx: Ctx, keep: boolean): State {
  const n = ctx.N * ctx.N;
  return {
    owner: new Int16Array(n),
    wordOf: new Int16Array(n).fill(-1),
    blocked: new Uint8Array(n),
    lines: new Array<Line | null>(MAX_LINES).fill(null),
    cursor: new Array<number>(MAX_LINES).fill(0),
    line: 0,
    lastWord: -1,
    pending: null,
    unit: 0,
    failed: 0,
    splits: 0,
    uturns: 0,
    stretch: 0,
    dotted: [],
    placements: keep ? [] : null,
  };
}

function cloneState(s: State): State {
  return {
    ...s,
    owner: s.owner.slice(),
    wordOf: s.wordOf.slice(),
    blocked: s.blocked.slice(),
    lines: s.lines.slice(),
    cursor: s.cursor.slice(),
    dotted: s.dotted.slice(),
    placements: s.placements ? s.placements.slice() : null,
  };
}

/** Opens line k (from the template, with this genome's offset and start) unless already open. */
function openLine(ctx: Ctx, g: Genome, st: State, k: number): Line | null {
  if (k >= MAX_LINES) return null;
  if (!st.lines[k]) {
    if (k >= ctx.nLines) return null;
    st.lines[k] = templateLine(ctx, g, k);
    st.cursor[k] = ctx.N - 1 - g.start[k];
  }
  return st.lines[k];
}

/** Places piece `pi` (and its U-turn continuation, if any) onto the state, in place. */
function placePiece(ctx: Ctx, g: Genome, st: State, pi: number): void {
  const { N, P } = ctx;
  const p = P.pieces[pi];
  let line = pi === 0 ? 0 : st.line + g.inc[pi];
  if (st.lastWord === p.word && line !== st.line) st.splits++;
  // split after U-turn letters
  const segs: Array<{ idx: number[]; line: number; forced: boolean; uturnAfter: boolean }> = [];
  let cur: number[] = [];
  let forced = false;
  for (let k = 0; k < p.letters.length; k++) {
    const li = p.letters[k];
    cur.push(li);
    if (k < p.letters.length - 1 && ctx.eligible[li] && g.uturn[li]) {
      segs.push({ idx: cur, line, forced, uturnAfter: true });
      line++;
      cur = [];
      forced = true;
      st.uturns++;
    }
  }
  segs.push({ idx: cur, line, forced, uturnAfter: false });
  st.line = line;
  st.lastWord = p.word;
  const G: Grids = { N, owner: st.owner, wordOf: st.wordOf, blocked: st.blocked };

  for (const s of segs) {
    for (let k = 0; k < s.idx.length; k++) {
      const li = s.idx[k];
      const gl = glyphOf(ctx, g, li, s.forced && k === 0);
      for (let j = 0; j < gl.stretch.length; j++) st.stretch += Math.abs(g.cnt[li][j] ?? 0);
      st.stretch += g.jext[li] ?? 0;
    }
    const seg = buildSeg(ctx, g, s.idx, s.forced);
    if (!seg.ok) {
      st.failed += s.idx.length;
      st.pending = null;
      continue;
    }
    let placed: Array<[number, number]> | null = null;
    let u = 0;
    let L: Line | null = null;
    if (s.forced) {
      const pend = st.pending;
      st.pending = null;
      const prev = st.lines[s.line - 1];
      if (!pend || !prev || s.line >= MAX_LINES) {
        st.failed += s.idx.length;
        continue;
      }
      // geometry fixed by the U-turn: the entry letter's right stub sits on the turn's end cell
      const fs0 = shapeOf(glyphOf(ctx, g, s.idx[0], true), g.cnt[s.idx[0]]);
      const jh = joinH(fs0, "right");
      const rot = ((prev.rot + 180) % 360) as Rot;
      const [pr, pc] = pend.cell;
      let base: number, xs: number;
      if (rot === 0) { base = pr + jh; xs = pc; }
      else if (rot === 180) { base = pr - jh; xs = N - 1 - pc; }
      else if (rot === 90) { base = pc - jh; xs = pr; }
      else { base = pc + jh; xs = N - 1 - pr; }
      L = { rot, base };
      st.lines[s.line] = L;
      const dx = xs - seg.firstStub[0];
      const A = affine(N, L);
      const cells = placeCells(N, seg, dx, A);
      u = pend.unit;
      if (fits(G, cells, u, new Set<number>([pend.cell[0] * N + pend.cell[1]]))) {
        placed = cells;
        st.cursor[s.line] = dx + seg.minX - 1;
      }
    } else {
      L = openLine(ctx, g, st, s.line);
      if (!L) {
        st.failed += s.idx.length;
        continue;
      }
      u = ++st.unit;
      const { maxX, minX } = seg;
      const A = affine(N, L);
      for (let X = st.cursor[s.line]; X - (maxX - minX) >= 0; X--) {
        const dx = X - maxX;
        if (!fitsFast(G, seg, dx, A)) continue;
        const cells = placeCells(N, seg, dx, A);
        if (s.uturnAfter && seg.lastStub) {
          // U-turn: one cell on along the line, climb, one cell back
          const j = KUFI_JOINS[0];
          const h = j.rows.length - 1 + Math.max(-(j.stretch[0].min ?? 0), g.climb[s.idx[s.idx.length - 1]]);
          const [sx, sy] = seg.lastStub;
          const t: Array<[number, number]> = [];
          for (let y = 0; y <= h; y++) t.push(at(N, L, sx - 1 + dx, sy + y));
          t.push(at(N, L, sx + dx, sy + h));
          if (!fits(G, t, u, null) || t.some(([r, c]) => cells.some(([r2, c2]) => r2 === r && c2 === c))) continue;
          placed = [...cells, ...t];
          st.pending = { cell: t[t.length - 1], unit: u };
        } else placed = cells;
        st.cursor[s.line] = X - (maxX - minX) - 1;
        break;
      }
    }
    if (!placed || !L) {
      st.failed += s.idx.length;
      if (s.uturnAfter) st.pending = null;
      continue;
    }
    put(G, placed, u, p.word);
    if (s.idx.some((i) => P.letters[i].dotted)) st.dotted.push(u);
    if (st.placements)
      st.placements.push({ seg: pi, line: s.line, text: s.idx.map((i) => P.letters[i].ch).join(""), rot: L.rot, cells: placed });
  }
}

/** Empty 2x2 windows (and double frame breaks) that nothing placed later can close: every cell touches ink. */
function permanentHoles(N: number, owner: Int16Array, blocked: Uint8Array): number {
  let n = 0;
  for (let r = 0; r + 1 < N; r++)
    for (let c = 0; c + 1 < N; c++) {
      const i = r * N + c;
      if (owner[i] === 0 && owner[i + 1] === 0 && owner[i + N] === 0 && owner[i + N + 1] === 0 &&
        blocked[i] && blocked[i + 1] && blocked[i + N] && blocked[i + N + 1]) n += W.hole;
    }
  for (let i = 0; i + 1 < N; i++) {
    const a1 = i, b1 = i + 1;
    const a2 = (N - 1) * N + i, b2 = a2 + 1;
    const a3 = i * N, b3 = (i + 1) * N;
    const a4 = i * N + N - 1, b4 = (i + 1) * N + N - 1;
    if (owner[a1] === 0 && owner[b1] === 0 && blocked[a1] && blocked[b1]) n += W.edge;
    if (owner[a2] === 0 && owner[b2] === 0 && blocked[a2] && blocked[b2]) n += W.edge;
    if (owner[a3] === 0 && owner[b3] === 0 && blocked[a3] && blocked[b3]) n += W.edge;
    if (owner[a4] === 0 && owner[b4] === 0 && blocked[a4] && blocked[b4]) n += W.edge;
  }
  return n;
}

/**
 * Likely holes: once the search has moved past a line, empty 2x2 windows lying
 * wholly inside that line's own band (depth 0..D-1 from its baseline) that are
 * not already permanent. Only the next ring's baseline can still reach the
 * band's deepest row, so most of these stay open.
 */
const SOFT = Number(process.env.SOFT ?? 0.6);
function softHoles(ctx: Ctx, st: State): number {
  const { N } = ctx;
  // band cells that are settled: closed lines whole, the open line behind its cursor; depth 0..3
  const mark = new Uint8Array(N * N);
  for (let k = 0; k <= st.line; k++) {
    const L = st.lines[k];
    if (!L) continue;
    const [ar, br, cr, ac, bc, cc] = affine(N, L);
    // the open line counts only behind its cursor: nothing later on it can reach back there
    const x0 = k === st.line ? Math.max(0, st.cursor[k] + 1) : 0;
    for (let y = 0; y < D - 1; y++)
      for (let x = x0; x < N; x++) {
        const r = ar * x + br * y + cr, c = ac * x + bc * y + cc;
        if (r >= 0 && c >= 0 && r < N && c < N) mark[r * N + c] = 1;
      }
  }
  // the fills the finished panel would make there, at their cost
  const owner = st.owner.slice();
  fillPass(N, owner, new Set(st.dotted), mark);
  let cost = 0;
  for (let i = 0; i < N * N; i++) if (owner[i] < 0 && mark[i]) cost += owner[i] === -1 ? W.dot : W.square;
  let n = 0;
  for (let r = 0; r + 1 < N; r++)
    for (let c = 0; c + 1 < N; c++) {
      const i = r * N + c;
      if (!(mark[i] && mark[i + 1] && mark[i + N] && mark[i + N + 1])) continue;
      if (owner[i] || owner[i + 1] || owner[i + N] || owner[i + N + 1]) continue;
      if (st.blocked[i] && st.blocked[i + 1] && st.blocked[i + N] && st.blocked[i + N + 1]) continue; // counted as permanent
      n++;
    }
  return n * SOFT * W.hole + cost;
}

function partialScore(ctx: Ctx, st: State): number {
  return (
    W.fail * st.failed + permanentHoles(ctx.N, st.owner, st.blocked) + softHoles(ctx, st) + W.split * st.splits +
    W.uturn * st.uturns + W.stretch * st.stretch
  );
}

function finish(ctx: Ctx, st: State): Result {
  const { N } = ctx;
  const owner = st.owner.slice();
  const ink2 = count2x2(N, owner, true);
  const holesBefore = count2x2(N, owner, false);
  const { dots, squares } = fillPass(N, owner, new Set(st.dotted));
  const holes = count2x2(N, owner, false);
  const edge = edgeGaps(N, owner);
  const score =
    W.fail * st.failed + W.ink2 * ink2 + W.hole * holes + W.edge * edge + W.dot * dots + W.square * squares +
    W.split * st.splits + W.uturn * st.uturns + W.stretch * st.stretch;
  const lines = st.lines.map((L, k) => (L ? `line ${k}: rot ${L.rot} base ${L.base}` : "")).filter((x) => x);
  return {
    N, owner, wordOf: st.wordOf, score, holes, edge, ink2, holesBefore, failed: st.failed, dots, squares,
    placements: st.placements ?? [], lines,
  };
}

function evaluate(ctx: Ctx, g: Genome, keep = false): Result {
  const st = initState(ctx, keep);
  for (let pi = 0; pi < ctx.P.pieces.length; pi++) placePiece(ctx, g, st, pi);
  return finish(ctx, st);
}

// ---------------------------------------------------------------------------
// Search: a beam over pieces in reading order
// ---------------------------------------------------------------------------

function defaultGenome(ctx: Ctx): Genome {
  const g = randomGenome(ctx);
  g.alt.fill(0);
  g.cnt = g.cnt.map(() => [0, 0]);
  g.inc.fill(0);
  return g;
}

function pickW(opts: number[], w: number[]): number {
  let t = Math.random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < opts.length; i++) if ((t -= w[i]) <= 0) return opts[i];
  return opts[opts.length - 1];
}

/** Fresh random choices for piece pi's genes (and the lines it may open). */
function samplePiece(ctx: Ctx, g: Genome, pi: number, prevLine: number) {
  const { P } = ctx;
  if (pi > 0) g.inc[pi] = pickW([0, 1, 2], [5, 4, 1]);
  for (const li of P.pieces[pi].letters) {
    const l = P.letters[li];
    g.alt[li] = rint(Math.max(l.cands.length, l.entry.length, 1));
    const gl = l.cands[g.alt[li] % Math.max(l.cands.length, 1)];
    g.cnt[li] = [0, 0];
    gl?.stretch.forEach((s, k) => {
      g.cnt[li][k] =
        s.axis === "row" ? pickW([0, -(s.min ?? 0), 1, 2, 4, 6], [4, 3, 1, 1, 1, 1]) : pickW([0, 1, 2, 3, 5], [5, 2, 1, 1, 1]);
    });
    g.jext[li] = l.joinsNext ? pickW([0, 1, 2], [6, 3, 1]) : 0;
    g.uturn[li] = ctx.eligible[li] ? rint(2) : 0;
    g.climb[li] = ctx.eligible[li] ? rint(5) - 4 + rint(3) : 0;
  }
  sampleLines(ctx, g, prevLine + 1, prevLine + 4);
}
function sampleLines(ctx: Ctx, g: Genome, from: number, to: number) {
  for (let k = Math.max(0, from); k <= to && k < ctx.nLines; k++) {
    g.off[k] = k < 4 ? pickW([0, 1, 2], [6, 1, 2]) : rint(RINGK_OFF.length);
    g.start[k] = pickW([0, 1, 2, 3, 4, 5, 6], [8, 2, 2, 1, 1, 1, 1]);
  }
}

type Beam = { g: Genome; st: State; score: number };

/**
 * Coordinate descent on piece pi: for each choice in turn (the line step, the
 * offset and start of a line it opens, then every letter's alternate x stretch
 * counts, its join run and U-turn), try every value with the rest fixed and
 * keep the best. Two sweeps.
 */
function optimizePiece(ctx: Ctx, g0: Genome, base: State, pi: number, prevLine: number): { g: Genome; st: State; sc: number; evals: number } {
  const evalPartial = (cand: Genome) => {
    const s2 = cloneState(base);
    placePiece(ctx, cand, s2, pi);
    return pi === ctx.P.pieces.length - 1 ? finish(ctx, s2).score : partialScore(ctx, s2);
  };
  const o = descendPiece(ctx, g0, pi, prevLine, evalPartial(g0), evalPartial, 2);
  const st = cloneState(base);
  placePiece(ctx, o.g, st, pi);
  return { g: o.g, st, sc: o.sc, evals: o.evals };
}

/** Coordinate descent over piece pi's choices against any objective. */
function descendPiece(
  ctx: Ctx, g0: Genome, pi: number, prevLine: number, sc0: number, evalFn: (g: Genome) => number, sweeps: number
): { g: Genome; sc: number; evals: number } {
  let g = g0;
  let sc = sc0;
  let evals = 0;
  const tryG = (cand: Genome) => {
    const v = evalFn(cand);
    evals++;
    if (v < sc) {
      g = cand;
      sc = v;
    }
  };
  const { P } = ctx;
  for (let sweep = 0; sweep < sweeps; sweep++) {
    if (pi > 0)
      for (const inc of [0, 1, 2]) {
        if (inc === g.inc[pi]) continue;
        const c = clone(g);
        c.inc[pi] = inc;
        tryG(c);
        // with the line it opens set afresh
        const ln = prevLine + inc;
        if (inc > 0 && ln < ctx.nLines) {
          const nOff = ln < 4 ? RING0_OFF.length : RINGK_OFF.length;
          for (let o = 0; o < nOff; o++)
            for (let s0 = 0; s0 <= MAX_START; s0 += 2) {
              const c2 = clone(c);
              c2.off[ln] = o;
              c2.start[ln] = s0;
              tryG(c2);
            }
        }
      }
    const line = pi === 0 ? 0 : prevLine + g.inc[pi];
    if ((line > prevLine || pi === 0) && line < ctx.nLines) {
      const nOff = line < 4 ? RING0_OFF.length : RINGK_OFF.length;
      for (let o = 0; o < nOff; o++)
        for (let s0 = 0; s0 <= MAX_START; s0++) {
          if (o === g.off[line] && s0 === g.start[line]) continue;
          const c = clone(g);
          c.off[line] = o;
          c.start[line] = s0;
          tryG(c);
        }
    }
    const order = P.pieces[pi].letters.slice().sort(() => Math.random() - 0.5);
    for (const li of order) {
      const l = P.letters[li];
      const nAlt = Math.max(l.cands.length, l.entry.length, 1);
      for (let a = 0; a < nAlt; a++) {
        const gl = l.cands[a % Math.max(l.cands.length, 1)];
        const range = (k: number): number[] => {
          const s = gl?.stretch[k];
          if (!s) return [0];
          const lo = -(s.min ?? 0);
          const hi = s.axis === "row" ? 6 : 5;
          const out: number[] = [];
          for (let v = lo; v <= hi; v++) out.push(v);
          return out;
        };
        const exts = l.joinsNext ? [0, 1, 2] : [g.jext[li]];
        for (const c0 of range(0))
          for (const c1 of range(1))
            for (const e of exts) {
              if (a === g.alt[li] && c0 === g.cnt[li][0] && c1 === g.cnt[li][1] && e === g.jext[li]) continue;
              const c = clone(g);
              c.alt[li] = a;
              c.cnt[li] = [c0, c1];
              c.jext[li] = e;
              tryG(c);
            }
      }
      if (l.joinsNext)
        for (const e of [0, 1, 2]) {
          if (e === g.jext[li]) continue;
          const c = clone(g);
          c.jext[li] = e;
          tryG(c);
        }
      if (ctx.eligible[li])
        for (const u of [0, 1])
          for (let cl = -4; cl <= 3; cl++) {
            if (u === g.uturn[li] && cl === g.climb[li]) continue;
            const c = clone(g);
            c.uturn[li] = u;
            c.climb[li] = cl;
            tryG(c);
          }
    }
  }
  return { g, sc, evals };
}

function stateKey(st: State): string {
  let h = 0;
  for (let i = 0; i < st.owner.length; i++) if (st.owner[i] !== 0) h = (h * 31 + i + 7) | 0;
  return `${h}:${st.line}:${st.cursor[st.line]}:${st.failed}`;
}

/**
 * A beam over pieces p..end, starting from `start` (the state and genome of
 * pieces 0..p-1). Each child samples the piece's choices afresh, then descends
 * them on the partial score; the last stage is scored on the finished panel.
 */
function runBeam(
  ctx: Ctx, start: { g: Genome; st: State }, p: number, B: number, K: number, debug: boolean, deadline: number
): { best: Beam | null; evals: number } {
  const nP = ctx.P.pieces.length;
  let evals = 0;
  let beam: Beam[] = [{ g: clone(start.g), st: cloneState(start.st), score: 0 }];
  if (p === 0) sampleLines(ctx, beam[0].g, 0, 3);
  for (let pi = p; pi < nP; pi++) {
    const kids: Beam[] = [];
    for (const b of beam) {
      const prevLine = pi === 0 ? 0 : b.st.line;
      const kidsPer = Math.max(K, Math.ceil((B * 3) / beam.length));
      for (let k = 0; k < kidsPer; k++) {
        if (Date.now() > deadline && kids.length > 0) break;
        const g0 = clone(b.g);
        samplePiece(ctx, g0, pi, prevLine);
        const o = optimizePiece(ctx, g0, b.st, pi, prevLine);
        evals += o.evals;
        const { g, st } = o;
        let sc = o.sc;
        if (pi === nP - 1) sc = finish(ctx, st).score;
        kids.push({ g, st, score: sc + Math.random() * 0.01 });
      }
    }
    kids.sort((a, b) => a.score - b.score);
    const seen = new Set<string>();
    beam = [];
    for (const k of kids) {
      const key = stateKey(k.st);
      if (seen.has(key)) continue;
      seen.add(key);
      beam.push(k);
      if (beam.length >= B) break;
    }
    if (debug) {
      console.log(`stage ${pi}: kids ${kids.length}, kept ${beam.length}, best ${beam[0]?.score.toFixed(1)}, median ${beam[beam.length >> 1]?.score.toFixed(1)}`);
      if (beam[0]) {
        const rep = initState(ctx, false);
        for (let q = 0; q <= pi; q++) placePiece(ctx, beam[0].g, rep, q);
        let diff = 0;
        for (let i = 0; i < rep.owner.length; i++) if ((rep.owner[i] !== 0) !== (beam[0].st.owner[i] !== 0)) diff++;
        console.log(`  replay differs in ${diff} cells`);
        const r = evaluate(ctx, beam[0].g, true);
        console.log(`  failed ${r.failed} holes ${r.holes} | ${r.placements.map((q) => `L${q.line}:${q.text}`).join(" ")}`);
        if (pi >= nP - 2) console.log(asText(r));
      }
    }
  }
  return { best: beam[0] ?? null, evals };
}

/** Every alternate x first-slice count for two neighbouring letters of piece pi together; best wins. */
function descendPairs(ctx: Ctx, g0: Genome, pi: number, sc0: number, evalFn: (g: Genome) => number): { g: Genome; sc: number; evals: number } {
  const ls = ctx.P.pieces[pi].letters;
  let g = g0, sc = sc0, evals = 0;
  const options = (li: number): Array<[number, number]> => {
    const l = ctx.P.letters[li];
    const out: Array<[number, number]> = [];
    const nAlt = Math.max(l.cands.length, 1);
    for (let a = 0; a < nAlt; a++) {
      const s = l.cands[a]?.stretch[0];
      if (!s) out.push([a, 0]);
      else for (let v = -(s.min ?? 0); v <= (s.axis === "row" ? 6 : 4); v++) out.push([a, v]);
    }
    return out;
  };
  for (let k = 0; k + 1 < ls.length; k++) {
    const A = ls[k], Bl = ls[k + 1];
    const oa = options(A), ob = options(Bl);
    const base = g;
    for (const [aa, ca] of oa)
      for (const [ab, cb] of ob) {
        const c = clone(base);
        c.alt[A] = aa;
        c.cnt[A] = [ca, base.cnt[A][1]];
        c.alt[Bl] = ab;
        c.cnt[Bl] = [cb, base.cnt[Bl][1]];
        for (const e of ctx.P.letters[A].joinsNext ? [0, 1] : [base.jext[A]]) {
          const c2 = e === c.jext[A] ? c : clone(c);
          c2.jext[A] = e;
          const v = evalFn(c2);
          evals++;
          if (v < sc - 1e-9) {
            g = c2;
            sc = v;
          }
        }
      }
  }
  return { g, sc, evals };
}

function search(ctx: Ctx, seconds: number): { best: Genome; res: Result; evals: number; restarts: number; ms: number } {
  const t0 = Date.now();
  const B = Number(process.env.BEAM ?? 100);
  const K = Number(process.env.KIDS ?? 4);
  const nP = ctx.P.pieces.length;
  let evals = 0;
  let restarts = 1;
  const prefixOf = (gg: Genome): State[] => {
    const out: State[] = [];
    const st = initState(ctx, false);
    for (let pi = 0; pi < nP; pi++) {
      out.push(cloneState(st));
      placePiece(ctx, gg, st, pi);
    }
    return out;
  };

  const first = runBeam(ctx, { g: defaultGenome(ctx), st: initState(ctx, false) }, 0, B, K, !!process.env.DEBUG, t0 + seconds * 600);
  evals += first.evals;
  let g = first.best?.g ?? defaultGenome(ctx);
  let cur = evaluate(ctx, g).score;
  let best = clone(g);
  let bestScore = cur;
  let prefix = prefixOf(g);

  // Iterated local search on the true score: descend every piece's choices
  // (later pieces re-placed from a cached prefix); when stuck, re-run a
  // smaller beam over the whole suffix from a random piece onward.
  while (Date.now() - t0 < seconds * 1000) {
    let improved = false;
    const order = Array.from({ length: nP }, (_, i) => i).sort(() => Math.random() - 0.5);
    for (const pi of order) {
      if (Date.now() - t0 > seconds * 1000) break;
      const base = prefix[pi];
      const evalFull = (cand: Genome) => {
        const st = cloneState(base);
        for (let q = pi; q < nP; q++) placePiece(ctx, cand, st, q);
        return finish(ctx, st).score;
      };
      const o = descendPiece(ctx, g, pi, pi === 0 ? 0 : base.line, cur, evalFull, 1);
      evals += o.evals;
      if (o.sc < cur - 1e-9) {
        g = o.g;
        cur = o.sc;
        prefix = prefixOf(g);
        improved = true;
      }
    }
    if (!improved) {
      // pair moves: two neighbouring letters' shapes changed together
      for (let pi = 0; pi < nP && !improved && Date.now() - t0 < seconds * 1000; pi++) {
        const base = prefix[pi];
        const evalFull = (cand: Genome) => {
          const st = cloneState(base);
          for (let q = pi; q < nP; q++) placePiece(ctx, cand, st, q);
          return finish(ctx, st).score;
        };
        const o = descendPairs(ctx, g, pi, cur, evalFull);
        evals += o.evals;
        if (o.sc < cur - 1e-9) {
          g = o.g;
          cur = o.sc;
          prefix = prefixOf(g);
          improved = true;
        }
      }
    }
    if (cur < bestScore) {
      bestScore = cur;
      best = clone(g);
    }
    if (!improved) {
      restarts++;
      const from = clone(best);
      const pre = prefixOf(from);
      const p = rint(nP);
      const r = runBeam(ctx, { g: from, st: pre[p] }, p, Math.max(10, B >> 2), K, false, t0 + seconds * 1000);
      evals += r.evals;
      if (r.best) {
        g = r.best.g;
        cur = evaluate(ctx, g).score;
        prefix = prefixOf(g);
      }
    }
  }
  return { best, res: evaluate(ctx, best, true), evals, restarts, ms: Date.now() - t0 };
}

// ---------------------------------------------------------------------------
// Check: the reference configuration expressed as a genome
// ---------------------------------------------------------------------------

function refGenome(ctx: Ctx): Genome {
  const g = randomGenome(ctx);
  const pick = (i: number, id: string, counts: number[] = [0, 0], entry = false) => {
    const list = entry ? ctx.P.letters[i].entry : ctx.P.letters[i].cands;
    const k = list.findIndex((x) => x.id === id);
    if (k < 0) throw new Error(`ref: no ${id} for letter ${i}`);
    g.alt[i] = k;
    g.cnt[i] = counts;
  };
  // letters: 0 لا, 1 ي, 2 ك, 3 ل, 4 ف, 5 الله, 6 ن, 7 ف, 8 س, 9 ا, 10 ا, 11 لا, 12 و, 13 س, 14 ع, 15 ه, 16 ا
  pick(0, "lamAlef.isolated.1");
  pick(1, "yeh.initial.1");
  pick(2, "kaf.medial.2");
  pick(3, "lam.medial.0", [-2]);
  pick(4, "feh.final.3");
  pick(5, "allah.isolated.2");
  pick(6, "noon.initial.2");
  pick(7, "feh.medial.0");
  pick(8, "seen.medial.0");
  pick(9, "alef.final.0", [4]);
  pick(10, "alef.isolated.0");
  pick(11, "lamAlef.isolated.0");
  pick(12, "waw.isolated.0");
  pick(13, "seen.initial.0");
  pick(14, "ain.medial.0");
  pick(15, "heh.medial.2", [0, 0], true);
  pick(16, "alef.final.0");
  // pieces: لا | يكلف | الله | نفسا | ا | لا | و | سعها
  g.inc = [0, 0, 1, 1, 0, 0, 1, 1];
  g.jext[6] = 1; // the noon's join run, one cell longer
  g.uturn[14] = 1;
  g.climb[14] = 0;
  g.off = g.off.map(() => 0);
  g.off[3] = 2; // right edge: baseline two in, for the waw's tail
  g.off[4] = 2; // inner bottom at its template distance (6)
  g.start = g.start.map(() => 0);
  return g;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const REF21 = fs
  .readFileSync(`${LOCAL}/spike2/ref21.txt`, "utf8")
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l.length);

function asText(res: Result): string {
  const { N, owner } = res;
  const out: string[] = [];
  for (let r = 0; r < N; r++) {
    let s = "";
    for (let c = 0; c < N; c++) s += owner[r * N + c] === 0 ? "." : owner[r * N + c] < 0 ? "o" : "#";
    out.push(s);
  }
  return out.join("\n");
}

/**
 * Joins intact: every unit's ink (a run of joined letters, with its U-turn
 * continuation) is one 4-connected piece. The gapped الله is drawn in 3.
 * Returns the texts of units that are broken.
 */
function brokenJoins(res: Result): string[] {
  const { N, owner } = res;
  const seen = new Uint8Array(N * N);
  const comps = new Map<number, number>();
  for (let i = 0; i < N * N; i++) {
    if (owner[i] <= 0 || seen[i]) continue;
    const id = owner[i];
    comps.set(id, (comps.get(id) ?? 0) + 1);
    const stack = [i];
    seen[i] = 1;
    while (stack.length) {
      const j = stack.pop() as number;
      const r = (j / N) | 0, c = j % N;
      for (const [dr, dc] of NB) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
        const k = rr * N + cc;
        if (!seen[k] && owner[k] === id) {
          seen[k] = 1;
          stack.push(k);
        }
      }
    }
  }
  const textOf = new Map<number, string>();
  for (const p of res.placements) {
    const [r, c] = p.cells[0];
    const id = owner[r * N + c];
    textOf.set(id, (textOf.get(id) ?? "") + p.text);
  }
  const out: string[] = [];
  for (const [id, n] of comps) {
    const t = textOf.get(id) ?? "?";
    if (n > 1 && !(t === "الله" && n <= 3)) out.push(`${t} (${n} pieces)`);
  }
  return out;
}

function agreement(res: Result): number {
  if (res.N !== REF21.length) return -1;
  let m = 0;
  for (let r = 0; r < res.N; r++)
    for (let c = 0; c < res.N; c++) if ((res.owner[r * res.N + c] !== 0) === (REF21[r][c] === "#")) m++;
  return m;
}

const PALETTE = ["#b33", "#2a6", "#36b", "#a5b", "#c80", "#088", "#666", "#b36", "#583", "#348"];
function svgOf(res: Result, px: number, colour: boolean): string {
  const { N, owner, wordOf } = res;
  const pad = px;
  const S = N * px + 2 * pad;
  let rects = "";
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      const o = owner[r * N + c];
      if (!o) continue;
      const fill = colour ? (o < 0 ? "#000" : PALETTE[wordOf[r * N + c] % PALETTE.length]) : "#111";
      rects += `<rect x="${pad + c * px}" y="${pad + r * px}" width="${px + 0.6}" height="${px + 0.6}" fill="${fill}"/>`;
    }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}"><rect width="${S}" height="${S}" fill="#fbf8f1"/>${rects}</svg>`;
}

function shoot(html: string, png: string, w: number, h: number) {
  const file = png.replace(/\.png$/, ".html");
  fs.writeFileSync(file, html);
  if (!BROWSER) {
    console.error(`arrange.ts: set KUFI_BROWSER to a Chromium-based browser executable to render ${png}; the HTML is at ${file}.`);
    return;
  }
  execFileSync(BROWSER, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
    `--window-size=${w},${h}`, `--screenshot=${png}`, "file:///" + file,
  ], { stdio: "ignore" });
}

type Job = {
  key: string;
  title: string;
  text: string;
  sizes: number[];
  show: number; // how many sizes to show
  secs: number; // search budget per size
  ref: { file: string; crop?: { x: number; y: number; w: number; h: number; W: number; H: number }; caption: string };
};

const JOBS: Job[] = [
  {
    key: "baqarah",
    title: "Al-Baqarah 2:286",
    text: "لا يكلف الله نفسا إلا وسعها",
    sizes: [21],
    show: 1,
    secs: 180,
    ref: { file: "2527ed6b4a8432375c3bc78c392bcf14.jpg", crop: { x: 22, y: 26, w: 163, h: 164, W: 208, H: 280 }, caption: "Your reference panel (21 x 21)" },
  },
  {
    key: "allah",
    title: "Allah",
    text: "الله",
    sizes: [9, 10, 11, 12, 13, 14, 15],
    show: 3,
    secs: 15,
    ref: { file: "images (1).jpg", caption: "Your reference: four Allahs turned round a centre (a different layout from one word in one box)" },
  },
  {
    key: "shahada",
    title: "Shahada",
    text: "لا إله إلا الله محمد رسول الله",
    sizes: [21, 22, 23, 24, 25, 26],
    show: 3,
    secs: 120,
    ref: { file: "images.jpg", caption: "No exact reference for this text. Shown for comparison: the mosaic wall photo" },
  },
];

/** Packed: no empty 2x2, no double break in the frame, no solid 2x2, every letter placed. */
const isPacked = (r: Result) => r.holes === 0 && r.edge === 0 && r.ink2 === 0 && r.failed === 0;

type Run = { N: number; res: Result; ms: number; evals: number; restarts: number; agree: number; genome: Genome; broken: string[] };

async function runJob(job: Job, seconds: number): Promise<Run[]> {
  const P = phraseOf(job.text);
  const runs: Run[] = [];
  let log = `${job.title}: ${job.text}\npieces: ${P.pieces.map((p) => p.letters.map((i) => P.letters[i].ch).join("")).join(" | ")}\n`;
  if (job.key === "baqarah") {
    const ctx = ctxOf(21, P);
    {
      const g = refGenome(ctx);
      const st = initState(ctx, false);
      const parts: string[] = [];
      for (let pi = 0; pi < P.pieces.length; pi++) {
        placePiece(ctx, g, st, pi);
        parts.push(partialScore(ctx, st).toFixed(1));
      }
      log += `reference partial scores by piece: ${parts.join(" ")}`;
    }
    const r = evaluate(ctx, refGenome(ctx), true);
    log += `\nCHECK: the reference arrangement written as a genome -> holes ${r.holes}, ink2x2 ${r.ink2}, failed ${r.failed}, fills ${r.dots}+${r.squares}, agreement ${agreement(r)}/441, score ${r.score.toFixed(1)}\n${asText(r)}\n`;
    console.log(log);
  }
  let packedShown = 0;
  for (const N of job.sizes) {
    const ctx = ctxOf(N, P);
    const s = await parallelSearch(job, ctx, seconds);
    const agree = job.key === "baqarah" ? agreement(s.res) : -1;
    const broken = brokenJoins(s.res);
    runs.push({ N, res: s.res, ms: s.ms, evals: s.evals, restarts: s.restarts, agree, genome: s.best, broken });
    const r = s.res;
    const line = `\n== ${N} x ${N}: score ${r.score.toFixed(1)} holes ${r.holes} edge-gaps ${r.edge} ink2x2 ${r.ink2} failed ${r.failed} holes-before-fills ${r.holesBefore} dots ${r.dots} squares ${r.squares}${agree >= 0 ? ` agree ${agree}/441` : ""} | ${s.ms} ms, ${s.evals} evals, ${s.restarts} restarts | joins ${broken.length ? "BROKEN: " + broken.join(", ") : "intact"}\n`;
    const place = r.placements.map((p) => `  line ${p.line} rot ${p.rot}: ${p.text}`).join("\n");
    const alts = s.best.alt.map((_, i) => {
      const l = P.letters[i];
      const entry = false;
      const list = entry ? l.entry : l.cands;
      return `${l.ch}:${list[s.best.alt[i] % Math.max(list.length, 1)]?.id ?? "?"}[${s.best.cnt[i].join(",")}]`;
    }).join(" ");
    log += line + place + "\n  " + alts + "\n" + asText(r) + "\n";
    console.log(line + place + "\n" + asText(r));
    fs.writeFileSync(`${OUT}/${job.key}-${N}.svg`, svgOf(r, 16, false));
    fs.writeFileSync(`${OUT}/${job.key}-${N}-words.svg`, svgOf(r, 16, true));
    if (isPacked(r)) packedShown++;
    if (packedShown >= job.show && job.key !== "allah") break;
  }
  fs.writeFileSync(`${OUT}/${job.key}-log.txt`, log);
  return runs;
}

function sheet(job: Job, runs: Run[]) {
  // smallest sizes that pack; if none pack, the best attempts
  // the smallest sizes that pack; when fewer pack than wanted, the best attempts that don't
  const packed = runs.filter((r) => isPacked(r.res)).sort((a, b) => a.N - b.N);
  const rest = runs.filter((r) => !isPacked(r.res)).sort((a, b) => a.res.score - b.res.score);
  const shown = [...packed.slice(0, job.show), ...rest].slice(0, job.show).sort((a, b) => a.N - b.N);
  const panelPx = 420;
  const cards = shown
    .map((r) => {
      const px = Math.floor(panelPx / (r.N + 2));
      const ok = isPacked(r.res);
      const gaps = r.res.holes + r.res.edge;
      const cap = `${r.N} x ${r.N} — ${ok ? "packed" : r.res.failed ? `does not fit (${r.res.failed} letters left out), ${gaps} gaps` : `has ${gaps} gap${gaps === 1 ? "" : "s"}`}`;
      return `<figure><div class="p">${svgOf(r.res, px, false)}</div><figcaption>${cap}</figcaption></figure>`;
    })
    .join("");
  const ref = job.ref;
  const img = ref.crop
    ? `<div style="width:${panelPx}px;height:${Math.round((panelPx * ref.crop.h) / ref.crop.w)}px;overflow:hidden;position:relative"><img src="file:///${REFS}/${ref.file}" style="position:absolute;left:${-(ref.crop.x * panelPx) / ref.crop.w}px;top:${-(ref.crop.y * panelPx) / ref.crop.w}px;width:${(ref.crop.W * panelPx) / ref.crop.w}px"></div>`
    : `<img src="file:///${REFS}/${ref.file}" style="max-width:${panelPx}px;max-height:${panelPx + 120}px">`;
  const width = shown.length * (panelPx + 40) + panelPx + 120;
  const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#fff;font:18px/1.35 system-ui,sans-serif;color:#222;padding:24px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;font-weight:400;margin:0 0 20px;color:#555}
.row{display:flex;gap:40px;align-items:flex-start}.ours{display:flex;gap:28px}
figure{margin:0}figcaption{margin-top:8px;font-size:17px;max-width:${panelPx}px}
.ref{border-left:2px solid #ddd;padding-left:36px}.lab{font-size:15px;color:#777;margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em}
</style><h1>Does this read like a real panel?</h1><h2>${job.title} — <span dir="rtl">${job.text}</span></h2>
<div class="row"><div><div class="lab">Made by the app from the text and the box size</div><div class="ours">${cards}</div></div>
<div class="ref"><div class="lab">Reference</div>${img}<figcaption>${ref.caption}</figcaption></div></div>`;
  shoot(html, `${OUT}/sheet-${job.key}.png`, width, panelPx + 380);
}

const WORKERS = 7;
type WorkerMsg = { genome: Genome; evals: number; restarts: number };

/** Restarts in parallel: forked copies of this script, each annealing on its own for the budget. */
async function parallelSearch(job: Job, ctx: Ctx, seconds: number) {
  const t0 = Date.now();
  const script = process.argv[1];
  const msgs = await Promise.all(
    Array.from({ length: WORKERS }, () =>
      new Promise<WorkerMsg | null>((resolve) => {
        const cp = fork(script, ["--worker", job.key, String(ctx.N), String(seconds)], { stdio: "ignore" });
        let got: WorkerMsg | null = null;
        cp.on("message", (m) => (got = m as WorkerMsg));
        cp.on("exit", () => resolve(got));
      })
    )
  );
  let best: { genome: Genome; res: Result } | null = null;
  let evals = 0, restarts = 0;
  for (const m of msgs) {
    if (!m) continue;
    evals += m.evals;
    restarts += m.restarts;
    const res = evaluate(ctx, m.genome, true);
    if (!best || res.score < best.res.score) best = { genome: m.genome, res };
  }
  if (!best) throw new Error("no worker returned");
  return { best: best.genome, res: best.res, evals, restarts, ms: Date.now() - t0 };
}

if (process.argv[2] === "--worker") {
  const [, , , key, n, sec] = process.argv;
  const job = JOBS.find((j) => j.key === key);
  if (!job) throw new Error(`no job ${key}`);
  const ctx = ctxOf(Number(n), phraseOf(job.text));
  const s = search(ctx, Number(sec));
  process.send?.({ genome: s.best, evals: s.evals, restarts: s.restarts } satisfies WorkerMsg, () => process.exit(0));
} else {
  const which = process.argv[2] ?? "all";
  const secsArg = process.argv[3] ? Number(process.argv[3]) : null;
  const summary: string[] = [];
  for (const job of JOBS) {
    if (which !== "all" && which !== job.key) continue;
    const runs = await runJob(job, secsArg ?? job.secs);
    sheet(job, runs);
    for (const r of runs)
      summary.push(`${job.key} | ${r.N} | holes ${r.res.holes} | edge ${r.res.edge} | ink2 ${r.res.ink2} | failed ${r.res.failed} | before-fills ${r.res.holesBefore} | dots ${r.res.dots} | squares ${r.res.squares} | agree ${r.agree} | ${r.ms} ms | ${r.evals} evals | joins ${r.broken.length ? "BROKEN" : "intact"}`);
  }
  console.log(["", ...summary].join(String.fromCharCode(10)));
  fs.writeFileSync(`${OUT}/summary-${which}.txt`, [...summary, ""].join(String.fromCharCode(10)));
}
