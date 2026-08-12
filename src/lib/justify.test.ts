/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
import * as opentype from "opentype.js";
import type { GlyphEdit } from "../types";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { normalizeGlyphs } from "./normalizeGlyphs";
import {
  applyKashidaAmountToEdits,
  hasKashidaEligibleHandles,
  measureStretchedRunWidth,
  solveKashidaAmount,
} from "./justify";

// See diacritics.test.ts for the full explanation: harfbuzzjs's package
// entrypoint is CommonJS whose `module.exports` is itself a Promise, which
// Node's ESM/CJS interop throws on during a static `import`. Loading it via
// `require` (as harfbuzzjs's own tests do) sidesteps that entirely.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

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

const hbPromise = resolveHbLoader(hbjsModule);

/**
 * Shapes `text` with a real font via real harfbuzzjs, mirroring `shapeText`
 * in `harfbuzz.ts` (RTL, `arab` script, `ar` language) — the font bytes come
 * from `public/fonts/` via `fs` instead of `fetch`, which is the only
 * difference from the app's own shaping path.
 *
 * Following `diacritics.test.ts`'s precedent deliberately: a
 * hand-written-fixture version of that suite once passed while the feature it
 * covered was completely inert against real shaped text. A width measurement
 * is exactly as prone to that failure mode.
 */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font; unitsPerEm: number }> {
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

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont, unitsPerEm: upm };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

const FONT_SIZE = 120;

/**
 * A schema-shaped stretch handle on the *rightmost* glyph of a real run,
 * pulling horizontally outward from the run's own left edge — geometry taken
 * from the run's measured extent rather than invented, so the band actually
 * covers real outline points of the real font.
 */
function horizontalStretch(
  glyphIndex: number,
  fromX: number,
  toX: number,
  factor: number
): GlyphEdit {
  return {
    glyphIndex,
    stretches: [
      {
        id: "stretch-1",
        anchorX: fromX,
        anchorY: 0,
        dragOriginX: toX,
        dragOriginY: 0,
        // A schema-backed handle's dragX is the maxFactor-extrapolated point;
        // resolveValueMultiplier remaps `factor` onto [0, 1] across
        // [1, maxFactor], so factor=1 is the natural, undisplaced rendering.
        dragX: toX + (toX - fromX) * 0.5,
        dragY: 0,
        bandWidth: FONT_SIZE * 4,
        factor,
        minFactor: 1,
        maxFactor: 2,
        kashidaEligible: true,
        priority: 10,
      },
    ],
  };
}

describe("measureStretchedRunWidth (real HarfBuzz shaping)", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  it("equals the unedited width when glyphEdits is empty", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("سلام", "Thuluth.ttf");
    expect(glyphs.length).toBeGreaterThan(0);

    const base = measureStretchedRunWidth({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      glyphEdits: [],
    });

    expect(base).toBeGreaterThan(0);

    // A handle sitting at its neutral factor (1) displaces nothing, so it must
    // measure identically to having no edits at all — this is the property the
    // whole solver rests on, since factor=1 is where the dial sits at amount 0.
    const neutral = measureStretchedRunWidth({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      glyphEdits: [horizontalStretch(0, 0, FONT_SIZE, 1)],
    });

    expect(neutral).toBeCloseTo(base, 6);
  });

  it("is strictly wider with a stretch applied", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("سلام", "Thuluth.ttf");

    const base = measureStretchedRunWidth({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      glyphEdits: [],
    });

    // Anchor at the run's left edge, dragging the last glyph rightward past
    // the run's right edge — every outline point of that glyph is inside the
    // band and beyond the anchor, so the ink genuinely gets wider.
    const stretched = measureStretchedRunWidth({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      glyphEdits: [horizontalStretch(glyphs.length - 1, -base, base, 2)],
    });

    expect(stretched).toBeGreaterThan(base);
  });

  it("widens monotonically as the factor rises, which is what makes bisection safe", async () => {
    const { glyphs, font, unitsPerEm } = await shapeReal("سلام", "Thuluth.ttf");

    const base = measureStretchedRunWidth({
      glyphs,
      font,
      fontSize: FONT_SIZE,
      unitsPerEm,
      glyphEdits: [],
    });

    const widths = [1, 1.25, 1.5, 1.75, 2].map((factor) =>
      measureStretchedRunWidth({
        glyphs,
        font,
        fontSize: FONT_SIZE,
        unitsPerEm,
        glyphEdits: [horizontalStretch(glyphs.length - 1, -base, base, factor)],
      })
    );

    for (let i = 1; i < widths.length; i++) {
      expect(widths[i]).toBeGreaterThanOrEqual(widths[i - 1]);
    }
    expect(widths[widths.length - 1]).toBeGreaterThan(widths[0]);
  });

  it("returns 0 for an empty run", async () => {
    const { font, unitsPerEm } = await shapeReal("سلام", "Thuluth.ttf");
    expect(
      measureStretchedRunWidth({ glyphs: [], font, fontSize: FONT_SIZE, unitsPerEm, glyphEdits: [] })
    ).toBe(0);
  });
});

