import type { VerseLayout } from "../types";

/**
 * Where each line of a verse sits. Pure: positions only — the lines' own
 * widths, kashida and spacing are `verseJustify.ts`'s job.
 *
 * Positions are the blocks' `x`/`y` with `align: "center"`, so `x` is a
 * line's horizontal centre. Stacked lines share one column; a bayt row holds
 * two misra' in equal columns either side of the anchor, the first on the
 * right (Arabic reads right to left).
 */

export const DEFAULT_LINE_GAP = 1.6;
export const DEFAULT_COLUMN_GAP = 1.0;

export type VerseGeometry = {
  layout: VerseLayout;
  /** The justified line width — one bayt column's width. */
  target: number;
  lineGap: number;
  columnGap: number;
  /** Line 0's base font size; gaps are multiples of it. */
  fontSize: number;
};

export function layoutVerse(
  count: number,
  g: VerseGeometry,
  anchor: { x: number; y: number }
): { x: number; y: number }[] {
  const pitch = g.lineGap * g.fontSize;
  const half = (g.target + g.columnGap * g.fontSize) / 2;
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    if (g.layout === "stacked") {
      out.push({ x: anchor.x, y: anchor.y + i * pitch });
      continue;
    }
    const row = Math.floor(i / 2);
    const alone = i % 2 === 0 && i === count - 1;
    const x = alone ? anchor.x : i % 2 === 0 ? anchor.x + half : anchor.x - half;
    out.push({ x, y: anchor.y + row * pitch });
  }
  return out;
}

/**
 * The anchor a laid-out verse currently sits at — `layoutVerse`'s inverse.
 *
 * Read from the blocks rather than stored, so a verse the user dragged is
 * re-laid-out where it now is instead of snapping back.
 */
export function verseAnchor(
  lines: readonly { x: number; y: number }[],
  layout: VerseLayout
): { x: number; y: number } {
  if (lines.length === 0) return { x: 0, y: 0 };
  const first = lines[0];
  if (layout === "bayt" && lines.length >= 2) {
    return { x: (first.x + lines[1].x) / 2, y: first.y };
  }
  return { x: first.x, y: first.y };
}
