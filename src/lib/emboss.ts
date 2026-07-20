export type SilhouetteDrawer = (
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  fillColor: string
) => void;

/**
 * The Strength slider exposes a friendlier 0-5 range; callers multiply the
 * raw block value by this before passing it in as `strength` (actual bevel
 * band width in pixels) so the top of that shorter slider still reaches a
 * visible bevel instead of a barely-there 5px one.
 */
export const EMBOSS_STRENGTH_SCALE = 2;

/**
 * Paints a directional inset bevel — a highlight band along the edges
 * facing the light (top-left) and a shadow band along the opposite edges
 * (bottom-right), both confined inside the already-filled silhouette —
 * approximating the "inner shadow" bevel look design tools use for
 * embossed/3D text, rather than the flat drop-shadow-behind-the-glyph look
 * of a plain offset copy.
 *
 * `drawSilhouette` must paint the same filled shape the caller's normal
 * fill pass paints, offset by (offsetX, offsetY), in `fillColor`. It always
 * runs against a fresh transparent offscreen canvas (never `mainCtx`
 * itself), so the destination-out punch used to carve out the band can
 * never erase pixels belonging to sibling shapes sharing the real Konva
 * layer canvas.
 *
 * The bevel bands are rasterized to that offscreen canvas (for the
 * destination-out isolation above), so unlike the rest of the glyph
 * rendering — plain vector fills that Konva always redraws crisp at
 * whatever zoom/DPI is current — this raster would look blocky under
 * magnification unless it's rendered at matching resolution. `resolutionScale`
 * (device pixel ratio × current absolute node scale, i.e. Konva zoom) sizes
 * the scratch canvas in physical pixels and scales drawing into it to match,
 * then downsamples the destination rect back to logical size so the caller's
 * own already-scaled `mainCtx` transform blows it back up 1:1 — crisp at any
 * zoom level or export resolution instead of a fixed low-res bitmap.
 */
export function drawInsetBevel(
  mainCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
  highlightColor: string,
  shadowColor: string,
  drawSilhouette: SilhouetteDrawer,
  resolutionScale: number = 1
) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));
  const scale = Math.max(1, resolutionScale);
  const scaledW = Math.max(1, Math.ceil(w * scale));
  const scaledH = Math.max(1, Math.ceil(h * scale));

  const paintBand = (color: string, punchOffsetX: number, punchOffsetY: number) => {
    const scratch = document.createElement("canvas");
    scratch.width = scaledW;
    scratch.height = scaledH;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return;

    scratchCtx.scale(scale, scale);

    drawSilhouette(scratchCtx, 0, 0, color);

    scratchCtx.globalCompositeOperation = "destination-out";
    drawSilhouette(scratchCtx, punchOffsetX, punchOffsetY, color);
    scratchCtx.globalCompositeOperation = "source-over";

    mainCtx.drawImage(scratch, 0, 0, scaledW, scaledH, 0, 0, w, h);
  };

  // Highlight: what's left of the silhouette once a copy shifted away from
  // the light (down-right) is subtracted — i.e. the edges facing the
  // light, top-left.
  paintBand(highlightColor, strength, strength);
  // Shadow: what's left once a copy shifted toward the light (up-left) is
  // subtracted — the edges facing away from the light, bottom-right.
  paintBand(shadowColor, -strength, -strength);
}
