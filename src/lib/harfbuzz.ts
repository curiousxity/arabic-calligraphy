import * as hbjsModule from "harfbuzzjs";
// Use namespace import so Rolldown/Vite 8 (rolldown bundler) can resolve the
// CJS-wrapped opentype.js package without an explicit ESM entry point.
import * as opentype from "opentype.js";

// harfbuzzjs ships as CJS; Vite may wrap it so the callable is at .default
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hbjs: () => Promise<any> =
  typeof (hbjsModule as any).default === "function"
    ? (hbjsModule as any).default
    : (hbjsModule as any);

let hbPromise: Promise<any> | null = null;
const fontCache = new Map<string, ArrayBuffer>();
// opentype.Font is accessed as a type from the namespace import
const parsedFontCache = new Map<string, ReturnType<typeof opentype.parse>>();

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
  font: ReturnType<typeof opentype.parse>;
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

async function loadParsedFont(fontUrl: string): Promise<ReturnType<typeof opentype.parse>> {
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

  // Pass a copy so the WASM binding cannot detach the cached ArrayBuffer.
  const blob = hb.createBlob(fontData.slice(0));
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
