/**
 * The page-surface registry, plus the one impure thing this folder does:
 * turning a `TextureDef` into a tile image the canvas can repeat.
 *
 * The glob is eager and dropping a module into `defs/` is the entire
 * integration step — the same convention `lib/ornaments.ts` and the guide's
 * section registry already use, and for the same reason: there is no list to
 * forget to update. Anything in `defs/` that does not default-export a
 * well-formed texture is skipped rather than trusted.
 */
import type { TextureDef } from "./types";

export type { TextureDef } from "./types";

// `defs/` is a folder of its own so the glob cannot pick up this registry
// (a self-import cycle), the shared helpers, or the test file beside them.
const modules = import.meta.glob<{ default?: TextureDef }>("./defs/*.ts", { eager: true });

function isTextureDef(value: unknown): value is TextureDef {
  const t = value as TextureDef | undefined;
  return (
    !!t &&
    typeof t.id === "string" &&
    typeof t.name === "string" &&
    typeof t.size === "number" &&
    typeof t.grain === "function"
  );
}

export const TEXTURES: TextureDef[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path]?.default)
  .filter(isTextureDef);

export function getTexture(id: string | null | undefined): TextureDef | null {
  if (!id) return null;
  return TEXTURES.find((t) => t.id === id) ?? null;
}

/**
 * The page's paper, as the document stores it. Separate from `ArtboardConfig`
 * because a surface applies to a freeform canvas too — it describes the look
 * of the page, not the existence of one.
 */
export type ArtboardSurface = {
  /** `null` is bare paper: the flat background colour, as before surfaces. */
  textureId: string | null;
  /** Overrides the texture's own default paper colour. */
  tint?: string;
};

export const NO_SURFACE: ArtboardSurface = { textureId: null };

/** Tolerant read of a saved payload's surface — anything malformed is bare. */
export function readArtboardSurface(value: unknown): ArtboardSurface {
  const v = value as ArtboardSurface | undefined;
  if (!v || typeof v !== "object") return NO_SURFACE;
  const textureId = typeof v.textureId === "string" && getTexture(v.textureId) ? v.textureId : null;
  const tint = typeof v.tint === "string" ? v.tint : undefined;
  return tint ? { textureId, tint } : { textureId };
}

/* ------------------------------------------------------------------ *
 * Rasterizing a tile
 * ------------------------------------------------------------------ */

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [244, 236, 216];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp255 = (n: number) => (n < 0 ? 0 : n > 255 ? 255 : n | 0);

/**
 * Paint one tile of `def` over `tint`.
 *
 * The tint is baked into the pixels rather than layered under them: Konva's
 * `fillPriority` picks *either* a colour or a pattern for a shape, never both,
 * so the page rect can only carry the pattern and the paper colour has to be
 * in it already.
 */
export function renderTextureTile(def: TextureDef, tint: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = def.size;
  canvas.height = def.size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const [r, g, b] = parseHex(tint || def.defaultTint);
  const image = ctx.createImageData(def.size, def.size);
  const data = image.data;
  for (let y = 0; y < def.size; y++) {
    for (let x = 0; x < def.size; x++) {
      const k = def.grain(x / def.size, y / def.size);
      // Lighten toward white, darken toward black — a plain multiply crushes
      // a dark tint to mud and leaves a pale one barely textured.
      const mix = (c: number) => (k >= 0 ? c + (255 - c) * k : c * (1 + k));
      const i = (y * def.size + x) * 4;
      data[i] = clamp255(mix(r));
      data[i + 1] = clamp255(mix(g));
      data[i + 2] = clamp255(mix(b));
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

const urlCache = new Map<string, string>();

/** Cached data URL for a tile — generation is ~65k `grain` calls. */
export function textureTileUrl(def: TextureDef, tint: string): string {
  const key = `${def.id}|${tint}`;
  const hit = urlCache.get(key);
  if (hit) return hit;
  const url = renderTextureTile(def, tint).toDataURL("image/png");
  urlCache.set(key, url);
  return url;
}
