/**
 * The tarkib piece schema: what each Thuluth piece in the mark library is
 * (its letters and their forms, read from its name) and where it can be
 * joined and stretched (generated geometry, `tarkibSchemaData.ts`, from
 * scripts/marks/thuluth/pieceSchema.py). Loaded on demand with the library.
 * Pure. See .claude/rules/tarkib.md.
 */
import { loadMarkGroups, type MarkItem } from "./markLibrary";
import { outlineBounds, type Pt } from "./strokeCuts";
import { splitAtCut } from "./stackGeometry";
import { squareCuts, stubArea, STUB_TOL } from "./tarkibEnds";
import { parseSvgPath, type SvgCmd } from "./svgPath";
import { analyzePhrase, LETTER_DOTS, skeletonFor, SKELETONS, type LetterForm } from "./tarkibText";

/** A cut in splitAtCut's frame, piece units. The angle is the writing
 *  direction there, so an entry keeps the far side and an exit the near. */
export type FaceCut = { cutX: number; angle: number; window?: { y: number; half: number }; /** The stroke's thickness there, when measured. */ thickness?: number; /** Square units of the old end the trim leaves standing (tarkibEnds.ts stubArea). */ stub?: number; /** Units in from where the letters meet (0: the designer's own flat end). */ depth?: number; /** The cut's two outline points, piece units (splitAtCut's face). */ ends?: [Pt, Pt] };
/** Where a piece may lengthen: a cut across a straight stroke; the `side`
 *  part moves away as the stroke grows, by `min`..`max` units. */
export type StretchZone = { cutX: number; angle: number; window?: { y: number; half: number }; side: "near" | "far"; min: number; max: number };
/** A join end: where the neighbouring letter meets the piece, the writing
 *  direction there, and, when the end is a flat cut, the cut that frees it
 *  for a spliced join (pieceSchema.py explains the two kinds). */
export type JoinEnd = { point: Pt; angle: number; face?: FaceCut; /** Trims at increasing depth (`face` among them): the composer picks per meeting (tarkibChain.ts). */ options?: FaceCut[] };
/** One piece's generated geometry (pieceSchema.py). */
export type PieceGeometry = {
  right?: JoinEnd; left?: JoinEnd;
  zones?: { cutX: number; angle: number; window?: { y: number; half: number }; length: number }[];
  dots: number;
  /** Rightmost ink in the lowest 30%: a stand-in middle form's entry. */
  foot?: Pt;
  reviewed?: boolean;
  noFreeEnd?: boolean;
  use?: PieceUse;
};
/** Where the user allows a form (schema-overrides.json): "never" composed
 *  (a special case, kept in the library), or only as the "opening" letter. */
export type PieceUse = "never" | "opening";
export type PieceSchema = {
  /** Schema id: the library id, or `<library id>@middle` for a stand-in. */
  id: string;
  /** The mark library item whose outline this is. */
  itemId: string;
  /** Reading order: each letter as drawn (`char`), its skeleton and form,
   *  and its mark anchors (piece units). */
  letters: { char: string; skeleton: string; form: LetterForm; above: Pt; below: Pt }[];
  entry?: JoinEnd;
  exit?: JoinEnd;
  stretch: StretchZone[];
  ownDots: boolean;
  noFreeEnd?: true;
  use?: PieceUse;
  reviewed: boolean;
  /** A starting form standing in for a middle form the library lacks
   *  (Part 2 of the vector set is mostly starting forms); the composer
   *  prefers a real one. */
  standIn?: true;
};
export type TarkibLibrary = {
  items: Map<string, MarkItem>;
  schema: Map<string, PieceSchema>;
  /** `${skeleton}|${form}` -> single-letter pieces, reviewed first, then the vector set. */
  single: Map<string, PieceSchema[]>;
  /** The first letter's `${skeleton}|${form}` -> multi-letter pieces. */
  multi: Map<string, PieceSchema[]>;
  nuqtaD: string;
};

