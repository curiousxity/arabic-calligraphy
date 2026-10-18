import { useEffect, useState } from "react";
import { loadedMarkGroups, loadMarkGroups, type MarkGroup } from "../lib/markLibrary";

/** The mark library, loading it on first use; null until it arrives.
 *  With `enabled` false nothing is fetched (yet). */
export function useMarkGroups(enabled = true): MarkGroup[] | null {
  const [groups, setGroups] = useState(loadedMarkGroups);
  useEffect(() => {
    if (groups || !enabled) return;
    let live = true;
    loadMarkGroups().then((g) => { if (live) setGroups(g); });
    return () => { live = false; };
  }, [groups, enabled]);
  return groups;
}
