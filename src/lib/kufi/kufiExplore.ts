/**
 * Pure exploration of a packed panel: every single change one letter can make
 * (another form, one stretch slice a step longer or shorter), one try of a
 * change through the packer, and the picks that make distinct alternative
 * arrangements. No React, no worker: callers decide where it runs.
 */
import { kufiGlyphById, kufiFormsOf, placementOf } from "./kufiHit";
import { packKufiPanel, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";
import { kufiFormEdits, kufiPinEdits, kufiStretchEdits } from "./kufiPanelBlock";
import { resolveKufiText } from "./kufiWords";
import type { KufiLayoutInputs } from "./kufiWorkerProtocol";

type Ok = Extract<KufiPackResult, { ok: true }>;

export type KufiChange =
  | { kind: "form"; unitIndex: number; glyphId: string }
  | { kind: "stretch"; unitIndex: number; stretchIndex: number; counts: number[] };

/** `edits` are what a commit saves (pinned as the canvas does); `result` null when it did not pack. */
export type KufiTry = { change: KufiChange; edits: KufiPanelEdits; result: Ok | null };

export type KufiArrangement = { change: KufiChange; edits: KufiPanelEdits; result: Ok; changedCells: number };

/** The stretch counts tried on each slice, in order. */
export const KUFI_STRETCH_STEPS = [1, -1, 2, -2];

export const KUFI_MAX_ARRANGEMENTS = 6;

/** Every single change to try on the packed panel: other forms first, then stretch steps, unit by unit. */
export function kufiChangesOf(text: string, current: Ok): KufiChange[] {
  const { units } = resolveKufiText(text);
  const forms: KufiChange[] = [];
  const stretches: KufiChange[] = [];
  for (const unit of units) {
    const p = placementOf(current, unit.index);
    if (!p) continue;
    for (const g of kufiFormsOf(unit)) {
      if (g.id !== p.glyphId) forms.push({ kind: "form", unitIndex: unit.index, glyphId: g.id });
    }
    const glyph = kufiGlyphById(p.glyphId);
    if (!glyph) continue;
    const base = glyph.stretch.map((_, i) => p.stretch[i] ?? 0);
    glyph.stretch.forEach((slice, stretchIndex) => {
      for (const step of KUFI_STRETCH_STEPS) {
        const count = base[stretchIndex] + step;
        if (count < -(slice.min ?? 0)) continue;
        const counts = base.slice();
        counts[stretchIndex] = count;
        stretches.push({ kind: "stretch", unitIndex: unit.index, stretchIndex, counts });
      }
    });
  }
  return [...forms, ...stretches];
}

/** Packs the panel with one change made to `current`; the saved edits pin the changed letter as the canvas does. */
export function tryKufiChange(inputs: KufiLayoutInputs, current: Ok, change: KufiChange): KufiTry {
  const edits =
    change.kind === "form"
      ? kufiFormEdits(inputs.edits, change.unitIndex, change.glyphId)
      : kufiStretchEdits(inputs.edits, change.unitIndex, change.counts);
  const result = packKufiPanel({ ...inputs, edits, previous: current });
  if (!result.ok || result.editsBreakPacking) return { change, edits, result: null };
  return { change, edits: kufiPinEdits(edits, result, change.unitIndex), result };
}

const diff = (a: Uint8Array, b: Uint8Array) => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
};

const sameCells = (a: Uint8Array, b: Uint8Array) => a.length === b.length && diff(a, b) === 0;

const rank = (r: Ok) => (r.quality ? [r.quality.squares, r.quality.cut, r.quality.grow] : [Infinity, Infinity, Infinity]);

function byQuality(a: Ok, b: Ok): number {
  const x = rank(a);
  const y = rank(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

/**
 * Distinct alternatives to `current`, best quality first. Panels equal to the
 * current one or an earlier pick are dropped; among equal quality the pick
 * furthest from the current panel and the earlier picks goes first.
 */
export function pickArrangements(current: Ok, tries: KufiTry[], max = KUFI_MAX_ARRANGEMENTS): KufiArrangement[] {
  const sorted = tries
    .filter((t): t is KufiTry & { result: Ok } => t.result !== null)
    .sort((a, b) => byQuality(a.result, b.result));
  const pool: typeof sorted = [];
  for (const t of sorted) {
    if (sameCells(t.result.cells, current.cells)) continue;
    if (pool.some((q) => sameCells(q.result.cells, t.result.cells))) continue;
    pool.push(t);
  }
  const picks: KufiArrangement[] = [];
  while (picks.length < max && pool.length) {
    const group = pool.filter((t) => byQuality(t.result, pool[0].result) === 0);
    const apart = (t: (typeof pool)[number]) =>
      Math.min(diff(t.result.cells, current.cells), ...picks.map((p) => diff(t.result.cells, p.result.cells)));
    let pick = group[0];
    for (const t of group) if (apart(t) > apart(pick)) pick = t;
    pool.splice(pool.indexOf(pick), 1);
    picks.push({ change: pick.change, edits: pick.edits, result: pick.result, changedCells: diff(pick.result.cells, current.cells) });
  }
  return picks;
}
