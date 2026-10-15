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

/**
 * One glyph laid along a curve (`TextOnPathText`). Mirrors its draw transform:
 * translate to the pen position `(x, y)`, rotate by the tangent `angle`, then
 * the baseline offset — the same maths as `curvePlacementToGroup`.
 *
 * Local space is the letter's own tilted frame at the block's `fontSize`, and
 * `k` (drawn size ÷ `fontSize`) scales it to the size the curve actually draws
 * at. That makes an override's offset mean "relative to its own letter":
 * local y is always perpendicular to the curve at that letter, and an offset
 * keeps its proportion when the curve is lengthened and the text grows with
 * it. Italic shear is ignored, as in the Shape Fill adapter.
 */
export function makeCurveGlyphAdapter(p: {
  x: number;
  y: number;
  angle: number;
  k: number;
  baselineOffset: number;
}): PlacementAdapter {
  const cos = Math.cos(p.angle);
  const sin = Math.sin(p.angle);
  const k = safeDivisor(p.k);

  return {
    toCanvas: (x, y) => {
      const lx = x * k;
      const ly = y * k + p.baselineOffset;
      return { x: p.x + lx * cos - ly * sin, y: p.y + lx * sin + ly * cos };
    },
    toLocal: (x, y) => {
      const rx = x - p.x;
      const ry = y - p.y;
      return {
        x: (rx * cos + ry * sin) / k,
        y: (-rx * sin + ry * cos - p.baselineOffset) / k,
      };
    },
  };
}

/**
 * One hoverable detached mark (a dot, hamza or kaf stroke) on canvas. `box`
 * is where it is drawn now, i.e. already offset by `dx`/`dy`; the overlay
 * adds a drag delta to those and writes the sum back.
 */
export type DetachedMarkPlacement = {
  key: string;
  cluster: number;
  glyphId: number;
  mark: number;
  box: { x: number; y: number; width: number; height: number };
  /** Current offset, font units. */
  dx: number;
  dy: number;
} & PlacementAdapter;
