/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./harfbuzz";

// See the identical note in diacritics.test.ts: harfbuzzjs's CommonJS
// entrypoint exports a Promise, which Node's ESM interop tries to await
// during a static `import` and throws on. `require` sidesteps it.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
import { normalizeGlyphs } from "./normalizeGlyphs";

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;

  if (typeof m === "function") {
    return (m as () => Promise<HbModule> | HbModule)() as Promise<HbModule>;
  }
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;

  throw new Error("Unable to resolve harfbuzzjs loader in test");
}

type HbModule = {
  createBlob: (data: ArrayBuffer | Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => {
    setScale?: (x: number, y: number) => void;
    destroy?: () => void;
  };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (direction: string) => void;
    setScript?: (script: string) => void;
    setLanguage?: (language: string) => void;
    json?: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown, features?: string) => void;
};

const hbPromise = resolveHbLoader(hbjsModule);

/**
 * Shapes `text` with a real font via real harfbuzzjs, mirroring `shapeText`
 * in `harfbuzz.ts` (RTL, `arab`, `ar`) — copied from `diacritics.test.ts`
 * rather than reinvented, per CLAUDE.md's test conventions. The font bytes
 * come from `public/fonts/` via `fs` instead of over the network; that is
 * the only difference from the app's own shaping path.
 */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.resolve(dir, "../../public/fonts", fontFile);
  const fontData = fs.readFileSync(fontPath);
  const arrayBuffer = fontData.buffer.slice(
    fontData.byteOffset,
    fontData.byteOffset + fontData.byteLength
  );
  const parsedFont = opentype.parse(arrayBuffer);
  const upm = parsedFont.unitsPerEm || 1000;

  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  try {
    if (typeof font.setScale === "function") font.setScale(upm, upm);
    buffer.addText(text);
    if (typeof buffer.guessSegmentProperties === "function") {
      buffer.guessSegmentProperties();
    }
    if (typeof buffer.setDirection === "function") buffer.setDirection("rtl");
    if (typeof buffer.setScript === "function") buffer.setScript("arab");
    if (typeof buffer.setLanguage === "function") buffer.setLanguage("ar");

    hb.shape(font, buffer);

    let raw: unknown[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

import { describe, it, expect } from "vitest";
import {
  flattenContours, crossingsAt, legalCutAt, findCutZones, findCutZonesSwept,
  zoneExtentX, rotateContours, applyCutsToCommands, buildCutPlan, toSvgCmds,
  outlineBounds, cutAdvanceTotal, remapCutsAfterInsert,
  DEFAULT_DETECT_OPTS,
} from "./strokeCuts";
import type { SvgCmd } from "./svgPath";
import type { StrokeCut } from "./strokeCuts";

/** Width of an outline's ink along x, in whatever units it is given in. */
function extentX(cmds: SvgCmd[]): number {
  let min = Infinity, max = -Infinity;
  for (const c of flattenContours(cmds)) for (const [x] of c) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return max - min;
}

/** A 100x20 horizontal bar — the model of an extendable straight stroke. */
const BAR: SvgCmd[] = [
  { type: "M", x: 0, y: 0 },
  { type: "L", x: 100, y: 0 },
  { type: "L", x: 100, y: 20 },
  { type: "L", x: 0, y: 20 },
  { type: "Z" },
];

/** A bar with a square hole — models a counter, two contours. */
const BAR_WITH_HOLE: SvgCmd[] = [
  ...BAR,
  { type: "M", x: 40, y: 5 },
  { type: "L", x: 60, y: 5 },
  { type: "L", x: 60, y: 15 },
  { type: "L", x: 40, y: 15 },
  { type: "Z" },
];

describe("flattenContours", () => {
  it("keeps contours separate rather than concatenating them", () => {
    expect(flattenContours(BAR)).toHaveLength(1);
    expect(flattenContours(BAR_WITH_HOLE)).toHaveLength(2);
  });
});

describe("crossingsAt", () => {
  it("finds the two horizontal edges of a bar", () => {
    const cs = crossingsAt(flattenContours(BAR), 50);
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => c.y).sort((a, b) => a - b)).toEqual([0, 20]);
    for (const c of cs) expect(Math.abs(c.slope)).toBeLessThan(1e-9);
  });

  it("does not invent a crossing on a phantom segment between contours", () => {
    // x=50 passes through the hole: outer top, hole top, hole bottom, outer
    // bottom = 4 crossings. Concatenating the contours would add a spurious
    // segment from (0,20) to (40,5) and change this count.
    expect(crossingsAt(flattenContours(BAR_WITH_HOLE), 50)).toHaveLength(4);
  });
});

