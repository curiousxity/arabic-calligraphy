/**
 * Evaluates a text for a Kufi star panel: first the octagon squares (the
 * text once, twice, ... along each side, `octagonOffers`), then ways to split
 * it over the wedge regions (`.claude/rules/kufi-star.md`, "Evaluation"). A region is
 * **filled**: its text is repeated as often as the region packs it (a wedge
 * of a size-29 4-fold star holds الله twice, its corner once), as traditional
 * panels repeat a short phrase to fill their fields; a corner that cannot
 * hold its word even once stays pattern only. Each pattern is tried on every
 * fold and each `STAR_KS` star over the sizes from `STAR_MIN_SIZE` up; an
 * offer fits at a size where every wedge (and the centre, when it holds a
 * word) packs, and a plan is offered at up to `FITS_PER_PLAN` growing sizes,
 * the larger ones denser, or the same words standing taller (a fit drawing a
 * tall letter short, الله on its five-row form, scans `CUT_SCAN` sizes on for
 * its tall form before jumping to the next word count).
 *
 * Packs are slow (up to ~1.4 s each, failures slowest), so they are cached
 * across calls by the region's mask and the text (the mask is what fold, k,
 * size and kind decide), the repeat count is approached from an estimate
 * (`FILL_FACTOR`) rather than from one, and the whole call is bounded: by
 * `budgetMs` on the clock, or, under the tests' clock override, by
 * `STAR_EVAL_MAX_TRIES` packs, so a test's answer never depends on machine
 * load. The work runs likeliest first (`priority`: each plan's first fit on
 * each fold's default star before second fits and the other star; repeat
 * and alternate before run and centre; a plan whose packs keep failing is set
 * aside), so a cut still leaves the best offers.
 * Pure: no React, no Konva, no `./harfbuzz`.
 */
import { kufiClockOverridden, kufiFormsOf, packKufiRegion, type KufiMask, type KufiPackResult } from "./kufiPack";
import { octagonFromBand, OCTAGON_MAX_SIZE, OCTAGON_MIN_SIZE, packOctagonBand } from "./kufiOctagon";
import { defaultStarK, STAR_KS, starConstruction, type StarConstruction, type StarFold, type StarRegionKind } from "./kufiStarGeometry";
import { octagonSizeFor, type KufiStarInputs, type KufiStarLayout } from "./kufiStarLayout";
import { resolveKufiText } from "./kufiWords";

/** `octagon`: the octagon-in-a-square layout; the rest are splits of the wedges layout. */
export type KufiStarPattern = "octagon" | "repeat" | "alternate" | "run" | "centre";

export type KufiStarOffer = {
  /** What approving it sets: the region texts carry their repeats ("الله الله"). */
  inputs: KufiStarInputs;
  pattern: KufiStarPattern;
  fits: boolean;
  /** Plain words: what goes where, and what does not fit. */
  note: string;
  /**
   * Summed over every region with text; `words` the placements drawn; `cut` the cells the tall
   * letters stand short of their natural length (الله on its five-row form in a wedge, two a
   * word); size is `inputs.size`.
   */
  quality: { squares: number; bars: number; cut: number; words: number; size: number };
  /** The packed regions, for the preview (and the layout cache on approval). */
  layout: KufiStarLayout;
};

export type KufiStarEvaluation = {
  words: Array<{ text: string; drawable: boolean }>;
  /** Fitting offers first, densest first; then the closest that do not fit. At most `STAR_MAX_OFFERS`. */
  offers: KufiStarOffer[];
  /** What could not be offered, e.g. a run round a fold that needs more words. */
  notes: string[];
  /** False when the budget ended the search before every plan was tried to the end. */
  complete: boolean;
};

