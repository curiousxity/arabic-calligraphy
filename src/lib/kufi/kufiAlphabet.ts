/**
 * The square-Kufi letter table: every letter skeleton in every joining form,
 * with its authored alternates and the slices it may stretch along, as cells
 * on a lattice.
 *
 * Square Kufi is a construction, not a typeface. Every stroke is one cell
 * wide and every gap between two parallel strokes is one cell, so a letter
 * *is* its cell set and this module is the whole of that data. Pure: no
 * React, no Konva and no `../harfbuzz` import (its static harfbuzzjs import
 * throws under Vitest's Node ESM loader).
 *
 * ## Reading a glyph
 *
 * `rows` is the letter's own box, top row first, `#` for ink. `base` is how
 * many rows of the box hang *below* the baseline: 0 when the bottom row is
 * the baseline, more for the tails of ر, و, م, ج, ع, ق, ي and the lam foot.
 * Index 0 of every form list is the default shape; the rest are alternates a
 * calligrapher can swap to.
 *
 * ## The conventions this table commits to
 *
 * **Joins are one shared cell.** A joining side carries a one-cell stub in
 * the box's outermost column: the rightmost column for a join to the
 * previous (right-hand) letter, the leftmost for a join to the next. Two
 * joined letters are placed so their stubs *overlap* in one column, which is
 * what keeps a join one cell long instead of two. The tests assert the ink
 * is there for every form rather than trusting it.
 *
 * **Joins sit on the baseline, with deliberate exceptions.** The old table
 * (and its layout) normalised every join to the baseline row. The convention
 * followed here keeps that as the rule but not as a law, in three ways:
 *
 * - some medial alternates of the tooth letters join one stem *above* the
 *   line on one side, stepping the word up or down so it can climb round a
 *   corner of a panel;
 * - some final forms whose body sits on the line with a tail beneath it (و,
 *   ن, ه alternates) take their join *at the bottom stroke*, below the line;
 * - the top-joined medials (`heh.medial.2`, and `.3` of ب ن ي, `lam.medial.1`
 *   and `ain.medial.3`) are entered *at their top*, by a join that has turned
 *   the line back on itself (`KUFI_JOINS`). Their right column holds nothing
 *   but that top stub.
 *
 * Those glyphs name the row in `joins`; every other glyph joins on its
 * baseline row (`joinRow`). A layout that cannot place a stepped join should
 * simply not pick those alternates. The lifted forms are the opposite case:
 * the body stands two rows up, to fill the top of a band, and one stroke
 * steps down to join on the line. The initials of ب ن ي س ص ج ع م and the
 * finals of ب د ر have one; the step is a row slice, so it can shorten to one
 * row or grow.
 *
 * **A join stub may be inset.** A few glyphs reach over their neighbour: the
 * narrow medial ك runs its top bar past its own right join, above the join
 * of the letter before it. Such a glyph names, in `inset`, how many columns
 * of its box lie beyond the stub on that side; `joinCol` gives the stub's
 * column. The neighbour's box overlaps those columns too.
 *
 * **Dots are the letter's own iʿjām, never filler.** Letters that differ
 * only by dots share one skeleton, so each glyph a dotted letter can take
 * carries one dot set per pattern its letters need (`KufiGlyph.dots`), and
 * `dotsOf` says which a letter uses: ب one below, ت two above, ث three above,
 * and so on. A letter is drawn with its whole set on its own side or not at
 * all: a single dot over ي reads ن, and two over ن read ت. A dot is a lone
 * cell one gap clear of the letter all round, even diagonally (the reference
 * panel's dots sit so). Two dots sit side by side one cell apart; three are
 * that pair with the third centred one gap further out. A dot never sits one
 * gap straight beyond a free stroke end, which would read as that stroke
 * broken (the gapped alef of الله is exactly that shape), and the hooked ن
 * keeps its dot inside the hook. Dots are not part of the glyph's ink: the
 * 4-connectivity and piece counts below are of the body alone.
 *
 * Two glyphs are drawn in more than one piece: the الله whose alef is a short
 * stroke with one square above it, and the الله under the bar of its shadda
 * and dagger alef. They say so in `parts`; every other glyph is a single
 * 4-connected piece.
 *
 * ## Stretching
 *
 * A letter grows only by repeating one interior slice of its box — a column
 * for a horizontal stretch, a row for a vertical one — never by scaling. A
 * slice is legal only when every ink cell in it has ink on both sides along
 * the stretch, i.e. it crosses only strokes that run straight through it, so
 * repeating it lengthens those strokes by a cell and adds no corner, no 2×2
 * block and no break. Through a closed counter (ص, ط, the loop of ف) one
 * slice crosses both bars of the counter, and they lengthen together: a
 * counter cannot widen one wall at a time. A row stretch above the baseline
 * lengthens a stem; one below it deepens a bowl or tail, and the box then
 * hangs further under the line (`stretchedBase`). Where a letter's slices are
 * not interchangeable the table picks the one the convention uses: the seen
 * elongates at its joining end and keeps its teeth on a one-cell rhythm.
 *
 * Letters without a stretch point (ه loops, ع, ق, م, و, ء) change size only
 * by swapping to an alternate.
 *
 * ## Shortening
 *
 * A slice may also be removed, up to `min` copies, by a negative count. The
 * copies come out of the run of identical rows (or columns) the slice sits
 * in, and at least one copy always stays, so a shortened glyph is exactly
 * the glyph authored with a shorter stroke: every check that holds for it
 * still holds. Tall strokes shorten to the band depth of a panel, 5 rows
 * standing on the line: lams and 7-row alefs drop by 2, as the lams of a
 * real panel do. Strokes already at 5 rows, teeth, bowls and counters do not
 * shorten (`min` 0), so a tall letter always stays taller than a tooth.
 */

import type { JoiningForm } from "../arabicJoining";

/**
 * Repeating this row or column of a glyph's `rows` lengthens its stroke(s)
 * there by one cell; removing it (a negative count, at most `min` copies)
 * shortens them. `min` defaults to 0: the slice only grows.
 */
export type KufiStretch = { axis: "row" | "col"; index: number; min?: number };

export type KufiGlyph = {
  /** `<skeleton>.<form>.<n>`, stable for saves and pins. */
  id: string;
  /** The letter's cells, top row first. Every row is the same length; `#` is ink. */
  rows: string[];
  /** Rows of the box below the baseline. */
  base: number;
  /** The slices this glyph may stretch along, in order; see `stretchGlyph`. */
  stretch: KufiStretch[];
  /** Join rows (top row = 0) for the few glyphs that do not join on their baseline row. */
  joins?: { right?: number; left?: number };
  /** Columns of the box beyond the join stub on that side (a bar reaching over the neighbour); see `joinCol`. */
  inset?: { right?: number; left?: number };
  /** Separate 4-connected pieces the glyph is drawn in, when more than one. */
  parts?: number;
  /**
   * Drawn in a star panel alone (a wedge, or the octagon's band); a rectangular panel keeps
   * the forms it was tuned on, and where a letter has star forms they replace its other
   * forms there. See `KufiPlace` and `kufiFormsOf`.
   */
  only?: Exclude<KufiPlace, "panel">;
  /**
   * The letter's own dot sets (iʿjām), one per dot pattern its letters need,
   * in the glyph box's coordinates; cells may lie outside the box. Letters
   * sharing this skeleton pick their set with `dotsOf`; `dotCells` does both.
   */
  dots?: Partial<Record<KufiDotKey, KufiCell[]>>;
};

/** A lattice cell, top row = 0 and left column = 0 of a glyph's box. */
export type KufiCell = { row: number; col: number };

export type KufiDotSide = "above" | "below";

/** A letter's dots: how many, and on which side of the letter. */
export type KufiDots = { count: 1 | 2 | 3; side: KufiDotSide };

/** The name of a dot set in `KufiGlyph.dots`: side then count, e.g. `above2`. */
export type KufiDotKey = `${KufiDotSide}${1 | 2 | 3}`;

/**
 * Where a letter is drawn: a rectangular panel, or a star panel (a wedge of
 * the wedges layout, or a band of the octagon layout), where tall strokes
 * are lengthened out of the line.
 */
export type KufiPlace = "panel" | "star";

export type SkeletonName =
  | "alef"
  | "beh"
  | "noon"
  | "yeh"
  | "jeem"
  | "dal"
  | "reh"
  | "waw"
  | "seen"
  | "sad"
  | "tah"
  | "ain"
  | "feh"
  | "qaf"
  | "kaf"
  | "lam"
  | "meem"
  | "heh"
  | "hamza";

export type LigatureName = "lamAlef" | "allah";

export type KufiFormTable = Record<SkeletonName | LigatureName, Partial<Record<JoiningForm, KufiGlyph[]>>>;