describe("legalCutAt", () => {
  it("accepts a cut through a flat bar and reports its thickness", () => {
    const r = legalCutAt(flattenContours(BAR), 50);
    expect(r.legal).toBe(true);
    expect(r.thickness).toBeCloseTo(20, 6);
  });

  it("rejects a cut through a gap", () => {
    expect(legalCutAt(flattenContours(BAR), 150).legal).toBe(false);
  });

  it("rejects a cut whose crossings are steep", () => {
    const wedge: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 100, y: 80 },
      { type: "L", x: 100, y: 100 },
      { type: "L", x: 0, y: 20 },
      { type: "Z" },
    ];
    expect(legalCutAt(flattenContours(wedge), 50).legal).toBe(false);
  });
});

describe("findCutZones", () => {
  const meta = { glyphIndex: 3, cluster: 1 };

  it("finds one zone spanning a flat bar", () => {
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 5, minZoneWidth: 10,
    });
    expect(zones).toHaveLength(1);
    expect(zones[0].glyphIndex).toBe(3);
    expect(zones[0].cluster).toBe(1);
    expect(zones[0].thickness).toBeCloseTo(20, 1);
    expect(zones[0].toX - zones[0].fromX).toBeGreaterThan(50);
  });

  it("does not claim unsampled geometry: zone toX respects last tested sample", () => {
    // With step=7 over BAR's 0-100 range, the last sample is at x=98.
    // The zone should NOT extend to x=100 (unsampled). Regression test for the
    // trailing flush(maxX) bug.
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 7, minZoneWidth: 10,
    });
    expect(zones).toHaveLength(1);
    expect(zones[0].toX).toBeLessThanOrEqual(98);
  });

  it("rejects zones where maxSlope filter blocks all cuts (steep V-shape)", () => {
    // A V-shape with both edges steep: (0,0) -> (50,100) -> (100,0).
    // Every vertical cut at 0 < x < 100 crosses two edges with slope ±2,
    // exceeding maxSlope: 0.18, so no zones form.
    const steepV: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "L", x: 50, y: 100 },
      { type: "L", x: 100, y: 0 },
      { type: "Z" },
    ];
    expect(findCutZones(flattenContours(steepV), meta, DEFAULT_DETECT_OPTS)).toHaveLength(0);
  });

  it("rejects a zone narrower than minZoneWidth", () => {
    const zones = findCutZones(flattenContours(BAR), meta, {
      ...DEFAULT_DETECT_OPTS, step: 5, minZoneWidth: 500,
    });
    expect(zones).toHaveLength(0);
  });
});

/** Rotate every point in a command list about the origin by `t` radians. */
function rotateCmds(cmds: SvgCmd[], t: number): SvgCmd[] {
  const c = Math.cos(t), s = Math.sin(t);
  const rot = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
  return cmds.map((cmd) => {
    switch (cmd.type) {
      case "M": case "L": {
        const [x, y] = rot(cmd.x, cmd.y);
        return { ...cmd, x, y };
      }
      case "Q": {
        const [x, y] = rot(cmd.x, cmd.y);
        const [x1, y1] = rot(cmd.x1, cmd.y1);
        return { ...cmd, x, y, x1, y1 };
      }
      case "C": {
        const [x, y] = rot(cmd.x, cmd.y);
        const [x1, y1] = rot(cmd.x1, cmd.y1);
        const [x2, y2] = rot(cmd.x2, cmd.y2);
        return { ...cmd, x, y, x1, y1, x2, y2 };
      }
      default:
        return cmd;
    }
  });
}

