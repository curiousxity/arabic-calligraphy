# Square Kufi compositions — design

Status: draft for the user's approval. Branch `claude/kufi-square`.

## Intent

The user wants to make square Kufi (الكوفي المربع) panels in HarfCanvas: a
text worked into a shape on a lattice, every stroke one cell wide, every gap
one cell wide, the shape packed edge to edge. The reference they gave is a
square panel of «لا يكلف الله نفسا إلا وسعها» (Al-Baqarah 2:286); the wider
ambition is the four-fold «الله» panel, the eight-fold star panel, and tiled
mosaic walls of triangles, diamonds and trapezoids.

**Why the old block failed.** HarfCanvas had a `squareKufi` block until
2026-10-14 (removed at the user's request; recoverable from commit `2d3aeb1`,
including its write-up `.claude/rules/square-kufi.md`). In the user's words,
*"it did not work. I had imagined that I would be able to make something like
this"* — the four references above. The old block treated square Kufi as a
font: type text, get rows. Every reference is a **composition**:

- words **turn corners** — a line runs along one edge, turns 90° and carries
  on, so baselines face different edges of the frame;
- compositions **rotate** — one unit turned about a centre (4-fold, 8-fold);
- letters **stretch to fill** — stems and baselines lengthen so the frame is
  packed with ink and gap equal everywhere; spacing is decided by the
  composition, not fixed;
- the frame **isn't always a square**, and some panels use 45° strokes.

The user confirmed this reading: "what you are describing is correct".

## How the user works (agreed)

1. **Text plus a layout.** Type the text, then pick how it fills space. The
   user's list: *single box, single shape, custom shape, repeating shape,
   tile tessellations*.
2. **The app makes a complete first draft.** It decides where each word
   runs, which way it faces and how far strokes stretch, so the frame is
   packed. Never a blank grid to fill by hand.
3. **The calligrapher steers.** Proposed by Claude, accepted by the user
   ("yes that matches, go with that"):
   1. **Stretch a stroke** — drag a stem or baseline end; it grows or shrinks
      in whole cells and the rest re-packs around it, keeping gaps at one cell.
   2. **Swap a letter's form** — click a letter to cycle its square-Kufi
      alternates (ه, ك, lam-alif and others have several), like Next Shape.
   3. **Re-route a word** — drag a word along its path to change where it
      turns a corner or which edge it reads from.
   4. **Pin what you've touched** — hand edits stay put when the app re-packs
      the rest; otherwise each fix undoes the last.
   5. **Edit one, change all** — in a repeating layout, editing one copy
      shows in every copy live.
   6. **Paint single cells** — add or remove one square, as the last resort.

## Scope of this build: the single box

The user: *"single box first. write the rest in a future build plan along
with the flowing kufi."*

**Goals**

- A new block whose text is laid out as square Kufi filling **one
  rectangle** (square by default), chosen by width × height in cells.
- The first draft is a packed composition: lines may run in any of the four
  directions and turn 90° corners; stems and baselines stretch to close
  empty space; stroke = gap = one cell throughout.
- Editing tools 1, 2, 3, 4 and 6 above. (5 belongs to repeating layouts.)
- Export through the existing PNG/JPEG/SVG/PDF paths as **one traced
  outline**, not a cell grid, so it cuts cleanly (the four-fold «الله»
  reference is laser-cut acrylic).
- Saved projects round-trip.

**Success looks like:** typing «لا يكلف الله نفسا إلا وسعها», choosing a
square, and getting a panel a calligrapher would accept as the same kind of
thing as the reference — then fixing whatever they dislike with the tools
above in a few moves, not by repainting cells.

**Non-goals for this build:** non-rectangular frames, custom shapes,
repeating/rotational layouts, tessellations, 45° strokes, the flowing angular
Kufi. All are in the future plan below.

**Anti-goals — this fails even if it technically works when:**

