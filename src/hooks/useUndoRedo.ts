import { useCallback, useRef, useState } from "react";

const MAX_HISTORY = 50;

/**
 * Generic undo/redo stack. The caller supplies how to capture and restore a
 * snapshot of whatever state it wants covered; this hook only manages the
 * two stacks, the depth cap, and the canUndo/canRedo flags.
 */
export function useUndoRedo<T>(getSnapshot: () => T, applySnapshot: (snapshot: T) => void) {
  const undoStackRef = useRef<T[]>([]);
  const redoStackRef = useRef<T[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback(() => {
    undoStackRef.current.push(getSnapshot());
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.splice(0, undoStackRef.current.length - MAX_HISTORY);
    }
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, [getSnapshot]);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(getSnapshot());
    applySnapshot(prev);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, [getSnapshot, applySnapshot]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(getSnapshot());
    applySnapshot(next);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(redoStackRef.current.length > 0);
  }, [getSnapshot, applySnapshot]);

  return { pushHistory, handleUndo, handleRedo, canUndo, canRedo };
}
