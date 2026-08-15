/**
 * Block fills — flat colour, or a gradient (linear / radial), including the
 * metallic presets that make gold-leaf lettering possible.
 *
 * Pure module: plain numbers and canvas-gradient construction, no React and
 * no Konva. The one canvas-shaped thing it touches is the 2D context's
 * `createLinearGradient` / `createRadialGradient`, which is exactly what the
 * unit tests mock.
 *
 * A block's `fill` is *optional*. Absent means the block's existing flat
 * `color` string, which is why every project saved before this feature
 * renders byte-identically: `resolveFill` turns `undefined` back into
 * `{ type: "solid", color }` and the solid path never builds a gradient at
 * all.
 */

export type FillStop = {
  /** 0–1 along the gradient axis. */
  offset: number;
  color: string;
};

export type BlockFill =
  | { type: "solid"; color: string }
  /** `angle` in degrees, 0 = left→right, increasing clockwise (canvas y grows down). */
  | { type: "linear"; stops: FillStop[]; angle: number }
  | { type: "radial"; stops: FillStop[] };

export type FillBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** The `{a,b,c,d,e,f}` shape of a DOMMatrix, which is all this module needs. */
export type FillMatrix = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};

/**
 * Minimal 2D-context surface. Deliberately structural rather than
 * `CanvasRenderingContext2D`: Konva hands its own context wrapper to a
 * `sceneFunc`, and the unit tests hand in a recorder.
 */
export type GradientContext = {
  createLinearGradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
  createRadialGradient(
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number
  ): CanvasGradient;
};

export const solidFill = (color: string): BlockFill => ({ type: "solid", color });

/**
 * A block's effective fill. `fill` absent — every block written before this
 * feature — resolves to the flat `color` it has always rendered with.
 */
export function resolveFill(fill: BlockFill | undefined, color: string): BlockFill {
  if (!fill) return solidFill(color);
  if (fill.type === "solid") return fill;
  // A gradient needs at least two stops to mean anything; one (or none) is a
  // half-edited state the UI can briefly produce, and falling back to the
  // block's own colour is more useful than a canvas exception.
  if (fill.stops.length < 2) return solidFill(fill.stops[0]?.color ?? color);
  return fill;
}

/** Stops sorted and clamped — canvas throws on an out-of-range offset. */
export function normalizeStops(stops: FillStop[]): FillStop[] {
  return stops
    .map((s) => ({ offset: Math.min(1, Math.max(0, s.offset)), color: s.color }))
    .sort((a, b) => a.offset - b.offset);
}

/**
 * Geometry of a gradient over `bounds`, in the bounds' own coordinate space.
 * Split out from `makeCanvasFill` so it can be unit-tested as arithmetic and
 * so `mapGeometry` can move it into another space.
 */
export type FillGeometry =
  | { kind: "linear"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "radial"; cx: number; cy: number; r: number };

