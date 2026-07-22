import type { GlyphDescription } from "./types";

export type BBox = { minX: number; minY: number; maxX: number; maxY: number };
export type Point = { x: number; y: number };
export type RealBox = { x: number; y: number; width: number; height: number };

/**
 * Bounding box of every stroke's main path nodes (schema "dot unit" space),
 * across every component — the reference frame `normalizePoint` proportions
 * are computed against. Bezier `in`/`out` control handles are ignored; they
 * rarely extend meaningfully past the node extent for these hand-authored
 * curves, and including them isn't worth the complexity for what's already
 * an approximate mapping (see mapNormToRealBox).
 */
export function computeNodeBoundingBox(desc: GlyphDescription): BBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const component of desc.glyph.components) {
    for (const stroke of component.strokes) {
      for (const node of stroke.path.nodes) {
        minX = Math.min(minX, node.x);
        maxX = Math.max(maxX, node.x);
        minY = Math.min(minY, node.y);
        maxY = Math.max(maxY, node.y);
      }
    }
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }

  return { minX, minY, maxX, maxY };
}

/** A point's plain 0-1 proportion within a bounding box — no axis flip, still in schema coordinate convention. */
export function normalizePoint(point: Point, bbox: BBox): Point {
  const width = Math.max(bbox.maxX - bbox.minX, 1e-6);
  const height = Math.max(bbox.maxY - bbox.minY, 1e-6);
  return {
    x: (point.x - bbox.minX) / width,
    y: (point.y - bbox.minY) / height,
  };
}

/**
 * Maps a 0-1 normalized point onto a real pixel box, flipping Y: the schema
 * convention has Y increasing upward (baseline=0, ascenders/"sky" positive),
 * while real font outlines and canvas coordinates increase Y downward. This
 * is the one place that mismatch gets reconciled.
 */
export function mapNormToRealBox(norm: Point, box: RealBox): Point {
  return {
    x: box.x + norm.x * box.width,
    y: box.y + (1 - norm.y) * box.height,
  };
}
