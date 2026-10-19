/**
 * What the authoring preview draws (scripts/pen/preview.mjs, overlay.py):
 * the ink of library forms, or of a phrase, in a reference plate's pixels,
 * with each form's centre lines and nodes, so a drafted stroke can be
 * checked against the plate it was drawn from. Pure. See .claude/rules/tarkib.md.
 */
import { formPaths, NUQTA, PEN, type PenLibrary } from "./penLibrary";
import { defaultLayout, layoutGeometry } from "./penLayout";
import { sweepPath, type PenPath, type Polygon, type Pt } from "./penSweep";
import { flattenContours } from "./strokeCuts";

/** Where library units land on a plate: the form's origin in plate pixels, and the plate's scale. */
export type PlateRef = { file: string; originPx: Pt; pxPerNuqta: number };
export type Preview = {
  /** Per stroke, its rings, in plate pixels. */
  strokes: Pt[][][];
  /** Each path's centre line, in plate pixels. */
  centre: Pt[][];
  /** Each path's nodes, in plate pixels. */
  nodes: Pt[];
  /** The sheet's size in pixels: the plate's for a plate (0 = use the image), a blank sheet's otherwise. */
  size: Pt;
};

/** Scale of a blank sheet, px per nuqta, and its margin. */
const BLANK_PX = 40;
const MARGIN = 40;
/** Nuqta between forms laid side by side. */
const SIDE_GAP = 2;

const bezAt = (a: Pt, b: Pt, c: Pt, d: Pt, t: number): Pt => {
  const u = 1 - t;
  return [u * u * u * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t * t * t * d[0], u * u * u * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t * t * t * d[1]];
};
function centreLine(p: PenPath): Pt[] {
  const out: Pt[] = [p.start.p];
  let from = p.start.p;
  for (const s of p.segs) {
    for (let i = 1; i <= 32; i++) out.push(bezAt(from, s.c1, s.c2, s.to.p, i / 32));
    from = s.to.p;
  }
  return out;
}

type Units = { inks: Polygon[][]; centre: Pt[][]; nodes: Pt[] };

function formUnits(lib: PenLibrary, id: string, at: Pt): Units {
  const f = formPaths(lib, id, at);
  const paths = [...(f.body ? [f.body] : []), ...f.strokes, ...f.dots];
  return {
    inks: [...paths.map((p) => sweepPath(p, PEN)), ...f.drawn.map((d) => [d])],
    centre: paths.map(centreLine),
    nodes: paths.flatMap((p) => [p.start.p, ...p.segs.map((s) => s.to.p)]),
  };
}

function bounds(u: Units): { x1: number; y1: number; x2: number; y2: number } {
  const pts = [...u.inks.flat(3), ...u.nodes];
  return { x1: Math.min(...pts.map((p) => p[0])), y1: Math.min(...pts.map((p) => p[1])), x2: Math.max(...pts.map((p) => p[0])), y2: Math.max(...pts.map((p) => p[1])) };
}

function toPreview(u: Units, origin: Pt, pxPerNuqta: number, size: Pt): Preview {
  const px = (q: Pt): Pt => [origin[0] + (q[0] / NUQTA) * pxPerNuqta, origin[1] + (q[1] / NUQTA) * pxPerNuqta];
  return {
    strokes: u.inks.map((polys) => polys.flatMap((poly) => poly.map((ring) => ring.map(px)))),
    centre: u.centre.map((l) => l.map(px)),
    nodes: u.nodes.map(px),
    size,
  };
}

/** Units laid on a blank sheet that holds them, MARGIN px all round. */
function onBlank(u: Units): Preview {
  const b = bounds(u);
  const origin: Pt = [MARGIN - (b.x1 / NUQTA) * BLANK_PX, MARGIN - (b.y1 / NUQTA) * BLANK_PX];
  return toPreview(u, origin, BLANK_PX, [((b.x2 - b.x1) / NUQTA) * BLANK_PX + 2 * MARGIN, ((b.y2 - b.y1) / NUQTA) * BLANK_PX + 2 * MARGIN]);
}

/** Ink of forms in a plate's pixels, for the overlay: per-stroke polygons plus each form's centre lines and nodes.
 *  On a plate the forms are drawn on its origin; with no plate they sit side by side, right to left, on a blank sheet. */
export function previewForms(lib: PenLibrary, formIds: string[], plate: PlateRef | null): Preview {
  if (plate) {
    const all: Units = { inks: [], centre: [], nodes: [] };
    for (const id of formIds) { const u = formUnits(lib, id, [0, 0]); all.inks.push(...u.inks); all.centre.push(...u.centre); all.nodes.push(...u.nodes); }
    return toPreview(all, plate.originPx, plate.pxPerNuqta, [0, 0]);
  }
  const all: Units = { inks: [], centre: [], nodes: [] };
  let cursor = 0;
  for (const id of formIds) {
    const probe = bounds(formUnits(lib, id, [0, 0]));
    const at: Pt = [cursor - probe.x2, 0];
    const u = formUnits(lib, id, at);
    all.inks.push(...u.inks); all.centre.push(...u.centre); all.nodes.push(...u.nodes);
    cursor = at[0] + probe.x1 - SIDE_GAP * NUQTA;
  }
  return onBlank(all);
}

/** A phrase as the app draws it (default layout), per stroke, on a blank sheet. */
export function previewPhrase(lib: PenLibrary, phrase: string): Preview | { missing: string[] } {
  const layout = defaultLayout(lib, phrase);
  if ("missing" in layout) return layout;
  const g = layoutGeometry(lib, layout);
  const inks: Polygon[][] = g.strokes.map((cmds) => flattenContours(cmds, 32).map((c) => [c as Pt[]]));
  return onBlank({ inks, centre: [], nodes: [] });
}
