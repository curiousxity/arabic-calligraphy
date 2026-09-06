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
 *
 * ## Boustrophedon — and the turn convention
 *
 * `composition: "boustrophedon"` snakes the reading: line 1 runs right to
 * left, line 2 continues from where it stopped and runs back, and the stroke
 * turns the corner with it. Classic panels do this, and it is why a
 * square-kufi field reads as woven rather than as stacked strips.
 *
 * **A return line is rotated 180°, never mirrored.** Both appear in published
 * panels, and mirroring is the rejected alternative — it is stated here for
 * the same reason `squareKufiAlphabet.ts` states its two conventions, because
 * the choice is invisible in the code that implements it:
 *
 * - *Rotation* turns the whole line about its own centre. Every letter is
 *   still the letter the alphabet drew, read upside down, and the line's two
 *   endpoints land on the same edge as the previous line's — so the turn is a
 *   short L in a reserved column rather than a run across the panel.
 * - *Mirroring* reflects it. An Arabic letter reflected is not that letter and
 *   in general is not any letter: ب becomes a shape with its tooth on the
 *   wrong side, and every join runs the wrong way. It reads as a font defect,
 *   which is the one failure mode this whole file is arranged to avoid.
 *
 * The turn itself is a single-cell run — the same primitive a letter join
 * already is — out into a reserved gutter column and down it to the next
 * line's baseline row. Two consequences are worth stating rather than
 * discovering:
 *
 * - **A rotated line's baseline row is `bandTop + descent`, not `bandTop`.**
 *   The band is `ascent + descent` rows and the baseline sits at `ascent - 1`,
 *   so turning it puts the baseline at `(ascent + descent - 1) - (ascent - 1)`.
 *   `descent` is 1 for any text containing ر و م ج ح ه — most real phrases —
 *   so reading the band's top row as the baseline lands every turn one row
 *   short of the letters it is meant to join.
 * - **Alternate baselines therefore sit on two different lattice rows**
 *   relative to their bands, so the white space between lines alternates
 *   between `lineGap + 2·descent` and `lineGap` rows. That is inherent to
 *   turning a line whose letters hang below the line, not a spacing bug.
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

/**
 * How stacked lines are arranged.
 *
 * `"lines"` is the plain reading: every line runs right to left, all of them
 * flush right. `"boustrophedon"` snakes — see the module header for the turn
 * convention and for why a return line is rotated rather than mirrored.
 */
export type KufiComposition = "lines" | "boustrophedon";

/**
 * A whitelist, not a clamp. `kufiComposition` is a string union that arrives
 * from a saved project, so anything not named here — including a value from a
 * later release — falls back to the composition that predates the feature.
 */
export const normalizeKufiComposition = (value: unknown): KufiComposition =>
  value === "boustrophedon" ? "boustrophedon" : "lines";

/**
 * Blank columns reserved down each side of a snaking panel.
 *
 * The turn runs vertically down the **outer** one, which leaves the inner one
 * as a permanent buffer between that run and the nearest letter. Both are
 * needed, and one is not enough: the run necessarily spans the baseline row
 * *and* the descender row of the line it leaves (and of the line it arrives
 * at), so a single reserved column would put it directly beside ر or ج — both
 * of which carry ink at their left column on both of those rows — and two
 * filled columns over two filled rows is exactly the 2×2 the whole grammar
 * forbids. With the buffer the adjacency cannot arise for any text, which is
 * what makes the invariant structural rather than lucky.
 */
export const KUFI_TURN_GUTTER = 2;

export type SquareKufiOptions = {
  /**
   * Wrap width in cells. 0 or undefined runs the text as one unbroken band,
   * which is the freeform case; a number is what turns it into a panel.
   */
  columns?: number;
  /** How stacked lines are arranged. Absent is `"lines"`. */
  composition?: KufiComposition;
  /** Blank rows between wrapped lines. */
  lineGap?: number;
  /** Cells of blank between two words. */
  wordGap?: number;
  /** Cells between two letters of one word that do not join. */
  letterGap?: number;
  /** Cells of baseline stroke bridging two letters that do join. */
  joinGap?: number;
};

