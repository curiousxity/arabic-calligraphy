import { describe, it, expect } from "vitest";
import {
  fillToCss,
  GOLD_PRESETS,
  createBlockFillPainter,
  fillGeometry,
  makeCanvasFill,
  mapGeometry,
  normalizeStops,
  resolveFill,
  solidFill,
  type BlockFill,
  type FillBounds,
} from "./blockFill";

/**
 * Recording stand-in for a 2D context. `makeCanvasFill` only ever calls the
 * two gradient factories and `addColorStop`, so this is the whole surface.
 */
function mockCtx(extra: Record<string, unknown> = {}) {
  const calls: { linear: number[][]; radial: number[][]; stops: [number, string][] } = {
    linear: [],
    radial: [],
    stops: [],
  };
  const gradient = {
    addColorStop: (offset: number, color: string) => calls.stops.push([offset, color]),
  } as unknown as CanvasGradient;
  const ctx = {
    createLinearGradient: (...args: number[]) => {
      calls.linear.push(args);
      return gradient;
    },
    createRadialGradient: (...args: number[]) => {
      calls.radial.push(args);
      return gradient;
    },
    ...extra,
  };
  return { ctx, calls };
}

const BOX: FillBounds = { x: 0, y: 0, width: 100, height: 40 };

describe("resolveFill", () => {
  it("falls back to the block's flat colour when `fill` is absent", () => {
    expect(resolveFill(undefined, "#123456")).toEqual({ type: "solid", color: "#123456" });
  });

  it("passes a solid fill through unchanged", () => {
    const fill = solidFill("#abcdef");
    expect(resolveFill(fill, "#000000")).toBe(fill);
  });

  it("degrades a gradient with fewer than two stops to a solid", () => {
    expect(resolveFill({ type: "linear", angle: 0, stops: [] }, "#ff0000")).toEqual({
      type: "solid",
      color: "#ff0000",
    });
    expect(
      resolveFill({ type: "radial", stops: [{ offset: 0, color: "#00ff00" }] }, "#ff0000")
    ).toEqual({ type: "solid", color: "#00ff00" });
  });
});

describe("normalizeStops", () => {
  it("clamps out-of-range offsets and sorts", () => {
    expect(
      normalizeStops([
        { offset: 2, color: "c" },
        { offset: -1, color: "a" },
        { offset: 0.5, color: "b" },
      ])
    ).toEqual([
      { offset: 0, color: "a" },
      { offset: 0.5, color: "b" },
      { offset: 1, color: "c" },
    ]);
  });
});

describe("fillGeometry", () => {
  const linear = (angle: number) =>
    fillGeometry(
      { type: "linear", angle, stops: [{ offset: 0, color: "a" }, { offset: 1, color: "b" }] },
      BOX
    );

  it("spans the box's width at 0 degrees", () => {
    expect(linear(0)).toEqual({ kind: "linear", x0: 0, y0: 20, x1: 100, y1: 20 });
  });

  it("spans the box's height at 90 degrees", () => {
    const g = linear(90);
    expect(g?.kind).toBe("linear");
    if (g?.kind !== "linear") return;
    expect(g.x0).toBeCloseTo(50);
    expect(g.x1).toBeCloseTo(50);
    expect(g.y0).toBeCloseTo(0);
    expect(g.y1).toBeCloseTo(40);
  });

  it("runs the other way at 180 degrees", () => {
    const g = linear(180);
    if (g?.kind !== "linear") throw new Error("expected linear");
    expect(g.x0).toBeCloseTo(100);
    expect(g.x1).toBeCloseTo(0);
  });

  it("projects both sides at 45 degrees, and stays centred", () => {
    const g = linear(45);
    if (g?.kind !== "linear") throw new Error("expected linear");
    const span = Math.hypot(g.x1 - g.x0, g.y1 - g.y0);
    expect(span).toBeCloseTo((100 + 40) / Math.SQRT2);
    expect((g.x0 + g.x1) / 2).toBeCloseTo(50);
    expect((g.y0 + g.y1) / 2).toBeCloseTo(20);
  });

  it("is offset by the box's own origin", () => {
    const g = fillGeometry(
      { type: "linear", angle: 0, stops: [{ offset: 0, color: "a" }, { offset: 1, color: "b" }] },
      { x: 10, y: 5, width: 100, height: 40 }
    );
    expect(g).toEqual({ kind: "linear", x0: 10, y0: 25, x1: 110, y1: 25 });
  });

  it("reaches the corners for a radial", () => {
    const g = fillGeometry({ type: "radial", stops: [] }, BOX);
    expect(g).toEqual({ kind: "radial", cx: 50, cy: 20, r: Math.hypot(100, 40) / 2 });
  });

  it("has no geometry for a solid", () => {
    expect(fillGeometry(solidFill("#fff"), BOX)).toBeNull();
  });
});

