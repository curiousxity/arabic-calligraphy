/**
 * Evaluates a text for a Kufi star panel and offers ways to split it over
 * the regions (`.claude/rules/kufi-star.md`, "Evaluation"). Each pattern is
 * tried on every fold and each `STAR_KS` star, at sizes 12 to 60 in steps of
 * 2; an offer fits at the first size where every region with text packs.
 *
 * Packs are slow (up to ~1.4 s each), so they are cached across calls by the
 * region's mask and the text (the mask is what fold, k, size and kind decide),
 * and the whole call is bounded: by `budgetMs` on the clock, or, under the
 * tests' clock override, by `STAR_EVAL_MAX_TRIES` packs, so a test's
 * answer never depends on machine load. The work runs likeliest first
 * (classic star before the alternative, repeat and alternate before run,
 * corners and centre), so a cut still leaves the best offers.
 * Pure: no React, no Konva, no `./harfbuzz`.
 */
import { kufiClockOverridden, packKufiRegion, type KufiMask, type KufiPackResult } from "./kufiPack";
import { STAR_KS, starConstruction, type StarConstruction, type StarFold, type StarRegionKind } from "./kufiStarGeometry";
import type { KufiStarInputs, KufiStarLayout } from "./kufiStarLayout";
import { resolveKufiText } from "./kufiWords";

export type KufiStarPattern = "repeat" | "alternate" | "run" | "corners" | "centre";

export type KufiStarOffer = {
  /** What approving it sets. */
  inputs: KufiStarInputs;
  pattern: KufiStarPattern;
  fits: boolean;
  /** Plain words: what goes where, and what does not fit. */
  note: string;
  /** Summed over every region with text; size is `inputs.size`. */
  quality: { squares: number; bars: number; size: number };
  /** The packed regions, for the preview (and the layout cache on approval). */
  layout: KufiStarLayout;
};

export type KufiStarEvaluation = {
  words: Array<{ text: string; drawable: boolean }>;
  /** Fitting offers first, best first; then the closest that do not fit. At most `STAR_MAX_OFFERS`. */
  offers: KufiStarOffer[];
  /** What could not be offered, e.g. a run round a fold that needs more words. */
  notes: string[];
  /** False when the budget ended the search before every pattern was tried. */
  complete: boolean;
};

export const STAR_MAX_OFFERS = 6;
export const STAR_MIN_SIZE = 12;
export const STAR_MAX_SIZE = 60;
/** The size an offer takes when none of its texts fits a region at any size: a new star's. */
const STAR_NO_FIT_SIZE = 24;
const SIZE_STEP = 2;
/** Under the clock override, the evaluation stops after this many packs (cache hits are free). */
export const STAR_EVAL_MAX_TRIES = 60;
/** Pack results kept between calls. */
const PACK_CACHE_LIMIT = 2000;

const FOLDS: StarFold[] = [4, 5, 6];
const KIND_WORDS: Record<StarRegionKind, string> = {
  centre: "the centre",
  wedgeA: "a wedge",
  wedgeB: "a wedge",
  corner: "a corner",
};

const packCache = new Map<string, KufiPackResult>();
const constructions = new Map<string, StarConstruction>();

const maskKey = (m: KufiMask) => `${m.cols}x${m.rows}:${m.cells.join("")}`;

function constructionOf(fold: StarFold, k: number, size: number): StarConstruction {
  const key = `${fold}/${k}@${size}`;
  let c = constructions.get(key);
  if (!c) {
    c = starConstruction(fold, k, size);
    constructions.set(key, c);
  }
  return c;
}

/** Letters a word draws (ﷲ counts its four), the measure "shortest" and "longest" use. */
function letters(word: string): number {
  return resolveKufiText(word).units.reduce((n, u) => n + (u.skeleton === "allah" ? 4 : u.skeleton === "lamAlef" ? 2 : 1), 0);
}

