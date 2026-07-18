export type GlyphBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  rawWidth: number;
  rawHeight: number;
};

function clampUnit(value: number) {
  return Math.max(-1, Math.min(1, value));
}

// Block-level warp used by the ShapedText warpX/warpY sliders.
export function warpPoint(
  x: number,
  y: number,
  bounds: GlyphBounds,
  width: number,
  height: number,
  warpX: number,
  warpY: number
) {
  const nx = clampUnit(((x - bounds.minX) / width) * 2 - 1);
  const ny = clampUnit(((y - bounds.minY) / height) * 2 - 1);

  const wx = warpX / 100;
  const wy = warpY / 100;

  return {
    x: x + wx * ny * width * 0.25,
    y: y - wy * (1 - nx * nx) * height * 0.5,
  };
}
