/**
 * Block-level helpers for the `kufiPanel` block: the cell size, the packer's
 * inputs, carrying the user's edits across a text change, and planning the
 * edits a canvas gesture makes. Pure: no React, no Konva, no `./harfbuzz`.
 */
import { kufiFormsOf } from "./kufiHit";
import { reconcileEdits, type KufiPackResult, type KufiPanelEdits } from "./kufiPack";
import { resolveKufiText } from "./kufiWords";
import type { KufiLayoutInputs } from "./kufiWorkerProtocol";

/** Cells to the em (the removed block's figure): a cell is `fontSize / 8` px, so the size slider scales the panel. */
export const KUFI_CELLS_PER_EM = 8;

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
  const p = result.placements[unitIndex];
  if (!p) return edits;
  return { ...edits, pinned: { ...edits.pinned, [unitIndex]: { ...p, stretch: p.stretch.slice() } } };
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