/**
 * Where one letter ended up on the lattice. Emitted only when the caller asks
 * for it (see `layoutSquareKufi`'s third argument), because the only consumer
 * is hand editing and the fit search lays a panel out ~160 times per press.
 *
 * All four coordinates are in the *generated* grid's own frame — the one
 * `SquareKufiLayout.cells` is indexed in, before any hand edit has grown it.
 */
export type KufiPlacement = {
  unitIndex: number;
  unitKey: string;
  /** Left column of the letter's box. */
  x: number;
  /** Top row of the letter's box. */
  y: number;
  width: number;
  height: number;
  /**
   * The row this letter sits on. A hand edit's `dy` is measured from here and
   * not from `y`: the box top is `lineTop + (ascent - formAscent(form))` and
   * so moves whenever the form changes height, even when the letter has not.
   */
  baselineY: number;
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
  /** One entry per drawn letter, or empty when the caller did not ask. */
  placements: KufiPlacement[];
};

export const DEFAULT_KUFI_OPTIONS: Required<SquareKufiOptions> = {
  columns: 0,
  composition: "lines",
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
  /**
   * Position in the run, counted across every word in logical order. This is
   * what a hand edit anchors to — see `KufiCellEdit`.
   */
  index: number;
  /**
   * A fingerprint of the *resolved* form: its rows and its base, nothing else.
   *
   * Deliberately **not** `skeleton:form`. `squareKufiAlphabet.ts`'s `all()`
   * helper gives feh, heh and tah one `KufiForm` object across all four
   * joining forms, and `TOOTH_INITIAL`/`TOOTH_MEDIAL` are shared between beh,
   * noon and yeh — so typing the next letter of a word can change the
   * *requested* form while the box actually drawn is literally the same
   * object. Keying on the requested form would drop a user's hand edits on
   * that keystroke. This is the faithful analogue of `GlyphTransform`'s
   * `glyphId`: the identity of what is drawn, not of what was asked for.
   */
  key: string;
};

/** The `KufiUnit.key` fingerprint. Exported so a test can build one by hand. */
export const kufiFormKey = (form: KufiForm) => `${form.rows.join("|")}|${form.base}`;

/** A unit placed on a line, with the separation to whatever follows it. */
type Slot = {
  unit: KufiUnit;
  /** Cells to the next slot on this line; 0 on the last. */
  gapAfter: number;
  /** Whether those cells carry the baseline stroke. */
  bridgeAfter: boolean;
};

/**
 * The row of a band, counted from its top, that a line's letters sit on.
 *
 * A band is `ascent + descent` rows and an unturned line's baseline is
 * `ascent - 1` rows down it. A half turn maps row `r` to `h - 1 - r`, so a
 * turned line's baseline lands at `(ascent + descent - 1) - (ascent - 1)`,
 * which is **`descent`** — not the band's top row. `descent` is 1 for any text
 * containing ر و م ج ح ه, so reading the top row as the baseline puts every
 * turn one row clear of the letters it exists to join, and the panel comes
 * apart in exactly the fonts-are-broken way this file is arranged to avoid.
 */
export const baselineRowInBand = (turns: 0 | 2, ascent: number, descent: number) =>
  turns === 2 ? descent : ascent - 1;

/** Rows of a form at or above the baseline, and rows below it. */
export const formAscent = (form: KufiForm) => form.rows.length - form.base;
export const formDescent = (form: KufiForm) => Math.max(0, form.base);

const joinsRightOf = (form: JoiningForm) => form === "final" || form === "medial";
const joinsLeftOf = (form: JoiningForm) => form === "initial" || form === "medial";

