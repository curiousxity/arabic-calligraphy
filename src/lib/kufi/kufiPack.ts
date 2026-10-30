/**
 * The square-Kufi packer: text and a box size in cells in, a packed lattice
 * panel out. Pure: no React, no Konva, no `./harfbuzz`.
 *
 * ## The structure (read off a real panel)
 *
 * Words run clockwise round the frame from the bottom right, every baseline
 * on the outer edge: the bottom line upright, read right to left; the left
 * line turned 90° and read upwards; the top line upside down, read left to
 * right; the right line turned 270° and read downwards. Then a ring inside,
 * about one band (5 cells and a gap) further in, and so on: the core.
 *
 * - A line holds whole pieces (runs of joined letters). A word never bends
 *   round a corner: it breaks only between pieces, or turns back on itself
 *   through `join.uturn.0` into a letter joined at its top, continuing upside
 *   down on a line of its own.
 * - A piece slides along its line from where the last one ended until its ink
 *   neither overlaps nor touches anything placed before it. That is what
 *   interlocks the bands: a short letter lets the next line's ink come within
 *   one gap, and an edge ends on a tall stroke running on along the next.
 * - Tall strokes stretch or shorten (never below the table's minimum), wide
 *   strokes stretch, alternates swap. The packer chooses all of these.
 * - A dotted letter carries its whole dot set from `dotCells`, or none. Dots
 *   are never filler. A lone square may plug a hole, but never where it could
 *   be read as a letter's dot.
 *
 * ## The search
 *
 * Letters are placed in reading order, so order holds by construction. Each
 * letter's choices (line, alternate, stretch, join run, U-turn and its climb,
 * dots) are enumerated in full, scored in place and undone; a beam keeps the
 * best distinct panels. A partial panel is scored by the holes nothing later
 * can close (empty 2×2 whose cells all touch finished ink: a lower bound),
 * plus the open windows in band areas the reading order has already passed.
 * Beams widen pass by pass until a pass packs or the time budget runs out;
 * every pass is deterministic, so the same input always gives the same panel.
 */

import type { JoiningForm } from "../arabicJoining";
import {
  KUFI_FORMS,
  KUFI_JOINS,
  dotCells,
  dotKey,
  dotsOf,
  joinCol,
  joinRow,
  stretchGlyph,
  stretchedBase,
  type KufiDotKey,
  type KufiGlyph,
} from "./kufiAlphabet";
import { emptyBlocks2x2, inkBlocks2x2, type Turn } from "./kufiGrid";
import { resolveKufiText, type KufiUnit } from "./kufiWords";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** One unit's letter as placed: its box's top-left cell after turning, and how it was turned and stretched. */
export type KufiPlacement = {
  unitIndex: number;
  key: string;
  glyphId: string;
  col: number;
  row: number;
  turn: Turn;
  stretch: number[];
};

/** A painted (`on`) or erased cell, as an offset from the unit's placed box. */
export type KufiCellEdit = { unitIndex: number; key: string; dx: number; dy: number; on: boolean };

/**
 * The user's edits. Maps are keyed by unit index, except `routes`, keyed by
 * word index: an offset in cells along that word's line, further on in
 * reading order than where it would slide to.
 *
 * Only `pinned` fixes a unit's place. A `forms` or `stretch` edit keeps the
 * edit, not the position: the unit takes that form or those counts wherever
 * its line now puts it (a ruling on the plan's "any unit carrying an edit is
 * pinned", which its own stability test contradicts).
 */
export type KufiPanelEdits = {
  forms?: Record<number, string>;
  stretch?: Record<number, number[]>;
  routes?: Record<number, number>;
  pinned?: Record<number, KufiPlacement>;
  cells?: KufiCellEdit[];
};

export type KufiPackResult =
  | {
      ok: true;
      cols: number;
      rows: number;
      cells: Uint8Array;
      placements: KufiPlacement[];
      /** True when the painted or erased cells of `edits.cells` leave a hole, a solid 2×2 or a frame break: the packing itself was sound. */
      editsBreakPacking: boolean;
    }
  | { ok: false; reason: "tooShort" | "tooLong" | "pinConflict"; suggestions: Array<{ cols: number; rows: number }> };

// ---------------------------------------------------------------------------
// Dials
// ---------------------------------------------------------------------------

/** Band depth: a 5-row band stands on every line. */
const BAND = 5;
/** Most cells a row slice may grow by. */
const ROW_MAX = 6;
/** Most cells a column slice may grow by. */
const COL_MAX = 4;
/** Longest straight join run beyond the overlapped stubs. */
const JEXT_MAX = 2;
/** The U-turn's climb, relative to its authored 6. */
const CLIMB_MIN = -4;
const CLIMB_MAX = 3;
/** A fill square must close at least this many windows (empty 2×2, or a double break in the frame). */
const FILL_MIN = 3;

/** Time a first draft's search may take. The editor runs it off the main thread; nothing waits on it. */
export const PACK_BUDGET_MS = 1400;
/** Time a repack from `previous` may take. */
export const REPACK_BUDGET_MS = 150;
/** Beam widths tried in turn until one packs or the budget runs out. */
const BEAMS = [6, 12, 24];

const W = {
  fail: 300,
  ink2: 300,
  hole: 10,
  edge: 6,
  square: 25,
  split: 2,
  uturn: 1,
  stretch: 0.04,
  dotsOff: 0.05,
  soft: 0.6,
};

// ---------------------------------------------------------------------------
// Letters and shapes
// ---------------------------------------------------------------------------

type Shape = {
  g: KufiGlyph;
  counts: number[];
  w: number;
  h: number;
  /** Row of the box (top = 0) the baseline runs through. */
  baseRow: number;
  /** Ink cells as (j, y): column in the box, height above the baseline. */
  ink: Int16Array;
  rStub: [number, number] | null;
  lStub: [number, number] | null;
  minJ: number;
  maxJ: number;
  /** Every authored dot set's cells as (j, y), by key. */
  dots: Partial<Record<KufiDotKey, Int16Array>>;
  /** Cells added over every slice (shortening is free). */
  cost: number;
};

type Letter = {
  index: number;
  unit: KufiUnit;
  ch: string;
  /** Letters it stands for (الله 4, لا 2). */
  weight: number;
  cands: Shape[];
  entry: Shape[];
  joinsNext: boolean;
  joinedPrev: boolean;
  word: number;
  /** The letter's own dot pattern, or null. */
  dotKey: KufiDotKey | null;
  pin: Pin | null;
  /** For a tall letter (ا ل لا), the tallest stem its form's alternates are authored with, in rows; else -1. */
  natural: number;
  /** Pinned, or stretched by the user: its length is the user's, not counted as deviation. */
  exempt: boolean;
};

const TALL = new Set(["alef", "lam", "lamAlef"]);
/**
 * Orders a letter's alternatives nearest natural length first, for the moves
 * that look for one: a cell of cut outweighs this many cells of growth. The
 * ranking of whole panels (`better`) compares cut and growth strictly in turn.
 */
const CUT_WEIGHT = 100;

/**
 * How far a placed shape is from its letter's natural length, as cells cut
 * and cells grown: every slice's count, and for a tall letter its stem against
 * the tallest stem its allowed glyphs are authored with, so a short alternate
 * counts as a cut stem. A letter the user pinned or stretched has none.
 */
function devParts(letter: Letter, sh: Shape): { cut: number; grow: number } {
  if (letter.exempt) return { cut: 0, grow: 0 };
  let cut = 0;
  let grow = 0;
  sh.g.stretch.forEach((sl, i) => {
    if (letter.natural >= 0 && sl.axis === "row") return;
    const n = sh.counts[i] ?? 0;
    if (n < 0) cut -= n;
    else grow += n;
  });
  if (letter.natural >= 0) {
    const stem = sh.baseRow + 1;
    if (stem < letter.natural) cut += letter.natural - stem;
    else grow += stem - letter.natural;
  }
  return { cut, grow };
}

/** `devParts` as one number, for ordering a letter's alternatives (see CUT_WEIGHT). */
function devOf(letter: Letter, sh: Shape): number {
  const d = devParts(letter, sh);
  return CUT_WEIGHT * d.cut + d.grow;
}

/** A hard placement: glyph, counts and box, and optionally how its dots are drawn (see `DOT_SHIFT`). */
type Pin = {
  glyphId: string;
  counts: number[];
  col: number;
  row: number;
  turn: Turn;
  dots: number | null;
  /** The user's own pin. A repack's pins (units off the edited lines) are not, and never report a conflict. */
  explicit: boolean;
};

/**
 * How a letter's dots are drawn: 0 not at all, 1 where authored, 2 and 3 the
 * whole set moved one cell back or on along the line. A calligrapher nudges a
 * set sideways when the authored spot would touch a neighbour (the reference
 * panel does so for the ف of نفسا); the set keeps its count, its side, its
 * one-gap clearance from its letter, and never lands straight beyond a free
 * stroke end.
 */
const DOT_SHIFT = [0, 0, -1, 1];

const DOT_CHAR: Record<KufiDotKey, string> = {
  above1: "ن",
  above2: "ت",
  above3: "ث",
  below1: "ب",
  below2: "ي",
  below3: "پ",
};

const shapeCache = new Map<string, Shape>();

function shapeOf(g: KufiGlyph, counts: number[]): Shape {
  const key = `${g.id}|${counts.join(",")}`;
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const rows = stretchGlyph(g, counts);
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const baseRow = h - 1 - stretchedBase(g, counts);
  const ink: number[] = [];
  let minJ = w;
  let maxJ = -1;
  for (let i = 0; i < h; i++)
    for (let j = 0; j < w; j++)
      if (rows[i][j] === "#") {
        ink.push(j, baseRow - i);
        if (j < minJ) minJ = j;
        if (j > maxJ) maxJ = j;
      }
  // Find the stubs by marking them before stretching, so stretched rows move them.
  const stub = (side: "right" | "left"): [number, number] | null => {
    const r = joinRow(g, side);
    const c = joinCol(g, side);
    if (g.rows[r]?.[c] !== "#") return null;
    const marked = g.rows.map((line, y) => (y === r ? line.slice(0, c) + "@" + line.slice(c + 1) : line));
    const out = stretchGlyph({ ...g, rows: marked }, counts);
    for (let i = 0; i < out.length; i++) {
      const j = out[i].indexOf("@");
      if (j >= 0) return [j, baseRow - i];
    }
    return null;
  };
  const dots: Shape["dots"] = {};
  for (const k of Object.keys(g.dots ?? {}) as KufiDotKey[]) {
    const cells = dotCells(g, DOT_CHAR[k], "initial", counts);
    const arr = new Int16Array(cells.length * 2);
    cells.forEach((c, n) => {
      arr[2 * n] = c.col;
      arr[2 * n + 1] = baseRow - c.row;
    });
    dots[k] = arr;
  }
  const s: Shape = {
    g,
    counts,
    w,
    h,
    baseRow,
    ink: Int16Array.from(ink),
    rStub: stub("right"),
    lStub: stub("left"),
    minJ,
    maxJ,
    dots,
    // cutting a tall stroke to the band is what panels do; only growth costs
    cost: counts.reduce((a, n) => a + Math.max(0, n), 0),
  };
  shapeCache.set(key, s);
  return s;
}

/** Every count vector a glyph may take: rows from their minimum to ROW_MAX, columns 0..COL_MAX. */
function countVectors(g: KufiGlyph): number[][] {
  let out: number[][] = [[]];
  for (const s of g.stretch) {
    const lo = -(s.min ?? 0);
    const hi = s.axis === "row" ? ROW_MAX : COL_MAX;
    const next: number[][] = [];
    for (const v of out) for (let n = lo; n <= hi; n++) next.push([...v, n]);
    out = next;
  }
  return out;
}

/** The alternates a unit may take: its joining form's list, else the isolated one. The packer's rule, shared with the canvas. */
export function kufiFormsOf(unit: Pick<KufiUnit, "skeleton" | "form">): KufiGlyph[] {
  const table = KUFI_FORMS as Record<string, Partial<Record<JoiningForm, KufiGlyph[]>>>;
  return table[unit.skeleton]?.[unit.form] ?? table[unit.skeleton]?.isolated ?? [];
}

/** The applied counts, padded to the glyph's slices; values outside the table's limits are clamped. */
function normalCounts(g: KufiGlyph, counts: number[]): number[] {
  return g.stretch.map((s, i) => {
    const n = Math.floor(counts[i] ?? 0);
    return Math.max(-(s.min ?? 0), n);
  });
}

