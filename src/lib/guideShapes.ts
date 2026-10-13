import type { GuideParams, GuideShape } from "../types";
import type { SvgCmd } from "./svgPath";

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
};

export const GUIDE_SHAPE_LABELS: Record<GuideShape, string> = {
  circle: "Circle",
  ellipse: "Ellipse",
  arc: "Arc",
  wave: "Wave",
  line: "Line",
  pen: "Pen",
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

export function guidePathD(shape: GuideShape, params: GuideParams = GUIDE_DEFAULTS[shape]): string {
  const p = { ...GUIDE_DEFAULTS[shape], ...params };
  const w = Math.max(p.width ?? 300, 2);
  switch (shape) {
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
