import { useCallback, useEffect, useId, useMemo, useSyncExternalStore } from "react";
import {
  kufiStarSnapshot,
  releaseKufiStarLayout,
  requestKufiStarLayout,
  subscribeKufiLayouts,
  type KufiStarSnapshot,
} from "../lib/kufi/kufiLayoutClient";
import { kufiStarInputs, kufiStarKey, type KufiStarLayoutKind } from "../lib/kufi/kufiStarLayout";
import type { StarFold } from "../lib/kufi/kufiStarGeometry";

/** The fields a star's layout depends on: nothing else of the block is read. */
export type KufiStarLayoutSource = {
  starLayout?: KufiStarLayoutKind;
  starFold: StarFold;
  starK: number;
  starSize: number;
  starRegions: string[];
};

/**
 * The packed region texts of a star block, computed in the packer's Web
 * Worker (the pattern of `useKufiPanelLayout`).
 *
 * `layout` is null only before the first layout arrives (or on a new
 * construction); while a newer one is pending it keeps the last layout this
 * renderer was shown. `failed` says the layout threw on the current inputs;
 * it is part of the snapshot, so a failure re-renders. Memoised on the
 * layout inputs' content, never on the block object, which is replaced on
 * every drag frame.
 */
export function useKufiStarLayout(block: KufiStarLayoutSource): KufiStarSnapshot {
  const slot = useId();
  const { starLayout, starFold, starK, starSize, starRegions } = block;
  const inputs = useMemo(
    () => kufiStarInputs({ starLayout, starFold, starK, starSize, starRegions }),
    [starLayout, starFold, starK, starSize, starRegions]
  );
  // An equal-but-new regions array (an undo, a reload) must not re-request.
  const key = kufiStarKey(inputs);

  useEffect(() => {
    requestKufiStarLayout(slot, inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the inputs' content, not their identity
  }, [slot, key]);
  useEffect(() => () => releaseKufiStarLayout(slot), [slot]);

  const getSnapshot = useCallback(() => kufiStarSnapshot(slot, inputs), [slot, inputs]);
  return useSyncExternalStore(subscribeKufiLayouts, getSnapshot, getSnapshot);
}
