---
paths:
  - "src/lib/tatweel*.ts"
  - "src/lib/arabicJoining*.ts"
  - "e2e/tatweel.spec.ts"
---

# Kashida elongation (`src/lib/tatweel.ts`, Sidebar → Typography)

Widening a run is done by inserting **tatweel** (U+0640, ـ) into the block's
own text between two letters that cursively join, not by deforming outlines.
This is the deliberate replacement for the removed stroke-stretch kashida
dial, which displaced outline points but never touched `penX += advance` and
so measurably never widened anything (see [removed-subsystems.md](removed-subsystems.md)). A tatweel is
a real character the font shapes: HarfBuzz draws the connecting stroke at the
letters' designed weight and the advance grows. `tatweel.test.ts` asserts
exactly that — total shaped advance strictly increasing with the count, in
three real fonts via real harfbuzzjs. **That assertion is the point of the
suite**; a fixture-based version of it would restate the assumption instead
of testing it.

`src/lib/tatweel.ts` is pure (no React, no Konva, no font loading) and is
meant to stay that way: the fit-to-width solver — choose counts across slots
to hit an artboard target — calls `findKashidaSlots`/`applyKashida`
unchanged. See [fit-to-width.md](fit-to-width.md); that discipline is what let the solver
be built without touching this module at all.

Three things about the slot model are load-bearing:

- **A slot is a letter *pair*, not a character position.** An existing run of
  tatweels between two letters is one slot whose count is the run's length,
  so the stepper reads and writes the same number and `applyKashida` is
  **absolute, not additive** (`count` replaces whatever is there). One slot
  per tatweel would make the control unreadable the moment it was used once.
- **Legality comes from `lib/arabicJoining.ts`**, which survived the Phase 0
  removal for this. A letter whose `classifyJoiningForms` form is `initial`
  or `medial` joins forward by definition, and the next character that has a
  form at all is the letter it joins to — an intervening space or other
  non-joiner would have made it `final`/`isolated` instead. That is why
  combining marks need no special handling in `findKashidaSlots`: they are
  already form-`null` and skipped. The one hand-written exclusion is
  **lam-alef**, which fonts fuse into a single ligature glyph that a tatweel
  would split into two unconnected letterforms.
- **Transparency inside a run** is the one thing `arabicJoining.ts` cannot
  answer (its `isTransparent` is private, and this stream may not edit that
  file), so `scanRun` uses `ARABIC_DIACRITIC_RE` from `lib/diacritics.ts` —
  the same ranges, as that module's own comment records. Marks are skipped
  only *inside* a run, never before one: a mark preceding the run belongs to
  the base letter and sits at a lower offset than the slot, which is what
  keeps a fatha on its beh when the join beside it is stretched.

The UI lives entirely between the `STREAM-D` anchors in `Sidebar.tsx`
(Typography → Kashida join + stepper) as an IIFE rather than a helper
component, because this stream owned no file to put a component in. It holds
no state: the counts come from `readKashida` of the block's current text, and
the selected slot is an **ordinal** into the slot list held in `App.tsx`
(`kashidaSlotOrdinal`) — deliberately not a text offset, since inserting
tatweels shifts every later offset but never reorders the slots. The Sidebar
clamps it against the current slot count, so an unrelated text edit can't
leave it out of range.

`App.tsx`'s `setKashidaAtSlot` routes through `updateSelectedBlock`, i.e. an
ordinary text edit with the usual `pushHistory()`. **Mutating the text is the
design, not a leak**: shaping, undo, saves, and every downstream consumer see
what they would see if the user had typed the tatweel from the Specials row.
The consequence is the glyph-index fragility documented in [diacritics.md](diacritics.md) — a
kashida inserted early in a string shifts the indices `diacriticOverrides` and
`GlyphTransform` are keyed by, exactly as any typed edit does. That is
surfaced to users in the guide ("apply kashida before fine-tuning marks")
rather than engineered around here.

Visible for every block type whose text is shaped for joining — the section
sits inside Typography's existing `type !== "image"` guard, so text, shapeFill
and textPath all get it with no separate gate.

Known and correct: some fonts substitute differently across a tatweel (الله
decomposes when interrupted). That is the font doing its job; offering only
legal joins is the guardrail, and the guide says so.