function lettersOf(text: string, units: KufiUnit[], edits: KufiPanelEdits, pins: Map<number, Pin>): Letter[] {
  return units.map((u, i) => {
    const all = kufiFormsOf(u);
    const pin = pins.get(i) ?? null;
    const form = edits.forms?.[i];
    const fixed = edits.stretch?.[i];
    let glyphs = all;
    if (pin) glyphs = all.filter((g) => g.id === pin.glyphId);
    else if (form !== undefined) glyphs = all.filter((g) => g.id === form);
    const shapes = (list: KufiGlyph[]) =>
      list.flatMap((g) => {
        if (pin) return [shapeOf(g, normalCounts(g, pin.counts))];
        if (fixed) return [shapeOf(g, normalCounts(g, fixed))];
        return countVectors(g).map((c) => shapeOf(g, c));
      });
    // a shape without the stub it joins by would break the word silently
    const joinsBy = (sh: Shape) => (!u.joinsNext || !!sh.lStub) && (!(i > 0 && units[i - 1].joinsNext) || !!sh.rStub);
    const ch = text[u.textOffset] ?? "";
    const d = u.skeleton === "allah" || u.skeleton === "lamAlef" ? null : dotsOf(ch, u.form);
    return {
      index: i,
      unit: u,
      ch,
      weight: u.skeleton === "allah" ? 4 : u.skeleton === "lamAlef" ? 2 : 1,
      cands: shapes(glyphs.filter((g) => g.joins?.right !== 0)).filter(joinsBy),
      entry: shapes(glyphs.filter((g) => g.joins?.right === 0)).filter(joinsBy),
      joinsNext: u.joinsNext,
      joinedPrev: i > 0 && units[i - 1].joinsNext,
      word: u.wordIndex,
      dotKey: d ? dotKey(d) : null,
      pin,
      // over the glyphs allowed: a form the user chose sets its own natural length
      natural: TALL.has(u.skeleton) && glyphs.length ? Math.max(...glyphs.map((g) => g.rows.length - g.base)) : -1,
      exempt: !!pin || !!fixed,
    };
  });
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

type Rot = 0 | 90 | 180 | 270;
/** A baseline: panel row = ar*x + br*y + cr, col = ac*x + bc*y + cc for x along it and y up from it. */
type Line = {
  rot: Rot;
  base: number;
  len: number;
  ar: number;
  br: number;
  cr: number;
  ac: number;
  bc: number;
  cc: number;
  /** Panel index of (x, y) for y in TAB_LO..TAB_HI at [(y - TAB_LO) * len + x], -1 outside: built on first use. */
  tab: Int32Array | null;
};

const TAB_LO = -2;
const TAB_HI = BAND + 1;

/** The panel cells of a line's band rows, by (y, x); see `Line.tab`. */
function tabOf(L: Line, cols: number, rows: number): Int32Array {
  if (L.tab) return L.tab;
  const t = new Int32Array((TAB_HI - TAB_LO + 1) * L.len);
  for (let y = TAB_LO; y <= TAB_HI; y++)
    for (let x = 0; x < L.len; x++) {
      const r = L.ar * x + L.br * y + L.cr;
      const c = L.ac * x + L.bc * y + L.cc;
      t[(y - TAB_LO) * L.len + x] = r >= 0 && c >= 0 && r < rows && c < cols ? r * cols + c : -1;
    }
  L.tab = t;
  return t;
}

/** Lines are immutable, so each is made once per panel size. */
const lineCache = new Map<number, Line>();

function lineOf(cols: number, rows: number, rot: Rot, base: number): Line {
  const key = ((cols * 256 + rows) * 4 + rot / 90) * 1024 + base + 512;
  const hit = lineCache.get(key);
  if (hit) return hit;
  if (lineCache.size > 20000) lineCache.clear();
  const L = makeLine(cols, rows, rot, base);
  lineCache.set(key, L);
  return L;
}

function makeLine(cols: number, rows: number, rot: Rot, base: number): Line {
  const m = (len: number, ar: number, br: number, cr: number, ac: number, bc: number, cc: number): Line => ({
    rot,
    base,
    len,
    ar,
    br,
    cr,
    ac,
    bc,
    cc,
    tab: null,
  });
  switch (rot) {
    case 0:
      return m(cols, 0, -1, base, 1, 0, 0);
    case 180:
      return m(cols, 0, 1, base, -1, 0, cols - 1);
    case 90:
      return m(rows, 1, 0, 0, 0, 1, base);
    default:
      return m(rows, -1, 0, rows - 1, 0, -1, base);
  }
}

const SIDE_ROT: Rot[] = [0, 90, 180, 270];
const RING0_OFF = [0, 1, 2];
const RINGK_OFF = [-2, -1, 0, 1, 2];

/** Template line t: ring t>>2, side t&3 (bottom, left, top, right), at the given offset from its ring. */
function templateLine(cols: number, rows: number, t: number, off: number): Line | null {
  const ring = t >> 2;
  const side = t & 3;
  const dist = ring * (BAND + 1) + off;
  if (dist < 0) return null;
  const rot = SIDE_ROT[side];
  const base = side === 0 ? rows - 1 - dist : side === 3 ? cols - 1 - dist : dist;
  const lim = rot === 0 || rot === 180 ? rows : cols;
  if (base < 0 || base >= lim) return null;
  return lineOf(cols, rows, rot, base);
}

/** The line a top-entered letter continues on after a U-turn, its right stub on panel cell (pr, pc). */
function uturnLine(cols: number, rows: number, rot: Rot, pr: number, pc: number, jh: number): { L: Line; xs: number } {
  switch (rot) {
    case 0:
      return { L: lineOf(cols, rows, 0, pr + jh), xs: pc };
    case 180:
      return { L: lineOf(cols, rows, 180, pr - jh), xs: cols - 1 - pc };
    case 90:
      return { L: lineOf(cols, rows, 90, pc - jh), xs: pr };
    default:
      return { L: lineOf(cols, rows, 270, pc + jh), xs: rows - 1 - pr };
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const K_EMPTY = 0;
const K_GLYPH = 1;
const K_JOIN = 2;
const K_DOT = 3;
const K_FILL = 4;

type Placed = {
  letter: number;
  line: number;
  x0: number;
  yb: number;
  shape: Shape;
  dots: number;
  /** The move that placed it, with the position it landed at. */
  mv: Move;
};
type Trail = { prev: Trail | null; p: Placed };

type St = {
  owner: Int32Array;
  kind: Uint8Array;
  letter: Int16Array;
  stub: Uint8Array;
  /** Ink cells beside each cell (4-neighbours). An empty cell with any is dead: no later piece may use it. */
  adj: Uint8Array;
  /** Settled band cells of lines before `settledUpTo` (2 full weight, 1 half); see `partialScore`. */
  settled: Uint8Array;
  settledUpTo: number;
  ids: number;
  lines: Line[];
  cursor: number[];
  cur: number;
  tpl: number;
  /** The open run: its owner, line, and the left stub of its last letter, when that letter joins on. */
  seg: { u: number; line: number; sx: number; sy: number } | null;
  trail: Trail | null;
  failed: number;
  failedPins: number;
  splits: number;
  uturns: number;
  stretch: number;
  /** Total `devOf` over placed letters, and its cells cut and grown. */
  dev: number;
  cut: number;
  grow: number;
  dotsOff: number;
  lastWord: number;
  hash: number;
  /** Cells of the authored dot sets of placed letters whose dots are not drawn yet: drawn at the end where they fit. */
  vdots: number[][];
  score: number;
};

type Ctx = {
  cols: number;
  rows: number;
  n: number;
  letters: Letter[];
  nTpl: number;
  zob: Int32Array;
  routes: Map<number, number>;
  deadline: number;
  /** Moves tried so far, and the most this search may try: the budget that decides results. */
  work: number;
  workMax: number;
  /** Set when the work or the clock runs out mid-step: no more moves are tried. */
  out: boolean;
  /** Set while the greedy first pass runs: it always finishes, so there is always an answer. */
  noClock: boolean;
  /** Set during repair moves: a replayed move that no longer fits gives way to the letter's best one that does. */
  mend: boolean;
};

function initState(ctx: Ctx): St {
  return {
    owner: new Int32Array(ctx.n),
    kind: new Uint8Array(ctx.n),
    letter: new Int16Array(ctx.n).fill(-1),
    stub: new Uint8Array(ctx.n),
    adj: new Uint8Array(ctx.n),
    settled: new Uint8Array(ctx.n),
    settledUpTo: 0,
    ids: 0,
    lines: [],
    cursor: [],
    cur: -1,
    tpl: 0,
    seg: null,
    trail: null,
    failed: 0,
    failedPins: 0,
    splits: 0,
    uturns: 0,
    stretch: 0,
    dev: 0,
    cut: 0,
    grow: 0,
    dotsOff: 0,
    lastWord: -1,
    hash: 0,
    vdots: [],
    score: 0,
  };
}

function cloneState(s: St): St {
  return {
    ...s,
    owner: s.owner.slice(),
    kind: s.kind.slice(),
    letter: s.letter.slice(),
    stub: s.stub.slice(),
    adj: s.adj.slice(),
    settled: s.settled.slice(),
    lines: s.lines.slice(),
    cursor: s.cursor.slice(),
    vdots: s.vdots.slice(),
  };
}

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

/**
 * One choice for one letter. `mode` 0 continues the current line, 1 opens
 * template line `t` at offset `off` (or at `base`, for a pin), 2 joins the
 * previous letter straight with `jext` extra cells, 3 joins it through a
 * U-turn climbing `climb` more or less than authored.
 */
type Move = {
  mode: 0 | 1 | 2 | 3;
  shape: Shape;
  dots: number;
  t: number;
  off: number;
  base: number | null;
  x0: number;
  jext: number;
  climb: number;
};

/** Cells written by a move, for undo and hashing. */
type Applied = {
  /** Where the letter's box went: its line (index in `St.lines`), x0 and baseline height. */
  x0: number;
  yb: number;
  cells: number[];
  line: Line | null;
  newLine: boolean;
  oldCursor: number;
  oldCur: number;
  oldTpl: number;
  oldSeg: St["seg"];
  oldIds: number;
  oldScalars: [number, number, number, number, number, number, number, number, number];
  oldHash: number;
  oldStubs: number[];
  pushedDots: boolean;
};

const scratch = new Int32Array(4096);

/** Panel index of line point (x, y), or -1 when outside the panel. */
function at(ctx: Ctx, L: Line, x: number, y: number): number {
  const r = L.ar * x + L.br * y + L.cr;
  const c = L.ac * x + L.bc * y + L.cc;
  if (r < 0 || c < 0 || r >= ctx.rows || c >= ctx.cols) return -1;
  return r * ctx.cols + c;
}

/** Writes the shape's cells at (x0, yb) into `scratch`; returns the count, or -1 if any falls outside. */
function shapeCells(ctx: Ctx, L: Line, sh: Shape, x0: number, yb: number): number {
  const ink = sh.ink;
  const { cols, rows } = ctx;
  const { ar, br, ac, bc } = L;
  const cr = L.cr + ar * x0 + br * yb;
  const cc = L.cc + ac * x0 + bc * yb;
  let n = 0;
  for (let k = 0; k < ink.length; k += 2) {
    const r = ar * ink[k] + br * ink[k + 1] + cr;
    const c = ac * ink[k] + bc * ink[k + 1] + cc;
    if (r < 0 || c < 0 || r >= rows || c >= cols) return -1;
    scratch[n++] = r * cols + c;
  }
  return n;
}

function neighbours(ctx: Ctx, i: number, out: number[]): number {
  const r = (i / ctx.cols) | 0;
  const c = i - r * ctx.cols;
  let n = 0;
  if (r > 0) out[n++] = i - ctx.cols;
  if (r + 1 < ctx.rows) out[n++] = i + ctx.cols;
  if (c > 0) out[n++] = i - 1;
  if (c + 1 < ctx.cols) out[n++] = i + 1;
  return n;
}
const nbBuf = [0, 0, 0, 0];

/** True when every cell is empty (or the shared stub) and touches nothing but owner `u`. */
function fitsCells(ctx: Ctx, st: St, cells: Int32Array, from: number, n: number, u: number, shared: number): boolean {
  for (let k = from; k < from + n; k++) {
    const i = cells[k];
    if (st.owner[i] !== 0 && !(i === shared && st.owner[i] === u)) return false;
    const m = neighbours(ctx, i, nbBuf);
    for (let q = 0; q < m; q++) {
      const o = st.owner[nbBuf[q]];
      if (o !== 0 && o !== u) return false;
    }
  }
  return true;
}

/** Dot cells (j, y) of the letter's own set at (x0, yb), into `scratch` at `from`; -1 if outside. */
function dotCellsAt(ctx: Ctx, L: Line, sh: Shape, key: KufiDotKey, x0: number, yb: number, from: number): number {
  const d = sh.dots[key];
  if (!d) return -1;
  let n = from;
  for (let k = 0; k < d.length; k += 2) {
    const i = at(ctx, L, x0 + d[k], yb + d[k + 1]);
    if (i < 0) return -1;
    scratch[n++] = i;
  }
  return n - from;
}

/** A letter's dots stay within one gap of its band (at `yb` above the line). */
function dotsInBand(sh: Shape, key: KufiDotKey, yb: number): boolean {
  const d = sh.dots[key];
  if (!d) return false;
  for (let k = 1; k < d.length; k += 2) if (yb + d[k] < -2 || yb + d[k] > BAND + 1) return false;
  return true;
}

/**
 * A nudged set still reads as its letter's: no dot touches the letter even
 * diagonally, and none sits one gap straight beyond a free end of its strokes.
 * The letter is already written; its cells carry letter index li.
 */
function nudgeReads(ctx: Ctx, st: St, li: number, from: number, n: number): boolean {
  const { cols, rows } = ctx;
  const mine = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < rows && c < cols && st.kind[r * cols + c] === K_GLYPH && st.letter[r * cols + c] === li;
  for (let k = from; k < from + n; k++) {
    const r = (scratch[k] / cols) | 0;
    const c = scratch[k] - r * cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if ((dr || dc) && mine(r + dr, c + dc)) return false;
    for (const [dr, dc] of DIRS) {
      const qr = r - 2 * dr;
      const qc = c - 2 * dc;
      if (!mine(qr, qc) || !mine(qr - dr, qc - dc)) continue;
      let others = 0;
      for (const [er, ec] of DIRS) if (!(er === -dr && ec === -dc) && mine(qr + er, qc + ec)) others++;
      if (others === 0) return false; // a stroke ends at q, pointing at the dot
    }
  }
  return true;
}
const DIRS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Dots stand alone: every cell empty with nothing at all beside it. */
function dotsFit(ctx: Ctx, st: St, from: number, n: number): boolean {
  for (let k = from; k < from + n; k++) {
    const i = scratch[k];
    if (st.owner[i] !== 0) return false;
    const m = neighbours(ctx, i, nbBuf);
    for (let q = 0; q < m; q++) if (st.owner[nbBuf[q]] !== 0) return false;
  }
  return true;
}

/** True when a solid 2×2 touches any of the given cells. */
function makesInk2(ctx: Ctx, st: St, cells: number[]): boolean {
  const { cols, rows } = ctx;
  for (const i of cells) {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    for (let r0 = r - 1; r0 <= r; r0++)
      for (let c0 = c - 1; c0 <= c; c0++) {
        if (r0 < 0 || c0 < 0 || r0 + 1 >= rows || c0 + 1 >= cols) continue;
        const k = r0 * cols + c0;
        if (st.owner[k] && st.owner[k + 1] && st.owner[k + cols] && st.owner[k + cols + 1]) return true;
      }
  }
  return false;
}

/**
 * Applies a move in place. Returns the undo record, or null (state untouched)
 * when the move does not fit.
 */
function apply(ctx: Ctx, st: St, li: number, mv: Move): Applied | null {
  // a long letter step stops part-way when the budget runs out, not only between letters
  if (++ctx.work >= ctx.workMax || ((ctx.work & 255) === 0 && performance.now() > ctx.deadline)) ctx.out = true;
  const letter = ctx.letters[li];
  const sh = mv.shape;
  let L: Line;
  let x0: number;
  let yb: number;
  let u: number;
  let n: number;
  let shared = -1;
  let newLine: Line | null = null;
  const uturnCells: number[] = [];
  const newStubs: number[] = [];
  const joinCells: number[] = [];

  if (mv.mode === 0 || mv.mode === 1) {
    if (mv.mode === 0) L = st.lines[st.cur];
    else {
      const t = mv.base !== null ? lineOf(ctx.cols, ctx.rows, SIDE_ROT[mv.t & 3], mv.base) : templateLine(ctx.cols, ctx.rows, mv.t, mv.off);
      if (!t) return null;
      L = t;
      newLine = t;
    }
    x0 = mv.x0;
    yb = 0;
    u = st.ids + 1;
    n = shapeCells(ctx, L, sh, x0, yb);
    if (n < 0 || !fitsCells(ctx, st, scratch, 0, n, u, -1)) return null;
  } else {
    const seg = st.seg;
    if (!seg || !sh.rStub) return null;
    u = seg.u;
    const Lp = st.lines[seg.line];
    if (mv.mode === 2) {
      L = Lp;
      const sx = seg.sx - mv.jext;
      for (let x = seg.sx - 1; x > sx; x--) {
        const i = at(ctx, L, x, seg.sy);
        if (i < 0) return null;
        joinCells.push(i);
      }
      x0 = sx - sh.rStub[0];
      yb = seg.sy - sh.rStub[1];
      const rs = at(ctx, L, sx, seg.sy);
      if (rs < 0) return null;
      if (mv.jext === 0) shared = rs;
      newStubs.push(rs);
    } else {
      // U-turn: one cell on along the line, climb, one cell back.
      const j = KUFI_JOINS[0];
      const h = j.rows.length - 1 + Math.max(-(j.stretch[0].min ?? 0), mv.climb);
      for (let y = 0; y <= h; y++) {
        const i = at(ctx, Lp, seg.sx - 1, seg.sy + y);
        if (i < 0) return null;
        uturnCells.push(i);
      }
      const top = at(ctx, Lp, seg.sx, seg.sy + h);
      if (top < 0) return null;
      uturnCells.push(top);
      const pr = (top / ctx.cols) | 0;
      const pc = top - pr * ctx.cols;
      const rot = ((Lp.rot + 180) % 360) as Rot;
      const { L: Ln, xs } = uturnLine(ctx.cols, ctx.rows, rot, pr, pc, sh.rStub[1]);
      L = Ln;
      newLine = Ln;
      x0 = xs - sh.rStub[0];
      yb = 0;
      shared = top;
      newStubs.push(top);
    }
    // join cells and the U-turn: empty, touching only this run, and never its letters except at a stub
    const extra = mv.mode === 2 ? joinCells : uturnCells;
    for (const i of extra) {
      if (st.owner[i] !== 0) return null;
      const m = neighbours(ctx, i, nbBuf);
      for (let q = 0; q < m; q++) {
        const nb = nbBuf[q];
        const o = st.owner[nb];
        if (o === 0) continue;
        if (o !== u) return null;
        if (!st.stub[nb] && nb !== at(ctx, Lp, seg.sx, seg.sy)) return null;
      }
    }
    n = shapeCells(ctx, L, sh, x0, yb);
    if (n < 0 || !fitsCells(ctx, st, scratch, 0, n, u, shared)) return null;
    // within the run, letters touch only at stubs and join runs
    const prevStub = at(ctx, Lp, seg.sx, seg.sy);
    const extraSet = extra;
    for (let k = 0; k < n; k++) {
      const i = scratch[k];
      if (i === shared || newStubs.includes(i)) continue;
      if (extraSet.includes(i)) return null;
      const m = neighbours(ctx, i, nbBuf);
      for (let q = 0; q < m; q++) {
        const nb = nbBuf[q];
        if (st.owner[nb] !== u) {
          if (nb !== shared && extraSet.includes(nb) && !newStubs.includes(i)) return null;
          continue;
        }
        if (st.stub[nb] || nb === prevStub) continue;
        return null;
      }
    }
  }

  // Dots
  let nd = 0;
  if (mv.dots) {
    if (!letter.dotKey) return null;
    if (!dotsInBand(sh, letter.dotKey, yb)) return null;
    nd = dotCellsAt(ctx, L, sh, letter.dotKey, x0 + DOT_SHIFT[mv.dots], yb, n);
    if (nd < 0) return null;
  }

  // Write.
  const rec: Applied = {
    x0,
    yb,
    cells: [],
    line: newLine,
    newLine: !!newLine,
    oldCursor: st.cur >= 0 ? st.cursor[st.cur] : 0,
    oldCur: st.cur,
    oldTpl: st.tpl,
    oldSeg: st.seg,
    oldIds: st.ids,
    oldScalars: [st.failed, st.splits, st.uturns, st.stretch, st.dotsOff, st.lastWord, st.dev, st.cut, st.grow],
    oldHash: st.hash,
    oldStubs: [],
    pushedDots: false,
  };
  const { cols } = ctx;
  const write = (i: number, kind: number, owner: number, l: number) => {
    if (st.owner[i] !== 0) return;
    st.owner[i] = owner;
    st.kind[i] = kind;
    st.letter[i] = l;
    st.hash ^= ctx.zob[i];
    rec.cells.push(i);
    const r = (i / cols) | 0;
    const c = i - r * cols;
    if (r > 0) st.adj[i - cols]++;
    if (r + 1 < ctx.rows) st.adj[i + cols]++;
    if (c > 0) st.adj[i - 1]++;
    if (c + 1 < cols) st.adj[i + 1]++;
  };
  if (mv.mode === 0 || mv.mode === 1) st.ids = u;
  for (let k = 0; k < n; k++) write(scratch[k], K_GLYPH, u, li);
  for (const i of joinCells) write(i, K_JOIN, u, -1);
  for (const i of uturnCells) write(i, K_JOIN, u, -1);
  const markStub = (i: number) => {
    if (i < 0 || st.stub[i]) return;
    st.stub[i] = 1;
    rec.oldStubs.push(i);
  };
  if (mv.mode >= 2 && st.seg) markStub(at(ctx, st.lines[st.seg.line], st.seg.sx, st.seg.sy));
  for (const i of newStubs) markStub(i);
  for (const i of joinCells) markStub(i);
  for (const i of uturnCells) markStub(i);
  if (nd > 0) {
    if (!dotsFit(ctx, st, n, nd) || (mv.dots > 1 && !nudgeReads(ctx, st, li, n, nd))) {
      undo(ctx, st, rec);
      return null;
    }
    const d = ++st.ids;
    for (let k = n; k < n + nd; k++) write(scratch[k], K_DOT, d, li);
  }
  if (makesInk2(ctx, st, rec.cells)) {
    undo(ctx, st, rec);
    return null;
  }

  // Lines, cursor and the open run.
  if (newLine) {
    st.lines.push(newLine);
    st.cursor.push(newLine.len - 1);
    st.cur = st.lines.length - 1;
    if (mv.mode === 1) st.tpl = mv.t + 1;
  }
  st.cursor[st.cur] = Math.min(st.cursor[st.cur], x0 + sh.minJ - 1);
  if (letter.joinsNext && sh.lStub) st.seg = { u, line: st.cur, sx: x0 + sh.lStub[0], sy: yb + sh.lStub[1] };
  else st.seg = null;
  if ((mv.mode === 0 || mv.mode === 1) && st.lastWord === letter.word && mv.mode === 1) st.splits++;
  if (mv.mode === 3) st.uturns++;
  st.stretch += sh.cost + (mv.mode === 2 ? mv.jext : 0) + (mv.mode === 3 ? Math.abs(mv.climb) : 0);
  const parts = devParts(letter, sh);
  st.dev += CUT_WEIGHT * parts.cut + parts.grow;
  st.cut += parts.cut;
  st.grow += parts.grow;
  if (letter.dotKey && !mv.dots) {
    // dots are drawn at the end, where they fit; until then they count as ink
    const m = dotCellsAt(ctx, L, sh, letter.dotKey, x0, yb, 0);
    if (m > 0) {
      st.vdots.push(Array.from(scratch.subarray(0, m)));
      rec.pushedDots = true;
    }
  }
  if (mv.dots > 1) st.stretch += 2;
  st.lastWord = letter.word;
  st.hash = (st.hash ^ Math.imul(st.cur + 1, 0x9e3779b1) ^ Math.imul(st.cursor[st.cur] + 7, 0x85ebca6b)) | 0;
  if (st.seg) st.hash = (st.hash ^ Math.imul(st.seg.sx * 131 + st.seg.sy + 3, 0xc2b2ae35)) | 0;
  return rec;
}

function undo(ctx: Ctx, st: St, rec: Applied) {
  const { cols, rows } = ctx;
  for (const i of rec.cells) {
    st.owner[i] = 0;
    st.kind[i] = K_EMPTY;
    st.letter[i] = -1;
    const r = (i / cols) | 0;
    const c = i - r * cols;
    if (r > 0) st.adj[i - cols]--;
    if (r + 1 < rows) st.adj[i + cols]--;
    if (c > 0) st.adj[i - 1]--;
    if (c + 1 < cols) st.adj[i + 1]--;
  }
  for (const i of rec.oldStubs) st.stub[i] = 0;
  if (rec.newLine && st.lines.length > 0 && st.cur === st.lines.length - 1 && st.cur !== rec.oldCur) {
    st.lines.pop();
    st.cursor.pop();
  }
  st.cur = rec.oldCur;
  if (st.cur >= 0) st.cursor[st.cur] = rec.oldCursor;
  st.tpl = rec.oldTpl;
  st.seg = rec.oldSeg;
  st.ids = rec.oldIds;
  [st.failed, st.splits, st.uturns, st.stretch, st.dotsOff, st.lastWord, st.dev, st.cut, st.grow] = rec.oldScalars;
  st.hash = rec.oldHash;
  if (rec.pushedDots) st.vdots.pop();
}

/** A letter that could not be placed: it is left out and its run is broken. */
function failLetter(ctx: Ctx, st: St, li: number): St {
  const s = cloneState(st);
  s.failed += ctx.letters[li].weight;
  if (ctx.letters[li].pin?.explicit) s.failedPins++;
  s.seg = null;
  s.hash = (s.hash ^ Math.imul(li + 1, 0x27d4eb2f)) | 0;
  return s;
}

// ---------------------------------------------------------------------------
// Move generation
// ---------------------------------------------------------------------------

/** The top-left cell and turn of a shape's box at (x0, yb) on line L. */
function boxOf(L: Line, sh: Shape, x0: number, yb: number): { col: number; row: number; turn: Turn } {
  const { ar, br, cr, ac, bc, cc } = L;
  const xs = [x0, x0 + sh.w - 1];
  const ys = [yb + sh.baseRow - sh.h + 1, yb + sh.baseRow];
  let r0 = Infinity;
  let c0 = Infinity;
  for (const x of xs)
    for (const y of ys) {
      r0 = Math.min(r0, ar * x + br * y + cr);
      c0 = Math.min(c0, ac * x + bc * y + cc);
    }
  return { col: c0, row: r0, turn: (L.rot / 90) as Turn };
}

function pinMatches(L: Line, sh: Shape, x0: number, yb: number, pin: Pin): boolean {
  const b = boxOf(L, sh, x0, yb);
  return b.col === pin.col && b.row === pin.row && b.turn === pin.turn;
}

type Cand = { parent: number; li: number; mv: Move; score: number; hash: number };

/**
 * Calls `visit` with each move for letter li applied to `st` in place (and
 * undone after). `visit` returns true to stop; so does this, when stopped.
 */
function forMoves(ctx: Ctx, st: St, li: number, visit: (mv: Move, rec: Applied) => boolean): boolean {
  const letter = ctx.letters[li];
  const pin = letter.pin;
  let stop = false;
  /** Applies, visits and undoes one move; true when it fitted. */
  const tryMove = (mv: Move): boolean => {
    if (stop || (ctx.out && !ctx.noClock)) return false;
    const rec = apply(ctx, st, li, mv);
    if (!rec) return false;
    const ok = !pin || pinMatches(st.lines[st.cur], mv.shape, rec.x0, rec.yb, pin);
    if (ok && visit(mv, rec)) stop = true;
    undo(ctx, st, rec);
    return ok;
  };
  /**
   * A move. A letter's dots are drawn when the panel is finished (`drawDots`),
   * except a pinned letter's, which keep the way they were drawn.
   */
  const tryDots = (mv: Omit<Move, "dots">): boolean => {
    if (letter.dotKey && pin && pin.dots !== null) return tryMove({ ...mv, dots: pin.dots });
    return tryMove({ ...mv, dots: 0 });
  };

  if (letter.joinedPrev && st.seg) {
    for (const sh of letter.cands)
      for (let e = 0; e <= JEXT_MAX; e++) tryDots({ mode: 2, shape: sh, t: 0, off: 0, base: null, x0: 0, jext: e, climb: 0 });
    for (const sh of letter.entry)
      for (let c = CLIMB_MIN; c <= CLIMB_MAX; c++)
        tryDots({ mode: 3, shape: sh, t: 0, off: 0, base: null, x0: 0, jext: 0, climb: c });
    return stop;
  }

  // First letter of a run: on this line, or on the next one or two lines of the template.
  const lineOpts: Array<{ mode: 0 | 1; t: number; off: number; base: number | null }> = [];
  if (st.cur >= 0) lineOpts.push({ mode: 0, t: 0, off: 0, base: null });
  for (let inc = 1; inc <= 2; inc++) {
    const t = st.tpl + inc - 1;
    if (t >= ctx.nTpl || (inc === 2 && t - 1 < 4)) continue; // never skip a side of the frame
    if (pin) {
      // a pinned letter opens its line where the pin says, whatever the template offset
      if (SIDE_ROT[t & 3] / 90 !== pin.turn) continue;
      lineOpts.push({ mode: 1, t, off: 0, base: null });
      continue;
    }
    for (const off of t < 4 ? RING0_OFF : RINGK_OFF) lineOpts.push({ mode: 1, t, off, base: null });
  }
  const route = ctx.routes.get(letter.word) ?? 0;
  const firstOfWord = li === 0 || ctx.letters[li - 1].word !== letter.word;
  const shapes = letter.cands.length ? letter.cands : letter.entry;
  for (const lo of lineOpts) {
    for (const sh of shapes) {
      let L: Line | null;
      let base = lo.base;
      if (lo.mode === 0) L = st.lines[st.cur];
      else if (pin) {
        base = pinBase(sh, pin);
        L = lineOf(ctx.cols, ctx.rows, SIDE_ROT[lo.t & 3], base);
      } else L = templateLine(ctx.cols, ctx.rows, lo.t, lo.off);
      if (!L) continue;
      const start = lo.mode === 0 ? st.cursor[st.cur] : L.len - 1;
      if (pin) {
        const x0 = pinX0(L, sh, pin);
        if (x0 === null || x0 + sh.maxJ > start) continue;
        tryDots({ mode: lo.mode, shape: sh, t: lo.t, off: lo.off, base, x0, jext: 0, climb: 0 });
        continue;
      }
      // slide to the first place the letter fits
      for (let X = start - (firstOfWord ? route : 0); X - (sh.maxJ - sh.minJ) >= 0; X--) {
        if (tryDots({ mode: lo.mode, shape: sh, t: lo.t, off: lo.off, base, x0: X - sh.maxJ, jext: 0, climb: 0 })) break;
      }
    }
  }
  return stop;
}

/** The baseline a pinned first letter stands on. */
function pinBase(sh: Shape, pin: Pin): number {
  const yTop = sh.baseRow; // the top row's height above the baseline
  switch (pin.turn) {
    case 0:
      return pin.row + yTop;
    case 2:
      return pin.row + sh.h - 1 - yTop;
    case 1:
      return pin.col + sh.h - 1 - yTop;
    default:
      return pin.col + yTop;
  }
}

/** The x0 on line L that puts a pinned first letter's box where the pin says; null if none does. */
function pinX0(L: Line, sh: Shape, pin: Pin): number | null {
  // x0 moves the box linearly along the line: place it at 0 and shift.
  const b = boxOf(L, sh, 0, 0);
  if (b.turn !== pin.turn) return null;
  const { ar, ac } = L;
  // moving x0 by 1 moves the box by (ar, ac)
  const dr = pin.row - b.row;
  const dc = pin.col - b.col;
  if (ar !== 0) {
    if (dc !== 0) return null;
    return dr / ar;
  }
  if (dr !== 0) return null;
  return dc / ac;
}

/** Enumerates every move for letter li from state st, scoring each in place (`cheap`: only round the new ink). */
function expand(ctx: Ctx, st: St, pi: number, li: number, out: Cand[], cheap = false) {
  forMoves(ctx, st, li, (mv, rec) => {
    const score = cheap ? localScore(ctx, st, rec) : partialScore(ctx, st);
    out.push({ parent: pi, li, mv, score, hash: cheap ? st.hash : lastFrontier });
    return false;
  });
}

/**
 * A quick score for the greedy first pass: holes nothing can close, counted
 * only round the cells a move just inked, plus the usual costs.
 */
function localScore(ctx: Ctx, st: St, rec: Applied): number {
  const { cols, rows } = ctx;
  let r0 = rows;
  let r1 = -1;
  let c0 = cols;
  let c1 = -1;
  for (const i of rec.cells) {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    if (r < r0) r0 = r;
    if (r > r1) r1 = r;
    if (c < c0) c0 = c;
    if (c > c1) c1 = c;
  }
  const own = st.owner;
  const adj = st.adj;
  let perm = 0;
  for (let r = Math.max(0, r0 - 2); r <= Math.min(rows - 2, r1 + 1); r++)
    for (let c = Math.max(0, c0 - 2); c <= Math.min(cols - 2, c1 + 1); c++) {
      const i = r * cols + c;
      const j = i + cols;
      if (own[i] || own[i + 1] || own[j] || own[j + 1]) continue;
      if (adj[i] && adj[i + 1] && adj[j] && adj[j + 1]) perm++;
    }
  return W.fail * st.failed + W.hole * perm + W.split * st.splits + W.uturn * st.uturns + W.stretch * st.stretch;
}

/** Most moves tried when checking that an open run can be finished. */
const COMPLETE_BUDGET = 400;

/**
 * True when the run left open after letter li can be finished from `st`:
 * some choice of its remaining letters fits. Gives up (true) after
 * COMPLETE_BUDGET moves.
 */
function completable(ctx: Ctx, st: St, li: number): boolean {
  let nodes = 0;
  const go = (k: number): boolean => {
    if (k >= ctx.letters.length || !ctx.letters[k].joinedPrev || !st.seg) return true;
    return forMoves(ctx, st, k, () => ++nodes > COMPLETE_BUDGET || go(k + 1));
  };
  return go(li + 1);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Writes line L's band cells with x >= x0 into `into` at weight 2 (depth -2..2) or 1 (depth 3), keeping the larger. */
function markBand(ctx: Ctx, L: Line, x0: number, into: Uint8Array) {
  const tab = tabOf(L, ctx.cols, ctx.rows);
  const len = L.len;
  // depths 3 and 4 are where the next ring interlocks: depth 3 counts half, depth 4 not at all
  for (let y = -2; y < BAND - 1; y++) {
    const v = y < BAND - 2 ? 2 : 1;
    const row = (y - TAB_LO) * len;
    for (let x = Math.max(0, x0); x < len; x++) {
      const i = tab[row + x];
      if (i >= 0 && into[i] < v) into[i] = v;
    }
  }
}

/** Adds the band of every closed line not yet in `st.settled` to it. */
function settleLines(ctx: Ctx, st: St) {
  for (; st.settledUpTo < st.cur; st.settledUpTo++) markBand(ctx, st.lines[st.settledUpTo], 0, st.settled);
}

const stamp = { mask: new Uint8Array(0), virt: new Int32Array(0), g: 0 };
/** The frontier hash of the panel `partialScore` last scored. */
let lastFrontier = 0;

/**
 * A partial panel's score. Holes nothing later can close (empty 2×2 whose
 * cells all touch ink: a lower bound, since no piece may touch another) count
 * in full; open windows in band areas the reading order has passed count as
 * likely holes, the band's top row at half weight.
 */
function partialScore(ctx: Ctx, st: St): number {
  const { cols, rows, n } = ctx;
  if (stamp.mask.length !== n) {
    stamp.mask = new Uint8Array(n);
    stamp.virt = new Int32Array(n);
    stamp.g = 0;
  }
  // settled band cells: closed lines (cached), the current line behind its cursor
  const mk = stamp.mask;
  mk.set(st.settled);
  for (let k = st.settledUpTo; k < st.lines.length; k++) markBand(ctx, st.lines[k], k === st.cur ? st.cursor[k] + 2 : 0, mk);
  // what the current line can still reach (ahead of its cursor, to a stroke's height) is never settled
  if (st.cur >= 0) {
    const L = st.lines[st.cur];
    const tab = tabOf(L, cols, rows);
    const xe = Math.min(L.len - 1, st.cursor[st.cur] + 1);
    for (let y = TAB_LO; y <= TAB_HI; y++) {
      const row = (y - TAB_LO) * L.len;
      for (let x = 0; x <= xe; x++) {
        const i = tab[row + x];
        if (i >= 0) mk[i] = 0;
      }
    }
  }
  // dot sets still to be drawn count as ink while they fit
  const own = st.owner;
  const adj = st.adj;
  const vg = ++stamp.g;
  const virt = stamp.virt;
  for (const cells of st.vdots) {
    let fits = true;
    for (const i of cells) if (own[i] !== 0 || adj[i] !== 0) fits = false;
    if (fits) for (const i of cells) virt[i] = vg;
  }
  // the frontier: ink outside settled cells, which is all a later letter can meet
  let settledInk = 0;
  const zob = ctx.zob;
  for (let i = 0; i < n; i++) if (own[i] !== 0 && mk[i] === 2) settledInk ^= zob[i];
  lastFrontier = st.hash ^ settledInk;
  let perm = 0;
  let soft = 0;
  for (let r = 0; r + 1 < rows; r++) {
    let i = r * cols;
    for (let c = 0; c + 1 < cols; c++, i++) {
      const j = i + cols;
      if (own[i] || own[i + 1] || own[j] || own[j + 1]) continue;
      if (virt[i] === vg || virt[i + 1] === vg || virt[j] === vg || virt[j + 1] === vg) continue;
      if (adj[i] && adj[i + 1] && adj[j] && adj[j + 1]) {
        perm++;
        continue;
      }
      let w = mk[i];
      if (w === 0) continue;
      if (mk[i + 1] < w) w = mk[i + 1];
      if (mk[j] < w) w = mk[j];
      if (mk[j + 1] < w) w = mk[j + 1];
      soft += w;
    }
  }
  soft /= 2;
  // double breaks in the frame: certain when both cells are dead, likely when settled
  let edge = 0;
  const pair = (a: number, b: number) => {
    if (own[a] || own[b] || virt[a] === vg || virt[b] === vg) return;
    if (adj[a] && adj[b]) edge++;
    else if (mk[a] && mk[b]) soft += 0.6;
  };
  for (let c = 0; c + 1 < cols; c++) {
    pair(c, c + 1);
    pair((rows - 1) * cols + c, (rows - 1) * cols + c + 1);
  }
  for (let r = 0; r + 1 < rows; r++) {
    pair(r * cols, (r + 1) * cols);
    pair(r * cols + cols - 1, (r + 1) * cols + cols - 1);
  }
  return (
    W.fail * st.failed +
    W.hole * perm +
    W.edge * edge +
    W.soft * W.hole * soft +
    W.split * st.splits +
    W.uturn * st.uturns +
    W.stretch * st.stretch
  );
}

type Final = {
  st: St;
  owner: Int32Array;
  kind: Uint8Array;
  holes: number;
  edge: number;
  ink2: number;
  squares: number;
  score: number;
  packed: boolean;
  /** Distance from natural stroke lengths (`devOf`), and its cells cut and grown, compared only between packed panels. */
  dev: number;
  cut: number;
  grow: number;
};

/**
 * Whether `a` is the better panel, in the order a calligrapher fills one:
 * packed first (never traded away); then the fewest filler squares, since
 * space is filled by lengthening strokes before any square; then the least
 * shortening, then the least lengthening (`devOf`); then the lower score.
 * Two squares near each other are never drawn at all (`fillPass`).
 */
function better(a: Final, b: Final | null): boolean {
  if (!b) return true;
  if (a.packed !== b.packed) return a.packed;
  if (a.packed && a.squares !== b.squares) return a.squares < b.squares;
  if (a.packed && a.cut !== b.cut) return a.cut < b.cut;
  if (a.packed && a.grow !== b.grow) return a.grow < b.grow;
  return a.score < b.score - 1e-9;
}

function count2x2(ctx: Ctx, own: Int32Array, ink: boolean): number {
  const { cols, rows } = ctx;
  let n = 0;
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const i = r * cols + c;
      const a = own[i] !== 0;
      const b = own[i + 1] !== 0;
      const d = own[i + cols] !== 0;
      const e = own[i + cols + 1] !== 0;
      if (ink ? a && b && d && e : !a && !b && !d && !e) n++;
    }
  return n;
}

function edgeBreaks(ctx: Ctx, own: Int32Array): number {
  const { cols, rows } = ctx;
  let n = 0;
  for (let c = 0; c + 1 < cols; c++) {
    if (!own[c] && !own[c + 1]) n++;
    const b = (rows - 1) * cols + c;
    if (!own[b] && !own[b + 1]) n++;
  }
  for (let r = 0; r + 1 < rows; r++) {
    if (!own[r * cols] && !own[(r + 1) * cols]) n++;
    if (!own[r * cols + cols - 1] && !own[(r + 1) * cols + cols - 1]) n++;
  }
  return n;
}

/** Placed letters in reading order. */
function placedList(st: St): Placed[] {
  const out: Placed[] = [];
  for (let t = st.trail; t; t = t.prev) out.push(t.p);
  return out.reverse();
}

/**
 * Cells where a lone square could be read as a dot: every cell of every
 * authored one- or two-dot set of every placed letter (the sets its sibling
 * letters use too: a square over ر reads ز, one under ي reads ب), and the
 * cells round them. A lone square cannot pass for three dots.
 */
function dotZone(ctx: Ctx, st: St): Uint8Array {
  const z = new Uint8Array(ctx.n);
  for (const p of placedList(st)) {
    const L = st.lines[p.line];
    for (const [k, d] of Object.entries(p.shape.dots)) {
      if (!d || k.endsWith("3")) continue;
      for (let k = 0; k < d.length; k += 2) {
        const x = p.x0 + d[k];
        const y = p.yb + d[k + 1];
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++) {
            const i = at(ctx, L, x + dx, y + dy);
            if (i >= 0) z[i] = 1;
          }
      }
    }
  }
  return z;
}

/** Lone squares, each closing at least FILL_MIN windows, beside a letter, never in a dot zone, and never within two cells of another. */
function fillPass(ctx: Ctx, own: Int32Array, kind: Uint8Array, zone: Uint8Array, nextId: number): number {
  const { cols, rows } = ctx;
  const emptyAt = (r: number, c: number) => r < 0 || c < 0 || r >= rows || c >= cols || own[r * cols + c] === 0;
  const iso = (r: number, c: number) =>
    emptyAt(r, c) && emptyAt(r + 1, c) && emptyAt(r - 1, c) && emptyAt(r, c + 1) && emptyAt(r, c - 1);
  const closes = (r: number, c: number) => {
    let n = 0;
    for (let r0 = r - 1; r0 <= r; r0++)
      for (let c0 = c - 1; c0 <= c; c0++) {
        if (r0 < 0 || c0 < 0 || r0 + 1 >= rows || c0 + 1 >= cols) continue;
        const i = r0 * cols + c0;
        if (!own[i] && !own[i + 1] && !own[i + cols] && !own[i + cols + 1]) n++;
      }
    if (r === 0 || r === rows - 1) n += (c > 0 && !own[r * cols + c - 1] ? 1 : 0) + (c < cols - 1 && !own[r * cols + c + 1] ? 1 : 0);
    if (c === 0 || c === cols - 1) n += (r > 0 && !own[(r - 1) * cols + c] ? 1 : 0) + (r < rows - 1 && !own[(r + 1) * cols + c] ? 1 : 0);
    return n;
  };
  const cand: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (own[i] || zone[i] || !iso(r, c)) continue;
      const n = closes(r, c);
      if (n >= FILL_MIN) cand.push([i, n]);
    }
  cand.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  let squares = 0;
  const fillsNear = (r: number, c: number) => {
    let n = 0;
    let letterNear = false;
    for (let dr = -2; dr <= 2; dr++)
      for (let dc = -2; dc <= 2; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols || (!dr && !dc)) continue;
        const k = kind[rr * cols + cc];
        if (k === K_GLYPH) letterNear = true;
        else if (k === K_FILL) n++;
      }
    return { n, letterNear };
  };
  for (const [i] of cand) {
    const r = (i / cols) | 0;
    const c = i - r * cols;
    if (!iso(r, c) || closes(r, c) < FILL_MIN) continue;
    const f = fillsNear(r, c);
    // two squares near each other read as a letter's pair of dots: a square stands alone
    if (!f.letterNear || f.n > 0) continue;
    own[i] = nextId++;
    kind[i] = K_FILL;
    squares++;
  }
  return squares;
}

