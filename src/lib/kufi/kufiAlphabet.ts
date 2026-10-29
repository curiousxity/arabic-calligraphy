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
 * followed here keeps that as the rule but not as a law, in two ways:
 *
 * - some medial alternates of the tooth letters join one stem *above* the
 *   line on one side, stepping the word up or down so it can climb round a
 *   corner of a panel;
 * - some final forms whose body sits on the line with a tail beneath it (و,
 *   ن, ه alternates) take their join *at the bottom stroke*, below the line.
 *
 * Those glyphs name the row in `joins`; every other glyph joins on its
 * baseline row (`joinRow`). A layout that cannot place a stepped join should
 * simply not pick those alternates.
 *
 * **Dots are not drawn.** Traditional square Kufi omits the iʿjām and leaves
 * ب/ت/ث to context, so letters that differ only by dots share one skeleton.
 * A dot in a lattice this tight reads as part of the letter.
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
 */

import type { JoiningForm } from "../arabicJoining";

/** Repeating this row or column of a glyph's `rows` lengthens its stroke(s) there by one cell. */
export type KufiStretch = { axis: "row" | "col"; index: number };

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
};

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
  joins?: KufiGlyph["joins"]
): KufiGlyph => (joins ? { id, rows, base, stretch, joins } : { id, rows, base, stretch });

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
      g("alef.isolated.0", 0, ["#", "#", "#", "#", "#", "#", "#"], [{ axis: "row", index: 3 }]),
      g("alef.isolated.1", 0, ["#", "#", "#", "#", "#"], [{ axis: "row", index: 2 }]),
      g("alef.isolated.2", 0, ["###", "..#", "..#", "..#", "..#"], [{ axis: "row", index: 2 }]),
      g("alef.isolated.3", 0, ["###", "..#", "..#", "..#", "..#", "..#", "..#"], [{ axis: "row", index: 3 }]),
      g("alef.isolated.4", 0, ["###", "#..", "#..", "#..", "#.."], [{ axis: "row", index: 2 }]),
      g("alef.isolated.5", 0, ["###", "#..", "#..", "#..", "#..", "#..", "#.."], [{ axis: "row", index: 3 }]),
    ],
    final: [
      g("alef.final.0", 0, ["#.", "#.", "#.", "#.", "#.", "#.", "##"], [{ axis: "row", index: 3 }]),
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
    ],
    medial: [
      g("beh.medial.0", 0, [".#.", ".#.", "###"], []),
      g("beh.medial.1", 0, [".#.", ".#.", "##.", ".#.", ".##"], [], { left: 2 }),
      g("beh.medial.2", 0, [".#.", ".#.", ".##", ".#.", "##."], [], { right: 2 }),
    ],
    final: [
      g("beh.final.0", 0, ["#...#.", "#...#.", "######"], [{ axis: "col", index: 2 }]),
      g("beh.final.1", 0, ["#.#.", "#.#.", "####"], [{ axis: "col", index: 1 }]),
    ],
  },
  noon: {
    isolated: [
      g("noon.isolated.0", 2, ["#.#", "#.#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 1 }]),
    ],
    initial: [
      g("noon.initial.0", 0, [".#", ".#", "##"], []),
    ],
    medial: [
      g("noon.medial.0", 0, [".#.", ".#.", "###"], []),
      g("noon.medial.1", 0, [".#.", ".#.", "##.", ".#.", ".##"], [], { left: 2 }),
      g("noon.medial.2", 0, [".#.", ".#.", ".##", ".#.", "##."], [], { right: 2 }),
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
    ],
    medial: [
      g("yeh.medial.0", 0, [".#.", ".#.", "###"], []),
      g("yeh.medial.1", 0, [".#.", ".#.", "##.", ".#.", ".##"], [], { left: 2 }),
      g("yeh.medial.2", 0, [".#.", ".#.", ".##", ".#.", "##."], [], { right: 2 }),
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
      g("tah.isolated.0", 0, ["..#....", "..#....", "..#....", "..#....", "..#####", "..#...#", "#######"], [{ axis: "col", index: 4 }, { axis: "row", index: 3 }]),
    ],
    initial: [
      g("tah.initial.0", 0, [".#....", ".#....", ".#....", ".#....", ".#####", ".#...#", "######"], [{ axis: "col", index: 3 }, { axis: "row", index: 3 }]),
      g("tah.initial.1", 0, [".#..", ".#..", ".#..", ".#..", ".###", ".#.#", "####"], [{ axis: "col", index: 2 }, { axis: "row", index: 3 }]),
      g("tah.initial.2", 0, [".#......", ".#......", ".#......", ".#......", ".#######", ".#.....#", "########"], [{ axis: "col", index: 4 }, { axis: "row", index: 3 }]),
      g("tah.initial.3", 0, [".#########", ".#........", ".#........", ".#........", ".#########", ".#.......#", "##########"], [{ axis: "col", index: 5 }, { axis: "row", index: 3 }]),
      g("tah.initial.4", 0, [".#........", ".#........", ".#.....###", ".#.....#.#", ".#######.#", ".#.......#", "##########"], [{ axis: "col", index: 5 }, { axis: "row", index: 3 }]),
    ],
    medial: [
      g("tah.medial.0", 0, [".#.....", ".#.....", ".#.....", ".#.....", ".#####.", ".#...#.", "#######"], [{ axis: "col", index: 3 }, { axis: "row", index: 3 }]),
    ],
    final: [
      g("tah.final.0", 0, ["..#.....", "..#.....", "..#.....", "..#.....", "..#####.", "..#...#.", "########"], [{ axis: "col", index: 4 }, { axis: "row", index: 3 }]),
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
    ],
    medial: [
      g("ain.medial.0", 0, [".###.", ".#.#.", ".###.", "..#..", "#####"], []),
      g("ain.medial.1", 0, [".#####.", ".#...#.", ".#####.", "...#...", "#######"], [{ axis: "col", index: 4 }]),
      g("ain.medial.2", 0, [".###.", "..#..", "#####"], []),
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
    ],
    final: [
      g("kaf.final.0", 0, ["#####.", "#.....", "#####.", "....#.", "######"], [{ axis: "col", index: 2 }]),
    ],
  },
  lam: {
    isolated: [
      g("lam.isolated.0", 2, ["..#", "..#", "..#", "..#", "#.#", "#.#", "#.#", "#.#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 2 }]),
      g("lam.isolated.1", 0, ["..#", "..#", "..#", "..#", "..#", "..#", "###"], [{ axis: "col", index: 1 }, { axis: "row", index: 3 }]),
      g("lam.isolated.2", 3, ["....#", "....#", "....#", "....#", "....#", "....#", "###.#", "#...#", "#####"], [{ axis: "col", index: 3 }, { axis: "row", index: 4 }]),
    ],
    initial: [
      g("lam.initial.0", 0, [".#", ".#", ".#", ".#", ".#", ".#", "##"], [{ axis: "row", index: 3 }]),
    ],
    medial: [
      g("lam.medial.0", 0, [".#.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], [{ axis: "row", index: 3 }]),
    ],
    final: [
      g("lam.final.0", 2, ["..#.", "..#.", "..#.", "..#.", "#.#.", "#.#.", "#.##", "#.#.", "###."], [{ axis: "col", index: 1 }, { axis: "row", index: 3 }]),
      g("lam.final.1", 2, ["..#.", "..#.", "..#.", "..#.", "..#.", "..#.", "..##", "..#.", "###."], [{ axis: "col", index: 1 }, { axis: "row", index: 4 }]),
      g("lam.final.2", 0, ["....#.", "....#.", "....#.", "....#.", "....#.", "....#.", "######"], [{ axis: "col", index: 2 }, { axis: "row", index: 3 }]),
    ],
  },
  meem: {
    isolated: [
      g("meem.isolated.0", 2, ["..###", "..#.#", "#####", "#....", "#...."], []),
      g("meem.isolated.1", 2, ["#####", "#.#.#", "#.###", "#....", "#...."], []),
    ],
    initial: [
      g("meem.initial.0", 0, [".###", ".#.#", "####"], []),
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
      g("lamAlef.isolated.1", 0, ["#.#", "#.#", "#.#", "#.#", "###", ".#.", "###", "#.#", "###"], [{ axis: "row", index: 3 }]),
      g("lamAlef.isolated.2", 0, ["#.#", "#.#", "#.#", "#.#", "###", "#.#", "###"], [{ axis: "row", index: 3 }]),
      g("lamAlef.isolated.3", 0, ["#.#", "#.#", "###", ".#.", "###"], [{ axis: "row", index: 3 }]),
    ],
    final: [
      g("lamAlef.final.0", 0, ["#.#.", "#.#.", "###.", ".#..", "###.", "#.#.", "####"], [{ axis: "row", index: 3 }]),
      g("lamAlef.final.1", 0, ["#.#.", "#.#.", "#.#.", "#.#.", "###.", ".#..", "###.", "#.#.", "####"], [{ axis: "row", index: 3 }]),
      g("lamAlef.final.2", 0, ["#.#.", "#.#.", "###.", ".#..", "####"], [{ axis: "row", index: 3 }]),
    ],
  },
  allah: {
    isolated: [
      g("allah.isolated.0", 0, ["###.#.#.#", "#.#.#.#.#", "#.#.#.#.#", "..#.#.#.#", "###.#.#.#", "#.#.#.#.#", "#########"], [{ axis: "row", index: 1 }]),
      g("allah.isolated.1", 0, ["....#.#.#", "....#.#.#", "###.#.#.#", "..#.#.#.#", "###.#.#.#", "#.#.#.#.#", "#########"], [{ axis: "row", index: 1 }]),
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

/** The row (top = 0) a glyph joins on at one side: its own `joins` entry, else its baseline row. */
export function joinRow(glyph: KufiGlyph, side: "right" | "left", rows: string[] = glyph.rows): number {
  return glyph.joins?.[side] ?? rows.length - 1 - glyph.base;
}

/**
 * The glyph's rows with `counts[i]` extra copies of the slice at
 * `glyph.stretch[i]`. Missing counts are zero; negative counts are treated as
 * zero (a glyph never shrinks below its authored size). Every slice index
 * refers to the unstretched glyph, so the order of `stretch` does not matter.
 */
export function stretchGlyph(glyph: KufiGlyph, counts: number[]): string[] {
  const h = glyph.rows.length;
  const w = glyph.rows[0]?.length ?? 0;
  const rowRepeat = new Array<number>(h).fill(1);
  const colRepeat = new Array<number>(w).fill(1);
  glyph.stretch.forEach((s, i) => {
    const n = Math.max(0, Math.floor(counts[i] ?? 0));
    if (s.axis === "row") rowRepeat[s.index] += n;
    else colRepeat[s.index] += n;
  });
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    let line = "";
    for (let x = 0; x < w; x++) line += glyph.rows[y][x].repeat(colRepeat[x]);
    for (let k = 0; k < rowRepeat[y]; k++) out.push(line);
  }
  return out;
}

/**
 * `base` after stretching: rows repeated below the baseline (a deepened bowl
 * or tail) hang the box further under the line; rows above it do not move it.
 */
export function stretchedBase(glyph: KufiGlyph, counts: number[]): number {
  const baselineRow = glyph.rows.length - 1 - glyph.base;
  return glyph.stretch.reduce(
    (acc, s, i) => (s.axis === "row" && s.index > baselineRow ? acc + Math.max(0, Math.floor(counts[i] ?? 0)) : acc),
    glyph.base
  );
}
