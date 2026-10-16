/**
 * The mark library: loose pen pieces (strokes, heads, dot groups, small signs)
 * that are placed on the canvas as `mark` blocks, not typed into text.
 *
 * Pure (no harfbuzz, no React). The outlines themselves live in the generated
 * `markLibraryData.ts`. See .claude/rules/marks.md.
 */
import { MARK_GROUPS } from "./markLibraryData";
import { outlineBounds } from "./strokeCuts";
import { parseSvgPath, type SvgCmd } from "./svgPath";

export type MarkItem = {
  id: string;
  /** English name for the button's tooltip and the Layers list. */
  name: string;
  /** Ink box size, library units. */
  w: number;
  h: number;
  /** Filled outline, library units, centred on the origin. */
  d: string;
};

export type MarkGroup = { id: string; title: string; items: MarkItem[] };

export { MARK_GROUPS };

/**
 * Library units per em. The sheet the library was traced from has letters
 * about 40 px tall at 10 units per pixel, so one em of `fontSize` is 400
 * units: a mark at a block's font size sits beside its letters at their scale.
 */
export const MARK_UNITS_PER_EM = 400;

export const markScale = (fontSize: number) => fontSize / MARK_UNITS_PER_EM;

export function findMark(id: string): MarkItem | undefined {
  for (const g of MARK_GROUPS) {
    const it = g.items.find((m) => m.id === id);
    if (it) return it;
  }
  return undefined;
}

/**
 * The outline in px, flipped if asked. Pre-scaled rather than drawn under
 * `ctx.scale`: react-konva-to-svg loses a path whose transform scope closes
 * (see StackView).
 */
export function markPxCmds(d: string, fontSize: number, flipX = false, stretchX = 1, stretchY = 1): SvgCmd[] {
  const u = markScale(fontSize);
  const s = u * stretchY;
  const sx = (flipX ? -u : u) * stretchX;
  return parseSvgPath(d).map((c): SvgCmd => {
    switch (c.type) {
      case "M":
      case "L":
        return { type: c.type, x: c.x * sx, y: c.y * s };
      case "C":
        return { type: "C", x1: c.x1 * sx, y1: c.y1 * s, x2: c.x2 * sx, y2: c.y2 * s, x: c.x * sx, y: c.y * s };
      case "Q":
        return { type: "Q", x1: c.x1 * sx, y1: c.y1 * s, x: c.x * sx, y: c.y * s };
      default:
        return c;
    }
  });
}

/** Ink box of px commands, as a rect. Empty outline gives a zero rect. */
export function markPxBounds(cmds: SvgCmd[]) {
  if (cmds.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const b = outlineBounds(cmds);
  return { x: b.x1, y: b.y1, width: b.x2 - b.x1, height: b.y2 - b.y1 };
}

/** The library group whose marks are frames: picked with a block selected,
 *  one wraps that block (see `fitFrameToRect`) instead of being placed. */
export const FRAMES_GROUP_ID = "frames";
export const isFrameMark = (id: string) =>
  MARK_GROUPS.some((g) => g.id === FRAMES_GROUP_ID && g.items.some((it) => it.id === id));