const PEN = 48;
/** `StackBlock.source.fontFamily` of a block composed from the piece library:
 *  its letters come from no font. */
export const TARKIB_FONT = "thuluth-pieces";
/** The bundled font whose tashkeel fills a tarkib's gaps until the library
 *  has its own Thuluth vowel signs. */
export const TARKIB_SIGNS_FONT = "Thuluth";
/** Letters whose flat or tail stroke may lengthen anywhere along it. */
const FLATS = new Set(["ba", "seen", "sad", "ta", "fa", "kaf"]);
const TAILS = new Set(["ya", "nun", "ra", "waw", "qaf"]);
/** Elsewhere a straight stroke stretches only as the kashida beside a join. */
const KASHIDA_REACH = 2 * PEN;

const TATWEEL = "ـ";
const POSITIONS = ["standalone", "starting", "middle", "finishing"] as const;
const ARABIC = /[؀-ۿ][؀-ۿ\s]*/g;

/** The letters and forms a piece's library name says it draws; [] when
 *  the name says nothing readable. */
export function formsFromName(name: string): { char: string; skeleton: string; form: LetterForm }[] {
  // The vector set: "Ain, middle, 3 (ـعـ)".
  const v = /, (standalone|starting|middle|finishing), \d+ \(([^)]+)\)(, second set( \(\?\))?)?$/.exec(name);
  if (v && (POSITIONS as readonly string[]).includes(v[1])) {
    const ch = v[2].replaceAll(TATWEEL, "");
    if (!(ch in SKELETONS)) return [];
    return [{ char: ch, skeleton: skeletonFor(ch, v[1] as LetterForm), form: v[1] as LetterForm }];
  }
  // A scanned piece: the last Arabic in its name, tatweels marking joins.
  const groups = name.match(ARABIC);
  if (!groups) return [];
  const raw = groups[groups.length - 1].trim();
  if (raw.includes(" ")) return [];
  const joinsBefore = raw.startsWith(TATWEEL), joinsAfter = raw.endsWith(TATWEEL);
  const a = analyzePhrase(raw);
  if (a.unsupported.length || a.words.length !== 1 || a.words[0].runs.length !== 1) return [];
  const ls = a.words[0].runs[0].letters;
  return ls.map((l, k) => {
    let form = l.form;
    if (k === 0 && joinsBefore) form = form === "standalone" ? "finishing" : form === "starting" ? "middle" : form;
    if (k === ls.length - 1 && joinsAfter) form = form === "standalone" ? "starting" : form === "finishing" ? "middle" : form;
    return { char: l.char, skeleton: l.skeleton === "allah" ? "allah" : skeletonFor(l.char, form), form };
  });
}

const boxArea = (cmds: SvgCmd[]) => { const b = outlineBounds(cmds); return (b.x2 - b.x1) * (b.y2 - b.y1); };

/** Units each end of a join is trimmed back from where the letters meet:
 *  the connection is redrawn as a pen stroke across the gap (about a pen
 *  long), bending from one end's direction into the other's, so a seam is
 *  never two inks overlapping at an angle (the user: "the joints need to be
 *  smooth. that is essential"). */
export const JOIN_TRIM = PEN / 2;
/** Radians: a designer's flat end within this of square across the stroke is joined at. */
const FLAT_SQUARE = 0.45;
/** The trims offered per end, units: the composer takes the shallowest pair
 *  that leaves the bridge room to taper and turn (tarkibChain.ts). */
export const JOIN_DEPTHS = [PEN / 4, PEN / 2, (3 * PEN) / 4, PEN, 1.5 * PEN];
/** A trim more than this many times as wide as the shallowest at its end
 *  cuts across a junction, and is not offered. */
