/**
 * Lattice primitives for square Kufi: rotation, the 2x2 measures, 4-connectivity
 * and outline tracing. Pure — no React, no Konva, no `./harfbuzz` import.
 */

/** Quarter turns clockwise. */
export type Turn = 0 | 1 | 2 | 3;

/** `cells` is row-major, 1 = ink. */
export type Grid = { cols: number; rows: number; cells: Uint8Array };

/** Rotates ASCII rows (`#` = ink) by quarter turns clockwise. */
export function rotateRows(rows: string[], turn: Turn): string[] {
  let out = rows;
  for (let t = 0; t < turn; t++) {
    const h = out.length;
    const w = out[0]?.length ?? 0;
    const next: string[] = [];
    for (let c = 0; c < w; c++) {
      let line = "";
      for (let r = h - 1; r >= 0; r--) line += out[r][c];
      next.push(line);
    }
    out = next;
  }
  return out;
}

/** Top-left corners of every 2x2 block where all four cells equal `value`. */
function blocks2x2(grid: Grid, value: 0 | 1): Array<[col: number, row: number]> {
  const { cols, rows, cells } = grid;
  const out: Array<[number, number]> = [];
  for (let r = 0; r + 1 < rows; r++) {
    for (let c = 0; c + 1 < cols; c++) {
      const i = r * cols + c;
      if (
        cells[i] === value &&
        cells[i + 1] === value &&
        cells[i + cols] === value &&
        cells[i + cols + 1] === value
      ) {
        out.push([c, r]);
      }
    }
  }
  return out;
}

/** Solid 2x2 ink blocks: strokes thicker than one cell. */
export function inkBlocks2x2(grid: Grid): Array<[col: number, row: number]> {
  return blocks2x2(grid, 1);
}

/** Empty 2x2 blocks. None means no hole is wider than a gap: the "packed" measure. */
export function emptyBlocks2x2(grid: Grid): Array<[col: number, row: number]> {
  return blocks2x2(grid, 0);
}

/** True when all ink (`#`) is one 4-connected component; diagonal contact does not join. */
export function isConnected4(rows: string[]): boolean {
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const ink = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && rows[y][x] === "#";
  let start: [number, number] | null = null;
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!ink(x, y)) continue;
      total++;
      start ??= [x, y];
    }
  }
  if (!start) return true;

  const seen = new Set<number>([start[1] * w + start[0]]);
  const stack: Array<[number, number]> = [start];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!ink(nx, ny) || seen.has(ny * w + nx)) continue;
      seen.add(ny * w + nx);
      stack.push([nx, ny]);
    }
  }
  return seen.size === total;
}

// ---------------------------------------------------------------------------
// Outline tracing
// ---------------------------------------------------------------------------

export type Ring = [number, number][];

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The boundary of a cell grid, as closed rings in cell coordinates.
 *
 * Each filled cell contributes the edges it does not share with another filled
 * cell, wound so that the material is always on the edge's right in screen
 * coordinates (y down). Outer rings therefore come out clockwise and holes
 * counter-clockwise, which is what lets the renderer fill with plain nonzero
 * winding and get the counters of ه and ص for free.
 *
 * Collinear points are collapsed, so a straight run of thirty cells is two
 * points rather than thirty-one — worth doing here rather than in the
 * renderer, since the SVG export path serializes whatever it is handed.
 */
export function cellRings(cells: boolean[], cols: number, rows: number): Ring[] {
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && cells[y * cols + x];

  // start point -> the ends of every boundary edge leaving it
  const outgoing = new Map<string, [number, number][]>();
  const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = outgoing.get(k);
    if (list) list.push([x1, y1]);
    else outgoing.set(k, [[x1, y1]]);
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!filled(x, y)) continue;
      if (!filled(x, y - 1)) addEdge(x, y, x + 1, y);
      if (!filled(x + 1, y)) addEdge(x + 1, y, x + 1, y + 1);
      if (!filled(x, y + 1)) addEdge(x + 1, y + 1, x, y + 1);
      if (!filled(x - 1, y)) addEdge(x, y + 1, x, y);
    }
  }

  const rings: Ring[] = [];

  for (const [startKey, ends] of outgoing) {
    while (ends.length > 0) {
      const [sx, sy] = startKey.split(",").map(Number);
      const ring: Ring = [[sx, sy]];
      let cx = sx;
      let cy = sy;
      let dx = 0;
      let dy = 0;
      let guard = cols * rows * 8 + 16;

      while (guard-- > 0) {
        const list = outgoing.get(key(cx, cy));
        if (!list || list.length === 0) break;

        // At a diagonal pinch a vertex has two ways out. Continuing straight,
        // then turning clockwise, keeps the traversal hugging the component it
        // arrived on instead of hopping to the one that merely touches it.
        let pick = 0;
        if (list.length > 1 && (dx !== 0 || dy !== 0)) {
          const straight = list.findIndex(([ex, ey]) => ex - cx === dx && ey - cy === dy);
          const right = list.findIndex(([ex, ey]) => ex - cx === -dy && ey - cy === dx);
          pick = straight >= 0 ? straight : right >= 0 ? right : 0;
        }
        const [nx, ny] = list.splice(pick, 1)[0];
        dx = Math.sign(nx - cx);
        dy = Math.sign(ny - cy);
        cx = nx;
        cy = ny;
        if (cx === sx && cy === sy) break;
        ring.push([cx, cy]);
      }

      if (ring.length >= 4) rings.push(simplifyRing(ring));
    }
  }

  return rings;
}

/** Drops the interior point of any three collinear points, wrapping around. */
function simplifyRing(ring: Ring): Ring {
  const out: Ring = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [px, py] = ring[(i - 1 + n) % n];
    const [x, y] = ring[i];
    const [qx, qy] = ring[(i + 1) % n];
    const collinear = (x - px) * (qy - y) === (y - py) * (qx - x);
    if (!collinear) out.push([x, y]);
  }
  return out.length >= 4 ? out : ring;
}
