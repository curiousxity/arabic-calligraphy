export type SilhouetteDrawer = (
  ctx: CanvasRenderingContext2D,
  offsetX: number,
  offsetY: number,
  fillColor: string
) => void;

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
 */
export function drawInsetBevel(
  mainCtx: CanvasRenderingContext2D,
  width: number,
  height: number,
  strength: number,
  highlightColor: string,
  shadowColor: string,
  drawSilhouette: SilhouetteDrawer
) {
  const w = Math.max(1, Math.ceil(width));
  const h = Math.max(1, Math.ceil(height));

  const paintBand = (color: string, punchOffsetX: number, punchOffsetY: number) => {
    const scratch = document.createElement("canvas");
    scratch.width = w;
    scratch.height = h;
    const scratchCtx = scratch.getContext("2d");
    if (!scratchCtx) return;

    drawSilhouette(scratchCtx, 0, 0, color);

    scratchCtx.globalCompositeOperation = "destination-out";
    drawSilhouette(scratchCtx, punchOffsetX, punchOffsetY, color);
    scratchCtx.globalCompositeOperation = "source-over";

    mainCtx.drawImage(scratch, 0, 0);
  };

  // Highlight: what's left of the silhouette once a copy shifted away from
  // the light (down-right) is subtracted — i.e. the edges facing the
  // light, top-left.
  paintBand(highlightColor, strength, strength);
  // Shadow: what's left once a copy shifted toward the light (up-left) is
  // subtracted — the edges facing away from the light, bottom-right.
  paintBand(shadowColor, -strength, -strength);
}
