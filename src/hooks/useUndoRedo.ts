import { useCallback, useMemo, useRef, useState } from "react";
import {
  emptyHistoryStack,
  pushEntry,
  replaceLastEntry,
  moveBack,
  moveForward,
  canUndo as stackCanUndo,
  canRedo as stackCanRedo,
  pastTimeline,
  type HistoryEntry,
  type HistoryStack,
} from "../lib/historyStack";

/** Rapid-fire pushes (keystrokes, slider-drag ticks) within this window of
 * the previous push coalesce into the same history entry instead of each
 * consuming a slot of the `MAX_HISTORY` cap — see `pushHistory` below. */
const COALESCE_WINDOW_MS = 300;

/**
 * Generic undo/redo stack, now backed by `lib/historyStack.ts`'s pure
 * past/future model so a UI can also jump directly to any earlier point
 * (`jumpBy`) instead of only stepping one entry at a time. The caller
 * supplies how to capture/restore a snapshot of whatever state it wants
 * covered, plus how to rasterize a small preview of the current view for
 * each recorded entry (`captureThumbnail`) — this hook only manages the
 * stack, the flags, and the thumbnail-tagged history list.
 */
export function useUndoRedo<T>(
  getSnapshot: () => T,
  applySnapshot: (snapshot: T) => void,
  captureThumbnail: () => string
) {
  const stackRef = useRef<HistoryStack<T>>(emptyHistoryStack<T>());
  const lastPushAtRef = useRef<number>(0);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  // Refs mutate silently — this just forces `historyEntries` to recompute
  // (and any consumer to re-render) whenever the stack actually changes.
  const [historyVersion, setHistoryVersion] = useState(0);

  const syncFlags = useCallback(() => {
    setCanUndo(stackCanUndo(stackRef.current));
    setCanRedo(stackCanRedo(stackRef.current));
    setHistoryVersion((v) => v + 1);
  }, []);

  const pushHistory = useCallback(() => {
    const entry: HistoryEntry<T> = { snapshot: getSnapshot(), thumbnail: captureThumbnail() };
    const now = Date.now();
    const shouldCoalesce =
      now - lastPushAtRef.current < COALESCE_WINDOW_MS && stackRef.current.past.length > 0;
    stackRef.current = shouldCoalesce
      ? replaceLastEntry(stackRef.current, entry)
      : pushEntry(stackRef.current, entry);
    lastPushAtRef.current = now;
    syncFlags();
  }, [getSnapshot, captureThumbnail, syncFlags]);

  const handleUndo = useCallback(() => {
    const currentEntry: HistoryEntry<T> = { snapshot: getSnapshot(), thumbnail: captureThumbnail() };
    const result = moveBack(stackRef.current, currentEntry, 1);
    if (!result) return;
    stackRef.current = result.stack;
    applySnapshot(result.restore.snapshot);
    syncFlags();
  }, [getSnapshot, applySnapshot, captureThumbnail, syncFlags]);

  const handleRedo = useCallback(() => {
    const currentEntry: HistoryEntry<T> = { snapshot: getSnapshot(), thumbnail: captureThumbnail() };
    const result = moveForward(stackRef.current, currentEntry, 1);
    if (!result) return;
    stackRef.current = result.stack;
    applySnapshot(result.restore.snapshot);
    syncFlags();
  }, [getSnapshot, applySnapshot, captureThumbnail, syncFlags]);

  /**
   * Jump directly to an arbitrary point: negative `steps` moves back into
   * the past, positive moves forward into the future. Used by the history
   * popover's "click a thumbnail" action (always negative in practice,
   * since the popover only ever displays past entries — see
   * historyStack.ts's `pastTimeline`).
   */
  const jumpBy = useCallback(
    (steps: number) => {
      if (steps === 0) return;
      const currentEntry: HistoryEntry<T> = { snapshot: getSnapshot(), thumbnail: captureThumbnail() };
      const result =
        steps < 0
          ? moveBack(stackRef.current, currentEntry, -steps)
          : moveForward(stackRef.current, currentEntry, steps);
      if (!result) return;
      stackRef.current = result.stack;
      applySnapshot(result.restore.snapshot);
      syncFlags();
    },
    [getSnapshot, applySnapshot, captureThumbnail, syncFlags]
  );

  // stackRef is a ref (mutated in place, not itself reactive) — historyVersion
  // is the value that actually signals "the stack changed, recompute this".
  const historyEntries = useMemo(
    () => pastTimeline(stackRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [historyVersion]
  );

  return { pushHistory, handleUndo, handleRedo, jumpBy, canUndo, canRedo, historyEntries };
}
