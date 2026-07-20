import { useCallback, useRef } from "react";

/**
 * Returns a `schedule()` function that calls `pushHistory` `delay`ms after
 * the last call in a burst — used so a live-updating gesture (drag, slider,
 * glyph edit) only records one undo step once it settles, instead of one per
 * intermediate frame. Each call to this hook owns its own independent timer.
 */
export function useDebouncedHistoryPush(pushHistory: () => void, delay = 300) {
  const timeoutRef = useRef<number | null>(null);

  return useCallback(() => {
    if (timeoutRef.current != null) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => pushHistory(), delay);
  }, [pushHistory, delay]);
}
