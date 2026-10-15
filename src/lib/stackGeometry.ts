// Geometry for stack blocks: outlines as segment lists, rigid piece
// transforms, and splitting an outline into two closed halves at a cut.
// Pure — no React, no Konva, no ./harfbuzz.
import type { SvgCmd } from "./svgPath";
import type { CutFace } from "../types";
import {
  type Pt, rotateCmds, splitCubic, splitQuad, tAtX, outlineBounds,
} from "./strokeCuts";

export type Seg = { type: "L" | "Q" | "C"; p: Pt[] };

const EPS = 1e-9;
const same = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;

/** Commands → contours of segments. Every contour is closed explicitly, so
 *  the segment implied by Z (or by a missing Z) is a real `L`. */
export function toSegments(cmds: SvgCmd[]): Seg[][] {
  const out: Seg[][] = [];
  let cur: Seg[] = [];
  let start: Pt = [0, 0];
  let pos: Pt = [0, 0];
  const close = () => {
    if (cur.length === 0) return;
    if (!same(pos, start)) cur.push({ type: "L", p: [pos, start] });
    out.push(cur);
    cur = [];
  };
  for (const c of cmds) {
    switch (c.type) {
      case "M": close(); start = pos = [c.x, c.y]; break;
      case "L": { const e: Pt = [c.x, c.y]; cur.push({ type: "L", p: [pos, e] }); pos = e; break; }
      case "Q": { const e: Pt = [c.x, c.y]; cur.push({ type: "Q", p: [pos, [c.x1, c.y1], e] }); pos = e; break; }
      case "C": { const e: Pt = [c.x, c.y]; cur.push({ type: "C", p: [pos, [c.x1, c.y1], [c.x2, c.y2], e] }); pos = e; break; }
      case "Z": close(); pos = start; break;
    }
  }
  close();
  return out;
}

export function fromSegments(contours: Seg[][]): SvgCmd[] {
  const out: SvgCmd[] = [];
  for (const segs of contours) {
    if (segs.length === 0) continue;
    const [sx, sy] = segs[0].p[0];
    out.push({ type: "M", x: sx, y: sy });
    for (const s of segs) {
      const e = s.p[s.p.length - 1];
      if (s.type === "L") out.push({ type: "L", x: e[0], y: e[1] });
      else if (s.type === "Q") out.push({ type: "Q", x1: s.p[1][0], y1: s.p[1][1], x: e[0], y: e[1] });
      else out.push({ type: "C", x1: s.p[1][0], y1: s.p[1][1], x2: s.p[2][0], y2: s.p[2][1], x: e[0], y: e[1] });
    }
    out.push({ type: "Z" });
  }
  return out;
}

export type PieceTransform = { x: number; y: number; rotation: number; pivot: Pt };

/** world = R(p − pivot) + pivot + (x, y) */
export function transformPt(p: Pt, t: PieceTransform): Pt {
  const c = Math.cos(t.rotation), s = Math.sin(t.rotation);
  const dx = p[0] - t.pivot[0], dy = p[1] - t.pivot[1];
  return [dx * c - dy * s + t.pivot[0] + t.x, dx * s + dy * c + t.pivot[1] + t.y];
}

export function translateCmds(cmds: SvgCmd[], dx: number, dy: number): SvgCmd[] {
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": return { ...c, x: c.x + dx, y: c.y + dy };
      case "Q": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy };
      case "C": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy };
      default: return c;
    }
  });
}

/** Every coordinate multiplied by `k` (about the origin). */
export function scaleCmds(cmds: SvgCmd[], k: number): SvgCmd[] {
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": return { ...c, x: c.x * k, y: c.y * k };
      case "Q": return { ...c, x: c.x * k, y: c.y * k, x1: c.x1 * k, y1: c.y1 * k };
      case "C": return { ...c, x: c.x * k, y: c.y * k, x1: c.x1 * k, y1: c.y1 * k, x2: c.x2 * k, y2: c.y2 * k };
      default: return c;
    }
  });
}

export function transformCmds(cmds: SvgCmd[], t: PieceTransform): SvgCmd[] {
  // Per point through transformPt, so an edge and a CutFace transformed
  // separately land on bit-identical coordinates (they are matched by equality).
  const m = (x: number, y: number) => transformPt([x, y], t);
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": { const [x, y] = m(c.x, c.y); return { ...c, x, y }; }
      case "Q": { const [x, y] = m(c.x, c.y); const [x1, y1] = m(c.x1, c.y1); return { ...c, x, y, x1, y1 }; }
      case "C": {
        const [x, y] = m(c.x, c.y); const [x1, y1] = m(c.x1, c.y1); const [x2, y2] = m(c.x2, c.y2);
        return { ...c, x, y, x1, y1, x2, y2 };
      }
      default: return c;
    }
  });
}

export function transformFace(f: CutFace, t: PieceTransform): CutFace {
  return { a: transformPt(f.a, t), b: transformPt(f.b, t), tangent: f.tangent + t.rotation };
}

export function cmdsCentre(cmds: SvgCmd[]): Pt {
  const b = outlineBounds(cmds);
  return [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2];
}

/** x(t) of a segment. */
function xAt(s: Seg, t: number): number {
  const p = s.p, u = 1 - t;
  if (s.type === "L") return p[0][0] + (p[1][0] - p[0][0]) * t;
  if (s.type === "Q") return u * u * p[0][0] + 2 * u * t * p[1][0] + t * t * p[2][0];
  return u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0];
}

