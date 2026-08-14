export type PlacementPoint = { x: number; y: number };

/**
 * A matched pair converting between one renderer's own local coordinate
 * space and the Konva group space its overlay draws in. The only invariant
 * a caller must uphold is that a placement's `box` is expressed in the same
 * local space these two functions operate on — which space that is differs
 * per renderer, and `DiacriticHoverHandles` never needs to know.
 */
export type PlacementAdapter = {
  toCanvas: (x: number, y: number) => PlacementPoint;
  toLocal: (x: number, y: number) => PlacementPoint;
};

/**
 * One hoverable diacritic instance on canvas. `glyphIndex` says which
 * override it edits (Shape Fill draws the same glyph index many times, and
 * every one of those instances edits the same single override); `key` is
 * unique per instance so React can tell the repetitions apart.
 */
export type DiacriticPlacement = {
  glyphIndex: number;
  key: string;
  box: { x: number; y: number; width: number; height: number };
} & PlacementAdapter;

/** Smallest magnitude we will divide by, matching ShapeFillText's own idiom. */
const MIN_DIVISOR = 1e-4;

const safeDivisor = (v: number) =>
  Math.abs(v) < MIN_DIVISOR ? (v < 0 ? -MIN_DIVISOR : MIN_DIVISOR) : v;

/**
 * Plain translation — used by `ShapedText`, whose local space already *is*
 * the glyph-run space its overlay draws in, offset by the block's own
 * `bx + localDrawX` / `by + localDrawY`.
 */
export function makeOffsetAdapter(offsetX: number, offsetY: number): PlacementAdapter {
  return {
    toCanvas: (x, y) => ({ x: x + offsetX, y: y + offsetY }),
    toLocal: (x, y) => ({ x: x - offsetX, y: y - offsetY }),
  };
}

/**
 * A plain-text glyph that also carries a per-glyph move/scale
 * (`GlyphTransform`), for the diacritic overlay mounted on top of it.
 *
 * `ShapedText` draws such a glyph as `translate(pivot) → translate(offset)
 * → scale → [diacritic override] → outline`, so the mark's own override
 * lives *inside* the glyph transform. Expressing that transform as the
 * placement's adapter is what keeps the override in the glyph's own
 * pre-transform space: a drag read back through `toLocal` yields an
 * `offsetY` in text units, unaffected by how much the glyph itself has
 * been scaled.
 *
 * `makeOffsetAdapter` remains the right adapter for the overwhelmingly
 * common case of a glyph with no transform — this one reduces to exactly
 * that when the transform is the identity.
 */
export function makeGlyphTransformAdapter(p: {
  offsetX: number;
  offsetY: number;
  pivotX: number;
  pivotY: number;
  transformOffsetX: number;
  transformOffsetY: number;
  scaleX: number;
  scaleY: number;
}): PlacementAdapter {
  const sx = safeDivisor(p.scaleX);
  const sy = safeDivisor(p.scaleY);

  return {
    toCanvas: (x, y) => ({
      x: p.pivotX + p.transformOffsetX + (x - p.pivotX) * sx + p.offsetX,
      y: p.pivotY + p.transformOffsetY + (y - p.pivotY) * sy + p.offsetY,
    }),
    toLocal: (x, y) => ({
      x: p.pivotX + (x - p.offsetX - p.pivotX - p.transformOffsetX) / sx,
      y: p.pivotY + (y - p.offsetY - p.pivotY - p.transformOffsetY) / sy,
    }),
  };
}

/**
 * One tiled repetition of one glyph in a Shape Fill block.
 *
 * Mirrors `ShapeFillText`'s own draw transform exactly: the tile loop does
 * `translate(gx, gy) → rotate → scale(scX, scY)` per glyph, and the whole
 * pass is wrapped in `scale(shapeScale)`. Canvas transforms compose
 * outside-in, so a glyph-local point maps as
 * `shapeScale · ( (gx, gy) + R · S · p )`.
 *
 * Deliberate approximation: the draw loop also applies an italic shear
 * (`transform(1, 0, -0.25, 1, 0, 0)`) inside this transform, which this
 * adapter ignores. On an italic Shape Fill block a handle therefore sits a
 * few pixels from where the mark is drawn. That is the same class of
 * approximation `DiacriticHoverHandles` already documents — the handle sits
 * where it is easy to grab, not exactly where the glyph pivots — and
 * italic is rare on Arabic text.
 */
export function makeShapeFillInstanceAdapter(p: {
  gx: number;
  gy: number;
  rotationDeg: number;
  scX: number;
  scY: number;
  shapeScale: number;
}): PlacementAdapter {
  const rad = (p.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const sc = safeDivisor(p.shapeScale);
  const sx = safeDivisor(p.scX);
  const sy = safeDivisor(p.scY);

  return {
    toCanvas: (x, y) => {
      const ax = x * sx;
      const ay = y * sy;
      return {
        x: (p.gx + ax * cos - ay * sin) * sc,
        y: (p.gy + ax * sin + ay * cos) * sc,
      };
    },
    toLocal: (x, y) => {
      const rx = x / sc - p.gx;
      const ry = y / sc - p.gy;
      return {
        x: (rx * cos + ry * sin) / sx,
        y: (-rx * sin + ry * cos) / sy,
      };
    },
  };
}