function makeUnit(
  form: KufiForm,
  right: boolean,
  left: boolean,
  index: number
): KufiUnit {
  return {
    form,
    width: form.rows[0]?.length ?? 0,
    joinsRight: right,
    joinsLeft: left,
    index,
    key: kufiFormKey(form),
  };
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
  // Runs across every word, in logical order, so a unit's index survives the
  // line breaking that comes later — the whole point of anchoring hand edits
  // to a letter rather than to a grid coordinate.
  let unitIndex = 0;

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
        current.push(makeUnit(form, joined, false, unitIndex++));
        i++;
        continue;
      }
    }

    const form = squareKufiForm(skeleton, joining);
    if (!form) {
      unsupported.push(char);
      continue;
    }
    current.push(
      makeUnit(form, joinsRightOf(joining), joinsLeftOf(joining), unitIndex++)
    );
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
  // Running width of `current`. Rescanning it per candidate made this function
  // quadratic in the line's length, and `squareColumnTarget` calls it once per
  // candidate width — which is what turned "fit to square" into seconds of
  // blocked main thread on a long passage. `flush` needs no adjustment:
  // `slotsWidth` never counts the last slot's `gapAfter`, which is the only
  // field it rewrites.
  let currentWidth = 0;

  const flush = () => {
    if (current.length > 0) {
      const last = current[current.length - 1];
      current[current.length - 1] = { ...last, gapAfter: 0, bridgeAfter: false };
      lines.push(current);
    }
    current = [];
    currentWidth = 0;
  };

  const append = (slots: Slot[]) => {
    if (current.length > 0) {
      const last = current[current.length - 1];
      current[current.length - 1] = { ...last, gapAfter: opts.wordGap, bridgeAfter: false };
      // The slot that was last now carries a gap, so it starts counting.
      currentWidth += opts.wordGap;
    }
    current.push(...slots);
    currentWidth += slotsWidth(slots);
  };

  const widthWith = (slots: Slot[]) =>
    currentWidth + (current.length > 0 ? opts.wordGap : 0) + slotsWidth(slots);

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
      // Widths accumulate rather than re-summing each prefix, which is the
      // other half of keeping this function linear.
      let take = 0;
      let taken = 0;
      while (take < remaining.length) {
        const grown =
          taken + (take > 0 ? remaining[take - 1].gapAfter : 0) + remaining[take].unit.width;
        if (grown > limit) break;
        taken = grown;
        take++;
      }
      // A single letter wider than the limit still has to go somewhere.
      if (take === 0) take = 1;
      // Only a *split* loses a join. Forcing one over-wide letter onto its own
      // line when it is the whole of what remains splits nothing, and warning
      // about it sends the user widening a panel to close a break that never
      // happened.
      if (take < remaining.length) hardBreaks++;
      append(remaining.slice(0, take));
      remaining = remaining.slice(take);
      flush();
    }
  }
  flush();

  return { lines, hardBreaks };
}

/** A grid being written into, in its own frame. */
type CellTarget = { cells: boolean[]; cols: number; rows: number };

/**
 * Renders one line into its own tight sub-grid and blits it into `dest` under
 * `turns` quarter-…no: under a half turn or none at all.
 *
 * Going through a sub-grid rather than writing letters straight into the panel
 * is what makes the 180° case correct by construction instead of by a second
 * set of coordinate formulas. `turns: 0` is an identity blit and reproduces
 * the flush-right placement that predates boustrophedon cell for cell, which
 * is the whole safety margin of doing it this way.
 *
 * `left`/`top` are the band's top-left in `dest`; the sub-grid is
 * `lineWidth × (ascent + descent)`. Placements come back in `dest`'s frame —
 * a rotated letter's box is its *drawn* box, so a hand edit anchored to it
 * stays anchored the way it does on an unturned line.
 */
