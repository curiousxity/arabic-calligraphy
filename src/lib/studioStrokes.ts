/**
 * The studio stroke library: every stroke of the studio's Thuluth letters recreated with the pen, as fitted and
 * reviewed stroke by stroke (docs/calligraphy/studioledger.md), built by scripts/pen/studiolib.py into
 * public/pen/studio-strokes.json. Never edit that file by hand: rebuild it.
 *
 * A stroke is one or more pen paths in the stamp's own units (`ppn` to the nuqta, y down): nodes [x, y, angle] or
 * [x, y, angle, width]. The cubic handles between nodes are rebuilt here by the fitter's rule (Catmull-Rom
 * tangents, a third of the chord), so penSweep draws exactly the path that was scored. A stroke written in pieces
 * also carries `patches` (gaps wholly inside its ink, filled as wet ink flows across them, and studio ink its joint
 * left bare) and `erase` (its pieces' nib corners past the studio edge at the joint, trimmed): the ink is the
 * pieces' union less the erase rings, then the patches added. Pure; never imports ./harfbuzz.
 */
import * as clipping from "polygon-clipping";
import { snap, sweepPath, unionPolygons, type NibNode, type PenPath, type Polygon, type Pt, type Ring } from "./penSweep";

const pc = clipping as unknown as { difference?: typeof clipping.difference; default?: { difference: typeof clipping.difference } };
const difference = pc.difference ?? pc.default!.difference;

/** [x, y, angle] or [x, y, angle, width], stamp units and degrees (penSweep's NibNode). */
export type StudioNode = [number, number, number] | [number, number, number, number];
export type StudioStroke = {
  id: string;
  /** How it was written: "pen" (one nib angle), "turning", "fill" (the nib tip), "split" (in pieces). */
  recipe: string;
  pens: StudioNode[][];
  patches?: Ring[];
  erase?: Ring[];
  /** Match to the studio's outline when it was reviewed, 0..1. */
  iou?: number;
  /** The stroke whose fit this one copies (the same outline used in another shape). */
  twin?: string;
};
export type StudioShape = {
  group: string; form: string; variant: number;
  pairOf?: string; pairRole?: string;
  /** The shape's origin in its stamp: x at its right-most ink, y = 0 at the stamp's top. */
  origin: Pt;
  strokes: StudioStroke[];
};
export type StudioLibrary = { version: number; ppn: number; pen: number; shapes: Record<string, StudioShape> };

/** Where the built library is served from (public/). */
export const STUDIO_LIBRARY_URL = "/pen/studio-strokes.json";

/** The library, fetched once; `loadedStudioLibrary` holds it once it has arrived. */
let pending: Promise<StudioLibrary> | null = null;
export let loadedStudioLibrary: StudioLibrary | null = null;
export function loadStudioLibrary(url = STUDIO_LIBRARY_URL): Promise<StudioLibrary> {
  pending ??= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`studio library: ${r.status} ${url}`);
    return r.json() as Promise<StudioLibrary>;
  }).then((lib) => (loadedStudioLibrary = lib));
  return pending;
}

const nib = (n: StudioNode): NibNode => ({ p: [n[0], n[1]], angle: n[2], width: n.length > 3 ? n[3]! : 1 });

/** A stroke path's nodes as a PenPath, with the fitter's handles (scripts/pen/studiolib.py `controls`). */
export function penPathOf(nodes: StudioNode[]): PenPath {
  const P = nodes.map((n): Pt => [n[0], n[1]]);
  const k = P.length;
  const tan = P.map((_, i): Pt => {
    const [a, b] = i === 0 ? [P[0], P[1] ?? P[0]] : i === k - 1 ? [P[k - 2], P[k - 1]] : [P[i - 1], P[i + 1]];
    const v: Pt = [b[0] - a[0], b[1] - a[1]];
    const m = Math.hypot(v[0], v[1]) || 1e-9;
    return [v[0] / m, v[1] / m];
  });
  const segs = nodes.slice(1).map((n, i) => {
    const ch = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]) / 3;
    return {
      c1: [P[i][0] + tan[i][0] * ch, P[i][1] + tan[i][1] * ch] as Pt,
      c2: [P[i + 1][0] - tan[i + 1][0] * ch, P[i + 1][1] - tan[i + 1][1] * ch] as Pt,
      to: nib(n),
    };
  });
  return { start: nib(nodes[0]), segs };
}

/** A crumb, in square nuqta: (0.05 nuqta)^2. The erase and patch rings were traced on a 0.0025-nuqta grid and the
 *  pens' edges are true curves, so where they cross at a joint they leave specks of ink and pinholes (on the built
 *  library: specks up to 0.016 nuqta across, and a sliver of 259.s2's slit along its cut). A hole smaller than a
 *  crumb is a gap wholly inside the stroke's ink, filled as the user ruled ("fill the gaps that lie entirely inside a
 *  stroke's ink", 2026-10-29); a counter (a window that must stay open) is 0.1 square nuqta and more, forty times a
 *  crumb. A detached speck smaller than a crumb is dropped, never the stroke's
 *  largest piece. */
