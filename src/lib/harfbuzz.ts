import * as hbjsModule from "harfbuzzjs";
import * as opentype from "opentype.js";
import {
  normalizeGlyphs,
  type HbRawGlyph,
  type HarfBuzzGlyph,
} from "./normalizeGlyphs";
import { ARABIC_DIACRITIC_RE } from "./diacritics";
import type { GlyphAlternate } from "../types";
import {
  alternatesKey,
  fallbackFeatureLabel,
  featureStringFor,
  isOptionalFeature,
  probeAlternates,
  type LetterAlternates,
} from "./glyphAlternates";
import { readFeatureNames } from "./fontFeatureNames";

export { normalizeGlyphs, type HbRawGlyph, type HarfBuzzGlyph };

type HbBlob = {
  destroy?: () => void;
};

type HbFace = {
  getTableFeatureTags?: (table: string) => string[];
  destroy?: () => void;
};

type HbFont = {
  setScale?: (x: number, y: number) => void;
  destroy?: () => void;
};

type HbBuffer = {
  addText: (text: string) => void;
  guessSegmentProperties?: () => void;
  setDirection?: (direction: string) => void;
  setScript?: (script: string) => void;
  setLanguage?: (language: string) => void;
  json?: (font?: HbFont) => HbRawGlyph[];
  destroy?: () => void;
};

type HbModule = {
  createBlob: (data: ArrayBuffer | Uint8Array) => HbBlob;
  createFace: (blob: HbBlob, index: number) => HbFace;
  createFont: (face: HbFace) => HbFont;
  createBuffer: () => HbBuffer;
  shape: (font: HbFont, buffer: HbBuffer, features?: string) => void;
};

const DEBUG_HB = import.meta.env.DEV;

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : null;

function resolveHbLoader(mod: unknown): Promise<HbModule> | null {
  if (DEBUG_HB) console.log("harfbuzzjs raw module", mod);

  let m: unknown = mod;
  let rec = asRecord(m);
  if (rec?.default !== undefined) m = rec.default;
  rec = asRecord(m);
  if (rec?.default !== undefined) m = rec.default;

  if (typeof m === "function") {
    return (m as () => Promise<HbModule> | HbModule)() as Promise<HbModule>;
  }

  rec = asRecord(m);
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;

  return null;
}

let hbPromise: Promise<HbModule> | null = null;

const fontDataCache = new Map<string, ArrayBuffer>();
const parsedFontCache = new Map<string, opentype.Font>();
/** fontUrl → (text|alternatesKey → result). Per-font so a font swap clears exactly its own entries. */
const shapeCache = new Map<string, Map<string, ShapedTextResult>>();
const alternatesCache = new Map<string, Map<string, AlternatesResult>>();

function cacheFor<T>(root: Map<string, Map<string, T>>, fontUrl: string): Map<string, T> {
  let inner = root.get(fontUrl);
  if (!inner) {
    inner = new Map();
    root.set(fontUrl, inner);
  }
  return inner;
}

export type ShapedTextResult = {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  unitsPerEm: number;
  /** The text actually shaped (after stripUnsupportedDiacritics) — `glyph.cl` cluster offsets index into THIS string, not the original input. */
  shapableText: string;
};

export type AlternatesResult = {
  letters: LetterAlternates[];
  /** Whether the font has any optional alternate feature at all. */
  fontHasAlternates: boolean;
  font: opentype.Font;
  unitsPerEm: number;
};

export async function initHarfBuzz(): Promise<HbModule> {
  if (!hbPromise) {
    const loader = resolveHbLoader(hbjsModule);

    if (!loader) {
      console.error("harfbuzzjs: could not resolve loader", hbjsModule);
      throw new Error("Unable to initialize harfbuzzjs");
    }

    hbPromise = loader.then((m) => {
      if (DEBUG_HB) {
        console.log("hb loaded", {
          keys: Object.keys(m || {}),
          hasCreateBlob: typeof m?.createBlob === "function",
          hasCreateBuffer: typeof m?.createBuffer === "function",
          hasShape: typeof m?.shape === "function",
        });
      }
      return m;
    });
  }

  return hbPromise;
}

async function loadFontData(fontUrl: string): Promise<ArrayBuffer> {
  if (!fontDataCache.has(fontUrl)) {
    const res = await fetch(fontUrl);
    if (!res.ok) {
      throw new Error(`Failed to load font: ${fontUrl} (${res.status})`);
    }
    fontDataCache.set(fontUrl, await res.arrayBuffer());
  }
  return fontDataCache.get(fontUrl)!;
}

