import * as hbjsModule from "harfbuzzjs";
import * as opentype from "opentype.js";
import {
  normalizeGlyphs,
  type HbRawGlyph,
  type HarfBuzzGlyph,
} from "./normalizeGlyphs";

export { normalizeGlyphs, type HbRawGlyph, type HarfBuzzGlyph };

type HbBlob = {
  destroy?: () => void;
};

type HbFace = {
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
const shapeCache = new Map<string, ShapedTextResult>();

export type ShapedTextResult = {
  glyphs: HarfBuzzGlyph[];
  font: opentype.Font;
  unitsPerEm: number;
  /** The text actually shaped (after stripUnsupportedDiacritics) — `glyph.cl` cluster offsets index into THIS string, not the original input. */
  shapableText: string;
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
// signs, etc. (U+0610-061A, U+064B-065F, U+0670, U+06D6-06DC, U+06DF-06E4,
// U+06E7-06E8, U+06EA-06ED). Fonts (e.g. Qahiri) that ship no glyphs for
// these render them as .notdef boxes via HarfBuzz's normal missing-glyph
// fallback, which looks like broken/garbled text. Since these are optional
// pronunciation marks, silently drop the ones the loaded font can't render
// instead of shaping them into visible tofu.
export const ARABIC_DIACRITIC_RE =
  /[ؐ-ًؚ-ٰٟۖ-ۜ۟-۪ۤۧۨ-ۭ]/;

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

export async function shapeText(
  text: string,
  fontUrl: string
): Promise<ShapedTextResult> {
  const cacheKey = `${text}|${fontUrl}`;
  if (shapeCache.has(cacheKey)) {
    const cached = shapeCache.get(cacheKey)!;
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

  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  try {
    if (typeof font.setScale === "function") {
      font.setScale(upm, upm);
    }

    buffer.addText(shapableText);

    if (typeof buffer.guessSegmentProperties === "function") {
      buffer.guessSegmentProperties();
    }

    if (typeof buffer.setDirection === "function") buffer.setDirection("rtl");
    if (typeof buffer.setScript === "function") buffer.setScript("arab");
    if (typeof buffer.setLanguage === "function") buffer.setLanguage("ar");

    if (DEBUG_HB) {
      console.log("[HB] before shape", {
        text,
        shapableText,
        fontUrl,
        upm,
        usingFeatures: false,
        features: null,
      });
    }

    hb.shape(font, buffer);

    let raw: HbRawGlyph[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }

    const glyphs = normalizeGlyphs(raw);

    if (DEBUG_HB) {
      logShapingDebug(shapableText, fontUrl, parsedFont, upm, raw, glyphs);
    }

    const result: ShapedTextResult = {
      glyphs,
      font: parsedFont,
      unitsPerEm: upm,
      shapableText,
    };

    shapeCache.set(cacheKey, result);
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
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

export function clearShapeCache(fontUrl?: string): void {
  if (fontUrl) {
    for (const key of shapeCache.keys()) {
      if (key.endsWith(`|${fontUrl}`)) {
        shapeCache.delete(key);
      }
    }
    fontDataCache.delete(fontUrl);
    parsedFontCache.delete(fontUrl);
  } else {
    shapeCache.clear();
    fontDataCache.clear();
    parsedFontCache.clear();
  }

  if (DEBUG_HB) {
    console.log("[HB] cache cleared", { fontUrl: fontUrl ?? "(all)" });
  }
}