/** Split a segment where it crosses x = cutX, returning [before, after]. */
function splitSegAtX(s: Seg, cutX: number): [Seg, Seg] {
  if (s.type === "L") {
    const t = (cutX - s.p[0][0]) / (s.p[1][0] - s.p[0][0]);
    const m: Pt = [cutX, s.p[0][1] + (s.p[1][1] - s.p[0][1]) * t];
    return [{ type: "L", p: [s.p[0], m] }, { type: "L", p: [m, s.p[1]] }];
  }
  const t = tAtX(cutX, (tt) => xAt(s, tt));
  if (s.type === "Q") {
    const [L, R] = splitQuad(s.p[0], s.p[1], s.p[2], t);
    L[2] = [cutX, L[2][1]]; R[0] = L[2];
    return [{ type: "Q", p: L }, { type: "Q", p: R }];
  }
  const [L, R] = splitCubic(s.p[0], s.p[1], s.p[2], s.p[3], t);
  L[3] = [cutX, L[3][1]]; R[0] = L[3];
  return [{ type: "C", p: L }, { type: "C", p: R }];
}

/**
 * Split an outline into the part on the near side (x < cutX in the cut's
 * frame) and the far side, each closed with a straight bridge edge between
 * the two crossing points. Those two points, with the stroke direction, are
 * the faces a join is later drawn between. Null if any contour crosses the
 * cut line other than 0 or 2 times — the cut is not a legal stroke cut.
 */
export function splitAtCut(
  cmds: SvgCmd[], cut: { cutX: number; angle: number; window?: { y: number; half: number } }
): { near: SvgCmd[]; far: SvgCmd[]; nearFace: CutFace; farFace: CutFace } | null {
  const contours = toSegments(rotateCmds(cmds, -cut.angle));
  const near: Seg[][] = [], far: Seg[][] = [];
  let face: [Pt, Pt] | null = null;
  const isNear = (x: number) => x < cut.cutX;

  // In windowed mode an uncrossed contour (a counter, or one crossed only
  // outside the window) goes with the half that contains it, not with the
  // side of the infinite line its first point happens to lie on.
  const loose: Seg[][] = [];
  for (const segs of contours) {
    const crossing = segs.map((s) => isNear(s.p[0][0]) !== isNear(s.p[s.p.length - 1][0]));
    // A windowed cut is a *segment* of the line, `half` either side of `y`
    // (the cut's frame): crossings outside it — the other arm of a U — are
    // not this cut's business, and the two inside it divide the contour.
    if (cut.window) {
      for (let i = 0; i < segs.length; i++) {
        if (!crossing[i]) continue;
        const [a] = splitSegAtX(segs[i], cut.cutX);
        const y = a.p[a.p.length - 1][1];
        if (Math.abs(y - cut.window.y) > cut.window.half) crossing[i] = false;
      }
    }
    const n = crossing.filter(Boolean).length;
    if (n === 0) {
      if (cut.window) loose.push(segs); else (isNear(segs[0].p[0][0]) ? near : far).push(segs);
      continue;
    }
    if (n !== 2 || face) return null;
    const i1 = crossing.indexOf(true), i2 = crossing.indexOf(true, i1 + 1);
    const [a1, b1] = splitSegAtX(segs[i1], cut.cutX);
    const [a2, b2] = splitSegAtX(segs[i2], cut.cutX);
    const c1 = a1.p[a1.p.length - 1], c2 = a2.p[a2.p.length - 1];
    const runA = [...segs.slice(0, i1), a1];                 // start → c1
    const runB = [b1, ...segs.slice(i1 + 1, i2), a2];        // c1 → c2
    const runC = [b2, ...segs.slice(i2 + 1)];                // c2 → start
    const sideB = [...runB, { type: "L" as const, p: [c2, c1] }];
    const sideAC = [...runC, ...runA, { type: "L" as const, p: [c1, c2] }];
    const bIsNear = isNear(segs[i1].p[segs[i1].p.length - 1][0]);
    (bIsNear ? near : far).push(sideB);
    (bIsNear ? far : near).push(sideAC);
    face = [c1, c2];
  }
  if (!face) return null;
  if (loose.length) {
    const poly = (c: Seg[][]) => c.flatMap((segs) => segs.map((s) => s.p[0]));
    const nearPoly = poly(near), farPoly = poly(far);
    const inside = (p: Pt, pg: Pt[]) => {
      let w = false;
      for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) {
        if ((pg[i][1] > p[1]) !== (pg[j][1] > p[1]) && p[0] < ((pg[j][0] - pg[i][0]) * (p[1] - pg[i][1])) / (pg[j][1] - pg[i][1]) + pg[i][0]) w = !w;
      }
      return w;
    };
    for (const segs of loose) {
      const q = segs[0].p[0];
      (inside(q, nearPoly) ? near : inside(q, farPoly) ? far : isNear(q[0]) ? near : far).push(segs);
    }
  }

  const back = (c: Seg[][]) => rotateCmds(fromSegments(c), cut.angle);
  const rot = (p: Pt): Pt => {
    const c = Math.cos(cut.angle), s = Math.sin(cut.angle);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
  };
  const a = rot(face[0]), b = rot(face[1]);
  return {
    near: back(near), far: back(far),
    nearFace: { a, b, tangent: cut.angle },
    farFace: { a, b, tangent: cut.angle + Math.PI },
  };
}
