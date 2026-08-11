# Visible Undo/Redo Thumbnail History — Design

Date: 2026-08-11
Status: Approved, ready for implementation planning

## Summary

A visible history panel, popover-triggered from the sidebar's existing
Undo/Redo buttons, that shows a scrollable list of small canvas
thumbnails — one per recorded history entry — and lets the user click any
thumbnail to jump directly to that point in the edit history, instead of
only stepping one entry at a time via Ctrl+Z/Ctrl+Y.

This is the fourth (last) of the user's originally planned four features
(text on path and diacritics control are both shipped; per-glyph/gradient
color is the other remaining one, not yet started).

## Existing behavior this builds on

`src/hooks/useUndoRedo.ts` is a generic two-stack (`undoStackRef` /
`redoStackRef`) snapshot hook. `App.tsx`'s `pushHistory()` wraps it and is
called at the start of nearly every mutating handler — for discrete
actions, before the state changes; for live-updating gestures (drag,
sliders, glyph edits), a per-gesture `useDebouncedHistoryPush` schedules
the actual `pushHistory()` call 300ms after the gesture settles, by which
point `setBlocks`/`setBackgroundColor` have already run. `EditorSnapshot`
is `{ blocks, backgroundColor }`. History is capped at 50 entries
(`MAX_HISTORY`) and is not persisted through save/load — it's pure
in-session `useRef` state today. Undo/redo buttons live in `Sidebar.tsx`
next to the block-creation buttons; `App.tsx` also owns `stageRef`, a
`Konva.Stage` ref already used by `useExport.ts` to rasterize the canvas.

## Non-goals for v1

- **No persistence.** History thumbnails live only for the current
  session, same as the undo stack does today — no save/load involvement.
- **No timestamps**, just relative ordering — sessions are short-lived
  enough that "N steps ago" is sufficient.
- **No thumbnails for Shape Fill/Warp/Text-on-path-specific intermediate
  math** — a thumbnail is just a rasterized capture of the whole stage at
  that point, so it automatically covers every block type with no special
  casing.

## Architecture

### `useUndoRedo`: two-stack → single array + cursor

The two-stack model has no way to express "jump to an arbitrary point in
history," which direct-jump-from-thumbnail needs. Replace it with:

```ts
type HistoryEntry<T> = { snapshot: T; thumbnail: string };

function useUndoRedo<T>(
  getSnapshot: () => T,
  applySnapshot: (snapshot: T) => void,
  captureThumbnail: () => string
) {
  // history: HistoryEntry<T>[], cursor: number (index of current entry)
  // pushHistory(): truncate history after cursor, append new entry, cursor++
  // handleUndo(): cursor--, applySnapshot(history[cursor].snapshot)
  // handleRedo(): cursor++, applySnapshot(history[cursor].snapshot)
  // jumpTo(index): cursor = index, applySnapshot(history[cursor].snapshot)
  // canUndo = cursor > 0; canRedo = cursor < history.length - 1
  // MAX_HISTORY cap unchanged (drop oldest entries, adjust cursor)
}
```

The very first entry (initial empty/loaded canvas state) is pushed once
on mount so `history[0]` always exists and the list is never empty.

### Thumbnail capture — synchronous, piggybacked on `pushHistory()`

`pushHistory()` already only ever runs *after* the live Konva stage
matches the state being recorded (true both for immediate calls, which
run before the mutating handler changes state — capturing the
*pre*-change stage, which is exactly what that stack entry should show —
and for debounced calls, since `setBlocks` already ran synchronously
before the debounce timer fires). So thumbnail capture is just:

```ts
const captureThumbnail = () =>
  stageRef.current?.toDataURL({ pixelRatio: 0.15 }) ?? "";
```

taken inside `pushHistory()` at push time — no off-screen re-render, no
re-shaping text. `App.tsx` passes this closure into `useUndoRedo` (mirrors
how `stageRef` is already threaded into `useExport`). If `stageRef.current`
is null, store `""` and the UI falls back to a placeholder swatch instead
of crashing.

Thumbnails are downscaled (`pixelRatio: 0.15`, roughly 120px wide for a
typical artboard) to keep memory trivial — 50 entries × a few KB each.

### UI — popover from the sidebar

A small history-icon button sits beside the existing Undo/Redo circle
buttons in `Sidebar.tsx`. Clicking it opens a popover: a vertical
scrollable list of thumbnails, most recent at top, the current-cursor
entry visibly highlighted (border/ring). Clicking any thumbnail calls
`onJumpTo(index)` and closes the popover. Each row shows a relative label
("current", "1 step back", "2 steps back", …) computed from
`cursor - index`. The popover closes on outside click or Escape, same
pattern as any other transient overlay in this app.

### Data flow

`App.tsx`:
- passes `captureThumbnail` (closing over `stageRef`) into `useUndoRedo`
- destructures `history`, `cursor`, `jumpTo` alongside the existing
  `pushHistory`, `handleUndo`, `handleRedo`, `canUndo`, `canRedo`
- passes `history`, `cursor`, `onJumpTo={jumpTo}` down to `Sidebar` as new
  props, alongside the existing `onUndo`/`onRedo`/`canUndo`/`canRedo`

`Sidebar.tsx`:
- new small subcomponent (e.g. `HistoryPopover.tsx` in
  `src/components/sidebar/`, matching the existing pattern of splitting
  sidebar pieces into their own files) owns the open/closed state and
  renders the thumbnail list from the `history`/`cursor` props

## Error handling

- Null `stageRef.current` at capture time → store `""`, render a plain
  placeholder swatch in that row instead of a broken image.
- `jumpTo` with an out-of-range index is a no-op (defensive clamp).

## Testing

- `useUndoRedo.test.ts`: rewritten for the array+cursor model — push,
  undo, redo, jumpTo (forward and backward), truncation of future entries
  on a new push after undo, and the `MAX_HISTORY` cap — using a stub `T`
  and a stub `captureThumbnail` (returns a counter string), no Konva
  involved.
- Thumbnail rasterization itself (`toDataURL`) is not unit-tested,
  consistent with this repo's existing pattern of not testing
  Konva-rendering code directly.

## Verification loop

Standard: `npx tsc --noEmit -p tsconfig.app.json`, `npm run lint`,
`npm test`, `npm run build`, plus a manual browser smoke test (make a few
edits, open the history popover, confirm thumbnails look right, jump
backward and forward, confirm a jump followed by a new edit correctly
truncates the "future" entries).