describe("findCutZonesSwept", () => {
  const meta = { glyphIndex: 3, cluster: 1 };

  it("finds an inclined stroke that the baseline-relative sweep refuses", () => {
    // 12 degrees puts the bar's edges at slope tan(12deg) = 0.213, over the
    // shipped maxSlope of 0.18 — a straight, extendable stem the original
    // predicate rejects purely for not being parallel to the baseline.
    const t = (12 * Math.PI) / 180;
    const contours = flattenContours(rotateCmds(BAR, t));

    expect(findCutZones(contours, meta, DEFAULT_DETECT_OPTS)).toHaveLength(0);

    const zones = findCutZonesSwept(contours, meta, DEFAULT_DETECT_OPTS);
    expect(zones).toHaveLength(1);
    expect(Math.abs(zones[0].angle - t)).toBeLessThanOrEqual(
      DEFAULT_DETECT_OPTS.angleStep
    );
  });
});

/** A constant-thickness circular band — a bowl, as a font actually draws one.
 *  Its weight holds steady everywhere, so the thickness check cannot reject
 *  it; only the edges' changing inclination distinguishes it from a stroke. */
function arcBand(rInner: number, rOuter: number, a0: number, a1: number, steps = 60): SvgCmd[] {
  const cmds: SvgCmd[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const p = { x: Math.cos(a) * rOuter, y: Math.sin(a) * rOuter };
    cmds.push({ type: i === 0 ? "M" : "L", ...p });
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    cmds.push({ type: "L", x: Math.cos(a) * rInner, y: Math.sin(a) * rInner });
  }
  cmds.push({ type: "Z" });
  return cmds;
}

describe("curve rejection", () => {
  const meta = { glyphIndex: 0, cluster: 0 };
  const BOWL = arcBand(100, 120, Math.PI * 0.15, Math.PI * 0.85);

  it("holds its weight, so thickness alone cannot tell it from a stroke", () => {
    const contours = flattenContours(BOWL);
    const a = legalCutAt(contours, 0, DEFAULT_DETECT_OPTS);
    const b = legalCutAt(contours, 10, DEFAULT_DETECT_OPTS);
    expect(a.legal && b.legal).toBe(true);
    expect(Math.abs(a.thickness - b.thickness) / a.thickness).toBeLessThan(
      DEFAULT_DETECT_OPTS.thicknessTolerance
    );
  });

  it("is rejected at every angle the sweep tries", () => {
    // Every point of a curve is flat in *some* rotated frame, so without a
    // steadiness requirement the sweep reports a whole bowl as extendable.
    expect(
      findCutZonesSwept(flattenContours(BOWL), meta, DEFAULT_DETECT_OPTS)
    ).toHaveLength(0);
  });
});

