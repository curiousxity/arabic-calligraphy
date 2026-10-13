import type { GuideAttachment } from "../types";
import { pointAtArcLengthFromTable, type ArcTable, type CurveGlyphPlacement } from "./textPath";

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
  glyphs: readonly { ax?: number }[];
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

  // The offset is stored in the guide's un-flipped direction; a flipped
  // attachment walks a reversed table, where that same point sits at
  // `length - s`.
  const raw = Math.min(Math.max(attachment.offset, 0), 1) * length;
  const anchor = attachment.flip ? length - raw : raw;
  let start =
    attachment.align === "start" ? anchor : attachment.align === "center" ? anchor - textLen / 2 : anchor - textLen;
  if (!closed) start = Math.min(Math.max(start, 0), Math.max(length - textLen, 0));

  const placements: CurveGlyphPlacement[] = [];
  let cursor = start;
  glyphs.forEach((g, glyphIndex) => {
    const s = closed ? mod(cursor, length) : cursor;
    const { x, y, angle } = pointAtArcLengthFromTable(arcTable, s);
    placements.push({ glyphIndex, x, y, angle, size });
    cursor += (g.ax ?? 0) * scale * shrink;
  });

  // The renderer translates by (0, baselineOffset) after rotating to the
  // tangent: negative moves a glyph up (away from the line, on the side its
  // own "up" points to), positive moves it down. Walking a flipped guide turns
  // the glyphs' up toward the other side, so "outside" must then hang.
  const ascent = (args.ascender * size) / upm;
  const gap = attachment.gap * fontSize;
  const hang = (attachment.side === "inside") !== attachment.flip;
  return { placements, size, shrink, baselineOffset: hang ? ascent + gap : -gap };
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
