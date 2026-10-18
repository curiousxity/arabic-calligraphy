/**
 * Composing a phrase inside a shape from the Thuluth pen pieces: the search
 * that stands in for the calligrapher's eye. A layout is each run's choice
 * (which piece draws each letter, which joins climb, how far each straight
 * stroke is lengthened) plus where the runs break into tiers. A layout is
 * placed bottom tier first, right to left, each tier in the lowest band of
 * the shape that takes it, at the largest size that fits (bisection), and
 * scored by `scoreLayout` (mostly the shape left empty). A seeded local
 * search over a fixed number of steps keeps the best distinct layouts.
 * Pure; library units, 400 per em. See .claude/rules/tarkib.md.
 */
import type { StackJoin, StackPiece } from "../types";
import { bandSpan, fillGaps, inkContours, type FillerShape } from "./stackArrange";
import { assembleStackOutline } from "./stackOutline";
import { flattenContours, outlineBounds, type Pt } from "./strokeCuts";
import { transformCmds } from "./stackGeometry";
import { pieceTransform } from "./stackOutline";
import { canClimb } from "./tarkibClimb";
import { chainRun, defaultChoice, missingLetters, variantsFor, RUN_GAP, WORD_GAP, type ChainedRun, type RunChoice } from "./tarkibChain";
import type { TarkibLibrary } from "./tarkibSchema";
import { scoreLayout, type TarkibScore } from "./tarkibScore";
import type { SignSet } from "./tarkibSigns";
import type { PhraseAnalysis, PhraseRun } from "./tarkibText";

const PEN = 48;
const UPM = 400;
const NIB = { width: PEN, minFraction: 0.5 };
/** Least units between one tier's ink and the ink below it: a tier drops
 *  into the valleys of the one below (a tail under, an alif between) until
 *  its ink comes this close. */
export const TIER_GAP = PEN / 2;
/** Columns of the ink profiles, units. */
const COLUMN = PEN / 4;
/** The smallest pen a composition is drawn with, px: below it, no fit. */
export const MIN_PEN_PX = 2;
/** Steps of the search (each one layout placed and scored). The search is
 *  a fixed number of steps so a seed repeats; `budgetMs` only cuts it short. */
export const SEARCH_STEPS = 120;
/** Of the steps, the share spent on restarts away from earlier picks, so
 *  the candidates differ. */
const RESTART_SHARE = 0.5;
/** Two candidates differ when at least this share of letters is drawn by a different piece. */
export const DISTINCT = 0.25;
/** A worse layout is still taken with probability exp(-Δ / TEMPERATURE): the search wanders a little. */
const TEMPERATURE = 0.02;
/** How far a tier creeps up the shape, per try, looking for a band that takes it (px, as a share of the shape's height). */
const CREEP = 0.01;

export type ComposeInput = {
  analysis: PhraseAnalysis;
  /** Block-local px, centred. */
  shapePx: Pt[];
  /** Starting pen scale: fontSize / 400 px per unit. */
  fontSize: number;
  seed: number;
  /** Candidates wanted (the spec: at least 4). */
  count: number;
  budgetMs: number;
  /** Task 9; Task 7 passes an empty set. */
  signs: SignSet;
  /** Thuluth small signs for the gap pass. */
  fillers: FillerShape[];
  fillerAmount: number;
};
export type TarkibCandidate = { pieces: StackPiece[]; joins: StackJoin[]; fontSize: number; score: TarkibScore; pieceIds: string[] };
export type ComposeResult = { candidates: TarkibCandidate[] } | { error: "unsupported"; letters: string[] } | { error: "no-fit" };

/** A small seeded generator (mulberry32): the same seed, the same search. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Layout = { choices: RunChoice[]; /** breaks[i]: a new tier starts at run i + 1. */ breaks: boolean[] };
type RunInfo = { run: PhraseRun; wordEnd: boolean; letterStart: number; prefix: string };
type Chained = ChainedRun & { box: { x1: number; y1: number; x2: number; y2: number } };
type Placed = { pieces: StackPiece[]; joins: StackJoin[]; scale: number; tiers: string[][] };
/** A tier's ink per column (tier units, column c covers [c, c + 1) × COLUMN):
 *  its highest and lowest ink, NaN where it has none. */