describe("a gently bowed stroke of near-constant weight", () => {
  const meta = { glyphIndex: 0, cluster: 0 };

  /** Edges bowed by equal and opposite amounts: y = -k x^2 above,
   *  y = 20 + k x^2 below. Weight varies by 8% (inside thicknessTolerance)
   *  and no edge exceeds maxSlope, so only the edges' drift gives it away —
   *  and because the two drift in opposite directions, their mean is zero at
   *  every sample. This is the shape a mean-based steadiness test lets
   *  through. */
  const BOWED = (() => {
    const k = 0.0005, X = 40, steps = 40;
    const cmds: SvgCmd[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = -X + (2 * X * i) / steps;
      cmds.push({ type: i === 0 ? "M" : "L", x, y: -k * x * x });
    }
    for (let i = steps; i >= 0; i--) {
      const x = -X + (2 * X * i) / steps;
      cmds.push({ type: "L", x, y: 20 + k * x * x });
    }
    cmds.push({ type: "Z" });
    return cmds;
  })();

  it("passes the weight and slope-magnitude checks", () => {
    const contours = flattenContours(BOWED);
    for (const x of [-30, 0, 30]) {
      const s = legalCutAt(contours, x, DEFAULT_DETECT_OPTS);
      expect(s.legal).toBe(true);
      for (const slope of s.slopes) {
        expect(Math.abs(slope)).toBeLessThan(DEFAULT_DETECT_OPTS.maxSlope);
      }
    }
  });

  it("has two edges that drift in opposite directions, cancelling in the mean", () => {
    const contours = flattenContours(BOWED);
    const lo = legalCutAt(contours, -30, DEFAULT_DETECT_OPTS).slopes;
    const hi = legalCutAt(contours, 30, DEFAULT_DETECT_OPTS).slopes;
    expect(lo).toHaveLength(2);
    // Opposite signs at each end, so their averages agree while the edges
    // themselves have swung right across the zone.
    expect(Math.sign(lo[0])).toBe(-Math.sign(lo[1]));
    const mean = (xs: number[]) => (xs[0] + xs[1]) / 2;
    // The two averages agree to well inside a hair, while each edge has
    // swung right across the zone.
    expect(Math.abs(mean(lo) - mean(hi))).toBeLessThan(1e-9);
  });

  it("is rejected anyway, because each edge is judged on its own", () => {
    // Only the baseline-parallel reading is asserted here. The sweep can
    // still offer a *shorter* span of this same stroke: rotating the frame
    // clips the legal range, and an edge's bow falls with the square of the
    // span, so a short enough piece of a gentle curve really is straight to
    // within tolerance and bridging it is legitimate. What must never be
    // accepted is the full-width zone, where the bow is measurable.
    expect(findCutZones(flattenContours(BOWED), meta, DEFAULT_DETECT_OPTS))
      .toHaveLength(0);
  });
});

describe("zoneExtentX", () => {
  const meta = { glyphIndex: 0, cluster: 0 };

  it("is the identity on a zone found parallel to the baseline", () => {
    const [z] = findCutZones(flattenContours(BAR), meta, DEFAULT_DETECT_OPTS);
    expect(zoneExtentX(z)).toEqual([z.fromX, z.toX]);
  });

  it("maps an inclined zone back into the glyph's own x range", () => {
    // Without the mapping a tilted zone's raw fromX/toX are displaced by
    // centreY * sin(angle) — enough to move a zone clear of the join window
    // it actually sits in.
    const t = (12 * Math.PI) / 180;
    const cmds = rotateCmds(BAR, t);
    const contours = flattenContours(cmds);
    const [z] = findCutZonesSwept(contours, meta, DEFAULT_DETECT_OPTS);

    let minX = Infinity, maxX = -Infinity;
    for (const c of contours) for (const [x] of c) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }

    const [from, to] = zoneExtentX(z);
    expect(from).toBeLessThan(to);
    expect(from).toBeGreaterThanOrEqual(minX - 1);
    expect(to).toBeLessThanOrEqual(maxX + 1);
    // Not merely restating the raw fields.
    expect(to).not.toBeCloseTo(z.toX, 3);
  });

  it("displaces a high stroke by more than a join window", () => {
    // The displacement is centreY * sin(angle), so it grows with how far the
    // stroke sits above the baseline. At a typical stroke height it exceeds
    // the upm/20 window the sweep uses to decide whether a zone covers a
    // join — which is what makes reading fromX/toX raw a real error rather
    // than a rounding one.
    const t = (12 * Math.PI) / 180;
    const high = BAR.map((c) =>
      c.type === "Z" ? c : { ...c, y: (c as { y: number }).y + 300 }
    ) as SvgCmd[];
    const [z] = findCutZonesSwept(
      flattenContours(rotateCmds(high, t)), meta, DEFAULT_DETECT_OPTS
    );
    const joinWindow = 1000 / 20;
    expect(Math.abs(zoneExtentX(z)[0] - z.fromX)).toBeGreaterThan(joinWindow);
  });
});

