import * as hbjsModule from "harfbuzzjs";
import opentype from "opentype.js";

// harfbuzzjs ships as CJS; Vite may wrap it so the callable is at .default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hbjs: () => Promise<any> =
  typeof (hbjsModule as any).default === "function"
    ? (hbjsModule as any).default
    : (hbjsModule as any);

let hbPromise: Promise<any> | null = null;
const fontCache = new Map<string, ArrayBuffer>();
const parsedFontCache = new Map<string, opentype.Font>();

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

export async function initHarfBuzz() {
  if (!hbPromise) {
    hbPromise = hbjs();
  }
  return hbPromise;
}

async function loadFontData(fontUrl: string): Promise<ArrayBuffer> {
  if (!fontCache.has(fontUrl)) {
    const data = await fetch(fontUrl).then((r) => r.arrayBuffer());
    fontCache.set(fontUrl, data);
  }
  return fontCache.get(fontUrl)!;
}

async function loadParsedFont(fontUrl: string): Promise<opentype.Font> {
  if (!parsedFontCache.has(fontUrl)) {
    const fontData = await loadFontData(fontUrl);
    const parsed = opentype.parse(fontData.slice(0));
    parsedFontCache.set(fontUrl, parsed);
  }
  return parsedFontCache.get(fontUrl)!;
}

export async function shapeText(
  text: string,
  fontUrl: string
): Promise<ShapedTextResult> {
  const hb = await initHarfBuzz();
  const fontData = await loadFontData(fontUrl);
  const parsedFont = await loadParsedFont(fontUrl);

  const blob = hb.createBlob(fontData);
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  buffer.addText(text);
  buffer.guessSegmentProperties();
  hb.shape(font, buffer, []);

  const glyphs = buffer.json() as HarfBuzzGlyph[];

  buffer.destroy?.();
  font.destroy?.();
  face.destroy?.();
  blob.destroy?.();

  return {
    glyphs,
    font: parsedFont,
    unitsPerEm: parsedFont.unitsPerEm || 1000,
  };
}