type Profile = { c0: number; top: Float64Array; bottom: Float64Array };

function profileOf(pieces: readonly StackPiece[]): Profile {
  const pts: Pt[] = [];
  for (const p of pieces) for (const poly of flattenContours(transformCmds(p.cmds, pieceTransform(p))) as Pt[][]) {
    for (let i = 0; i < poly.length; i++) {
      const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (COLUMN / 2)));
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
  }
  const cs = pts.map(([x]) => Math.floor(x / COLUMN));
  const c0 = Math.min(...cs), n = Math.max(...cs) - c0 + 1;
  const top = new Float64Array(n).fill(NaN), bottom = new Float64Array(n).fill(NaN);
  pts.forEach(([, y], i) => {
    const c = cs[i] - c0;
    if (!(y >= top[c])) top[c] = y;
    if (!(y <= bottom[c])) bottom[c] = y;
  });
  return { c0, top, bottom };
}
type Scored = { layout: Layout; placed: Placed; score: TarkibScore; letterIds: string[]; key: string };

const shift = (p: StackPiece, d: Pt): StackPiece => ({ ...p, x: p.x + d[0], y: p.y + d[1], homeX: p.homeX + d[0], homeY: p.homeY + d[1] });
const layoutKey = (l: Layout) => JSON.stringify(l);
const clone = (l: Layout): Layout => ({
  choices: l.choices.map((c) => ({ schemaIds: [...c.schemaIds], climbs: [...c.climbs], stretch: { ...c.stretch } })),
  breaks: [...l.breaks],
});

