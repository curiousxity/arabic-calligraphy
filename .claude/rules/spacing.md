---
paths:
  - "src/lib/spacing*.ts"
  - "e2e/spacing.spec.ts"
---

# Letter and word spacing (`src/lib/spacing.ts`, Sidebar → Typography)

Kelk's تقارب / تباعد. Text blocks only. Spec:
`docs/superpowers/specs/2026-10-13-letter-word-spacing-design.md`.

- **Letter spacing acts only at piece breaks** — after a letter in final or
  isolated form when the next non-mark character is a letter. Never inside
  a join, never inside a cluster (marks, lam-alef, Allah), never before a
  space (that is word spacing's gap). A ZWNJ is a break, counted once: the
  forward scan skips it, the backward scan does not.
- **Only `ax` changes.** Count, order, ids, clusters and offsets are
  preserved, which is why diacritic overrides, stroke cuts and Next Shape
  needed no remapping. Don't add or remove glyphs here.
- **The gap between array neighbours `i`, `i+1` is glyph `i`'s advance**,
  whichever direction the array runs — so the earlier glyph takes the
  amount.
- **Applied in exactly two places:** `ShapedText` (right after
  `useShapedGlyphs`) and `measureShapedRun`. A third consumer that shapes
  on its own must call `applySpacing` too, or it will measure a narrower
  run than is drawn — Fit to width would overshoot. `e2e/spacing.spec.ts`
  pins that (it fails at ~1.36× of a 1.2× target if the fit measure drops
  spacing); its target is small on purpose, because kashida's 8-per-join cap
  hides the overshoot at larger targets.
- **0/0 is the identity** (same array back), so unspaced blocks never
  re-render and old saves are byte-identical.
- Not on Shape Fill or Curve: both renormalise the run to a fixed span
  (see [deferred-features.md](deferred-features.md)).
- Tests use real shaping; the counts in `spacing.test.ts` (درود has three
  breaks, بابا one, سلام one, لا none) are the spec.