describe("a straight stroke whose outline is finely segmented", () => {
  const meta = { glyphIndex: 0, cluster: 0 };

  /** A dead-straight bar whose top edge is drawn as short segments that
   *  alternate by a third of a unit — the signature of curve flattening,
   *  which `flattenContours` applies at 8 segments per curve. Consecutive
   *  samples land on segments whose slopes differ by 0.12, while the edge
   *  itself never leaves a 0.3-unit band on a 20-unit stroke. Real font
   *  outlines look like this everywhere. */
  const SEGMENTED = (() => {
    // 7-unit segments against the detector's 10-unit sampling step, so
    // successive samples land on opposite phases of the wobble. At 5 units
    // they would alias onto the same phase and the wobble would never reach
    // the predicate at all.
    const cmds: SvgCmd[] = [{ type: "M", x: 0, y: 0 }];
    for (let i = 1; i <= 14; i++) cmds.push({ type: "L", x: i * 7, y: i % 2 ? 0.3 : 0 });
    cmds.push({ type: "L", x: 98, y: 20 });
    for (let i = 13; i >= 0; i--) cmds.push({ type: "L", x: i * 7, y: 20 });
    cmds.push({ type: "Z" });
    return cmds;
  })();

  it("wobbles in per-segment slope far more than the steadiness bar allows", () => {
    const contours = flattenContours(SEGMENTED);
    const slopes = [10, 20, 30, 40].map(
      (x) => legalCutAt(contours, x, DEFAULT_DETECT_OPTS).slopes[0]
    );
    // Comfortably more drift than the 0.06 per-segment bar an earlier
    // version of this predicate used, which is what threw the stroke away.
    expect(Math.max(...slopes) - Math.min(...slopes)).toBeGreaterThan(0.06);
  });

  it("is still offered as a stroke, because its edge never leaves a straight line", () => {
    expect(
      findCutZones(flattenContours(SEGMENTED), meta, DEFAULT_DETECT_OPTS).length
    ).toBeGreaterThan(0);
  });
});