const JUNCTION = 1.3;
/** Window half-widths tried, as (factor, added units): up to half a pen more. */
const WINDOW_GROWTH: [number, number][] = [[1, 0], [1.25, 0], [1.5, 0], [1.5, 12], [1.5, 24]];
const contourCount = (cmds: SvgCmd[]) => cmds.filter((c) => c.type === "M").length;

/**
 * The cut that frees a join end for a spliced pen stroke, trimmed JOIN_TRIM
 * back into the piece (less where that will not cut): square across the
 * stroke as measured (tarkibEnds.ts), else, failing that, tried from the
 * generator's face (the flat edge the designer cut) and then from the
 * meeting point itself, so an end with no flat edge is trimmed too. A cut is
 * kept only if splitAtCut accepts it, the part kept is the larger, and the
 * kept part has every contour the piece had: a cut that takes a meem's
 * window with it is refused. Each window is widened in steps (the generator
 * sized it to the flat edge, and a tapering stroke is wider a little inside)
 * and the narrowest that splits is kept, so a cut never reaches a
 * neighbouring stroke. An end no cut frees still joins by touch.
 */
function joinEnd(cmds: SvgCmd[], end: JoinEnd | undefined, keep: "near" | "far"): JoinEnd | undefined {
  if (!end) return end;
  const n = contourCount(cmds);
  const deeper = keep === "far" ? 1 : -1;     // an entry keeps the far side, an exit the near
  const c = Math.cos(end.angle), s = Math.sin(end.angle);
  const accepts = (face: FaceCut) => {
    const r = splitAtCut(cmds, face);
    if (!r) return false;
    const kept = keep === "far" ? r.far : r.near, dropped = keep === "far" ? r.near : r.far;
    return boxArea(kept) > boxArea(dropped) && contourCount(kept) === n;
  };
  // A trim that runs out through the designer's slanted end leaves that
  // end's corner standing beside the bridge, a step (tarkibEnds.ts leavesStub).
  const graded = (face: FaceCut): FaceCut => {
    const r = splitAtCut(cmds, face)!, t: Pt = [Math.cos(face.angle), Math.sin(face.angle)];
    return { ...face, ends: [r.nearFace.a, r.nearFace.b], stub: stubArea(keep === "far" ? r.far : r.near, r.nearFace, keep === "far" ? t : [-t[0], -t[1]]) };
  };
  const clean = (face: FaceCut) => (face.stub ?? 0) <= STUB_TOL;
  // First choice: square across the stroke as measured (tarkibEnds.ts), at
  // every depth the composer may pick from.
  const inward: Pt = [deeper * c, deeper * s];
  // Where the designer cut the end flat, the walk starts from that edge's
  // middle: the meeting point may sit at one corner of it, and a cut from a
  // corner runs diagonally and leaves the rest of the end standing.
  const g = end.face, gc = Math.cos(g?.angle ?? 0), gs = Math.sin(g?.angle ?? 0);
  const start: Pt = g?.window ? [g.cutX * gc - g.window.y * gs, g.cutX * gs + g.window.y * gc] : end.point;
  const cuts = squareCuts(cmds, start, inward, JOIN_DEPTHS, keep === "near");
  const found = cuts.map((f, i) => (f && accepts(f) ? { f: { ...graded(f), depth: JOIN_DEPTHS[i] } as FaceCut, depth: JOIN_DEPTHS[i] } : null)).filter((o): o is { f: FaceCut; depth: number } => !!o);
  // a cut far wider than the shallowest crossed a junction, not the stroke
  // (the ha's deep cuts ran across its crossing, 65 and 100 wide on a 46 stroke)
  const all = found.filter((o) => (o.f.thickness ?? 0) <= JUNCTION * (found[0].f.thickness ?? Infinity));
  // only the clean trims, where there is any; else all (a step beats no splice)
  const tidy = all.filter((o) => clean(o.f)), ok = tidy.length ? tidy : all;
  // The designer's own flat end, where there is one and it lies square
  // across the stroke as measured: the join is made right there (a trim
  // inside it left the end's corner standing as a step).
  let flat: FaceCut | null = null;
  if (g?.window && ok.length) {
    const w = g.window;
    for (const half of WINDOW_GROWTH.map((k) => w.half * k[0] + k[1])) {
      const f: FaceCut = { ...g, window: { y: w.y, half }, thickness: ok[0].f.thickness };
      if (accepts(f)) { flat = { ...graded(f), depth: 0 }; break; }
    }
    if (flat && (angleGap(flat.angle, ok[0].f.angle) > FLAT_SQUARE || (tidy.length && !clean(flat)))) flat = null;
  }
  if (flat) return { ...end, face: flat, options: [flat, ...(tidy.length || !clean(flat) ? ok : []).map((o) => o.f)] };
  if (ok.length) return { ...end, face: (ok.find((o) => o.depth >= JOIN_TRIM) ?? ok[ok.length - 1]).f, options: ok.map((o) => o.f) };
  const atMeeting: FaceCut = {
    cutX: end.point[0] * c + end.point[1] * s, angle: end.angle,
    window: { y: -end.point[0] * s + end.point[1] * c, half: 0.75 * PEN },
  };
  for (const base of end.face ? [end.face, atMeeting] : [atMeeting]) {
    const w = base.window;
    for (const depth of [JOIN_TRIM, JOIN_TRIM / 2, 0]) {
      for (const half of w ? WINDOW_GROWTH.map((g) => w.half * g[0] + g[1]) : [0]) {
        const face: FaceCut = { ...base, cutX: base.cutX + deeper * depth, ...(w ? { window: { y: w.y, half } } : {}) };
        if (accepts(face)) return { ...end, face: { ...graded(face), depth } };
      }
    }
  }
  return { point: end.point, angle: end.angle };
}

