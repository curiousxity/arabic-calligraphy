import { cellRings } from "./kufiGrid";
import { octagonInk, type KufiOctagonLayout } from "./kufiOctagon";
import { starConstruction, type Pt, type StarConstruction } from "./kufiStarGeometry";
import type { KufiStarInputs, KufiStarLayout } from "./kufiStarLayout";

export type StarBox = { minX: number; minY: number; width: number; height: number };

/** The outline's bounding box in cells (panel units, centre at the origin). */
export function starOutlineBox(c: StarConstruction): StarBox {
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

/** The box of a star block's inputs: the octagon layout's square, else its construction's outline box. */
export function kufiStarBox(i: Pick<KufiStarInputs, "layout" | "fold" | "k" | "size">): StarBox {
  if (i.layout === "octagon") return { minX: -i.size / 2, minY: -i.size / 2, width: i.size, height: i.size };
  return starOutlineBox(starConstruction(i.fold, i.k, i.size));
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/**
 * One SVG path `d`, in px, origin at the square's top-left corner: the
 * octagon layout's ink (its frame lines too when `lines` is on) traced with
 * `cellRings`, as `kufiStarPath` traces a region's cells.
 */
export function kufiOctagonPath(layout: KufiOctagonLayout, lines: boolean, cellPx: number): string {
  const N = layout.geometry.size;
  const ink = octagonInk(layout, lines);
  const parts: string[] = [];
  for (const ring of cellRings(Array.from(ink, (v) => v !== 0), N, N)) {
    parts.push(`M${ring.map(([col, row]) => `${num(col * cellPx)} ${num(row * cellPx)}`).join("L")}Z`);
  }
  return parts.join("");
}

/**
 * The path of a star block's layout, whichever layout it is: the octagon's
 * square, or every region's packed cells on its construction (an unpacked
 * region draws nothing). Null `layout` draws the construction's lines alone.
 */
export function kufiStarLayoutPath(inputs: KufiStarInputs, layout: KufiStarLayout | null, lines: boolean, cellPx: number): string {
  if (inputs.layout === "octagon") return layout?.octagon ? kufiOctagonPath(layout.octagon, lines, cellPx) : "";
  const c = starConstruction(inputs.fold, inputs.k, inputs.size);
  const cells = c.regions.map((r) => {
    const res = layout?.regions[r.index]?.result;
    return res?.ok ? res.cells : null;
  });
  return kufiStarPath(c, cells, lines, cellPx);
}

/**
 * One SVG path `d`, in px, with its origin at the outline's top-left corner:
 * every region's inked cells traced with `cellRings` (local cells, mapped
 * through the region's frame, which only rotates, so ring winding is kept) and,
 * when `lines` is on, each construction line as a band one cell wide
 * (`StarConstruction.bands`: flush inside the region whose text stands on it,
 * so line and feet are one stroke; else centred). Bands wind the same way as
 * the cell rings' outer rings, so a **nonzero** fill draws their union and a
 * hole inside a region stays a hole.
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

  if (lines) for (const quad of c.bands) parts.push(`M${quad.map(px).join("L")}Z`);
  return parts.join("");
}
