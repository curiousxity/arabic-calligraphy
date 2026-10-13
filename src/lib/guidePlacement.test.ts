/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

// harfbuzzjs's package entrypoint (`index.js`) is CommonJS whose
// `module.exports` is itself `new Promise(...)` — Node's ESM/CJS interop
// treats a thenable default export as "auto-awaitable" during static
// `import`, which throws ("Method Promise.prototype.then called on
// incompatible receiver [object Module]") before any of this file's own
// code runs. Loading it via `require` (as harfbuzzjs's own README/tests
// do in Node) sidesteps that interop entirely — this is a Node-in-Vitest
// loading quirk specific to this package shape, unrelated to how the
// app itself loads it (the app is bundled by Vite/Rolldown, which
// doesn't have this issue).
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
import { normalizeGlyphs } from "./normalizeGlyphs";

// harfbuzzjs's own module shape varies across bundlers/loaders (its main
// export can itself be the init promise, or wrapped in one or two levels
// of `{ default }` depending on how ESM/CJS interop resolves it) — this
// mirrors the resolution `harfbuzz.ts`'s own (private) `resolveHbLoader`
// performs, so the real WASM module loads the same way here as it does
// in the app.
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
 * Shapes `text` with a real font via real harfbuzzjs, mirroring
 * `shapeText` in `harfbuzz.ts` (RTL direction, `arab` script, `ar`
 * language). Doesn't reuse `shapeText` itself because that function
 * fetches the font over the network (`fetch(fontUrl)`) — here the font
 * bytes come straight from `public/fonts/` via `fs`, which is the only
 * difference from the app's own shaping path.
 *
 * This is the fix for the bug this suite exists to catch (C1): the
 * previous version of this file hand-wrote `{ g, cl }` glyph objects
 * encoding an assumption about HarfBuzz's clustering that HarfBuzz does
 * not satisfy (one cluster per character) — the tests passed while the
 * feature was completely inert against real shaped text. Every glyph
 * used below comes from actually shaping real text with a real font.
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

import { parseSvgPath } from "./svgPath";
import { buildArcTable, pointAtArcLengthFromTable, type ArcTable } from "./textPath";
import { guidePathD, isClosedPath } from "./guideShapes";
import { DEFAULT_ATTACHMENT, guideGlyphPlacements, guideInkBox, projectToGuide } from "./guidePlacement";
import type { GuideAttachment } from "../types";

async function amiri(text: string) {
  const { glyphs, font } = await shapeReal(text, "Amiri.ttf");
  return { glyphs, upm: font.unitsPerEm || 1000, ascender: font.ascender };
}
const natural = (glyphs: { ax?: number }[], fontSize: number, upm: number) =>
  glyphs.reduce((s, g) => s + (g.ax ?? 0), 0) * (fontSize / upm);
const attach = (over: Partial<GuideAttachment> = {}): GuideAttachment => ({ id: 1, ...DEFAULT_ATTACHMENT, ...over });
const table = (d: string, flip: boolean): { t: ArcTable; closed: boolean } => {
  const cmds = parseSvgPath(d);
  return { t: buildArcTable(cmds, flip), closed: isClosedPath(cmds) };
};

