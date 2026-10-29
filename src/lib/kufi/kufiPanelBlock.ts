/**
 * Block-level helpers for the `kufiPanel` block: the cell size, the packer's
 * inputs, and carrying the user's edits across a text change. Pure: no React,
 * no Konva, no `./harfbuzz`.
 */
import { reconcileEdits, type KufiPanelEdits } from "./kufiPack";
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
