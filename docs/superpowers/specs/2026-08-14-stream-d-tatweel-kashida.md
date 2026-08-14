# Stream D — Tatweel kashida

**Read `PARALLEL-PHASE-1.md` first.** Branch: `stream/d-tatweel-kashida`.

## Why this replaces what was removed

The removed stroke-stretch kashida displaced outline points but never moved
`penX += advance`, so the run measurably never widened — the dial was
inert by construction. Tatweel (U+0640, ـ) is the mechanism fonts actually
implement: insert it between two joining letters and HarfBuzz shapes a real
connecting stroke at the letters' designed weight, the advance grows, and
the run genuinely widens. It is already in the app's Specials row, so every
shipped font is known to shape it.

## Design

### `src/lib/tatweel.ts` (new, exclusively owned, pure)

```ts
export type KashidaSlot = {
  index: number;        // insertion offset into the block's text
  before: string; after: string;   // the letter pair, for UI labels
};
/** Legal insertion points: after a dual-joining letter whose successor joins
 *  to it (classifyJoiningForms from lib/arabicJoining.ts — which survives
 *  the Phase 0 removal precisely for this stream). Marks between the pair
 *  are transparent, per that module's own rules. Never inside لا-family
 *  lam-alef pairs, never adjacent to an existing tatweel run's outside. */
export function findKashidaSlots(text: string): KashidaSlot[];
/** Pure text edit: `count` tatweels at `slot` (replacing however many are
 *  already there, so the control is absolute, not additive). */
export function applyKashida(text: string, slot: KashidaSlot, count: number): string;
/** Detects existing runs so a re-opened block shows its current state. */
export function readKashida(text: string, slots: KashidaSlot[]): Map<number, number>;
```

Tests use **real harfbuzzjs and real fonts** (`shapeReal` helper precedent,
`createRequire` loading — see CLAUDE.md's test conventions): assert the
shaped run's total advance strictly increases with count in at least three
fonts, and that a slot inside lam-alef is never offered. This
run-actually-widens assertion is the whole point; a fixture-based test of
it would be worthless.

### UI (Typography → Kashida, STREAM-D anchor in `Sidebar.tsx`)

The section the removal deleted comes back, working differently:

- A **slot picker** listing `findKashidaSlots` of the block's text, each
  labelled with its letter pair (e.g. «ب ـ س»), RTL-rendered.
- A **0–8 stepper** per selected slot inserting/removing tatweels via
  `applyKashida` through a new `App.tsx` handler (STREAM-D anchor) that
  routes through the existing text-update path — so shaping, history, and
  every downstream consumer see an ordinary text edit. `pushHistory()`
  before, like every mutator.
- Visible only for block types whose text is shaped for joining (text,
  shapeFill, textPath — not image).

**This mutates the block's text — deliberately.** Undo works, saves carry
it, and the diacritic/glyph-index fragility documented in CLAUDE.md applies:
inserting tatweels shifts glyph indices after the slot, so per-glyph
overrides later in the string may land wrong, exactly as any typed edit
already does. Surface this in the guide page ("apply kashida before
fine-tuning marks"), don't engineer around it here.

Known shaping caveat to verify per font, not assume: some fonts substitute
ligatures or contextual forms differently across a tatweel (e.g. الله
decomposes when interrupted). That is correct font behaviour, not a bug;
the picker offering only legal joins is the guardrail.

## Not in scope (but designed for)

**Fit-to-width returns later** as a solver choosing counts across slots to
hit an artboard/margin target — it needs stream A's artboard as the target
and belongs to a future phase. Keep `findKashidaSlots`/`applyKashida` pure
so that solver can call them unchanged.

## Testing

Unit: slot legality across the joining classes, lam-alef exclusion,
absolute-count semantics, real-shaping advance growth. E2E
(`e2e/tatweel.spec.ts`): select block → pick middle slot → stepper to 4 →
canvas ink region widens (pixel-extent probe); undo restores; save/load
round-trips the text.