/** Wedge offers kept; the octagon squares (up to `OCTAGON_OFFERS`) come before them. */
export const STAR_MAX_OFFERS = 8;
/** Octagon squares offered: the text once, twice, ... along each side, smallest first. */
export const OCTAGON_OFFERS = 4;
/** Most repeats of the text along a side tried for the octagon. */
const OCTAGON_REPEATS = 6;
/** Sizes scanned for one repeat count, from the line its forms take at their authored widths less two. */
const OCTAGON_SCAN = 8;
/** Offers kept per fold and pattern, so one construction's sizes do not crowd out the other folds. */
const OFFERS_PER_FOLD_PATTERN = 2;
export const STAR_MIN_SIZE = 12;
export const STAR_MAX_SIZE = 60;
/** Fits offered per plan and star: after one, the scan goes on until a size holds strictly more words (denser) or the same words taller (less cut). */
const FITS_PER_PLAN = 3;
/**
 * After a fit that draws a tall letter short (`quality.cut`: الله on its five-row form), the
 * sizes tried one by one, before the jump to the next word count, for a fit of the same words
 * standing tall: a 4-fold wedge holds الله squat at 20 to 22 and tall from 23 (2026-11-02).
 */
const CUT_SCAN = 3;
/** Under the clock override, the evaluation stops after this many packs (cache hits are free). */
export const STAR_EVAL_MAX_TRIES = 300;
/** Pack results kept between calls. */
const PACK_CACHE_LIMIT = 2000;
/**
 * The repeat count is first tried at `usable cells × FILL_FACTOR / the text's cells`: measured on
 * الله in 4-fold wedges and corners (sizes 25 to 40), the slanted sides and the notch leave about
 * that much of a region to letters. The search then steps up or down by one.
 */
const FILL_FACTOR = 0.6;
/** A line of text and its gap row (`BAND` + 1). */
const LINE_PITCH = 6;
const FILL_MAX = 16;
/** Packs a fill search may spend on one region and text. */
const FILL_TRIES = 5;
/**
 * A plan that failed at this many sizes with room for its text since its last fit (or from the
 * start) is set aside until the rest have had their turn: a classic star whose wedge never holds
 * a second word scans every size to 60 at two failing packs each, which spent the budget before
 * the alternative stars were tried (الله's one dense fit with every copy tall, 5-fold {10/2} ×3
 * at 42, was never reached, 2026-11-02).
 */
const PATIENCE = 8;
/** Among equally close misses the size nearest this (a new star's) is offered, so a plan nothing of which fits is not shown tiny or huge. */
const STAR_NO_FIT_SIZE = 24;

const FOLDS: StarFold[] = [4, 5, 6];
const KIND_WORDS: Record<StarRegionKind, string> = {
  centre: "the centre",
  wedgeA: "a wedge",
  wedgeB: "a wedge",
  corner: "a corner",
};

const packCache = new Map<string, KufiPackResult>();
const fills = new Map<string, number | null>();
const areas = new Map<string, number>();
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