export function fillGeometry(fill: BlockFill, bounds: FillBounds): FillGeometry | null {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  if (fill.type === "linear") {
    const rad = (fill.angle * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // The bounding box's own extent projected onto the gradient axis, so the
    // gradient spans exactly the box whatever the angle — at 0° that is the
    // width, at 90° the height, and in between the sum of both projections.
    const span = Math.abs(bounds.width * dx) + Math.abs(bounds.height * dy);
    return {
      kind: "linear",
      x0: cx - (dx * span) / 2,
      y0: cy - (dy * span) / 2,
      x1: cx + (dx * span) / 2,
      y1: cy + (dy * span) / 2,
    };
  }
  if (fill.type === "radial") {
    // Half the diagonal, so the last stop reaches the corners rather than
    // stopping at the mid-edge and leaving four flat wedges.
    return { kind: "radial", cx, cy, r: Math.hypot(bounds.width, bounds.height) / 2 };
  }
  return null;
}

const applyMatrix = (m: FillMatrix, x: number, y: number) => ({
  x: m.a * x + m.c * y + m.e,
  y: m.b * x + m.d * y + m.f,
});

/**
 * Move a gradient's geometry through `m`.
 *
 * Used for the SVG-export context (see `makeCanvasFill`), whose gradients are
 * always read in the document's root space. A radial gradient under a
 * non-uniform matrix is an ellipse, which a canvas gradient cannot express —
 * the mean of the two axis scales is used instead. Every artboard transform
 * this app produces is uniform scale plus translation, so that approximation
 * is exact in practice.
 */
export function mapGeometry(geom: FillGeometry, m: FillMatrix): FillGeometry {
  if (geom.kind === "linear") {
    const p0 = applyMatrix(m, geom.x0, geom.y0);
    const p1 = applyMatrix(m, geom.x1, geom.y1);
    return { kind: "linear", x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y };
  }
  const c = applyMatrix(m, geom.cx, geom.cy);
  const sx = Math.hypot(m.a, m.b);
  const sy = Math.hypot(m.c, m.d);
  return { kind: "radial", cx: c.x, cy: c.y, r: (geom.r * (sx + sy)) / 2 };
}

/**
 * Build the `fillStyle` for `fill` over `bounds`.
 *
 * `bounds` is the *block's* run bounds, not a glyph's, so one gradient spans
 * the whole word instead of restarting on every letter. `matrix`, when given,
 * pre-transforms the gradient's geometry — see `createBlockFillPainter`.
 */
export function makeCanvasFill(
  ctx: GradientContext,
  fill: BlockFill,
  bounds: FillBounds,
  matrix?: FillMatrix
): string | CanvasGradient {
  if (fill.type === "solid") return fill.color;

  const base = fillGeometry(fill, bounds);
  if (!base) return "#000000";
  const geom = matrix ? mapGeometry(base, matrix) : base;

  const grad =
    geom.kind === "linear"
      ? ctx.createLinearGradient(geom.x0, geom.y0, geom.x1, geom.y1)
      : ctx.createRadialGradient(geom.cx, geom.cy, 0, geom.cx, geom.cy, Math.max(geom.r, 0.01));

  for (const stop of normalizeStops(fill.stops)) grad.addColorStop(stop.offset, stop.color);
  return grad;
}

/**
 * CSS equivalent of a fill, for sidebar swatches and preset buttons. The CSS
 * angle convention is 90° off this module's (0deg points up the page, ours
 * points along +x), hence the offset.
 */
export function fillToCss(fill: BlockFill): string {
  if (fill.type === "solid") return fill.color;
  const stops = normalizeStops(fill.stops)
    .map((s) => `${s.color} ${Math.round(s.offset * 100)}%`)
    .join(", ");
  return fill.type === "linear"
    ? `linear-gradient(${fill.angle + 90}deg, ${stops})`
    : `radial-gradient(circle at 50% 50%, ${stops})`;
}

/**
 * Metallic presets. Three or more stops is what reads as metal rather than as
 * a tinted ramp: the light band has to be narrow and off-centre.
 */
export const GOLD_PRESETS: { id: string; name: string; fill: BlockFill }[] = [
  {
    id: "gold-leaf",
    name: "Gold leaf",
    fill: {
      type: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#7a5c12" },
        { offset: 0.35, color: "#d4af37" },
        { offset: 0.5, color: "#fbf3c0" },
        { offset: 0.66, color: "#d4af37" },
        { offset: 1, color: "#6b4f0f" },
      ],
    },
  },
  {
    id: "aged-gold",
    name: "Aged gold",
    fill: {
      type: "linear",
      angle: 75,
      stops: [
        { offset: 0, color: "#4a3609" },
        { offset: 0.4, color: "#a8862b" },
        { offset: 0.62, color: "#dcc379" },
        { offset: 1, color: "#5c451a" },
      ],
    },
  },
  {
    id: "silver",
    name: "Silver",
    fill: {
      type: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#6f7276" },
        { offset: 0.34, color: "#c8ccd1" },
        { offset: 0.5, color: "#ffffff" },
        { offset: 0.68, color: "#b6bbc1" },
        { offset: 1, color: "#61656a" },
      ],
    },
  },
  {
    id: "copper",
    name: "Copper",
    fill: {
      type: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#5c2c14" },
        { offset: 0.38, color: "#b87333" },
        { offset: 0.54, color: "#e8b98a" },
        { offset: 1, color: "#6d3a1c" },
      ],
    },
  },
  {
    id: "lapis",
    name: "Lapis & gold",
    fill: {
      type: "radial",
      stops: [
        { offset: 0, color: "#f0d98c" },
        { offset: 0.45, color: "#2a4a8f" },
        { offset: 1, color: "#101f45" },
      ],
    },
  },
];

/* ------------------------------------------------------------------ *
 * Painting
 * ------------------------------------------------------------------ */

