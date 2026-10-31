import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { exploreKufiPanel, kufiExploreSnapshot, subscribeKufiExplore, type KufiExploreState } from "../lib/kufi/kufiExploreClient";
import { cachedKufiLayout, kufiLayoutKey, subscribeKufiLayouts } from "../lib/kufi/kufiLayoutClient";
import type { KufiLayoutInputs } from "../lib/kufi/kufiWorkerProtocol";

/**
 * What exploring single changes to the packed panel for `inputs` has found so
 * far, computed in its own worker. The packed result is read from the layout
 * cache for exactly these inputs, so exploration can never start from another
 * layout; it starts once that result is in and packed (and not while painted
 * cells break packing: then it never starts). Null until it starts.
 */
export function useKufiExplore(inputs: KufiLayoutInputs): KufiExploreState | null {
  const key = kufiLayoutKey(inputs);
  // An equal-but-new inputs object must not change the snapshot readers.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the inputs' content, not their identity
  const stable = useMemo(() => inputs, [key]);

  const getCurrent = useCallback(() => cachedKufiLayout(stable), [stable]);
  const current = useSyncExternalStore(subscribeKufiLayouts, getCurrent, getCurrent);
  // a panel whose painted cells break packing is not explored: every try
  // would carry the same gap and read as "doesn't fit"
  const ok = current?.ok && !current.editsBreakPacking ? current : null;

  useEffect(() => {
    if (ok) exploreKufiPanel(stable, ok);
  }, [stable, ok]);

  const getSnapshot = useCallback(() => kufiExploreSnapshot(stable), [stable]);
  return useSyncExternalStore(subscribeKufiExplore, getSnapshot, getSnapshot);
}
