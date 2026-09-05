/**
 * Square-kufi layout: Arabic text set as strokes on a lattice.
 *
 * Two halves, both pure (no React, no Konva, no font loading, and no
 * `./harfbuzz` import — see `squareKufiAlphabet.ts` for why that last one
 * matters):
 *
 * - **`layoutSquareKufi`** turns a string into a grid of filled cells. It
 *   takes the joining forms from `lib/arabicJoining.ts` — the same
 *   Unicode-level classification HarfBuzz's Arabic shaper uses internally, and
 *   the module CLAUDE.md keeps around precisely for a consumer like this one.
 *   Nothing is shaped and no font is loaded: in square kufi a letter *is* its
 *   cells, so the whole pipeline is `text → forms → boxes → cells`.
 * - **`cellRings`** traces the outline of that grid. A block's ink has to read
 *   as one merged form, so the renderer cannot stroke cell by cell — that
 *   would draw the lattice itself, every internal seam included. Tracing the
 *   boundary once gives a real outline to stroke, and a hole comes out wound
 *   against its outer ring, so an ordinary nonzero fill leaves it empty with
 *   no even-odd flag to thread through Konva's context wrapper.
 *
 * ## What a join is
 *
 * Every join in this alphabet is a run of baseline cells between two letters
 * (`squareKufiAlphabet.ts` explains that choice). So the layout places letter
 * boxes with a fixed separation and then, for each joined pair, fills the
 * baseline row across the gap. That is the entire cursive mechanism — there is
 * no per-pair geometry, which is what keeps this file arithmetic.
 *
 * ## Wrapping
 *
 * `columns` wraps the run into stacked lines, which is how a square panel is
 * built: the text runs right-to-left, drops a line, and runs again. Lines are
 * flush right, being RTL. A word wider than a whole line is broken at a letter
 * boundary — the join across that break is lost, which is a real consequence
 * and is why `hardBreaks` is reported rather than swallowed.
 */

import { classifyJoiningForms, type JoiningForm } from "./arabicJoining";
import {
  ALEF_FAMILY,
  LAM,
  LAM_ALEF_SKELETON,
  skeletonFor,
  squareKufiForm,
  type KufiForm,
} from "./squareKufiAlphabet";

/**
 * Cells to one em. The block has no font and so no natural size, but it does
 * carry `fontSize` like every other block, and a tall letter (ا, ل, ط) is
 * seven cells — so dividing by eight makes a square-kufi alef stand about as
 * tall as a shaped one at the same `fontSize`. Renderer and any future
 * measurement read it from here rather than each keeping a copy.
 */
export const KUFI_CELLS_PER_EM = 8;

/** The px size of one lattice cell at a given `fontSize`. */
export const kufiCellSize = (fontSize: number) =>
  Math.max(0.5, fontSize / KUFI_CELLS_PER_EM);

export type SquareKufiOptions = {
  /**
   * Wrap width in cells. 0 or undefined runs the text as one unbroken band,
   * which is the freeform case; a number is what turns it into a panel.
   */
  columns?: number;
  /** Blank rows between wrapped lines. */
  lineGap?: number;
  /** Cells of blank between two words. */
  wordGap?: number;
  /** Cells between two letters of one word that do not join. */
  letterGap?: number;
  /** Cells of baseline stroke bridging two letters that do join. */
  joinGap?: number;
};

export type SquareKufiLayout = {
  cols: number;
  rows: number;
  /** Row-major, `rows * cols` long. */
  cells: boolean[];
  /** Characters that are neither spaces nor marks and that the alphabet cannot draw. */
  unsupported: string[];
  /** How many words had to be split because they did not fit on a line. */
  hardBreaks: number;
};

export const DEFAULT_KUFI_OPTIONS: Required<SquareKufiOptions> = {
  columns: 0,
  lineGap: 2,
  wordGap: 3,
  letterGap: 1,
  joinGap: 1,
};

/** One drawable letter, resolved to its cells and its two join flags. */
export type KufiUnit = {
  form: KufiForm;
  width: number;
  /** Ink at the baseline row's right column, continued to the previous letter. */
  joinsRight: boolean;
  /** …and to the next one, which in RTL sits to its left. */
  joinsLeft: boolean;
};

/** A unit placed on a line, with the separation to whatever follows it. */
type Slot = {
  unit: KufiUnit;
  /** Cells to the next slot on this line; 0 on the last. */
  gapAfter: number;
  /** Whether those cells carry the baseline stroke. */
  bridgeAfter: boolean;
};