export function composeInShape(lib: TarkibLibrary, input: ComposeInput, onProgress?: (fraction: number) => void): ComposeResult {
  const t0 = Date.now();
  const a = input.analysis;
  const missing = [...a.unsupported];
  for (const w of a.words) for (const r of w.runs) for (const c of missingLetters(lib, r)) if (!missing.includes(c)) missing.push(c);
  if (missing.length) return { error: "unsupported", letters: missing };

  const runs: RunInfo[] = [];
  let letterAt = 0;
  a.words.forEach((w, wi) => w.runs.forEach((run, ri) => {
    runs.push({ run, wordEnd: ri === w.runs.length - 1, letterStart: letterAt, prefix: `w${wi}r${ri}p` });
    letterAt += run.letters.length;
  }));
  if (runs.length === 0 || input.shapePx.length < 3) return { error: "no-fit" };
  const rng = mulberry32(input.seed);

  // Chaining a run is the costly part of a step; most steps change one run.
  const chains = new Map<string, Chained | null>();
  const chained = (i: number, c: RunChoice): Chained | null => {
    const k = `${i}|${JSON.stringify(c)}`;
    if (!chains.has(k)) {
      let v: Chained | null = null;
      try {
        const r = chainRun(lib, runs[i].run, c, runs[i].prefix, runs[i].letterStart);
        v = { ...r, box: outlineBounds(assembleStackOutline(r.pieces, r.joins, NIB)) };
      } catch { v = null; }   // a variant or climb the faces cannot join
      chains.set(k, v);
    }
    return chains.get(k)!;
  };

  /** Each tier assembled on its own baseline, right to left, in units. */
  type Tier = { pieces: StackPiece[]; joins: StackJoin[]; box: Chained["box"]; letters: string[]; profile?: Profile };
  const tiersOf = (l: Layout): Tier[] | null => {
    const out: Tier[] = [];
    let cur: (typeof out)[number] | null = null, cursor = 0;
    for (let i = 0; i < runs.length; i++) {
      const c = chained(i, l.choices[i]);
      if (!c) return null;
      if (!cur || l.breaks[i - 1]) {
        cur = { pieces: [], joins: [], box: { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity }, letters: [] };
        out.push(cur); cursor = 0;
      }
      const d: Pt = [cursor - c.box.x2, -c.baselineY];
      cur.pieces.push(...c.pieces.map((p) => shift(p, d)));
      cur.joins.push(...c.joins);
      cur.letters.push(...c.pieces.filter((p) => p.role === "letter" && !p.parentId).map((p) => p.id));
      cur.box = { x1: Math.min(cur.box.x1, c.box.x1 + d[0]), y1: Math.min(cur.box.y1, c.box.y1 + d[1]), x2: Math.max(cur.box.x2, c.box.x2 + d[0]), y2: Math.max(cur.box.y2, c.box.y2 + d[1]) };
      cursor = c.box.x1 + d[0] - (runs[i].wordEnd ? WORD_GAP : RUN_GAP);
    }
    for (const t of out) t.profile = profileOf(t.pieces);
    return out;
  };

  const ys = input.shapePx.map((p) => p[1]);
  const shapeTop = Math.min(...ys), shapeBottom = Math.max(...ys);
  const creep = Math.max(CREEP * (shapeBottom - shapeTop), 1e-6);

  /**
   * Tier offsets (units) at scale s (px per unit), or null if the shape runs
   * out. Each tier, from the bottom: its box must lie in the shape's band
   * (centred in it), its baseline above the tier below's, and its ink at
   * least TIER_GAP above the ink placed so far, column by column (a skyline),
   * so it settles into the lower tier's valleys rather than on its box.
   */
  const fitAt = (tiers: Tier[], s: number): Pt[] | null => {
    const offs: Pt[] = [];
    const sky = new Map<number, number>();            // world column -> highest ink so far (units)
    let floor = shapeBottom;                           // px: the next tier's box bottom stays above this
    for (const t of tiers) {
      const p = t.profile!;
      const w = (t.box.x2 - t.box.x1) * s, h = (t.box.y2 - t.box.y1) * s;
      /** The lowest box bottom (px) the skyline allows with the tier's box left edge at x1 (units). */
      const skyAllows = (dx: number): number => {
        let lim = Infinity;
        const shiftC = Math.round(dx / COLUMN);
        for (let c = 0; c < p.bottom.length; c++) {
          if (Number.isNaN(p.bottom[c])) continue;
          for (let k = -1; k <= 1; k++) {
            const top = sky.get(p.c0 + c + shiftC + k);
            if (top !== undefined) lim = Math.min(lim, top - TIER_GAP - p.bottom[c] + t.box.y2);
          }
        }
        return lim * s;
      };
      let b = floor, found: Pt | null = null;
      for (let n = 0; n < 400 && b - h >= shapeTop; n++) {
        const span = bandSpan(input.shapePx, b - h, b);
        if (!span || span[1] - span[0] < w) { b -= creep; continue; }
        const dx = ((span[0] + span[1]) / 2) / s - (t.box.x1 + t.box.x2) / 2;
        const allow = skyAllows(dx);
        if (b > allow + 1e-9) { b = Math.min(b - creep, allow); continue; }
        found = [dx, b / s - t.box.y2];
        break;
      }
      if (!found) return null;
      offs.push(found);
      for (let c = 0; c < p.top.length; c++) {
        if (Number.isNaN(p.top[c])) continue;
        const wc = p.c0 + c + Math.round(found[0] / COLUMN), y = p.top[c] + found[1];
        sky.set(wc, Math.min(sky.get(wc) ?? Infinity, y));
      }
      floor = b - creep;
    }
    return offs;
  };

  const place = (l: Layout): Placed | null => {
    const tiers = tiersOf(l);
    if (!tiers) return null;
    const least = MIN_PEN_PX / PEN;
    let lo = input.fontSize / UPM, found = fitAt(tiers, lo);
    for (let n = 0; !found && lo / 2 >= least; n++) { lo /= 2; found = fitAt(tiers, lo); }
    if (!found) return null;
    let hi = lo * 2;
    for (let n = 0; n < 12; n++) { const r = fitAt(tiers, hi); if (!r) break; lo = hi; found = r; hi *= 2; }
    for (let n = 0; n < 16; n++) {
      const mid = (lo + hi) / 2, r = fitAt(tiers, mid);
      if (r) { lo = mid; found = r; } else hi = mid;
    }
    const offs = found;
    return {
      pieces: tiers.flatMap((t, i) => t.pieces.map((p) => shift(p, offs[i]))),
      joins: tiers.flatMap((t) => t.joins),
      scale: lo,
      tiers: tiers.map((t) => t.letters),
    };
  };

  const letterIdsOf = (l: Layout): string[] => l.choices.flatMap((c) => c.schemaIds.flatMap((id) => (lib.schema.get(id)?.letters ?? []).map(() => id)));

  const evaluate = (l: Layout): Scored | null => {
    const placed = place(l);
    if (!placed) return null;
    const s = placed.scale;
    const stretchUsed: Record<string, { used: number; max: number }> = {};
    l.choices.forEach((c, i) => {
      for (const [id, used] of Object.entries(c.stretch)) {
        const p = placed.pieces.find((q) => q.id === id);
        const max = lib.schema.get(c.schemaIds[Number(id.slice(runs[i].prefix.length))])?.stretch[0]?.max ?? 0;
        if (p && used > 0) stretchUsed[id] = { used, max };
      }
    });
    const readingOrder = placed.pieces.filter((p) => p.role === "letter" && !p.parentId).sort((x, y) => x.order - y.order).map((p) => p.id);
    const score = scoreLayout({
      pieces: placed.pieces, joins: placed.joins, nib: NIB,
      shape: input.shapePx.map(([x, y]) => [x / s, y / s] as Pt), readingOrder, stretchUsed, tiers: placed.tiers,
    });
    return { layout: l, placed, score, letterIds: letterIdsOf(l), key: layoutKey(l) };
  };

  // --- moves -----------------------------------------------------------
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];
  /** Letter index (in the run) of each piece's first letter. */
  const starts = (c: RunChoice) => { const out: number[] = []; let k = 0; for (const id of c.schemaIds) { out.push(k); k += lib.schema.get(id)!.letters.length; } return out; };

  const swapVariant = (l: Layout): boolean => {
    const i = Math.floor(rng() * runs.length), c = l.choices[i], st = starts(c);
    const k = Math.floor(rng() * c.schemaIds.length);
    if (lib.schema.get(c.schemaIds[k])!.letters.length !== 1) return false;
    const alts = variantsFor(lib, runs[i].run.letters[st[k]]).filter((s) => s.id !== c.schemaIds[k]);
    if (!alts.length) return false;
    c.schemaIds[k] = pick(alts).id;
    delete c.stretch[`${runs[i].prefix}${k}`];
    return true;
  };
  const toggleClimb = (l: Layout): boolean => {
    const i = Math.floor(rng() * runs.length), c = l.choices[i], st = starts(c);
    const ok = c.climbs.map((_, k) => k).filter((k) => {
      const lastOfK = st[k] + lib.schema.get(c.schemaIds[k])!.letters.length - 1;
      return canClimb(runs[i].run.letters[lastOfK], runs[i].run.letters[st[k + 1]]);
    });
    if (!ok.length) return false;
    const k = pick(ok);
    c.climbs[k] = !c.climbs[k];
    return true;
  };
  const changeStretch = (l: Layout): boolean => {
    const i = Math.floor(rng() * runs.length), c = l.choices[i];
    const ks = c.schemaIds.map((_, k) => k).filter((k) => (lib.schema.get(c.schemaIds[k])!.stretch[0]?.max ?? 0) > 0);
    if (!ks.length) return false;
    const k = pick(ks), id = `${runs[i].prefix}${k}`, max = lib.schema.get(c.schemaIds[k])!.stretch[0].max;
    const next = Math.min(max, Math.max(0, (c.stretch[id] ?? 0) + (rng() < 0.5 ? -1 : 1) * PEN / 2));
    if (next === (c.stretch[id] ?? 0)) return false;
    if (next === 0) delete c.stretch[id]; else c.stretch[id] = next;
    return true;
  };
  // A tier breaks only between words: a word's runs read together.
  const breakable = runs.slice(0, -1).map((r, i) => (r.wordEnd ? i : -1)).filter((i) => i >= 0);
  const moveTier = (l: Layout): boolean => {
    if (breakable.length === 0) return false;
    const j = Math.floor(rng() * breakable.length), b = breakable[j];
    if (rng() < 0.5) { l.breaks[b] = !l.breaks[b]; return true; }        // split or merge two tiers
    const n = breakable[j + (rng() < 0.5 ? -1 : 1)];                       // move a word across a break
    if (n === undefined || l.breaks[b] === l.breaks[n]) return false;
    [l.breaks[b], l.breaks[n]] = [l.breaks[n], l.breaks[b]];
    return true;
  };
  const MOVES = [swapVariant, swapVariant, toggleClimb, changeStretch, moveTier, moveTier];
  const neighbour = (l: Layout): Layout | null => {
    for (let tries = 0; tries < 8; tries++) { const n = clone(l); if (pick(MOVES)(n)) return n; }
    return null;
  };

  // --- seed: the default pieces, broken into k tiers of even width -------
  const base: RunChoice[] = runs.map((r) => defaultChoice(lib, r.run)!);
  const widths = base.map((c, i) => { const ch = chained(i, c); return ch ? ch.box.x2 - ch.box.x1 : 0; });
  const total = widths.reduce((x, y) => x + y, 0);
  const seeds: Layout[] = [];
  for (let k = 1; k <= runs.length; k++) {
    const breaks: boolean[] = [];
    let acc = 0, tier = 1;
    for (let i = 0; i < runs.length - 1; i++) {
      acc += widths[i];
      const brk = runs[i].wordEnd && tier < k && acc >= (tier * total) / k;
      if (brk) tier++;
      breaks.push(brk);
    }
    seeds.push({ choices: base.map((c) => ({ schemaIds: [...c.schemaIds], climbs: [...c.climbs], stretch: { ...c.stretch } })), breaks });
  }
  const pool = new Map<string, Scored>();
  const consider = (l: Layout): Scored | null => {
    const k = layoutKey(l);
    if (pool.has(k)) return pool.get(k)!;
    const r = evaluate(l);
    if (r) pool.set(k, r);
    return r;
  };
  let best: Scored | null = null;
  for (const s of seeds) { const r = consider(s); if (r && (!best || r.score.total < best.score.total)) best = r; }
  if (!best) return { error: "no-fit" };

  // --- search: one walk from the best seed, then restarts away from the picks
  const differ = (x: string[], y: string[]) => x.filter((id, i) => id !== y[i]).length / Math.max(1, x.length);
  const picks = (): Scored[] => {
    const out: Scored[] = [];
    for (const s of [...pool.values()].sort((x, y) => x.score.total - y.score.total)) {
      if (out.every((o) => differ(o.letterIds, s.letterIds) >= DISTINCT)) out.push(s);
      if (out.length === input.count) break;
    }
    return out;
  };
  const walk = (from: Scored, steps: number, done: number): number => {
    let cur = from;
    for (let n = 0; n < steps; n++, done++) {
      if (Date.now() - t0 > input.budgetMs) return done;
      if (onProgress && done % Math.max(1, Math.round(SEARCH_STEPS / 20)) === 0) onProgress(done / SEARCH_STEPS);
      const nb = neighbour(cur.layout);
      if (!nb) continue;
      const r = consider(nb);
      if (!r) continue;
      const d = r.score.total - cur.score.total;
      if (d < 0 || rng() < Math.exp(-d / TEMPERATURE)) cur = r;
    }
    return done;
  };
  const restarts = Math.max(0, input.count - 1);
  const mainSteps = Math.round(SEARCH_STEPS * (restarts ? 1 - RESTART_SHARE : 1));
  let done = walk(best, mainSteps, 0);
  for (let r = 0; r < restarts; r++) {
    // start from a layout that differs from every pick so far: swap variants until it does
    const chosen = picks();
    const start = clone(chosen[0].layout);
    for (let n = 0; n < 4 * letterAt && !chosen.every((c) => differ(c.letterIds, letterIdsOf(start)) >= DISTINCT); n++) swapVariant(start);
    const s = consider(start) ?? chosen[0];
    done = walk(s, Math.round((SEARCH_STEPS * RESTART_SHARE) / restarts), done);
  }
  onProgress?.(1);

  const kept = picks();
  return {
    candidates: kept.map((k) => {
      const s = k.placed.scale;
      const maxOrder = k.placed.pieces.reduce((m, p) => Math.max(m, p.order), 0);
      const fills = fillGaps(input.shapePx.map(([x, y]) => [x / s, y / s] as Pt), inkContours(k.placed.pieces), input.fillers, UPM, maxOrder, input.fillerAmount);
      return {
        pieces: [...k.placed.pieces, ...fills], joins: k.placed.joins, fontSize: s * UPM, score: k.score,
        pieceIds: k.layout.choices.flatMap((c) => c.schemaIds),
      };
    }),
  };
}