/**
 * The context surface a painter needs. Konva's wrapper proxies every one of
 * these, so a renderer can keep passing the object its `sceneFunc` was given.
 */
type PaintContext = GradientContext & {
  fill(): void;
  stroke(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
};

type RawContext = PaintContext & {
  getTransform?: () => FillMatrix;
  /** Present only on the svgcanvas context `react-konva-to-svg` swaps in. */
  getSerializedSvg?: () => string;
  _context?: RawContext;
};

/** Konva's context wrapper proxies drawing calls but not `getTransform`. */
function rawContext(ctx: unknown): RawContext {
  const c = ctx as RawContext;
  if (typeof c.getTransform === "function") return c;
  if (c._context && typeof c._context.getTransform === "function") return c._context;
  return c;
}

export type BlockFillPainter = {
  /** What was assigned to `fillStyle`; a plain string for a solid fill. */
  style: string | CanvasGradient;
  /** True when the style is a gradient — i.e. when the ctx dance is in play. */
  isGradient: boolean;
  /** Fill the current path in the *block's* gradient space. */
  fill(ctx: PaintContext): void;
  /**
   * Stroke the current path with the fill style — faux bold's only use.
   *
   * Two widths, because a gradient stroke is issued with the transform reset
   * to block space and `lineWidth` is read in whatever space is current:
   * `local` is the width in the caller's own (per-glyph) space, `block` the
   * same visible weight expressed in the block's space. A solid fill uses
   * `local` and is byte-identical to what these renderers did before.
   */
  strokeWithFill(ctx: PaintContext, widths: { local: number; block: number }): void;
};

/**
 * Resolve a block's fill against the context **while it is in the block's own
 * coordinate space**, and hand back something that can paint later, from
 * inside per-glyph transforms, without the gradient following those
 * transforms.
 *
 * Two non-obvious mechanics make that work:
 *
 * - **A canvas path is stored in device space**, converted by the CTM as each
 *   segment is added. A `fillStyle` gradient, by contrast, is read through the
 *   CTM *at fill time*. So resetting the transform between tracing a glyph and
 *   filling it moves the gradient back into block space and leaves the glyph
 *   exactly where it was traced. That is the whole trick — without it every
 *   letter would get its own full sweep of the gradient, and a Shape Fill
 *   block's hundreds of tiled instances would read as noise.
 * - **The SVG export context is different.** `react-konva-to-svg` swaps in
 *   svgcanvas, which bakes path points into the document's root space and
 *   emits gradients as `gradientUnits="userSpaceOnUse"` defs with *untouched*
 *   coordinates — so there a gradient is read in root space, not through the
 *   CTM. It is detected by its own `getSerializedSvg`, and its gradient is
 *   built pre-multiplied by the block matrix instead. Gradients therefore
 *   survive SVG export as real vector gradients; nothing rasterizes.
 */
export function createBlockFillPainter(
  ctx: unknown,
  fill: BlockFill | undefined,
  color: string,
  bounds: FillBounds
): BlockFillPainter {
  const resolved = resolveFill(fill, color);

  if (resolved.type === "solid") {
    const style = resolved.color;
    return {
      style,
      isGradient: false,
      fill: (c) => c.fill(),
      strokeWithFill: (c, widths) => {
        c.strokeStyle = style;
        c.lineWidth = widths.local;
        c.stroke();
      },
    };
  }

  const raw = rawContext(ctx);
  const matrix = raw.getTransform?.();
  const isSvgExport = typeof raw.getSerializedSvg === "function";
  const style = makeCanvasFill(
    raw,
    resolved,
    bounds,
    isSvgExport && matrix ? matrix : undefined
  );

  // Without a readable CTM there is nothing to restore to, so paint plainly
  // rather than guess — the gradient then follows the glyph transforms, which
  // is wrong but still draws.
  const canRebase = !isSvgExport && matrix != null;

  const inBlockSpace = (paint: () => void) => {
    if (!canRebase) {
      paint();
      return;
    }
    const current = raw.getTransform!();
    const m = matrix!;
    raw.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    paint();
    raw.setTransform(current.a, current.b, current.c, current.d, current.e, current.f);
  };

  return {
    style,
    isGradient: true,
    fill: (c) => inBlockSpace(() => c.fill()),
    strokeWithFill: (c, widths) =>
      inBlockSpace(() => {
        c.strokeStyle = style;
        c.lineWidth = canRebase ? widths.block : widths.local;
        c.stroke();
      }),
  };
}