/** Rows of a form at or above the baseline, and rows below it. */
export const formAscent = (form: KufiForm) => form.rows.length - form.base;
export const formDescent = (form: KufiForm) => Math.max(0, form.base);

const joinsRightOf = (form: JoiningForm) => form === "final" || form === "medial";
const joinsLeftOf = (form: JoiningForm) => form === "initial" || form === "medial";

function makeUnit(form: KufiForm, right: boolean, left: boolean): KufiUnit {
  return { form, width: form.rows[0]?.length ?? 0, joinsRight: right, joinsLeft: left };
}

// The same ranges lib/arabicJoining.ts treats as transparent and
// lib/diacritics.ts matches with ARABIC_DIACRITIC_RE. Restated here rather
// than imported because neither exposes it in a shape this file can use — one
// keeps its copy private, and importing the other would pull a much heavier
// module in for a single predicate.
function isCombiningMark(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return (
    (cp >= 0x0610 && cp <= 0x061a) ||
    (cp >= 0x064b && cp <= 0x065f) ||
    cp === 0x0670 ||
    (cp >= 0x06d6 && cp <= 0x06dc) ||
    (cp >= 0x06df && cp <= 0x06e4) ||
    (cp >= 0x06e7 && cp <= 0x06e8) ||
    (cp >= 0x06ea && cp <= 0x06ed)
  );
}

/**
 * The words of `text`, each a run of drawable letters in logical order.
 *
 * Combining marks are dropped without comment — square kufi carries no
 * tashkeel — while anything else the alphabet cannot draw is reported, so the
 * sidebar can say what was left out instead of the user finding a hole in the
 * panel. Empty words (a run of spaces) are not emitted.
 */
export function resolveWords(text: string): {
  words: KufiUnit[][];
  unsupported: string[];
} {
  const classified = classifyJoiningForms(text);
  const chars = Array.from(text);
  const words: KufiUnit[][] = [];
  const unsupported: string[] = [];
  let current: KufiUnit[] = [];

  const endWord = () => {
    if (current.length > 0) words.push(current);
    current = [];
  };

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    if (/\s/.test(char)) {
      endWord();
      continue;
    }

    const skeleton = skeletonFor(char);
    if (!skeleton) {
      if (!isCombiningMark(char)) unsupported.push(char);
      continue;
    }

    // A letter with no joining form is a non-joining one — ء is the only such
    // letter this alphabet draws — and a non-joining letter is exactly an
    // isolated form. Reading `null` as "undrawable" instead would silently drop
    // it, which is what happened before this line existed.
    const joining = classified[i]?.form ?? "isolated";

    // لا is one letterform, not two, so it is resolved before the lam is. The
    // alef is right-joining, so the ligature never joins to its left; it takes
    // the lam's own incoming join.
    const next = chars[i + 1];
    if (char === LAM && next !== undefined && ALEF_FAMILY.has(next)) {
      const joined = joining === "medial" || joining === "final";
      const form = squareKufiForm(LAM_ALEF_SKELETON, joined ? "final" : "isolated");
      if (form) {
        current.push(makeUnit(form, joined, false));
        i++;
        continue;
      }
    }

    const form = squareKufiForm(skeleton, joining);
    if (!form) {
      unsupported.push(char);
      continue;
    }
    current.push(makeUnit(form, joinsRightOf(joining), joinsLeftOf(joining)));
  }
  endWord();

  return { words, unsupported };
}

/** Cells between two adjacent units, and whether they carry the baseline stroke. */
function separation(
  a: KufiUnit,
  b: KufiUnit,
  opts: Required<SquareKufiOptions>
): { gap: number; bridged: boolean } {
  const bridged = a.joinsLeft && b.joinsRight;
  return { gap: bridged ? opts.joinGap : opts.letterGap, bridged };
}

/** One word turned into slots, the last of which has no gap after it. */
function wordSlots(word: KufiUnit[], opts: Required<SquareKufiOptions>): Slot[] {
  return word.map((unit, i) => {
    if (i === word.length - 1) return { unit, gapAfter: 0, bridgeAfter: false };
    const { gap, bridged } = separation(unit, word[i + 1], opts);
    return { unit, gapAfter: gap, bridgeAfter: bridged };
  });
}

const slotsWidth = (slots: Slot[]) =>
  slots.reduce((sum, s, i) => sum + s.unit.width + (i === slots.length - 1 ? 0 : s.gapAfter), 0);