describe("applyCutsToCommands", () => {
  it("widens the bar by exactly the cut distance", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 50, d: 30, angle: 0 }]);
    expect(extentX(out)).toBeCloseTo(130, 6);
  });

  it("preserves stroke weight across the bridge", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 50, d: 30, angle: 0 }]);
    const before = legalCutAt(flattenContours(BAR), 50);
    const after = legalCutAt(flattenContours(out), 65);
    expect(after.legal).toBe(true);
    expect(after.thickness).toBeCloseTo(before.thickness, 6);
  });

  it("leaves geometry before the cut untouched", () => {
    const out = applyCutsToCommands(BAR, [{ cutX: 50, d: 30, angle: 0 }]);
    expect(legalCutAt(flattenContours(out), 10).thickness).toBeCloseTo(20, 6);
  });

  it("splits a cubic that crosses the cut", () => {
    const flat: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "C", x1: 33, y1: 1, x2: 66, y2: 1, x: 100, y: 0 },
      { type: "L", x: 100, y: 20 },
      { type: "C", x1: 66, y1: 21, x2: 33, y2: 21, x: 0, y: 20 },
      { type: "Z" },
    ];
    const out = applyCutsToCommands(flat, [{ cutX: 50, d: 40, angle: 0 }]);
    expect(extentX(out)).toBeCloseTo(140, 1);
  });

  it("splits a quadratic that crosses the cut", () => {
    // opentype.js hands back quadratics for every TrueType font, so this is
    // the common case rather than an exotic one.
    const quad: SvgCmd[] = [
      { type: "M", x: 0, y: 0 },
      { type: "Q", x1: 50, y1: 1, x: 100, y: 0 },
      { type: "L", x: 100, y: 20 },
      { type: "Q", x1: 50, y1: 21, x: 0, y: 20 },
      { type: "Z" },
    ];
    const out = applyCutsToCommands(quad, [{ cutX: 50, d: 40, angle: 0 }]);
    expect(extentX(out)).toBeCloseTo(140, 1);
  });

  it("bridges the closing segment when the contour wraps across the cut", () => {
    // A stroke of constant thickness 20 whose contour starts at the
    // right-hand end, so the segment Z implies — last point back to the
    // start — is the only one crossing the cut. Its lower edge is sloped: on
    // a horizontal one the un-bridged straight line would coincide with the
    // bridged path and hide the bug.
    const wrapped: SvgCmd[] = [
      { type: "M", x: 100, y: 5 },
      { type: "L", x: 100, y: 25 },
      { type: "L", x: 0, y: 20 },
      { type: "L", x: 0, y: 0 },
      { type: "Z" },
    ];
    const out = applyCutsToCommands(wrapped, [{ cutX: 50, d: 30, angle: 0 }]);
    expect(extentX(out)).toBeCloseTo(130, 6);
    // Sampled away from the midpoint, where the two paths cross anyway.
    expect(legalCutAt(flattenContours(out), 100).thickness).toBeCloseTo(20, 6);
  });

  it("applies multiple cuts without the earlier one shifting the later", () => {
    const out = applyCutsToCommands(BAR, [
      { cutX: 25, d: 10, angle: 0 },
      { cutX: 75, d: 10, angle: 0 },
    ]);
    expect(extentX(out)).toBeCloseTo(120, 6);
  });

  it("grows an inclined stroke along its own axis, so x grows by d*cos(t)", () => {
    const t = (12 * Math.PI) / 180;
    const tilted = rotateCmds(BAR, t);
    const before = extentX(tilted);
    // cutX is expressed in the cut's own frame, where the bar spans 0..100.
    const out = applyCutsToCommands(tilted, [{ cutX: 50, d: 30, angle: t }]);
    expect(extentX(out) - before).toBeCloseTo(30 * Math.cos(t), 6);
  });

  it("keeps an inclined stroke's weight across the bridge", () => {
    const t = (12 * Math.PI) / 180;
    const out = applyCutsToCommands(rotateCmds(BAR, t), [
      { cutX: 50, d: 30, angle: t },
    ]);
    // Measured in the stroke's own frame, where the bridge is a rectangle.
    const inFrame = rotateContours(flattenContours(out), -t);
    expect(legalCutAt(inFrame, 65).thickness).toBeCloseTo(20, 6);
  });
});

