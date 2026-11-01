/**
 * Block-level helpers for the `kufiPanel` block: the cell size, the packer's
 * inputs, carrying the user's edits across a text change, and planning the
 * edits a canvas gesture makes. Pure: no React, no Konva, no `./harfbuzz`.
 */
import { firstUnitOfWord, kufiFormsOf, kufiReadingStep, placedBox, placementOf } from "./kufiHit";
import { reconcileEdits, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";
import { resolveKufiText, type KufiUnit } from "./kufiWords";
import type { KufiLayoutInputs } from "./kufiWorkerProtocol";

/** Cells to the em (the removed block's figure): a cell is `fontSize / 8` px, so the size slider scales the panel. */
export const KUFI_CELLS_PER_EM = 8;

/**
 * The canvas tool the Kufi panel's tool row has picked: which handles the
 * edit overlay shows and what a press does. Editor state only, never saved.
 */
export type KufiTool = "select" | "stretch" | "move" | "paint";

export const kufiCellSize = (fontSize: number) => fontSize / KUFI_CELLS_PER_EM;

type PanelFields = { text: string; panelCols: number; panelRows: number; panelEdits?: KufiPanelEdits };

/** What the packer is asked for a block: these four fields and nothing else. */
export const kufiPanelInputs = (b: PanelFields): KufiLayoutInputs => ({
  text: b.text,
  cols: b.panelCols,
  rows: b.panelRows,
  edits: b.panelEdits,
});

/**
 * The patch for a new text: the edits follow their letter to its new index
 * (`reconcileEdits`, aligned on unit keys), and edits on letters that went
 * are dropped.
 *
 * Limit: alignment is by key alone, so in a text with repeated identical
 * letters (the two lams of الله, say) an edit can land on a neighbouring copy
 * of the same letter when a copy is inserted or deleted near it.
 */
export function kufiPanelTextPatch(
  b: { text: string; panelEdits?: KufiPanelEdits },
  text: string
): { text: string; panelEdits?: KufiPanelEdits } {
  if (!b.panelEdits || text === b.text) return { text };
  const oldUnits = resolveKufiText(b.text).units;
  const newUnits = resolveKufiText(text).units;
  return { text, panelEdits: reconcileEdits(b.panelEdits, oldUnits, newUnits) };
}

type Ok = Extract<KufiPackResult, { ok: true }>;

/** `record` without key `k`, or undefined when nothing is left. */
function without<T>(record: Record<number, T> | undefined, k: number): Record<number, T> | undefined {
  if (!record || !(k in record)) return record;
  const rest = { ...record };
  delete rest[k];
  return Object.keys(rest).length ? rest : undefined;
}

/** `edits` with undefined maps dropped, so an emptied map does not count as an edit. */
function tidy(edits: KufiPanelEdits): KufiPanelEdits {
  const out: KufiPanelEdits = {};
  for (const [k, v] of Object.entries(edits)) if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  return out;
}

/**
 * The edits to preview a stretch: the unit's counts fixed, and its own pin
 * released (it holds the old counts and place). Every other pin stays a hard
 * constraint.
 */
export function kufiStretchEdits(edits: KufiPanelEdits | undefined, unitIndex: number, counts: number[]): KufiPanelEdits {
  return tidy({
    ...edits,
    stretch: { ...edits?.stretch, [unitIndex]: counts.slice() },
    pinned: without(edits?.pinned, unitIndex),
  });
}

/**
 * The edits to preview a form swap: the unit's form fixed, and its stretch
 * and pin dropped, since both describe the old glyph (a count vector for
 * other slices would read as a pin conflict).
 */
export function kufiFormEdits(edits: KufiPanelEdits | undefined, unitIndex: number, glyphId: string): KufiPanelEdits {
  return tidy({
    ...edits,
    forms: { ...edits?.forms, [unitIndex]: glyphId },
    stretch: without(edits?.stretch, unitIndex),
    pinned: without(edits?.pinned, unitIndex),
  });
}

/**
 * What a committed edit saves: the previewed edits plus a pin at the place
 * the packer gave the unit, so later repacks hold it there (the packer never
 * pins by itself; the UI does, on commit).
 */
export function kufiPinEdits(edits: KufiPanelEdits, result: Ok, unitIndex: number): KufiPanelEdits {
  const p = placementOf(result, unitIndex);
  if (!p) return edits;
  return { ...edits, pinned: { ...edits.pinned, [unitIndex]: { ...p, stretch: p.stretch.slice() } } };
}

/**
 * The edits with every pin released (the "Release hand edits" button): the
 * letters may move again, and the packer finds them places at the current
 * size. Pins hold absolute cells, so they are what blocks a panel after a
 * size change (`pinConflict`); forms, stretch counts and painted cells are
 * kept, since they describe the letter, not its place. `routes` go with the
 * pins: a route is the record of where a word's pin took it, and without
 * the pin it is stale. Undefined when nothing is left (no edits at all);
 * the same object when there was nothing to release.
 */
export function kufiReleasePins(edits: KufiPanelEdits | undefined): KufiPanelEdits | undefined {
  if (!edits?.pinned) return edits;
  const out = tidy({ ...edits, pinned: undefined, routes: undefined });
  return Object.keys(out).length ? out : undefined;
}

/**
 * The edits to preview a word dragged to `route` cells along its path. The
 * route counts from where the word stood before it was ever dragged, through
 * the chain of its drags: the committed `edits.routes` entry is where it
 * stands now, and the word's first letter is pinned at its committed place
 * moved by the difference along its line's reading step. The word's other
 * pins are released so its letters follow; every other edit stays. The
 * packer does not read the route (see `KufiPanelEdits`): the pin is what
 * moves the word, the route what the next drag starts from. Null when any
 * of the moved box would leave the panel, or for a word the text does not
 * have.
 */
export function kufiRouteEdits(edits: KufiPanelEdits | undefined, committed: Ok, units: KufiUnit[], wordIndex: number, route: number): KufiPanelEdits | null {
  const first = firstUnitOfWord(units, wordIndex);
  const p = first === null ? null : placementOf(committed, first);
  if (first === null || !p) return null;
  const delta = route - (edits?.routes?.[wordIndex] ?? 0);
  const [dc, dr] = kufiReadingStep(p.turn);
  const pin = { ...p, col: p.col + dc * delta, row: p.row + dr * delta, stretch: p.stretch.slice() };
  const { h, w } = placedBox(p);
  if (pin.col < 0 || pin.row < 0 || pin.col + w > committed.cols || pin.row + h > committed.rows) return null;
  let pinned = edits?.pinned;
  for (let k = first; k < units.length && units[k].wordIndex === wordIndex; k++) pinned = without(pinned, k);
  return tidy({
    ...edits,
    routes: route === 0 ? without(edits?.routes, wordIndex) : { ...edits?.routes, [wordIndex]: route },
    pinned: { ...pinned, [first]: pin },
  });
}

/**
 * What a committed re-route saves: every letter of the word pinned where the
 * packer put it, and every other letter the move changed (another glyph,
 * turn, place or stretch than in `before`, the panel the drag started from).
 * A panel the packer `rearranged` round the word is pinned whole: it came
 * from a fresh search, and a reload rebuilds its unpinned letters by another
 * road that may land elsewhere (إن شاء الله 13×13, word 1 at +2, reopened
 * its unmoved alef longer). It stays rigid until "Release hand edits".
 */
export function kufiPinWordEdits(edits: KufiPanelEdits, before: Ok, result: Ok, units: KufiUnit[], wordIndex: number): KufiPanelEdits {
  let out = edits;
  units.forEach((u, k) => {
    const a = placementOf(before, k);
    const b = placementOf(result, k);
    const changed =
      !a || !b || a.glyphId !== b.glyphId || a.turn !== b.turn || a.col !== b.col || a.row !== b.row || a.stretch.join() !== b.stretch.join();
    if (result.rearranged || u.wordIndex === wordIndex || changed) out = kufiPinEdits(out, result, k);
  });
  return out;
}

/**
 * The alternates to try on a click, in table order starting after the unit's
 * current glyph and wrapping round, without the current one. A glyph the
 * unit cannot take (a stale save) starts from the table's first. Empty when
 * the letter has a single form.
 */
export function kufiFormCycle(text: string, unitIndex: number, currentGlyphId: string): string[] {
  const unit = resolveKufiText(text).units[unitIndex];
  if (!unit) return [];
  const ids = kufiFormsOf(unit).map((g) => g.id);
  if (ids.length < 2) return [];
  const at = ids.indexOf(currentGlyphId);
  if (at < 0) return ids;
  return [...ids.slice(at + 1), ...ids.slice(0, at)];
}
