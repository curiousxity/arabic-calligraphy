# Square Kufi panel: making it easy to use

Follows `2026-10-28-square-kufi-compositions-design.md` (the single-box build).
The user tried the panel in the app (via a demo) and judged it "kinda
difficult to use". The user approved this order of work and skipped further
questions; the calls below marked *(my call)* are mine, not theirs.

## Why

On a packed panel (Al-Baqarah 2:286 at 21×21) every cell is spoken for, so
most edits are refused: "No room to stretch that here", "No other form of
that letter fits here". Nothing shows beforehand which letters can change,
so editing is trial and error. The tools are hidden (hover-only handles,
half-cell targets, Alt to paint, a second click to place a new panel), the
refusals land in the sidebar far from the pointer and linger after the next
action, an accepted edit can move neighbouring letters without warning, and
a box too big for the text draws nothing at all.

The deeper mismatch: the panel asks for cell-by-cell editing of a solved
puzzle, while a calligrapher choosing a layout looks at options and picks
one. So the work leads with options and turns editing into choosing among
things known to fit.

## Goals, in build order

1. **Arrangements strip.** When the panel has packed, the Kufi panel section
   shows a strip of up to 6 other valid arrangements as thumbnails, the
   current one first and marked. Clicking one applies it as one undo step.
2. **Show what fits before trying.** Selecting a letter shows its other
   forms that pack here as small previews (forms that don't are shown
   greyed); a click applies one. Stretch handles appear only on ends that
   have a fitting length, and a drag snaps to the lengths that fit.
3. **Visible tools and nearby messages.** A small tool row for the selected
   panel (Select, Stretch, Move word, Paint) replaces hover-resolution and
   Alt as the way in; Alt-paint stays as a shortcut. A refusal shows as a
   short message next to the letter or pointer and fades; the sidebar status
   clears when a new action starts.
4. **A box that doesn't fit still shows something.** When the result is not
   packed, the canvas draws the box frame at its size with the reason and the
   size buttons ("Fit", "Use 21×21") on it, instead of an empty canvas.

## Non-goals

- Making more texts pack (the Shahada and most others still don't). It
  stays the first item of the next packer plan; for a text that doesn't
  pack, the strip and per-letter options are simply empty.
- Arrangements that differ by two or more coordinated changes, other ring
  directions or start corners. v1 options are one change away from the
  current panel (with whatever repacking that change causes).
- Re-route rearranging the rest of the panel (still the user's open decision).
- Touch-specific tools; other layouts; flowing Kufi.
- Removing the place-click after Add: it is the app's general Add pattern.

## Anti-goals (it fails even if it works)

- Options that look the same as each other or as the current panel.
- Options or previews that break the dot rules or the filler order (the
  packer already guarantees both; nothing may bypass it).
- Any packing on the main thread during editing, or option search slowing
  the canvas edits' own previews.
- A filler-heavy option shown ahead of a clean one.
- Previews that disagree with what a click then does.

## How it works

### One exploration feeds parts 1 and 2 *(my call)*

For the current packed result and edits, a background job tries every
single change the canvas tools could make:

- each unit's other forms (a `forms` edit, pinned as the canvas form click
  does);
- each stretchable letter's slices at −2…+2 cells from its current counts
  (a `stretch` edit, as the stretch drag does).

Each try is `packKufiPanel({ text, cols, rows, edits: edits ⊕ change,
previous: current })`, the same call the canvas makes, so a preview always
matches what a click does. The job returns, per unit, which forms and which
stretches pack (with the resulting edits and result), and the distinct
packed panels found.

- **Runs in its own worker**, separate from the pack worker, so the canvas
  edit previews never wait behind it. Results stream back as they arrive;
  the job is cancelled (worker message or terminate) when the panel's
  inputs change.
- **Bounded**: tries cheapest-first (forms, then ±1, then ±2) and stops at
  a total work cap (*(my call)* about 10 s on the Geekmini for Baqarah;
  the builder sets the exact cap from a measurement). Deterministic, since
  each repack is work-budgeted.
- **Cached** by the inputs key the layout client already uses, so returning
  to a panel, undo and redo do not re-explore.

### The strip (part 1)

- Options are the distinct packed panels (by cell signature, current one
  excluded), ranked by the packer's own order — fewest filler squares, then
  least shortening, then least lengthening — which means the ok result must
  carry those three numbers (a small additive field). Among equals, prefer
  the option differing most from the current panel and from options already
  chosen (greedy, by changed cells).
- Thumbnails draw the cells only (one `<canvas>` or SVG per option, a few
  px per cell); the changed letter is tinted on hover so the difference is
  visible.
- Applying an option sets the block's edits to that option's edits in one
  history step, exactly as the matching canvas action would.
- While exploring: the strip shows the options found so far and a quiet
  "Looking…"; when done with none: "No other arrangement fits this box".

### Per-letter options (part 2)

- Selecting a letter (click in Select tool) shows, in the sidebar, its forms
  as small glyph previews: fitting ones clickable, the current one marked,
  the rest greyed. Before exploration reaches that letter, all forms show
  as "checking".
- The click form-cycle on the canvas stays, but cycles only through forms
  known to fit; it no longer packs under the pointer, which also removes the
  "No other form fits" false refusal under load.
- Stretch handles show only on ends with a fitting length; while dragging,
  the fitting lengths are marked and the drag snaps to the nearest one.

### Tools and messages (part 3)

- A tool row (Select · Stretch · Move word · Paint) appears in the Kufi
  panel section *(my call: sidebar, not floating on the canvas)* with the
  current tool highlighted; the canvas overlay shows only that tool's
  handles, full-cell targets. Alt still paints from any tool.
- Refusals and confirmations show as a small label next to the letter for
  ~2 s; the sidebar line keeps panel-level state only (arranging, too long,
  painted cells leave a gap) and clears stale edit messages.

### A box that doesn't fit (part 4)

- Not packed: draw the frame of the box at its size in the panel's colour,
  dimmed, with the status text in it and its size suggestions plus Fit as
  buttons (canvas-native, click-through to the same actions as the sidebar).

## Constraints

- Everything from `.claude/rules/kufi-panel.md` and the single-box spec
  holds: dot rules, filler order, lattice grammar, export as one outline.
- The packer stays pure and deterministic; new fields on its result are
  additive.
- Existing unit and e2e tests keep passing; e2e for the overlay may change
  where tools replace hover-resolution, and each such change is named in
  its task.
- Repo rules as before: no names of teachers, calligraphers, studios or
  products; reference images stay local; never merge to main.

## Left to the builder

- The exact work cap and stop rule for exploration, from measurement.
- Thumbnail size and drawing method; how the changed letter is tinted.
- The tool row's look, within the existing sidebar style.
- Whether a cancelled exploration terminates its worker or is told to stop.