/** Smallest difference between two angles, radians. */
const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The vector set's Part 2 (ids thuluth-v2-) was split into starting and
 *  middle forms by an automatic guess (REVIEW.md); its join faces settle it:
 *  a joined piece touched by a previous letter is middle, else starting. */
const PROVISIONAL_FORMS = "thuluth-v2-";
/** The second bought set draws every dotted letter with its dots. Its pairs
 *  and triples touch, one shape, which the generator's one-dot test cannot
 *  count, so the letter's own spelling says it. */
const DOTTED_SOURCE = "thuluth-w";

function schemaOf(item: MarkItem, g: PieceGeometry | undefined): PieceSchema {
  const cmds = parseSvgPath(item.d);
  let forms = formsFromName(item.name);
  if (item.id.startsWith(PROVISIONAL_FORMS) && forms.length === 1 && (forms[0].form === "starting" || forms[0].form === "middle")) {
    const form: LetterForm = g?.right ? "middle" : "starting";
    forms = [{ ...forms[0], form }];
  }
  const first = forms[0]?.form, last = forms[forms.length - 1]?.form;
  const entry = first === "middle" || first === "finishing" ? joinEnd(cmds, g?.right, "far") : undefined;
  const exit = last === "starting" || last === "middle" ? joinEnd(cmds, g?.left, "near") : undefined;
  // Mark anchors: each letter's share of the ink, right to left, half a pen clear.
  const n = Math.max(forms.length, 1);
  const letters = forms.map((f, k) => {
    const cx = item.w / 2 - (item.w * (k + 0.5)) / n;
    return { ...f, above: [cx, -item.h / 2 - PEN / 2] as Pt, below: [cx, item.h / 2 + PEN / 2] as Pt };
  });
  const stretch: StretchZone[] = [];
  for (const z of g?.zones ?? []) {
    const skel = forms.map((f) => f.skeleton);
    const tail = skel.some((s) => TAILS.has(s));
    const flat = skel.some((s) => FLATS.has(s));
    const nearJoin = [entry?.face, exit?.face].some((f) => f && Math.abs(f.cutX - z.cutX) < KASHIDA_REACH && angleGap(f.angle, z.angle) < 0.6);
    if (!flat && !tail && !nearJoin) continue;
    stretch.push({ cutX: z.cutX, angle: z.angle, ...(z.window ? { window: z.window } : {}), side: "far", min: 0, max: tail && !flat ? 3 * PEN : 4 * PEN });
  }
  return {
    id: item.id, itemId: item.id, letters, ...(entry ? { entry } : {}), ...(exit ? { exit } : {}), stretch,
    ownDots: (g?.dots ?? 0) > 0 || (item.id.startsWith(DOTTED_SOURCE) && forms.some((f) => (LETTER_DOTS[f.char]?.count ?? 0) > 0)),
    ...(g?.noFreeEnd ? { noFreeEnd: true as const } : {}), ...(g?.use ? { use: g.use } : {}), reviewed: g?.reviewed ?? false,
  };
}