function placeLine(
  dest: CellTarget,
  line: Slot[],
  lineWidth: number,
  ascent: number,
  descent: number,
  left: number,
  top: number,
  turns: 0 | 2,
  placements: KufiPlacement[] | null
): void {
  const w = lineWidth;
  const h = ascent + descent;
  if (w <= 0 || h <= 0) return;

  const local = new Array<boolean>(w * h).fill(false);
  const setLocal = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    local[y * w + x] = true;
  };
  const localBaseline = baselineRowInBand(0, ascent, descent);

  // Where a sub-grid cell lands in `dest`. A half turn maps a cell to the
  // opposite corner of the band, which is all "rotated 180°" means on a
  // lattice.
  const putX = (lx: number) => (turns === 2 ? left + (w - 1 - lx) : left + lx);
  const putY = (ly: number) => (turns === 2 ? top + (h - 1 - ly) : top + ly);

  const boxes: { slot: Slot; x: number; top: number }[] = [];
  // Flush right inside the sub-grid: RTL runs start at the line's own right
  // edge, whichever edge of the panel that turns out to be.
  let cursor = w;
  for (const slot of line) {
    const { form } = slot.unit;
    const x = cursor - slot.unit.width;
    const boxTop = ascent - formAscent(form);

    form.rows.forEach((row, r) => {
      for (let c = 0; c < row.length; c++) {
        if (row[c] === "#") setLocal(x + c, boxTop + r);
      }
    });

    if (slot.bridgeAfter) {
      for (let c = x - slot.gapAfter; c < x; c++) setLocal(c, localBaseline);
    }
    if (placements) boxes.push({ slot, x, top: boxTop });
    cursor = x - slot.gapAfter;
  }

  for (let ly = 0; ly < h; ly++) {
    for (let lx = 0; lx < w; lx++) {
      if (!local[ly * w + lx]) continue;
      const dx = putX(lx);
      const dy = putY(ly);
      if (dx < 0 || dy < 0 || dx >= dest.cols || dy >= dest.rows) continue;
      dest.cells[dy * dest.cols + dx] = true;
    }
  }

  if (!placements) return;
  const baselineY = putY(localBaseline);
  for (const b of boxes) {
    const bw = b.slot.unit.width;
    const bh = b.slot.unit.form.rows.length;
    placements.push({
      unitIndex: b.slot.unit.index,
      unitKey: b.slot.unit.key,
      // A half turn swaps which local corner is the top-left one, so the box
      // is taken from both mapped corners rather than from the first.
      x: Math.min(putX(b.x), putX(b.x + bw - 1)),
      y: Math.min(putY(b.top), putY(b.top + bh - 1)),
      width: bw,
      height: bh,
      baselineY,
    });
  }
}

/**
 * Lays the text out on the lattice.
 *
 * `emit.placements` is a separate argument rather than a `SquareKufiOptions`
 * field on purpose: `squareColumnTarget` re-lays the same text up to
 * `COLUMN_SWEEP_BUDGET` + refinement times through `{ ...options, columns }`,
 * and a field would ride along on every one of those passes. Nothing in the
 * fit search, the Sidebar's readout or the placement ghost reads placements,
 * so per-unit allocation across that sweep would be pure cost — exactly the
 * cliff CLAUDE.md records this function being wrong about twice already.
 */