/** The text split into words, each drawable when every character of it has a Kufi form. */
export function kufiStarWords(text: string): Array<{ text: string; drawable: boolean }> {
  return text
    .split(/\s+/)
    .filter((w) => w !== "")
    .map((w) => {
      const r = resolveKufiText(w);
      return { text: w, drawable: r.unsupported.length === 0 && r.units.length > 0 };
    });
}

/** A pattern's region texts for one fold: index → text ("" for pattern only). */
type Plan = { pattern: KufiStarPattern; regions: (fold: StarFold) => string[]; describe: string };

const blank = (fold: StarFold) => Array.from({ length: 1 + 3 * fold }, () => "");
const isWedgeA = (i: number) => i % 2 === 1;

function fillWedges(r: string[], fold: StarFold, a: string, b: string) {
  for (let i = 1; i <= 2 * fold; i++) r[i] = isWedgeA(i) ? a : b;
}

/** Two words or more: the first half of the words in the A wedges, the rest in the B wedges, so a pair of neighbours reads in order. */
function halves(words: string[]): [string, string] {
  const h = Math.ceil(words.length / 2);
  return [words.slice(0, h).join(" "), words.slice(h).join(" ")];
}

function wedgesBy(r: string[], fold: StarFold, words: string[]) {
  if (words.length >= 2) {
    const [a, b] = halves(words);
    fillWedges(r, fold, a, b);
  } else if (words.length === 1) fillWedges(r, fold, words[0], words[0]);
}

function restOf(words: string[], pick: number): string[] {
  return words.filter((_, i) => i !== pick);
}

function plansFor(words: string[]): { early: Plan[]; late: Plan[]; runNeeds: (fold: StarFold) => number } {
  const whole = words.join(" ");
  const early: Plan[] = [
    {
      pattern: "repeat",
      describe: `${whole} in every wedge`,
      regions: (fold) => {
        const r = blank(fold);
        fillWedges(r, fold, whole, whole);
        return r;
      },
    },
  ];
  if (words.length >= 2) {
    const [a, b] = halves(words);
    early.push({
      pattern: "alternate",
      describe: `${a} and ${b} in turn round the wedges`,
      regions: (fold) => {
        const r = blank(fold);
        fillWedges(r, fold, a, b);
        return r;
      },
    });
  }
  const late: Plan[] = [];
  late.push({
    pattern: "run",
    describe: "the words once round the wedges, clockwise from the top",
    regions: (fold) => {
      const m = 2 * fold;
      const r = blank(fold);
      // m consecutive groups, the earlier ones a word longer when they do not divide evenly
      let at = 0;
      for (let g = 0; g < m; g++) {
        const take = Math.floor(words.length / m) + (g < words.length % m ? 1 : 0);
        r[1 + g] = words.slice(at, at + take).join(" ");
        at += take;
      }
      return r;
    },
  });
  if (words.length >= 2) {
    let shortest = 0, longest = 0;
    words.forEach((w, i) => {
      if (letters(w) < letters(words[shortest])) shortest = i;
      if (letters(w) > letters(words[longest])) longest = i;
    });
    const cornerRest = restOf(words, shortest);
    late.push({
      pattern: "corners",
      describe: `${words[shortest]} in the corners`,
      regions: (fold) => {
        const r = blank(fold);
        for (let j = 1; j <= fold; j++) r[2 * fold + j] = words[shortest];
        wedgesBy(r, fold, cornerRest);
        return r;
      },
    });
    const centreRest = restOf(words, longest);
    late.push({
      pattern: "centre",
      describe: `${words[longest]} in the centre`,
      regions: (fold) => {
        const r = blank(fold);
        r[0] = words[longest];
        wedgesBy(r, fold, centreRest);
        return r;
      },
    });
  }
  return { early, late, runNeeds: (fold) => 2 * fold - words.length };
}

class OutOfBudget extends Error {}

type Clock = { tries: number; over: () => boolean };