describe("a cut really widens the run", () => {
  const REAL_FONTS = ["Amiri.ttf", "Scheherazade.ttf", "NotoSans.ttf"];

  /** The first glyph of a real shaped run that has a detectable stroke,
   *  together with its outline. Everything below is measured on real
   *  HarfBuzz output and real font outlines — never a hand-written glyph —
   *  because a fixture would encode the assumption this suite exists to
   *  test. */
  async function firstCuttableGlyph(text: string, file: string) {
    const { glyphs, font } = await shapeReal(text, file);
    const upm = font.unitsPerEm || 1000;
    const opts = {
      ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40,
    };
    for (let i = 0; i < glyphs.length; i++) {
      const glyph = font.glyphs.get(glyphs[i].g);
      if (!glyph) continue;
      const cmds = toSvgCmds(glyph.getPath(0, 0, upm).commands);
      const zones = findCutZonesSwept(
        flattenContours(cmds),
        { glyphIndex: i, cluster: glyphs[i].cl ?? 0 },
        opts
      );
      if (zones.length > 0) return { glyphs, font, upm, cmds, zone: zones[0], index: i };
    }
    return null;
  }

  it.each(REAL_FONTS)("the outline itself gets wider in %s", async (file) => {
    const found = await firstCuttableGlyph("حرف", file);
    expect(found).not.toBeNull();
    const { cmds, zone, upm } = found!;

    const cutX = (zone.fromX + zone.toX) / 2;
    const ds = [0, upm / 20, upm / 10, upm / 5];
    const widths = ds.map((d) =>
      extentX(d === 0 ? cmds : applyCutsToCommands(cmds, [{ cutX, d, angle: zone.angle }]))
    );

    // Strictly increasing, measured off the outline rather than off the
    // bookkeeping. This is tatweel.test.ts's bar, and its absence is exactly
    // why an inert elongation feature shipped once before.
    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    }
    // And by the right amount: extension runs along the stroke's own axis.
    expect(widths[3] - widths[0]).toBeCloseTo(ds[3] * Math.cos(zone.angle), 4);
  });

  it.each(REAL_FONTS)("the plan's added advance matches that growth in %s", async (file) => {
    const found = await firstCuttableGlyph("حرف", file);
    expect(found).not.toBeNull();
    const { cmds, zone, upm, glyphs, index } = found!;

    const cutX = (zone.fromX + zone.toX) / 2;
    const d = upm / 10;
    const measured =
      extentX(applyCutsToCommands(cmds, [{ cutX, d, angle: zone.angle }])) - extentX(cmds);

    const plan = buildCutPlan(
      glyphs,
      [{
        cluster: glyphs[index].cl ?? 0,
        glyphId: glyphs[index].g,
        localX: cutX,
        angle: zone.angle,
        nuqta: 0,
        _dOverride: d,
      }],
      upm
    );

    // Ties the number the renderer will lay out with to the number the
    // geometry actually produced. Reporting an advance the outline does not
    // match is the failure that makes an elongation feature look inert.
    expect(plan.addedAdvance).toBeCloseTo(measured, 4);
  });

  it("plans nothing, and shifts nothing, when there are no cuts", async () => {
    const { glyphs, font } = await shapeReal("حرف", "Amiri.ttf");
    const plan = buildCutPlan(glyphs, [], font.unitsPerEm || 1000);
    expect(plan.addedAdvance).toBe(0);
    expect(plan.shift.every((s) => s === 0)).toBe(true);
    expect(plan.surgery.size).toBe(0);
  });

  it("drops a cut whose glyph id no longer matches, rather than cutting the wrong letter", async () => {
    const { glyphs, font } = await shapeReal("حرف", "Amiri.ttf");
    const plan = buildCutPlan(
      glyphs,
      [{
        cluster: glyphs[0].cl ?? 0,
        glyphId: glyphs[0].g + 12345,
        localX: 100, angle: 0, nuqta: 0, _dOverride: 50,
      }],
      font.unitsPerEm || 1000
    );
    expect(plan.addedAdvance).toBe(0);
    expect(plan.surgery.size).toBe(0);
  });
});

describe("outlineBounds", () => {
  it("boxes a plain bar", () => {
    expect(outlineBounds(BAR)).toEqual({ x1: 0, y1: 0, x2: 100, y2: 20 });
  });

  it("grows with a cut, which is what makes a stretched block re-layout", () => {
    const cut = applyCutsToCommands(BAR, [{ cutX: 50, d: 30, angle: 0 }]);
    const b = outlineBounds(cut);
    expect(b.x2 - b.x1).toBeCloseTo(130, 6);
    expect(b.y2 - b.y1).toBeCloseTo(20, 6);
  });

  it("is empty for an empty outline rather than infinite", () => {
    expect(outlineBounds([])).toEqual({ x1: 0, y1: 0, x2: 0, y2: 0 });
  });
});

