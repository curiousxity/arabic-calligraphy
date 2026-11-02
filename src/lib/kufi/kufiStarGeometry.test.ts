import { describe, it, expect } from "vitest";
import { starConstruction, starRotation, STAR_KS, type Pt, type StarFold } from "./kufiStarGeometry";

const FOLDS: StarFold[] = [4, 5, 6];
const SIZE = 24;

function signedArea(p: Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length];
    a += p[i].x * q.y - q.x * p[i].y;
  }
  return a / 2;
}
const area = (p: Pt[]) => Math.abs(signedArea(p));

function pointInPolygon(pt: Pt, p: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (
      p[i].y > pt.y !== p[j].y > pt.y &&
      pt.x < ((p[j].x - p[i].x) * (pt.y - p[i].y)) / (p[j].y - p[i].y) + p[i].x
    ) inside = !inside;
  }
  return inside;
}

function distToSegment(pt: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(pt.x - (a.x + t * dx), pt.y - (a.y + t * dy));
}

const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Ear-clip a simple polygon into triangles, all counter-clockwise in the maths sense. */
function triangulate(poly: Pt[]): Pt[][] {
  const v = signedArea(poly) >= 0 ? poly.slice() : poly.slice().reverse();
  const tris: Pt[][] = [];
  while (v.length > 3) {
    let clipped = false;
    for (let i = 0; i < v.length && !clipped; i++) {
      const a = v[(i + v.length - 1) % v.length], b = v[i], c = v[(i + 1) % v.length];
      if (cross(a, b, c) <= 1e-12) continue;
      const blocked = v.some((p) => p !== a && p !== b && p !== c &&
        cross(a, b, p) >= -1e-12 && cross(b, c, p) >= -1e-12 && cross(c, a, p) >= -1e-12);
      if (blocked) continue;
      tris.push([a, b, c]);
      v.splice(i, 1);
      clipped = true;
    }
    if (!clipped) throw new Error("triangulate failed");
  }
  tris.push([v[0], v[1], v[2]]);
  return tris;
}

/** Sutherland-Hodgman: subject clipped by a convex counter-clockwise clip. */
function clipConvex(subject: Pt[], clip: Pt[]): Pt[] {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const side = (p: Pt) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j], q = input[(j + 1) % input.length];
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if (sp >= 0 !== sq >= 0) {
        const t = sp / (sp - sq);
        out.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
      }
    }
  }
  return out;
}

function overlapArea(a: Pt[], b: Pt[]): number {
  const tb = triangulate(b);
  let total = 0;
  for (const ta of triangulate(a)) {
    for (const t of tb) {
      const c = clipConvex(ta, t);
      if (c.length >= 3) total += area(c);
    }
  }
  return total;
}

function segKey(a: Pt, b: Pt): string {
  const f = (p: Pt) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
  const [s, t] = [f(a), f(b)].sort();
  return `${s}|${t}`;
}