/**
 * Draws the dots of every placed letter that has none yet, in reading order:
 * the authored set where it fits, else the set nudged one cell along the
 * line either way (`DOT_SHIFT`), else none. Works on `s` in place.
 */
function drawDots(ctx: Ctx, s: St) {
  for (let t = s.trail, list: Placed[] = []; ; t = t.prev) {
    if (t) {
      list.push(t.p);
      continue;
    }
    for (const p of list.reverse()) {
      const key = ctx.letters[p.letter].dotKey;
      if (!key || p.dots) continue;
      const L = s.lines[p.line];
      const n = shapeCells(ctx, L, p.shape, p.x0, p.yb);
      if (n < 0 || !dotsInBand(p.shape, key, p.yb)) continue;
      for (let v = 1; v < DOT_SHIFT.length; v++) {
        const nd = dotCellsAt(ctx, L, p.shape, key, p.x0 + DOT_SHIFT[v], p.yb, n);
        if (nd <= 0 || !dotsFit(ctx, s, n, nd) || (v > 1 && !nudgeReads(ctx, s, p.letter, n, nd))) continue;
        const id = ++s.ids;
        for (let k = n; k < n + nd; k++) {
          const i = scratch[k];
          s.owner[i] = id;
          s.kind[i] = K_DOT;
          s.letter[i] = p.letter;
          const r = (i / ctx.cols) | 0;
          const c = i - r * ctx.cols;
          if (r > 0) s.adj[i - ctx.cols]++;
          if (r + 1 < ctx.rows) s.adj[i + ctx.cols]++;
          if (c > 0) s.adj[i - 1]++;
          if (c + 1 < ctx.cols) s.adj[i + 1]++;
        }
        s.dotsOff--;
        break;
      }
    }
    return;
  }
}

