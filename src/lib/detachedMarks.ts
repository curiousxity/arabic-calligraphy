// Detached marks: a letter's dots, the hamza on أ إ ؤ ئ, the kaf stroke —
// any closed contour of ink that sits outside the letter's body. Pure: no
// React, no Konva, and no ./harfbuzz import (its static harfbuzzjs import
// throws under Vitest's Node loader). Design:
// docs/superpowers/specs/2026-10-14-free-marks-and-dots-design.md
import type * as opentype from "opentype.js";
import type { SvgCmd } from "./svgPath";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";
import { pointInPolygon } from "./svgPath";
import { toSegments, fromSegments } from "./stackGeometry";
import { outlineBounds, flattenContours, toSvgCmds, remapCutsForEdits } from "./strokeCuts";

export type Bounds = { x1: number; y1: number; x2: number; y2: number };
export type DetachedContour = { mark: number; cmds: SvgCmd[]; bounds: Bounds };

/** Upper bound on a mark's bounding-box area as a fraction of the body's.
 *  An upper bound, not a band round one nuqta: Ruqaa draws a dot pair as a
 *  dash and Gulzar's dots are nearly two nuqta wide. Tuned by
 *  scripts/measureDetachedMarks.mjs. */
export const MAX_MARK_FRACTION = 0.35;

/** Second admission path, in square em: anything this small is a mark
 *  whatever its body. Needed because a thin alif's box is small and its
 *  hamza is 0.8 of it and 0.055 em² (Amiri), which no body fraction can
 *  admit without also admitting a two-stroke letter's smaller half. Also
 *  tuned by the gate script. */
export const MAX_MARK_EM_AREA = 0.07;

/** Below this a contour is a stray speck, not a mark (Yekan's medial ح
 *  carries a 5×11-unit fragment). Dots start around 0.004 em². */
export const MIN_MARK_EM_AREA = 0.001;

/** A candidate closer than this to the body, in em, is a piece of the body
 *  (a stem, a connector, a decorative segment) drawn as its own contour,
 *  not a mark: a dot never touches its letter. */
export const TOUCH_EPS_EM = 0.01;

/** One command list per contour, in raw order (the index is the mark key). */
export function splitContours(cmds: SvgCmd[]): SvgCmd[][] {
  return toSegments(cmds).map((segs) => fromSegments([segs]));
}

type Poly = Array<[number, number]>;
const area = (b: Bounds) => Math.max(b.x2 - b.x1, 0) * Math.max(b.y2 - b.y1, 0);

/** Most of `a`'s vertices lie inside `b`. A counter is entirely inside its
 *  body; a dot is entirely outside. The bounding-box centre is not usable
 *  here: a jeem's own centre falls inside its dot. */
function mostlyInside(a: Poly, b: Poly): boolean {
  if (a.length === 0 || b.length < 3) return false;
  let n = 0;
  for (const [x, y] of a) if (pointInPolygon(x, y, b)) n++;
  return n * 2 > a.length;
}

function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax, vy = by - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const dx = px - (ax + t * vx), dy = py - (ay + t * vy);
  return dx * dx + dy * dy;
}

/** `a` overlaps or touches `b`: a vertex of either inside the other, or a
 *  vertex of `a` within `eps` of an edge of `b`. */
function touches(a: Poly, b: Poly, eps: number): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const [x, y] of a) if (pointInPolygon(x, y, b)) return true;
  for (const [x, y] of b) if (pointInPolygon(x, y, a)) return true;
  const eps2 = eps * eps;
  for (const [x, y] of a) {
    for (let j = 0, k = b.length - 1; j < b.length; k = j++) {
      if (segDist2(x, y, b[k][0], b[k][1], b[j][0], b[j][1]) <= eps2) return true;
    }
  }
  return false;
}

/**
 * Rules, in order: (1) a contour most of whose vertices lie inside another
 * is a counter, not a candidate (winding is not used because TrueType and
 * CFF disagree); (2) the remaining contours are grouped into components by
 * overlap or touch (`TOUCH_EPS_EM`), and the component holding the largest
 * contour is the body — a stem, a tooth or a connector drawn as its own
 * contour touches the body or a piece that does (NotoSans ط, Lateef س,
 * Raqq's pieced connectors), a dot never does; (3) every contour outside
 * the body component whose area is at most `maxFraction` of the body's or
 * at most `maxEmArea` square em, and at least `MIN_MARK_EM_AREA`, is a
 * mark.
 */
