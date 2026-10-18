/**
 * The open window inside a frame mark: the largest axis-aligned rectangle
 * that lies inside the frame's convex hull and touches no ink. Text placed in
 * a frame is fitted to this window, so a frame never covers its own text and
 * any new frame shape works with no per-frame setting. Pure; library units
 * (the outline's own coordinates, centred on the origin). See
 * .claude/rules/marks.md.
 */
import { flattenContours } from "./strokeCuts";
import { parseSvgPath, pointInPolygon } from "./svgPath";

export type FrameWindow = { x: number; y: number; w: number; h: number };

/** Grid cells along the frame's long side. */
const GRID = 120;

function convexHull(pts: [number, number][]): [number, number][] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function frameWindow(d: string): FrameWindow | null {
  const contours = flattenContours(parseSvgPath(d)).filter((c) => c.length >= 3) as [number, number][][];
  const all = contours.flat();
  if (all.length < 3) return null;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const cell = Math.max(x1 - x0, y1 - y0) / GRID;
  const cols = Math.max(1, Math.ceil((x1 - x0) / cell)), rows = Math.max(1, Math.ceil((y1 - y0) / cell));
  const hull = convexHull(all);
  // Ink by even-odd over every contour, so a counter reads as empty. One
  // scanline per row of cell centres: a speckled frame has thousands of
  // edges, and testing each cell against all of them took seconds.
  const ink: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const y = y0 + (r + 0.5) * cell;
    const xs: number[] = [];
    for (const c of contours) {
      for (let i = 0, j = c.length - 1; i < c.length; j = i++) {
        const [xi, yi] = c[i], [xj, yj] = c[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    const row: boolean[] = [];
    let k = 0, inside = false;
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * cell;
      while (k < xs.length && xs[k] < x) { inside = !inside; k++; }
      row.push(inside);
    }
    ink.push(row);
  }
  // Free: inside the hull and at least one cell clear of ink on every side,
  // so the window never kisses the frame's line.
  const free: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    free.push([]);
    for (let c = 0; c < cols; c++) {
      let clear = pointInPolygon(x0 + (c + 0.5) * cell, y0 + (r + 0.5) * cell, hull);
      for (let dr = -1; clear && dr <= 1; dr++) for (let dc = -1; clear && dc <= 1; dc++) {
        if (ink[r + dr]?.[c + dc]) clear = false;
      }
      free[r].push(clear);
    }
  }
  // Largest rectangle of free cells: a histogram per row, scanned with a stack.
  const heights = new Array(cols).fill(0);
  let best = { area: 0, r: 0, c: 0, w: 0, h: 0 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = free[r][c] ? heights[c] + 1 : 0;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      const h = c < cols ? heights[c] : 0;
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        if (height * width > best.area) best = { area: height * width, r: r - height + 1, c: left, w: width, h: height };
      }
      stack.push(c);
    }
  }
  if (best.area === 0) return null;
  return { x: x0 + best.c * cell, y: y0 + best.r * cell, w: best.w * cell, h: best.h * cell };
}

/** Breathing room around framed text, as a share of the text's own size. */
export const FRAME_PADDING = 0.12;

/**
 * Where a frame mark goes so its window wraps `rect` (block coordinates, the
 * text's box) with `FRAME_PADDING` on every side. The frame stretches
 * independently each way — a word is wider than a drop's window is — with
 * the uniform part chosen so the two stretches multiply to 1 (neither axis
 * is favoured). `unitsPerEm` is the library's (`MARK_UNITS_PER_EM`).
 */
export function fitFrameToRect(
  win: FrameWindow, rect: { x: number; y: number; width: number; height: number }, unitsPerEm: number
): { fontSize: number; markScaleX: number; markScaleY: number; x: number; y: number } {
  const tw = rect.width * (1 + 2 * FRAME_PADDING), th = rect.height * (1 + 2 * FRAME_PADDING);
  const kx = tw / win.w, ky = th / win.h;          // px per library unit, each way
  const s = Math.sqrt(kx * ky);
  const markScaleX = kx / s, markScaleY = ky / s;
  // The window's centre, in px from the frame's origin, lands on the text's centre.
  const cx = (win.x + win.w / 2) * kx, cy = (win.y + win.h / 2) * ky;
  return {
    fontSize: s * unitsPerEm, markScaleX, markScaleY,
    x: rect.x + rect.width / 2 - cx, y: rect.y + rect.height / 2 - cy,
  };
}