export function layoutSquareKufi(
  text: string,
  options: SquareKufiOptions = {},
  emit: { placements?: boolean } = {}
): SquareKufiLayout {
  const opts: Required<SquareKufiOptions> = {
    columns: Math.max(0, Math.floor(options.columns ?? DEFAULT_KUFI_OPTIONS.columns)),
    composition: normalizeKufiComposition(options.composition),
    lineGap: Math.max(0, Math.floor(options.lineGap ?? DEFAULT_KUFI_OPTIONS.lineGap)),
    wordGap: Math.max(1, Math.floor(options.wordGap ?? DEFAULT_KUFI_OPTIONS.wordGap)),
    letterGap: Math.max(1, Math.floor(options.letterGap ?? DEFAULT_KUFI_OPTIONS.letterGap)),
    joinGap: Math.max(1, Math.floor(options.joinGap ?? DEFAULT_KUFI_OPTIONS.joinGap)),
  };

  const { words, unsupported } = resolveWords(text);
  const empty: SquareKufiLayout = {
    cols: 0,
    rows: 0,
    cells: [],
    unsupported,
    hardBreaks: 0,
    placements: [],
  };
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

  // A single line has nothing to turn into, so boustrophedon is exactly
  // `lines` there — and reserving gutters for a turn that cannot happen would
  // pad the block with empty columns for nothing.
  const snaking = opts.composition === "boustrophedon" && lines.length > 1;
  const gutter = snaking ? KUFI_TURN_GUTTER : 0;
  // The turn needs a row of its own to travel down. At `lineGap` 0 with no
  // descenders the two baseline rows are adjacent and the two horizontal runs
  // would sit one above the other in the gutter — a 2×2 made by the bridge
  // alone. One blank row is the least that keeps the turn single-width.
  const lineGap = snaking ? Math.max(1, opts.lineGap) : opts.lineGap;

  const cols = Math.max(opts.columns, ...lineWidths) + gutter * 2;
  const rows = lines.length * lineHeight + (lines.length - 1) * lineGap;
  const dest: CellTarget = {
    cells: new Array<boolean>(cols * rows).fill(false),
    cols,
    rows,
  };

  // Filled in the same pass that writes the cells, never re-derived after it.
  // A second pass over the same arithmetic type-checks perfectly and lands
  // every hand edit a cell or two off the letter it belongs to.
  const placements: KufiPlacement[] = [];

  /** A line's band top, its half-turn count, and the row its letters sit on. */
  const bandTop = (i: number) => i * (lineHeight + lineGap);
  const turnsOf = (i: number): 0 | 2 => (snaking && i % 2 === 1 ? 2 : 0);
  // The corrected arithmetic: a turned band's baseline is `descent` rows below
  // its top, not at its top. See the module header.
  const baselineRowOf = (i: number) =>
    bandTop(i) + baselineRowInBand(turnsOf(i), ascent, descent);

  lines.forEach((line, i) => {
    const turns = turnsOf(i);
    // Even lines keep the flush-right run of the unturned composition; odd
    // ones are laid flush left, which after the half turn puts their *first*
    // letter against the same edge the previous line ended at.
    const left = turns === 2 ? gutter : cols - gutter - lineWidths[i];
    placeLine(
      dest,
      line,
      lineWidths[i],
      ascent,
      descent,
      left,
      bandTop(i),
      turns,
      emit.placements ? placements : null
    );
  });

  if (snaking) {
    for (let i = 0; i + 1 < lines.length; i++) {
      // Line 0 runs right to left and stops at the panel's left edge; the
      // line it hands over to has been turned, so its first letter is at that
      // same edge. Every following turn alternates.
      const onLeft = i % 2 === 0;
      drawTurn(dest, baselineRowOf(i), baselineRowOf(i + 1), onLeft);
    }
  }

  return {
    cols,
    rows,
    cells: dest.cells,
    unsupported,
    hardBreaks,
    placements,
  };
}

/**
 * The bridge that carries the stroke from one line's end into the next line's
 * start: along the baseline row out to the gutter, down the gutter, and back
 * in along the next baseline row.
 *
 * Single-cell-wide throughout, which is the same primitive a letter join
 * already is — there is no second grammar here. The vertical leg runs down the
 * **outermost** column so the reserved column beside it stays empty; see
 * `KUFI_TURN_GUTTER` for why one reserved column is not enough.
 *
 * Nothing is drawn unless *both* baseline rows carry ink to attach to. A
 * dangling stub would read as a stray stroke, and a line with no ink on its
 * baseline row has no end cell to leave from.
 */
function drawTurn(
  dest: CellTarget,
  fromRow: number,
  toRow: number,
  onLeft: boolean
): void {
  const gutterCol = onLeft ? 0 : dest.cols - 1;
  const step = onLeft ? 1 : -1;

  /** The first ink on `row`, scanning inward from the gutter. */
  const firstInk = (row: number): number => {
    if (row < 0 || row >= dest.rows) return -1;
    for (let x = gutterCol; x >= 0 && x < dest.cols; x += step) {
      if (dest.cells[row * dest.cols + x]) return x;
    }
    return -1;
  };

  const fromInk = firstInk(fromRow);
  const toInk = firstInk(toRow);
  if (fromInk < 0 || toInk < 0) return;

  const set = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= dest.cols || y >= dest.rows) return;
    dest.cells[y * dest.cols + x] = true;
  };
  const runIn = (row: number, ink: number) => {
    for (let x = gutterCol; x !== ink; x += step) set(x, row);
  };

  runIn(fromRow, fromInk);
  runIn(toRow, toInk);
  const top = Math.min(fromRow, toRow);
  const bottom = Math.max(fromRow, toRow);
  for (let y = top; y <= bottom; y++) set(gutterCol, y);
}

