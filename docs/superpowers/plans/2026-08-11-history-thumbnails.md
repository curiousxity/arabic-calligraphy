# History Thumbnails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user open a small popover from the sidebar's Undo/Redo buttons showing a scrollable list of canvas thumbnails for earlier points in the edit history, and click any one to jump straight to it.

**Architecture:** The undo/redo stack logic is extracted into a new pure module, `src/lib/historyStack.ts` (a `{ past, future }` array-pair with `pushEntry`/`moveBack`/`moveForward`, fully unit-testable without React or Konva). `src/hooks/useUndoRedo.ts` becomes a thin wrapper around it, unchanged in its external `pushHistory`/`handleUndo`/`handleRedo`/`canUndo`/`canRedo` surface (so none of `App.tsx`'s ~30 existing `pushHistory()` call sites need to change), plus two additions: a `captureThumbnail: () => string` argument (called at every `pushHistory`/`handleUndo`/`handleRedo` to rasterize `stageRef.current.toDataURL()` at low resolution alongside each recorded snapshot) and a new `jumpBy(steps: number)` + `historyEntries` (the past stack's thumbnails, most-recent-first) for the popover UI. A new `HistoryPopover.tsx` sidebar component renders the thumbnail list and a live "Current" thumbnail captured fresh whenever it opens.

**Tech Stack:** React 19 + TypeScript, Konva/react-konva (`Stage.toDataURL`), Vitest for `lib/historyStack.test.ts`.

## Global Constraints

- Run `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`, `npm test`, `npm run build` — in that order — after each task, not after every small edit.
- `useUndoRedo`'s existing external contract (`pushHistory`, `handleUndo`, `handleRedo`, `canUndo`, `canRedo`) must stay call-compatible with every existing call site in `App.tsx` — do not touch those call sites as part of this feature.
- **Scope simplification, called out explicitly:** the popover shows only the *past* stack (current + earlier states you can jump back to), not the *future*/redo stack. Redo stays reachable only via the existing Redo button/Ctrl+Y. This keeps the display's ordering unambiguous (a redo stack's natural array order doesn't correspond to simple chronological or distance ordering once you've jumped around) and the implementation far simpler, at the cost of not visually browsing forward-in-time states — an acceptable trade for v1.
- No persistence: history (including thumbnails) lives only in the current session's `useRef`, exactly like today's undo stack. No save/load involvement.
- Thumbnails are a cheap, approximate rasterization (`pixelRatio: 0.15`, no grid/background hiding) — not a pixel-perfect preview. This is intentional; don't add export-quality treatment to it.

---

## File Structure

New files:
- `src/lib/historyStack.ts` — pure `{ past, future }` history-stack data structure and operations (`emptyHistoryStack`, `pushEntry`, `moveBack`, `moveForward`, `canUndo`, `canRedo`, `pastTimeline`).
- `src/lib/historyStack.test.ts` — unit tests for the above.
- `src/components/sidebar/HistoryPopover.tsx` — the button + popover UI.

Modified files:
- `src/hooks/useUndoRedo.ts` — rewritten internals on top of `historyStack.ts`; new `captureThumbnail` param; new `jumpBy`/`historyEntries` in its return value.
- `src/App.tsx` — `captureHistoryThumbnail` (stage rasterizer), passes it into `useUndoRedo`, passes `historyEntries`/`jumpBy`/`captureHistoryThumbnail` down to `Sidebar`.
- `src/components/Sidebar.tsx` — new props, renders `<HistoryPopover>` next to the existing Undo/Redo buttons.
- `src/components/Icons.tsx` — new `HistoryIcon`.
- `src/index.css` — new `.historyPopover*` classes, modeled on the existing `.fontSelectShell`/`.fontSelectList` anchored-popover pattern.
- `CLAUDE.md` — new documentation section.

---

### Task 1: `historyStack.ts` — pure history-stack data structure

**Files:**
- Create: `src/lib/historyStack.ts`
- Create: `src/lib/historyStack.test.ts`

