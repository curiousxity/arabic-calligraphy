import { useCallback, useRef } from "react";

/**
 * Returns a `schedule()` function that records one undo step per burst of
 * calls — used so a live-updating gesture (drag, slider, glyph edit) records
 * a single entry rather than one per intermediate frame. Each call to this
 * hook owns its own independent timer.
 *
 * The push happens on the **first** call of a burst, and the burst ends once
 * `delay`ms pass without another call. Leading rather than trailing because
 * every caller updates state first and schedules second, and `pushHistory`
 * snapshots the state its own render closed over: only the first call comes
 * from a render that predates the gesture. A trailing push records the
 * gesture's end state instead, so an undo pressed after the timer fired
 * restored exactly what was already on screen and did nothing.
 */
export function useDebouncedHistoryPush(pushHistory: () => void, delay = 300) {
  const timeoutRef = useRef<number | null>(null);

  return useCallback(() => {
    if (timeoutRef.current == null) pushHistory();
    else window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      timeoutRef.current = null;
    }, delay);
  }, [pushHistory, delay]);
}