async function loadParsedFont(fontUrl: string): Promise<opentype.Font> {
  if (!parsedFontCache.has(fontUrl)) {
    const data = await loadFontData(fontUrl);
    const font = opentype.parse(data.slice(0));
    parsedFontCache.set(fontUrl, font);
  }
  return parsedFontCache.get(fontUrl)!;
}

// Arabic combining marks: harakat, tanween, sukun, shadda, Quranic annotation
// signs, etc. Lives in `diacritics.ts` (a dependency-free module - no
// harfbuzzjs import) so it, and anything built on it, stays importable
// without dragging in the `import * as hbjsModule from "harfbuzzjs"` line
// below, which throws under Vitest's Node ESM loader the moment this
// module is evaluated (before any code in it runs) unless harfbuzzjs is
// mocked. Re-exported here for backward compatibility - this file is
// still the conceptual owner of "what counts as an Arabic diacritic" for
// shaping purposes; see `diacritics.ts` for the regex itself and its
// U+ range documentation.
export { ARABIC_DIACRITIC_RE };

function stripUnsupportedDiacritics(text: string, font: opentype.Font): string {
  let result = "";
  for (const ch of text) {
    if (ARABIC_DIACRITIC_RE.test(ch) && !font.charToGlyphIndex(ch)) {
      continue;
    }
    result += ch;
  }
  return result;
}