const g = (
  id: string,
  base: number,
  rows: string[],
  stretch: KufiStretch[],
  joins?: KufiGlyph["joins"],
  more?: Pick<KufiGlyph, "inset" | "parts" | "only">
): KufiGlyph => ({ id, rows, base, stretch, ...(joins ? { joins } : {}), ...more });

/**
 * Every glyph. The tooth letters (ب ن ي) share their initial and medial
 * shapes, which is how the script draws them; they are repeated rather than
 * aliased so each keeps its own id.
 *
 * `allah` is the الله ligature: alef, two lams and a final heh with their
 * stubs overlapped. Written out letter by letter, alef does not join; the
 * ligature runs its baseline under the gap so the word is one connected
 * unit that stretches its shafts together.
 */
export const KUFI_FORMS: KufiFormTable = {
  alef: {
    isolated: [
      g("alef.isolated.0", 0, ["#", "#", "#", "#", "#", "#", "#"], [{ axis: "row", index: 3, min: 2 }]),
      g("alef.isolated.1", 0, ["#", "#", "#", "#", "#"], [{ axis: "row", index: 2 }]),
      g("alef.isolated.2", 0, ["###", "..#", "..#", "..#", "..#"], [{ axis: "row", index: 2 }]),
      g("alef.isolated.3", 0, ["###", "..#", "..#", "..#", "..#", "..#", "..#"], [{ axis: "row", index: 3, min: 2 }]),
      g("alef.isolated.4", 0, ["###", "#..", "#..", "#..", "#.."], [{ axis: "row", index: 2 }]),
      g("alef.isolated.5", 0, ["###", "#..", "#..", "#..", "#..", "#..", "#.."], [{ axis: "row", index: 3, min: 2 }]),
    ],
    final: [
      g("alef.final.0", 0, ["#.", "#.", "#.", "#.", "#.", "#.", "##"], [{ axis: "row", index: 3, min: 2 }]),
      g("alef.final.1", 0, ["#.", "#.", "#.", "#.", "##"], [{ axis: "row", index: 2 }]),
      g("alef.final.2", 0, ["##", "#.", "#.", "#.", "##"], [{ axis: "row", index: 2 }]),
      g("alef.final.3", 0, ["##.", ".#.", ".#.", ".#.", ".##"], [{ axis: "row", index: 2 }]),
      g("alef.final.4", 0, ["###.", "..#.", "..#.", "..#.", "..##"], [{ axis: "row", index: 2 }]),
    ],
  },
  beh: {
    isolated: [
      g("beh.isolated.0", 0, ["#...#", "#...#", "#####"], [{ axis: "col", index: 2 }]),
      g("beh.isolated.1", 0, ["#.#", "#.#", "###"], [{ axis: "col", index: 1 }]),
      g("beh.isolated.2", 0, ["###.#", "#...#", "#####"], [{ axis: "col", index: 3 }]),
      g("beh.isolated.3", 0, ["....#", "....#", "#####"], [{ axis: "col", index: 2 }]),
      g("beh.isolated.4", 0, ["#####.#", "#.....#", "#####.#", "....#.#", "....###"], [{ axis: "col", index: 3 }]),
      g("beh.isolated.5", 0, ["..#", "..#", "###"], [{ axis: "col", index: 1 }]),
    ],
    initial: [
      g("beh.initial.0", 0, [".#", ".#", "##"], []),
      g("beh.initial.1", 0, ["....#", "....#", "#####", "#....", "#...."], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("beh.medial.0", 0, [".#.", ".#.", "###"], []),
      g("beh.medial.1", 0, [".#.", ".#.", "##.", ".#.", ".##"], [], { left: 2 }),
      g("beh.medial.2", 0, [".#.", ".#.", ".##", ".#.", "##."], [], { right: 2 }),
      g("beh.medial.3", 0, [".##", ".#.", ".#.", ".#.", "##."], [{ axis: "row", index: 2, min: 2 }], { right: 0 }),
    ],
    final: [
      g("beh.final.0", 0, ["#...#.", "#...#.", "######"], [{ axis: "col", index: 2 }]),
      g("beh.final.1", 0, ["#.#.", "#.#.", "####"], [{ axis: "col", index: 1 }]),
      g("beh.final.2", 0, ["#.#.", "#.#.", "####", "...#", "...#"], [{ axis: "col", index: 1 }, { axis: "row", index: 3, min: 1 }]),
    ],
  },
  noon: {
    isolated: [
      g("noon.isolated.0", 2, ["#.#", "#.#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 1 }]),
    ],
    initial: [
      g("noon.initial.0", 0, [".#", ".#", "##"], []),
      g("noon.initial.1", 0, ["....#", "....#", "#####", "#....", "#...."], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 1 }]),
      g("noon.initial.2", 0, ["###", "..#", "..#", "..#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 2 }]),
    ],
    medial: [
      g("noon.medial.0", 0, [".#.", ".#.", "###"], []),
      g("noon.medial.1", 0, [".#.", ".#.", "##.", ".#.", ".##"], [], { left: 2 }),
      g("noon.medial.2", 0, [".#.", ".#.", ".##", ".#.", "##."], [], { right: 2 }),
      g("noon.medial.3", 0, [".##", ".#.", ".#.", ".#.", "##."], [{ axis: "row", index: 2, min: 2 }], { right: 0 }),
    ],
    final: [
      g("noon.final.0", 2, ["#.#.", "#.#.", "#.##", "#.#.", "###."], [{ axis: "col", index: 1 }]),
      g("noon.final.1", 0, ["###.#.", "#...#.", "######"], [{ axis: "col", index: 3 }]),
      g("noon.final.2", 2, ["#.##", "#.#.", "###."], [{ axis: "col", index: 1 }]),
      g("noon.final.3", 2, ["###.", "#...", "###.", "#...", "####"], [{ axis: "col", index: 1 }], { right: 4 }),
      g("noon.final.4", 2, ["#####.", "#.#.#.", "#.#.#.", "#.....", "######"], [{ axis: "col", index: 3 }], { right: 4 }),
      g("noon.final.5", 4, ["#####.", "#...#.", "#.###.", "#...#.", "#.###.", "#.....", "######"], [{ axis: "col", index: 3 }], { right: 6 }),
    ],
  },
  yeh: {
    isolated: [
      g("yeh.isolated.0", 2, ["..###", "..#.#", "#.#.#", "#.#..", "###.."], [{ axis: "col", index: 3 }]),
      g("yeh.isolated.1", 4, ["..###", "..#.#", "..#.#", "..#..", "#.#..", "#.#..", "###.."], [{ axis: "col", index: 3 }]),
      g("yeh.isolated.2", 0, ["###.###", "#...#.#", "#####.#"], [{ axis: "col", index: 3 }]),
    ],
    initial: [
      g("yeh.initial.0", 0, [".#", ".#", "##"], []),
      g("yeh.initial.1", 0, ["....#", "....#", "#####", "#....", "#...."], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("yeh.medial.0", 0, [".#.", ".#.", "###"], []),
      g("yeh.medial.1", 0, [".#.", ".#.", "##.", ".#.", ".##"], [], { left: 2 }),
      g("yeh.medial.2", 0, [".#.", ".#.", ".##", ".#.", "##."], [], { right: 2 }),
      g("yeh.medial.3", 0, [".##", ".#.", ".#.", ".#.", "##."], [{ axis: "row", index: 2, min: 2 }], { right: 0 }),
    ],
    final: [
      g("yeh.final.0", 0, ["#.###.", "#.#.#.", "###.##"], [{ axis: "col", index: 3 }]),
      g("yeh.final.1", 2, ["###", "#..", "###"], [{ axis: "col", index: 1 }]),
      g("yeh.final.2", 2, [".###", ".#..", "####"], [{ axis: "col", index: 2 }]),
      g("yeh.final.3", 0, ["#.....", "#.....", "#.###.", "#.#.#.", "#.#.#.", "#.#.#.", "###.##"], [{ axis: "col", index: 3 }]),
    ],
  },
  jeem: {
    isolated: [
      g("jeem.isolated.0", 2, ["#####", "....#", "#####", "#....", "#####"], [{ axis: "col", index: 2 }]),
      g("jeem.isolated.1", 0, ["###", "..#", "###", "#..", "###"], [{ axis: "col", index: 1 }]),
      g("jeem.isolated.2", 4, ["#####", "....#", "#####", "#....", "#.###", "#...#", "#####"], [{ axis: "col", index: 3 }]),
    ],
    initial: [
      g("jeem.initial.0", 0, [".###", "...#", "####"], [{ axis: "col", index: 2 }]),
      g("jeem.initial.1", 0, [".#..", ".#..", ".###", "...#", "####"], [{ axis: "col", index: 2 }]),
      g("jeem.initial.2", 0, [".###", "...#", "####", "#...", "#..."], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("jeem.medial.0", 0, [".###.", ".#.#.", ".#.#.", "...#.", "#####"], [{ axis: "col", index: 2 }]),
      g("jeem.medial.1", 0, [".####.", "....#.", "######"], [{ axis: "col", index: 3 }]),
    ],
    final: [
      g("jeem.final.0", 2, ["#####.", "....#.", "######", "#.....", "#####."], [{ axis: "col", index: 2 }]),
    ],
  },
  dal: {
    isolated: [
      g("dal.isolated.0", 0, ["###", "..#", "###"], [{ axis: "col", index: 1 }]),
      g("dal.isolated.1", 0, ["#..", "#..", "###", "..#", "###"], [{ axis: "col", index: 1 }]),
      g("dal.isolated.2", 0, ["###", "#.#", "#.#", "..#", "###"], [{ axis: "col", index: 1 }]),
    ],
    final: [
      g("dal.final.0", 0, ["###.", "..#.", "####"], [{ axis: "col", index: 1 }]),
      g("dal.final.1", 0, ["#...", "#...", "###.", "..#.", "####"], [{ axis: "col", index: 1 }]),
      g("dal.final.2", 0, ["###.", "#.#.", "#.#.", "..#.", "####"], [{ axis: "col", index: 1 }]),
      g("dal.final.3", 0, ["#.....", "#.....", "#####.", "....#.", "######"], [{ axis: "col", index: 2 }]),
      g("dal.final.4", 0, ["#.#.", "#.#.", "###.", "#...", "####"], [{ axis: "col", index: 1 }]),
      g("dal.final.5", 0, ["#####.", "#.#...", "#.###.", "#.....", "######"], [{ axis: "col", index: 3 }]),
      g("dal.final.6", 0, ["#####.", "#...#.", "#.###.", "#.#.#.", "#.#.#.", "#.....", "######"], [{ axis: "col", index: 3 }]),
      g("dal.final.7", 0, ["###.", "..#.", "####", "...#", "...#"], [{ axis: "col", index: 1 }, { axis: "row", index: 3, min: 1 }]),
    ],
  },
  reh: {
    isolated: [
      g("reh.isolated.0", 2, ["..#", "..#", "..#", "..#", "###"], [{ axis: "col", index: 1 }]),
      g("reh.isolated.1", 0, ["..#", "..#", "###"], [{ axis: "col", index: 1 }]),
    ],
    final: [
      g("reh.final.0", 2, ["..#.", "..#.", "..##", "..#.", "###."], [{ axis: "col", index: 1 }]),
      g("reh.final.1", 0, ["..#.", "..#.", "####"], [{ axis: "col", index: 1 }]),
      g("reh.final.2", 0, ["....#.", "....#.", "######"], [{ axis: "col", index: 2 }]),
      g("reh.final.3", 2, ["..#.", "..#.", "#.##", "#.#.", "###."], [{ axis: "col", index: 1 }]),
      g("reh.final.4", 2, ["..###.", "..#.#.", "..#.##", "..#...", "###..."], [{ axis: "col", index: 3 }]),
      g("reh.final.5", 0, ["..#.", "..#.", "####", "...#", "...#"], [{ axis: "col", index: 1 }, { axis: "row", index: 3, min: 1 }]),
    ],
  },
  waw: {
    isolated: [
      g("waw.isolated.0", 2, ["###", "#.#", "###", "..#", "###"], []),
      g("waw.isolated.1", 4, ["###", "#.#", "###", "..#", "#.#", "#.#", "###"], []),
    ],
    final: [
      g("waw.final.0", 2, ["###.", "#.#.", "####", "..#.", "###."], []),
      g("waw.final.1", 2, ["###.", "#.#.", "###.", "..#.", "####"], [], { right: 4 }),
      g("waw.final.2", 4, ["###.", "#.#.", "###.", "..#.", "#.##", "#.#.", "###."], [], { right: 4 }),
      g("waw.final.3", 2, ["#.###.", "#.#.#.", "#####.", "..#...", "..####"], [], { right: 4 }),
      g("waw.final.4", 4, ["..###.", "..#...", "#####.", "#.#.#.", "#.###.", "#.....", "######"], [], { right: 6 }),
    ],
  },
  seen: {
    isolated: [
      g("seen.isolated.0", 2, ["..#.#.#", "..#.#.#", "#.#####", "#.#....", "###...."], [{ axis: "col", index: 3 }]),
      g("seen.isolated.1", 0, ["###.#.#.#", "#...#.#.#", "#########"], [{ axis: "col", index: 5 }]),
      g("seen.isolated.2", 2, ["....#.#.#", "....#.#.#", "###.#####", "#...#....", "#####...."], [{ axis: "col", index: 5 }]),
      g("seen.isolated.3", 2, ["###.#.#.#", "#.#.#.#.#", "#.#.#####", "#...#....", "#####...."], [{ axis: "col", index: 5 }]),
    ],
    initial: [
      g("seen.initial.0", 0, [".#.#.#", ".#.#.#", "######"], [{ axis: "col", index: 2 }]),
      g("seen.initial.1", 0, [".#.#.#", ".#.#.#", "######", "#.....", "#....."], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("seen.medial.0", 0, [".#.#.#.", ".#.#.#.", "#######"], [{ axis: "col", index: 2 }]),
    ],
    final: [
      g("seen.final.0", 2, ["..#.#.#.", "..#.#.#.", "#.######", "#.#.....", "###....."], [{ axis: "col", index: 3 }]),
      g("seen.final.1", 0, ["#.#.#.#.", "#.#.#.#.", "########"], [{ axis: "col", index: 3 }]),
    ],
  },
  sad: {
    isolated: [
      g("sad.isolated.0", 2, ["..#.#####", "..#.#...#", "#.#######", "#.#......", "###......"], [{ axis: "col", index: 5 }]),
      g("sad.isolated.1", 0, ["#.#####", "#.#...#", "#.#####", "#.#....", "###...."], [{ axis: "col", index: 4 }]),
    ],
    initial: [
      g("sad.initial.0", 0, [".#####", ".#...#", "######"], [{ axis: "col", index: 3 }]),
      g("sad.initial.1", 0, [".#####", ".#...#", "######", "#.....", "#....."], [{ axis: "col", index: 3 }, { axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("sad.medial.0", 0, [".#####.", ".#...#.", "#######"], [{ axis: "col", index: 3 }]),
      g("sad.medial.1", 0, [".#....", ".#####", ".#...#", "######"], [{ axis: "col", index: 3 }]),
    ],
    final: [
      g("sad.final.0", 2, ["..#.#####.", "..#.#...#.", "#.########", "#.#.......", "###......."], [{ axis: "col", index: 5 }]),
    ],
  },
  tah: {
    isolated: [
      g("tah.isolated.0", 0, ["..#....", "..#....", "..#....", "..#....", "..#####", "..#...#", "#######"], [{ axis: "col", index: 4 }, { axis: "row", index: 3, min: 2 }]),
    ],
    initial: [
      g("tah.initial.0", 0, [".#....", ".#....", ".#....", ".#....", ".#####", ".#...#", "######"], [{ axis: "col", index: 3 }, { axis: "row", index: 3, min: 2 }]),
      g("tah.initial.1", 0, [".#..", ".#..", ".#..", ".#..", ".###", ".#.#", "####"], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 2 }]),
      g("tah.initial.2", 0, [".#......", ".#......", ".#......", ".#......", ".#######", ".#.....#", "########"], [{ axis: "col", index: 4 }, { axis: "row", index: 3, min: 2 }]),
      g("tah.initial.3", 0, [".#########", ".#........", ".#........", ".#........", ".#########", ".#.......#", "##########"], [{ axis: "col", index: 5 }, { axis: "row", index: 3, min: 2 }]),
      g("tah.initial.4", 0, [".#........", ".#........", ".#.....###", ".#.....#.#", ".#######.#", ".#.......#", "##########"], [{ axis: "col", index: 5 }, { axis: "row", index: 3 }]),
    ],
    medial: [
      g("tah.medial.0", 0, [".#.....", ".#.....", ".#.....", ".#.....", ".#####.", ".#...#.", "#######"], [{ axis: "col", index: 3 }, { axis: "row", index: 3, min: 2 }]),
    ],
    final: [
      g("tah.final.0", 0, ["..#.....", "..#.....", "..#.....", "..#.....", "..#####.", "..#...#.", "########"], [{ axis: "col", index: 4 }, { axis: "row", index: 3, min: 2 }]),
    ],
  },
  ain: {
    isolated: [
      g("ain.isolated.0", 0, ["..###", "..#..", "#####", "#....", "#####"], []),
      g("ain.isolated.1", 0, ["###", "#..", "###", "#..", "###"], []),
    ],
    initial: [
      g("ain.initial.0", 0, [".###", ".#..", "####"], []),
      g("ain.initial.1", 0, [".###", ".#.#", ".#.#", ".#..", "####"], []),
      g("ain.initial.2", 0, [".###", ".#..", "####", "#...", "#..."], [{ axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("ain.medial.0", 0, [".###.", ".#.#.", ".###.", "..#..", "#####"], []),
      g("ain.medial.1", 0, [".#####.", ".#...#.", ".#####.", "...#...", "#######"], [{ axis: "col", index: 4 }]),
      g("ain.medial.2", 0, [".###.", "..#..", "#####"], []),
      g("ain.medial.3", 0, [".####", ".#.#.", ".###.", "..#..", "####."], [], { right: 0 }),
    ],
    final: [
      g("ain.final.0", 2, ["###.", "#.#.", "###.", ".#..", "####", "#...", "###."], []),
      g("ain.final.1", 2, ["#####.", "#...#.", "#####.", "..#...", "######", "#.....", "#####."], []),
      g("ain.final.2", 2, ["###.", "#.#.", "###.", "#...", "###.", "..#.", "####", "#...", "###."], []),
      g("ain.final.3", 2, ["###.", "#.#.", "###.", ".#..", "####", "#...", "#..."], []),
    ],
  },
  feh: {
    isolated: [
      g("feh.isolated.0", 0, ["....###", "....#.#", "#...###", "#.....#", "#######"], [{ axis: "col", index: 3 }]),
      g("feh.isolated.1", 0, ["....###", "....#.#", "###.###", "#.....#", "#######"], [{ axis: "col", index: 3 }]),
    ],
    initial: [
      g("feh.initial.0", 0, [".###", ".#.#", ".###", "...#", "####"], []),
      g("feh.initial.1", 0, [".###", ".#.#", ".###", "...#", ".###", ".#..", "####"], []),
    ],
    medial: [
      g("feh.medial.0", 0, [".###.", ".#.#.", ".###.", "...#.", "#####"], []),
    ],
    final: [
      g("feh.final.0", 0, ["....###.", "....#.#.", "#...###.", "#.....#.", "########"], [{ axis: "col", index: 3 }]),
      g("feh.final.1", 0, ["###.", "#.#.", "###.", "#...", "####"], [{ axis: "col", index: 1 }]),
      g("feh.final.2", 0, ["....###.", "....#.#.", "###.###.", "#.....#.", "########"], [{ axis: "col", index: 3 }]),
      g("feh.final.3", 0, ["#.###.", "#.#.#.", "#.###.", "#...#.", "######"], [{ axis: "col", index: 1 }]),
    ],
  },
  qaf: {
    isolated: [
      g("qaf.isolated.0", 2, ["#.###", "#.#.#", "#.###", "#...#", "#####"], []),
      g("qaf.isolated.1", 2, ["###.###", "#.#.#.#", "#.#.###", "#.....#", "#######"], []),
    ],
    initial: [
      g("qaf.initial.0", 0, [".###", ".#.#", ".###", "...#", "####"], []),
    ],
    medial: [
      g("qaf.medial.0", 0, [".###.", ".#.#.", ".###.", "...#.", "#####"], []),
    ],
    final: [
      g("qaf.final.0", 2, ["#.###.", "#.#.#.", "#.####", "#...#.", "#####."], []),
      g("qaf.final.1", 2, ["..###.", "..#.#.", "#.####", "#...#.", "#####."], []),
      g("qaf.final.2", 2, ["###.###.", "#.#.#.#.", "#.#.####", "#.....#.", "#######."], []),
    ],
  },
  kaf: {
    isolated: [
      g("kaf.isolated.0", 0, ["#####", "#....", "#####", "....#", "#####"], [{ axis: "col", index: 2 }]),
    ],
    initial: [
      g("kaf.initial.0", 0, [".#####", ".#....", ".#####", ".....#", "######"], [{ axis: "col", index: 3 }]),
      g("kaf.initial.1", 0, [".###", ".#..", ".###", "...#", "####"], [{ axis: "col", index: 2 }]),
      g("kaf.initial.2", 0, [".#######", ".#......", ".#######", ".......#", "########"], [{ axis: "col", index: 4 }]),
      g("kaf.initial.3", 0, [".......#", ".......#", ".#######", ".#......", ".#######", ".......#", "########"], [{ axis: "col", index: 4 }]),
    ],
    medial: [
      g("kaf.medial.0", 0, [".#####.", ".#.....", ".#####.", ".....#.", "#######"], [{ axis: "col", index: 3 }]),
      g("kaf.medial.1", 0, [".###.", ".#...", ".###.", "...#.", "#####"], [{ axis: "col", index: 2 }]),
      g("kaf.medial.2", 0, [".#######", ".#......", ".###....", "...#....", "######.."], [{ axis: "col", index: 2 }], undefined, { inset: { right: 2 } }),
    ],
    final: [
      g("kaf.final.0", 0, ["#####.", "#.....", "#####.", "....#.", "######"], [{ axis: "col", index: 2 }]),
    ],
  },
  lam: {
    isolated: [
      g("lam.isolated.0", 2, ["..#", "..#", "..#", "..#", "#.#", "#.#", "#.#", "#.#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 2, min: 2 }]),
      g("lam.isolated.1", 0, ["..#", "..#", "..#", "..#", "..#", "..#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 3, min: 2 }]),
      g("lam.isolated.2", 3, ["....#", "....#", "....#", "....#", "....#", "....#", "###.#", "#...#", "#####"], [{ axis: "col", index: 3 }, { axis: "row", index: 4, min: 1 }]),
    ],
    initial: [
      g("lam.initial.0", 0, [".#", ".#", ".#", ".#", ".#", ".#", "##"], [{ axis: "row", index: 3, min: 2 }]),
    ],
    medial: [
      g("lam.medial.0", 0, [".#.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], [{ axis: "row", index: 3, min: 2 }]),
      g("lam.medial.1", 0, [".##", ".#.", ".#.", ".#.", ".#.", ".#.", "##."], [{ axis: "row", index: 3, min: 2 }], { right: 0 }),
    ],
    final: [
      g("lam.final.0", 2, ["..#.", "..#.", "..#.", "..#.", "#.#.", "#.#.", "#.##", "#.#.", "###."], [{ axis: "col", index: 1 }, { axis: "row", index: 3, min: 2 }]),
      g("lam.final.1", 2, ["..#.", "..#.", "..#.", "..#.", "..#.", "..#.", "..##", "..#.", "###."], [{ axis: "col", index: 1 }, { axis: "row", index: 4, min: 2 }]),
      g("lam.final.2", 0, ["....#.", "....#.", "....#.", "....#.", "....#.", "....#.", "######"], [{ axis: "col", index: 2 }, { axis: "row", index: 3, min: 2 }]),
    ],
  },
  meem: {
    isolated: [
      g("meem.isolated.0", 2, ["..###", "..#.#", "#####", "#....", "#...."], []),
      g("meem.isolated.1", 2, ["#####", "#.#.#", "#.###", "#....", "#...."], []),
    ],
    initial: [
      g("meem.initial.0", 0, [".###", ".#.#", "####"], []),
      g("meem.initial.1", 0, [".###", ".#.#", "####", "#...", "#..."], [{ axis: "row", index: 3, min: 1 }]),
    ],
    medial: [
      g("meem.medial.0", 0, [".###.", ".#.#.", "#####"], []),
      g("meem.medial.1", 0, [".###.", ".#.#.", ".###.", ".#.#.", "##.##"], []),
    ],
    final: [
      g("meem.final.0", 2, ["..###.", "..#.#.", "######", "#.....", "#....."], []),
      g("meem.final.1", 2, ["###.", "#.#.", "####", ".#..", "###."], []),
    ],
  },
  heh: {
    isolated: [
      g("heh.isolated.0", 0, ["###", "#.#", "###"], []),
    ],
    initial: [
      g("heh.initial.0", 2, [".###", ".#.#", "####", ".#.#", ".###"], []),
      g("heh.initial.1", 0, [".###", ".#.#", ".###", ".#.#", "####"], []),
      g("heh.initial.2", 0, [".#####", ".#.#.#", "######"], []),
    ],
    medial: [
      g("heh.medial.0", 2, [".###.", ".#.#.", "#####", ".#.#.", ".###."], []),
      g("heh.medial.1", 0, [".#####.", ".#.#.#.", "#######"], []),
      g("heh.medial.2", 0, [".####", ".#.#.", ".###.", ".#.#.", "####."], [], { right: 0 }),
    ],
    final: [
      g("heh.final.0", 0, ["###.", "#.#.", "####"], [{ axis: "row", index: 1 }]),
      g("heh.final.1", 0, ["..#.", "..#.", "###.", "#.#.", "####"], [{ axis: "row", index: 3 }]),
      g("heh.final.2", 2, ["###.", "#.#.", "###.", "..#.", "..##"], [{ axis: "row", index: 3 }], { right: 4 }),
      g("heh.final.3", 0, ["###.", "..#.", "###.", "#.#.", "####"], [{ axis: "row", index: 3 }]),
      g("heh.final.4", 0, ["###.", "#.#.", "#.#.", "..#.", "###.", "#.#.", "####"], [{ axis: "row", index: 3 }]),
    ],
  },
  hamza: {
    isolated: [
      g("hamza.isolated.0", 0, ["###", "#..", "###"], []),
      g("hamza.isolated.1", 0, ["..###", "..#..", "#####"], []),
    ],
  },
  lamAlef: {
    isolated: [
      g("lamAlef.isolated.0", 0, ["#.#", "#.#", "###", ".#.", "###", "#.#", "###"], [{ axis: "row", index: 3 }]),
      g("lamAlef.isolated.1", 0, ["#.#", "#.#", "#.#", "#.#", "###", ".#.", "###", "#.#", "###"], [{ axis: "row", index: 3, min: 2 }]),
      g("lamAlef.isolated.2", 0, ["#.#", "#.#", "#.#", "#.#", "###", "#.#", "###"], [{ axis: "row", index: 3, min: 2 }]),
      g("lamAlef.isolated.3", 0, ["#.#", "#.#", "###", ".#.", "###"], [{ axis: "row", index: 3 }]),
    ],
    final: [
      g("lamAlef.final.0", 0, ["#.#.", "#.#.", "###.", ".#..", "###.", "#.#.", "####"], [{ axis: "row", index: 3 }]),
      g("lamAlef.final.1", 0, ["#.#.", "#.#.", "#.#.", "#.#.", "###.", ".#..", "###.", "#.#.", "####"], [{ axis: "row", index: 3, min: 2 }]),
      g("lamAlef.final.2", 0, ["#.#.", "#.#.", "###.", ".#..", "####"], [{ axis: "row", index: 3 }]),
    ],
  },
  allah: {
    isolated: [
      g("allah.isolated.0", 0, ["###.#.#.#", "#.#.#.#.#", "#.#.#.#.#", "..#.#.#.#", "###.#.#.#", "#.#.#.#.#", "#########"], [{ axis: "row", index: 1, min: 1 }, { axis: "col", index: 3 }]),
      g("allah.isolated.1", 0, ["....#.#.#", "....#.#.#", "###.#.#.#", "..#.#.#.#", "###.#.#.#", "#.#.#.#.#", "#########"], [{ axis: "row", index: 1, min: 1 }, { axis: "col", index: 3 }]),
      g("allah.isolated.2", 0, ["###.#.#.#", "..#.#.#..", "###.#.#.#", "#.#.#.#.#", "#######.#"], [{ axis: "row", index: 3 }, { axis: "col", index: 3 }], undefined, { parts: 3 }),
      // in a star (a wedge or the octagon's band) the word stands on four uprights at a line's
      // height, the heh with a wall of its own under its bar: `allah.isolated.1` at five rows. The
      // layouts lengthen the alef and both lams together, by bars to a wedge's slanted side or
      // inward to the octagon, and never the heh's wall, so the lams rise above the heh as in the
      // references (the Topkapi Scroll's الله: alef, lam, lam tall together, the heh's short wall
      // ending at its bar). A merged form with the heh hanging off the second lam (three uprights)
      // read as the heh's stem rising whenever a lam beside it was carried up (2026-11-02). **The
      // word widens through the heh's box** (column 1: its bars grow, its counter stays one row),
      // the one column that widens without a hole, so a word can fill the end of a wedge's line
      // (a wide heh is how square Kufi stretches the word; without it one الله fills no wedge)
      g("allah.isolated.3", 0, ["###.#.#.#", "..#.#.#.#", "###.#.#.#", "#.#.#.#.#", "#########"], [{ axis: "row", index: 3 }, { axis: "col", index: 1 }], undefined, { only: "star" }),
      // the same under the bar of its shadda and dagger alef, one gap above the word: its tops are
      // capped, so nothing of it is lengthened
      g("allah.isolated.4", 0, ["#########", ".........", "###.#.#.#", "..#.#.#.#", "###.#.#.#", "#.#.#.#.#", "#########"], [{ axis: "row", index: 5 }, { axis: "col", index: 1 }], undefined, { parts: 2, only: "star" }),
    ],
  },
};

/**
 * Code point → skeleton. Letters that differ only in their dots share one,
 * and the Persian/Urdu extensions map onto the Arabic letter they are drawn
 * from. Tatweel is deliberately absent: in square Kufi a join is lengthened
 * by stretching the letters on either side of it, not by inserting a glyph.
 */
const SKELETON_OF: Record<number, SkeletonName> = {
  0x0621: "hamza", // ء
  0x0622: "alef", // آ
  0x0623: "alef", // أ
  0x0624: "waw", // ؤ
  0x0625: "alef", // إ
  0x0626: "yeh", // ئ
  0x0627: "alef", // ا
  0x0628: "beh", // ب
  0x0629: "heh", // ة
  0x062a: "beh", // ت
  0x062b: "beh", // ث
  0x062c: "jeem", // ج
  0x062d: "jeem", // ح
  0x062e: "jeem", // خ
  0x062f: "dal", // د
  0x0630: "dal", // ذ
  0x0631: "reh", // ر
  0x0632: "reh", // ز
  0x0633: "seen", // س
  0x0634: "seen", // ش
  0x0635: "sad", // ص
  0x0636: "sad", // ض
  0x0637: "tah", // ط
  0x0638: "tah", // ظ
  0x0639: "ain", // ع
  0x063a: "ain", // غ
  0x0641: "feh", // ف
  0x0642: "qaf", // ق
  0x0643: "kaf", // ك
  0x0644: "lam", // ل
  0x0645: "meem", // م
  0x0646: "noon", // ن
  0x0647: "heh", // ه
  0x0648: "waw", // و
  0x0649: "yeh", // ى
  0x064a: "yeh", // ي
  // Persian / Urdu extensions, drawn as the Arabic letter they extend.
  0x0679: "beh", // ٹ
  0x067e: "beh", // پ
  0x0686: "jeem", // چ
  0x0688: "dal", // ڈ
  0x0691: "reh", // ڑ
  0x0698: "reh", // ژ
  0x06a9: "kaf", // ک
  0x06af: "kaf", // گ
  0x06cc: "yeh", // ی
};

export function skeletonOf(cp: number): SkeletonName | null {
  return SKELETON_OF[cp] ?? null;
}

/**
 * The letters whose uprights are shafts: the tall strokes square Kufi
 * lengthens to fill a field (an alef, a lam, the stem of a kaf or a tah,
 * and the ligatures' own). A heh's wall, a bowl's side or a tooth letter's
 * tooth is never one, however tall it is drawn.
 */
export const KUFI_SHAFT_LETTERS: ReadonlySet<SkeletonName | LigatureName> = new Set<SkeletonName | LigatureName>(["alef", "lam", "kaf", "tah", "lamAlef", "allah"]);

/**
 * Where a drawn glyph's shafts end: per column of `rows` (the glyph at its
 * stretch, `stretchGlyph`), the row of that column's top ink cell when it is
 * a **shaft's top**, else -1. A shaft's top is a cell of a shaft letter's
 * glyph (`KUFI_SHAFT_LETTERS`) with the column's ink running down from it
 * two cells or more and no ink of the glyph beside it. A capped top is none:
 * a heh's wall under its bar, a box's or bowl's side, a lam's hook, an
 * alef's head, the bar of a barred الله; nor is any column of another
 * letter, however tall it stands (a tooth stretched to a line's top). Only a
 * shaft's top may be carried on upward, by the octagon's lengthened strokes
 * (`octagonShafts`) and a region's filler bars (`barEnds`): lengthening
 * anything else stretches the letter or turns it into another (a heh's wall
 * shot up out of its box; a tooth became a lam). Ink of other letters beside
 * the top is the caller's to check.
 */
export function kufiShaftTops(skeleton: SkeletonName | LigatureName, rows: string[]): number[] {
  const w = rows[0]?.length ?? 0;
  const out = new Array<number>(w).fill(-1);
  if (!KUFI_SHAFT_LETTERS.has(skeleton)) return out;
  const ink = (i: number, j: number) => rows[i]?.[j] === "#";
  for (let j = 0; j < w; j++) {
    let i = 0;
    while (i < rows.length && !ink(i, j)) i++;
    if (i < rows.length && ink(i + 1, j) && !ink(i, j - 1) && !ink(i, j + 1)) out[j] = i;
  }
  return out;
}

/** The glyph with this id (`<skeleton>.<form>.<n>`) and its letter, or null. */
export function kufiGlyphById(id: string): { skeleton: SkeletonName | LigatureName; glyph: KufiGlyph } | null {
  const [skeleton, form] = id.split(".") as [SkeletonName | LigatureName, JoiningForm];
  const glyph = KUFI_FORMS[skeleton]?.[form]?.find((g) => g.id === id);
  return glyph ? { skeleton, glyph } : null;
}

/** The row (top = 0) a glyph joins on at one side: its own `joins` entry, else its baseline row. */
export function joinRow(glyph: KufiGlyph, side: "right" | "left", rows: string[] = glyph.rows): number {
  return glyph.joins?.[side] ?? rows.length - 1 - glyph.base;
}

/**
 * The column (left = 0) a glyph's join stub sits in at one side: the
 * outermost column, or `inset` columns in from it. Stretch slices always lie
 * between the stubs, so this holds for stretched rows too.
 */
export function joinCol(glyph: KufiGlyph, side: "right" | "left", rows: string[] = glyph.rows): number {
  const w = rows[0]?.length ?? 0;
  return side === "right" ? w - 1 - (glyph.inset?.right ?? 0) : glyph.inset?.left ?? 0;
}

/** Row `i` or column `i` of `rows`, as a string. */
const sliceAt = (rows: string[], axis: KufiStretch["axis"], i: number): string =>
  axis === "row" ? rows[i] : rows.map((r) => r[i]).join("");

/**
 * Where a removal may take copies of slice `s` from: the run of slices
 * identical to it, kept to its own side of the baseline for a row slice.
 * The baseline row may belong to the run (a lift standing on the line), but
 * it is never removed itself, so a shortened stroke never eats the line and
 * `stretchedBase` stays exact. Returns the removable slice indices and how
 * many copies may go in all: one copy of the run always stays.
 */
function removable(glyph: KufiGlyph, s: KufiStretch): { from: number[]; most: number } {
  const len = s.axis === "row" ? glyph.rows.length : (glyph.rows[0]?.length ?? 0);
  const baselineRow = s.axis === "row" ? glyph.rows.length - 1 - glyph.base : -1;
  if (s.index === baselineRow) return { from: [], most: 0 };
  let lo = 0;
  let hi = len - 1;
  if (s.axis === "row") {
    if (s.index < baselineRow) hi = baselineRow;
    else lo = baselineRow;
  }
  const own = sliceAt(glyph.rows, s.axis, s.index);
  let a = s.index;
  let b = s.index;
  while (a - 1 >= lo && sliceAt(glyph.rows, s.axis, a - 1) === own) a--;
  while (b + 1 <= hi && sliceAt(glyph.rows, s.axis, b + 1) === own) b++;
  const from: number[] = [];
  for (let k = a; k <= b; k++) if (k !== baselineRow) from.push(k);
  return { from, most: b - a };
}

/**
 * The count actually applied for `glyph.stretch[i]`: whole cells, never
 * below `-min`, and never removing the last copy of the slice.
 */
function appliedCount(glyph: KufiGlyph, i: number, counts: number[]): number {
  const s = glyph.stretch[i];
  const n = Math.floor(counts[i] ?? 0);
  if (n >= 0) return n;
  return Math.max(n, -(s.min ?? 0), -removable(glyph, s).most);
}

/**
 * The glyph's rows with `counts[i]` extra copies of the slice at
 * `glyph.stretch[i]`, or, for a negative count, that many copies removed
 * (see `KufiStretch.min`). Missing counts are zero, and a negative count on a
 * slice without a `min` is zero: such a glyph never shrinks below its
 * authored size. Every slice index refers to the unstretched glyph, so the
 * order of `stretch` does not matter.
 */
export function stretchGlyph(glyph: KufiGlyph, counts: number[]): string[] {
  const h = glyph.rows.length;
  const w = glyph.rows[0]?.length ?? 0;
  const { rowRepeat, colRepeat } = repeats(glyph, counts);
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) line += glyph.rows[y][x].repeat(colRepeat[x]);
    for (let k = 0; k < rowRepeat[y]; k++) out.push(line);
  }
  return out;
}

/** How many copies of each row and column of `glyph.rows` a stretch by `counts` keeps. */
function repeats(glyph: KufiGlyph, counts: number[]): { rowRepeat: number[]; colRepeat: number[] } {
  const h = glyph.rows.length;
  const w = glyph.rows[0]?.length ?? 0;
  const rowRepeat = new Array<number>(h).fill(1);
  const colRepeat = new Array<number>(w).fill(1);
  glyph.stretch.forEach((s, i) => {
    const repeat = s.axis === "row" ? rowRepeat : colRepeat;
    const n = appliedCount(glyph, i, counts);
    if (n >= 0) {
      repeat[s.index] += n;
      return;
    }
    // The run's slices are identical, so which copies go does not change the result.
    let left = -n;
    for (const k of removable(glyph, s).from) {
      const take = Math.min(left, repeat[k]);
      repeat[k] -= take;
      left -= take;
    }
  });
  return { rowRepeat, colRepeat };
}

/**
 * `base` after stretching: rows repeated below the baseline (a deepened bowl
 * or tail) hang the box further under the line, and rows removed there raise
 * it; rows above the line do not move it.
 */
export function stretchedBase(glyph: KufiGlyph, counts: number[]): number {
  const baselineRow = glyph.rows.length - 1 - glyph.base;
  return glyph.stretch.reduce(
    (acc, s, i) => (s.axis === "row" && s.index > baselineRow ? acc + appliedCount(glyph, i, counts) : acc),
    glyph.base
  );
}

const DOT = (count: KufiDots["count"], side: KufiDotSide): KufiDots => ({ count, side });

/**
 * The iʿjām of every dotted letter. Letters not listed (ا ح د ر س ص ط ع ك ل
 * م ه و ى ء and the hamza carriers) have none; neither do ٹ ڈ ڑ, whose mark
 * is a small ط, not dots.
 */
const DOTS_OF: Record<string, KufiDots> = {
  "ب": DOT(1, "below"),
  "ت": DOT(2, "above"),
  "ث": DOT(3, "above"),
  "ج": DOT(1, "below"),
  "خ": DOT(1, "above"),
  "ذ": DOT(1, "above"),
  "ز": DOT(1, "above"),
  "ش": DOT(3, "above"),
  "ض": DOT(1, "above"),
  "ظ": DOT(1, "above"),
  "غ": DOT(1, "above"),
  "ف": DOT(1, "above"),
  "ق": DOT(2, "above"),
  "ن": DOT(1, "above"),
  "ي": DOT(2, "below"),
  "ة": DOT(2, "above"),
  "پ": DOT(3, "below"),
  "چ": DOT(3, "below"),
  "ژ": DOT(3, "above"),
};

/** Persian yeh: dotted below only where it joins forward; its final and isolated forms are bare. */
const FARSI_YEH = "ی";

/**
 * How many dots `char` carries in `form`, and on which side; null when it
 * has none. The form matters only for the Persian ی (dotted initial and
 * medial, bare otherwise); an omitted form counts as isolated.
 */
export function dotsOf(char: string, form: JoiningForm = "isolated"): KufiDots | null {
  if (char === FARSI_YEH) return form === "initial" || form === "medial" ? DOT(2, "below") : null;
  return DOTS_OF[char] ?? null;
}

/** The `KufiGlyph.dots` key of a dot pattern. */
export function dotKey(d: KufiDots): KufiDotKey {
  return `${d.side}${d.count}`;
}

/**
 * Where index `i` of an unstretched axis lands after stretching, with
 * `repeat[k]` copies of slice `k` kept: at the first copy of a repeated slice
 * (`at` "first"), its last, or its middle. A removed slice lands where the
 * next kept one starts ("first", "middle") or where the last one ended
 * ("last"). Outside the box an index moves with the box's far edge, or not at
 * all before the near one.
 */
function mapIndex(repeat: number[], i: number, at: "first" | "middle" | "last" = "middle"): number {
  if (i < 0) return i;
  const total = repeat.reduce((a, b) => a + b, 0);
  if (i >= repeat.length) return i - repeat.length + total;
  let start = 0;
  for (let k = 0; k < i; k++) start += repeat[k];
  if (at === "first") return start;
  if (at === "last") return start + repeat[i] - 1;
  return start + Math.max(0, Math.floor((repeat[i] - 1) / 2));
}

/**
 * The cells of `char`'s dots on `glyph` in `form`, in the box of the glyph
 * stretched by `counts` (see `stretchGlyph`); empty when the letter has none.
 *
 * A set moves as one rigid piece, so a pair or a triangle keeps its one-cell
 * gaps however far the letter grows. Across the lattice it follows the
 * middle of its dots nearest the letter. Up and down it follows the ink it
 * sits on (above) or hangs from (below), keeping its authored distance from
 * it. Dots below also never rise above where their own row lands, so under
 * a lifted bar whose step grows they stay down on the line, as in the
 * reference panel, and when the step shortens they keep clear of the bar.
 *
 * Throws when the glyph has no authored set for a dotted letter, which the
 * tests rule out for every glyph a dotted letter can take.
 */
export function dotCells(glyph: KufiGlyph, char: string, form: JoiningForm, counts: number[] = []): KufiCell[] {
  const d = dotsOf(char, form);
  if (!d) return [];
  const cells = glyph.dots?.[dotKey(d)];
  if (!cells) throw new Error(`${glyph.id} has no ${dotKey(d)} dots for ${char}`);
  const above = d.side === "above";
  const nearRow = above ? Math.max(...cells.map((c) => c.row)) : Math.min(...cells.map((c) => c.row));
  const near = cells.filter((c) => c.row === nearRow);
  const anchorCol = Math.round(near.reduce((a, c) => a + c.col, 0) / near.length);
  const { rowRepeat, colRepeat } = repeats(glyph, counts);

  // The letter's ink row nearest the dots, in the columns they span.
  const lo = Math.min(...near.map((c) => c.col)) - 1;
  const hi = Math.max(...near.map((c) => c.col)) + 1;
  let contact = -1;
  glyph.rows.forEach((r, y) => {
    if (above ? y <= nearRow : y >= nearRow) return;
    if (![...r].some((ch, x) => ch === "#" && x >= lo && x <= hi)) return;
    if (contact < 0 || (above ? y < contact : y > contact)) contact = y;
  });
  let row: number;
  if (contact < 0) row = mapIndex(rowRepeat, nearRow);
  else row = mapIndex(rowRepeat, contact, above ? "first" : "last") + (nearRow - contact);
  if (!above) row = Math.max(row, mapIndex(rowRepeat, nearRow));
  const dr = row - nearRow;
  const dc = mapIndex(colRepeat, anchorCol) - anchorCol;
  return cells.map((c) => ({ row: c.row + dr, col: c.col + dc }));
}

/**
 * A fill piece: not a letter, and never part of one. A panel places a fill
 * only where it closes a hole (an empty 2×2), never where it could read as a
 * letter's dot.
 */
export type KufiFill = {
  id: string;
  /** Cells, top row first; 1-2 ink cells, never a 2×2. */
  rows: string[];
  /** The letters (as characters) it may sit beside, or `"any"`. */
  beside: string | "any";
};

/**
 * The only filler is the lone square. Dots are iʿjām, drawn from a letter's
 * own sets by `dotCells`; there is deliberately no dot fill, so no consumer
 * can scatter dots to plug holes.
 */
export const KUFI_FILLS: KufiFill[] = [{ id: "fill.square", rows: ["#"], beside: "any" }];

/**
 * A join piece: a run between two letters that is not a straight stretch of
 * a stub. `from` is the cell it shares with the previous letter's left stub
 * (on the bottom row, on that letter's line), `to` the cell it shares with
 * the next letter's right stub (on the top row). `turn` is the clockwise
 * quarter turn of the next letter's line relative to the previous one.
 *
 * `join.uturn.0` turns the line back on itself: from the line it runs one
 * cell on, climbs, and comes back one cell, so the word continues upside
 * down on a line above, entering its next letter at that letter's top (the
 * medial ه `heh.medial.2` joins there). It climbs 6 as authored, the height
 * of a 5-row band and its gap, and stretches or shortens at its stem; at its
 * shortest it climbs 2. It is a join, not a glyph, because it belongs to no
 * letter: any two joining letters may meet through it.
 *
 * `join.turn90.0` turns the line a quarter turn clockwise, so a word can go
 * round an inner corner the way the frame's lines do (bottom, then up the
 * left side). From the line it runs one cell on and climbs; `to` is the top
 * of the climb, where the next letter's line runs on upwards with the letter
 * turned 90°, its right stub at its bottom end. Its body stands to the right
 * of the climb, over the previous letter: the authored climb of 6 clears a
 * 5-row letter there by one gap. It shortens to a climb of 2, like the
 * U-turn, for letters that leave room.
 */
export type KufiJoin = {
  id: string;
  rows: string[];
  stretch: KufiStretch[];
  from: [row: number, col: number];
  to: [row: number, col: number];
  turn: 0 | 90 | 180 | 270;
};

export const KUFI_JOINS: KufiJoin[] = [
  {
    id: "join.uturn.0",
    rows: ["##", "#.", "#.", "#.", "#.", "#.", "##"],
    stretch: [{ axis: "row", index: 3, min: 4 }],
    from: [6, 1],
    to: [0, 1],
    turn: 180,
  },
  {
    id: "join.turn90.0",
    rows: ["#.", "#.", "#.", "#.", "#.", "#.", "##"],
    stretch: [{ axis: "row", index: 3, min: 4 }],
    from: [6, 1],
    to: [0, 0],
    turn: 90,
  },
];

// ---------------------------------------------------------------------------
// Dot sets, attached to their glyphs below.
// ---------------------------------------------------------------------------

/**
 * [row, col] cells per dot set, keyed by glyph id; see `KufiGlyph.dots`.
 * Every set was checked on a rendered sheet of the whole table: dots over
 * the middle of a tooth, bowl or head where they fit, tucked inside the box
 * (under a lifted bar, beside the stem of ط) where that keeps them clear,
 * and nudged one column off a free stroke end. The tests hold each set to
 * the rules in the module header, stretched and shortened too.
 */
export type DotTable = Record<string, Partial<Record<KufiDotKey, Array<[row: number, col: number]>>>>;

const DOT_CELLS: DotTable = {
  "beh.isolated.0": { above2: [[-2, 1], [-2, 3]], above3: [[-2, 1], [-2, 3], [-4, 2]], below1: [[4, 2]], below3: [[4, 1], [4, 3], [6, 2]] },
  "beh.isolated.1": { above2: [[-2, -1], [-2, 1]], above3: [[-2, -1], [-2, 1], [-4, 0]], below1: [[4, 1]], below3: [[4, 0], [4, 2], [6, 1]] },
  "beh.isolated.2": { above2: [[-2, 1], [-2, 3]], above3: [[-2, 1], [-2, 3], [-4, 2]], below1: [[4, 2]], below3: [[4, 1], [4, 3], [6, 2]] },
  "beh.isolated.3": { above2: [[0, 0], [0, 2]], above3: [[0, 0], [0, 2], [-2, 1]], below1: [[4, 3]], below3: [[4, 2], [4, 4], [6, 3]] },
  "beh.isolated.4": { above2: [[-2, 2], [-2, 4]], above3: [[-2, 2], [-2, 4], [-4, 3]], below1: [[4, 2]], below3: [[6, 2], [6, 4], [8, 3]] },
  "beh.isolated.5": { above2: [[-2, 1], [-2, 3]], above3: [[-2, 1], [-2, 3], [-4, 2]], below1: [[4, 1]], below3: [[4, 0], [4, 2], [6, 1]] },
  "beh.initial.0": { above2: [[-2, 0], [-2, 2]], above3: [[-2, 0], [-2, 2], [-4, 1]], below1: [[4, 1]], below3: [[4, 0], [4, 2], [6, 1]] },
  "beh.initial.1": { above2: [[0, 0], [0, 2]], above3: [[0, 0], [0, 2], [-2, 1]], below1: [[4, 2]], below3: [[4, 2], [4, 4], [6, 3]] },
  "beh.medial.0": { above2: [[-2, 0], [-2, 2]], above3: [[-2, 0], [-2, 2], [-4, 1]], below1: [[4, 1]], below3: [[4, 0], [4, 2], [6, 1]] },
  "beh.medial.1": { above2: [[-2, 0], [-2, 2]], above3: [[-2, 0], [-2, 2], [-4, 1]], below1: [[6, 1]], below3: [[6, 0], [6, 2], [8, 1]] },
  "beh.medial.2": { above2: [[-2, 0], [-2, 2]], above3: [[-2, 0], [-2, 2], [-4, 1]], below1: [[6, 1]], below3: [[6, 0], [6, 2], [8, 1]] },
  "beh.medial.3": { above2: [[-2, 0], [-2, 2]], above3: [[-2, 0], [-2, 2], [-4, 1]], below1: [[6, 1]], below3: [[6, 0], [6, 2], [8, 1]] },
  "beh.final.0": { above2: [[-2, 1], [-2, 3]], above3: [[-2, 1], [-2, 3], [-4, 2]], below1: [[4, 2]], below3: [[4, 1], [4, 3], [6, 2]] },
  "beh.final.1": { above2: [[-2, 1], [-2, 3]], above3: [[-2, 1], [-2, 3], [-4, 2]], below1: [[4, 1]], below3: [[4, 0], [4, 2], [6, 1]] },
  "beh.final.2": { above2: [[-2, 1], [-2, 3]], above3: [[-2, 1], [-2, 3], [-4, 2]], below1: [[4, 1]], below3: [[6, 0], [6, 2], [8, 1]] },
  "jeem.isolated.0": { above1: [[-2, 2]], below1: [[6, 2]], below3: [[6, 1], [6, 3], [8, 2]] },
  "jeem.isolated.1": { above1: [[-2, 1]], below1: [[6, 1]], below3: [[6, 0], [6, 2], [8, 1]] },
  "jeem.isolated.2": { above1: [[-2, 2]], below1: [[8, 2]], below3: [[8, 1], [8, 3], [10, 2]] },
  "jeem.initial.0": { above1: [[-2, 2]], below1: [[4, 2]], below3: [[4, 1], [4, 3], [6, 2]] },
  "jeem.initial.1": { above1: [[0, 3]], below1: [[6, 2]], below3: [[6, 1], [6, 3], [8, 2]] },
  "jeem.initial.2": { above1: [[-2, 1]], below1: [[4, 2]], below3: [[6, 1], [6, 3], [8, 2]] },
  "jeem.medial.0": { above1: [[-2, 2]], below1: [[6, 2]], below3: [[6, 1], [6, 3], [8, 2]] },
  "jeem.medial.1": { above1: [[-2, 3]], below1: [[4, 3]], below3: [[4, 2], [4, 4], [6, 3]] },
  "jeem.final.0": { above1: [[-2, 2]], below1: [[6, 2]], below3: [[6, 1], [6, 3], [8, 2]] },
  "dal.isolated.0": { above1: [[-2, 1]] },
  "dal.isolated.1": { above1: [[0, 2]] },
  "dal.isolated.2": { above1: [[-2, 1]] },
  "dal.final.0": { above1: [[-2, 1]] },
  "dal.final.1": { above1: [[0, 2]] },
  "dal.final.2": { above1: [[-2, 1]] },
  "dal.final.3": { above1: [[0, 2]] },
  "dal.final.4": { above1: [[-2, 1]] },
  "dal.final.5": { above1: [[-2, 2]] },
  "dal.final.6": { above1: [[-2, 2]] },
  "dal.final.7": { above1: [[-2, 2]] },
  "reh.isolated.0": { above1: [[-2, 1]], above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "reh.isolated.1": { above1: [[-2, 1]], above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "reh.final.0": { above1: [[-2, 1]], above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "reh.final.1": { above1: [[-2, 1]], above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "reh.final.2": { above1: [[0, 2]], above3: [[0, 0], [0, 2], [-2, 1]] },
  "reh.final.3": { above1: [[-2, 1]], above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "reh.final.4": { above1: [[-2, 3]], above3: [[-2, 2], [-2, 4], [-4, 3]] },
  "reh.final.5": { above1: [[-2, 1]], above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "seen.isolated.0": { above3: [[-2, 1], [-2, 3], [-4, 2]] },
  "seen.isolated.1": { above3: [[-2, 3], [-2, 5], [-4, 4]] },
  "seen.isolated.2": { above3: [[-2, 3], [-2, 5], [-4, 4]] },
  "seen.isolated.3": { above3: [[-2, 3], [-2, 5], [-4, 4]] },
  "seen.initial.0": { above3: [[-2, 2], [-2, 4], [-4, 3]] },
  "seen.initial.1": { above3: [[-2, 2], [-2, 4], [-4, 3]] },
  "seen.medial.0": { above3: [[-2, 2], [-2, 4], [-4, 3]] },
  "seen.final.0": { above3: [[-2, 3], [-2, 5], [-4, 4]] },
  "seen.final.1": { above3: [[-2, 3], [-2, 5], [-4, 4]] },
  "sad.isolated.0": { above1: [[-2, 4]] },
  "sad.isolated.1": { above1: [[-2, 3]] },
  "sad.initial.0": { above1: [[-2, 3]] },
  "sad.initial.1": { above1: [[-2, 2]] },
  "sad.medial.0": { above1: [[-2, 3]] },
  "sad.medial.1": { above1: [[-1, 3]] },
  "sad.final.0": { above1: [[-2, 4]] },
  "tah.isolated.0": { above1: [[2, 4]] },
  "tah.initial.0": { above1: [[2, 3]] },
  "tah.initial.1": { above1: [[2, 3]] },
  "tah.initial.2": { above1: [[2, 3]] },
  "tah.initial.3": { above1: [[-2, 5]] },
  "tah.initial.4": { above1: [[0, 6]] },
  "tah.medial.0": { above1: [[2, 3]] },
  "tah.final.0": { above1: [[2, 4]] },
  "ain.isolated.0": { above1: [[-2, 2]] },
  "ain.isolated.1": { above1: [[-2, 1]] },
  "ain.initial.0": { above1: [[-2, 2]] },
  "ain.initial.1": { above1: [[-2, 2]] },
  "ain.initial.2": { above1: [[-2, 1]] },
  "ain.medial.0": { above1: [[-2, 2]] },
  "ain.medial.1": { above1: [[-2, 3]] },
  "ain.medial.2": { above1: [[-2, 2]] },
  "ain.medial.3": { above1: [[-2, 2]] },
  "ain.final.0": { above1: [[-2, 1]] },
  "ain.final.1": { above1: [[-2, 2]] },
  "ain.final.2": { above1: [[-2, 1]] },
  "ain.final.3": { above1: [[-2, 1]] },
  "feh.isolated.0": { above1: [[-2, 4]] },
  "feh.isolated.1": { above1: [[-2, 5]] },
  "feh.initial.0": { above1: [[-2, 2]] },
  "feh.initial.1": { above1: [[-2, 2]] },
  "feh.medial.0": { above1: [[-2, 2]] },
  "feh.final.0": { above1: [[-2, 4]] },
  "feh.final.1": { above1: [[-2, 1]] },
  "feh.final.2": { above1: [[-2, 4]] },
  "feh.final.3": { above1: [[-2, 2]] },
  "qaf.isolated.0": { above2: [[-2, 1], [-2, 3]] },
  "qaf.isolated.1": { above2: [[-2, 2], [-2, 4]] },
  "qaf.initial.0": { above2: [[-2, 1], [-2, 3]] },
  "qaf.medial.0": { above2: [[-2, 1], [-2, 3]] },
  "qaf.final.0": { above2: [[-2, 1], [-2, 3]] },
  "qaf.final.1": { above2: [[-2, 2], [-2, 4]] },
  "qaf.final.2": { above2: [[-2, 2], [-2, 4]] },
  "noon.isolated.0": { above1: [[-2, 1]] },
  "noon.initial.0": { above1: [[-2, 0]] },
  "noon.initial.1": { above1: [[0, 2]] },
  "noon.initial.2": { above1: [[2, 0]] },
  "noon.medial.0": { above1: [[-2, 0]] },
  "noon.medial.1": { above1: [[-2, 0]] },
  "noon.medial.2": { above1: [[-2, 0]] },
  "noon.medial.3": { above1: [[-2, 1]] },
  "noon.final.0": { above1: [[-2, 1]] },
  "noon.final.1": { above1: [[-2, 2]] },
  "noon.final.2": { above1: [[-2, 1]] },
  "noon.final.3": { above1: [[-2, 1]] },
  "noon.final.4": { above1: [[-2, 2]] },
  "noon.final.5": { above1: [[-2, 2]] },
  "yeh.isolated.0": { below2: [[6, 1], [6, 3]] },
  "yeh.isolated.1": { below2: [[8, 1], [8, 3]] },
  "yeh.isolated.2": { below2: [[4, 2], [4, 4]] },
  "yeh.initial.0": { below2: [[4, 0], [4, 2]] },
  "yeh.initial.1": { below2: [[4, 2], [4, 4]] },
  "yeh.medial.0": { below2: [[4, 0], [4, 2]] },
  "yeh.medial.1": { below2: [[6, 0], [6, 2]] },
  "yeh.medial.2": { below2: [[6, 0], [6, 2]] },
  "yeh.medial.3": { below2: [[6, 0], [6, 2]] },
  "yeh.final.0": { below2: [[4, 1], [4, 3]] },
  "yeh.final.1": { below2: [[4, 0], [4, 2]] },
  "yeh.final.2": { below2: [[4, 1], [4, 3]] },
  "yeh.final.3": { below2: [[8, 1], [8, 3]] },
  "heh.isolated.0": { above2: [[-2, 0], [-2, 2]] },
  "heh.final.0": { above2: [[-2, 0], [-2, 2]] },
  "heh.final.1": { above2: [[-2, 1], [-2, 3]] },
  "heh.final.2": { above2: [[-2, 0], [-2, 2]] },
  "heh.final.3": { above2: [[-2, 0], [-2, 2]] },
  "heh.final.4": { above2: [[-2, 0], [-2, 2]] },
};

/**
 * Attaches dot sets to their glyphs by id, replacing any sets a glyph had.
 * Throws on an id that matches no glyph, so a typo cannot silently leave a
 * letter undotted.
 */
export function attachDotSets(table: DotTable): void {
  const byId = new Map<string, KufiGlyph>();
  for (const forms of Object.values(KUFI_FORMS))
    for (const glyphs of Object.values(forms)) for (const glyph of glyphs ?? []) byId.set(glyph.id, glyph);
  for (const [id, sets] of Object.entries(table)) {
    const glyph = byId.get(id);
    if (!glyph) throw new Error(`dot sets for unknown glyph ${id}`);
    glyph.dots = {};
    for (const [k, cells] of Object.entries(sets) as Array<[KufiDotKey, Array<[number, number]>]>)
      glyph.dots[k] = cells.map(([row, col]) => ({ row, col }));
  }
}

attachDotSets(DOT_CELLS);