function finish(ctx: Ctx, st0: St): Final {
  const st = cloneState(st0);
  drawDots(ctx, st);
  const owner = st.owner;
  const kind = st.kind;
  const ink2 = count2x2(ctx, owner, true);
  const squares = fillPass(ctx, owner, kind, dotZone(ctx, st), st.ids + 1);
  const holes = count2x2(ctx, owner, false);
  const edge = edgeBreaks(ctx, owner);
  const score =
    W.fail * st.failed +
    W.ink2 * ink2 +
    W.hole * holes +
    W.edge * edge +
    W.square * squares +
    W.split * st.splits +
    W.uturn * st.uturns +
    W.stretch * st.stretch +
    W.dotsOff * st.dotsOff;
  return { st, owner, kind, holes, edge, ink2, squares, score, packed: !holes && !edge && !ink2 && !st.failed, dev: st.dev, cut: st.cut, grow: st.grow };
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Re-applies a chosen move to a copy of its parent and records the placement. */
function materialize(ctx: Ctx, parent: St, c: Cand): St {
  const s = cloneState(parent);
  const rec = apply(ctx, s, c.li, c.mv);
  if (!rec) throw new Error("kufiPack: a scored move no longer applies");
  record(s, parent.trail, c.li, c.mv, rec);
  settleLines(ctx, s);
  s.score = c.score;
  return s;
}

function record(s: St, prev: Trail | null, li: number, mv: Move, rec: Applied) {
  const m = { ...mv, x0: mv.mode <= 1 ? rec.x0 : mv.x0 };
  s.trail = { prev, p: { letter: li, line: s.cur, x0: rec.x0, yb: rec.yb, shape: mv.shape, dots: mv.dots, mv: m } };
}

// ---------------------------------------------------------------------------
// Polish: coordinate descent on the finished panel
// ---------------------------------------------------------------------------

/** One move per letter (null: left out). */
type Plan = Array<Move | null>;

function planOf(ctx: Ctx, st: St): Plan {
  const plan: Plan = new Array(ctx.letters.length).fill(null);
  for (const p of placedList(st)) plan[p.letter] = p.mv;
  return plan;
}

/**
 * Applies a planned move to a panel that may have changed before it: a run's
 * first letter slides afresh from where its line now leaves off; a pinned or
 * joined letter goes where its move says.
 */
function reapply(ctx: Ctx, st: St, li: number, mv: Move): Applied | null {
  const letter = ctx.letters[li];
  if (mv.mode >= 2 || letter.pin) return apply(ctx, st, li, mv);
  let len: number;
  let start: number;
  if (mv.mode === 0) {
    if (st.cur < 0) return null;
    len = st.lines[st.cur].len;
    start = st.cursor[st.cur];
  } else {
    if (mv.t < st.tpl) return null;
    len = (mv.t & 1) === 0 ? ctx.cols : ctx.rows;
    start = len - 1;
  }
  const firstOfWord = li === 0 || ctx.letters[li - 1].word !== letter.word;
  const sh = mv.shape;
  for (let X = start - (firstOfWord ? (ctx.routes.get(letter.word) ?? 0) : 0); X - (sh.maxJ - sh.minJ) >= 0; X--) {
    const rec = apply(ctx, st, li, { ...mv, x0: X - sh.maxJ });
    if (rec) return rec;
  }
  return null;
}

/** Replays `plan` from letter `from` on a copy of `prefix` (the panel before it); null when a move no longer fits. */
function replayFrom(ctx: Ctx, prefix: St, plan: Plan, from: number): St | null {
  let s = cloneState(prefix);
  for (let li = from; li < plan.length; li++) {
    // a spent budget stops replays too, so the work cap holds
    if (ctx.out && !ctx.noClock) return null;
    const mv = plan[li];
    if (!mv) {
      s = failLetter(ctx, s, li);
      continue;
    }
    const prev = s.trail;
    const rec = reapply(ctx, s, li, mv);
    if (!rec) {
      if (!ctx.mend) return null;
      // mending: the letter takes the first move that still fits; descent refines it
      let first: Move | null = null;
      forMoves(ctx, s, li, (m, r) => {
        first = { ...m, x0: m.mode <= 1 ? r.x0 : m.x0 };
        return true;
      });
      const got = first as Move | null;
      if (!got) return null;
      const rec2 = reapply(ctx, s, li, got);
      if (!rec2) return null;
      record(s, prev, li, got, rec2);
      settleLines(ctx, s);
      continue;
    }
    record(s, prev, li, mv, rec);
    settleLines(ctx, s);
  }
  return s;
}

/** The panel before each letter, replaying `plan` from the start. */
function prefixesOf(ctx: Ctx, plan: Plan): St[] | null {
  const out: St[] = [];
  let s = initState(ctx);
  for (let li = 0; li < plan.length; li++) {
    out.push(s);
    const next = replayFrom(ctx, s, [...new Array(li).fill(null), plan[li]], li);
    if (!next) return null;
    s = next;
  }
  out.push(s);
  return out;
}

/**
 * Coordinate descent on the finished panel: for each letter in turn, every
 * other move it could make, with the letters after it replayed on their own
 * choices; the best that is `better` is kept. Sweeps until none improves or
 * the budget is spent. Toward packing it stops once packed; `natural` goes on
 * from a packed panel toward natural stroke lengths.
 */
function polish(ctx: Ctx, start: Final, natural = false, shapesOnly = false, target: "holes" | "squares" | null = null): Final {
  let best = start;
  let plan = planOf(ctx, start.st);
  let pre = prefixesOf(ctx, plan);
  if (!pre) return best;
  const going = () => (natural ? best.packed : !best.packed);
  for (let sweep = 0; sweep < POLISH_SWEEPS && going(); sweep++) {
    let improved = false;
    // targeted: toward packing, the letters that could reach a hole; toward natural lengths,
    // the letters that deviate and those that could reach a filler square
    let tryLetter: Set<number> | null = null;
    let anyShape: Set<number> | null = null;
    if (target) {
      tryLetter = lettersNear(ctx, best, target);
      anyShape = new Set(tryLetter);
      if (natural) plan.forEach((mv, li) => mv && devOf(ctx.letters[li], mv.shape) > 0 && tryLetter!.add(li));
    }
    for (let li = 0; li < plan.length && going(); li++) {
      if (spent(ctx)) return best;
      if (tryLetter && !tryLetter.has(li)) continue;
      const base = pre[li];
      const cur = plan[li];
      const alts: Move[] = [];
      forMoves(ctx, base, li, (mv, rec) => {
        // shapes only: the letter keeps its line, join and U-turn, and changes glyph or counts
        if (shapesOnly && cur && (mv.mode !== cur.mode || mv.t !== cur.t || mv.off !== cur.off || mv.jext !== cur.jext || mv.climb !== cur.climb))
          return false;
        // a deviating letter, targeted toward natural lengths, tries only shapes nearer its natural length
        if (natural && anyShape && cur && !anyShape.has(li) && devOf(ctx.letters[li], mv.shape) >= devOf(ctx.letters[li], cur.shape))
          return false;
        alts.push({ ...mv, x0: mv.mode <= 1 ? rec.x0 : mv.x0 });
        return false;
      });
      let found: { f: Final; plan: Plan } | null = null;
      for (const alt of alts) {
        const p2 = plan.slice();
        p2[li] = alt;
        const s = replayFrom(ctx, base, p2, li);
        if (!s) continue;
        const f = finish(ctx, s);
        if (better(f, found?.f ?? best)) found = { f, plan: p2 };
      }
      if (found) {
        best = found.f;
        plan = planOf(ctx, best.st);
        const np = prefixesOf(ctx, plan);
        if (!np) return best;
        pre = np;
        improved = true;
      }
    }
    if (!improved) break;
  }
  return best;
}

const POLISH_SWEEPS = 4;

/** Every move letter li can make from `st`, with the place each landed. */
function movesAt(ctx: Ctx, st: St, li: number): Move[] {
  const out: Move[] = [];
  forMoves(ctx, st, li, (mv, rec) => {
    out.push({ ...mv, x0: mv.mode <= 1 ? rec.x0 : mv.x0 });
    return false;
  });
  return out;
}

/**
 * Pair moves toward natural lengths, from a packed panel. A stroke often
 * cannot return to its natural length alone: the corner لا grows up the
 * right edge only if a letter further on makes room. So for each letter
 * whose length deviates (most first), each of its moves nearer its natural
 * length (nearest first) is tried together with every move of every later
 * letter, the rest replayed; the best packed panel that is `better` is kept.
 * Repeats while it finds one and the budget lasts.
 */
function pairPolish(ctx: Ctx, start: Final): Final {
  let best = start;
  for (let round = 0; round < PAIR_ROUNDS && best.packed; round++) {
    const plan = planOf(ctx, best.st);
    const pre = prefixesOf(ctx, plan);
    if (!pre) return best;
    const devs = plan
      .map((mv, li) => ({ li, d: mv ? devOf(ctx.letters[li], mv.shape) : 0 }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d || a.li - b.li);
    let found: Final | null = null;
    for (const { li, d } of devs) {
      const alts = movesAt(ctx, pre[li], li)
        .map((mv) => ({ mv, d: devOf(ctx.letters[li], mv.shape) }))
        .filter((x) => x.d < d)
        .sort((a, b) => a.d - b.d);
      for (const { mv: alt } of alts) {
        const p2 = plan.slice();
        p2[li] = alt;
        // the panel before each later letter, with this letter's new move
        let s: St | null = replayFrom(ctx, pre[li], [...new Array(li).fill(null), alt], li);
        if (!s) continue;
        for (let lj = li + 1; s && lj < plan.length; lj++) {
          if (spent(ctx)) return found && better(found, best) ? found : best;
          // any later letter may make the room: later runs re-slide, so a narrower ع in the
          // core lets the corner لا grow up the right edge
          for (const alt2 of movesAt(ctx, s, lj)) {
            const p3 = p2.slice();
            p3[lj] = alt2;
            const t = replayFrom(ctx, s, p3, lj);
            if (!t) continue;
            const f = finish(ctx, t);
            if (f.packed && better(f, found ?? best)) found = f;
          }
          // on to the next letter, keeping this one's move
          s = replayFrom(ctx, s, [...new Array(lj).fill(null), p2[lj]], lj);
        }
      }
      if (found) break;
    }
    if (!found) break;
    best = polish(ctx, found, true);
  }
  return best;
}

const PAIR_ROUNDS = 3;

/**
 * Repair moves toward natural lengths, for changes that take more than two
 * letters. A letter is put back nearer its natural length even though the
 * panel then stops packing; descent toward packing (`polish`, changing only
 * letters' shapes, on the letters that could reach a hole) mends it one
 * letter at a time, and the result is kept only if it packs and is `better`;
 * the next round goes on from there. Replays mend (`Ctx.mend`):
 * a later letter whose move no longer fits takes the first one that does, so
 * the panels between here and there exist at all. The reference panel's
 * own layout is four letters from the one the beam first packs (the corner
 * لا, the alef of نفسا grown into the core, the ع and the ها's alef), and
 * this is the move that reaches it.
 */
function repairPolish(ctx: Ctx, start: Final): Final {
  ctx.mend = true;
  try {
    return repairRounds(ctx, start);
  } finally {
    ctx.mend = false;
  }
}

function repairRounds(ctx: Ctx, start: Final): Final {
  let best = start;
  for (let round = 0; round < REPAIR_ROUNDS && best.packed; round++) {
    const plan = planOf(ctx, best.st);
    const pre = prefixesOf(ctx, plan);
    if (!pre) return best;
    const devs = plan
      .map((mv, li) => ({ li, d: mv ? devOf(ctx.letters[li], mv.shape) : 0 }))
      .filter((x) => x.d > 0)
      .sort((a, b) => b.d - a.d || a.li - b.li);
    let found: Final | null = null;
    for (const { li, d } of devs) {
      const alts = movesAt(ctx, pre[li], li)
        .map((mv) => ({ mv, d: devOf(ctx.letters[li], mv.shape) }))
        .filter((x) => x.d < d)
        .sort((a, b) => a.d - b.d)
        .slice(0, REPAIR_ALTS);
      for (const { mv } of alts) {
        if (spent(ctx)) return found ?? best;
        const p2 = plan.slice();
        p2[li] = mv;
        const s = replayFrom(ctx, pre[li], p2, li);
        if (!s) continue;
        const f = polish(ctx, finish(ctx, s), false, true, "holes");
        // the first repair that helps is kept: the budget rarely runs to a second
        if (f.packed && better(f, best)) {
          found = f;
          break;
        }
      }
      if (found) break;
    }
    if (!found) break;
    best = found;
  }
  return best;
}

const REPAIR_ROUNDS = 3;

/**
 * The letters that could close a hole of `f` by changing shape (`"holes"`),
 * or take a filler square's place (`"squares"`): those whose box, widened by
 * the longest stretch a slice may take, covers an empty 2×2 (or a square).
 */
function lettersNear(ctx: Ctx, f: Final, target: "holes" | "squares"): Set<number> {
  const { cols, rows } = ctx;
  const own = f.owner;
  const holes: Array<[number, number]> = [];
  for (let r = 0; r + 1 < rows; r++)
    for (let c = 0; c + 1 < cols; c++) {
      const i = r * cols + c;
      const hole = !own[i] && !own[i + 1] && !own[i + cols] && !own[i + cols + 1];
      if (target === "holes" ? hole : f.kind[i] === K_FILL) holes.push([r, c]);
    }
  const out = new Set<number>();
  const reach = Math.max(ROW_MAX, COL_MAX);
  for (const p of placedList(f.st)) {
    const b = boxOf(f.st.lines[p.line], p.shape, p.x0, p.yb);
    const tall = b.turn === 0 || b.turn === 2;
    const r1 = b.row + (tall ? p.shape.h : p.shape.w) - 1;
    const c1 = b.col + (tall ? p.shape.w : p.shape.h) - 1;
    if (holes.some(([r, c]) => r >= b.row - reach && r <= r1 + reach && c >= b.col - reach && c <= c1 + reach)) out.add(p.letter);
  }
  return out;
}
/** Alternatives per deviating letter a repair round tries, nearest natural length first. */
const REPAIR_ALTS = 3;

/** One beam pass of width B. Null when the deadline passed first. */
function beamPass(ctx: Ctx, B: number, start: St = initState(ctx), from = 0, cheap = false): Final | null {
  let beam: St[] = [start];
  const n = ctx.letters.length;
  for (let li = from; li < n; li++) {
    if (!cheap && spent(ctx)) return null;
    const cands: Cand[] = [];
    beam.forEach((st, pi) => expand(ctx, st, pi, li, cands, cheap));
    if (cands.length === 0) {
      beam = beam.map((st) => failLetter(ctx, st, li));
      continue;
    }
    // equal scores go by hash: an arbitrary but fixed order, so a pass is deterministic
    cands.sort((a, b) => a.score - b.score || (a.hash >>> 0) - (b.hash >>> 0));
    // At a run's end the next letter may start a new line, and only then is
    // this line's end settled: rank the best few by where the next letter can go.
    const look = !cheap && li + 1 < n && !ctx.letters[li + 1].joinedPrev ? LOOK_FACTOR * B : 0;
    const want = look || B;
    const seen = new Set<number>();
    let next: St[] = [];
    for (const c of cands) {
      if (seen.has(c.hash)) continue;
      seen.add(c.hash);
      const child = materialize(ctx, beam[c.parent], c);
      if (child.seg && !completable(ctx, child, li)) continue;
      next.push(child);
      if (next.length >= want) break;
    }
    if (look) {
      for (const child of next) child.score = lookahead(ctx, child, li + 1);
      next.sort((a, b) => a.score - b.score || (a.hash >>> 0) - (b.hash >>> 0));
      next = next.slice(0, B);
    }
    beam = next.length ? next : beam.map((st) => failLetter(ctx, st, li));
  }
  let best: Final | null = null;
  for (const st of beam) {
    const f = finish(ctx, st);
    if (better(f, best)) best = f;
  }
  return best;
}

/** Candidates ranked by lookahead at a run's end, as a multiple of the beam width. */
const LOOK_FACTOR = 4;

/** The best partial score any move of letter li reaches from `st`; a failure when none fits. */
function lookahead(ctx: Ctx, st: St, li: number): number {
  let best = Infinity;
  forMoves(ctx, st, li, () => {
    const v = partialScore(ctx, st);
    if (v < best) best = v;
    return false;
  });
  return Number.isFinite(best) ? best : st.score + W.fail * ctx.letters[li].weight;
}

/**
 * Large-neighbourhood moves: from each run's first letter, latest first, a
 * small beam re-plans everything after it; a better panel is polished and
 * kept. Repeats until a round finds nothing or the deadline passes.
 */
function replan(ctx: Ctx, start: Final, B: number, natural = false): Final {
  let best = start;
  const going = () => (natural ? best.packed : !best.packed);
  for (let round = 0; round < REPLAN_ROUNDS && going(); round++) {
    const plan = planOf(ctx, best.st);
    const pre = prefixesOf(ctx, plan);
    if (!pre) return best;
    let improved = false;
    for (let li = plan.length - 1; li >= 0 && going(); li--) {
      if (ctx.letters[li].joinedPrev) continue;
      if (spent(ctx)) return best;
      let f = beamPass(ctx, B, pre[li], li);
      if (!f) return best;
      if (!f.packed) f = polish(ctx, f);
      if (better(f, best)) {
        best = f;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return best;
}

const REPLAN_ROUNDS = 8;
const REPLAN_BEAM = 8;

/** Widening beams, each polished and replanned, until one packs or the budget is spent; the best panel found. */
function search(ctx: Ctx): Final | null {
  const f = searchInner(ctx);
  stats.work += ctx.work;
  return f;
}

function searchInner(ctx: Ctx): Final | null {
  // a greedy pass first, so there is always an answer within the budget
  ctx.noClock = true;
  let best: Final | null = beamPass(ctx, 1, initState(ctx), 0, true);
  ctx.noClock = false;
  // the beams only until something packs: a greedy packing goes straight on to the natural phase
  for (const B of BEAMS) {
    if (best?.packed) break;
    let f = beamPass(ctx, B);
    if (!f) break;
    if (!f.packed) f = polish(ctx, f);
    if (!f.packed) f = replan(ctx, f, Math.max(REPLAN_BEAM, B >> 1));
    if (better(f, best)) best = f;
  }
  // strokes change length only when they must: of the packed panels the budget
  // still reaches, keep the one with fewest squares, then least cut, then least grown
  if (best?.packed) {
    stats.naturalRuns++;
    best = repairPolish(ctx, best);
    best = polish(ctx, best, true, true, "squares");
    best = pairPolish(ctx, best);
    best = replan(ctx, best, REPLAN_BEAM, true);
  }
  return best;
}

function zobrist(n: number): Int32Array {
  const z = new Int32Array(n);
  let a = 0x2545f491;
  for (let i = 0; i < n; i++) {
    // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    z[i] = t ^ (t >>> 14);
  }
  return z;
}

/**
 * Moves a search may try per millisecond of its budget. Measured on the
 * development machine at 340 to 1300 a millisecond; Al-Baqarah at 21x21
 * packs after about 310,000, so a 1400 ms budget (560,000) leaves room.
 */
const WORK_PER_MS = 400;

/**
 * Panels up to this many cells may run past the clock budget, to this factor,
 * before their work budget is spent, so a busy machine still gives the same
 * panel. Never past FIRST_DRAFT_CLOCK_MS: a search ends inside 2000 ms
 * whatever the load, and only then can a loaded machine give a different
 * panel. (A call is one search, except a fresh pack with pins: see
 * PINNED_CALL_MS.)
 */
const LOOSE_CLOCK_CELLS = 32 * 32;
const LOOSE_CLOCK = 2.5;
/** No search runs longer than this on the clock (2000 ms less room for drawing dots, fills and the result). */
const FIRST_DRAFT_CLOCK_MS = 1700;
/** The most moves a first draft and a repack may try (see WORK_PER_MS). */
const PACK_WORK = PACK_BUDGET_MS * WORK_PER_MS;
const REPACK_WORK = REPACK_BUDGET_MS * WORK_PER_MS;
/**
 * A search stops trying moves this far short of its cap: moves already chosen
 * (a beam's survivors, a replay's last letter) are still applied after it
 * stops, and must not take it past PACK_WORK or REPACK_WORK.
 */
const WORK_SLACK = 1000;
/** Moves tried by searches since last reset, for the budget tests. */
const stats = { work: 0, naturalRuns: 0 };

/**
 * Tests only: a deadline every search uses instead of its clock (Infinity:
 * work-bounded alone), so a test that asserts a layout cannot depend on
 * machine load. Null, the default, is the product's clock.
 */
let clockOverride: number | null = null;
function setClockOverride(deadline: number | null) {
  clockOverride = deadline;
}

function spent(ctx: Ctx): boolean {
  return ctx.out || ctx.work >= ctx.workMax || performance.now() > ctx.deadline;
}

function makeCtx(
  text: string,
  cols: number,
  rows: number,
  edits: KufiPanelEdits,
  pins: Map<number, Pin>,
  budgetMs: number,
  strictClock = false
): Ctx {
  const { units } = resolveKufiText(text);
  const rings = Math.max(1, Math.floor((Math.min(cols, rows) - 1) / (2 * (BAND + 1))) + 1);
  const routes = new Map<number, number>();
  for (const [w, r] of Object.entries(edits.routes ?? {})) routes.set(Number(w), Math.max(0, Math.floor(r)));
  const letters = lettersOf(text, units, edits, pins);
  return {
    cols,
    rows,
    n: cols * rows,
    letters,
    nTpl: rings * 4,
    zob: zobrist(cols * rows),
    routes,
    // the work budget makes a search give the same panel on a busy machine as on a quiet
    // one; the clock is a safety net, loose for panels the size of a real one and tight
    // for big ones, where a move costs more and nothing packs anyway
    deadline:
      clockOverride ??
      performance.now() + Math.min(FIRST_DRAFT_CLOCK_MS, budgetMs * (!strictClock && cols * rows <= LOOSE_CLOCK_CELLS ? LOOSE_CLOCK : 1)),
    work: 0,
    workMax: budgetMs * WORK_PER_MS - WORK_SLACK,
    out: false,
    noClock: false,
    mend: false,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Letters the text stands for: الله counts 4 and لا 2. */
function letterCount(units: KufiUnit[]): number {
  return units.reduce((n, u) => n + (u.skeleton === "allah" ? 4 : u.skeleton === "lamAlef" ? 2 : 1), 0);
}

function placementsOf(f: Final): KufiPlacement[] {
  const out = placedList(f.st).map((p) => {
    const b = boxOf(f.st.lines[p.line], p.shape, p.x0, p.yb);
    return {
      unitIndex: p.letter,
      key: "",
      glyphId: p.shape.g.id,
      col: b.col,
      row: b.row,
      turn: b.turn,
      stretch: p.shape.counts.slice(),
    };
  });
  return out.sort((a, b) => a.unitIndex - b.unitIndex);
}

/** The panel cell of (i, j) in a glyph box of h x w turned `turn` with its top-left at (row, col); see `rotateRows`. */
function boxCell(turn: Turn, h: number, w: number, row: number, col: number, i: number, j: number): [number, number] {
  switch (turn) {
    case 0:
      return [row + i, col + j];
    case 1:
      return [row + j, col + h - 1 - i];
    case 2:
      return [row + h - 1 - i, col + w - 1 - j];
    default:
      return [row + w - 1 - j, col + i];
  }
}

/** Which of the `DOT_SHIFT` ways the placed letter's dots are inked in `cells`, or 0. */
function dotsDrawn(text: string, unit: KufiUnit, p: KufiPlacement, cells: Uint8Array, cols: number, rows: number): number {
  const g = kufiFormsOf(unit).find((x) => x.id === p.glyphId);
  if (!g) return 0;
  const d = unit.skeleton === "allah" || unit.skeleton === "lamAlef" ? null : dotsOf(text[unit.textOffset] ?? "", unit.form);
  if (!d) return 0;
  const sh = shapeOf(g, normalCounts(g, p.stretch));
  const set = sh.dots[dotKey(d)];
  if (!set) return 0;
  for (let v = 1; v < DOT_SHIFT.length; v++) {
    let all = true;
    for (let k = 0; k < set.length && all; k += 2) {
      const [r, c] = boxCell(p.turn, sh.h, sh.w, p.row, p.col, sh.baseRow - set[k + 1], set[k] + DOT_SHIFT[v]);
      const ink = (rr: number, cc: number) => rr >= 0 && cc >= 0 && rr < rows && cc < cols && cells[rr * cols + cc] === 1;
      // a drawn dot is ink with nothing beside it; covered cells are another letter's
      all = ink(r, c) && !ink(r - 1, c) && !ink(r + 1, c) && !ink(r, c - 1) && !ink(r, c + 1);
    }
    if (all) return v;
  }
  return 0;
}

function pinOf(p: KufiPlacement, dots: number | null, explicit: boolean): Pin {
  return { glyphId: p.glyphId, counts: p.stretch.slice(), col: p.col, row: p.row, turn: p.turn, dots, explicit };
}

/** Explicit pins, or null when one cannot apply to its unit. */
function explicitPins(units: KufiUnit[], edits: KufiPanelEdits): Map<number, Pin> | null {
  const pins = new Map<number, Pin>();
  for (const [k, p] of Object.entries(edits.pinned ?? {})) {
    const i = Number(k);
    const u = units[i];
    const g = u && p.key === u.key ? kufiFormsOf(u).find((x) => x.id === p.glyphId) : undefined;
    // a stretch the glyph cannot take would be quietly corrected: a moved pin
    if (!g || !sameCounts(normalCounts(g, p.stretch), p.stretch)) return null;
    pins.set(i, pinOf(p, null, true));
  }
  return pins;
}

function applyCellEdits(cells: Uint8Array, cols: number, rows: number, placements: KufiPlacement[], edits: KufiPanelEdits) {
  for (const e of edits.cells ?? []) {
    const p = placements[e.unitIndex];
    if (!p || p.key !== e.key) continue;
    const r = p.row + e.dy;
    const c = p.col + e.dx;
    if (r >= 0 && c >= 0 && r < rows && c < cols) cells[r * cols + c] = e.on ? 1 : 0;
  }
}

/** No empty or solid 2×2 and no double break in the frame. */
function packedCells(cells: Uint8Array, cols: number, rows: number): boolean {
  const grid = { cols, rows, cells };
  if (inkBlocks2x2(grid).length || emptyBlocks2x2(grid).length) return false;
  for (let c = 0; c + 1 < cols; c++) {
    if (!cells[c] && !cells[c + 1]) return false;
    const b = (rows - 1) * cols + c;
    if (!cells[b] && !cells[b + 1]) return false;
  }
  for (let r = 0; r + 1 < rows; r++) {
    if (!cells[r * cols] && !cells[(r + 1) * cols]) return false;
    if (!cells[r * cols + cols - 1] && !cells[(r + 1) * cols + cols - 1]) return false;
  }
  return true;
}

function okResult(units: KufiUnit[], f: Final, cols: number, rows: number, edits: KufiPanelEdits): KufiPackResult {
  const placements = placementsOf(f).map((p) => ({ ...p, key: units[p.unitIndex].key }));
  const cells = new Uint8Array(cols * rows);
  for (let i = 0; i < cells.length; i++) cells[i] = f.owner[i] !== 0 ? 1 : 0;
  applyCellEdits(cells, cols, rows, placements, edits);
  const editsBreakPacking = (edits.cells?.length ?? 0) > 0 && !packedCells(cells, cols, rows);
  return { ok: true, cols, rows, cells, placements, editsBreakPacking };
}

/**
 * Fresh searches, cached by their inputs, so suggestions and fits are packed
 * once. A cached panel that did not pack is reused only for a budget no
 * larger than the one it was searched with.
 */
const finals = new Map<string, { f: Final | null; budget: number }>();
const FINALS_MAX = 64;
function freshFinal(
  text: string,
  cols: number,
  rows: number,
  edits: KufiPanelEdits,
  pins: Map<number, Pin>,
  budgetMs: number,
  strictClock = false
): Final | null {
  const key = JSON.stringify([text, cols, rows, edits.forms ?? {}, edits.stretch ?? {}, edits.routes ?? {}, edits.pinned ?? {}]);
  const hit = finals.get(key);
  if (hit && (hit.f?.packed || hit.budget >= budgetMs)) return hit.f;
  if (outOfRoom(text, cols, rows)) return null;
  if (budgetMs <= 0) return hit?.f ?? null;
  const f = search(makeCtx(text, cols, rows, edits, pins, budgetMs, strictClock));
  if (finals.size >= FINALS_MAX) finals.delete(finals.keys().next().value as string);
  finals.set(key, { f, budget: budgetMs });
  return f;
}

/**
 * True when the text cannot fit the box at all: its letters at their
 * narrowest, end to end, are longer than every line of every ring together
 * (with a quarter more for U-turned lines). Saves searching a hopeless box.
 */
function outOfRoom(text: string, cols: number, rows: number): boolean {
  const { units } = resolveKufiText(text);
  let need = 0;
  units.forEach((u, k) => {
    let w = Infinity;
    for (const g of kufiFormsOf(u)) w = Math.min(w, (g.rows[0]?.length ?? 1) - (g.inset?.right ?? 0) - (g.inset?.left ?? 0));
    need += (Number.isFinite(w) ? w : 1) + (k > 0 && units[k - 1].joinsNext ? -1 : 1);
  });
  const rings = Math.max(1, Math.floor((Math.min(cols, rows) - 1) / (2 * (BAND + 1))) + 1);
  let room = 0;
  for (let t = 0; t < rings * 4; t++) room += Math.max(0, ((t & 1) === 0 ? cols : rows) - 2 * (t >> 2) * (BAND + 1));
  return need > room * 1.25;
}

/** A first guess at the square side the text fills, from its letters' default boxes. */
function estimateSide(units: KufiUnit[]): number {
  let area = 0;
  for (const u of units) {
    const g = kufiFormsOf(u)[0];
    if (g) area += g.rows.length * g.rows[0].length;
  }
  return Math.max(3, Math.round(Math.sqrt(area * AREA_FACTOR)));
}
const AREA_FACTOR = 1.17;
/** Most sizes `fitKufiPanel` tries, and the suggestions after a failure. */
const FIT_TRIES = 9;
/** `fitKufiPanel` stops trying sizes after this. */
const FIT_BUDGET_MS = 9000;
const SUGGEST_TRIES = 6;

function sizesFrom(n: number, dir: 0 | 1 | -1): number[] {
  const out: number[] = [];
  if (dir === 0)
    for (let d = 0; out.length < FIT_TRIES; d++) {
      if (n + d >= 3) out.push(n + d);
      if (d > 0 && n - d >= 3 && out.length < FIT_TRIES) out.push(n - d);
    }
  else for (let k = n; out.length < SUGGEST_TRIES && k >= 3 && k <= 99; k += dir) out.push(k);
  return out;
}

/** Square sizes from (cols, rows) on, in the given direction, that pack. */
function suggestions(
  text: string,
  units: KufiUnit[],
  cols: number,
  rows: number,
  edits: KufiPanelEdits,
  dir: 1 | -1,
  deadline: number
): Array<{ cols: number; rows: number }> {
  const est = estimateSide(units);
  const from = dir > 0 ? Math.max(Math.max(cols, rows) + 1, est) : Math.min(Math.min(cols, rows) - 1, est);
  const out: Array<{ cols: number; rows: number }> = [];
  const pins = explicitPins(units, edits) ?? new Map<number, Pin>();
  for (const n of sizesFrom(from, dir)) {
    const left = Math.min(PACK_BUDGET_MS, deadline - performance.now());
    // a search shorter than this cannot finish even its first passes
    // what is left of the call's time, on the clock: suggestions never run the call over
    const f = freshFinal(text, n, n, edits, pins, left < MIN_SEARCH_MS ? 0 : left, true);
    if (f?.packed) out.push({ cols: n, rows: n });
    if (out.length >= 2 || left < MIN_SEARCH_MS) break;
  }
  return out;
}

function failure(
  text: string,
  units: KufiUnit[],
  f: Final | null,
  cols: number,
  rows: number,
  edits: KufiPanelEdits,
  deadline: number
): KufiPackResult {
  if (f && f.st.failedPins > 0) return { ok: false, reason: "pinConflict", suggestions: [] };
  const tooLong = !f || f.st.failed > 0;
  return {
    ok: false,
    reason: tooLong ? "tooLong" : "tooShort",
    suggestions: suggestions(text, units, cols, rows, edits, tooLong ? 1 : -1, deadline),
  };
}

/** The line each placed unit stands on, as "turn:baseline", in a previous panel. */
function lineKeys(units: KufiUnit[], prev: KufiPlacement[]): string[] {
  const keys: string[] = [];
  prev.forEach((p, k) => {
    const u = units[k];
    const g = kufiFormsOf(u).find((x) => x.id === p.glyphId);
    const startsLine = k === 0 || !units[k - 1].joinsNext || prev[k - 1].turn !== p.turn;
    if (!g || !startsLine) {
      keys.push(keys[k - 1] ?? "?");
      return;
    }
    keys.push(`${p.turn}:${pinBase(shapeOf(g, normalCounts(g, p.stretch)), pinOf(p, null, false))}`);
  });
  return keys;
}

function sameCounts(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Cells (row-major indices) a placement's glyph box covers. */
function boxIndices(p: KufiPlacement, units: KufiUnit[], cols: number, rows: number): number[] {
  const g = kufiFormsOf(units[p.unitIndex]).find((x) => x.id === p.glyphId);
  if (!g) return [];
  const sh = shapeOf(g, normalCounts(g, p.stretch));
  const tall = p.turn === 0 || p.turn === 2;
  const h = tall ? sh.h : sh.w;
  const w = tall ? sh.w : sh.h;
  const out: number[] = [];
  for (let r = p.row; r < p.row + h; r++) for (let c = p.col; c < p.col + w; c++) if (r >= 0 && c >= 0 && r < rows && c < cols) out.push(r * cols + c);
  return out;
}

/**
 * A repack from a previous panel. Units off the edited units' lines keep
 * their places, dots and all; when that cannot pack, the lines of units whose
 * boxes come within two cells of an edited unit's are freed too, and then
 * every line. Each round searches within what is left of the repack budget.
 */
function repack(
  text: string,
  units: KufiUnit[],
  cols: number,
  rows: number,
  edits: KufiPanelEdits,
  prev: KufiPlacement[],
  cells: Uint8Array,
  explicit: Map<number, Pin>
): Final | null {
  const t0 = performance.now();
  const dirty = new Set<number>();
  units.forEach((u, k) => {
    const p = prev[k];
    const g = kufiFormsOf(u).find((x) => x.id === p.glyphId);
    if (edits.forms?.[k] !== undefined && edits.forms[k] !== p.glyphId) dirty.add(k);
    if (edits.stretch?.[k] && g && !sameCounts(normalCounts(g, edits.stretch[k]), p.stretch)) dirty.add(k);
    const pin = edits.pinned?.[k];
    if (pin && (pin.glyphId !== p.glyphId || pin.col !== p.col || pin.row !== p.row || pin.turn !== p.turn || !sameCounts(pin.stretch, p.stretch)))
      dirty.add(k);
  });
  const keys = lineKeys(units, prev);
  const near = new Set<string>();
  {
    const zone = new Uint8Array(cols * rows);
    for (const k of dirty)
      for (const i of boxIndices(prev[k], units, cols, rows)) {
        const r = (i / cols) | 0;
        const c = i - r * cols;
        for (let dr = -2; dr <= 2; dr++)
          for (let dc = -2; dc <= 2; dc++) if (r + dr >= 0 && c + dc >= 0 && r + dr < rows && c + dc < cols) zone[(r + dr) * cols + c + dc] = 1;
      }
    prev.forEach((p, k) => {
      if (boxIndices(p, units, cols, rows).some((i) => zone[i])) near.add(keys[k]);
    });
  }
  // the last round frees every line: the implicit pins are dropped, a fresh pack in what is left
  const rounds = [new Set([...dirty].map((k) => keys[k])), near, null];
  let best: Final | null = null;
  let workLeft = REPACK_WORK;
  for (const free of rounds) {
    // under the tests' clock override every round gets the whole budget: no wall clock at all
    const left = clockOverride !== null ? REPACK_BUDGET_MS : REPACK_BUDGET_MS - (performance.now() - t0);
    if (left <= 0 || workLeft <= 0) break;
    const pins = new Map(explicit);
    units.forEach((u, k) => {
      if (pins.has(k) || !free || free.has(keys[k])) return;
      pins.set(k, pinOf(prev[k], dotsDrawn(text, u, prev[k], cells, cols, rows), false));
    });
    const ctx = makeCtx(text, cols, rows, edits, pins, left, true);
    ctx.workMax = Math.min(ctx.workMax, workLeft);
    const f = search(ctx);
    workLeft -= ctx.work;
    if (f && (!best || f.score < best.score)) best = f;
    if (best?.packed) break;
  }
  return best;
}

/**
 * A fresh pack with pins, as when a saved panel is opened again. Pins are
 * taken from packed panels, and the editor makes those by repacking from a
 * draft, so the panel is rebuilt the same way: the edits repacked onto the
 * fresh draft without edits (which the work budget reproduces exactly), then
 * onto a fresh pack of the edits without their pins. Only when neither holds
 * the pins does a fresh search with them decide, and only it may report a
 * conflict.
 *
 * The whole path ends by PINNED_CALL_MS (2 × CALL_BUDGET_MS): each search
 * gets at most what is left of it, and a step that cannot start in time is
 * skipped. The first draft always has its full budget (it must be the same
 * draft the session had).
 */
function packPinned(
  text: string,
  units: KufiUnit[],
  cols: number,
  rows: number,
  edits: KufiPanelEdits,
  explicit: Map<number, Pin>
): Final | null {
  const deadline = clockOverride !== null ? Infinity : performance.now() + PINNED_CALL_MS;
  const left = () => Math.min(PACK_BUDGET_MS, deadline - performance.now());
  const bases: KufiPanelEdits[] = [{}, { ...edits, pinned: undefined }];
  const tried = new Set<string>();
  for (const baseEdits of bases) {
    const key = JSON.stringify(baseEdits);
    if (tried.has(key)) continue;
    tried.add(key);
    if (left() < MIN_SEARCH_MS) return null;
    const base = freshFinal(text, cols, rows, baseEdits, new Map(), left());
    if (!base?.packed) continue;
    const prev = okResult(units, base, cols, rows, baseEdits);
    if (!prev.ok) continue;
    const f = repack(text, units, cols, rows, edits, prev.placements, prev.cells, explicit);
    if (f?.packed) return f;
  }
  if (left() < MIN_SEARCH_MS) return null;
  return freshFinal(text, cols, rows, edits, explicit, left());
}

/**
 * A fresh pack with pins (`packPinned`) ends within this. It is longer than a
 * plain call's CALL_BUDGET_MS, since rebuilding a saved panel may take a
 * draft, a repack and a fresh search; it runs in the worker.
 */
const PINNED_CALL_MS = 2 * 1750; // 2 × CALL_BUDGET_MS

/**
 * Packs `text` into a box of `cols` x `rows` cells. With `previous` (a packed
 * result for the same text and box) only the lines of edited units move.
 * A panel with holes is never reported as ok: the reason says whether the
 * text ran out of room (`tooLong`) or did not fill the box (`tooShort`), with
 * nearby sizes that do pack. Cell edits are painted over the packed panel.
 */
export function packKufiPanel(input: {
  text: string;
  cols: number;
  rows: number;
  edits?: KufiPanelEdits;
  previous?: KufiPackResult;
}): KufiPackResult {
  let t0 = performance.now();
  const { text, cols, rows } = input;
  const edits = input.edits ?? {};
  const { units } = resolveKufiText(text);
  if (letterCount(units) < 2) return { ok: false, reason: "tooShort", suggestions: [] };
  const explicit = explicitPins(units, edits);
  if (!explicit) return { ok: false, reason: "pinConflict", suggestions: [] };
  const prev = input.previous;
  let f: Final | null;
  let repacked = false;
  if (
    prev?.ok &&
    prev.cols === cols &&
    prev.rows === rows &&
    prev.placements.length === units.length &&
    prev.placements.every((p, k) => p.unitIndex === k && p.key === units[k].key)
  ) {
    f = repack(text, units, cols, rows, edits, prev.placements, prev.cells, explicit);
    repacked = true;
  } else if (explicit.size > 0) {
    f = packPinned(text, units, cols, rows, edits, explicit);
    // the pinned path spends its own bound; suggestions get a call's budget of their own
    t0 = performance.now();
  } else f = freshFinal(text, cols, rows, edits, explicit, PACK_BUDGET_MS);
  if (f?.packed) return okResult(units, f, cols, rows, edits);
  // after an edit the box is the user's: say why, but do not spend a first draft's time on other sizes
  return failure(text, units, f, cols, rows, edits, repacked ? 0 : t0 + CALL_BUDGET_MS);
}

/** Suggestions skip a size when less than this is left. */
const MIN_SEARCH_MS = 250;

/**
 * A whole call, suggestions included, ends within this (a search step may
 * overrun its deadline a little). A fresh pack with pins is the exception: it
 * may take PINNED_CALL_MS, then this again for its suggestions.
 */
export const CALL_BUDGET_MS = 1750;

/** A square size that packs `text`, trying sizes round an estimate; the closest attempt when none does. */
export function fitKufiPanel(text: string, edits: KufiPanelEdits = {}): { cols: number; rows: number } {
  const { units } = resolveKufiText(text);
  const est = estimateSide(units);
  if (letterCount(units) < 2) return { cols: est, rows: est };
  const pins = explicitPins(units, edits) ?? new Map<number, Pin>();
  let best: { n: number; score: number } | null = null;
  const t0 = performance.now();
  for (const n of sizesFrom(est, 0)) {
    if (performance.now() - t0 > FIT_BUDGET_MS) break;
    // the same path a pack takes, so a size fit calls packable is one a pack packs
    const f = pins.size > 0 ? packPinned(text, units, n, n, edits, pins) : freshFinal(text, n, n, edits, pins, PACK_BUDGET_MS);
    if (f?.packed) return { cols: n, rows: n };
    if (f && (!best || f.score < best.score)) best = { n, score: f.score };
  }
  const n = best?.n ?? est;
  return { cols: n, rows: n };
}

/**
 * Old unit index → new unit index, for units the text change kept: the
 * longest common subsequence of the two key lists. A unit that was deleted
 * or became another letter or form has no entry.
 */
function alignUnits(oldUnits: KufiUnit[], newUnits: KufiUnit[]): Map<number, number> {
  const n = oldUnits.length;
  const m = newUnits.length;
  const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      len[i][j] = oldUnits[i].key === newUnits[j].key ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
  const map = new Map<number, number>();
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (oldUnits[i].key === newUnits[j].key && len[i][j] === len[i + 1][j + 1] + 1) map.set(i++, j++);
    else if (len[i + 1][j] >= len[i][j + 1]) i++;
    else j++;
  }
  return map;
}

/**
 * Carries the edits across a text change: every index-keyed entry follows
 * its unit to its new index (aligned on unit keys), and routes follow their
 * word. Entries on a unit that was deleted or changed are dropped, as is
 * every other edit on a unit whose keyed edit (pin, cell) no longer matches;
 * form ids must still be forms of their unit, and stretch counts must fit one
 * of its glyphs.
 */
export function reconcileEdits(edits: KufiPanelEdits, oldUnits: KufiUnit[], newUnits: KufiUnit[]): KufiPanelEdits {
  const to = alignUnits(oldUnits, newUnits);
  const stale = new Set<number>();
  const fits = (k: number, glyphId: string) => !!newUnits[k] && kufiFormsOf(newUnits[k]).some((g) => g.id === glyphId);
  for (const [k, p] of Object.entries(edits.pinned ?? {})) {
    const j = to.get(+k);
    if (j === undefined || p.key !== newUnits[j].key || !fits(j, p.glyphId)) stale.add(+k);
  }
  for (const e of edits.cells ?? []) {
    const j = to.get(e.unitIndex);
    if (j === undefined || e.key !== newUnits[j].key) stale.add(e.unitIndex);
  }
  for (const [k, id] of Object.entries(edits.forms ?? {})) {
    const j = to.get(+k);
    if (j === undefined || !fits(j, id)) stale.add(+k);
  }
  const maxSlices = (j: number) => Math.max(0, ...kufiFormsOf(newUnits[j]).map((g) => g.stretch.length));
  const carry = <T,>(m: Record<number, T> | undefined, ok: (j: number, v: T) => boolean): Record<number, T> | undefined => {
    if (!m) return undefined;
    const out: Record<number, T> = {};
    for (const [k, v] of Object.entries(m)) {
      const j = to.get(+k);
      if (j !== undefined && !stale.has(+k) && ok(j, v)) out[j] = v;
    }
    return out;
  };
  const out: KufiPanelEdits = {};
  const forms = carry(edits.forms, () => true);
  const stretch = carry(edits.stretch, (j, v) => v.length <= maxSlices(j));
  const pinned = carry(edits.pinned, () => true);
  if (forms) out.forms = forms;
  if (stretch) out.stretch = stretch;
  if (pinned) out.pinned = Object.fromEntries(Object.entries(pinned).map(([j, p]) => [j, { ...p, unitIndex: +j }]));
  if (edits.routes) {
    // a word follows its units; one whose units all went, or split, loses its route
    const wordTo = new Map<number, number | null>();
    for (const [i, j] of to) {
      const w = oldUnits[i].wordIndex;
      const nw = newUnits[j].wordIndex;
      const seen = wordTo.get(w);
      wordTo.set(w, seen === undefined || seen === nw ? nw : null);
    }
    const routes: Record<number, number> = {};
    for (const [w, r] of Object.entries(edits.routes)) {
      const nw = wordTo.get(+w);
      if (nw !== undefined && nw !== null) routes[nw] = r;
    }
    out.routes = routes;
  }
  if (edits.cells)
    out.cells = edits.cells.filter((e) => !stale.has(e.unitIndex)).map((e) => ({ ...e, unitIndex: to.get(e.unitIndex)! }));
  return out;
}

/** Internals for the tests: the engine below the public API. */
export const _internal = {
  makeCtx,
  initState,
  expand,
  materialize,
  finish,
  beamPass,
  search,
  setClockOverride,
  CALL_BUDGET_MS,
  PINNED_CALL_MS,
  better,
  devOf,
  placedList,
  planOf,
  prefixesOf,
  replayFrom,
  movesAt,
  PACK_BUDGET_MS,
  clearCaches,
  stats,
  PACK_WORK,
  REPACK_WORK,
  FIRST_DRAFT_CLOCK_MS,
};

/** Every cache, so a timing is cold. */
function clearCaches() {
  finals.clear();
  shapeCache.clear();
  lineCache.clear();
}