**Interfaces:**
- Produces: `HistoryEntry<T> = { snapshot: T; thumbnail: string }`, `HistoryStack<T> = { past: HistoryEntry<T>[]; future: HistoryEntry<T>[] }`, `MAX_HISTORY`, `emptyHistoryStack<T>(): HistoryStack<T>`, `pushEntry<T>(stack, entry): HistoryStack<T>`, `moveBack<T>(stack, currentEntry, steps?): { stack; restore: HistoryEntry<T> } | null`, `moveForward<T>(stack, currentEntry, steps?): { stack; restore: HistoryEntry<T> } | null`, `canUndo<T>(stack): boolean`, `canRedo<T>(stack): boolean`, `pastTimeline<T>(stack): { thumbnail: string; steps: number }[]`. Task 2 (`useUndoRedo.ts`) consumes every one of these names and signatures exactly.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/historyStack.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  emptyHistoryStack,
  pushEntry,
  moveBack,
  moveForward,
  canUndo,
  canRedo,
  pastTimeline,
  MAX_HISTORY,
  type HistoryStack,
  type HistoryEntry,
} from "./historyStack";

const entry = (label: string): HistoryEntry<string> => ({
  snapshot: label,
  thumbnail: `thumb:${label}`,
});

describe("historyStack", () => {
  it("starts empty with no undo/redo available", () => {
    const stack = emptyHistoryStack<string>();
    expect(canUndo(stack)).toBe(false);
    expect(canRedo(stack)).toBe(false);
    expect(pastTimeline(stack)).toEqual([]);
  });

  it("pushEntry appends to past and clears future", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    expect(stack.past.map((e) => e.snapshot)).toEqual(["A", "B"]);
    expect(canUndo(stack)).toBe(true);
    expect(canRedo(stack)).toBe(false);
  });

  it("pushEntry after some future exists discards that future", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    const back = moveBack(stack, entry("live-after-B"))!;
    stack = back.stack;
    expect(canRedo(stack)).toBe(true);
    stack = pushEntry(stack, entry("C"));
    expect(canRedo(stack)).toBe(false);
    expect(stack.past.map((e) => e.snapshot)).toEqual(["A", "C"]);
  });

  it("moveBack one step: restores the most recent past entry, stashes current into future", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    const result = moveBack(stack, entry("live"), 1)!;
    expect(result.restore.snapshot).toBe("B");
    expect(result.stack.past.map((e) => e.snapshot)).toEqual(["A"]);
    expect(result.stack.future.map((e) => e.snapshot)).toEqual(["live"]);
  });

  it("moveBack N steps lands on the N-th past entry and preserves replay order in future", () => {
    let stack = emptyHistoryStack<string>();
    for (const label of ["A", "B", "C", "D"]) stack = pushEntry(stack, entry(label));
    const result = moveBack(stack, entry("live"), 3)!;
    // 1 step back = D, 2 = C, 3 = B — landing on B.
    expect(result.restore.snapshot).toBe("B");
    expect(result.stack.past.map((e) => e.snapshot)).toEqual(["A"]);
    // Redoing forward from here, one step at a time, should replay C, then D, then live.
    let forward = result.stack;
    let step = moveForward(forward, entry("B"), 1)!;
    expect(step.restore.snapshot).toBe("C");
    forward = step.stack;
    step = moveForward(forward, entry("C"), 1)!;
    expect(step.restore.snapshot).toBe("D");
    forward = step.stack;
    step = moveForward(forward, entry("D"), 1)!;
    expect(step.restore.snapshot).toBe("live");
  });

  it("moveForward N steps is the mirror image of moveBack N steps", () => {
    let stack = emptyHistoryStack<string>();
    for (const label of ["A", "B", "C", "D"]) stack = pushEntry(stack, entry(label));
    const back = moveBack(stack, entry("live"), 4)!;
    expect(back.restore.snapshot).toBe("A");
    const forward = moveForward(back.stack, entry("A"), 4)!;
    expect(forward.restore.snapshot).toBe("live");
    expect(canRedo(forward.stack)).toBe(false);
    expect(forward.stack.past.map((e) => e.snapshot)).toEqual(["A", "B", "C", "D"]);
  });

  it("moveBack clamps to available past and returns null when there is none", () => {
    const stack = emptyHistoryStack<string>();
    expect(moveBack(stack, entry("live"), 1)).toBeNull();
  });

  it("moveBack requesting more steps than available clamps to what's there", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    const result = moveBack(stack, entry("live"), 10)!;
    expect(result.restore.snapshot).toBe("A");
    expect(result.stack.past).toEqual([]);
  });

  it("moveForward returns null when there is no future", () => {
    const stack = emptyHistoryStack<string>();
    expect(moveForward(stack, entry("live"), 1)).toBeNull();
  });

  it("pastTimeline lists past entries most-recent-first with negative step counts", () => {
    let stack = emptyHistoryStack<string>();
    stack = pushEntry(stack, entry("A"));
    stack = pushEntry(stack, entry("B"));
    stack = pushEntry(stack, entry("C"));
    expect(pastTimeline(stack)).toEqual([
      { thumbnail: "thumb:C", steps: -1 },
      { thumbnail: "thumb:B", steps: -2 },
      { thumbnail: "thumb:A", steps: -3 },
    ]);
  });

  it("caps past length at MAX_HISTORY, dropping the oldest entries", () => {
    let stack: HistoryStack<string> = emptyHistoryStack<string>();
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      stack = pushEntry(stack, entry(`E${i}`));
    }
    expect(stack.past.length).toBe(MAX_HISTORY);
    expect(stack.past[0].snapshot).toBe("E5");
    expect(stack.past[stack.past.length - 1].snapshot).toBe(`E${MAX_HISTORY + 4}`);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/historyStack.test.ts`
Expected: FAIL — `Cannot find module './historyStack'`.

- [ ] **Step 3: Implement `historyStack.ts`**

Create `src/lib/historyStack.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/historyStack.test.ts`
Expected: PASS, all 11 tests.

- [ ] **Step 5: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/historyStack.ts src/lib/historyStack.test.ts
git commit -m "Add pure historyStack module for undo/redo with jump support"
```

---

### Task 2: Rewire `useUndoRedo` on top of `historyStack`, add thumbnail capture and `jumpBy`

**Files:**
- Modify: `src/hooks/useUndoRedo.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: everything from `historyStack.ts` (Task 1).
- Produces: `useUndoRedo<T>(getSnapshot, applySnapshot, captureThumbnail)` returning `{ pushHistory, handleUndo, handleRedo, jumpBy, canUndo, canRedo, historyEntries }`, where `jumpBy: (steps: number) => void` and `historyEntries: { thumbnail: string; steps: number }[]`. `pushHistory`/`handleUndo`/`handleRedo`/`canUndo`/`canRedo` keep their exact existing names and call signatures — every one of `App.tsx`'s existing call sites needs zero changes. Task 3 consumes `jumpBy` and `historyEntries`, plus `App.tsx`'s new `captureHistoryThumbnail`.

- [ ] **Step 1: Rewrite `useUndoRedo.ts`**

Replace the full contents of `src/hooks/useUndoRedo.ts`:

```ts
import { useCallback, useMemo, useRef, useState } from "react";
import {
  emptyHistoryStack,
  pushEntry,
  moveBack,
  moveForward,
  canUndo as stackCanUndo,
  canRedo as stackCanRedo,
  pastTimeline,
  type HistoryEntry,
  type HistoryStack,
} from "../lib/historyStack";

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
    stackRef.current = pushEntry(stackRef.current, {
      snapshot: getSnapshot(),
      thumbnail: captureThumbnail(),
    });
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
```

- [ ] **Step 2: Wire `captureHistoryThumbnail` into `App.tsx`**

In `src/App.tsx`, find (around where `getSnapshot`/`applySnapshot`/`useUndoRedo` are declared):

```ts
  const getSnapshot = useCallback(
    (): EditorSnapshot => ({ blocks, backgroundColor }),
    [blocks, backgroundColor]
  );

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setBlocks(snapshot.blocks);
    setBackgroundColor(snapshot.backgroundColor);
  }, []);

  const { pushHistory, handleUndo, handleRedo, canUndo, canRedo } = useUndoRedo(
    getSnapshot,
    applySnapshot
  );
