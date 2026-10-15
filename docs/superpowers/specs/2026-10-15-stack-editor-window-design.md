# Stack editor window: all composition editing in one place

**Date:** 2026-10-15
**Status:** approved in conversation; implementation to be planned
**Builds on:** `docs/superpowers/specs/2026-10-14-stacked-compositions-design.md`
(the bake, pieces, joins), `2026-10-15-stack-arrange-fill-design.md` (filling
a guide), `2026-10-15-bend-curves-design.md`, and
`.claude/rules/stacked-compositions.md`.

## Problem

A stacked composition is edited in place on the main canvas: select it and
the editing overlay appears on top of the artwork, among every other block,
at whatever zoom the canvas happens to be at. Its controls are split between
the canvas (drags) and the Stack panel (join thickness, move together, fill
a guide, reset). Filling a shape needs a guide block drawn on the canvas
first, and the result is only "how it will look" by inference. The user
asked for a clear editing mode: a window that shows the composition as it
will appear on the canvas, explains the gestures, and offers teardrop and
almond templates to arrange the letters into.

## Decision

**All editing of a stack block happens in a modal editor window.** On the
main canvas a stack block is a plain block: click selects, drag moves,
Typography styles it, Delete removes it. The on-canvas `StackEditOverlay`
is no longer mounted there. Double-clicking a stack, or pressing **Edit
composition** in the Stack panel, opens `StackEditorDialog`, which shows the
composition with the real renderer on its own Konva stage and carries every
editing control.

**Edits are staged.** The window works on a draft of the block and has its
own undo stack. **Done** writes the draft back as one history step; **Cancel**
discards it. The main canvas never shows an intermediate state.

**The gesture model does not change.** Inside the window the pointer-over
outline and the direct drags on the ink are exactly what the 2026-10-15
design settled on: no modes, no dots, no tool strip. The "editing mode" is
the window, not a switch inside it.

Rejected:

- *Live edits with a Cancel that restores a snapshot.* Cheaper (the five
  existing handlers would simply be passed in), but the user chose staging:
  the canvas behind the dialog should show the committed design, not a
  work in progress, and Cancel should be free of history side effects.
- *Templates as guide blocks dropped on the canvas.* It reuses today's path
  unchanged, but leaves a guide behind on the artboard that the user did not
  draw. The template is a shape the editor knows about and nothing more.
- *Keeping a reduced overlay on the main canvas (move only).* Two places to
  edit is the problem being solved.

## The window

A portaled modal (to `document.body`, like every modal here — nothing that
is not artwork may live in the main stage) sized near the viewport:
`width: min(1180px, 96vw); height: 90vh`. Three regions.