/** A region's pack, from the cache or packed now; only a real pack counts as a try, and none starts once the budget is spent. */
function lookup(clock: Clock, mask: KufiMask, text: string): KufiPackResult {
  const key = `${maskKey(mask)}|${text}`;
  const hit = packCache.get(key);
  if (hit) return hit;
  if (clock.over()) throw new OutOfBudget();
  clock.tries++;
  const r = packKufiRegion({ text, mask });
  packCache.set(key, r);
  if (packCache.size > PACK_CACHE_LIMIT) packCache.delete(packCache.keys().next().value!);
  return r;
}

type Part = { kind: StarRegionKind; text: string };

/** The distinct (kind, text) pairs of a region list: one pack serves every region of a kind. */
function partsOf(c: StarConstruction, regions: string[]): Part[] {
  const seen = new Set<string>();
  const out: Part[] = [];
  for (const r of c.regions) {
    const text = regions[r.index] ?? "";
    if (text.trim() === "") continue;
    const id = `${r.kind}|${text}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ kind: r.kind, text });
  }
  return out;
}

function firstMask(c: StarConstruction, kind: StarRegionKind): KufiMask {
  return c.regions.find((r) => r.kind === kind)!.mask;
}

/**
 * The first size at which `text` packs a region of `kind`, or null. A region
 * that reports `tooShort` has more room than the text can fill; larger sizes
 * only add room, so two such answers in a row end the scan (one is not
 * enough: الله is `tooShort` in a 4-fold wedge at 22 and packs at 24).
 */
const firstFits = new Map<string, number | null>();
function firstFit(clock: Clock, fold: StarFold, k: number, kind: StarRegionKind, text: string): number | null {
  const id = `${fold}/${k}|${kind}|${text}`;
  if (firstFits.has(id)) return firstFits.get(id)!;
  let found: number | null = null;
  let roomy = 0;
  for (let size = STAR_MIN_SIZE; size <= STAR_MAX_SIZE; size += SIZE_STEP) {
    const mask = firstMask(constructionOf(fold, k, size), kind);
    if (mask.cols === 0 || mask.rows === 0) continue;
    const r = lookup(clock, mask, text);
    if (r.ok) {
      found = size;
      break;
    }
    roomy = r.reason === "tooShort" ? roomy + 1 : 0;
    if (roomy === 2) break;
  }
  firstFits.set(id, found);
  return found;
}

function layoutAt(clock: Clock, c: StarConstruction, regions: string[]): KufiStarLayout {
  const out = c.regions.map((r) => {
    const text = regions[r.index] ?? "";
    if (text.trim() === "") return { text, result: null };
    return { text, result: lookup(clock, firstMask(c, r.kind), text) };
  });
  return { regions: out, unpacked: out.flatMap((r, i) => (r.result && !r.result.ok ? [i] : [])) };
}

function qualityOf(layout: KufiStarLayout, size: number) {
  let squares = 0, bars = 0;
  for (const r of layout.regions) {
    if (r.result?.ok) {
      squares += r.result.quality?.squares ?? 0;
      bars += r.result.quality?.bars ?? 0;
    }
  }
  return { squares, bars, size };
}

const KIND_ORDER: StarRegionKind[] = ["wedgeA", "wedgeB", "corner", "centre"];

/** "محمد does not fit a wedge; الله does not fit a corner" (each text and kind once). */
function misfits(c: StarConstruction, layout: KufiStarLayout): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const kind of KIND_ORDER) {
    for (const i of layout.unpacked) {
      if (c.regions[i].kind !== kind) continue;
      const s = `${layout.regions[i].text} does not fit ${KIND_WORDS[kind]}`;
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out.join("; ");
}

/**
 * One offer for a plan on a fold and star: the first size where every part
 * packs; else, when some part never packs, the size where the parts that do
 * pack all pack (the smallest), so the preview shows them and the note names
 * the rest.
 */
function offerFor(clock: Clock, plan: Plan, fold: StarFold, k: number): KufiStarOffer | null {
  const regions = plan.regions(fold);
  const parts = partsOf(constructionOf(fold, k, STAR_NO_FIT_SIZE), regions);
  if (parts.length === 0) return null;
  const firsts = parts.map((p) => firstFit(clock, fold, k, p.kind, p.text));
  const known = firsts.filter((s): s is number => s !== null);
  // When no part fits anywhere, the offer keeps a new star's size, so approving it still gives a usable panel.
  const start = known.length ? Math.max(...known) : STAR_NO_FIT_SIZE;
  const partsThatFit = parts.filter((_, i) => firsts[i] !== null);
  // Every part that can fit, at one size: the first size from the latest first fit up.
  let size = start;
  for (let s = start; s <= STAR_MAX_SIZE; s += SIZE_STEP) {
    const c = constructionOf(fold, k, s);
    if (partsThatFit.every((p) => lookup(clock, firstMask(c, p.kind), p.text).ok)) {
      size = s;
      break;
    }
  }
  const c = constructionOf(fold, k, size);
  const layout = layoutAt(clock, c, regions);
  const fits = layout.unpacked.length === 0;
  const where = `${fold}-fold, ${k === STAR_KS[fold][0] ? "classic" : "alternative"} star, size ${size}`;
  const note = fits ? `${plan.describe} (${where})` : `${plan.describe} (${where}): ${misfits(c, layout)}`;
  return { inputs: { fold, k, size, regions }, pattern: plan.pattern, fits, note, quality: qualityOf(layout, size), layout };
}

/** Fitting first; then fewer filler squares and bars; then the smaller size; the rest keep their search order. */
function rank(a: KufiStarOffer, b: KufiStarOffer): number {
  if (a.fits !== b.fits) return a.fits ? -1 : 1;
  if (!a.fits) return a.layout.unpacked.length - b.layout.unpacked.length;
  const qa = a.quality.squares + a.quality.bars, qb = b.quality.squares + b.quality.bars;
  if (qa !== qb) return qa - qb;
  return a.quality.size - b.quality.size;
}

export function evaluateKufiStar(text: string, budgetMs: number): KufiStarEvaluation {
  const words = kufiStarWords(text);
  const drawn = words.filter((w) => w.drawable).map((w) => w.text);
  const notes: string[] = [];
  const offers: KufiStarOffer[] = [];
  if (drawn.length === 0) return { words, offers, notes, complete: true };

  const capped = kufiClockOverridden();
  const t0 = performance.now();
  const clock: Clock = {
    tries: 0,
    over: () => (capped ? clock.tries >= STAR_EVAL_MAX_TRIES : performance.now() - t0 > budgetMs),
  };

  const { early, late, runNeeds } = plansFor(drawn);
  const [classic, alternative] = [0, 1];
  const steps: Array<{ plans: Plan[]; ki: number }> = [
    { plans: early, ki: classic },
    { plans: early, ki: alternative },
    { plans: late, ki: classic },
    { plans: late, ki: alternative },
  ];
  let complete = true;
  try {
    for (const { plans, ki } of steps) {
      for (const plan of plans) {
        for (const fold of FOLDS) {
          if (plan.pattern === "run" && runNeeds(fold) > 0) continue;
          const k = STAR_KS[fold][ki];
          if (k === undefined) continue;
          const offer = offerFor(clock, plan, fold, k);
          if (offer) offers.push(offer);
        }
      }
    }
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    complete = false;
  }
  for (const fold of FOLDS) {
    const more = runNeeds(fold);
    if (more > 0) notes.push(`Running the words round ${fold}-fold needs ${more} more word${more === 1 ? "" : "s"}`);
  }

  // One offer per distinct split: the same regions on another construction is a different offer.
  const sorted = offers.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o, b.o) || a.i - b.i).map((x) => x.o);
  return { words, offers: sorted.slice(0, STAR_MAX_OFFERS), notes, complete };
}

/** Tests only: forget every cached pack. */
export function _resetKufiStarEvaluation(): void {
  packCache.clear();
  firstFits.clear();
  constructions.clear();
}