function textToCodepoints(text: string) {
  return Array.from(text).map((ch, index) => ({
    index,
    char: ch,
    codepoint: `U+${ch.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
  }));
}

function describeGlyph(font: opentype.Font, glyphId: number) {
  try {
    const glyph = font.glyphs.get(glyphId);
    if (!glyph) {
      return {
        glyphId,
        name: "(missing)",
        unicode: null,
        unicodes: [],
        advanceWidth: null,
      };
    }

    return {
      glyphId,
      name: glyph.name ?? "(unnamed)",
      unicode:
        typeof glyph.unicode === "number"
          ? `U+${glyph.unicode.toString(16).toUpperCase().padStart(4, "0")}`
          : null,
      unicodes: Array.isArray(glyph.unicodes)
        ? glyph.unicodes.map((u) => `U+${u.toString(16).toUpperCase().padStart(4, "0")}`)
        : [],
      advanceWidth:
        typeof glyph.advanceWidth === "number" ? glyph.advanceWidth : null,
    };
  } catch (err) {
    return {
      glyphId,
      name: "(error reading glyph)",
      unicode: null,
      unicodes: [],
      advanceWidth: null,
      err,
    };
  }
}

function logShapingDebug(
  text: string,
  fontUrl: string,
  parsedFont: opentype.Font,
  upm: number,
  raw: HbRawGlyph[] | string,
  glyphs: HarfBuzzGlyph[]
) {
  const cps = textToCodepoints(text);
  const glyphDetails = glyphs.map((g, i) => {
    const meta = describeGlyph(parsedFont, g.g);
    return {
      i,
      glyphId: g.g,
      glyphName: meta.name,
      glyphUnicode: meta.unicode,
      glyphUnicodes: meta.unicodes.join(", "),
      cluster: g.cl ?? 0,
      ax: g.ax ?? 0,
      ay: g.ay ?? 0,
      dx: g.dx ?? 0,
      dy: g.dy ?? 0,
      advanceWidth: meta.advanceWidth,
    };
  });

  console.groupCollapsed(
    `[HB] shapeText "${text}" | glyphs=${glyphs.length} | font=${fontUrl}`
  );
  console.log("Input text:", text);
  console.table(cps);
  console.log("Font URL:", fontUrl);
  console.log("unitsPerEm:", upm);
  console.log("Raw HarfBuzz JSON:", raw);
  console.log("Normalized glyphs:", glyphs);
  console.table(glyphDetails);
  console.groupEnd();
}

/** One shaping pass on an already-open font; owns and frees its buffer. */
function shapeOnFont(hb: HbModule, font: HbFont, text: string, features: string): HarfBuzzGlyph[] {
  const buffer = hb.createBuffer();
  try {
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    buffer.setLanguage?.("ar");
    hb.shape(font, buffer, features || undefined);
    let raw: HbRawGlyph[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }
    return normalizeGlyphs(raw);
  } finally {
    buffer.destroy?.();
  }
}

export async function shapeText(
  text: string,
  fontUrl: string,
  alternates?: readonly GlyphAlternate[]
): Promise<ShapedTextResult> {
  const cache = cacheFor(shapeCache, fontUrl);
  const cacheKey = `${text}|${alternatesKey(alternates)}`;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey)!;
    if (DEBUG_HB) {
      console.log(`[HB] cache hit for "${text}"`, {
        fontUrl,
        glyphCount: cached.glyphs.length,
      });
      logShapingDebug(
        text,
        fontUrl,
        cached.font,
        cached.unitsPerEm,
        "(cached result - raw unavailable)",
        cached.glyphs
      );
    }
    return cached;
  }

  const [hb, fontData, parsedFont] = await Promise.all([
    initHarfBuzz(),
    loadFontData(fontUrl),
    loadParsedFont(fontUrl),
  ]);

  const upm = parsedFont.unitsPerEm || 1000;
  const shapableText = stripUnsupportedDiacritics(text, parsedFont);

  // An empty buffer has no shaping result to serialize: `buffer.json()`
  // returns an empty string and the JSON parse behind it throws
  // "Unexpected end of JSON input". Both the primary and the fallback call
  // throw, so it used to reach the outer catch and log a console error
  // every time a user cleared the Content textarea — noisy, and it kept the
  // e2e "no console errors" assertion pinned to the boot test. Empty text
  // has no glyphs by definition, so answer that directly and never build
  // the HarfBuzz objects at all.
  if (shapableText.length === 0) {
    const empty: ShapedTextResult = {
      glyphs: [],
      font: parsedFont,
      unitsPerEm: upm,
      shapableText,
    };
    cache.set(cacheKey, empty);
    return empty;
  }

  // Built against the *shapable* text: HarfBuzz clusters index it, and a
  // letter ordinal skips marks, so stripping cannot shift a letter.
  const features = featureStringFor(shapableText, alternates);

  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);

  try {
    if (typeof font.setScale === "function") {
      font.setScale(upm, upm);
    }

    if (DEBUG_HB) {
      console.log("[HB] before shape", {
        text,
        shapableText,
        fontUrl,
        upm,
        usingFeatures: features !== "",
        features,
      });
    }

    const glyphs = shapeOnFont(hb, font, shapableText, features);

    if (DEBUG_HB) {
      logShapingDebug(shapableText, fontUrl, parsedFont, upm, "(raw unavailable)", glyphs);
    }

    const result: ShapedTextResult = {
      glyphs,
      font: parsedFont,
      unitsPerEm: upm,
      shapableText,
    };

    cache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("shapeText failed", { text, fontUrl, err });
    return {
      glyphs: [],
      font: parsedFont,
      unitsPerEm: upm,
      shapableText,
    };
  } finally {
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

/**
 * Next Shape's discovery: every letter's alternate shapes in this font, with
 * the other letters' current alternates applied. Opens the font once for the
 * whole probe (dozens to hundreds of shaping passes on a short run).
 */
export async function findAlternates(
  text: string,
  fontUrl: string,
  alternates?: readonly GlyphAlternate[]
): Promise<AlternatesResult> {
  const cache = cacheFor(alternatesCache, fontUrl);
  const cacheKey = `${text}|${alternatesKey(alternates)}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const [hb, fontData, parsedFont] = await Promise.all([
    initHarfBuzz(),
    loadFontData(fontUrl),
    loadParsedFont(fontUrl),
  ]);
  const upm = parsedFont.unitsPerEm || 1000;
  const shapableText = stripUnsupportedDiacritics(text, parsedFont);

  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  try {
    font.setScale?.(upm, upm);
    const tags = face.getTableFeatureTags?.("GSUB") ?? [];
    const names = readFeatureNames(fontData);
    const letters =
      shapableText.length === 0
        ? []
        : probeAlternates({
            text: shapableText,
            alternates,
            tags,
            shape: (features) => shapeOnFont(hb, font, shapableText, features),
            labelFor: (c) => names.get(c.feature) ?? fallbackFeatureLabel(c),
          });
    const result: AlternatesResult = {
      letters,
      fontHasAlternates: tags.some(isOptionalFeature),
      font: parsedFont,
      unitsPerEm: upm,
    };
    cache.set(cacheKey, result);
    return result;
  } finally {
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

export function clearShapeCache(fontUrl?: string): void {
  if (fontUrl) {
    shapeCache.delete(fontUrl);
    alternatesCache.delete(fontUrl);
    fontDataCache.delete(fontUrl);
    parsedFontCache.delete(fontUrl);
  } else {
    shapeCache.clear();
    alternatesCache.clear();
    fontDataCache.clear();
    parsedFontCache.clear();
  }

  if (DEBUG_HB) {
    console.log("[HB] cache cleared", { fontUrl: fontUrl ?? "(all)" });
  }
}