export function findDetachedContours(
  cmds: SvgCmd[],
  unitsPerEm: number,
  maxFraction = MAX_MARK_FRACTION,
  maxEmArea = MAX_MARK_EM_AREA
): DetachedContour[] {
  const parts = splitContours(cmds);
  if (parts.length < 2) return [];
  const polys: Poly[] = parts.map((p) => flattenContours(p)[0] ?? []);
  const bounds = parts.map((p) => outlineBounds(p));
  const upm = Math.max(unitsPerEm || 1000, 1);
  const eps = TOUCH_EPS_EM * upm;

  // (1) counters out.
  const outer: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    let inside = false;
    for (let j = 0; j < parts.length && !inside; j++) {
      if (j !== i && mostlyInside(polys[i], polys[j])) inside = true;
    }
    if (!inside && area(bounds[i]) > 0) outer.push(i);
  }
  if (outer.length < 2) return [];

  // (2) components by touch; the body is the largest contour's component.
  const comp = new Map<number, number>(outer.map((i) => [i, i]));
  const find = (i: number): number => {
    let r = i;
    while (comp.get(r) !== r) r = comp.get(r)!;
    comp.set(i, r);
    return r;
  };
  for (let a = 0; a < outer.length; a++) {
    for (let b = a + 1; b < outer.length; b++) {
      const i = outer[a], j = outer[b];
      if (find(i) !== find(j) && touches(polys[i], polys[j], eps)) comp.set(find(i), find(j));
    }
  }
  const largest = outer.reduce((best, i) => (area(bounds[i]) > area(bounds[best]) ? i : best), outer[0]);
  const bodyRoot = find(largest);
  const bodyArea = outer.filter((i) => find(i) === bodyRoot).reduce((s, i) => s + area(bounds[i]), 0);

  // (3) size.
  const limit = Math.max(maxFraction * bodyArea, maxEmArea * upm * upm);
  const floor = MIN_MARK_EM_AREA * upm * upm;
  return outer
    .filter((i) => find(i) !== bodyRoot && area(bounds[i]) <= limit && area(bounds[i]) >= floor)
    .map((i) => ({ mark: i, cmds: parts[i], bounds: bounds[i] }));
}

/** The same outline with contour `i` translated by `offsets.get(i)`. */
export function translateContours(
  cmds: SvgCmd[],
  offsets: ReadonlyMap<number, readonly [number, number]>
): SvgCmd[] {
  if (offsets.size === 0) return cmds;
  const parts = splitContours(cmds);
  return parts.flatMap((part, i) => {
    const o = offsets.get(i);
    if (!o) return part;
    const [dx, dy] = o;
    return part.map((c): SvgCmd => {
      switch (c.type) {
        case "M": case "L": return { ...c, x: c.x + dx, y: c.y + dy };
        case "Q": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy };
        case "C": return { ...c, x: c.x + dx, y: c.y + dy, x1: c.x1 + dx, y1: c.y1 + dy, x2: c.x2 + dx, y2: c.y2 + dy };
        default: return c;
      }
    });
  });
}

export type DetachedMark = DetachedContour & {
  glyphIndex: number;
  cluster: number;
  glyphId: number;
};

/** Fonts the coverage gate failed (scripts/measureDetachedMarks.mjs); the
 *  detector returns nothing for them rather than the bar being loosened.
 *  All five build letters from pieces that do not touch — Kufi2, Qahiri and
 *  RanaKufi from cells, ThuluthDeco from decorative segments, Wessam with a
 *  ط stem floating above its bowl — so a piece of the body is
 *  indistinguishable from a dot. Numbers: docs/archive/detached-mark-coverage.md. */
export const UNSUPPORTED_FONTS: ReadonlySet<string> = new Set<string>([
  "Kufi2", "Qahiri", "RanaKufi", "ThuluthDeco", "Wessam",
]);