describe("mapGeometry", () => {
  it("moves a linear gradient through a translate+scale", () => {
    const g = mapGeometry(
      { kind: "linear", x0: 0, y0: 0, x1: 10, y1: 0 },
      { a: 2, b: 0, c: 0, d: 2, e: 5, f: 7 }
    );
    expect(g).toEqual({ kind: "linear", x0: 5, y0: 7, x1: 25, y1: 7 });
  });

  it("scales a radial gradient's radius by the matrix scale", () => {
    const g = mapGeometry({ kind: "radial", cx: 1, cy: 1, r: 4 }, { a: 3, b: 0, c: 0, d: 3, e: 0, f: 0 });
    expect(g).toEqual({ kind: "radial", cx: 3, cy: 3, r: 12 });
  });
});

describe("makeCanvasFill", () => {
  it("returns the colour string for a solid fill without touching the ctx", () => {
    const { ctx, calls } = mockCtx();
    expect(makeCanvasFill(ctx, solidFill("#ff8800"), BOX)).toBe("#ff8800");
    expect(calls.linear).toHaveLength(0);
    expect(calls.radial).toHaveLength(0);
  });

  it("builds a linear gradient with the box's geometry and every stop", () => {
    const { ctx, calls } = mockCtx();
    makeCanvasFill(
      ctx,
      { type: "linear", angle: 0, stops: [{ offset: 0, color: "a" }, { offset: 1, color: "b" }] },
      BOX
    );
    expect(calls.linear).toEqual([[0, 20, 100, 20]]);
    expect(calls.stops).toEqual([
      [0, "a"],
      [1, "b"],
    ]);
  });

  it("builds a radial gradient from the centre outward", () => {
    const { ctx, calls } = mockCtx();
    makeCanvasFill(
      ctx,
      { type: "radial", stops: [{ offset: 0, color: "a" }, { offset: 1, color: "b" }] },
      BOX
    );
    expect(calls.radial).toEqual([[50, 20, 0, 50, 20, Math.hypot(100, 40) / 2]]);
  });

  it("pre-transforms the geometry when given a matrix", () => {
    const { ctx, calls } = mockCtx();
    makeCanvasFill(
      ctx,
      { type: "linear", angle: 0, stops: [{ offset: 0, color: "a" }, { offset: 1, color: "b" }] },
      BOX,
      { a: 1, b: 0, c: 0, d: 1, e: 100, f: 200 }
    );
    expect(calls.linear).toEqual([[100, 220, 200, 220]]);
  });
});

describe("fillToCss", () => {
  it("returns the bare colour for a solid", () => {
    expect(fillToCss(solidFill("#abcdef"))).toBe("#abcdef");
  });

  it("rotates the angle into CSS's convention", () => {
    expect(
      fillToCss({
        type: "linear",
        angle: 0,
        stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }],
      })
    ).toBe("linear-gradient(90deg, #000000 0%, #ffffff 100%)");
  });

  it("renders a radial from the centre", () => {
    expect(
      fillToCss({
        type: "radial",
        stops: [{ offset: 0, color: "#000000" }, { offset: 1, color: "#ffffff" }],
      })
    ).toBe("radial-gradient(circle at 50% 50%, #000000 0%, #ffffff 100%)");
  });
});

