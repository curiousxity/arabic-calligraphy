import type { GlyphBounds } from "./warp";

export type { GlyphBounds };

export type ShapeWarpMode = "envelope" | "topBottom" | "stretch" | "radial";

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clampUnit(v: number) {
  return Math.max(-1, Math.min(1, v));
}

export function applyShapeWarpPoint(
  x: number,
  y: number,
  bounds: GlyphBounds,
  shapeW: number,
  shapeH: number,
  padding: number,
  mode: ShapeWarpMode,
  strength: number
) {
  const innerLeft = padding;
  const innerTop = padding;
  const innerW = Math.max(1, shapeW - padding * 2);
  const innerH = Math.max(1, shapeH - padding * 2);

  const nx = clamp01((x - bounds.minX) / Math.max(bounds.rawWidth, 1));
  const ny = clamp01((y - bounds.minY) / Math.max(bounds.rawHeight, 1));
  const ux = clampUnit(nx * 2 - 1);
  const uy = clampUnit(ny * 2 - 1);

  let px = innerLeft + nx * innerW;
  let py = innerTop + ny * innerH;

  if (mode === "stretch") {
    const yScale = 1 + strength * 0.35 * (1 - ux * ux);
    py = innerTop + ((ny - 0.5) * yScale + 0.5) * innerH;
  } else if (mode === "topBottom") {
    const bend = strength * 0.18 * (1 - ux * ux);
    const topPull = bend * innerH;
    const bottomPush = bend * innerH;
    py = innerTop + ny * innerH;
    py += (ny < 0.5 ? -topPull : bottomPush) * (1 - Math.abs(uy));
  } else if (mode === "radial") {
    const dx = ux;
    const dy = uy;
    const r = Math.sqrt(dx * dx + dy * dy) || 1;
    const bulge = 1 + strength * 0.22 * (1 - Math.min(1, r));
    const bx = dx * bulge;
    const by = dy * bulge;
    px = innerLeft + ((bx + 1) / 2) * innerW;
    py = innerTop + ((by + 1) / 2) * innerH;
  } else {
    const topArch = -strength * 0.18 * (1 - ux * ux) * innerH;
    const bottomArch = strength * 0.18 * (1 - ux * ux) * innerH;
    py = innerTop + ny * innerH + topArch * (1 - ny) + bottomArch * ny;
  }

  return { x: px, y: py };
}

/**
 * Inverse of applyShapeWarpPoint. None of the warp modes have a clean
 * closed-form inverse (stretch/topBottom/radial/envelope all fold the x-axis
 * position into the y-axis formula), so this solves numerically via Newton's
 * method with a finite-difference Jacobian — a few iterations converge well
 * within a pixel since the forward map is smooth and roughly linear locally.
 *
 * The Newton seed is deliberately NOT `(targetX, targetY)`. The target is in
 * shape space (`0..shapeW`, `0..shapeH`); the solver's unknowns are in
 * glyph-run space (`bounds.minX..maxX`, `bounds.minY..maxY`), and those two
 * ranges routinely have very different scale (e.g. an 820x90 glyph run
 * warped into a 400x400 shape). Seeding directly at the target lands the
 * initial guess far outside the glyph-bounds box, so `clamp01` inside
 * `applyShapeWarpPoint` saturates on iteration 0; once saturated, nudging y
 * by the finite-difference `eps` produces no change in `ny`, so both of the
 * Jacobian's y-derivatives come out exactly 0, `det` is exactly 0, and the
 * loop bails out immediately — returning the untouched, wrong seed. Seeding
 * instead at the inverse of the base (unwarped) affine map lands inside the
 * glyph-bounds box, keeping the Jacobian non-singular so Newton can actually
 * iterate. Do not "simplify" this back to `(targetX, targetY)`.
 */
export function invertShapeWarpPoint(
  targetX: number,
  targetY: number,
  bounds: GlyphBounds,
  shapeW: number,
  shapeH: number,
  padding: number,
  mode: ShapeWarpMode,
  strength: number
) {
  const innerW = Math.max(1, shapeW - padding * 2);
  const innerH = Math.max(1, shapeH - padding * 2);
  let x = bounds.minX + ((targetX - padding) / innerW) * Math.max(bounds.rawWidth, 1);
  let y = bounds.minY + ((targetY - padding) / innerH) * Math.max(bounds.rawHeight, 1);
  const eps = 1;

  for (let iter = 0; iter < 12; iter++) {
    const p = applyShapeWarpPoint(x, y, bounds, shapeW, shapeH, padding, mode, strength);
    const dx = targetX - p.x;
    const dy = targetY - p.y;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) break;

    const px = applyShapeWarpPoint(x + eps, y, bounds, shapeW, shapeH, padding, mode, strength);
    const py = applyShapeWarpPoint(x, y + eps, bounds, shapeW, shapeH, padding, mode, strength);

    const j11 = (px.x - p.x) / eps;
    const j21 = (px.y - p.y) / eps;
    const j12 = (py.x - p.x) / eps;
    const j22 = (py.y - p.y) / eps;

    const det = j11 * j22 - j12 * j21;
    if (Math.abs(det) < 1e-6) break;

    x += (dx * j22 - dy * j12) / det;
    y += (dy * j11 - dx * j21) / det;
  }

  return { x, y };
}