/** The cells a text's letters take on a line, by their region forms' widths (plus a gap each) over a line's pitch. */
function areaOf(text: string): number {
  let a = areas.get(text);
  if (a === undefined) {
    const { units } = resolveKufiText(text);
    a = Math.max(1, units.reduce((n, u) => n + ((kufiFormsOf(u, "star")[0]?.rows[0]?.length ?? 1) + 1) * LINE_PITCH, 0));
    areas.set(text, a);
  }
  return a;
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

const repeat = (text: string, n: number) => Array.from({ length: n }, () => text).join(" ");
const times = (n: number) => (n > 1 ? ` ×${n}` : "");

/**
 * A pattern's base texts: per wedge (index 1..m), the corners' word (filled where there is
 * room) and the centre's. `fill` repeats a wedge's text to fill it; a run never repeats.
 */
type Plan = {
  pattern: KufiStarPattern;
  late: boolean;
  fill: boolean;
  wedges: (fold: StarFold) => string[];
  corner: string;
  centre: string;
  /** The note's opening, given the repeat count of the A wedges, the B wedges and the corners. */
  describe: (nA: number, nB: number, nC: number) => string;
};

const isWedgeA = (i: number) => i % 2 === 1;

/** Two words or more: the first half of the words in the A wedges, the rest in the B wedges, so a pair of neighbours reads in order. */
function halves(words: string[]): [string, string] {
  const h = Math.ceil(words.length / 2);
  return [words.slice(0, h).join(" "), words.slice(h).join(" ")];
}

function alternating(fold: StarFold, a: string, b: string): string[] {
  const out: string[] = [""];
  for (let i = 1; i <= 2 * fold; i++) out.push(isWedgeA(i) ? a : b);
  return out;
}

function corners(n: number, word: string): string {
  return n > 0 ? `, ${word}${times(n)} in the corners` : "";
}

function plansFor(words: string[]): { plans: Plan[]; runNeeds: (fold: StarFold) => number } {
  const whole = words.join(" ");
  let shortest = 0, longest = 0;
  words.forEach((w, i) => {
    if (letters(w) < letters(words[shortest])) shortest = i;
    if (letters(w) > letters(words[longest])) longest = i;
  });
  const corner = words[shortest];
  const plans: Plan[] = [];
  // two words or more: the halves in turn is the likeliest split, so it goes first
  if (words.length >= 2) {
    const [a, b] = halves(words);
    plans.push({
      pattern: "alternate",
      late: false,
      fill: true,
      wedges: (fold) => alternating(fold, a, b),
      corner,
      centre: "",
      describe: (nA, nB, nC) => `${a}${times(nA)} and ${b}${times(nB)} in turn round the wedges${corners(nC, corner)}`,
    });
  }
  plans.push({
    pattern: "repeat",
    late: false,
    fill: true,
    wedges: (fold) => alternating(fold, whole, whole),
    corner,
    centre: "",
    describe: (nA, _nB, nC) => `${whole}${times(nA)} in every wedge${corners(nC, corner)}`,
  });
  plans.push({
    pattern: "run",
    late: true,
    fill: false,
    wedges: (fold) => {
      const m = 2 * fold;
      const r = [""];
      // m consecutive groups, the earlier ones a word longer when they do not divide evenly
      let at = 0;
      for (let g = 0; g < m; g++) {
        const take = Math.floor(words.length / m) + (g < words.length % m ? 1 : 0);
        r.push(words.slice(at, at + take).join(" "));
        at += take;
      }
      return r;
    },
    corner,
    centre: "",
    describe: (_nA, _nB, nC) => `the words once round the wedges, clockwise from the top${corners(nC, corner)}`,
  });
  if (words.length >= 2) {
    const rest = words.filter((_, i) => i !== longest);
    const [a, b] = rest.length >= 2 ? halves(rest) : [rest[0], rest[0]];
    plans.push({
      pattern: "centre",
      late: true,
      fill: true,
      wedges: (fold) => alternating(fold, a, b),
      corner,
      centre: words[longest],
      describe: (nA, nB, nC) =>
        `${words[longest]} in the centre, ${a === b ? `${a}${times(nA)} in every wedge` : `${a}${times(nA)} and ${b}${times(nB)} in turn round the wedges`}${corners(nC, corner)}`,
    });
  }
  return { plans, runNeeds: (fold) => 2 * fold - words.length };
}

class OutOfBudget extends Error {}

type Clock = { tries: number; over: () => boolean };

const UNPACKED: KufiPackResult = { ok: false, reason: "tooLong", suggestions: [] };

/**
 * A region's pack, from the cache or packed now; only a real pack counts as a try, and none
 * starts once the budget is spent. A region with fewer usable cells than half the text's area
 * (`areaOf`, a generous measure: fits run from 0.57 to 0.9 of it) is too small without a pack,
 * which would only fail slowly.
 */
function lookup(clock: Clock, mask: KufiMask, text: string): KufiPackResult {
  const key = `${maskKey(mask)}|${text}`;
  const hit = packCache.get(key);
  if (hit) return hit;
  if (usableOf(mask) * 2 < areaOf(text)) return UNPACKED;
  return tried(clock, key, () => packKufiRegion({ text, mask }));
}

/** The octagon's band of `size` for `text`, from the cache or packed now, as `layoutKufiOctagon` packs it (an approved offer is drawn as packed here). */
function lookupOctagon(clock: Clock, size: number, text: string): KufiPackResult {
  const key = `octagon|${size}|${text}`;
  return packCache.get(key) ?? tried(clock, key, () => packOctagonBand(size, text));
}

/** One real pack, counted as a try and cached under `key`; none starts once the budget is spent. */
function tried(clock: Clock, key: string, pack: () => KufiPackResult): KufiPackResult {
  if (clock.over()) throw new OutOfBudget();
  clock.tries++;
  const r = pack();
  packCache.set(key, r);
  if (packCache.size > PACK_CACHE_LIMIT) packCache.delete(packCache.keys().next().value!);
  return r;
}

/** The usable cells of a mask. */
function usableOf(mask: KufiMask): number {
  let n = 0;
  for (const v of mask.cells) n += v;
  return n;
}

/** The repeat count a region is first tried at: by area, allowing for the slanted sides (`FILL_FACTOR`). */
function estimate(mask: KufiMask, text: string): number {
  return Math.max(1, Math.min(FILL_MAX, Math.floor((usableOf(mask) * FILL_FACTOR) / areaOf(text))));
}

/**
 * How often `text` repeated fills `mask` (null: not even once). Starts at the
 * estimate and steps by one, up from a `tooShort`, down from a `tooLong`,
 * until it fits or the answer is bracketed or `FILL_TRIES` packs are spent.
 * A miss counts against the plan (`fails`) only when the region had room:
 * some count was too short, or the region's usable cells reach the text's
 * area; a region too small for the text fails cheaply and says nothing.
 */
function fillCount(clock: Clock, mask: KufiMask, text: string, fails: { n: number }): number | null {
  const key = `${maskKey(mask)}|${text}`;
  if (fills.has(key)) return fills.get(key)!;
  if (mask.cols === 0 || mask.rows === 0) {
    fills.set(key, null);
    return null;
  }
  const seen = new Map<number, "ok" | "short" | "long">();
  const probe = (r: number) => {
    let s = seen.get(r);
    if (s === undefined) {
      const res = lookup(clock, mask, repeat(text, r));
      s = res.ok ? "ok" : res.reason === "tooShort" ? "short" : "long";
      seen.set(r, s);
    }
    return s;
  };
  let r = estimate(mask, text);
  let best: number | null = null;
  for (let i = 0; i < FILL_TRIES; i++) {
    const s = probe(r);
    if (s === "ok") {
      best = r;
      break;
    } else if (s === "short") {
      if (r >= FILL_MAX || seen.get(r + 1) === "long") break;
      r++;
    } else if (r === 1) {
      // once is "too long" yet twice may pack (محمد in a 4-fold wedge at 29: one word leaves the
      // line's end open, two fill it), so the room is tried once more before giving up
      if (seen.has(2)) break;
      r = 2;
    } else {
      if (seen.get(r - 1) === "short") break;
      r--;
    }
  }
  fills.set(key, best);
  if (best === null && (usableOf(mask) >= areaOf(text) || [...seen.values()].includes("short"))) fails.n++;
  return best;
}

function firstMask(c: StarConstruction, kind: StarRegionKind): KufiMask {
  return c.regions.find((r) => r.kind === kind)!.mask;
}

/** A plan laid out at one size: the region texts with their repeats, the packs, and which required regions did not pack. */
type Attempt = { regions: string[]; layout: KufiStarLayout; missing: number; counts: { nA: number; nB: number; nC: number } };

function attempt(clock: Clock, plan: Plan, c: StarConstruction, fails: { n: number }): Attempt {
  const wedges = plan.wedges(c.fold);
  const regions: string[] = [];
  const results: Array<KufiPackResult | null> = [];
  const counts = { nA: 0, nB: 0, nC: 0 };
  let missing = 0;
  for (const r of c.regions) {
    const base = r.kind === "centre" ? plan.centre : r.kind === "corner" ? plan.corner : (wedges[r.index] ?? "");
    if (base.trim() === "") {
      regions.push("");
      results.push(null);
      continue;
    }
    const mask = firstMask(c, r.kind);
    if (r.kind === "corner" || (plan.fill && r.kind !== "centre")) {
      // a corner is filled where there is room, so its misses count against no plan
      const n = fillCount(clock, mask, base, r.kind === "corner" ? { n: 0 } : fails);
      if (n !== null) {
        const text = repeat(base, n);
        regions.push(text);
        results.push(lookup(clock, mask, text));
        if (r.kind === "corner") counts.nC = n;
        else if (r.kind === "wedgeA") counts.nA = n;
        else counts.nB = n;
      } else if (r.kind === "corner") {
        // no room for the word: pattern only, not a failure
        regions.push("");
        results.push(null);
      } else {
        regions.push(base);
        results.push(UNPACKED);
        missing++;
      }
    } else {
      const res = lookup(clock, mask, base);
      regions.push(base);
      results.push(res);
      if (!res.ok) missing++;
      else if (r.kind === "wedgeA") counts.nA = 1;
      else if (r.kind === "wedgeB") counts.nB = 1;
    }
  }
  const layout: KufiStarLayout = {
    regions: regions.map((text, i) => ({ text, result: results[i] })),
    unpacked: results.flatMap((res, i) => (res && !res.ok ? [i] : [])),
  };
  return { regions, layout, missing, counts };
}

function qualityOf(layout: KufiStarLayout, size: number) {
  let squares = 0, bars = 0, cut = 0, words = 0;
  for (const r of layout.regions) {
    if (r.result?.ok) {
      squares += r.result.quality?.squares ?? 0;
      bars += r.result.quality?.bars ?? 0;
      cut += r.result.quality?.cut ?? 0;
      words += r.result.placements.length;
    }
  }
  return { squares, bars, cut, words, size };
}

const KIND_ORDER: StarRegionKind[] = ["wedgeA", "wedgeB", "corner", "centre"];

/** "محمد does not fit a wedge; الله does not fit the centre" (each text and kind once). */
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

function offerOf(plan: Plan, fold: StarFold, k: number, size: number, a: Attempt): KufiStarOffer {
  const c = constructionOf(fold, k, size);
  const fits = a.missing === 0;
  const where = `${fold}-fold, ${k === STAR_KS[fold][0] ? "classic" : "alternative"} star, size ${size}`;
  const head = plan.describe(a.counts.nA, a.counts.nB, a.counts.nC);
  const note = fits ? `${head} (${where})` : `${head} (${where}): ${misfits(c, a.layout)}`;
  return { inputs: { layout: "wedges", fold, k, size, regions: a.regions }, pattern: plan.pattern, fits, note, quality: qualityOf(a.layout, size), layout: a.layout };
}

/**
 * The octagon squares: `text` once, twice, ... (`OCTAGON_REPEATS`) along each
 * side, each at the smallest square whose line its repeats pack **with every
 * word rising** (scanned up from the line their authored widths take with
 * the corner word's widening, less two, `OCTAGON_SCAN` sizes; a line the
 * text leaves open ends the scan, since a bigger one is worse), else the
 * smallest that packs at all, its corner word short. Each pack is one short
 * line, so this costs little; the packs share the cache. Smallest first; at
 * most `OCTAGON_OFFERS`.
 */
function octagonOffers(clock: Clock, text: string, offers: KufiStarOffer[]): void {
  for (let n = 1; n <= OCTAGON_REPEATS && offers.length < OCTAGON_OFFERS; n++) {
    const side = repeat(text, n);
    const from = Math.max(OCTAGON_MIN_SIZE, octagonSizeFor(side) - 2);
    if (from > OCTAGON_MAX_SIZE) break;
    let short: KufiStarOffer | null = null;
    for (let size = from; size <= Math.min(OCTAGON_MAX_SIZE, from + OCTAGON_SCAN); size++) {
      const band = lookupOctagon(clock, size, side);
      if (!band.ok) {
        if (band.reason === "tooShort") break;
        continue;
      }
      const octagon = octagonFromBand(size, band, side);
      const offer: KufiStarOffer = {
        inputs: { layout: "octagon", fold: 4, k: defaultStarK(4), size, regions: [side] },
        pattern: "octagon",
        fits: true,
        note: `${text}${times(n)} along each side, the tall strokes lengthened to an octagon in a square of ${size}`,
        quality: { squares: 0, bars: 0, cut: band.quality?.cut ?? 0, words: band.placements.length, size },
        layout: { regions: [{ text: side, result: band }], unpacked: [], octagon },
      };
      if (octagon.words.still === 0) {
        offers.push(offer);
        short = null;
        break;
      }
      short ??= offer;
    }
    if (short) offers.push(short);
  }
}

/** One plan on one construction, scanning sizes upward; `best` is its closest miss so far. */
type Task = {
  plan: Plan;
  fold: StarFold;
  k: number;
  size: number;
  fits: number;
  /** Words the last offer drew, and its cut: the next offer must draw more, or the same words with less cut. */
  words: number;
  cut: number;
  /** The words a wedge held at the last fit (`counts.nA`): what the jump past it must promise more than. */
  nA: number;
  /** Sizes still to try one by one after a fit with a cut stem (`CUT_SCAN`), before the jump. */
  after: number;
  fails: { n: number };
  best: { size: number; a: Attempt } | null;
  done: boolean;
};

/**
 * Lower first: every fold's first fit (4-fold, then 5, then 6: a text whose packs fail slowly
 * still gets one fold's fits inside the budget) before any second one, a default star's before
 * the alternative star's, early plans before late, set-aside tasks last.
 */
function priority(t: Task): number {
  const aside = t.fails.n >= PATIENCE ? 100 : 0;
  return aside + t.fits * 3 + FOLDS.indexOf(t.fold) + (t.k === defaultStarK(t.fold) ? 0 : 9) + (t.plan.late ? 20 : 0);
}

/** Advances a task by one size; returns the offer it found there, if any. */
function step(clock: Clock, t: Task): KufiStarOffer | null {
  if (t.size > STAR_MAX_SIZE) {
    t.done = true;
    return null;
  }
  const c = constructionOf(t.fold, t.k, t.size);
  const fails = { n: 0 };
  const a = attempt(clock, t.plan, c, fails);
  if (fails.n > 0) t.fails.n++;
  let offer: KufiStarOffer | null = null;
  if (a.missing === 0) {
    const o = offerOf(t.plan, t.fold, t.k, t.size, a);
    // a fit is another offer when denser than the last, or the same words standing taller (less cut)
    const better = o.quality.words > t.words || (o.quality.words === t.words && o.quality.cut < t.cut);
    t.nA = a.counts.nA;
    if (better) {
      offer = o;
      t.fits++;
      // the task's patience starts afresh at a fit: `fails` counts the failing sizes since
      t.fails.n = 0;
      t.words = o.quality.words;
      t.cut = o.quality.cut;
      if (t.fits >= FITS_PER_PLAN) t.done = true;
      // a fit drawing a tall letter short may stand tall a size or two on: those sizes are tried first
      t.after = o.quality.cut > 0 ? CUT_SCAN : 0;
    } else t.after--;
  } else {
    if (!t.best || a.missing < t.best.a.missing || (a.missing === t.best.a.missing && Math.abs(t.size - STAR_NO_FIT_SIZE) < Math.abs(t.best.size - STAR_NO_FIT_SIZE)))
      t.best = { size: t.size, a };
    t.after--;
  }
  t.size++;
  // a filled plan's next size worth packing is the first whose wedge estimate promises one more
  // word than the last fit held (every size between would pack the same words again, slowly),
  // once the sizes after a cut fit are tried; a run tries each size
  if (t.plan.fill && t.nA > 0 && t.after <= 0) {
    const base = t.plan.wedges(t.fold)[1];
    while (t.size <= STAR_MAX_SIZE && estimate(firstMask(constructionOf(t.fold, t.k, t.size), "wedgeA"), base) <= t.nA) t.size++;
  }
  return offer;
}

/** Words drawn per region holding text: how densely an offer fills its panel, comparable across folds. */
function density(o: KufiStarOffer): number {
  const regions = o.inputs.regions.filter((t) => t !== "").length;
  return regions ? o.quality.words / regions : 0;
}

/** Whether the offer's corners hold text (the reference panel's four filled corners). */
function cornersFilled(o: KufiStarOffer): boolean {
  return o.inputs.regions.slice(2 * o.inputs.fold + 1).some((t) => t !== "");
}

/**
 * Fitting first; the classic stars before the alternative ones (the same split on the other
 * star is nearly the same offer, and the panel can switch stars); corners filled before empty
 * (a 4-fold star at 34 holds الله four times a wedge but nothing in its corners; at 28, twice
 * and the corners too, which is the reference); then denser first, then fewer filler squares,
 * then fewer cut stems (الله tall before squat, at the same density), then the smaller size;
 * then the closest misses (fewer regions unpacked).
 */
function rank(a: KufiStarOffer, b: KufiStarOffer): number {
  if (a.fits !== b.fits) return a.fits ? -1 : 1;
  if (!a.fits) return a.layout.unpacked.length - b.layout.unpacked.length;
  const ca = a.inputs.k === defaultStarK(a.inputs.fold) ? 0 : 1, cb = b.inputs.k === defaultStarK(b.inputs.fold) ? 0 : 1;
  if (ca !== cb) return ca - cb;
  const fa = cornersFilled(a), fb = cornersFilled(b);
  if (fa !== fb) return fa ? -1 : 1;
  const da = density(a), db = density(b);
  if (da !== db) return db - da;
  if (a.quality.squares !== b.quality.squares) return a.quality.squares - b.quality.squares;
  if (a.quality.cut !== b.quality.cut) return a.quality.cut - b.quality.cut;
  return a.quality.size - b.quality.size;
}

/** The best `STAR_MAX_OFFERS` of the ranked offers, at most `OFFERS_PER_FOLD_PATTERN` per fold and pattern. */
function pick(sorted: KufiStarOffer[]): KufiStarOffer[] {
  const taken = new Map<string, number>();
  const out: KufiStarOffer[] = [];
  for (const o of sorted) {
    const key = `${o.inputs.fold}|${o.pattern}`;
    const n = taken.get(key) ?? 0;
    if (n >= OFFERS_PER_FOLD_PATTERN) continue;
    taken.set(key, n + 1);
    out.push(o);
    if (out.length >= STAR_MAX_OFFERS) break;
  }
  return out;
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

  // the octagon squares first: a handful of one-line packs, offered before every star construction
  const octagon: KufiStarOffer[] = [];
  try {
    octagonOffers(clock, drawn.join(" "), octagon);
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    return { words, offers: octagon, notes, complete: false };
  }
  if (octagon.length === 0) notes.push(`${drawn.join(" ")} does not fit along a side of a square up to ${OCTAGON_MAX_SIZE} cells`);

  const { plans, runNeeds } = plansFor(drawn);
  const tasks: Task[] = [];
  for (const plan of plans)
    for (const fold of FOLDS) {
      if (plan.pattern === "run" && runNeeds(fold) > 0) continue;
      for (const k of STAR_KS[fold]) tasks.push({ plan, fold, k, size: STAR_MIN_SIZE, fits: 0, words: 0, cut: 0, nA: 0, after: 0, fails: { n: 0 }, best: null, done: false });
    }
  let complete = true;
  try {
    for (;;) {
      // the likeliest task next; among equals, round robin by the order above
      let next: Task | null = null;
      for (const t of tasks) if (!t.done && (!next || priority(t) < priority(next))) next = t;
      if (!next) break;
      const offer = step(clock, next);
      if (offer) offers.push(offer);
      // round robin: a stepped task goes behind its equals
      tasks.splice(tasks.indexOf(next), 1);
      tasks.push(next);
    }
  } catch (e) {
    if (!(e instanceof OutOfBudget)) throw e;
    complete = false;
  }
  // a plan that never fitted is offered at its closest miss, so the preview shows what does fit and the note the rest
  for (const t of tasks) {
    if (t.fits > 0) continue;
    if (t.best) offers.push(offerOf(t.plan, t.fold, t.k, t.best.size, t.best.a));
  }
  for (const fold of FOLDS) {
    const more = runNeeds(fold);
    if (more > 0) notes.push(`Running the words round ${fold}-fold needs ${more} more word${more === 1 ? "" : "s"}`);
  }

  const sorted = offers.map((o, i) => ({ o, i })).sort((a, b) => rank(a.o, b.o) || a.i - b.i).map((x) => x.o);
  return { words, offers: [...octagon, ...pick(sorted)], notes, complete };
}

/** Tests only: forget every cached pack. */
export function _resetKufiStarEvaluation(): void {
  packCache.clear();
  fills.clear();
  areas.clear();
  constructions.clear();
}