describe("GOLD_PRESETS", () => {
  it("are well-formed gradients with unique ids", () => {
    expect(GOLD_PRESETS.length).toBeGreaterThanOrEqual(4);
    expect(new Set(GOLD_PRESETS.map((p) => p.id)).size).toBe(GOLD_PRESETS.length);
    for (const preset of GOLD_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.fill.type).not.toBe("solid");
      const stops = (preset.fill as Exclude<BlockFill, { type: "solid" }>).stops;
      expect(stops.length).toBeGreaterThanOrEqual(3);
      expect(stops[0].offset).toBe(0);
      expect(stops[stops.length - 1].offset).toBe(1);
      for (const s of stops) {
        expect(s.offset).toBeGreaterThanOrEqual(0);
        expect(s.offset).toBeLessThanOrEqual(1);
        expect(s.color).toMatch(/^#[0-9a-f]{6}$/i);
      }
      // Sorted — canvas rejects a decreasing offset.
      const offsets = stops.map((s) => s.offset);
      expect([...offsets].sort((a, b) => a - b)).toEqual(offsets);
    }
  });
});

describe("createBlockFillPainter", () => {
  /** A context that records the transform dance around each paint call. */
  function paintCtx(opts: { svg?: boolean } = {}) {
    let transform = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    const log: string[] = [];
    const base = mockCtx();
    const ctx = {
      ...base.ctx,
      fillStyle: "" as string | CanvasGradient,
      strokeStyle: "" as string | CanvasGradient,
      lineWidth: 0,
      getTransform: () => transform,
      setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => {
        transform = { a, b, c, d, e, f };
        log.push(`setTransform(${a},${e},${f})`);
      },
      fill: () => log.push(`fill@${transform.e},${transform.f}`),
      stroke: () => log.push(`stroke@${transform.e} w=${ctx.lineWidth}`),
      ...(opts.svg ? { getSerializedSvg: () => "<svg/>" } : {}),
    };
    return { ctx, log, calls: base.calls, setTransform: (m: typeof transform) => (transform = m) };
  }

  const gradient: BlockFill = {
    type: "linear",
    angle: 0,
    stops: [{ offset: 0, color: "a" }, { offset: 1, color: "b" }],
  };

  it("paints a solid fill with no transform juggling at all", () => {
    const { ctx, log } = paintCtx();
    const painter = createBlockFillPainter(ctx, undefined, "#123456", BOX);
    expect(painter.style).toBe("#123456");
    expect(painter.isGradient).toBe(false);
    painter.fill(ctx);
    painter.strokeWithFill(ctx, { local: 2, block: 9 });
    expect(log).toEqual(["fill@0,0", "stroke@0 w=2"]);
  });

  it("resets to the block's transform for the fill, then restores", () => {
    const { ctx, log, setTransform } = paintCtx();
    setTransform({ a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
    const painter = createBlockFillPainter(ctx, gradient, "#000000", BOX);
    expect(painter.isGradient).toBe(true);
    // Now pretend the renderer has walked into a single glyph's space.
    ctx.setTransform(1, 0, 0, 1, 555, 666);
    log.length = 0;
    painter.fill(ctx);
    expect(log).toEqual([
      "setTransform(1,10,20)",
      "fill@10,20",
      "setTransform(1,555,666)",
    ]);
  });

  it("strokes faux bold at the block-space width while rebasing", () => {
    const { ctx, log } = paintCtx();
    const painter = createBlockFillPainter(ctx, gradient, "#000000", BOX);
    log.length = 0;
    painter.strokeWithFill(ctx, { local: 2, block: 9 });
    expect(log).toContain("stroke@0 w=9");
  });

  it("builds the gradient in block space for a canvas context", () => {
    const { ctx, calls, setTransform } = paintCtx();
    setTransform({ a: 1, b: 0, c: 0, d: 1, e: 400, f: 400 });
    createBlockFillPainter(ctx, gradient, "#000000", BOX);
    expect(calls.linear).toEqual([[0, 20, 100, 20]]);
  });

  it("builds the gradient in root space for the SVG-export context, and never rebases", () => {
    const { ctx, calls, log, setTransform } = paintCtx({ svg: true });
    setTransform({ a: 1, b: 0, c: 0, d: 1, e: 400, f: 400 });
    const painter = createBlockFillPainter(ctx, gradient, "#000000", BOX);
    expect(calls.linear).toEqual([[400, 420, 500, 420]]);
    log.length = 0;
    painter.fill(ctx);
    expect(log).toEqual(["fill@400,400"]);
  });
});