```

Replace with:

```ts
  const getSnapshot = useCallback(
    (): EditorSnapshot => ({ blocks, backgroundColor }),
    [blocks, backgroundColor]
  );

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setBlocks(snapshot.blocks);
    setBackgroundColor(snapshot.backgroundColor);
  }, []);

  /**
   * Rasterizes the live stage at low resolution for history thumbnails.
   * No grid/background hiding (unlike useExport's toDataURL calls) — this
   * is a cheap approximate preview, not export-quality output.
   */
  const captureHistoryThumbnail = useCallback(
    () => stageRef.current?.toDataURL({ pixelRatio: 0.15 }) ?? "",
    []
  );

  const { pushHistory, handleUndo, handleRedo, jumpBy, canUndo, canRedo, historyEntries } =
    useUndoRedo(getSnapshot, applySnapshot, captureHistoryThumbnail);
```

`stageRef` is already declared above this point in `App.tsx` (`const stageRef = useRef<Konva.Stage | null>(null);`), so no new ref is needed.

- [ ] **Step 3: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass. (`jumpBy` and `historyEntries` are unused outside the hook until Task 3 — that's fine, they're part of a returned object, not unused local variables, so this doesn't trigger `no-unused-vars`.)

- [ ] **Step 4: Manual verification that existing undo/redo still works**

Run: `npm run dev`
Add a couple of blocks, move one, undo twice (button or Ctrl+Z), redo once (button or Ctrl+Y). Confirm behavior is unchanged from before this task — this task must be a no-op from the user's perspective except for the new (not yet wired up) capability.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useUndoRedo.ts src/App.tsx
git commit -m "Rewire useUndoRedo on historyStack, add thumbnail capture and jumpBy"
```