export const CRUMB = 0.05 * 0.05;

const ringArea = (r: Ring): number => {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return Math.abs(a) / 2;
};

/** ink less the erase rings. polygon-clipping can lose a segment where a ring runs along the ink's edge on nearly the
 *  same line ("Unable to find segment ... in SweepLine tree": 449r.s2, whose joint trim follows the studio edge its
 *  ink also nearly follows); snapping every point to a coarser grid, as penSweep's union does, moves those edges
 *  apart or onto each other. The coarsest grid is a quarter of a stamp unit, a hundredth of a nuqta. */
function erased(ink: Polygon[], rings: Polygon[][]): Polygon[] {
  for (const grid of [0, 1 / 256, 1 / 32, 1 / 4]) {
    try {
      const [a, ...rest] = grid ? snap([ink, ...rings], grid) : [ink, ...rings];
      return difference(a as never, ...(rest as never[])) as unknown as Polygon[];
    } catch {
      // try the next grid
    }
  }
  throw new Error("studioStrokes: a stroke's erase rings could not be taken from its ink");
}

/** A stroke's ink: its pens swept and unioned, the erase rings taken away, the patches added, crumbs dropped. */
export function strokeInk(stroke: StudioStroke, pen: number, ppn: number): Polygon[] {
  let ink = unionPolygons(stroke.pens.filter((p) => p.length > 1).map((p) => sweepPath(penPathOf(p), pen)));
  if (stroke.erase?.length && ink.length) {
    ink = erased(ink, stroke.erase.map((r): Polygon[] => [[r]]));
  }
  if (stroke.patches?.length) {
    ink = unionPolygons([ink, ...stroke.patches.map((r): Polygon[] => [[r]])]);
  }
  const crumb = CRUMB * ppn * ppn;
  const biggest = Math.max(0, ...ink.map((poly) => ringArea(poly[0])));
  // the stroke's largest piece always stays, however small (741.s0 is a speck of a stroke)
  return ink.filter((poly) => ringArea(poly[0]) >= Math.min(crumb, biggest)).map((poly) => [poly[0], ...poly.slice(1).filter((h) => ringArea(h) >= crumb)]);
}

/** Problems that would draw a stroke wrongly or not at all, as "shape.stroke: what". */
export function validateStudioLibrary(lib: StudioLibrary): string[] {
  const out: string[] = [];
  for (const [id, shape] of Object.entries(lib.shapes)) {
    for (const st of shape.strokes) {
      const where = `${id}.${st.id}`;
      if (!st.pens.length) out.push(`${where}: no pen path`);
      else if (st.pens.some((p) => p.length < 2)) out.push(`${where}: a pen path of one node`);
      else if (st.pens.some((p) => p.some((n) => n.length < 3 || n.some((v) => !Number.isFinite(v))))) out.push(`${where}: a bad node`);
    }
  }
  return out;
}

/** Each stroke's ink for a whole shape, in the shape's stroke order. */
export function shapeInk(lib: StudioLibrary, shapeId: string): { id: string; recipe: string; iou?: number; ink: Polygon[] }[] {
  return lib.shapes[shapeId].strokes.map((st) => ({ id: st.id, recipe: st.recipe, iou: st.iou, ink: strokeInk(st, lib.pen, lib.ppn) }));
}

/** Polygons as an SVG path (draw with fill-rule evenodd), to a hundredth of a unit. */
export function polygonsPath(polys: Polygon[]): string {
  const n = (v: number) => String(Math.round(v * 100) / 100);
  return polys.map((poly) => poly.map((r) => "M" + r.map((p) => `${n(p[0])} ${n(p[1])}`).join("L") + "Z").join("")).join("");
}

const FORMS = ["Isolated", "Isolated & Final", "Initial", "Initial & Medial", "Medial", "Final", "Pairs"];

/** The library's shapes by letter, in the studio's order of letters (each by its first shape that is not a pair),
 *  each letter's shapes by form, then variant, the halves of the studio's pairs last. */
export function studioGroups(lib: StudioLibrary): { group: string; shapes: string[] }[] {
  const by = new Map<string, string[]>();
  for (const id of Object.keys(lib.shapes).sort()) {
    const g = lib.shapes[id].group;
    if (!by.has(g)) by.set(g, []);
    by.get(g)!.push(id);
  }
  const first = (ids: string[]) => ids.find((id) => lib.shapes[id].form !== "Pairs" && !lib.shapes[id].pairOf) ?? ids[0];
  const rank = (id: string) => {
    const s = lib.shapes[id], f = FORMS.indexOf(s.form);
    return [s.pairOf ? 1 : 0, f < 0 ? FORMS.length : f, s.variant ?? 0];
  };
  const cmp = (a: string, b: string) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return a < b ? -1 : a > b ? 1 : 0;
  };
  return [...by.entries()]
    .sort((a, b) => (first(a[1]) < first(b[1]) ? -1 : 1))
    .map(([group, ids]) => ({ group, shapes: [...ids].sort(cmp) }));
}
