export type HbRawGlyph = {
  g?: number;
  cl?: number;
  ax?: number;
  ay?: number;
  dx?: number;
  dy?: number;
};

export type HarfBuzzGlyph = {
  g: number;
  cl?: number;
  ax?: number;
  ay?: number;
  dx?: number;
  dy?: number;
};

export function normalizeGlyphs(raw: HbRawGlyph[]): HarfBuzzGlyph[] {
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