/**
 * Whether piece letter `i` can draw `letter`: same skeleton and form, and,
 * when the piece draws its own dots, the very same letter (the second set's
 * ـجـ must not be written for ـحـ, nor a dotted ي for ئ). A dotless piece
 * serves every letter of its skeleton; the composer adds the dots.
 */
export function canDraw(s: PieceSchema, i: number, letter: { char: string; skeleton: string; form: LetterForm }): boolean {
  const l = s.letters[i];
  return !!l && l.skeleton === letter.skeleton && l.form === letter.form && (!s.ownDots || l.char === letter.char);
}

/** Whether a piece has every face its forms need, so it can sit in a chain. */
function joinable(s: PieceSchema): boolean {
  if (!s.letters.length) return false;
  const first = s.letters[0].form, last = s.letters[s.letters.length - 1].form;
  if ((first === "middle" || first === "finishing") && !s.entry) return false;
  if ((last === "starting" || last === "middle") && !s.exit) return false;
  return true;
}

let pending: Promise<TarkibLibrary> | null = null;

/** The library and its schema, fetched once (two chunks) and kept. */
export function loadTarkibLibrary(): Promise<TarkibLibrary> {
  pending ??= Promise.all([loadMarkGroups(), import("./tarkibSchemaData")]).then(([groups, data]) => {
    const thuluth = groups.find((g) => g.id === "thuluth")?.items ?? [];
    const items = new Map(thuluth.map((i) => [i.id, i]));
    const schema = new Map(thuluth.map((i) => [i.id, schemaOf(i, data.PIECE_GEOMETRY[i.id])]));
    const single = new Map<string, PieceSchema[]>(), multi = new Map<string, PieceSchema[]>();
    for (const s of schema.values()) {
      if (!joinable(s)) continue;
      const key = `${s.letters[0].skeleton}|${s.letters[0].form}`;
      const m = s.letters.length === 1 ? single : multi;
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    // A letter with no middle form borrows its starting forms, entered at the foot.
    for (const [key, list] of [...single]) {
      const [skeleton, form] = key.split("|");
      if (form !== "starting" || single.has(`${skeleton}|middle`)) continue;
      const stand = list.flatMap((s): PieceSchema[] => {
        const foot = data.PIECE_GEOMETRY[s.id]?.foot;
        return foot ? [{ ...s, id: `${s.id}@middle`, letters: [{ ...s.letters[0], form: "middle" }], entry: { point: foot, angle: Math.PI }, standIn: true }] : [];
      });
      if (stand.length) single.set(`${skeleton}|middle`, stand);
      for (const s of stand) schema.set(s.id, s);
    }
    const rank = (s: PieceSchema) => (s.reviewed ? 0 : 2) + (s.id.startsWith("thuluth-v") ? 0 : 1);
    for (const m of [single, multi]) for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b));
    return { items, schema, single, multi, nuqtaD: data.NUQTA_D };
  });
  return pending;
}
