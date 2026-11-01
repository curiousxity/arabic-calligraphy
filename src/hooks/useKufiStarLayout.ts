import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from "react";
import {
  kufiStarLayoutSnapshot,
  releaseKufiStarLayout,
  requestKufiStarLayout,
  subscribeKufiLayouts,
} from "../lib/kufi/kufiLayoutClient";
import { kufiStarInputs, kufiStarKey, type KufiStarLayout } from "../lib/kufi/kufiStarLayout";
import type { StarFold } from "../lib/kufi/kufiStarGeometry";

/** The fields a star's layout depends on: nothing else of the block is read. */
export type KufiStarLayoutSource = {
  starFold: StarFold;
  starK: number;
  starSize: number;
  starRegions: string[];
};

/**
 * The packed region texts of a star block, computed in the packer's Web
 * Worker (the pattern of `useKufiPanelLayout`).
 *
 * Null only before the first layout arrives; while a newer one is pending it
 * keeps returning the last layout this renderer was shown. Memoised on the
 * layout inputs' content, never on the block object, which is replaced on
 * every drag frame.
 */
export function useKufiStarLayout(block: KufiStarLayoutSource): KufiStarLayout | null {
  const slot = useId();
  const { starFold, starK, starSize, starRegions } = block;
  const inputs = useMemo(
    () => kufiStarInputs({ starFold, starK, starSize, starRegions }),
    [starFold, starK, starSize, starRegions]
  );
  // An equal-but-new regions array (an undo, a reload) must not re-request.
  const key = kufiStarKey(inputs);

  useEffect(() => {
    requestKufiStarLayout(slot, inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the inputs' content, not their identity
  }, [slot, key]);
  useEffect(() => () => releaseKufiStarLayout(slot), [slot]);

  const getSnapshot = useCallback(() => kufiStarLayoutSnapshot(slot, inputs), [slot, inputs]);
  return useSyncExternalStore(subscribeKufiLayouts, getSnapshot, getSnapshot);
}