/**
 * How many candidate widths `squareColumnTarget` will lay out before it
 * switches from sweeping every column to sweeping coarsely and refining.
 *
 * Each candidate costs a full layout pass, and the number of candidates grows
 * with the text — so an exhaustive sweep is quadratic in length overall. At
 * 1800 characters that was measured at 5.4 seconds of blocked main thread
 * (7.1 before the line breaker was made linear), from a button the user can
 * press again while it runs.
 */
const COLUMN_SWEEP_BUDGET = 160;

/**
 * The wrap width whose panel comes out closest to square.
 *
 * Square kufi's whole point is the panel, and the column count that produces
 * one is not something a user can guess: it depends on which letters the text
 * happens to use and where the words fall. So this searches, between the
 * widest single letter (below which nothing fits) and the unwrapped band.
 *
 * **Short texts are still searched exhaustively.** Only when the range exceeds
 * `COLUMN_SWEEP_BUDGET` does it step coarsely and then re-sweep every column
 * within one step either side of the coarse winner. That is a heuristic rather
 * than a proof: the panel's aspect ratio rises broadly with the column count
 * (more columns, fewer rows), so the error is broadly V-shaped and a refined
 * coarse minimum lands in the same basin — but word-break quantization puts
 * small teeth on that curve, and a tooth further away than one coarse step
 * would be missed. Being a column or two off "closest to square" is invisible;
 * a seven-second freeze is not.
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
  // `<=` rather than `<`: equal scores keep the later, wider candidate, and
  // both phases below sweep upwards so that rule holds throughout.
  const consider = (columns: number) => {
    const trial = layoutSquareKufi(text, { ...options, columns });
    if (trial.rows === 0) return;
    const error = Math.abs(trial.cols / trial.rows - 1);
    if (error <= bestError) {
      bestError = error;
      best = columns;
    }
  };

  const span = band.cols - widest + 1;
  const step = span <= COLUMN_SWEEP_BUDGET ? 1 : Math.ceil(span / COLUMN_SWEEP_BUDGET);

  for (let columns = widest; columns <= band.cols; columns += step) consider(columns);
  // The band itself is the widest legal panel and a coarse step can overshoot
  // it, so it is always a candidate.
  if ((band.cols - widest) % step !== 0) consider(band.cols);

  if (step > 1) {
    const from = Math.max(widest, best - step + 1);
    const to = Math.min(band.cols, best + step - 1);
    const coarse = best;
    // Re-sweeping the coarse winner's own neighbourhood upwards keeps the
    // wider-panel tie-break: a refined candidate only wins on a strictly
    // better score until it passes the coarse pick.
    for (let columns = from; columns <= to; columns++) {
      if (columns !== coarse) consider(columns);
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Hand edits — painting and erasing individual cells
// ---------------------------------------------------------------------------

/**
 * One hand-painted (or hand-erased) cell.
 *
 * **Anchored to a letter, never to the grid.** `ascent`/`descent` are
 * block-wide, `cols` is `Math.max(opts.columns, ...lineWidths)`, and every
 * line is laid flush right from `cursor = cols` — so nearly every text edit,
 * and the Panel width, Line gap, Word gap and Fit-to-square controls too,
 * move every absolute grid coordinate in the panel. `unitIndex` plus a
 * `dx`/`dy` offset from that letter's own box survives all of them.
 *
 * `unitKey` is the form fingerprint the edit was made against (see
 * `KufiUnit.key`). It is **optional on purpose**, exactly as
 * `GlyphTransform.glyphId` is: an edit saved before the field existed cannot
 * be validated, and dropping it would be worse than applying it to whatever
 * letter now holds its index.
 */
export type KufiCellEdit = {
  /** Which letter of the run this cell belongs to, in logical order. */
  unitIndex: number;
  /** Fingerprint of the form the edit was made against. Absent = unchecked. */
  unitKey?: string;
  /** Columns right of that letter's left edge. May be negative. */
  dx: number;
  /** Rows below that letter's baseline row. May be negative. */
  dy: number;
  /** true paints the cell, false erases one the alphabet drew. */
  on: boolean;
};