**Centre: the proof.** A second Konva `Stage` filling the region. It renders
the draft through `StackView` with the same `stackProps` CanvasStage uses,
so fill, gradient, texture, outline and shadow are the block's own, and the
same `StackEditOverlay` mounted as its `editing` child. The stage background
is the canvas surface colour (the artboard's paper where a page is set,
otherwise the freeform surface), so the composition reads as it will on the
canvas. On open the view is fit to the draft's ink bounds with a margin of
12% of the shorter side and the block's rotation applied; **Fit view**
re-fits (after a template arrange the fit is redone automatically, since
the block's size changes). Zoom is otherwise fixed: the overlay's chrome is
drawn in constant screen px (`strokeScaleEnabled={false}`), so a large fit
scale is fine. The overlay reaches its stage through `getStage()` on its
own node (`.stackpull` / `.stackbend` listeners), so it needs no change to
live in a second stage.

**Right column**, top to bottom:

1. **Gestures.** A short list, one line each: *Move* (drag a letter; the
   letters after it come along), *Tilt* (drag just outside the edge; Shift
   for even steps), *Bend* (drag a curve; double-click to straighten), *Pull
   a tail* (press the free end of a straight stroke and pull), *One letter
   alone* (hold Alt, or untick Move letters together). This text replaces
   the paragraph in `StackPanel`, which no longer describes gestures, so it
   lives in one place: the dialog.
2. **Templates.** A strip of cards: **Free** (no shape), **Teardrop**,
   **Almond**, then one card per closed guide on the canvas, labelled as the
   Stack panel's select labels them today. Picking a card arranges the
   letters (below). The chosen card is highlighted; **Free** clears the
   outline and arranges nothing.
3. **Template size.** A range, 50–200%, default 100%, enabled when a
   built-in template is chosen. Changing it re-arranges into the resized
   shape.
4. **Fill gaps with tashkeel** (checkbox, default on). Honoured on the next
   arrange; toggling it re-arranges if a template is chosen.
5. **Join thickness** (the `nib.minFraction` range, as today).
6. **Move letters together** (checkbox, as today).
7. **Reset layout** (as today: pieces to home, joins to rest, fillers gone,
   template cleared).

**Footer:** Undo, Redo (editor-local), Cancel, Done. The dialog title names
the spelling, set in the block's font (`dir="rtl"`).

The status line that `arrangeStackNow` writes today ("Arranged 4 letters in
2 rows…") is shown in the dialog's footer, not the app status bar.

## Staged state

`StackEditorDialog` receives the block and returns a patch:

```ts
type StackDraft = Pick<StackBlock, "pieces" | "joins" | "fontSize" | "nib">
  & { x: number; y: number; rotation: number };
props: {
  block: StackBlock;
  surfaceColor: string;
  closedGuides: { id: number; label: string; polygon: Pt[]; x: number; y: number; rotation: number }[];
  loadFillers: (block: StackBlock) => Promise<{ fillers: FillerShape[]; note: string }>;
  onDone: (patch: StackDraft) => void;   // one history step in App
  onCancel: () => void;
}
```

- The draft starts as a copy of the block. `x`, `y`, `rotation` are carried
  only so a canvas-guide arrange can move the block onto the guide on Done;
  nothing in the window changes them otherwise.
- **Editor-local undo** uses the existing generic `useUndoRedo` hook with
  the draft as the snapshot and `() => ""` as the thumbnail capture. The
  overlay's `onBegin` pushes to it; split and bend push before mutating, so
  a tail pull and a curve free stay one step each, exactly as on the canvas
  today.
- The five overlay callbacks are rewired to the draft with the pure helpers
  that exist already: `onSetPieces` and `onSetBow` patch the draft;
  `onSplit` calls `splitPieceAtCut`; `onBend` calls `bendCurveAt`. The
  App-side `setStackPieces`, `setStackJoinBow`, `splitStackPiece`,
  `bendStackCurve`, `arrangeStackNow`, `arrangeStackInGuide` and
  `resetStackLayout` are removed, with their props through `Sidebar` and
  `CanvasStage`. "Move letters together" and "Fill gaps" stay App state
  (preferences, neither saved nor undoable), passed in and out.
- **Done** calls `onDone(draft)` only if the draft differs from the block
  (`pieces`, `joins`, `fontSize`, `nib`, `x`, `y`, `rotation` by reference
  or value); App does `pushHistory()` + `updateBlock(id, patch)` and closes.
  A Done with no change closes without a history entry.
- **Cancel** closes. If the draft changed, a `ConfirmDialog` ("Discard the
  changes to this composition?") stands in front of it. Escape is Cancel.
- **Keys inside the window.** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y drive
  the editor's stack. App's global keydown handler returns early while the
  editor is open (`stackEditorId !== null`), the way it does behind the
  start screen, so Delete, nudge, paste and the app's undo cannot act on
  the block underneath. Alt and Shift keep their overlay meaning.
- While the window is open the main canvas still has the block selected and
  unchanged; the modal backdrop takes all pointer events, so no second
  overlay exists and nothing underneath can be dragged.

## Templates and arranging

`src/lib/stackTemplates.ts` (pure, no `./harfbuzz`):

```ts
export type StackTemplate = "teardrop" | "almond";
/** The template's container polygon in px, centred on the origin, scaled
 *  uniformly so its height equals `inkHeightPx × sizeFactor`. */
export function templatePolygon(t: StackTemplate, inkHeightPx: number, sizeFactor: number): Pt[];
```

It builds the path with `guidePathD(t, GUIDE_DEFAULTS[t])`, takes its
`containerPolygon`, and scales it uniformly. `inkHeightPx` is the
composition's ink height **when the window opened** (re-measured on Reset
layout), not the current draft's: sizing from the current ink would feed
each arrange into the next, so re-picking a card would shrink the letters
every time and the slider's 100% would drift (found in review). The width follows the shape's
default aspect (teardrop 260:380, almond 220:400). Height is matched rather
than width or area because a stacked name climbs: the user's composition is
tall, and the template's height is what the rows fill.

Arranging, inside the dialog:

1. Strip fillers from the draft (as today), then
   `arrangeStackInShape({ pieces, joins, shapePx, fontSize, unitsPerEm, fillers, pullStems: true })`.
   The polygon is the template's (centred on the origin: the block's own
   origin, so the block does not move) or a canvas guide's `containerPolygon`
   (also centred on *its* origin; the draft's `x`, `y`, `rotation` are set to
   the guide's, so Done moves the block onto it, as "Fill a guide shape" does
   today).
2. Fillers are loaded through `loadFillers`, which App implements exactly as
   `arrangeStackInGuide` does today (`shapeText` for the font's tashkeel,
   `teardropShape` on failure, with the "font unavailable" note). The load is
   async; the dialog arranges against the draft *at completion*, pushes one
   editor-undo step, and ignores a result whose template choice is no longer
   current (the user clicked another card while the font loaded).
3. The result's `pieces`, `joins` and `fontSize` replace the draft's. The view
   re-fits.
4. The template outline is drawn in the editor stage as a dashed path in the
   ink's complement (`complementColor.ts`), `listening={false}`, above the
   block. It is editor chrome: it is never saved, never exported, and does
   not survive closing the window. Re-opening starts at **Free**.

Re-picking the same card, moving the size slider, or toggling Fill gaps
re-runs the arrange from the current draft (not from home), so hand edits
made since are re-flowed rather than lost; Reset layout is the way back to
the conversion. An arrange that cannot fit (`null`) or throws leaves the
draft untouched and reports in the footer status.

## Main canvas and panel

- `CanvasStage`: a stack block renders `StackView` without `editing`;
  `commonProps.onDblClick` for a stack calls a new `onEditStack(id)` instead
  of the text editor. The `onBeginStackEdit` … `onBendStackCurve` and
  `stackMoveTogether` props go.
- `StackPanel`: the spelling, "Baked from …", and an **Edit composition**
  button. Everything else moves to the dialog. The "add a closed guide"
  hint goes: templates no longer need one.
- `App.tsx`: `stackEditorId: number | null` state; `openStackEditor`,
  `closeStackEditor`, `commitStackEditor(patch)`; the global key guard; the
  `loadFillers` implementation; the dialog mounted beside the other modals.
- The e2e bridge (`testBridge.ts`, read-only) gains
  `getEditorStage: () => Konva.Stage | null`, set while the dialog is
  mounted, so the suite can resolve `.stack-piece` nodes inside the window.

## Testing

- `stackTemplates.test.ts`: both templates give a closed polygon centred on
  the origin, height equal to `inkHeightPx × sizeFactor` within a sample's
  tolerance, width in the default aspect.
- Existing stack e2e specs (drag, tilt, pull, bend, free a bowl) open the
  editor first and resolve nodes through `getEditorStage`; their assertions
  on the committed block run after **Done**.
- New e2e: double-click opens the editor and the Stack panel button does
  too; Cancel after a drag leaves the block byte-identical; Done after a
  drag changes the block and one Ctrl+Z on the canvas restores it; picking
  Teardrop changes `fontSize` and lays letters in more than one row (block
  count of letter pieces unchanged, `x`/`y` unchanged); Escape with no
  change closes without a confirm.
- Typecheck, lint, unit, build, then `npm run e2e` (Chromium).

## Docs

- `.claude/rules/stacked-compositions.md`: add
  `src/components/StackEditorDialog.tsx` and `src/lib/stackTemplates.ts` to
  `paths:`; a new section "The editor window" replacing the sentences that
  describe the Stack panel's controls; the "Fill a guide shape" section
  notes the polygon now comes from a template or a guide and the block only
  moves for a guide.
- `src/components/guide/sections/stacked.tsx`: open the window, templates,
  Done/Cancel.
- `PROGRESS.md`: one line and a pointer.

## Open questions

- Whether the chosen template should be remembered on the block so the
  outline shows again on re-open. Not in this version; the arrange result is
  the record.
- Whether the window should offer wheel zoom and pan. Not in this version;
  Fit view and the automatic re-fit cover the cases seen so far.
