import * as hbjsModule from "harfbuzzjs";
import * as opentype from "opentype.js";

type HbModule = {
  createBlob: (data: ArrayBuffer | Uint8Array) => any;
  createFace: (blob: any, index: number) => any;
  createFont: (face: any) => any;
  createBuffer: () => any;
  shape: (font: any, buffer: any, features?: string) => void;
};

const DEBUG_HB = true;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveHbLoader(mod: any): Promise<HbModule> | null {
  if (DEBUG_HB) console.log("harfbuzzjs raw module", mod);

  let m = mod;
  if (m?.default !== undefined) m = m.default;
  if (m?.default !== undefined) m = m.default;

  if (typeof m === "function") return m();
  if (m && typeof m.then === "function") return m;

  return null;
}

let hbPromise: Promise<HbModule> | null = null;

const fontDataCache = new Map<string, ArrayBuffer>();
const parsedFontCache = new Map<string, opentype.Font>();
const shapeCache = new Map<string, ShapedTextResult>();

export type HarfBuzzGlyph = {
  g: number;
  cl?: number;
  ax?: number;
  ay?: number;
  dx?: number;
  dy?: number;
};

export type ShapedTextResult = {
  glyphs: HarfBuzzGlyph[];
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

    hbPromise = loader.then((m: any) => {
      if (DEBUG_HB) {
        console.log("hb loaded", {
          keys: Object.keys(m || {}),
          hasCreateBlob: typeof m?.createBlob === "function",
          hasCreateBuffer: typeof m?.createBuffer === "function",
          hasShape: typeof m?.shape === "function",
        });
      }
      return m as HbModule;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeGlyphs(raw: any): HarfBuzzGlyph[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .filter((g) => g && typeof g.g === "number")
    .map((g) => ({
      g: typeof g.g === "number" ? g.g : 0,
      cl: typeof g.cl === "number" ? g.cl : 0,
      ax: typeof g.ax === "number" ? g.ax : 0,
      ay: typeof g.ay === "number" ? g.ay : 0,
      dx: typeof g.dx === "number" ? g.dx : 0,
      dy: typeof g.dy === "number" ? g.dy : 0,
    }));
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
  raw: any,
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

  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  try {
    if (typeof font.setScale === "function") {
      font.setScale(upm, upm);
    }

    buffer.addText(text);

    if (typeof buffer.guessSegmentProperties === "function") {
      buffer.guessSegmentProperties();
    }

    if (typeof buffer.setDirection === "function") buffer.setDirection("rtl");
    if (typeof buffer.setScript === "function") buffer.setScript("arab");
    if (typeof buffer.setLanguage === "function") buffer.setLanguage("ar");

    if (DEBUG_HB) {
      console.log("[HB] before shape", {
        text,
        fontUrl,
        upm,
        usingFeatures: false,
        features: null,
      });
    }

    hb.shape(font, buffer);

    let raw: any = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }

    const glyphs = normalizeGlyphs(raw);

    if (DEBUG_HB) {
      logShapingDebug(text, fontUrl, parsedFont, upm, raw, glyphs);
    }

    const result: ShapedTextResult = {
      glyphs,
      font: parsedFont,
      unitsPerEm: upm,
    };

    shapeCache.set(cacheKey, result);
    return result;
  } catch (err) {
    console.error("shapeText failed", { text, fontUrl, err });
    return {
      glyphs: [],
      font: parsedFont,
      unitsPerEm: upm,
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