/**
 * How far from its letter a hand edit may reach, in cells.
 *
 * A bound is needed at all because ownership is nearest-letter: without one, a
 * cell dropped in an empty corner of a large panel would anchor to a letter
 * half a panel away and then travel with it on rewrap, which reads as the edit
 * teleporting. Eight cells is one em at `KUFI_CELLS_PER_EM`, so the reachable
 * neighbourhood is about a letter's own height in every direction.
 */
export const KUFI_EDIT_REACH = 8;

/** Just the block fields the layout reads, so this module needs no app types. */
export type KufiOptionSource = {
  kufiColumns?: number;
  kufiLineGap?: number;
  kufiWordGap?: number;
  /** Free-form on purpose — it is whitelisted, never trusted. */
  kufiComposition?: string;
};

/**
 * The layout options a square-kufi block asks for.
 *
 * Every call site goes through this — the renderer, the two Sidebar readouts,
 * App's placement ghost and its Fit-to-square, and the cell-edit overlay. They
 * must agree exactly: the overlay resolves a pointer against the same grid the
 * renderer draws, and a single forgotten field puts the two one wrap apart.
 */
export const kufiOptionsFor = (block: KufiOptionSource): SquareKufiOptions => ({
  columns: block.kufiColumns,
  composition: normalizeKufiComposition(block.kufiComposition),
  lineGap: block.kufiLineGap,
  wordGap: block.kufiWordGap,
});

/** Squared cell distance from a cell to the nearest point of a placed box. */
function boxDistance2(p: KufiPlacement, x: number, y: number): number {
  const dx = x < p.x ? p.x - x : x > p.x + p.width - 1 ? x - (p.x + p.width - 1) : 0;
  const dy = y < p.y ? p.y - y : y > p.y + p.height - 1 ? y - (p.y + p.height - 1) : 0;
  return dx * dx + dy * dy;
}

/**
 * Which letter owns the cell at `(x, y)` in the generated grid's frame.
 *
 * **Nearest letter wins** — the maintainer's chosen rule, not a fallback.
 * Distance is measured to the nearest point of the letter's *box*, not to its
 * centre, so a cell just outside a wide letter belongs to that letter rather
 * than to a small one whose centre happens to be nearer. A cell inside a box
 * is at distance 0 and so owned by it, which is why no separate
 * containing-box stage is needed. Ties go to the lower `unitIndex`, so the
 * answer never depends on the order placements were emitted in.
 *
 * Kept as one function on purpose: it decides where a cell painted out in the
 * blank field travels on rewrap, and it is the single thing to change if a
 * real panel argues for something else.
 */
