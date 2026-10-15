import type { GuideParams, GuideShape } from "../types";
import { parseSvgPath, pathToPolygon, type SvgCmd } from "./svgPath";

/**
 * Paths for guide blocks. Pure. Every path is centred on the block origin, so
 * the guide's own x/y/rotation place it and rotation pivots on its centre.
 *
 * Closed shapes run **clockwise in screen space from the top centre**, so
 * offset 0 is the top and text along the top, unflipped, walks left to right
 * — the order the Curve renderer lays glyphs in.
 */

export const GUIDE_DEFAULTS: Record<GuideShape, GuideParams> = {
  circle: { width: 300 },
  ellipse: { width: 360, height: 240 },
  arc: { width: 300, sweep: 180 },
  wave: { width: 400, amplitude: 40 },
  line: { width: 400 },
  pen: { width: 300 },
  teardrop: { width: 260, height: 380 },
  almond: { width: 220, height: 400 },
  svg: { width: 300 },
};

export const GUIDE_SHAPE_LABELS: Record<GuideShape, string> = {
  circle: "Circle",
  ellipse: "Ellipse",
  arc: "Arc",
  wave: "Wave",
  line: "Line",
  pen: "Pen",
  teardrop: "Teardrop",
  almond: "Almond",
  svg: "Uploaded SVG",
};

const n = (v: number) => Number(v.toFixed(3));

/** Cubic segments (≤ 90° each) along an ellipse from a0 to a1 degrees, screen angles (y down, so increasing = clockwise). */
function ellipseArc(rx: number, ry: number, a0: number, a1: number): string {
  const parts: string[] = [];
  const segs = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 90));
  const step = (a1 - a0) / segs;
  for (let i = 0; i < segs; i++) {
    const s = ((a0 + i * step) * Math.PI) / 180;
    const e = ((a0 + (i + 1) * step) * Math.PI) / 180;
    const k = (4 / 3) * Math.tan((e - s) / 4);
    const p0 = [Math.cos(s), Math.sin(s)];
    const p3 = [Math.cos(e), Math.sin(e)];
    const c1 = [p0[0] - k * p0[1], p0[1] + k * p0[0]];
    const c2 = [p3[0] + k * p3[1], p3[1] - k * p3[0]];
    if (i === 0) parts.push(`M ${n(rx * p0[0])} ${n(ry * p0[1])}`);
    parts.push(
      `C ${n(rx * c1[0])} ${n(ry * c1[1])}, ${n(rx * c2[0])} ${n(ry * c2[1])}, ${n(rx * p3[0])} ${n(ry * p3[1])}`
    );
  }
  return parts.join(" ");
}

/**
 * The path for a guide shape. An uploaded SVG has no formula: its path comes
 * from `svgGuidePathD` and the block's own `guideSvgD`, so this returns ""
 * for "svg" (the Add-guide preview never asks for it).
 */
export function guidePathD(shape: GuideShape, params: GuideParams = GUIDE_DEFAULTS[shape]): string {
  const p = { ...GUIDE_DEFAULTS[shape], ...params };
  const w = Math.max(p.width ?? 300, 2);
  switch (shape) {
    case "svg":
      return "";
    case "circle":
      return `${ellipseArc(w / 2, w / 2, -90, 270)} Z`;
    case "ellipse": {
      const h = Math.max(p.height ?? w, 2);
      return `${ellipseArc(w / 2, h / 2, -90, 270)} Z`;
    }
    case "arc": {
      const sweep = Math.min(Math.max(p.sweep ?? 180, 10), 350);
      return ellipseArc(w / 2, w / 2, -90 - sweep / 2, -90 + sweep / 2);
    }
    case "wave": {
      const a = p.amplitude ?? 40;
      const h = w / 4;
      let d = `M ${n(-w / 2)} 0`;
      for (let i = 0; i < 4; i++) {
        const x = -w / 2 + i * h;
        const s = i % 2 === 0 ? -1 : 1;
        d += ` C ${n(x + h * 0.36)} ${n(s * a * 1.33)}, ${n(x + h * 0.64)} ${n(s * a * 1.33)}, ${n(x + h)} 0`;
      }
      return d;
    }
    case "line":
      return `M ${n(-w / 2)} 0 L ${n(w / 2)} 0`;
    case "pen":
      return `M ${n(-w / 2)} 0 C ${n(-w / 6)} ${n(-w / 5)}, ${n(w / 6)} ${n(-w / 5)}, ${n(w / 2)} 0`;
    case "teardrop": {
      // A circle of radius w/2 at the bottom, drawn up to a point at the top.
      const h = Math.max(p.height ?? w * 1.4, w);
      const r = w / 2, cy = h / 2 - r, k = 0.5523;
      const ty = -h / 2;
      return [
        `M 0 ${n(ty)}`,
        `C ${n(r * 0.45)} ${n(ty + (cy - ty) * 0.45)}, ${n(r)} ${n(cy - r * 0.6)}, ${n(r)} ${n(cy)}`,
        `C ${n(r)} ${n(cy + r * k)}, ${n(r * k)} ${n(h / 2)}, 0 ${n(h / 2)}`,
        `C ${n(-r * k)} ${n(h / 2)}, ${n(-r)} ${n(cy + r * k)}, ${n(-r)} ${n(cy)}`,
        `C ${n(-r)} ${n(cy - r * 0.6)}, ${n(-r * 0.45)} ${n(ty + (cy - ty) * 0.45)}, 0 ${n(ty)}`,
        "Z",
      ].join(" ");
    }
    case "almond": {
      const h = Math.max(p.height ?? w * 1.8, 2);
      // Both handles at kx put the curve's widest point at 0.75 * kx, i.e. w / 2.
      const kx = w / 1.5, ky = h * 0.27;
      return [
        `M 0 ${n(-h / 2)}`,
        `C ${n(kx)} ${n(-h / 2 + ky)}, ${n(kx)} ${n(h / 2 - ky)}, 0 ${n(h / 2)}`,
        `C ${n(-kx)} ${n(h / 2 - ky)}, ${n(-kx)} ${n(-h / 2 + ky)}, 0 ${n(-h / 2)}`,
        "Z",
      ].join(" ");
    }
  }
}

