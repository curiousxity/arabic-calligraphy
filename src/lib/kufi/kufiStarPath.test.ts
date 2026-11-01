import { describe, expect, it } from "vitest";
import { starConstruction } from "./kufiStarGeometry";
import { kufiStarPath, starOutlineBox, starPositionKeepingCentre } from "./kufiStarPath";

const CELL = 10;

/** Subpaths of an `M x y L x y ... Z` string as point lists. */
function subpaths(d: string): Array<Array<[number, number]>> {
  return d
    .split("M")
    .slice(1)
    .map((part) => {
      const nums = part.replace(/[LZ]/g, " ").trim().split(/\s+/).map(Number);
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
      return pts;
    });
}

function signedArea(pts: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function inside(p: [number, number], poly: Array<{ x: number; y: number }>): boolean {
  let ins = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p[1] !== b.y > p[1] && p[0] < ((b.x - a.x) * (p[1] - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

describe("kufiStarPath", () => {
  const c = starConstruction(4, 3, 24);
  const nulls = c.regions.map(() => null);

  it("draws the lines alone within the outline's box, to one cell", () => {
    const d = kufiStarPath(c, nulls, true, CELL);
    expect(d).not.toBe("");
    const pts = subpaths(d).flat();
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const box = starOutlineBox(c);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-CELL);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-CELL);
    expect(Math.max(...xs)).toBeLessThanOrEqual(box.width * CELL + CELL);
    expect(Math.max(...ys)).toBeLessThanOrEqual(box.height * CELL + CELL);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(box.width * CELL - CELL);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(box.height * CELL - CELL);
  });

  it("is empty with the lines off and no region cells", () => {
    expect(kufiStarPath(c, nulls, false, CELL)).toBe("");
  });

  it("maps a region's cells through its frame", () => {
    const wedge = c.regions[1];
    const cells = new Uint8Array(wedge.mask.cols * wedge.mask.rows);
    cells[Math.floor(wedge.mask.rows / 2) * wedge.mask.cols + Math.floor(wedge.mask.cols / 2)] = 1;
    const regionCells = c.regions.map((r) => (r.index === 1 ? cells : null));
    const subs = subpaths(kufiStarPath(c, regionCells, false, CELL));
    expect(subs).toHaveLength(1);
    const box = starOutlineBox(c);
    const n = subs[0].length;
    const cx = subs[0].reduce((s, p) => s + p[0], 0) / n / CELL + box.minX;
    const cy = subs[0].reduce((s, p) => s + p[1], 0) / n / CELL + box.minY;
    expect(inside([cx, cy], wedge.polygon)).toBe(true);
  });

  it("winds cells and bands the same way, and tolerates empty masks and short arrays", () => {
    const wedge = c.regions[1];
    const cells = new Uint8Array(wedge.mask.cols * wedge.mask.rows).fill(1);
    const withCells = subpaths(kufiStarPath(c, c.regions.map((r) => (r.index === 1 ? cells : null)), true, CELL));
    expect(withCells.every((s) => signedArea(s) > 0)).toBe(true);
    const six = starConstruction(6, 4, 12);
    expect(() => kufiStarPath(six, [], true, CELL)).not.toThrow();
    expect(() => kufiStarPath(six, six.regions.map((r) => new Uint8Array(r.mask.cols * r.mask.rows)), true, CELL)).not.toThrow();
  });
});

describe("starPositionKeepingCentre", () => {
  /** The centre (the construction's origin) on the canvas, for a block at `pos` turned by `deg` about it. */
  const worldCentre = (pos: { x: number; y: number }, deg: number, box: { minX: number; minY: number }) => {
    const lx = -box.minX * CELL, ly = -box.minY * CELL;
    const t = (deg * Math.PI) / 180;
    return { x: pos.x + lx * Math.cos(t) - ly * Math.sin(t), y: pos.y + lx * Math.sin(t) + ly * Math.cos(t) };
  };
  const before = starOutlineBox(starConstruction(4, 3, 24));
  const after = starOutlineBox(starConstruction(6, 4, 30));
  const pos = { x: 100, y: 200 };

  it("unrotated: moves the top-left by the box's change, the centre staying put", () => {
    const next = starPositionKeepingCentre(pos, 0, before, after, CELL);
    expect(next.x).toBeCloseTo(pos.x + (after.minX - before.minX) * CELL, 6);
    expect(next.y).toBeCloseTo(pos.y + (after.minY - before.minY) * CELL, 6);
    expect(worldCentre(next, 0, after).x).toBeCloseTo(worldCentre(pos, 0, before).x, 6);
    expect(worldCentre(next, 0, after).y).toBeCloseTo(worldCentre(pos, 0, before).y, 6);
  });

  it("rotated 45°: the centre stays put on the canvas", () => {
    const next = starPositionKeepingCentre(pos, 45, before, after, CELL);
    const was = worldCentre(pos, 45, before), now = worldCentre(next, 45, after);
    expect(now.x).toBeCloseTo(was.x, 6);
    expect(now.y).toBeCloseTo(was.y, 6);
    // The unrotated shift would move it.
    const naive = { x: pos.x + (after.minX - before.minX) * CELL, y: pos.y + (after.minY - before.minY) * CELL };
    expect(Math.hypot(worldCentre(naive, 45, after).x - was.x, worldCentre(naive, 45, after).y - was.y)).toBeGreaterThan(1);
  });
});