describe.each(FOLDS)("star construction, %i-fold", (fold) => {
  const c = starConstruction(fold, STAR_KS[fold][0], SIZE);
  const n = fold;

  it("has 1 centre, 2n wedges and n corners, indexed as planned", () => {
    expect(c.regions).toHaveLength(1 + 2 * n + n);
    expect(c.regions.map((r) => r.index)).toEqual(c.regions.map((_, i) => i));
    expect(c.regions[0].kind).toBe("centre");
    for (let i = 1; i <= 2 * n; i++) expect(c.regions[i].kind).toBe(i % 2 === 1 ? "wedgeA" : "wedgeB");
    for (let i = 2 * n + 1; i <= 3 * n; i++) expect(c.regions[i].kind).toBe("corner");
    expect(c.outline).toHaveLength(n);
  });

  it("tiles the outline without overlap", () => {
    const sum = c.regions.reduce((s, r) => s + area(r.polygon), 0);
    expect(Math.abs(sum - area(c.outline))).toBeLessThan(1e-6);
    for (let i = 0; i < c.regions.length; i++) {
      for (let j = i + 1; j < c.regions.length; j++) {
        expect(overlapArea(c.regions[i].polygon, c.regions[j].polygon)).toBeLessThan(1e-6);
      }
    }
  });

  it("gives wedges 5 corners and keeps them off the centre star", () => {
    const centre = c.regions[0].polygon;
    for (let i = 1; i <= 2 * n; i++) {
      const w = c.regions[i].polygon;
      expect(w).toHaveLength(5);
      expect(overlapArea(w, centre)).toBeLessThan(1e-6);
      for (const p of w) {
        const onEdge = centre.some((q, j) => distToSegment(p, q, centre[(j + 1) % centre.length]) < 1e-9);
        expect(onEdge || !pointInPolygon(p, centre)).toBe(true);
      }
    }
  });

  it("rotates wedgeA frames by whole folds, and refuses unlike kinds", () => {
    for (let j = 0; j < n; j++) {
      expect(starRotation(c, 1, 1 + 2 * j)).toBeCloseTo((j * 360) / n, 6);
      expect(starRotation(c, 2, 2 + 2 * j)).toBeCloseTo((j * 360) / n, 6);
      expect(starRotation(c, 2 * n + 1, 2 * n + 1 + j)).toBeCloseTo((j * 360) / n, 6);
    }
    expect(starRotation(c, 1, 2)).toBeNull();
    expect(starRotation(c, 0, 1)).toBeNull();
    expect(starRotation(c, 0, 0)).toBe(0);
  });

  it("gives same-kind regions identical masks", () => {
    for (const r of c.regions) {
      const first = c.regions.find((q) => q.kind === r.kind)!;
      expect(r.mask.cols).toBe(first.mask.cols);
      expect(r.mask.rows).toBe(first.mask.rows);
      expect(Array.from(r.mask.cells)).toEqual(Array.from(first.mask.cells));
    }
  });

  it("keeps every usable cell inside its polygon, a cell clear of every side but the base edge", () => {
    for (const r of c.regions) {
      const { cols, rows, cells } = r.mask;
      expect(cells.length).toBe(cols * rows);
      let usable = 0;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (!cells[row * cols + col]) continue;
          usable++;
          const at = (dc: number, dr: number) => ({
            x: r.frame.origin.x + (col + dc) * r.frame.ux.x + (row + dr) * r.frame.uy.x,
            y: r.frame.origin.y + (col + dc) * r.frame.ux.y + (row + dr) * r.frame.uy.y,
          });
          expect(pointInPolygon(at(0.5, 0.5), r.polygon)).toBe(true);
          for (const [dc, dr] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
            const p = at(dc, dr);
            const sides = r.polygon.map((q, j) => (j === r.base ? Infinity : distToSegment(p, q, r.polygon[(j + 1) % r.polygon.length])));
            expect(Math.min(...sides)).toBeGreaterThanOrEqual(1 - 1e-6);
          }
        }
      }
      // A 6-fold corner is a flat triangle only ~3.7 cells high: no cell keeps the seam.
      if (!(n === 6 && r.kind === "corner")) expect(usable).toBeGreaterThan(0);
    }
  });

  it("has unit, orthogonal, unmirrored frames", () => {
    for (const r of c.regions) {
      const { ux, uy } = r.frame;
      expect(Math.hypot(ux.x, ux.y)).toBeCloseTo(1, 9);
      expect(Math.hypot(uy.x, uy.y)).toBeCloseTo(1, 9);
      expect(ux.x * uy.x + ux.y * uy.y).toBeCloseTo(0, 9);
      expect(ux.x * uy.y - ux.y * uy.x).toBeCloseTo(1, 9);
    }
  });

  it("points a wedge's down outward and a corner's down out through its base leg", () => {
    expect(c.regions[1].frame.uy.y).toBeCloseTo(-1, 9); // top wedge: outward is up
    expect(c.regions[1].base).toBe(3);
    const co = c.regions[2 * n + 1];
    expect(co.base).toBe(1);
    const [a, b] = [co.polygon[1], co.polygon[2]]; // the base leg: apex to ring corner, on the outline
    expect(co.frame.uy.x * (b.x - a.x) + co.frame.uy.y * (b.y - a.y)).toBeCloseTo(0, 9); // across the leg
    expect(co.frame.uy.x * a.x + co.frame.uy.y * a.y).toBeGreaterThan(0); // away from the centre
    expect(c.regions[0].base).toBeNull();
  });

  it("ends a wedge's and a corner's mask on the base edge, with no seam there", () => {
    for (const r of [c.regions[1], c.regions[2 * n + 1]]) {
      if (r.mask.rows === 0) continue;
      const { origin, uy } = r.frame;
      const vBottom = origin.x * uy.x + origin.y * uy.y + r.mask.rows;
      expect(vBottom).toBeCloseTo(SIZE, 6);
    }
  });

  it("draws a base edge's band inside its region, one cell wide, clockwise", () => {
    const w = c.regions[1];
    const a = w.polygon[3], b = w.polygon[4];
    const band = c.bands.find((q) => q.some((p) => Math.hypot(p.x - a.x, p.y - a.y) < 1e-6) && q.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 1e-6));
    expect(band).toBeDefined();
    const mid = { x: band!.reduce((s, p) => s + p.x, 0) / 4, y: band!.reduce((s, p) => s + p.y, 0) / 4 };
    expect(pointInPolygon(mid, w.polygon)).toBe(true);
    expect(area(band!)).toBeCloseTo(Math.hypot(b.x - a.x, b.y - a.y), 6);
    for (const q of c.bands) expect(signedArea(q)).toBeGreaterThan(0);
  });

  it("narrows a wedge's mask inward", () => {
    for (const idx of [1, 2]) {
      const { cols, rows, cells } = c.regions[idx].mask;
      const count = (row: number) => {
        let s = 0;
        for (let col = 0; col < cols; col++) s += cells[row * cols + col];
        return s;
      };
      let top = 0;
      while (top < rows && count(top) === 0) top++;
      expect(count(rows - 1)).toBeGreaterThan(count(top));
    }
  });

  it("lists every construction line once", () => {
    const keys = c.lines.map(([a, b]) => segKey(a, b));
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of c.regions) {
      for (let i = 0; i < r.polygon.length; i++) {
        expect(keys).toContain(segKey(r.polygon[i], r.polygon[(i + 1) % r.polygon.length]));
      }
    }
  });
});

describe("STAR_KS", () => {
  it("offers the classic star first, then 2", () => {
    expect(STAR_KS).toEqual({ 4: [3, 2], 5: [3, 2], 6: [4, 2] });
  });
  it("tiles for the alternative stars too", () => {
    for (const f of FOLDS) {
      for (const k of STAR_KS[f]) {
        const c = starConstruction(f, k, SIZE);
        const sum = c.regions.reduce((s, r) => s + area(r.polygon), 0);
        expect(Math.abs(sum - area(c.outline))).toBeLessThan(1e-6);
      }
    }
  });
});
