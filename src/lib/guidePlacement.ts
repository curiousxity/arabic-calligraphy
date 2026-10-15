import type { GuideAttachment } from "../types";
import {
  curvePenPlacement,
  pointAtArcLengthFromTable,
  type ArcTable,
  type CurveGlyph,
  type CurveGlyphPlacement,
} from "./textPath";

/**
 * Glyph placement for text attached to a guide. Pure.
 *
 * Unlike a plain Curve block, which always stretches its run to span the
 * curve, attached text keeps its own size and sits at `offset` along the
 * guide, shrinking only when it would not fit. Output uses the same
 * `CurveGlyphPlacement` the Curve renderer and Next Shape overlay consume.
 */

export type GuideLayout = {
  placements: CurveGlyphPlacement[];
  size: number;
  shrink: number;
  baselineOffset: number;
};

export const DEFAULT_ATTACHMENT: Omit<GuideAttachment, "id"> = {
  offset: 0,
  align: "center",
  side: "outside",
  flip: false,
  gap: 0.15,
};

const mod = (v: number, m: number) => ((v % m) + m) % m;

export function guideGlyphPlacements(args: {
  glyphs: readonly CurveGlyph[];
  fontSize: number;
  unitsPerEm: number;
  ascender: number;
  arcTable: ArcTable;
  closed: boolean;
  attachment: GuideAttachment;
}): GuideLayout | null {
  const { glyphs, fontSize, arcTable, closed, attachment } = args;
  const length = arcTable.total;
  if (glyphs.length === 0 || length <= 0 || fontSize <= 0) return null;
  const upm = Math.max(args.unitsPerEm || 1000, 1);
  const scale = fontSize / upm;
  let natural = 0;
  for (const g of glyphs) natural += (g.ax ?? 0) * scale;
  if (natural <= 0) return null;

  const shrink = Math.min(1, length / natural);
  const size = fontSize * shrink;
  const textLen = natural * shrink;
  const start = runStart(textLen, length, closed, attachment);

  const placements: CurveGlyphPlacement[] = [];
  let cursor = start;
  glyphs.forEach((g, glyphIndex) => {
    const s = closed ? mod(cursor, length) : cursor;
    placements.push(curvePenPlacement(arcTable, s, g, scale * shrink, glyphIndex, size));
    cursor += (g.ax ?? 0) * scale * shrink;
  });

  return {
    placements,
    size,
    shrink,
    baselineOffset: baselineOffsetFor(size, fontSize, args.ascender, upm, attachment),
  };
}

/**
 * Arc position (along the walk) where a run `textLen` long begins.
 *
 * The offset is stored in the guide's un-flipped direction; a flipped
 * attachment walks a reversed table, where that same point sits at
 * `length - s`. Glyphs are laid in visual order along the walk, so Arabic
 * *reads* from the far end of the run: "start" (where reading begins) puts
 * that far end at the anchor, "end" puts the near end there.
 */
function runStart(textLen: number, length: number, closed: boolean, attachment: GuideAttachment): number {
  const raw = Math.min(Math.max(attachment.offset, 0), 1) * length;
  const anchor = attachment.flip ? length - raw : raw;
  let start =
    attachment.align === "end" ? anchor : attachment.align === "center" ? anchor - textLen / 2 : anchor - textLen;
  if (!closed) start = Math.min(Math.max(start, 0), Math.max(length - textLen, 0));
  return start;
}

/**
 * The renderer translates by (0, baselineOffset) after rotating to the
 * tangent: negative moves a glyph up (away from the line, on the side its
 * own "up" points to), positive moves it down. Walking a flipped guide turns
 * the glyphs' up toward the other side, so "outside" must then hang.
 */
function baselineOffsetFor(
  size: number,
  fontSize: number,
  ascender: number,
  upm: number,
  attachment: GuideAttachment
): number {
  const ascent = (ascender * size) / upm;
  const gap = attachment.gap * fontSize;
  const hang = (attachment.side === "inside") !== attachment.flip;
  return hang ? ascent + gap : -gap;
}

export type GuideCaret = { x: number; y: number; angle: number; size: number; baselineOffset: number };

/**
 * Where a typing caret sits on attached text: at the origin of the glyph
 * carrying the last typed letter — the highest cluster, its base glyph
 * rather than a mark riding on it — which is the run's reading end, where
 * the next letter will go. With no text yet, at the anchor the run will
 * grow from, at the full font size.
 */
export function guideCaret(args: {
  glyphs: readonly { ax?: number; cl?: number }[];
  layout: GuideLayout | null;
  fontSize: number;
  unitsPerEm: number;
  ascender: number;
  arcTable: ArcTable;
  closed: boolean;
  attachment: GuideAttachment;
}): GuideCaret {
  const { glyphs, layout, fontSize, arcTable, closed, attachment } = args;
  const upm = Math.max(args.unitsPerEm || 1000, 1);
  if (layout && layout.placements.length > 0) {
    let best = layout.placements[0];
    let bestCl = -1;
    let bestBase = false;
    for (const p of layout.placements) {
      const g = glyphs[p.glyphIndex];
      const cl = g?.cl ?? 0;
      const base = (g?.ax ?? 0) > 0;
      if (cl > bestCl || (cl === bestCl && base && !bestBase)) {
        best = p;
        bestCl = cl;
        bestBase = base;
      }
    }
    return { x: best.x, y: best.y, angle: best.angle, size: layout.size, baselineOffset: layout.baselineOffset };
  }
  const length = arcTable.total;
  const start = runStart(0, length, closed, attachment);
  const { x, y, angle } = pointAtArcLengthFromTable(arcTable, closed ? mod(start, length) : start);
  return {
    x,
    y,
    angle,
    size: fontSize,
    baselineOffset: baselineOffsetFor(fontSize, fontSize, args.ascender, upm, attachment),
  };
}

/** Nearest point on the guide to `point`, as 0..1 along its un-flipped direction. */
export function projectToGuide(arcTable: ArcTable, point: { x: number; y: number }): number {
  const { pts, cum, total } = arcTable;
  if (pts.length < 2 || total <= 0) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(Math.max(((point.x - ax) * dx + (point.y - ay) * dy) / len2, 0), 1) : 0;
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = (point.x - px) ** 2 + (point.y - py) ** 2;
    if (d < bestD) {
      bestD = d;
      best = cum[i] + t * (cum[i + 1] - cum[i]);
    }
  }
  return best / total;
}

/**
 * The box an attached text's ink can occupy: every placement point grown by
 * the font's full vertical extent (`extentEm`, ascender − descender in em,
 * never less than one em) plus the side offset. Used as the text's hit and
 * client rect, which a freeform export crops to — so it must not undercut
 * tall letters or stacked marks.
 */
export function guideInkBox(
  placements: readonly CurveGlyphPlacement[],
  size: number,
  extentEm: number,
  baselineOffset: number
): { x: number; y: number; width: number; height: number } {
  const reach = size * Math.max(1, extentEm) + Math.abs(baselineOffset);
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const p of placements) {
    x1 = Math.min(x1, p.x);
    y1 = Math.min(y1, p.y);
    x2 = Math.max(x2, p.x);
    y2 = Math.max(y2, p.y);
  }
  return { x: x1 - reach, y: y1 - reach, width: x2 - x1 + reach * 2, height: y2 - y1 + reach * 2 };
}