describe("applyKashidaAmountToEdits", () => {
  const edits = (): GlyphEdit[] => [
    {
      glyphIndex: 0,
      stretches: [
        { ...horizontalStretch(0, 0, 100, 1).stretches[0], id: "eligible", priority: 10 },
        {
          ...horizontalStretch(0, 0, 100, 1).stretches[0],
          id: "half-priority",
          priority: 5,
        },
        {
          ...horizontalStretch(0, 0, 100, 1).stretches[0],
          id: "ineligible",
          kashidaEligible: false,
          factor: 1.3,
        },
        // A plain freehand handle (no maxFactor) — the dial never touches it.
        {
          id: "freehand",
          anchorX: 0,
          anchorY: 0,
          dragOriginX: 100,
          dragOriginY: 0,
          dragX: 150,
          dragY: 0,
          bandWidth: 40,
          kashidaEligible: true,
        },
      ],
    },
  ];

  it("ramps each eligible handle toward maxFactor, weighted by priority", () => {
    const out = applyKashidaAmountToEdits(edits(), 100)[0].stretches;
    // maxFactor 2, weight 10/10 -> 1 + 1*1*1 = 2 (its own maximum).
    expect(out[0].factor).toBeCloseTo(2);
    // maxFactor 2, weight 5/10 -> 1 + 1*1*0.5 = 1.5.
    expect(out[1].factor).toBeCloseTo(1.5);
  });

  it("leaves factor at the neutral 1 at amount 0", () => {
    const out = applyKashidaAmountToEdits(edits(), 0)[0].stretches;
    expect(out[0].factor).toBeCloseTo(1);
    expect(out[1].factor).toBeCloseTo(1);
  });

  it("never touches ineligible or freehand handles", () => {
    const out = applyKashidaAmountToEdits(edits(), 100)[0].stretches;
    expect(out[2].factor).toBe(1.3);
    expect(out[3].factor).toBeUndefined();
  });

  it("clamps the dial to 0-100", () => {
    expect(applyKashidaAmountToEdits(edits(), 500)[0].stretches[0].factor).toBeCloseTo(2);
    expect(applyKashidaAmountToEdits(edits(), -50)[0].stretches[0].factor).toBeCloseTo(1);
  });

  it("detects whether anything is eligible at all", () => {
    expect(hasKashidaEligibleHandles(edits())).toBe(true);
    expect(hasKashidaEligibleHandles([])).toBe(false);
    expect(
      hasKashidaEligibleHandles([{ glyphIndex: 0, stretches: [edits()[0].stretches[3]] }])
    ).toBe(false);
  });
});

describe("solveKashidaAmount", () => {
  /** A synthetic dial: width grows linearly from `base` to `base + range`. */
  const linear = (base: number, range: number) => (amount: number) =>
    base + (range * amount) / 100;

  it("finds the amount that hits the target", () => {
    const solution = solveKashidaAmount(linear(400, 400), 600);
    expect(solution.reachable).toBe(true);
    expect(solution.amount).toBeCloseTo(50, 1);
    expect(solution.achievedWidth).toBeCloseTo(600, 1);
  });

  it("returns 0 when the run is already wide enough at amount 0", () => {
    const solution = solveKashidaAmount(linear(700, 400), 600);
    expect(solution).toEqual({ amount: 0, achievedWidth: 700, reachable: true });
  });

  it("returns 0 when the target is exactly the amount-0 width", () => {
    const solution = solveKashidaAmount(linear(600, 400), 600);
    expect(solution.amount).toBe(0);
    expect(solution.reachable).toBe(true);
  });

  it("applies the maximum and reports it unreachable when even amount 100 falls short", () => {
    const solution = solveKashidaAmount(linear(400, 100), 900);
    expect(solution).toEqual({ amount: 100, achievedWidth: 500, reachable: false });
  });

  it("honours a loose tolerance by stopping early", () => {
    const calls: number[] = [];
    const solution = solveKashidaAmount(
      (amount) => {
        calls.push(amount);
        return linear(400, 400)(amount);
      },
      600,
      { tolerancePx: 200 }
    );
    // 400 at amount 0 is already within 200px of the 600 target.
    expect(solution.amount).toBe(0);
    expect(calls).toEqual([0]);
  });

  it("reaches sub-pixel precision within the default iteration budget", () => {
    const solution = solveKashidaAmount(linear(400, 1000), 913.7);
    expect(Math.abs(solution.achievedWidth - 913.7)).toBeLessThanOrEqual(0.5);
  });

  it("respects the iteration cap, returning the closest amount it reached", () => {
    let calls = 0;
    const solution = solveKashidaAmount(
      (amount) => {
        calls++;
        return linear(0, 10000)(amount);
      },
      1234.5,
      { tolerancePx: 0.0001, maxIterations: 3 }
    );
    // 2 end probes + at most 3 bisection steps.
    expect(calls).toBe(5);
    expect(solution.reachable).toBe(true);
    expect(solution.amount).toBeGreaterThan(0);
    expect(solution.amount).toBeLessThan(100);
  });

  it("handles a flat width function (no eligible handles) without spinning", () => {
    const solution = solveKashidaAmount(() => 500, 800);
    expect(solution).toEqual({ amount: 100, achievedWidth: 500, reachable: false });
  });
});