---

### Task 3: History popover UI

**Files:**
- Create: `src/components/sidebar/HistoryPopover.tsx`
- Modify: `src/components/Icons.tsx`
- Modify: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `jumpBy`, `historyEntries`, `captureHistoryThumbnail` (all from Task 2, threaded through `App.tsx` → `Sidebar.tsx` → `HistoryPopover.tsx`).

- [ ] **Step 1: Add `HistoryIcon`**

In `src/components/Icons.tsx`, add after `RedoIcon`:

```tsx
export const HistoryIcon: React.FC<IconProps> = (props) => (
  <IconBase {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l4 2" />
  </IconBase>
);
```

- [ ] **Step 2: Add popover CSS**

In `src/index.css`, add after the `.fontSelectOption--active` rule (around the existing font-select popover styles):

```css
.historyPopoverShell { position: relative; display: inline-flex; }
.historyPopoverList { position: absolute; bottom: calc(100% + 6px); left: 50%; transform: translateX(-50%); z-index: 30; display: flex; flex-direction: column; gap: 4px; width: 170px; max-height: 320px; overflow-y: auto; margin: 0; padding: 6px; background: var(--bg-panel); border: 1px solid var(--border-soft); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
.historyPopoverItem { display: flex; align-items: center; gap: 8px; width: 100%; min-width: 0; padding: 4px 6px; border: none; border-radius: 8px; background: transparent; color: var(--text-primary); font-size: 11px; cursor: pointer; text-align: left; }
.historyPopoverItem:hover:not(:disabled) { background: var(--overlay-hover); }
.historyPopoverItem--current { cursor: default; }
.historyPopoverThumb, .historyPopoverThumbPlaceholder { width: 48px; height: 36px; flex-shrink: 0; border-radius: 4px; border: 1px solid var(--border-soft); background: var(--bg-input); object-fit: cover; }
.historyPopoverLabel { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.historyPopoverEmpty { padding: 8px; font-size: 11px; color: var(--text-faint); text-align: center; }
```

- [ ] **Step 3: Write `HistoryPopover.tsx`**

Create `src/components/sidebar/HistoryPopover.tsx`:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { HistoryIcon } from "../Icons";

export type HistoryTimelineEntry = { thumbnail: string; steps: number };

export type HistoryPopoverProps = {
  historyEntries: HistoryTimelineEntry[];
  onJumpTo: (steps: number) => void;
  onCaptureCurrentThumbnail: () => string;
};