export function resolveCellOwner(
  placements: KufiPlacement[],
  x: number,
  y: number
): KufiPlacement | null {
  let best: KufiPlacement | null = null;
  let bestD = Infinity;
  for (const p of placements) {
    const d = boxDistance2(p, x, y);
    if (d < bestD || (d === bestD && best !== null && p.unitIndex < best.unitIndex)) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * The edit that paints (or erases) the cell at `(x, y)` in the generated
 * frame, or `null` when no letter is near enough to anchor it — see
 * `KUFI_EDIT_REACH`.
 */
export function cellEditAt(
  placements: KufiPlacement[],
  x: number,
  y: number,
  on: boolean
): KufiCellEdit | null {
  const owner = resolveCellOwner(placements, x, y);
  if (!owner) return null;
  const dx = x - owner.x;
  const dy = y - owner.baselineY;
  if (Math.abs(dx) > KUFI_EDIT_REACH || Math.abs(dy) > KUFI_EDIT_REACH) return null;
  return { unitIndex: owner.unitIndex, unitKey: owner.unitKey, dx, dy, on };
}

/** Two edits address the same cell when they name the same letter and offset. */
const sameAnchor = (a: KufiCellEdit, b: KufiCellEdit) =>
  a.unitIndex === b.unitIndex && a.dx === b.dx && a.dy === b.dy;

/**
 * Writes one edit into a block's list.
 *
 * An edit that asks for exactly what the alphabet already draws there is a
 * **removal**, not a stored no-op — the same rule `setStrokeCut` follows for a
 * zero-nuqta cut. Without it the array grows every time a user paints a cell
 * and paints it back out.
 */
export function upsertCellEdit(
  edits: KufiCellEdit[],
  edit: KufiCellEdit,
  generatedOn: boolean
): KufiCellEdit[] {
  const rest = edits.filter((e) => !sameAnchor(e, edit));
  return edit.on === generatedOn ? rest : [...rest, edit];
}

/**
 * The grid actually drawn: the generated one with the hand edits composited
 * over it.
 *
 * Painted cells may fall outside the generated grid, so the result can be
 * larger than the layout and start at a negative origin. `originX`/`originY`
 * are that origin in the generated frame (both ≤ 0), and the renderer must
 * offset its Konva nodes by them — not merely its draw calls — or the block
 * reports a self-rect that no longer contains its own ink, and `exportBox`,
 * `buildSnapTargets`, Align & Arrange and the mirror's settle loop all
 * silently under-report it.
 */
export type ComposedKufiGrid = {
  cols: number;
  rows: number;
  cells: boolean[];
  /** Generated-frame column the composed grid starts at. ≤ 0. */
  originX: number;
  /** Generated-frame row the composed grid starts at. ≤ 0. */
  originY: number;
  /** Edits that resolved onto a letter and were drawn. */
  applied: number;
  /** Edits whose letter is gone, whose form changed, or that reach too far. */
  dropped: number;
};

export function applyCellEdits(
  layout: SquareKufiLayout,
  edits: KufiCellEdit[]
): ComposedKufiGrid {
  const base: ComposedKufiGrid = {
    cols: layout.cols,
    rows: layout.rows,
    cells: layout.cells,
    originX: 0,
    originY: 0,
    applied: 0,
    dropped: 0,
  };
  if (edits.length === 0) return base;

  // By the `unitIndex` *field*, never by array position: a line break, an
  // unsupported character or a lam-alef ligature all make the two differ.
  const byUnit = new Map<number, KufiPlacement>();
  for (const p of layout.placements) byUnit.set(p.unitIndex, p);

  const writes: { x: number; y: number; on: boolean }[] = [];
  let dropped = 0;
  for (const edit of edits) {
    const p = byUnit.get(edit.unitIndex);
    if (!p) {
      dropped++;
      continue;
    }
    // An edit carrying no key still applies — the `glyphId`-optionality rule.
    if (edit.unitKey !== undefined && edit.unitKey !== p.unitKey) {
      dropped++;
      continue;
    }
    if (Math.abs(edit.dx) > KUFI_EDIT_REACH || Math.abs(edit.dy) > KUFI_EDIT_REACH) {
      dropped++;
      continue;
    }
    writes.push({ x: p.x + edit.dx, y: p.baselineY + edit.dy, on: edit.on });
  }
  if (writes.length === 0) return { ...base, dropped };

  // Only paint can grow the grid; an erase outside it has nothing to erase.
  let minX = 0;
  let minY = 0;
  let maxX = layout.cols - 1;
  let maxY = layout.rows - 1;
  for (const w of writes) {
    if (!w.on) continue;
    minX = Math.min(minX, w.x);
    minY = Math.min(minY, w.y);
    maxX = Math.max(maxX, w.x);
    maxY = Math.max(maxY, w.y);
  }

  const cols = Math.max(0, maxX - minX + 1);
  const rows = Math.max(0, maxY - minY + 1);
  const cells = new Array<boolean>(cols * rows).fill(false);
  for (let y = 0; y < layout.rows; y++) {
    for (let x = 0; x < layout.cols; x++) {
      if (layout.cells[y * layout.cols + x]) {
        cells[(y - minY) * cols + (x - minX)] = true;
      }
    }
  }
  let applied = 0;
  for (const w of writes) {
    const cx = w.x - minX;
    const cy = w.y - minY;
    // Only an erase can land outside: paint grew the grid to cover itself.
    // It changes nothing, so it counts with the dropped rather than pretending
    // to have been drawn — `applied + dropped` is always the list's length.
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) {
      dropped++;
      continue;
    }
    cells[cy * cols + cx] = w.on;
    applied++;
  }

  return { cols, rows, cells, originX: minX, originY: minY, applied, dropped };
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
