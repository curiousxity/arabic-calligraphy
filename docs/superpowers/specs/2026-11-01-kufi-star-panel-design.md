# Kufi star panels: design

Status: approved in conversation 2026-11-01, written for planning. Three
stages, one design.

## Intent

Square Kufi panels built the way geometric patterns are drawn with compass
and ruler: a circle divided into equal parts, a star drawn from it, and the
panel split into regions that are rotations of one piece. Each region holds
Kufi text. The user's reference is a square panel with an 8-point star in the
centre, eight wedges of text around it and four corner triangles. The user's
framing: "If you can get the 4 correct, the rest is just rotations and
copying ... These are pieces to a puzzle."

Today's Kufi panel (see `.claude/rules/kufi-panel.md`) lays text as rings of
bands inside one rectangle. The star panel is a second kind of panel beside
it, not a change to it.

## The construction (settled by a spike, confirmed by the user)

For a fold `n` (4, 5 or 6), with `m = 2n`:

1. A circle divided into `m` equal points, one pointing straight up.
2. Construction lines: chords from each point to the point `k` steps on
   (star polygon `{m/k}`). `k` sets how fat or thin the star is. The spike
   used `{8/3}`, `{10/3}`, `{12/4}`; other `k` values are other options.
3. Picked segments make the regions:
   - **the star**: the `{m/k}` outline (tips on the circle, inner corners
     where the chords cross);
   - **`m` wedges**, one per tip: from the star's two inner corners beside
     that tip, straight out to a ring (a regular `m`-gon whose edges face the
     tips and whose corners sit on the inner-corner rays). The tip itself
     belongs to the star, so a wedge is a trapezoid with a V-shaped notch at
     its inner end where the tip pokes in (five corners: two inner corners,
     the tip, two ring corners);
   - **`n` corners**: the outer shape minus the ring.
4. The outer shape is a regular `n`-gon sharing the ring's edges that face
   every other tip: a **square for 4-fold, a pentagon for 5-fold, a hexagon
   for 6-fold**. The user wants these natural shapes, not every panel forced
   square.

Every region is a rotation (or mirror) of one piece, `1/(2m)` of the panel;
the spike checked this for all three folds. All `m` wedges are the same shape
turned; the wedges alternate between two **kinds** (tips facing an outer
edge, tips facing an outer corner), which matters for how words are split,
not for their shape.

The spike is in the session scratchpad (`star-spike/star.py`, throwaway). Its
geometry, not its code, is what this design fixes.

## What the user does

1. **Type the text.**
2. **The app evaluates.** For each construction it can build (fold 4, 5, 6;
   the star's `k`), it says whether the whole text, and each word, fits, and
   how well.
3. **The app offers splits.** It proposes ways to spread the words over the
   region kinds, for example:
   - one word repeated in every wedge of one kind and another word in every
     wedge of the other kind;
   - the whole text running once round the wedges;
   - a short word in the corners and a longer one in the wedges;
   - optionally a word in the centre star ("the center can be another
     option"); otherwise the star is pattern only.

   Each offer is a preview, best first, with a short note on what does not
   fit.
4. **The user approves one, and the app constructs the panel.**
5. **A toggle** shows or hides the construction lines: either the regions
   are bounded by drawn lines (bands, as in the reference) or only the
   letters show.

## Text in a region

- Each region has **its own square lattice, turned to face outward** from the
  centre. In 4-fold this puts alternate wedges at 0° and 45°, as in the
  reference; in 5- and 6-fold the lattices turn by 36° and 30°. One cell size
  for the whole panel, so the stroke weight is the same everywhere.
- The lattice grammar is today's: stroke = gap = one cell, no 2x2 of ink, the
  same authored letter forms (`kufiAlphabet.ts`).
- Regions are notched trapezoids (wedges) and triangles (corners), so
  letters meet slanted edges as a staircase of whole cells; nothing is cut
  mid-cell.
- **A region is filled, as today's panel is:** the same grammar (no empty
  2x2, fillers where needed), not a word floating in empty space. The panel's
  size in cells is chosen so the words fill their regions.
- **Seams:** every region keeps one empty cell of its own lattice inside its
  boundary, so ink on two differently turned lattices never touches. The
  construction-lines toggle is display only: hiding the lines leaves the
  layout and the save unchanged.
- The centre star, when it holds a word, uses one upright lattice.
- **A repeated word is built once and copied by rotation, never by mirror**:
  a mirrored copy would read backwards. The two wedge kinds each map onto
  themselves under rotation by `360/n`, so every repeat is a rotation.
- A region that holds its own word (text running round) is built on its own.
- **A word never crosses from one region into another.** A region may hold
  more than one word. Text running round starts at the top wedge and goes
  clockwise, as today's panel runs clockwise.

## Stages

1. **Geometry and preview.** Constructions for 4-, 5- and 6-fold, their
   regions, the outline drawing with the lines toggle, and the preview of
   options. No text yet beyond the user typing it.
2. **Square Kufi in a triangle or trapezoid.** Filling one polygon region on
   its own lattice. **Hidden inside the star panel** (the user's decision):
   a pure packer function with unit tests, no block type or sidebar of its
   own. Shape tiles the user places on the canvas stay the separate second
   recorded idea, which can build on this function later.
3. **Evaluate, split, construct.** Fit per word and per text, the split
   offers, building the approved panel by rotation, and saving it so it
   reopens identical.

## Goals

- The three folds build, in their natural shapes, from the construction
  above.
- The app, not the user, judges fit, and says plainly what fits and what
  does not.
- The panel reads correctly in every region: every copy upright relative to
  its own region, never mirrored.

## Non-goals (for this design)

- Fivefold or sixfold patterns forced into a square with filler pieces.
- Tiling many panels into a wall; one panel at a time (the mosaic idea is
  stage 2's shapes, placed by the user).
- Editing letters inside a built star panel with the existing per-letter
  tools (move word, stretch, forms). Rebuild from the options instead.
- Flowing angular Kufi (the third recorded idea).

## Anti-goals

- A panel that looks right but is not built from the construction (hand
  placed regions, unequal wedges).
- Mirrored text anywhere.
- Letters scaled or squashed to fit a region; fitting is by lattice size and
  by the authored forms, as today.

## Constraints

- Packer work stays pure and deterministic, runs in the worker, and has a
  work budget plus a clock safety net, as `kufiPack.ts` does today.
- Saved panels reopen identical.
- Old saves are untouched; no field or block-type name may reuse one in
  `REMOVED_BLOCK_TYPES` / `REMOVED_BLOCK_FIELDS`.
- No names of teachers, calligraphers, studios or products in committed
  files.

## Calls made by Claude (the user did not decide these)

- Regions are filled with today's grammar; seams keep one empty cell; the
  lines toggle is display only; a word never crosses regions; text running
  round goes clockwise from the top wedge.
- At most two stars per fold are offered: the classic one (`{8/3}`,
  `{10/3}`, `{12/4}`) and one alternative, to keep evaluation inside the
  packer's budget.

- A star panel is a **new block type**, not a mode of `kufiPanel`.
- The star's centre is pattern by default; a word there is one of the
  offers.
- Within a region, lines run parallel to the region's outer edge, baselines
  on the outer edge, filling inward (as today's rings put baselines on the
  outer edge).
- The construction lines, when shown, are drawn one cell wide.

## Left to the builder

- How fit is scored and how many offers to show.
- How the panel's size in cells is chosen for a text.
- How corners orient their lattice (to the corner's apex or to its long
  edge), as long as the text reads upright for its region.
- The UI for offers and approval, within the existing Kufi sidebar patterns.