const relativeLabel = (steps: number) =>
  steps === -1 ? "1 step back" : `${-steps} steps back`;

/**
 * Popover anchored to a small history-icon button, listing thumbnails for
 * every earlier recorded point (most recent first) plus a live "Current"
 * row at the top. Clicking a thumbnail jumps directly there via
 * `onJumpTo`. Modeled on FontSelectRow's outside-click/Escape-to-close
 * anchored-popover pattern in `sidebar/FormControls.tsx`.
 */
export const HistoryPopover: React.FC<HistoryPopoverProps> = ({
  historyEntries,
  onJumpTo,
  onCaptureCurrentThumbnail,
}) => {
  const [open, setOpen] = useState(false);
  const [currentThumbnail, setCurrentThumbnail] = useState("");
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setCurrentThumbnail(onCaptureCurrentThumbnail());
  }, [open, onCaptureCurrentThumbnail]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="historyPopoverShell" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="sidebarCircleButton"
        title="History"
        aria-label="History"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <HistoryIcon size={14} />
      </button>

      {open && (
        <div className="historyPopoverList" role="menu" aria-label="Edit history">
          <button type="button" className="historyPopoverItem historyPopoverItem--current" disabled>
            {currentThumbnail ? (
              <img src={currentThumbnail} alt="" className="historyPopoverThumb" />
            ) : (
              <span className="historyPopoverThumbPlaceholder" />
            )}
            <span className="historyPopoverLabel">Current</span>
          </button>

          {historyEntries.map((entry) => (
            <button
              key={entry.steps}
              type="button"
              className="historyPopoverItem"
              title={relativeLabel(entry.steps)}
              onClick={() => {
                onJumpTo(entry.steps);
                setOpen(false);
              }}
            >
              {entry.thumbnail ? (
                <img src={entry.thumbnail} alt="" className="historyPopoverThumb" />
              ) : (
                <span className="historyPopoverThumbPlaceholder" />
              )}
              <span className="historyPopoverLabel">{relativeLabel(entry.steps)}</span>
            </button>
          ))}

          {historyEntries.length === 0 && (
            <div className="historyPopoverEmpty">No earlier steps yet.</div>
          )}
        </div>
      )}
    </div>
  );
};

export default HistoryPopover;
```

- [ ] **Step 4: Thread the new props through `Sidebar.tsx`**

In `src/components/Sidebar.tsx`, add to the import from `./sidebar/LayersPanel`'s neighborhood:

```ts
import { HistoryPopover } from "./sidebar/HistoryPopover";
```

Add to `SidebarProps` (next to the existing `onUndo`/`onRedo`/`canUndo`/`canRedo`):

```ts
  historyEntries: { thumbnail: string; steps: number }[];
  onJumpToHistory: (steps: number) => void;
  onCaptureCurrentThumbnail: () => string;
```

Add to the destructured props (next to `canUndo`, `canRedo`):

```ts
  historyEntries,
  onJumpToHistory,
  onCaptureCurrentThumbnail,
```

In the render, find:

```tsx
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="sidebarCircleButton"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <RedoIcon size={14} />
            </button>
          </div>
```

Replace with:

```tsx
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="sidebarCircleButton"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <RedoIcon size={14} />
            </button>

            <HistoryPopover
              historyEntries={historyEntries}
              onJumpTo={onJumpToHistory}
              onCaptureCurrentThumbnail={onCaptureCurrentThumbnail}
            />
          </div>
```

- [ ] **Step 5: Pass the props from `App.tsx`**

In `src/App.tsx`, find:

```tsx
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
```

Replace with:

```tsx
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        historyEntries={historyEntries}
        onJumpToHistory={jumpBy}
        onCaptureCurrentThumbnail={captureHistoryThumbnail}
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`
Add a few blocks and make several distinct edits (move a block, change its color, add another block, resize one). Click the new History icon next to Undo/Redo — confirm a popover opens above it showing a "Current" thumbnail at top and a thumbnail for each earlier edit below, most recent first, each roughly resembling what the canvas looked like at that point. Click a thumbnail a few steps back — confirm the canvas jumps directly to that state and the popover closes. Reopen the popover — confirm "Current" now reflects the jumped-to state and the list still shows the steps further back. Click Redo (button or Ctrl+Y) — confirm it moves forward through the states you jumped past, one at a time. Click outside the popover and press Escape while it's open — confirm both close it. Resize the sidebar to its minimum width and confirm the popover doesn't overflow the viewport or get clipped illegibly.

- [ ] **Step 7: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/sidebar/HistoryPopover.tsx src/components/Icons.tsx src/components/Sidebar.tsx src/App.tsx src/index.css
git commit -m "Add history-thumbnails popover to the sidebar"
```

