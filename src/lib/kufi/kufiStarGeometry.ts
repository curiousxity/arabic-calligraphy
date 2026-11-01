/**
 * The compass-and-ruler construction behind the Kufi star panel: a circle
 * divided into m = 2n points, a {m/k} star, a ring m-gon and an outer n-gon,
 * cut into a centre star, 2n wedges and n corners. Pure geometry in cells,
 * centre at the origin, y down. No React, no Konva, no `./harfbuzz` import.
 *
 * `size` is the ring's apothem (centre to a ring edge); the star's circle has
 * radius `size / RING_RATIO`.
 */

export type StarFold = 4 | 5 | 6;
export type StarRegionKind = "centre" | "wedgeA" | "wedgeB" | "corner";
export type Pt = { x: number; y: number };

export type StarRegion = {
  index: number;
  kind: StarRegionKind;
  /** Panel cell units, centre at the origin, y down. */
  polygon: Pt[];
  /** Local lattice frame: panel point = origin + col * ux + row * uy (unit vectors, local y down). */
  frame: { origin: Pt; ux: Pt; uy: Pt };
  /** 1 = usable. The bottom row is the one along the ring edge for wedges and corners. */
  mask: { cols: number; rows: number; cells: Uint8Array };
};

export type StarConstruction = {
  fold: StarFold;
  k: number;
  size: number;
  /** 0 centre, 1..m wedges clockwise from the top, m+1..m+n corners clockwise from the top right. */
  regions: StarRegion[];
  /** The outer n-gon, clockwise from the top right corner. */
  outline: Pt[];
  /** Every region edge, once. */
  lines: Array<[Pt, Pt]>;
};

/** Ring apothem over star-circle radius. */
const RING_RATIO = 1.55;
/** A usable cell lies at least this far inside its polygon: the one-cell seam. */
const SEAM = 1;
const EPS = 1e-6;

export const STAR_KS: Record<StarFold, number[]> = { 4: [3, 2], 5: [3, 2], 6: [4, 2] };

/**
 * The star a new panel (or a fold change) starts on: the classic one, except
 * 4-fold, whose classic wedge no size up to 60 fits الله in (its full-height
 * form; see kufi-star.md), so it starts on the alternative.
 */
export function defaultStarK(fold: StarFold): number {
  return fold === 4 ? STAR_KS[4][1] : STAR_KS[fold][0];
}

const polar = (r: number, deg: number): Pt => {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
};

/** A frame whose local down (uy) points along screen angle `downDeg`; rotation only, never mirrored. */
function frameAxes(downDeg: number): { ux: Pt; uy: Pt } {
  return { ux: polar(1, downDeg - 90), uy: polar(1, downDeg) };
}

function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function usablePoint(p: Pt, poly: Pt[]): boolean {
  if (!pointInPolygon(p, poly)) return false;
  for (let i = 0; i < poly.length; i++) {
    if (distToSegment(p, poly[i], poly[(i + 1) % poly.length]) < SEAM - EPS) return false;
  }
  return true;
}

/**
 * The region's local grid: its bounding box in the frame, snapped outward to
 * whole cells on the lattice anchored at the panel centre (so a baseline on a
 * whole-number ring edge sits on a grid line, and rotated copies get equal
 * masks), then trimmed to the rows and columns that hold a usable cell.
 */
