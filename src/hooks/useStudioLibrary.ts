import { useEffect, useState } from "react";
import { loadedStudioLibrary, loadStudioLibrary, type StudioLibrary } from "../lib/studioStrokes";

/** The studio stroke library, loading it on first use; null until it arrives (or if it fails to load).
 *  With `enabled` false nothing is fetched (yet). */
export function useStudioLibrary(enabled = true): StudioLibrary | null {
  const [lib, setLib] = useState(loadedStudioLibrary);
  useEffect(() => {
    if (lib || !enabled) return;
    let live = true;
    loadStudioLibrary().then((l) => { if (live) setLib(l); }, () => {});
    return () => { live = false; };
  }, [lib, enabled]);
  return lib;
}
