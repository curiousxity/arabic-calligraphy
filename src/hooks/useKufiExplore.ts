import { useCallback, useEffect, useSyncExternalStore } from "react";
import { exploreKufiPanel, kufiExploreSnapshot, subscribeKufiExplore, type KufiExploreState } from "../lib/kufi/kufiExploreClient";
import { kufiLayoutKey } from "../lib/kufi/kufiLayoutClient";
import type { KufiPackResult } from "../lib/kufi/kufiPack";
import type { KufiLayoutInputs } from "../lib/kufi/kufiWorkerProtocol";

/**
 * What exploring single changes to a packed panel has found so far, computed
 * in its own worker. `current` must be the cached result for exactly these
 * inputs; exploration starts only when it packed. Null until it starts.
 */
export function useKufiExplore(inputs: KufiLayoutInputs, current: KufiPackResult | null): KufiExploreState | null {
  const key = kufiLayoutKey(inputs);
  const ok = current?.ok ? current : null;

  useEffect(() => {
    if (ok) exploreKufiPanel(inputs, ok);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the inputs' content, not their identity
  }, [key, ok]);

  const getSnapshot = useCallback(() => kufiExploreSnapshot(inputs), [inputs]);
  return useSyncExternalStore(subscribeKufiExplore, getSnapshot, getSnapshot);
}
