import { normalizeRotation } from "./glyphTransform";

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
 * → scale → rotate → [diacritic override] → outline`, so the mark's own override
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
  /** The glyph's own turn, in degrees. Optional — absent is no rotation. */
  rotationDeg?: number;
  /**
   * The point that turn is about, in the same local space as the placement
   * box: the glyph's raw outline centre. Only read when `rotationDeg` is
   * non-zero.
   */
  rotationPivotX?: number;
  rotationPivotY?: number;
}): PlacementAdapter {
  const sx = safeDivisor(p.scaleX);
  const sy = safeDivisor(p.scaleY);
  const rot = normalizeRotation(p.rotationDeg ?? 0);
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rpx = p.rotationPivotX ?? 0;
  const rpy = p.rotationPivotY ?? 0;

  // The renderer composes `translate(pivot) -> translate(transformOffset) ->
  // scale -> rotate(about the raw box centre) -> [the mark's own override]`,
  // so the rotation is the innermost of the three and a point maps as
  // scale(rotate(p)). Inverting in the same order is what keeps a drag
  // readable as an `offsetY` in the glyph's own unscaled, unturned units —
  // which is the whole contract `DiacriticHoverHandles` relies on.
  const turn = (x: number, y: number) => {
    if (rot === 0) return { x, y };
    const dx = x - rpx;
    const dy = y - rpy;
    return { x: rpx + dx * cos - dy * sin, y: rpy + dx * sin + dy * cos };
  };

  const unturn = (x: number, y: number) => {
    if (rot === 0) return { x, y };
    const dx = x - rpx;
    const dy = y - rpy;
    return { x: rpx + dx * cos + dy * sin, y: rpy - dx * sin + dy * cos };
  };

  return {
    toCanvas: (x, y) => {
      const r = turn(x, y);
      return {
        x: p.pivotX + p.transformOffsetX + (r.x - p.pivotX) * sx + p.offsetX,
        y: p.pivotY + p.transformOffsetY + (r.y - p.pivotY) * sy + p.offsetY,
      };
    },
    toLocal: (x, y) =>
      unturn(
        p.pivotX + (x - p.offsetX - p.pivotX - p.transformOffsetX) / sx,
        p.pivotY + (y - p.offsetY - p.pivotY - p.transformOffsetY) / sy
      ),
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
 * Chains two adapters: `inner`'s local space maps through `inner` into
 * `outer`'s local space, and through `outer` from there into group space.
 *
 * This exists because Shape Fill's draw transform grew a stage in the
 * middle. A glyph carrying a per-glyph transform is drawn as
 * `rowFrame → glyphTransform → rowFitScale → [the mark's own override]`, so
 * a mark on such a glyph needs all three composed to reach where it is
 * actually drawn — while a glyph with no transform must keep the two-stage
 * mapping `makeShapeFillInstanceAdapter` already expresses, unchanged.
 *
 * Composition rather than a wider adapter builder is what keeps each stage
 * readable on its own and lets the identity case be proved by test:
 * composing with an identity-valued stage returns the outer mapping.
 */
export function composeAdapters(
  outer: PlacementAdapter,
  inner: PlacementAdapter
): PlacementAdapter {
  return {
    toCanvas: (x, y) => {
      const mid = inner.toCanvas(x, y);
      return outer.toCanvas(mid.x, mid.y);
    },
    toLocal: (x, y) => {
      const mid = outer.toLocal(x, y);
      return inner.toLocal(mid.x, mid.y);
    },
  };
}

/**
 * One hoverable *glyph* on canvas, for the move/scale/rotate overlay.
 *
 * Lives here beside `DiacriticPlacement` rather than in the component,
 * because this module is the coordinate-space layer both renderers already
 * share; a second placement vocabulary in a component file would be a second
 * place for the two renderers' spaces to be described.
 *
 * **`box` is the glyph's RAW outline box and the transform is deliberately
 * not folded into it.** Folding it in would make the producing memo depend on
 * the live drag value — which on Shape Fill means rebuilding and re-mapping
 * the whole tiled instance array on every frame of a drag, the exact reason
 * `ShapeFillText`'s diacritic placements exclude `diacriticOverrides` from
 * their dependency list. The overlay resolves the transform itself, per
 * render, from a separate prop.
 *
 * `gx`/`gy` are the glyph's pen origin in the same local space — the point
 * the renderer scales about once the transform's own offset is added.
 */
export type GlyphTransformPlacement = {
  glyphIndex: number;
  key: string;
  /** The glyph this placement was built for, stamped onto every write. */
  glyphId: number;
  box: { x: number; y: number; width: number; height: number };
  gx: number;
  gy: number;
  /**
   * Canvas px per local unit, per axis. The handle gap is divided by these
   * so the dots sit a constant distance clear of the glyph on screen however
   * compressed the row that drew it is — on Shape Fill a row's fit scale can
   * be well under 1, and a gap left in local units would put the dots inside
   * the letter. Absent means the local space is already canvas px.
   */
  unitScaleX?: number;
  unitScaleY?: number;
} & PlacementAdapter;
