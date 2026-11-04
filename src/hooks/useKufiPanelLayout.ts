import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from "react";
import type { KufiPackResult, KufiPanelEdits, KufiPanelStart } from "../lib/kufi/kufiPack";
import {
  kufiLayoutKey,
  kufiLayoutSnapshot,
  releaseKufiLayout,
  subscribeKufiLayouts,
  wantKufiLayout,
} from "../lib/kufi/kufiLayoutClient";
import { kufiPanelInputs } from "../lib/kufi/kufiPanelBlock";

/** The fields a panel's layout depends on: nothing else of the block is read. */
export type KufiPanelLayoutSource = {
  text: string;
  panelCols: number;
  panelRows: number;
  panelEdits?: KufiPanelEdits;
  panelCentre?: boolean;
  panelStart?: KufiPanelStart;
};

/**
 * The packed panel for a block, computed in the packer's Web Worker.
 *
 * Null only before the first result arrives; while a newer one is pending it
 * keeps returning the last result this renderer was shown. Memoised on the
 * layout inputs (`text`, `panelCols`, `panelRows`, `panelEdits`,
 * `panelCentre`, `panelStart`), never on the block object, which is replaced
 * on every drag frame.
 */
export function useKufiPanelLayout(block: KufiPanelLayoutSource): KufiPackResult | null {
  const slot = useId();
  const { text, panelCols, panelRows, panelEdits, panelCentre, panelStart } = block;
  const inputs = useMemo(
    () => kufiPanelInputs({ text, panelCols, panelRows, panelEdits, panelCentre, panelStart }),
    [text, panelCols, panelRows, panelEdits, panelCentre, panelStart]
  );
  // An equal-but-new edits object (an undo, a reload) must not re-request.
  const key = kufiLayoutKey(inputs);

  useEffect(() => {
    wantKufiLayout(slot, inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the inputs' content, not their identity
  }, [slot, key]);
  useEffect(() => () => releaseKufiLayout(slot), [slot]);

  const getSnapshot = useCallback(() => kufiLayoutSnapshot(slot, inputs), [slot, inputs]);
  return useSyncExternalStore(subscribeKufiLayouts, getSnapshot, getSnapshot);
}