/** True when the path ends where it starts, or carries a Z. */
export function isClosedPath(cmds: SvgCmd[]): boolean {
  if (cmds.some((c) => c.type === "Z")) return true;
  const first = cmds.find((c) => c.type === "M");
  const last = [...cmds].reverse().find((c) => c.type !== "Z");
  if (!first || !last || first === last || first.type !== "M" || !("x" in last)) return false;
  return Math.hypot(last.x - first.x, last.y - first.y) < 1e-6;
}

/** Absolute commands back to a `d` string, 3 decimals like the shapes above. */
export function cmdsToPathD(cmds: readonly SvgCmd[]): string {
  return cmds
    .map((c) => {
      switch (c.type) {
        case "M": case "L": return `${c.type} ${n(c.x)} ${n(c.y)}`;
        case "Q": return `Q ${n(c.x1)} ${n(c.y1)}, ${n(c.x)} ${n(c.y)}`;
        case "C": return `C ${n(c.x1)} ${n(c.y1)}, ${n(c.x2)} ${n(c.y2)}, ${n(c.x)} ${n(c.y)}`;
        default: return "Z";
      }
    })
    .join(" ");
}

function mapPoints(cmds: readonly SvgCmd[], f: (x: number, y: number) => [number, number]): SvgCmd[] {
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": { const [x, y] = f(c.x, c.y); return { ...c, x, y }; }
      case "Q": { const [x, y] = f(c.x, c.y); const [x1, y1] = f(c.x1, c.y1); return { ...c, x, y, x1, y1 }; }
      case "C": {
        const [x, y] = f(c.x, c.y); const [x1, y1] = f(c.x1, c.y1); const [x2, y2] = f(c.x2, c.y2);
        return { ...c, x, y, x1, y1, x2, y2 };
      }
      default: return c;
    }
  });
}

function bounds(cmds: readonly SvgCmd[]): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of pathToPolygon([...cmds], 12)) {
    if (x < x1) x1 = x;
    if (x > x2) x2 = x;
    if (y < y1) y1 = y;
    if (y > y2) y2 = y;
  }
  return isFinite(x1) ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 0, y2: 0 };
}

/**
 * An uploaded outline made into a guide's source path: centred on the origin
 * so x/y/rotation place it like every other guide. Returns null for a path
 * with no extent. `width`/`height` are its natural size.
 */
export function uploadedGuideSource(pathData: string): { d: string; width: number; height: number } | null {
  const cmds = parseSvgPath(pathData);
  const b = bounds(cmds);
  const width = b.x2 - b.x1, height = b.y2 - b.y1;
  if (!(width > 0) || !(height > 0)) return null;
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2;
  return { d: cmdsToPathD(mapPoints(cmds, (x, y) => [x - cx, y - cy])), width, height };
}

/** The uploaded source scaled uniformly so it is `width` wide (height follows). */
export function svgGuidePathD(sourceD: string, width: number): string {
  const cmds = parseSvgPath(sourceD);
  const b = bounds(cmds);
  const natural = b.x2 - b.x1;
  if (!(natural > 0)) return sourceD;
  const k = Math.max(width, 2) / natural;
  return cmdsToPathD(mapPoints(cmds, (x, y) => [x * k, y * k]));
}

/**
 * The container a closed guide offers: its largest closed subpath, as a
 * polygon in the guide's local frame. An uploaded SVG may carry several
 * subpaths (a ring, a shape with a hole, stray marks); the biggest one is
 * the outline to fill. Null when nothing closed is there.
 */
export function containerPolygon(cmds: readonly SvgCmd[]): Array<[number, number]> | null {
  const subpaths: SvgCmd[][] = [];
  for (const c of cmds) {
    if (c.type === "M" || subpaths.length === 0) subpaths.push([]);
    subpaths[subpaths.length - 1].push(c);
  }
  let best: Array<[number, number]> | null = null;
  let bestArea = 0;
  for (const sp of subpaths) {
    if (!isClosedPath(sp)) continue;
    const poly = pathToPolygon(sp, 16);
    if (poly.length < 3) continue;
    const b = bounds(sp);
    const area = (b.x2 - b.x1) * (b.y2 - b.y1);
    if (area > bestArea) { bestArea = area; best = poly; }
  }
  return best;
}
