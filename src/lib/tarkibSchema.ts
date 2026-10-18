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
import { parseSvgPath, type SvgCmd } from "./svgPath";
import { analyzePhrase, skeletonFor, SKELETONS, type LetterForm } from "./tarkibText";

/** A cut in splitAtCut's frame, piece units. The angle is the writing
 *  direction there, so an entry keeps the far side and an exit the near. */
export type FaceCut = { cutX: number; angle: number; window?: { y: number; half: number } };
/** Where a piece may lengthen: a cut across a straight stroke; the `side`
 *  part moves away as the stroke grows, by `min`..`max` units. */
export type StretchZone = { cutX: number; angle: number; window?: { y: number; half: number }; side: "near" | "far"; min: number; max: number };
/** A join end: where the neighbouring letter meets the piece, the writing
 *  direction there, and, when the end is a flat cut, the cut that frees it
 *  for a spliced join (pieceSchema.py explains the two kinds). */
export type JoinEnd = { point: Pt; angle: number; face?: FaceCut };
/** One piece's generated geometry (pieceSchema.py). */
export type PieceGeometry = {
  right?: JoinEnd; left?: JoinEnd;
  zones?: { cutX: number; angle: number; window?: { y: number; half: number }; length: number }[];
  dots: number;
  /** Rightmost ink in the lowest 30%: a stand-in middle form's entry. */
  foot?: Pt;
  reviewed?: boolean;
  noFreeEnd?: boolean;
};
export type PieceSchema = {
  id: string;
  /** Reading order, with each letter's mark anchors (piece units). */
  letters: { skeleton: string; form: LetterForm; above: Pt; below: Pt }[];
  entry?: JoinEnd;
  exit?: JoinEnd;
  stretch: StretchZone[];
  ownDots: boolean;
  noFreeEnd?: true;
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
export function formsFromName(name: string): { skeleton: string; form: LetterForm }[] {
  // The vector set: "Ain, middle, 3 (ـعـ)".
  const v = /, (standalone|starting|middle|finishing), \d+ \(([^)]+)\)$/.exec(name);
  if (v && (POSITIONS as readonly string[]).includes(v[1])) {
    const ch = v[2].replaceAll(TATWEEL, "");
    if (!(ch in SKELETONS)) return [];
    return [{ skeleton: skeletonFor(ch, v[1] as LetterForm), form: v[1] as LetterForm }];
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
    return { skeleton: l.skeleton === "allah" ? "allah" : skeletonFor(l.char, form), form };
  });
}

const boxArea = (cmds: SvgCmd[]) => { const b = outlineBounds(cmds); return (b.x2 - b.x1) * (b.y2 - b.y1); };

/** A generated face is kept only if splitAtCut accepts it and the part it
 *  keeps is the larger: the generator measures pixels, splitAtCut decides.
 *  An end whose face fails still joins by touch, it just cannot be spliced. */
function legal(cmds: SvgCmd[], end: JoinEnd | undefined, keep: "near" | "far"): JoinEnd | undefined {
  if (!end?.face) return end;
  const r = splitAtCut(cmds, end.face);
  const ok = r && (keep === "far" ? boxArea(r.far) > boxArea(r.near) : boxArea(r.near) > boxArea(r.far));
  return ok ? end : { point: end.point, angle: end.angle };
}

/** Smallest difference between two angles, radians. */
const angleGap = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** The vector set's Part 2 (ids thuluth-v2-) was split into starting and
 *  middle forms by an automatic guess (REVIEW.md); its join faces settle it:
 *  a joined piece touched by a previous letter is middle, else starting. */
const PROVISIONAL_FORMS = "thuluth-v2-";

function schemaOf(item: MarkItem, g: PieceGeometry | undefined): PieceSchema {
  const cmds = parseSvgPath(item.d);
  let forms = formsFromName(item.name);
  if (item.id.startsWith(PROVISIONAL_FORMS) && forms.length === 1 && (forms[0].form === "starting" || forms[0].form === "middle")) {
    const form: LetterForm = g?.right ? "middle" : "starting";
    forms = [{ ...forms[0], form }];
  }
  const first = forms[0]?.form, last = forms[forms.length - 1]?.form;
  const entry = first === "middle" || first === "finishing" ? legal(cmds, g?.right, "far") : undefined;
  const exit = last === "starting" || last === "middle" ? legal(cmds, g?.left, "near") : undefined;
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
    id: item.id, letters, ...(entry ? { entry } : {}), ...(exit ? { exit } : {}), stretch,
    ownDots: (g?.dots ?? 0) > 0, ...(g?.noFreeEnd ? { noFreeEnd: true as const } : {}), reviewed: g?.reviewed ?? false,
  };
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
        return foot ? [{ ...s, letters: [{ ...s.letters[0], form: "middle" }], entry: { point: foot, angle: Math.PI }, standIn: true }] : [];
      });
      if (stand.length) single.set(`${skeleton}|middle`, stand);
    }
    const rank = (s: PieceSchema) => (s.reviewed ? 0 : 2) + (s.id.startsWith("thuluth-v") ? 0 : 1);
    for (const m of [single, multi]) for (const list of m.values()) list.sort((a, b) => rank(a) - rank(b));
    return { items, schema, single, multi, nuqtaD: data.NUQTA_D };
  });
  return pending;
}