describe("cutAdvanceTotal", () => {
  it("agrees with the plan's own added advance", async () => {
    // The fitter and the renderer must never disagree about how much width a
    // cut adds, so they share this one function rather than each applying
    // the d*cos(t) rule for themselves.
    const { glyphs, font } = await shapeReal("حرف", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const cuts: StrokeCut[] = [
      { cluster: glyphs[0].cl ?? 0, localX: upm / 4, angle: 0.2, nuqta: 2 },
      { cluster: glyphs[1].cl ?? 0, localX: upm / 3, angle: -0.1, nuqta: 1 },
    ];
    const plan = buildCutPlan(glyphs, cuts, 50);
    expect(cutAdvanceTotal(cuts, 50)).toBeCloseTo(plan.addedAdvance, 9);
    expect(cutAdvanceTotal(cuts, 50)).toBeGreaterThan(0);
  });

  it("is zero with no cuts, so an unstretched block pays nothing", () => {
    expect(cutAdvanceTotal([], 50)).toBe(0);
  });
});

describe("remapCutsAfterInsert", () => {
  const cut = (cluster: number): StrokeCut => ({
    cluster, localX: 10, angle: 0, nuqta: 1,
  });

  it("shifts cuts after the insertion point and leaves earlier ones alone", () => {
    const out = remapCutsAfterInsert([cut(0), cut(5)], 2, 3);
    expect(out[0].cluster).toBe(0);
    expect(out[1].cluster).toBe(8);
  });

  it("leaves a cut exactly at the insertion point in place", () => {
    // A tatweel goes *between* two letters, so the letter whose own offset
    // is the slot index keeps it; only what follows moves.
    const out = remapCutsAfterInsert([cut(2)], 2, 1);
    expect(out[0].cluster).toBe(2);
  });

  it("shifts back when tatweels are removed", () => {
    // applyKashida is absolute, not additive, so lowering a count is a
    // negative delta rather than a separate operation.
    expect(remapCutsAfterInsert([cut(9)], 2, -3)[0].cluster).toBe(6);
  });

  it("is what keeps buildCutPlan from dropping a cut after a text insert", () => {
    // The mechanism the remap exists for, end to end. `buildCutPlan` resolves
    // a cut by (cluster, glyphId); inserting a tatweel *before* the cut letter
    // moves that letter's cluster, so the recorded pair matches nothing and
    // the cut is dropped — the stretch silently disappears. Remapping by the
    // same delta the edit inserted restores the match.
    const glyphs = [
      { g: 1, cl: 0, ax: 100 },
      // The cut letter, now two offsets further along after an insert at 0.
      { g: 7, cl: 3, ax: 100 },
    ];
    const stale: StrokeCut = { cluster: 1, glyphId: 7, localX: 10, angle: 0, nuqta: 1 };

    expect(buildCutPlan(glyphs, [stale], 100).addedAdvance).toBe(0);

    const remapped = remapCutsAfterInsert([stale], 0, 2);
    expect(buildCutPlan(glyphs, remapped, 100).addedAdvance).toBeGreaterThan(0);
  });

  it("survives a whole distribution when replayed highest offset first", () => {
    // What Fit to width does: several slots edited in one gesture. Replaying
    // the edits in `applyDistributionWithEdits`' own order (descending) leaves
    // every cut where its letter actually ended up.
    //
    // Text offsets 0..9, cuts on the letters at 1, 4 and 8. Two insertions:
    // +2 at offset 6, then +3 at offset 3 — the order the solver reports them.
    const cuts = [cut(1), cut(4), cut(8)];
    const edits = [
      { index: 6, delta: 2 },
      { index: 3, delta: 3 },
    ];
    const out = edits.reduce((acc, e) => remapCutsAfterInsert(acc, e.index, e.delta), cuts);
    // 1 is before both insertions; 4 is after the second only; 8 is after both.
    expect(out.map((c) => c.cluster)).toEqual([1, 7, 13]);
  });

  it("lands cuts wrong if the same edits are replayed lowest offset first", () => {
    // The falsification of the test above: ascending order shifts the later
    // insertion's own offset by what the earlier one added, so the cut between
    // them is moved twice. This is why the order is part of the contract.
    const cuts = [cut(1), cut(4), cut(8)];
    const ascending = [
      { index: 3, delta: 3 },
      { index: 6, delta: 2 },
    ];
    const out = ascending.reduce(
      (acc, e) => remapCutsAfterInsert(acc, e.index, e.delta),
      cuts
    );
    expect(out.map((c) => c.cluster)).not.toEqual([1, 7, 13]);
  });

  it("is a no-op for a zero delta", () => {
    const cuts = [cut(0), cut(4)];
    expect(remapCutsAfterInsert(cuts, 2, 0)).toEqual(cuts);
  });
});
