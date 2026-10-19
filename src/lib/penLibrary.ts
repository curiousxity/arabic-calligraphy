/**
 * The stroke library: Thuluth letter forms built from named, shared parts,
 * as pen paths in nuqta units. A form's body parts, in writing order, are
 * concatenated into one path (the stroke a connected word runs through);
 * its other parts are separate strokes or drawn shapes (filled, not swept:
 * the alif's head, the ain's crescent). The data is JSON in ./penData,
 * authored with scripts/pen/preview.mjs and approved by the user in
 * scripts/pen/REVIEW.md; no stroke coordinates live in TypeScript. Pure;
 * must not import ./harfbuzz. See .claude/rules/tarkib.md.
 */
import partsData from "./penData/parts.json";
import formsData from "./penData/forms.json";
import joinsData from "./penData/joins.json";
import type { NibNode, PenPath, Polygon, Pt } from "./penSweep";
import { flattenContours } from "./strokeCuts";
import { parseSvgPath } from "./svgPath";
import type { LetterForm } from "./tarkibText";

/** Units per pen width (the mark library's scale). */
export const PEN = 48;
/** The rhombic dot, measured on its long diagonal: the nib (25.5 px on the
 *  book plate) pulled 1.08 pens at DOT_PULL gives 1.65 pens (45 px); only
 *  that makes the 7-dot alif 12 pens tall, as on the plate. */
export const NUQTA = 1.65 * PEN;
/** Default nib angle (degrees, counter-clockwise from the baseline as the
 *  reader sees it) where a node gives none: the nib edge slopes down to the
 *  right. Measured 2026-10-19 on the book's alif plate: its dots' edges run
 *  at 147 and 70 degrees, its alif (direction -86) is 0.72 pen wide, which
 *  only a nib near 140-147 gives; the vector set agrees (flat entries 0.56 of
 *  a pen, the meem's falling tail a full pen). */
export const DEFAULT_ANGLE = 145;
/** The direction a dot is pulled (degrees, as DEFAULT_ANGLE), one pen long:
 *  the plate's dots are rhombi with edges at 147 and 70 degrees. */
export const DOT_PULL = 70;
/** Body parts meet within this many nuqta. */
const MEET = 0.01;

// All library coordinates below are nuqta, y down, origin on the baseline at the form's right edge.
export type LibNode = { p: Pt; angle?: number; width?: number; keep?: "a" | "b" };
export type LibPath = { start: LibNode; segs: { c1: Pt; c2: Pt; to: LibNode }[] };
/** `drawn`: closed SVG path "d" strings, filled rather than swept. */
export type Part = { id: string; name: string; paths?: LibPath[]; drawn?: string[] };
export type PlacedPart = { part: string; at: Pt; body?: true };
export type Form = {
  /** e.g. "ya.starting.1" */
  id: string;
  /** "ي"; "أ" draws "ا" plus the hamza part. */
  letter: string;
  form: LetterForm;
  /** The body parts, in writing order, are concatenated into one path. */
  parts: PlacedPart[];
  /** Dot centres. */
  dots?: Pt[];
  anchors: { above: Pt; below: Pt };
  /** Body segment index, and how many nuqta it may lengthen by. */
  stretch?: { seg: number; min: number; max: number }[];
};
/** Nuqta: leftward distance from exit to entry, and upward climb. */
export type JoinDefault = { gap: number; rise: number };
export type PenLibrary = { parts: Map<string, Part>; forms: Map<string, Form>; joins: Record<string, JoinDefault> };

let shipped: PenLibrary | null = null;
/** The library shipped in ./penData. */
export function loadPenLibrary(): PenLibrary {
  if (!shipped) {
    shipped = {
      parts: new Map((partsData as Part[]).map((p) => [p.id, p])),
      forms: new Map((formsData as Form[]).map((f) => [f.id, f])),
      joins: joinsData as Record<string, JoinDefault>,
    };
  }
  return shipped;
}