/**
 * Greedy right-to-left line breaking. Words are kept whole where they fit; a
 * word wider than a whole line is split at letter boundaries, the only place a
 * split can go without inventing a letterform.
 */
function breakIntoLines(
  words: KufiUnit[][],
  opts: Required<SquareKufiOptions>
): { lines: Slot[][]; hardBreaks: number } {
  const limit = opts.columns > 0 ? opts.columns : Infinity;
  const lines: Slot[][] = [];
  let current: Slot[] = [];
  let hardBreaks = 0;

  const flush = () => {
    if (current.length > 0) {
      const last = current[current.length - 1];
      current[current.length - 1] = { ...last, gapAfter: 0, bridgeAfter: false };
      lines.push(current);
    }
    current = [];
  };

  const append = (slots: Slot[]) => {
    if (current.length > 0) {
      const last = current[current.length - 1];
      current[current.length - 1] = { ...last, gapAfter: opts.wordGap, bridgeAfter: false };
    }
    current.push(...slots);
  };

  const widthWith = (slots: Slot[]) =>
    slotsWidth(current) + (current.length > 0 ? opts.wordGap : 0) + slotsWidth(slots);

  for (const word of words) {
    let remaining = wordSlots(word, opts);

    while (remaining.length > 0) {
      if (widthWith(remaining) <= limit) {
        append(remaining);
        break;
      }
      // Does not fit beside what is already there — give it a line of its own.
      if (current.length > 0) {
        flush();
        continue;
      }
      // Alone on an empty line and still too wide: split at a letter boundary.
      let take = 0;
      while (take < remaining.length && slotsWidth(remaining.slice(0, take + 1)) <= limit) take++;
      // A single letter wider than the limit still has to go somewhere.
      if (take === 0) take = 1;
      append(remaining.slice(0, take));
      remaining = remaining.slice(take);
      hardBreaks++;
      flush();
    }
  }
  flush();

  return { lines, hardBreaks };
}

export function layoutSquareKufi(
  text: string,
  options: SquareKufiOptions = {}
): SquareKufiLayout {
  const opts: Required<SquareKufiOptions> = {
    columns: Math.max(0, Math.floor(options.columns ?? DEFAULT_KUFI_OPTIONS.columns)),
    lineGap: Math.max(0, Math.floor(options.lineGap ?? DEFAULT_KUFI_OPTIONS.lineGap)),
    wordGap: Math.max(1, Math.floor(options.wordGap ?? DEFAULT_KUFI_OPTIONS.wordGap)),
    letterGap: Math.max(1, Math.floor(options.letterGap ?? DEFAULT_KUFI_OPTIONS.letterGap)),
    joinGap: Math.max(1, Math.floor(options.joinGap ?? DEFAULT_KUFI_OPTIONS.joinGap)),
  };

  const { words, unsupported } = resolveWords(text);
  const empty: SquareKufiLayout = { cols: 0, rows: 0, cells: [], unsupported, hardBreaks: 0 };
  if (words.length === 0) return empty;

  const { lines, hardBreaks } = breakIntoLines(words, opts);
  if (lines.length === 0) return empty;

  // One ascent and one descent for the whole block, not per line, so every
  // line's baseline sits on the same lattice rows — which is what makes a
  // wrapped panel read as one woven field rather than as stacked strips.
  let ascent = 1;
  let descent = 0;
  for (const line of lines) {
    for (const slot of line) {
      ascent = Math.max(ascent, formAscent(slot.unit.form));
      descent = Math.max(descent, formDescent(slot.unit.form));
    }
  }
  const lineHeight = ascent + descent;

  const lineWidths = lines.map(slotsWidth);
  const cols = Math.max(opts.columns, ...lineWidths);
  const rows = lines.length * lineHeight + (lines.length - 1) * opts.lineGap;
  const cells = new Array<boolean>(cols * rows).fill(false);
  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    cells[y * cols + x] = true;
  };

  lines.forEach((line, lineIndex) => {
    const lineTop = lineIndex * (lineHeight + opts.lineGap);
    const baselineY = lineTop + ascent - 1;
    // Flush right: RTL runs start at the panel's right edge.
    let cursor = cols;

    for (const slot of line) {
      const { form } = slot.unit;
      const x = cursor - slot.unit.width;
      const top = lineTop + (ascent - formAscent(form));

      form.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) {
          if (row[c] === "#") set(x + c, top + r);
        }
      });

      if (slot.bridgeAfter) {
        for (let c = x - slot.gapAfter; c < x; c++) set(c, baselineY);
      }
      cursor = x - slot.gapAfter;
    }
  });

  return { cols, rows, cells, unsupported, hardBreaks };
}