- the output reads as rows of typed text in a box (the old block's failure);
- the frame has holes or uneven gaps the user must hand-paint to close;
- a hand edit is silently undone by the next re-pack;
- a letter is distorted to fit: letters change only by stretching or
  shortening a marked stroke in whole cells, never below a minimum (the
  user's "yes", 2026-10-28; see Constraints), or by swapping to another
  authored form. (Consistent with
  the user's standing rule: "never scale a whole glyph to lengthen a
  stroke".)

## Constraints

- **Canvas taste** (from the user, standing): no modes and no coloured dots
  on the canvas; hover outlines and direct drags; small unobtrusive handles
  are acceptable. The old block's "Paint cells" checkbox was a mode — cell
  painting here must work without arming one (e.g. a modifier-drag or a
  context action on hover; builder's call within that rule).
- **Lattice grammar** (carried from the old block, where it was enforced by
  tests): ink is 4-connected within a letter; no 2×2 block of ink anywhere;
  joins are single-cell-wide runs. A turned corner is the same primitive as a
  join.
- **No tashkeel. Dots are iʿjām; single squares are fill.** This was
  Claude's call at first ("no dots"). Rebuilding the user's Al-Baqarah panel
  cell by cell (2026-10-28) showed that real panels shorten tall letters
  (lams 7 → 5 squares, to the band depth) and use dots and lone squares to
  plug holes. Take any one away and gaps open. Asked whether our letters may
  do the same, the user said **"yes"** (2026-10-28). The packer may therefore
  shorten a stroke at its marked row, never below the letter's minimum, and
  may place a single square where it closes a hole.
  **Dots are read as letter dots** (the user, 2026-10-29: a dot above ي
  "should be 2 dots not one"; two dots on the ن of نفسا "would make it a
  ta"). A dotted letter gets its whole set of dots on its correct side (ي
  two below, ت two above, ث three above, ن and ف one above, ب one below) or
  none; a dot never goes in only to fill a hole. A dot still never makes a
  2×2. A letter's whole set may move one cell along its line when its
  usual spot is blocked, keeping its count and side (as the ف of نفسا does
  in the reference); the user: "yes it is acceptable" (2026-10-29).
- **The block type must not be named `squareKufi`**: that name is in
  `REMOVED_BLOCK_TYPES` (`src/lib/legacySaves.ts`) so pre-removal saves load
  with those blocks dropped. Use a new type name and new field names.
- **Letterform source:** the online studio the user uses is the convention
  for shapes (it has square-Kufi lessons for the Shahada, the Kalima and
  Surah al-Asr). **On 2026-10-28 the user permitted taking the square-Kufi
  letter shapes from its lessons and sheets** ("yes"), on the condition that
  they stay local and the studio isn't named in the repo. The plan therefore
  includes an import step: collect each letter's forms, alternates (ه, ك,
  lam-alif, the «الله» ligature and others) and which strokes stretch, then
  check the old `2d3aeb1` table against them. The source material stays on
  the machine or the NAS. What gets committed is our own cell table, written
  to the studio's conventions. The studio's name, and the names of any
  teacher or product, stay out of committed files.
  The user's reference photos are reference only and are not committed.
- **Repo rules:** a new `.claude/rules/<subsystem>.md` with `paths:`
  frontmatter and one line in CLAUDE.md's index; pure layout modules must not
  import `./harfbuzz`; after any TS change run typecheck, lint, tests, build.
  The user asks before `src/` changes and browser tests — approving this
  design and its plan is that permission for this work. Never merge to main.

## What can be reused from `2d3aeb1`

Read `.claude/rules/square-kufi.md` at that commit first. Worth salvaging:

- `squareKufiAlphabet.ts` — every letter in every joining form as `#` rows,
  plus its structural tests (rectangular, non-empty, 4-connected, no 2×2,
  join ink at the baseline end). It has one form per letter; this build needs
  **alternates** and **stretchable strokes** on top of it.
- `cellRings` — one outline traced around the union, holes wound so a
  nonzero fill empties counters. Exactly what export needs.
- The boustrophedon notes — a turned line is rotated, never mirrored; the
  gutter arithmetic that kept a turn from making a 2×2 (measured: one gutter
  column gave 123 bad compositions out of 144, two gave 0).
- The cell-edit anchoring lesson: an edit is keyed to a letter, never to a
  grid coordinate, because almost any change moves every absolute cell.

Not salvaged: the row-wrapping layout and the column-fit search — the new
packer replaces them.

## The hard part, and how to de-risk it

The packer — text plus a rectangle in, a packed lattice out — is a search
problem with no ready-made answer, and it decides whether the feature works
at all. **Build it first as a throwaway spike** outside `src/` and judge its
output by eye against the references before any UI exists: the Al-Baqarah
phrase, «الله» and a Shahada, each in two or three box sizes. Show the user
those pictures (ours beside the reference) and get a go-ahead on the look
before the block, the renderer and the editing tools are built.

**References for judging** (local to the user's machine, never committed):
the Al-Baqarah square panel, the four-fold «الله» panel, the eight-fold star
panel and the mosaic tile wall, all on the user's Desktop
(`2527ed6b….jpg`, `images (1).jpg`, `images (2).jpg`, `images.jpg`), plus the
studio's Shahada lesson.

**Composition structure** (Claude's call): no single structure is fixed in
advance. The references mix row bands joined by turns, a column of text
turned 90° down one side, and words facing different edges. The spike tries
these on the test phrases; the user picks from the pictures, and what they
pick becomes the packer's target.

**When the text doesn't suit the box** (Claude's call): the box size is
something the user sets, and the packer never leaves part of the box unfilled
or silently breaks a pin to make the text fit. When a box can't be filled
cleanly, it says so and offers the nearest sizes that work. "Fit" picks a
size for the user, who can override it.

**How much moves after an edit** (Claude's call): as little as possible. A
stretch or a re-route repacks only what has to move to keep the gaps at one
cell, and the drag shows a live preview. Re-solving the whole panel after a
one-cell drag would make editing feel chaotic. This puts a stability
requirement on the packer, so it has to be settled before its method is
chosen.

What the packer must honour, whatever its method:

- reading order starts top right and is unambiguous to a reader;
- every word's letters stay in order and joined; words may turn corners;
- strokes stretch only where a form says it may stretch (stems, baselines,
  join runs), in whole cells;
- strokes change length only when they must: of the packed panels, prefer the
  one closest to each letter's natural length (the user, 2026-10-29: "the la
  was unnecessarily shorted and the last word was unnecessarily
  enlgonated");
- pinned edits are hard constraints;
- the result fills the box: no unfilled region larger than a gap.

How it searches (greedy routing, constraint solver, templates of row/column
bands, or a mix) is the builder's call; measure it on the old block's
lesson — "a few hundred passes is nothing" was wrong three times.

## Left to the builder

Packing method; data shapes for alternates and stretch points; how a pin is
stored; which modifier or hover action paints a cell; sidebar layout for the
new panel (follow `.claude/rules/sidebar.md`); test split between pure
modules and e2e.

## Future build plan (not this build)

In the user's order of mention, after the single box ships:

1. **Single shape** — triangle, diamond, trapezoid, octagon frames (the
   mosaic panels). Needs a lattice clipped to a polygon, and likely 45°
   strokes for diagonal edges.
2. **Custom shape** — an outline the user draws or uploads (the app already
   has uploaded SVG guides and Shape Fill silhouettes to lean on).
3. **Repeating shape** — one unit rotated about a centre, 4-fold and 8-fold,
   with editing tool 5 (edit one, change all). The «الله» ×4 and the
   eight-fold star panel are the targets.
4. **Tile tessellations** — cells that fit together across a surface, each
   holding text (the mosaic wall).
5. **Flowing angular Kufi** — a separate project, brainstormed on its own
   when its turn comes. The baseline style of the user's local Kufi vector
   sheet: written on a line, tall stems, knotted and braided alifs, rounded
   hooks on jeem/ha, woven medallions. The sheet gives every letter in
   isolated, initial, medial and final forms plus ornaments; it stays local
   and nothing from it is committed. Closer to how the app already handles
   pen-drawn scripts than to the lattice.

## What the first spike taught (2026-10-28)

Three guessed arrangements (rows joined by turns, rows with a turned column,
words facing different edges) all left gaps. The user's verdict was "none of
them look right". Rebuilding the Al-Baqarah panel from our letters instead
(412 of 441 squares matched) showed how a real panel is built:

- The words run clockwise round the frame from the bottom right, with every
  baseline on the outer edge. A word never bends round a corner: each edge
  ends on a tall stroke that runs on along the next edge. What's left goes
  into the core.
- Bands are 5 squares deep, and tall letters are cut to that depth. Teeth
  stay short, and the next band fills the space above them, so the bands
  interlock.
- Irregular pieces plug holes: a lifted ي that steps down to the line, a
  kaf bar reaching over the letter before it, a hooked ن, dots, and a lone
  square.

**Gate (2026-10-29).** A rule-based arranger given only the text and a
21×21 box produced the same plan as the reference: words clockwise round the
frame, the same corner turns, the same turn-back in the core. The user: "it
looks well placed but the words are wrong" — the wrong words were all dots
(see Constraints) — and "everything else is fine". The direction is
accepted. Left open by the spike: it took about 3 minutes per panel, left 2
gaps, and failed the Shahada at every size, so the real packer must be much
faster and needs the letter-table additions below.

The packer is built from these rules, and the pieces our table lacks are
added to it: shortened tall letters, the lifted letter, a narrow middle ك, a
full-height end ف, a middle ه joined at its top, a hooked ن, a join that
turns back on itself, and dots and filler squares.
