import { cellRings } from "./kufiGrid";
import type { Pt, StarConstruction } from "./kufiStarGeometry";

/** The outline's bounding box in cells (panel units, centre at the origin). */
export function starOutlineBox(c: StarConstruction): { minX: number; minY: number; width: number; height: number } {
  const xs = c.outline.map((p) => p.x), ys = c.outline.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/**
 * Where a star block's x,y goes when its construction changes (fold, star or
 * size) so that the star's centre stays where it was on the canvas. The block's
 * x,y is the outline box's top-left, and Konva turns the block's Group about
 * that point by `rotationDeg` (clockwise, y down), so the centre's offset from
 * x,y is the box's `-min` turned by the rotation; the shift is the change in
 * that offset, turned the same way.
 */
export function starPositionKeepingCentre(
  pos: { x: number; y: number },
  rotationDeg: number,
  before: { minX: number; minY: number },
  after: { minX: number; minY: number },
  cellPx: number
): { x: number; y: number } {
  const dx = (after.minX - before.minX) * cellPx, dy = (after.minY - before.minY) * cellPx;
  const t = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(t), sin = Math.sin(t);
  return { x: pos.x + dx * cos - dy * sin, y: pos.y + dx * sin + dy * cos };
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/**
 * One SVG path `d`, in px, with its origin at the outline's top-left corner:
 * every region's inked cells traced with `cellRings` (local cells, mapped
 * through the region's frame, which only rotates, so ring winding is kept) and,
 * when `lines` is on, each construction line as a band one cell wide centred
 * on it. Bands wind the same way as the cell rings' outer rings, so a
 * **nonzero** fill draws their union and a hole inside a region stays a hole.
 *
 * `regionCells[i]` is region i's row-major ink (1 = ink), `mask.cols *
 * mask.rows` long, or null for no ink; a missing, null or wrongly sized entry
 * and an empty mask draw nothing.
 */
export function kufiStarPath(
  c: StarConstruction,
  regionCells: Array<Uint8Array | null>,
  lines: boolean,
  cellPx: number
): string {
  const { minX, minY } = starOutlineBox(c);
  const px = (p: Pt) => `${num((p.x - minX) * cellPx)} ${num((p.y - minY) * cellPx)}`;
  const parts: string[] = [];

  for (const r of c.regions) {
    const ink = regionCells[r.index];
    const { cols, rows } = r.mask;
    if (!ink || cols === 0 || rows === 0 || ink.length !== cols * rows) continue;
    const { origin, ux, uy } = r.frame;
    for (const ring of cellRings(Array.from(ink, (v) => v !== 0), cols, rows)) {
      const pts = ring.map(([col, row]) => ({
        x: origin.x + col * ux.x + row * uy.x,
        y: origin.y + col * ux.y + row * uy.y,
      }));
      parts.push(`M${pts.map(px).join("L")}Z`);
    }
  }

  if (lines) {
    for (const [a, b] of c.lines) {
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len === 0) continue;
      // Half a cell to the left of travel (y down): the same turn as the cell rings.
      const nx = (-(b.y - a.y) / len) * 0.5, ny = ((b.x - a.x) / len) * 0.5;
      const quad = [
        { x: a.x - nx, y: a.y - ny },
        { x: b.x - nx, y: b.y - ny },
        { x: b.x + nx, y: b.y + ny },
        { x: a.x + nx, y: a.y + ny },
      ];
      parts.push(`M${quad.map(px).join("L")}Z`);
    }
  }
  return parts.join("");
}