const glyphCmds = (font: opentype.Font, g: HarfBuzzGlyph, upm: number): SvgCmd[] | null => {
  const obj = font.glyphs.get(g.g);
  return obj ? toSvgCmds(obj.getPath(0, 0, upm).commands) : null;
};

/**
 * Every detached mark in a shaped run, keyed by glyph index.
 *
 * Contour route: a letter's own outline split by `findDetachedContours`;
 * `mark` is the raw contour index. Separate-glyph route (NotoSans, Ruqaa,
 * Kufi2, Qahiri draw dots as their own zero-advance glyph): a zero-advance
 * glyph sharing a cluster with an advance-carrying base, not already a
 * tashkeel per `diacriticIndices`, whose outline is small against the
 * base's body; `mark` is `-1 - n` where `n` is its ordinal among glyphs in
 * the cluster with the same glyph id, so two identical dot glyphs stay
 * distinct. Pass `only` to walk a subset (plan resolution needs only the
 * glyphs that carry overrides).
 */
export function findDetachedMarks(
  glyphs: HarfBuzzGlyph[],
  font: opentype.Font | null | undefined,
  unitsPerEm: number,
  diacriticIndices: ReadonlySet<number>,
  fontFamily: string,
  only?: ReadonlySet<number>
): Map<number, DetachedMark[]> {
  const out = new Map<number, DetachedMark[]>();
  if (!font || UNSUPPORTED_FONTS.has(fontFamily)) return out;
  const upm = Math.max(unitsPerEm || 1000, 1);

  // Base (advance-carrying) glyph per cluster, for the separate-glyph route.
  const baseByCluster = new Map<number, number>();
  glyphs.forEach((g, i) => {
    if ((g.ax ?? 0) !== 0 && !baseByCluster.has(g.cl ?? 0)) baseByCluster.set(g.cl ?? 0, i);
  });
  const sameIdOrdinal = new Map<string, number>();

  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const cluster = g.cl ?? 0;
    if (diacriticIndices.has(i)) continue;
    if ((g.ax ?? 0) === 0 && (g.ay ?? 0) === 0) {
      const baseIdx = baseByCluster.get(cluster);
      if (baseIdx === undefined || baseIdx === i) continue;
      const key = `${cluster}:${g.g}`;
      const n = sameIdOrdinal.get(key) ?? 0;
      sameIdOrdinal.set(key, n + 1);
      if (only && !only.has(i)) continue;
      const cmds = glyphCmds(font, g, upm);
      const baseCmds = glyphCmds(font, glyphs[baseIdx], upm);
      if (!cmds || !baseCmds) continue;
      // A dot *group* glyph (Gulzar, Urdu) holds several contours whose
      // union is larger than any mark; each contour is sized on its own.
      const mb = outlineBounds(cmds), bb = outlineBounds(baseCmds);
      const limit = Math.max(MAX_MARK_FRACTION * area(bb), MAX_MARK_EM_AREA * upm * upm);
      const partAreas = splitContours(cmds).map((p) => area(outlineBounds(p)));
      if (partAreas.length === 0 || partAreas.some((a) => a === 0 || a > limit)) continue;
      out.set(i, [{ mark: -1 - n, cmds, bounds: mb, glyphIndex: i, cluster, glyphId: g.g }]);
      continue;
    }
    if (only && !only.has(i)) continue;
    const cmds = glyphCmds(font, g, upm);
    if (!cmds) continue;
    const found = findDetachedContours(cmds, upm);
    if (found.length) out.set(i, found.map((m) => ({ ...m, glyphIndex: i, cluster, glyphId: g.g })));
  }
  return out;
}

/** Where a detached mark has been moved to. Keyed like a stroke cut: the
 *  cluster survives a re-shape that changes the glyph count, the glyph id
 *  checksums the letter, and `mark` picks the contour (>= 0, raw index in
 *  the glyph's path) or the whole mark glyph (< 0, see findDetachedMarks).
 *  `dx`/`dy` are unscaled font units, so a font-size change scales them.
 *  Tashkeel offsets are in px by history; the two are deliberately not the
 *  same convention. */
export type DetachedMarkOverride = {
  cluster: number;
  glyphId: number;
  mark: number;
  dx: number;
  dy: number;
};