/**
 * The wrap width whose panel comes out closest to square.
 *
 * Square kufi's whole point is the panel, and the column count that produces
 * one is not something a user can guess: it depends on which letters the text
 * happens to use and where the words fall. So this searches — the layout is
 * cheap arithmetic, and trying every width from the widest single letter up to
 * the unwrapped band is a few hundred passes at most.
 *
 * Ties go to the *wider* panel. Two column counts often score identically
 * because a line only breaks at a word, and the wider one wastes less of the
 * last line.
 */
export function squareColumnTarget(text: string, options: SquareKufiOptions = {}): number {
  const band = layoutSquareKufi(text, { ...options, columns: 0 });
  if (band.cols === 0 || band.rows === 0) return 0;

  const { words } = resolveWords(text);
  let widest = 1;
  for (const word of words) {
    for (const unit of word) widest = Math.max(widest, unit.width);
  }

  let best = band.cols;
  let bestError = Infinity;
  for (let columns = widest; columns <= band.cols; columns++) {
    const trial = layoutSquareKufi(text, { ...options, columns });
    if (trial.rows === 0) continue;
    const error = Math.abs(trial.cols / trial.rows - 1);
    if (error <= bestError) {
      bestError = error;
      best = columns;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Outline tracing
// ---------------------------------------------------------------------------

export type Ring = [number, number][];

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The boundary of a cell grid, as closed rings in cell coordinates.
 *
 * Each filled cell contributes the edges it does not share with another filled
 * cell, wound so that the material is always on the edge's right in screen
 * coordinates (y down). Outer rings therefore come out clockwise and holes
 * counter-clockwise, which is what lets the renderer fill with plain nonzero
 * winding and get the counters of ه and ص for free.
 *
 * Collinear points are collapsed, so a straight run of thirty cells is two
 * points rather than thirty-one — worth doing here rather than in the
 * renderer, since the SVG export path serializes whatever it is handed.
 */
export function cellRings(cells: boolean[], cols: number, rows: number): Ring[] {
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x];

  // start point -> the ends of every boundary edge leaving it
  const outgoing = new Map<string, [number, number][]>();
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = outgoing.get(k);
    if (list) list.push([x1, y1]);
    else outgoing.set(k, [[x1, y1]]);
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const rings: Ring[] = [];

  for (const [startKey, ends] of outgoing) {
    while (ends.length > 0) {
      const [sx, sy] = startKey.split(",").map(Number);
      const ring: Ring = [[sx, sy]];
      let cx = sx;
      let cy = sy;
      let dx = 0;
      let dy = 0;
      let guard = cols * rows * 8 + 16;

      while (guard-- > 0) {
        const list = outgoing.get(key(cx, cy));
        if (!list || list.length === 0) break;

        // At a diagonal pinch a vertex has two ways out. Continuing straight,
        // then turning clockwise, keeps the traversal hugging the component it
        // arrived on instead of hopping to the one that merely touches it.
        let pick = 0;
        if (list.length > 1 && (dx !== 0 || dy !== 0)) {
          const straight = list.findIndex(([ex, ey]) => ex - cx === dx && ey - cy === dy);
          const right = list.findIndex(([ex, ey]) => ex - cx === -dy && ey - cy === dx);
          pick = straight >= 0 ? straight : right >= 0 ? right : 0;
        }
        const [nx, ny] = list.splice(pick, 1)[0];
        dx = Math.sign(nx - cx);
        dy = Math.sign(ny - cy);
        cx = nx;
        cy = ny;
        if (cx === sx && cy === sy) break;
        ring.push([cx, cy]);
      }

      if (ring.length >= 4) rings.push(simplifyRing(ring));
    }
  }

  return rings;
}

/** Drops the interior point of any three collinear points, wrapping around. */
function simplifyRing(ring: Ring): Ring {
  const out: Ring = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = ring[(i - 1 + n) % n];
    const [x, y] = ring[i];
    const [qx, qy] = ring[(i + 1) % n];
    const collinear = (x - px) * (qy - y) === (y - py) * (qx - x);
    if (!collinear) out.push([x, y]);
  }
  return out.length >= 4 ? out : ring;
}
