export const MAX_HISTORY = 50;

/** One recorded point in history: the state itself plus a small rasterized preview of it. */
export type HistoryEntry<T> = {
  snapshot: T;
  thumbnail: string;
};

/**
 * The live "current" state is never stored in either array — it's whatever
 * the caller's own state currently is. `past` holds earlier states you can
 * undo/jump back to (oldest first, most recent past last); `future` holds
 * states you've moved away from by undoing, that redo can restore (in the
 * order a repeated single-step redo would replay them, nearest-next last).
 */
export type HistoryStack<T> = {
  past: HistoryEntry<T>[];
  future: HistoryEntry<T>[];
};

export function emptyHistoryStack<T>(): HistoryStack<T> {
  return { past: [], future: [] };
}

export function canUndo<T>(stack: HistoryStack<T>): boolean {
  return stack.past.length > 0;
}

export function canRedo<T>(stack: HistoryStack<T>): boolean {
  return stack.future.length > 0;
}

/** Records `entry` as the new most-recent past state and discards all future (redo) entries — the standard "a new edit clears redo" rule. */
export function pushEntry<T>(stack: HistoryStack<T>, entry: HistoryEntry<T>): HistoryStack<T> {
  let past = [...stack.past, entry];
  if (past.length > MAX_HISTORY) past = past.slice(past.length - MAX_HISTORY);
  return { past, future: [] };
}

/**
 * Replaces the most recent past entry in place instead of appending a new
 * one — used to coalesce rapid-fire pushes (e.g. every keystroke of a text
 * edit, or every tick of a slider drag) into a single history entry rather
 * than consuming the `MAX_HISTORY` cap one push at a time. Still discards
 * `future`, same as `pushEntry` — it's still a new edit for that rule's
 * purposes, just one that doesn't warrant its own past slot. Falls back to
 * `pushEntry`'s append behavior if there's no existing past entry to
 * replace.
 */
export function replaceLastEntry<T>(stack: HistoryStack<T>, entry: HistoryEntry<T>): HistoryStack<T> {
  if (stack.past.length === 0) return pushEntry(stack, entry);
  const past = [...stack.past.slice(0, -1), entry];
  return { past, future: [] };
}

/**
 * Shared by moveBack/moveForward: pop up to `steps` entries off the front
 * (the `steps`-th one is the target to land on), and stash the live current
 * state plus every entry closer than the target onto the opposite side, in
 * the order a subsequent one-step-at-a-time traversal would replay them.
 */
function moveWithin<T>(
  from: HistoryEntry<T>[],
  to: HistoryEntry<T>[],
  currentEntry: HistoryEntry<T>,
  steps: number
): { from: HistoryEntry<T>[]; to: HistoryEntry<T>[]; restore: HistoryEntry<T> } | null {
  const n = Math.min(steps, from.length);
  if (n <= 0) return null;
  const popped = from.slice(from.length - n);
  const restore = popped[0];
  const nextFrom = from.slice(0, from.length - n);
  const nextTo = [...to, currentEntry, ...popped.slice(1).reverse()];
  return { from: nextFrom, to: nextTo, restore };
}

/** Move `steps` (default 1) states back into the past. `currentEntry` is the live state being left behind — it's what a subsequent single redo will restore first. Returns `null` if there's no past to move into. */
export function moveBack<T>(
  stack: HistoryStack<T>,
  currentEntry: HistoryEntry<T>,
  steps = 1
): { stack: HistoryStack<T>; restore: HistoryEntry<T> } | null {
  const result = moveWithin(stack.past, stack.future, currentEntry, steps);
  if (!result) return null;
  return { stack: { past: result.from, future: result.to }, restore: result.restore };
}

/** Mirror image of moveBack: move `steps` (default 1) states forward out of the future/redo side. */
export function moveForward<T>(
  stack: HistoryStack<T>,
  currentEntry: HistoryEntry<T>,
  steps = 1
): { stack: HistoryStack<T>; restore: HistoryEntry<T> } | null {
  const result = moveWithin(stack.future, stack.past, currentEntry, steps);
  if (!result) return null;
  return { stack: { past: result.to, future: result.from }, restore: result.restore };
}

/**
 * The past stack as a flat, most-recent-first display list for a history
 * UI — `steps: -1` is one undo away, `-2` is two, etc. (the value to pass
 * to a `moveBack`-driven "jump to here" action). Deliberately excludes the
 * future/redo side and the live current state — see historyStack's callers
 * for why.
 */
export function pastTimeline<T>(stack: HistoryStack<T>): { thumbnail: string; steps: number }[] {
  return [...stack.past].reverse().map((e, i) => ({ thumbnail: e.thumbnail, steps: -(i + 1) }));
}