export type DetachedMarkPlan = {
  /** glyph index -> contour index -> [dx, dy], font units. */
  contours: Map<number, Map<number, [number, number]>>;
  /** glyph index -> [dx, dy] for whole-glyph marks. */
  glyphs: Map<number, [number, number]>;
};

export const EMPTY_MARK_PLAN: DetachedMarkPlan = { contours: new Map(), glyphs: new Map() };

/** Resolve stored overrides against this run's detected marks. Anything
 *  whose cluster + glyph id no longer names a glyph, or whose mark index is
 *  no longer detected on it, is dropped silently — the guard tashkeel
 *  overrides already get. */
export function buildDetachedMarkPlan(
  overrides: readonly DetachedMarkOverride[],
  glyphs: HarfBuzzGlyph[],
  detected: ReadonlyMap<number, DetachedMark[]>
): DetachedMarkPlan {
  const plan: DetachedMarkPlan = { contours: new Map(), glyphs: new Map() };
  for (const o of overrides) {
    if (o.dx === 0 && o.dy === 0) continue;
    // A whole-glyph mark (mark < 0) names the (-1 - mark)th glyph with this
    // cluster and id, so two identical dot glyphs in one cluster stay
    // distinct; a contour mark names the first such glyph. findDetachedMarks
    // counts the same ordinal in the same glyph order.
    const wanted = o.mark < 0 ? -1 - o.mark : 0;
    let seen = 0;
    for (let i = 0; i < glyphs.length; i++) {
      const g = glyphs[i];
      if ((g.cl ?? 0) !== o.cluster || g.g !== o.glyphId) continue;
      if (seen++ !== wanted) continue;
      const list = detected.get(i);
      if (!list?.some((m) => m.mark === o.mark)) break;
      if (o.mark < 0) plan.glyphs.set(i, [o.dx, o.dy]);
      else {
        const per = plan.contours.get(i) ?? new Map<number, [number, number]>();
        per.set(o.mark, [o.dx, o.dy]);
        plan.contours.set(i, per);
      }
      break;
    }
  }
  return plan;
}

/** Glyph indices named by any override — the `only` argument for
 *  findDetachedMarks when the tool is not armed. */
export function glyphIndicesWithOverrides(overrides: readonly DetachedMarkOverride[], glyphs: HarfBuzzGlyph[]): Set<number> {
  const out = new Set<number>();
  for (const o of overrides) glyphs.forEach((g, i) => { if ((g.cl ?? 0) === o.cluster && g.g === o.glyphId) out.add(i); });
  return out;
}

/**
 * A stable key for *which* glyphs carry overrides, independent of their
 * offsets: the renderers memo detection on this rather than on the
 * overrides array, which is replaced on every drag frame. Without it a drag
 * re-ran the point-in-polygon walk per mousemove, and on Shape Fill
 * re-tiled the whole silhouette with it.
 */
export function overrideGlyphKey(overrides: readonly DetachedMarkOverride[], glyphs: HarfBuzzGlyph[]): string {
  return [...glyphIndicesWithOverrides(overrides, glyphs)].sort((a, b) => a - b).join(",");
}

/** The glyph indices a key names (the inverse of `overrideGlyphKey`). */
export function glyphIndicesFromKey(key: string): Set<number> {
  return new Set(key === "" ? [] : key.split(",").map(Number));
}

/** Cluster keys shift when a tatweel is inserted; same remap as stroke cuts. */
export const remapMarksForEdits = (
  marks: DetachedMarkOverride[],
  edits: readonly { index: number; delta: number }[]
): DetachedMarkOverride[] => remapCutsForEdits(marks, edits);

/** The glyph's outline with this run's plan applied, `scale` px per font
 *  unit (1 when the commands are already in font units). Returns the same
 *  array when the glyph has no entry, so memos can test identity. */
export function applyMarkPlanToGlyph(cmds: SvgCmd[], plan: DetachedMarkPlan, glyphIndex: number, scale: number): SvgCmd[] {
  const per = plan.contours.get(glyphIndex);
  if (!per || per.size === 0) return cmds;
  const scaled = new Map<number, readonly [number, number]>();
  for (const [i, [dx, dy]] of per) scaled.set(i, [dx * scale, dy * scale]);
  return translateContours(cmds, scaled);
}