const near = (a: Pt, b: Pt, tol: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
const shift = (p: Pt, at: Pt): Pt => [p[0] + at[0], p[1] + at[1]];
const pathEnd = (p: LibPath): Pt => (p.segs.length ? p.segs[p.segs.length - 1].to.p : p.start.p);

/** Problems with a library, empty when sound. */
export function validateLibrary(lib: PenLibrary): string[] {
  const out: string[] = [];
  for (const part of lib.parts.values()) {
    (part.drawn ?? []).forEach((d, i) => {
      const cmds = parseSvgPath(d);
      if (cmds.length < 3 || cmds[0].type !== "M") out.push(`${part.id}: drawn shape ${i + 1} does not parse`);
    });
  }
  for (const f of lib.forms.values()) {
    const missing = f.parts.filter((pp) => !lib.parts.has(pp.part));
    for (const pp of missing) out.push(`${f.id}: no part ${pp.part}`);
    if (missing.length) continue;
    const body = f.parts.filter((pp) => pp.body);
    for (const pp of body) if (!lib.parts.get(pp.part)!.paths?.length) out.push(`${f.id}: body part ${pp.part} has no path`);
    for (let i = 1; i < body.length; i++) {
      const a = lib.parts.get(body[i - 1].part)!.paths?.[0], b = lib.parts.get(body[i].part)!.paths?.[0];
      if (a && b && !near(shift(pathEnd(a), body[i - 1].at), shift(b.start.p, body[i].at), MEET)) out.push(`${f.id}: body parts ${i} and ${i + 1} do not meet`);
    }
    const hasBody = body.length > 0;
    if (f.form === "middle" && !hasBody) out.push(`${f.id}: a middle form needs a body with an entry and an exit`);
    if (f.form === "starting" && !hasBody) out.push(`${f.id}: a starting form needs a body with an exit`);
    if (f.form === "finishing" && !hasBody) out.push(`${f.id}: a finishing form needs a body with an entry`);
  }
  for (const key of Object.keys(lib.joins)) {
    if (key === "*") continue;
    const [a, b] = key.split(">");
    if (!lib.forms.has(a) || !lib.forms.has(b)) out.push(`join ${key}: no such form`);
  }
  return out;
}

/** A library node in units, placed at `at` (units) after the part's own offset `off` (nuqta). */
const toNode = (n: LibNode, off: Pt, at: Pt): NibNode => ({
  p: [at[0] + (n.p[0] + off[0]) * NUQTA, at[1] + (n.p[1] + off[1]) * NUQTA],
  angle: n.angle ?? DEFAULT_ANGLE,
  ...(n.width !== undefined ? { width: n.width } : {}),
  ...(n.keep ? { keep: n.keep } : {}),
});
const toPath = (p: LibPath, off: Pt, at: Pt): PenPath => ({
  start: toNode(p.start, off, at),
  segs: p.segs.map((s) => ({ c1: toNode({ p: s.c1 }, off, at).p, c2: toNode({ p: s.c2 }, off, at).p, to: toNode(s.to, off, at) })),
});

/** A form's ink paths in units, placed at `at` (units): the body as one path, then the separate strokes. */
export function formPaths(lib: PenLibrary, formId: string, at: Pt): { body: PenPath | null; strokes: PenPath[]; drawn: Polygon[]; dots: PenPath[] } {
  const f = lib.forms.get(formId);
  if (!f) throw new Error(`no form ${formId}`);
  let body: PenPath | null = null;
  const strokes: PenPath[] = [], drawn: Polygon[] = [];
  for (const pp of f.parts) {
    const part = lib.parts.get(pp.part);
    if (!part) throw new Error(`${formId}: no part ${pp.part}`);
    const paths = part.paths ?? [];
    paths.forEach((p, i) => {
      const path = toPath(p, pp.at, at);
      if (pp.body && i === 0) body = body ? { start: body.start, segs: [...body.segs, ...path.segs] } : path;
      else strokes.push(path);
    });
    for (const d of part.drawn ?? []) {
      for (const c of flattenContours(parseSvgPath(d), 16)) drawn.push([c.map((q) => [at[0] + (q[0] + pp.at[0]) * NUQTA, at[1] + (q[1] + pp.at[1]) * NUQTA] as Pt)]);
    }
  }
  const dots = (f.dots ?? []).map((d) => dotPath([at[0] + d[0] * NUQTA, at[1] + d[1] * NUQTA]));
  return { body, strokes, drawn, dots };
}

/** One part on its own (a hamza, a sign), placed at `at` (units): its paths and drawn shapes. */
export function partPaths(lib: PenLibrary, partId: string, at: Pt): { strokes: PenPath[]; drawn: Polygon[] } {
  const part = lib.parts.get(partId);
  if (!part) throw new Error(`no part ${partId}`);
  const drawn: Polygon[] = [];
  for (const d of part.drawn ?? []) {
    for (const c of flattenContours(parseSvgPath(d), 16)) drawn.push([c.map((q) => [at[0] + q[0] * NUQTA, at[1] + q[1] * NUQTA] as Pt)]);
  }
  return { strokes: (part.paths ?? []).map((p) => toPath(p, [0, 0], at)), drawn };
}

/** The pen's own stamp at a dot centre: the nib pulled one pen width along DOT_PULL. */
function dotPath(c: Pt): PenPath {
  const a = (DOT_PULL * Math.PI) / 180, n: Pt = [Math.cos(a), -Math.sin(a)], h = PEN / 2;
  const p0: Pt = [c[0] - n[0] * h, c[1] - n[1] * h], p1: Pt = [c[0] + n[0] * h, c[1] + n[1] * h];
  const third = (t: number): Pt => [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
  return { start: { p: p0, angle: DEFAULT_ANGLE }, segs: [{ c1: third(1 / 3), c2: third(2 / 3), to: { p: p1, angle: DEFAULT_ANGLE } }] };
}

const unit = (v: Pt): Pt => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const differs = (a: Pt, b: Pt) => !near(a, b, 1e-9);

/** Where the pen enters a form's body, in units at the origin, and its direction of travel. */
export function formEntry(lib: PenLibrary, formId: string): { p: Pt; dir: Pt; angle: number } | null {
  const { body } = formPaths(lib, formId, [0, 0]);
  if (!body || !body.segs.length) return null;
  const s = body.segs[0], p = body.start.p;
  const next = differs(s.c1, p) ? s.c1 : differs(s.c2, p) ? s.c2 : s.to.p;
  return { p, dir: unit([next[0] - p[0], next[1] - p[1]]), angle: body.start.angle };
}

/** Where the pen leaves a form's body, in units at the origin, and its direction of travel. */
export function formExit(lib: PenLibrary, formId: string): { p: Pt; dir: Pt; angle: number } | null {
  const { body } = formPaths(lib, formId, [0, 0]);
  if (!body || !body.segs.length) return null;
  const s = body.segs[body.segs.length - 1], p = s.to.p;
  const prev = differs(s.c2, p) ? s.c2 : differs(s.c1, p) ? s.c1 : body.segs.length > 1 ? body.segs[body.segs.length - 2].to.p : body.start.p;
  return { p, dir: unit([p[0] - prev[0], p[1] - prev[1]]), angle: s.to.angle };
}