---

### Task 4: Final verification and documentation

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: nothing new — this task only verifies and documents what Tasks 1–3 built.

- [ ] **Step 1: Full manual smoke test**

Run: `npm run dev`
Walk through, in order: build a small layout with several distinct edits (text, shape fill, an image) → open the History popover and jump back several steps → confirm the canvas matches what that thumbnail showed → make a brand-new edit from that jumped-to point → reopen the popover and confirm the old "future" (the states you'd jumped past) no longer appears as forward-reachable via Redo (a fresh edit should have cleared it, same as today's undo/redo) → verify Undo/Redo keyboard shortcuts (Ctrl+Z/Ctrl+Y) still work exactly as before interleaved with popover jumps → export to PNG and confirm the History popover thumbnails never appear in the export (it's sidebar UI, not a stage node, so this should already hold — confirm it does) → save and reload the layout (localStorage save/load) and confirm the app still works normally afterward (history itself is expected to reset on reload, matching today's undo stack).

- [ ] **Step 2: Run the full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all four pass.

- [ ] **Step 3: Document the subsystem in `CLAUDE.md`**

Add a new section to `CLAUDE.md`, immediately after the existing "### Export (`src/hooks/useExport.ts`)" section:

```markdown
### History thumbnails (`src/lib/historyStack.ts`, `HistoryPopover.tsx`)

The Undo/Redo buttons in `Sidebar.tsx` are joined by a small History icon
that opens a popover of thumbnails — one per earlier recorded point in the
edit history, most recent first, plus a live "Current" row captured fresh
each time the popover opens — letting the user jump directly to any of
them instead of only stepping one entry at a time.

`src/lib/historyStack.ts` holds the underlying data structure and is pure
(no React/Konva dependency, fully unit-tested in `historyStack.test.ts`):
a `{ past, future }` pair of `HistoryEntry<T> = { snapshot, thumbnail }`
arrays, with `pushEntry`/`moveBack`/`moveForward` as the only mutators —
`moveBack`/`moveForward` both accept a `steps` count (not just single
steps), which is what makes direct-jump possible without looping the
public undo/redo handlers (which would hit React state-batching issues if
called repeatedly in one synchronous burst).

`src/hooks/useUndoRedo.ts` wraps `historyStack.ts` and keeps its external
`pushHistory`/`handleUndo`/`handleRedo`/`canUndo`/`canRedo` surface
identical to before this feature — every existing `pushHistory()` call
site across `App.tsx` needed zero changes. It gains a required
`captureThumbnail: () => string` constructor argument (`App.tsx`'s
`captureHistoryThumbnail`, which rasterizes `stageRef.current.toDataURL()`
at `pixelRatio: 0.15` — cheap and approximate, not export-quality) called
alongside every recorded snapshot, plus `jumpBy(steps)` and
`historyEntries` for the popover.

**The popover only ever displays the past stack, never the future/redo
side** — `historyStack.ts`'s `pastTimeline` deliberately excludes it. A
redo-stack's natural array order doesn't correspond to a simple
chronological or distance ordering once you've jumped around via `jumpBy`
(each jump can stash multiple entries onto the opposite stack in one
move), so showing it as thumbnails would need a separate, more complex
ordering scheme; standard Redo (button/Ctrl+Y) remains the only way to
move forward again after a jump. Thumbnails, and history in general, are
in-session only — nothing here is persisted through save/load, matching
the undo stack's existing behavior.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "Document the history-thumbnails subsystem in CLAUDE.md"
```
