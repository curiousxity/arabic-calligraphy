# Stroke tarkib: Thuluth written as pen strokes

Date: 2026-10-19. Status: design, for the user's approval. It replaces the
piece-based approach of `2026-10-18-tarkib-design.md` (see "What this
replaces").

## Intent

The user wants Thuluth compositions in HarfCanvas that a calligrapher would
sign. The 2026-10-18 tarkib work joined rigid, pre-drawn letter outlines and
patched each meeting: it trimmed both ends, bridged the gap with synthetic
curves, and landed strokes on letters that could not be trimmed. It got as far
as v0.1.506. The user called that "the best yet but it is not perfect", and
named the cause: **we treat letters as rigid shapes, when in fact individual
pen strokes form both the letters and the connections between them.** The
library must be rebuilt from those strokes.

**The standard (the user's words):** the joins "would flow like one continuous
pen movement". The user is a calligraphy-literate designer and judges by eye.
They want the product "as close to perfect as possible", and if that means the
current letters are sacrificed, "so be it".

**What perfect is measured against:** the classical masters the user named,
Hafız Osman and Sami Efendi, and al-Baghdadi's Thuluth plates. These are
**research references only.** The app never credits al-Baghdadi (a standing
rule), and never credits the user's grandfather.

**The behaviour the user wants**, shown to Claude in My Qalam Studio
(mqacademy.app) and confirmed by them:
- The program builds a composition, the user adjusts any part of it by hand,
  and the program carries on around what they set. In the user's words, "it
  is all fluid".
- Move, turn or resize one component, and every other stroke re-flows
  smoothly. That studio is evidence of the behaviour only: nothing of its
  code, data or artwork is used.

## The first target

1. **First milestone: أم أيمن الحب حياتي written as continuous pen strokes on
   a line.** The user judges the letters and the joins before anything is
   composed.
2. **Then the same phrase composed in the teardrop**, the target of the
   2026-10-18 design.

## Goals

1. **A pen.** A flat nib swept along a centre line, drawn as clean vector ink
   in the browser.
2. **A stroke library.** Every Thuluth letter form is built from named, shared
   parts, written in the stroke order the teaching sources give. It includes
   the dots, and the tashkil and ornament marks.
3. **Words as one pen path.** A connected word's letters hand over from one to
   the next at join points. The connecting stroke belongs to both letters: it
   is not a patch.
4. **Live editing.** The user can move, turn or resize a letter or mark,
   switch a letter's form, change a stroke's length, drag a join point, or
   strike a stroke off. Everything not pinned re-flows around the change
   while the user drags.
5. **A composer.** It lays a phrase into a shape: it picks forms, splits the
   text into rows and stacks it, stretches strokes, sets the alif's height by
   density, and fills the gaps with tashkil. The search is shown as it
   happens, and the user keeps a version they like.
6. **Tashkil in Thuluth's own signs**, placed last, in the gaps.
7. **Stroke opacity.** Each stroke can be drawn translucent, so the strokes
   themselves can be appreciated: where separate strokes cross, the ink
   deepens. This is the user's addition for this round.

## Non-goals (for this project)

- Scripts other than Thuluth, including Jali Diwani, Naskh and Kufi. Nothing
  may assume Thuluth beyond its data and tunables, so the next script reuses
  the pen, the path solver and the composer.
- Animating the writing stroke by stroke. Stroke order is stored, so this can
  come later.
- The Claude vowel service. As before, only an interface and a "not connected"
  path.
- Converting the existing traced letters into strokes. Research found no
  reliable method, and the user accepts losing them.

## Anti-goals: results that "work" but fail

- **A visible joint anywhere.** No seam, no notch, no change of stroke at a
  join that a pen would not make. This is the whole point.
- **Ink that scales.** Resizing redraws the letter's path larger with the same
  pen; the strokes never thicken or thin with size. This is the user's
  2026-10-10 objection to scaling, now honoured by construction.
- **Rows of type in a box**, and a reading order a reader cannot follow
  (carried over from 2026-10-18).
- **Invented vowels** (carried over).
- **Shapes that only look right at one size or one angle.** A letter must
  stay correct when moved, turned, resized or re-flowed.

## What the user decided

- Rebuild the library from strokes; the current letters may be dropped.
- A word is one continuous pen path through its letters. Join points can be
  moved by the program and by hand.
- Anything the program proposes, the user can change by hand. What they set
  is kept, and everything else re-flows around it. This covers forms, stroke
  lengths, joins climbing into the line above, tashkil placement, and moving,
  turning and resizing pieces.
- **Canvas handles are wanted for this, kept small and unobtrusive.** The
  user showed corner handles for resizing and a circle above the piece for
  turning: "that is exactly what I want". They reverse, for this editor, the
  2026-10-15 "no canvas handles or modes" ruling. The old handles failed
  because "they obscured most of the word and I never understood what they
  actually did". So the new ones:
  - are small;
  - never cover the ink;
  - say what they do as the pointer reaches them.
- **Resize redraws the path, with the same pen, within a small range** (about
  ±15%). A 7-nuqta alif may become about 8, and the letter gets a little
  lighter. The pen never thickens or thins. Lengthening a single stroke stays
  the stretch control's job.
- **The line milestone already stacks.** The phrase on a line shows the
  in-word stacking a calligrapher would write (the ح set over the ل in
  الحب, the final ya returning underneath in حياتي). So joins that climb into
  the tier above are needed by milestone 2, not only for the composer.
- **The bought Thuluth vector set may be used as a reference** underneath the
  authoring tool, alongside the book plates, especially for joined forms.
  The strokes are drawn new; no outline is copied into the library.
- **Stroke opacity is added to this round.**
- Composing works like the studio's "weave into a shape": the program searches,
  shows each attempt, and the user can keep one.
- First milestone: the phrase on a line; then the teardrop.
- Claude researches how the letters and the tashkil are drawn. The user
  handed both over ("I will leave it up to you to learn how to draw tashkil").

## What the research found

Notes with sources are in `docs/superpowers/specs/2026-10-19-stroke-tarkib-research.md`.
The essentials:

- **The pen.**
  - Thuluth is written with a flat nib, edge fully on the paper, held at a
    set angle. Each part of a letter is one pull without lifting the pen.
  - Downstrokes come out thin and horizontals thick, which puts the nib edge
    at roughly 60–80° from the baseline. Sources disagree, so the angle is
    measured, not assumed.
  - Ends are sharpened by lifting one side of the nib, and some parts are
    written with a third of the pen: the start of the mim, and the last part
    of a final ha.
  - A few shapes are drawn with the nib's corner and filled: the ain's
    crescent, the alif's head (retouched with a fine pen), and the rounding of
    the fa, qaf and waw heads.
- **The unit** is the nuqta, the rhombic dot, measured on its diagonal (about
  1.4 pen widths). The alif's height depends on the composition: 5–6 nuqta on
  a plain line, 7–8 lightly composed, 9–12 in a heavy tarkib.
- **Letters are built from shared parts.**
  - fa, qaf and waw share one head.
  - fa takes the ba's bowl; qaf takes the cup of sin, sad and nun.
  - waw comes from ra.
  - Kaf is assembled from an alif and the ba's base.
  - Ha comes from the head of a dal plus a medial fa ("cat's eye").
  - A Turkish teaching textbook (MEB, *Hüsn-i Hat Atölyesi 10*, Şevki Efendi
    style) gives every letter numbered moves, with direction arrows and dot
    measures. The user's books number the arrows straight across connected
    letters, as one sequence of moves.
- **Joins.** No source states in words how a join is written. The plates
  (arrow numbering running across letters) and the studio (one path through
  the word) agree it is the same pen movement continued. The one computational
  precedent (AlQalam, for Naskh) shares the connecting stroke between the two
  letters and makes them meet at a set direction.
- **Tashkil.**
  - Harakat are written with a pen a third as wide, or the full pen where
    the layout calls for it.
  - Fatha comes in three lengths: short 3–4 nuqta, medium 4–6, long 9–11.
    All fathas in a piece are exactly parallel, and a long fatha only sits
    where there is an a-vowel.
  - Kasra is never long. Tanwin is a pair of strokes.
  - The order is: text, then dots, then harakat, then ornaments.
  - The small letters that aid reading (ح س ص ط ع ك م ه) and ornaments such
    as the tırnak and tirfil fill the gaps.
- **Nobody has built this for Thuluth.** There is no stroke model to adopt and
  no measured nib data. The hardest technical part reported everywhere is
  drawing a turning nib's ink cleanly.

## Design

Calls marked *(Claude's call)* are the builder's to revisit with evidence.

### 1. The pen *(Claude's call)*

- **A stroke** is:
  - a centre line: a smooth curve through on-curve points, in nuqta units;
  - a nib angle at each point, interpolated along the curve;
  - a nib width at each point: 1 = the full pen, ⅓ for the partial-nib
    passes, tapering to 0 for a lifted corner;
  - its writing direction.
- **The ink** is the area the nib covers as it sweeps.
  - Computed robustly: stamp the nib along the curve densely enough for
    sub-unit error, union the stamps, and fit curves back to the outline.
    The fitted outline is what the renderers and export draw.
  - An exact envelope for segments with a fixed angle can replace stamping
    later where it is faster. A turning nib's interior envelope is where
    published systems break, so it is not attempted first.
- **A drawn part** is a closed shape filled rather than swept: the ain's
  crescent, the alif's head, the head roundings. It carries its own outline
  in the part's frame, attached to a point on a stroke.
- **The pen width is the size of the writing**, in units (48 per pen, as
  today). A letter's size changes its paths, never its pen.
- **Each stroke keeps its own outline** as well as the word's union, so it
  can be drawn on its own (section 7, stroke opacity).
- **The pen is pure, testable code**, like the existing stack geometry. It
  must not import `./harfbuzz`.

### 2. The stroke library *(Claude's call; the user judges every form)*

- **Parts** are named, reusable strokes or drawn parts in nuqta units, each
  with a stroke order and its nib angles: the alif, the ba's bowl, the cup of
  sin, sad and nun, the shared fa/qaf/waw head, the ra, the jeem's head bar,
  and so on.
- **A letter form** (standalone, starting, middle, finishing, and named
  variants such as the zinadi or sayfi kaf, or the mim used before a madd) is
  a list of parts, placed and joined. It has:
  - an **entry** and an **exit**: an end point of its path, with a
    direction and how far it may stretch;
  - **stretch zones**: path segments that may lengthen;
  - **mark anchors**: where dots and tashkil sit.
- **Dots** are the pen's own stamp: one rhombus pulled by the nib's width.
  Their positions are part of the form.
- **Tashkil and ornaments** are strokes with a ⅓-width pen:
  - harakat: fatha and kasra (each in lengths), damma, sukun, shadda,
    tanwin, madda, the dagger alif, hamza and wasla;
  - ornaments and reading aids: the small ح س ص ط ع ك م ه, the tırnak, the
    tirfil, and the V filler.
- **The library is data, not code.** Stroke data lives in JSON files in nuqta
  units, generated or authored with the tool below and never hand-edited in
  TypeScript, as with `markLibraryData.ts`.
- **An authoring tool** (dev-only page) for drawing the library:
  - The book plates or the MEB pages sit underneath.
  - Claude places centre lines and nib angles over them, and the ink renders
    live on top, so mismatches show.
  - The plates stay local research material: no book page or crop is
    committed.
- **Review happens in the app**, since the user now reviews there rather than
  on separate review pages.
  - Each form is shown alone and joined to its common neighbours.
  - The user's keep or fix goes into a ledger file beside the library data,
    as `scripts/marks/thuluth/REVIEW.md` does for the mark library.
  - Corrections go back through the authoring tool.
  - Nothing enters the library without the user's approval (a standing rule).
- **One reference hand per form** *(Claude's call)*:
  - The main reference is the user's own Thuluth plates: al-Baghdadi's rules
    books. They are complete, high-resolution and local, and they cover the
    forms, the joins and the tashkil. Research only: the app never credits
    him.
  - The MEB textbook (Şevki Efendi's line) is the reference for stroke order
    and moves.
  - Works by Hafız Osman and Sami Efendi are checks.
  - Hands are never mixed within one form. A named alternate from another
    hand is added only if the user asks for it.
- **The plates live outside the repo** *(Claude's call)*, in a `plates`
  folder beside the user's books on the network share, so they survive and
  are never committed.
- **Order of work:**
  - first, the forms the first target needs: ا أ م ي ن ل ح ب ت, in the
    positions the phrase uses;
  - then the shared parts' other users;
  - then the rest of the alphabet;
  - then tashkil.

### 3. Words as one pen path *(Claude's call)*

- **A connected run is one path.** Each letter's path runs into the next
  through a **join point**: the place where the exit of one and the entry of
  the next coincide, with matching direction and curvature, so the stroke
  cannot show where one letter ends.
- **The connecting stroke is shared.** Its length, drop and climb are
  parameters of the join, and both letters adapt to them. This is the
  AlQalam idea, extended so a join can climb into the tier above.
- **Separate strokes and pen lifts** (the alif's head, the ain's crescent, a
  letter that does not join forward) are their own strokes. Where they overlap
  the path, the ink unions with it.
- **A word is redrawn** from its parameters whenever any of them changes. It
  is never stored as a finished outline.

### 4. Live editing *(Claude's call, matching what the user showed)*

- **Parameters.** A composition is a set of parameters:
  - letter positions, turns and sizes;
  - forms;
  - stretch lengths and alif heights;
  - join parameters;
  - stroke strike-offs;
  - mark positions.
- **Pins.** Each parameter is either the program's or pinned by the user. A
  hand edit pins what it touches.
- **The solver** re-solves the unpinned parameters to keep joins continuous,
  avoid collisions, keep the reading order, and keep the shape filled.
  - **During a drag** *(Claude's call)*: only continuous values move
    (positions, stretches, join lengths and drops). The ink stays good
    enough that no joint shows mid-drag; the joins are continuous by
    construction, since the path is.
  - **On release**: discrete choices are re-solved (forms, row breaks, which
    joins climb), and the exact ink is drawn.
  - It must run at drag rate on the first target, so the user sees the motion
    and not only the result.
  - Tashkil and ornaments are re-placed after the letters settle.
- **Handles.**
  - The selected piece shows corner handles to resize it and a circle above
    it to turn it; drag the piece itself to move it.
  - Join points show as handles in an anchors view.
  - A letter panel offers the form choices, + and − for length in nuqta, and
    stroke strike-off.
  - Undo covers each gesture as one step.
- **Hide unsupported controls** (a standing rule): a control only appears
  where it works.

### 5. The composer *(Claude's call)*

- **What it does:** given the phrase and a shape (the teardrop first; then
  the block's box, the panel shapes, a canvas guide or an uploaded outline,
  as in 2026-10-18), it searches over:
  - forms;
  - where the text breaks into rows and tiers;
  - which joins climb;
  - stretch lengths;
  - the alif height (set by density, within the 5–12 nuqta range).
- **Scoring**, from the 2026-10-18 measure plus what the stroke model makes
  possible: least unfilled space, no collisions, reading order kept, and
  balanced ink.
- **The search is shown live**, with "keep this one" and "stop". What the user
  keeps becomes the composition, which they then edit as in section 4.

### 6. Tashkil *(Claude's call, from the research)*

- **Placement:** placed last, in the gaps, at each letter's mark anchors or
  nudged from them.
- **Fathas:**
  - all parallel in a piece;
  - their length chosen to fill the space: short, medium, or long only where
    there is an a-vowel.
- **Typed vowels** are used as given. Missing ones are not invented.
- **The palette of marks placed by hand** follows the set the user showed in
  the studio's "Dots and ornaments" panel. There, vowels come from the keys as
  the user writes; everything else is placed by hand.
  - Dots: one, two, three and four, in rhombic and round styles, plus one
    dotted mark.
  - The ص-shaped sign.
  - Small reading aids: ح, س, ص, ط, ع, three kafs, م and ه.
  - About six ornaments: the V-shaped filler, a mim-topped ornament, and
    hooked tırnak shapes.

  Each is a stroke or a drawn part in our library, not a copied image.
- **Ornaments and reading aids** fill the remaining gaps "to balance the
  ink", within limits the user tunes by eye.

### 7. In the app *(Claude's call)*

- **A new block type, `tarkib`**, stores the parameters and pins from section
  4, not a baked outline, so it can re-flow at any time.
  - The existing `stack` block stays as it is for font-based stacked
    compositions.
  - Old saves are unaffected.
- **Rendering and export** draw the pen's fitted outline through the same
  paths every other block uses: outline before fill, gradients through
  `createBlockFillPainter`.
- **Stroke opacity** *(Claude's call on the control)* is a setting on the
  `tarkib` block, from 0 to 100%.
  - At 100%, the ink is one solid union, as today.
  - Below 100%, each stroke is filled separately at that opacity, so the ink
    deepens where separate strokes cross. A connected word's path is a
    single stroke, so its joins stay seamless; the structure shows only
    where the pen lifted and wrote again.
  - Export draws what the canvas draws.
  - Opacity for individual strokes or letters, set by hand, can come later
    on the same mechanism.
- **Editing happens in a staged window**, like the stack editor's, with its
  own undo, committed to the canvas as one step.

## What this replaces

- **To be removed** once the stroke library covers the first target and the
  user has signed off on it: the 2026-10-18 piece machinery in `src/lib/`:
  - `tarkibSchema` and its generated data and generator;
  - `tarkibChain`, `tarkibEnds`, `tarkibPieces` and `tarkibClimb`;
  - `tarkibCompose`, which the new composer replaces;
  - the seam, landing and trim code in `stackJoin.ts` that only tarkib uses.
- **Kept and reused:**
  - `tarkibText` (reading a phrase into runs, forms and dots);
  - `tarkibScore`'s fill measure;
  - `tarkibSigns`, as a list of which signs exist;
  - the shape templates.
- **The mark library's Thuluth group** stays as the user's reference set.
- **Compositions already made** from pieces stay as ordinary stack blocks.
  Their tarkib record is ignored by the new editor.
- **The subsystem note** `.claude/rules/tarkib.md`, which code comments
  already point to, is written for the new design.
- The branch is `claude/curve-diacritics`. Nothing goes to `main` until the
  user says so.

## Proving it

- **Tests beside the code** (`src/lib/*.test.ts`), as everywhere in the
  project:
  - the pen's outline against hand-computed sweeps: straight, curved, and a
    turning nib;
  - continuity at every join point, by the same measure the seam tests use
    today: no corner beyond 4° above the outline beside it, read two units a
    step;
  - resizing that leaves the pen width unchanged.
- **For the user's eye:** rendered images of each form and of the phrase,
  close-ups of every join, and a gate script like `scripts/measureCurves.mjs`
  for the pen's accuracy.
- **No browser tests by Claude** (a standing rule). The user judges the live
  editing in the app.

## Risks

1. **Drawing a turning nib cleanly and fast** enough for live dragging. Every
   published system reports this as the weak point. Stamping and union is
   robust but may be slow; it must be measured early (milestone 1) on the
   whole phrase.
2. **Authoring effort.** About 30 parts and some 120 forms, plus the marks,
   drawn by Claude from plates and judged by the user. This is the bulk of
   the work.
3. **No measured nib angles.** They are read off the plates by eye in the
   authoring tool. If a form looks wrong, the angle is the first suspect.
4. **Join rules for tarkib** (climbing into the tier above) are the least
   documented part of the craft. The user's eye is the authority.
5. **Solver quality at drag rate.** A solver that is fast but jumpy defeats
   "fluid". Smoothness, not only correctness, is measured.

## Milestones

1. **The pen and stroke opacity**, plus alif, ba, nun, mim and ya in the
   forms the first target needs. One word, أيمن, on a line.
2. **The whole phrase on a line**, with every join continuous and the
   in-word stacking a calligrapher would write. The user reviews it: this
   is the first milestone they named.
3. **Live editing on the line:** move, turn and resize letters, change
   forms and lengths, drag join points.
4. **The composer in the teardrop.**
5. **Tashkil and ornaments.**
6. **The rest of the alphabet**, then retiring the old piece machinery.

## Left to the builder

- The nib-stamp spacing, the curve-fitting tolerance, and the solver's
  method, within the accuracy and speed the tests set.
- File and module layout, following the project's conventions (pure `lib`
  modules, notes in `.claude/rules/`).
- The authoring tool's interface. It is a developer tool and the user never
  needs to use it.

## Later: the look

Not this round. The user asked for it to be kept as something to come back
to. The studio's "Look" panel offers:
- **Style presets:** Classic, Sepia, Vermilion, gold on lapis, on night and
  on burgundy, White glow, silver on teal, and indigo.
- **Toggles:** the typed harakat, the clarifying letters, the ornaments
  (caps, hooks and swashes in open spots), "crowns" (an embellisher on a
  standing stroke), and hamza on alif (not required in Thuluth).
- **A fatha pen choice:** the full nib or a third of it.
- **A density slider.**
- **"Seamless joins"**, which hides the mark where letters connect. Our joins
  have none to hide, since a word is one path.
- **A custom panel** for ink, paper and finish.

HarfCanvas already has ink, paper and gradient fills (`ink-surface.md`),
which the presets would build on.

## For the user to check

- Hand-drawn stroke data authored by Claude from the plates and the vector
  set, judged by the user form by form, rather than any traced library.
- The calls marked *(Claude's call)* above, especially:
  - the main reference hand (section 2);
  - what may change during a drag (section 4);
  - how stroke opacity is controlled (section 7).
