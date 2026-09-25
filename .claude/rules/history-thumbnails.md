---
paths:
  - "src/lib/historyStack*.ts"
  - "src/hooks/useUndoRedo*.ts"
  - "src/components/sidebar/HistoryPopover.tsx"
---

# History thumbnails (`src/lib/historyStack.ts`, `HistoryPopover.tsx`)

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