function buildFrameAndMask(polygon: Pt[], axes: { ux: Pt; uy: Pt }): Pick<StarRegion, "frame" | "mask"> {
  const { ux, uy } = axes;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (const p of polygon) {
    const u = p.x * ux.x + p.y * ux.y;
    const v = p.x * uy.x + p.y * uy.y;
    minU = Math.min(minU, u); maxU = Math.max(maxU, u);
    minV = Math.min(minV, v); maxV = Math.max(maxV, v);
  }
  const u0 = Math.floor(minU + EPS), v0 = Math.floor(minV + EPS);
  const cols = Math.ceil(maxU - EPS) - u0, rows = Math.ceil(maxV - EPS) - v0;
  const origin = { x: u0 * ux.x + v0 * uy.x, y: u0 * ux.y + v0 * uy.y };
  const cells = new Uint8Array(cols * rows);
  const at = (c: number, r: number): Pt => ({
    x: origin.x + c * ux.x + r * uy.x,
    y: origin.y + c * ux.y + r * uy.y,
  });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (usablePoint(at(c, r), polygon) && usablePoint(at(c + 1, r), polygon) &&
          usablePoint(at(c, r + 1), polygon) && usablePoint(at(c + 1, r + 1), polygon)) {
        cells[r * cols + c] = 1;
      }
    }
  }
  // Trim to the usable extent: the seam leaves the outermost row (the one on the
  // ring edge) empty, and the bottom row of the mask should be the row nearest it.
  let c0 = cols, c1 = -1, r0 = rows, r1 = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!cells[r * cols + c]) continue;
      c0 = Math.min(c0, c); c1 = Math.max(c1, c);
      r0 = Math.min(r0, r); r1 = Math.max(r1, r);
    }
  }
  if (c1 < 0) return { frame: { origin, ux, uy }, mask: { cols: 0, rows: 0, cells: new Uint8Array(0) } };
  const tCols = c1 - c0 + 1, tRows = r1 - r0 + 1;
  const trimmed = new Uint8Array(tCols * tRows);
  for (let r = 0; r < tRows; r++) {
    for (let c = 0; c < tCols; c++) trimmed[r * tCols + c] = cells[(r + r0) * cols + c + c0];
  }
  return {
    frame: { origin: at(c0, r0), ux, uy },
    mask: { cols: tCols, rows: tRows, cells: trimmed },
  };
}

export function starConstruction(fold: StarFold, k: number, size: number): StarConstruction {
  const n = fold;
  const m = 2 * n;
  const step = 360 / m;
  const R = size / RING_RATIO;
  const rInner = (R * Math.cos((Math.PI * k) / m)) / Math.cos((Math.PI * (k - 1)) / m);
  const rRing = size / Math.cos(Math.PI / m);
  const rOuter = size / Math.cos(Math.PI / n);

  const tipDeg = (i: number) => -90 + i * step;
  const midDeg = (i: number) => -90 + (i + 0.5) * step;
  const tip = (i: number) => polar(R, tipDeg(((i % m) + m) % m));
  const inner = (i: number) => polar(rInner, midDeg(((i % m) + m) % m));
  const ring = (i: number) => polar(rRing, midDeg(((i % m) + m) % m));
  const cornerDeg = (j: number) => -90 + (j + 0.5) * (360 / n);

  const star: Pt[] = [];
  for (let i = 0; i < m; i++) star.push(tip(i), inner(i));

  const specs: Array<{ kind: StarRegionKind; polygon: Pt[]; downDeg: number }> = [
    { kind: "centre", polygon: star, downDeg: 90 },
  ];
  for (let i = 0; i < m; i++) {
    specs.push({
      kind: i % 2 === 0 ? "wedgeA" : "wedgeB",
      polygon: [inner(i - 1), tip(i), inner(i), ring(i), ring(i - 1)],
      downDeg: tipDeg(i), // outward
    });
  }
  const outline: Pt[] = [];
  for (let j = 0; j < n; j++) {
    const apex = polar(rOuter, cornerDeg(j));
    outline.push(apex);
    specs.push({
      kind: "corner",
      polygon: [ring(2 * j), apex, ring(2 * j + 1)],
      downDeg: cornerDeg(j) + 180, // inward
    });
  }

  const regions: StarRegion[] = specs.map((s, index) => ({
    index,
    kind: s.kind,
    polygon: s.polygon,
    ...buildFrameAndMask(s.polygon, frameAxes(s.downDeg)),
  }));

  const seen = new Set<string>();
  const lines: Array<[Pt, Pt]> = [];
  const key = (p: Pt) => `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
  for (const r of regions) {
    for (let i = 0; i < r.polygon.length; i++) {
      const a = r.polygon[i], b = r.polygon[(i + 1) % r.polygon.length];
      const [ka, kb] = [key(a), key(b)].sort();
      const id = `${ka}|${kb}`;
      if (seen.has(id)) continue;
      seen.add(id);
      lines.push([a, b]);
    }
  }

  return { fold, k, size, regions, outline, lines };
}

/** The rotation (degrees, clockwise) taking region `from`'s frame onto region `to`'s; null if different kinds. */
export function starRotation(c: StarConstruction, from: number, to: number): number | null {
  const a = c.regions[from], b = c.regions[to];
  if (!a || !b || a.kind !== b.kind) return null;
  const ang = (r: StarRegion) => (Math.atan2(r.frame.ux.y, r.frame.ux.x) * 180) / Math.PI;
  let d = (((ang(b) - ang(a)) % 360) + 360) % 360;
  if (d > 360 - 1e-9) d = 0;
  return d;
}
