# Tarkib: composing a phrase in Thuluth inside a shape

Date: 2026-10-18. Status: design, for the user's approval.

## Intent

The user types a word or phrase, picks where it should live (the selected
block's box, a panel shape, a canvas guide, or an outline they upload), and
HarfCanvas composes it the way a Thuluth calligrapher would: letters climbing
onto one another in tiers, strokes lengthened to carry the line, tails sweeping
along the shape's edge, vowels and small ornament signs in the gaps. The user
then picks among a few arrangements and nudges pieces by hand.

The user called the mark library "the big thing holding us back from making a
true tarkib". The app's existing stacked compositions bend a *font's* letters
and pack them in rows; that is what looks mechanical. A tarkib is built from
real pen pieces instead: the bought Thuluth vector set (every form of every
letter, 330 pieces) and the grandfather's scanned joins, words and lesson forms
(about 250 pieces), all in the mark library's Thuluth group at one scale
(48 library units = one pen width; `.claude/rules/marks.md`).

The user composes by eye. The app has no eye, so it gets a measure it can
optimise instead (the user's words): **choose the variants that fit the shape
with the least unfilled space.**

## The first target

**أُمّ أَيْمَن الحُبّ حَيَاتِي** ("Umm Ayman, the love of my life") in the
**teardrop** shape. The user judges the result; the design is done when they
would sign it. This phrase exercises everything: connected runs (ايمن، الحب،
حياتي), letters that do not join forward (ا، ر-type, و) breaking words into
pieces, tall alifs and lams for the drop's narrow tip, tails (the ya of حياتي,
the nun of ايمن) for the round bottom, and shadda twice. The vowels above are
supplied for this test (see Diacritics).

## Goals

1. **A joining schema** for the library: what each piece is, where the pen
   enters and leaves it, what may stretch, where its marks go.
2. **A composer** that turns a phrase plus a closed shape into several
   candidate compositions ranked by how well they fill the shape.
3. **Diacritics** in Thuluth's own signs, placed as part of the fit.
4. **Editing**: choose a candidate, then nudge, tilt, bend joins and pull
   tails with the tools that already exist.

## Non-goals (for this project)

- The Claude vowel service itself (an interface and a "not connected" path
  only; the user will set up the API key later).
- Other scripts. The next font (Naskh suggested) will reuse the schema and the
  composer, so nothing in them may assume Thuluth beyond its data and tunables.
- Editing the spelling after composing (a tarkib is a bake, like a stack).
- Mirrored/medallion tarkib (the existing Compositions feature can mirror the
  result later).

## Anti-goals: a result that "works" but fails

- **Scaling a letter as a whole.** The user rejected it before (2026-10-10).
  Length changes only by lengthening the strokes that may stretch.
- **Rows of type in a box.** If it looks like the existing Fill-a-guide
  arrangement with different letters, it has failed.
- **Wrong reading order.** Stacking may lift a letter into the tier above,
  but a reader must still read the phrase in order.
- **Invented vowels.** With no typed vowels and no vowel service, compose with
  none rather than guess.
- **Canvas handles or editing modes.** Editing stays as the stack editor
  window does it today: hover outlines and direct drags on the ink.

## What the user decided

- Pieces come from the mark library, joined by the app.
- Stroke lengthening is part of the craft; whole-letter scaling is not.
- The measure is least unfilled space; the judgement is by eye, so the app
  shows options rather than one answer.
- Shapes: the block's box, a panel shape, a canvas guide or an uploaded one.
- Vowels: typed vowels are used as given; missing vowels come from Claude
  through the app's server once that is set up; until then, and whenever the
  service is not hooked up, the phrase is composed without vowels.
- After composing: pick between alternative arrangements **and** nudge pieces
  by hand.

## Design

### 1. The joining schema (Claude's design)

Each library piece gets a schema entry, stored as generated data beside the
library (not hand-edited TypeScript; same rule as `markLibraryData.ts`), loaded
on demand with it:

- **letters**: the letter or letters it draws, in reading order, as the bare
  skeleton (rasm) it shows. A vector "Ba, nun or ya tooth" is the dotless
  tooth that serves ب ت ث ن ي in their joined forms; the schema says which
  letters a piece can stand for.
- **form** per letter: standalone, starting, middle, finishing; a multi-letter
  piece (a scanned join such as بص, or a word such as الله) lists each.
- **entry** and **exit**: where the pen arrives from the previous letter and
  leaves for the next. Each is a *face*: the pen's cross-section at that point
  (two outline points) plus the stroke's direction. A starting form has an
  exit only, a finishing form an entry only, a middle form both.
- **stretch zones**: the straight runs that may lengthen (the flat of ب س ك,
  the kashida run of a join, the tails of ي ن ر و), each with a minimum and
  maximum length in pen widths.
- **mark anchors**: where dots and vowels sit above and below the letter, so
  the composer can place them without a font's anchors.
- **dots**: the piece's own dots if it draws them; otherwise the number and
  side of dots the letter needs (the composer adds them from the library's
  nuqta pieces).

**Finding faces automatically, then reviewing.** A joining stroke ends in a
thin, near-horizontal run at a piece's right (entry) or left (exit) edge,
near the baseline. A script finds those runs with the stroke detector's
ideas (`.claude/rules/stroke-cuts.md`: parallel edges, a straight zone) and
proposes a face at each; the user checks them on a review page like the
final run-through's, which shows the faces drawn on each piece with keep /
fix buttons. Corrections go in a small hand-kept overrides file the script
reads. The vector set's middle forms have both ends and should mostly detect
cleanly; scanned joins and words have entries and exits only at their two
outer ends. The ledger (`scripts/marks/thuluth/REVIEW.md`) records what was
detected and what the user fixed.

Pieces with an open end that was cut where it met another letter on the
source sheet (noted in the ledger) are marked so the composer never uses that
end as a free tail.

**Where the rest of each entry comes from** (Claude's call):
- *Letters and form* are parsed from the names the library already carries:
  the vector pieces are named "Letter, position, n (glyph)", and the scanned
  ones carry their Arabic and a description. A parse failure is listed for
  the user rather than guessed.
- *Dots* are a fixed table per letter (count, above or below), plain
  orthography, not detected. A piece that draws its own dots (the scanned
  joins mostly do) says so in the overrides file.
- *Mark anchors* default to above the top and below the bottom of the
  letter's own ink at its horizontal centre; the review page shows them and
  the overrides file can move them.
- *Stretch zones* cannot come from the stroke detector, which leaves
  Thuluth's tapered strokes alone (pinned in `stackConvert.test.ts`). They
  come from a per-letter rule saying which stroke stretches (the ba family's
  flat, the kashida run of a join, the tails of ي ن ر و), located on each
  piece by a looser measure written for these pieces (a measurement script
  first, as stroke-cuts.md asks), shown on the review page and correctable.
- *Scope*: step 1 covers the pieces the first target can use (the letters
  of أم أيمن الحب حياتي in every form, the signs, the nuqta pieces) first,
  then the rest of the library; the composer refuses a phrase whose letters
  have no reviewed pieces and says which.

### 2. Reading the phrase

Pure text analysis, no font and no HarfBuzz:

- Split into words; within a word, into **connected runs** at letters that
  do not join forward (ا أ إ آ د ذ ر ز و ة ء and لا).
- Each letter gets its form from its position in the run.
- Ligatures that Thuluth writes as one piece are recognised: لا (all its
  forms) and the word الله (its own rule, sheet 16).
- Vowels, shadda, sukun and tanween typed with the text are attached to their
  letters, not counted as letters.

### 3. Building a candidate

A candidate is built in four steps; the composer runs them many times with
different choices and keeps the best few.

1. **Cover each run with pieces.** For every connected run, choose a sequence
   of pieces whose letters and forms spell it: a multi-letter piece where one
   matches (preferred: they are the calligrapher's own joins), single-letter
   forms elsewhere. Each letter has many variants; that choice is the main
   thing the search varies.
2. **Join them.** Consecutive pieces in a run are joined exit-to-entry as a
   `StackJoin` between their faces (the existing splice-and-curve model,
   below). A join may stay flat on the line or **climb**: the next piece
   sits in the tier above, the join curving up into it, which is how a run
   stacks. Which joins may climb is part of the schema's data (a tunable
   table per letter pair, starting from what the panels show, e.g. after
   ح ج م س the next letter commonly climbs); the search chooses among the
   allowed ones.
3. **Place the runs in the shape.** Tiers run bottom to top in reading order,
   right to left within a tier, as the existing arranger does, but runs may
   overlap tiers where one run's tall letters rise through the tier above
   (alif and lam uprights in the drop's tip) and one run's tail sweeps under
   another (a ya or nun tail along the drop's rounded bottom). Stretch zones
   lengthen to carry a tier to the shape's edge.
4. **Diacritics and fillers.** Vowels first (section 4), then the existing
   filler pass with Thuluth's small signs for what remains.

**Size** (Claude's call): a calligrapher chooses the pen for the panel, so
each candidate also finds its own uniform scale (the pen size), by bisection
as the existing arranger does: the largest at which it fits. The unfilled
measure is taken at that scale, so growing until something touches the edge
is not a way to win; only variant choice, climbs and stretches can close the
gaps that remain. The shape's own size comes first: a template is sized from
the selected text block (its height a fixed multiple of the block's font
size, adjustable with the existing size slider), a guide or uploaded shape
is used at its own size.

**The measure.** A candidate's score is mainly the shape's unfilled area once
everything is placed: the area inside the shape farther than about half a pen
width from any ink. Then penalties: ink outside the shape; pieces of different
letters overlapping (a light touch where Thuluth allows it is fine, ink
crossing a letter's body is not); reading order broken; a stretch zone beyond
its maximum; tiers so uneven the eye trips. Weights are tunables at the top of
the module, adjusted against the user's verdicts on real candidates.

**The search** is the builder's to choose (Claude's suggestion: start from
the existing arranger's layout as a seed, then a randomised local search over
variant choice, climb points and stretch lengths, keeping the best distinct
results). It must return **at least four** candidates that differ visibly,
not four copies of one layout with a different alif. Target: candidates for a
four-word phrase within a few seconds on a laptop, off the main thread (a Web
Worker) so the window stays responsive, with progress shown.

### 4. Diacritics

- **Source of vowels.** Typed vowels are used as given. When the phrase has
  none, the composer asks a **vowel service**: an interface with one call,
  phrase in, vowelled phrase out. Its real implementation (a Cloudflare
  Worker route calling Claude with the API key as a secret) is a later
  project. Now: the service reports "not connected" and the phrase is
  composed without vowels; the window says so in one line. When it is
  connected, the vowels it returns are shown in the text field for the user
  to correct before composing.
- **The signs** are Thuluth's own, from the library: fatha, kasra, damma,
  shadda, sukun and tanween as drawn on sheet 19 and in the vector set, so
  they match the pen. The library may need a few more of them; the plan lists
  any missing ones for the user to supply or approve.
- **Placement** is part of the fit, the way a calligrapher does it: each sign
  goes near its letter's mark anchor, above or below as the vowel requires,
  and may slide sideways or up into the nearest gap rather than collide.
  Shadda carries its fatha or kasra with it. Signs count toward filled space.

### 5. The result and editing (Claude's call)

The composition is a **`stack` block** (`StackBlock`, `.claude/rules/stacked-
compositions.md`): pieces in library units (`unitsPerEm` 400, the nib 48),
joins as splices, `source.text` the phrase, `source.fontFamily` a fixed name
meaning "the Thuluth piece library". That one choice brings everything the
user asked for "by hand" for free: the stack editor window's drag, tilt, join
bending, tail pulling, healing, Reset layout and the filler pass. What a
library-built stack needs that a font-built one does not:

- its faces come from the schema, not from cuts in a font glyph;
- **choosing among candidates** inside the editor window: a strip of the
  candidates' thumbnails, best first; picking one replaces the draft (one
  editor-undo step) and Re-compose produces a fresh set;
- the same shape cards (template, canvas guides), plus the block's own box
  and an uploaded SVG guide as targets. Rectangle, square and circle panels
  join the teardrop and almond templates.

**The editor's own tools on a tarkib** (Claude's calls):
- A shape card runs the **composer**, never the row arranger
  (`arrangeStackInShape`); the row arranger is what this feature replaces
  for library-built stacks.
- **Reset layout** returns to the candidate as it was picked.
- **Fill gaps** uses Thuluth's signs from the library, not a font's.
- **Hand pulls** on a library piece use its schema stretch zones (stored on
  the piece when it is placed) and stop at the zone's maximum; Shift keeps
  the pull on the stroke's axis as it does today. Font-built stacks are
  unchanged.
- The block stores the **composer's inputs** (the phrase as composed, the
  target shape, the search seed, the piece ids), so a tarkib reopened days
  later still offers Re-compose and the candidate strip. This adds an
  optional field to `StackBlock`; old saves load without it and behave as
  font stacks do.

**Where it starts**: from a selected text block, a "Compose in Thuluth"
action (Block Controls, beside Add medallion, is Claude's suggestion; the
Add grid is a fixed 3×2 and stays so). It opens the editor window on the
first candidate. The text block itself is replaced by the stack block on
Done, as Convert does today, with one history step; Cancel leaves it.

## Constraints

- The composer, the schema reader and the text analysis are pure modules
  testable in Vitest (no React, no HarfBuzz), as `stackArrange.ts` is.
- The library and the schema load on demand (2026-10-18): nothing in this
  feature may import `markLibraryData.ts` or the schema statically.
- A save of a composed block must draw without the library (the pieces carry
  their own outlines, as marks carry `markD`).
- Verification after every non-trivial change: typecheck, lint, tests, build.
- Commits stay on the working branch until the user says to merge.

## Build order

1. Schema: the detection script, the review page, the overrides file,
   generated schema data, tests that every piece used by the composer has
   the faces its form needs.
2. Text analysis, and a **single-line chain**: one run built from pieces and
   joined, no stacking, drawn as a stack block. This is the first thing the
   user looks at: do the joins look like a pen made them?
3. Shape fitting and candidates for the first target, with the measure
   reported for each candidate.
4. Diacritics: the vowel service interface ("not connected"), the Thuluth
   sign set, placement in the fit.
5. Editor window: the candidate strip, Re-compose, the new targets.

## Left to the builder

The search algorithm and its tunables; the exact unfilled-space measure
(grid resolution, the half-pen margin); the face-detection thresholds; the
climb table's first contents; Worker plumbing; UI wording and layout within
the existing sidebar and editor window rules (`.claude/rules/sidebar.md`).

## Open questions

- Which pairs may climb, and how high, is learned from the panels and the
  user's verdicts; the first table will be wrong in places, and the plan
  should make it cheap to change.
- Scanned and vector pieces were drawn by different hands; joining one to
  the other may show a change in stroke character at the join. If it does,
  the composer may need to prefer runs from one source.
