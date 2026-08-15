/**
 * Tileable noise, the whole basis of the paper surfaces in this folder.
 *
 * Everything here is *generated*, never sampled from a photograph: a texture
 * of unknown provenance is a licensing problem that cannot be undone once it
 * ships inside exported artwork. It also keeps the repo weight at zero — a
 * tile is a few dozen lines of arithmetic rather than a bitmap.
 *
 * "Tileable" is load-bearing. The surface is drawn as a Konva repeating
 * pattern, so any noise whose lattice does not wrap at the tile edge shows a
 * visible grid across the page. Every function here therefore takes the
 * lattice size it must wrap at and does its own modulo.
 */

/** Deterministic hash of two lattice coordinates → [0, 1). */
export function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * Value noise on a `gridX × gridY` lattice that wraps, sampled at (u, v) in
 * tile-relative [0, 1) coordinates.
 *
 * The two grids are separate so a texture can stretch its features along one
 * axis — fibres rather than specks. Doing that by scaling the *coordinate*
 * instead is the obvious-looking mistake: it moves the lattice out of phase
 * with the tile and the repeat becomes visible.
 */
export function tileNoise(
  u: number,
  v: number,
  gridX: number,
  gridY: number,
  seed: number
): number {
  const x = u * gridX;
  const y = v * gridY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smooth(x - x0);
  const fy = smooth(y - y0);
  const wrapX = (n: number) => ((n % gridX) + gridX) % gridX;
  const wrapY = (n: number) => ((n % gridY) + gridY) % gridY;
  const xa = wrapX(x0);
  const xb = wrapX(x0 + 1);
  const ya = wrapY(y0);
  const yb = wrapY(y0 + 1);
  const n00 = hash2(xa, ya, seed);
  const n10 = hash2(xb, ya, seed);
  const n01 = hash2(xa, yb, seed);
  const n11 = hash2(xb, yb, seed);
  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

/** Summed octaves of `tileNoise`, each wrapping at its own lattice. */
export function tileFbm(
  u: number,
  v: number,
  baseGrid: number,
  octaves: number,
  seed: number,
  baseGridY = baseGrid
): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    const f = 2 ** o;
    sum += amp * tileNoise(u, v, baseGrid * f, baseGridY * f, seed + o * 101);
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Sparse round specks — the fibre flecks that make a sheet read as handmade
 * paper rather than as a gradient. Returns 0 outside every fleck.
 */
export function tileSpeckle(
  u: number,
  v: number,
  cells: number,
  radius: number,
  density: number,
  seed: number
): number {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let best = 0;
  // The neighbouring cells matter: a fleck near a cell border overlaps into
  // the next one, and skipping them clips flecks along every cell edge.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx;
      const gy = cy + dy;
      const wx = ((gx % cells) + cells) % cells;
      const wy = ((gy % cells) + cells) % cells;
      if (hash2(wx, wy, seed) > density) continue;
      const px = gx + hash2(wx, wy, seed + 7);
      const py = gy + hash2(wx, wy, seed + 13);
      const d = Math.hypot(x - px, y - py) / radius;
      if (d < 1) best = Math.max(best, 1 - d * d);
    }
  }
  return best;
}