describe("guideGlyphPlacements (real HarfBuzz, Amiri)", () => {
  it("keeps the natural size when the text fits", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله");
    const { t, closed } = table(guidePathD("circle", { width: 600 }), false);
    const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach() })!;
    expect(r.shrink).toBe(1);
    expect(r.size).toBe(40);
  });

  it("shrinks to exactly the available length when too long, closed and open", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله الرحمن الرحيم");
    for (const d of [guidePathD("circle", { width: 80 }), guidePathD("line", { width: 120 })]) {
      const { t, closed } = table(d, false);
      const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach() })!;
      expect(r.shrink).toBeCloseTo(t.total / natural(glyphs, 40, upm), 6);
    }
  });

  it("puts the anchor at the text's start, middle or end", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم");
    const { t, closed } = table(guidePathD("line", { width: 1000 }), false);
    const L = natural(glyphs, 40, upm);
    const firstAt = (align: GuideAttachment["align"]) =>
      guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0.5, align }) })!
        .placements[0].x;
    // Line runs from x = -500 to 500; offset 0.5 is x = 0. Glyphs are laid
    // left to right, so Arabic *reads* from the right-hand end: "start" puts
    // the reading start (the right end) at the anchor, "end" the left end.
    expect(firstAt("start")).toBeCloseTo(-L, 1);
    expect(firstAt("center")).toBeCloseTo(-L / 2, 1);
    expect(firstAt("end")).toBeCloseTo(0, 1);
  });

  it("clamps the text inside an open guide", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله");
    const { t, closed } = table(guidePathD("line", { width: 1000 }), false);
    const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0, align: "center" }) })!;
    expect(r.placements[0].x).toBeCloseTo(-500, 1);
  });

  it("wraps across the seam of a closed guide, flipped or not", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم الله");
    for (const flip of [false, true]) {
      const { t, closed } = table(guidePathD("circle", { width: 600 }), flip);
      const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0, flip }) })!;
      // Consecutive glyphs stay close: no jump across the seam.
      for (let i = 1; i < r.placements.length; i++) {
        const a = r.placements[i - 1];
        const b = r.placements[i];
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(40);
      }
    }
  });

  it("keeps the same anchor point when flipped", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم");
    const d = guidePathD("circle", { width: 600 });
    const centre = (flip: boolean) => {
      const { t, closed } = table(d, flip);
      const r = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach({ offset: 0.5, flip }) })!;
      const xs = r.placements.map((p) => p.x);
      const ys = r.placements.map((p) => p.y);
      return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    };
    // Offset 0.5 on a top-start clockwise circle is the bottom: (0, 300).
    expect(centre(false).y).toBeGreaterThan(250);
    expect(centre(true).y).toBeGreaterThan(250);
    expect(Math.abs(centre(true).x)).toBeLessThan(60);
  });

  it("rises outside and hangs inside; flipped outside on the bottom hangs too", async () => {
    const { glyphs, upm, ascender } = await amiri("بسم");
    const { t, closed } = table(guidePathD("circle", { width: 600 }), false);
    const at = (a: Partial<GuideAttachment>) =>
      guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: t, closed, attachment: attach(a) })!.baselineOffset;
    expect(at({ side: "outside" })).toBeLessThanOrEqual(0);
    expect(at({ side: "inside" })).toBeGreaterThan(0);
    const { t: tf } = table(guidePathD("circle", { width: 600 }), true);
    const flipped = guideGlyphPlacements({ glyphs, fontSize: 40, unitsPerEm: upm, ascender, arcTable: tf, closed, attachment: attach({ side: "outside", flip: true }) })!;
    expect(flipped.baselineOffset).toBeGreaterThan(0);
  });

  it("returns null for empty text", () => {
    const { t, closed } = table(guidePathD("circle"), false);
    expect(guideGlyphPlacements({ glyphs: [], fontSize: 40, unitsPerEm: 1000, ascender: 800, arcTable: t, closed, attachment: attach() })).toBeNull();
  });
});

describe("projectToGuide", () => {
  it("finds the nearest point on a circle and an ellipse to within 0.5 px", () => {
    for (const d of [guidePathD("circle", { width: 300 }), guidePathD("ellipse", { width: 360, height: 200 })]) {
      const t = buildArcTable(parseSvgPath(d), false);
      for (const s of [0, 0.13, 0.5, 0.77, 0.99]) {
        const p = pointAtArcLengthFromTable(t, s * t.total);
        // Step off the curve along its normal: the nearest point is then p
        // itself (radial scaling only does that on a circle).
        const off = projectToGuide(t, { x: p.x - 3 * Math.sin(p.angle), y: p.y + 3 * Math.cos(p.angle) });
        const q = pointAtArcLengthFromTable(t, off * t.total);
        expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeLessThan(0.5);
      }
    }
  });
});

describe("guideInkBox", () => {
  it("reaches the font's full extent, not just one em, around every glyph", () => {
    const placements = [
      { glyphIndex: 0, x: 0, y: 0, angle: 0, size: 20 },
      { glyphIndex: 1, x: 30, y: 10, angle: 0, size: 20 },
    ];
    // FatemiMaqala-like: ink up to 1.77em above and 0.6em below the baseline.
    const box = guideInkBox(placements, 20, 2.37, -3);
    const reach = 20 * 2.37 + 3;
    expect(box.x).toBeCloseTo(-reach, 6);
    expect(box.y).toBeCloseTo(-reach, 6);
    expect(box.width).toBeCloseTo(30 + 2 * reach, 6);
    expect(box.height).toBeCloseTo(10 + 2 * reach, 6);
  });

  it("never reaches less than one em", () => {
    const box = guideInkBox([{ glyphIndex: 0, x: 0, y: 0, angle: 0, size: 10 }], 10, 0.5, 0);
    expect(box.width).toBeCloseTo(20, 6);
  });
});
