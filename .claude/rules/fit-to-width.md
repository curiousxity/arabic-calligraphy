---
paths:
  - "src/lib/fitToWidth*.ts"
  - "src/lib/measureShapedText.ts"
  - "e2e/fit-to-width.spec.ts"
---

# Fit to width (`src/lib/fitToWidth.ts`, `lib/measureShapedText.ts`)

Chooses tatweel counts across a run's legal joins so the run spans a target
width. This is the replacement for `lib/justify.ts`, deleted with the Morph
subsystem — and the reason that one could never work is worth keeping in
view: the kashida dial it drove displaced outline points without touching
`penX += advance`, so the run's width never moved and there was nothing to
converge on. Tatweels are real characters the font shapes, so the width
genuinely changes.

Three things are load-bearing:

- **The solver is pure, and measurement is injected.** `solveFitToWidth`
  takes a `measure(text) => Promise<number>` callback rather than loading
  fonts, which is what keeps `fitToWidth.ts` importable by Vitest — the same
  discipline `tatweel.ts` and `diacritics.ts` already follow, and for the same
  reason (`harfbuzz.ts`'s static harfbuzzjs import throws under Node's ESM
  loader before any test code runs). The async half lives in
  `lib/measureShapedText.ts`, which is a five-line wrapper over `shapeText`
  plus the pure `inkExtentWidth`. **That split is why the solver's real-font
  tests exist at all**; fold the two together and the suite cannot import it.
- **`inkExtentBox` mirrors `ShapedText`'s own metrics loop** — same pen walk,
  same `getPath(gx, gy, fontSize)` bounding boxes, same
  `fontSize / unitsPerEm` scale — so the number being optimised is the number
  the canvas draws. Summing advances would be cheaper and would measure a
  different thing: advances carry the run's trailing side bearing and miss ink
  overhanging its own advance, and both move as a join is stretched.
- **Outlines are not the whole of what is drawn.** `styledRunWidth` adds the
  italic shear (`ITALIC_SHEAR × run height` — which is why `inkExtentBox`
  reports height at all), the faux-bold stroke, the block's outline
  `strokeWidth`, and `warpX`'s sideways spread. Without them a fit promised a
  width that an italic, bold, outlined or warped block then visibly exceeded.
  `ShapedText` **imports `ITALIC_SHEAR` and `fauxBoldStrokeWidth` from this
  module** rather than keeping its own copies, so renderer and fitter cannot
  drift. The four terms are summed rather than composed, and the warp term is
  the widest the distortion *can* reach rather than what it does reach — both
  over-estimate slightly, which is the safe direction for a never-overshoot
  promise.
- **Candidates are always built from the caller's original text with
  absolute counts**, never added to the current state. That is what makes the
  operation idempotent — fitting an already-fitted run returns it unchanged
  rather than compounding — and it is only possible because `applyKashida` is
  absolute rather than additive.

`applyDistribution` applies slots **from the highest text offset down**.
`applyKashida` only rewrites text at and after `slot.index`, so working
right-to-left leaves every lower offset valid; left-to-right would shift each
later slot by whatever the earlier insertion added, and every slot after the
first would land in the wrong place.

The search is a **binary search over the count**, costing about
log2(slots × maxPerSlot) measurements. It replaced an estimate-then-walk
scheme (measure at 0 and 1, divide the gap by the per-tatweel delta, step to
the answer) that had two holes worth remembering, since both look like corner
cases and neither is: a font whose 1-tatweel candidate is *not* wider — real,
because a tatweel can decompose a ligature — gave a delta of zero and no
usable estimate; and the step budget guarding the resulting long walk could
run out **while still over the target**, returning overshooting text reported
as a successful fit.

**It never overshoots**, and now structurally rather than by luck: the
running `best` only ever advances to a count whose width was actually
*measured* at or under the target, so no amount of non-monotonicity can
produce an over-target answer. Count 0 is checked first, which is what makes
that guarantee total. The one case where the returned width legitimately
exceeds the target is `already-wider`, which reports that elongation — which
only ever adds width — cannot help.

**Distribution is even across every legal join** (`distributeKashida`,
remainder to the earliest slots). Piling the total onto one join reads as a
mistake rather than as elongation, and hits `MAX_KASHIDA_PER_SLOT` long
before a wide target is met.

**App/Sidebar.** The target defaults to the page's margin box — the content
area is what a line is meant to span — falling back to the page edges when the
margin is 0. `fitTargetWidth` in `App.tsx` holds only a user's *override*, so
`null` means "track the page" and a freeform document (no page at all) simply
requires a typed number. It is a control setting, not document state: neither
saved nor undoable, like the export scale beside it.
The Sidebar keeps the **typed override** and the page default apart
(`fitTargetOverride` / `fitTargetPageDefault`), deriving the effective target
in one place. Passing the effective value as the input's `value` instead made
the field impossible to clear: backspacing wrote `null`, which immediately
re-rendered the page default back into the box.

`fitSelectedBlockToWidth` **captures the block by id, not by reference** —
solving is async and the selection can change while it runs, so patching "the
selected block" on the way out would rewrite whatever the user selected in the
meantime. It routes through `updateBlock`, i.e. one `pushHistory()` for the
whole fit, and skips the write entirely when the result is unchanged so
clicking Fit on a fitted run costs no undo step.

Plain text only. The row sits inside the existing Kashida IIFE in Typography
under a `type === "text"` gate: a Shape Fill run is auto-scaled to span its
silhouette and a Curve run to span its curve, so on those types a width target
has nothing to act on — the same reason `fontSize` is hidden for a curve.

Inherits the glyph-index fragility every text edit has (see
[kashida.md](kashida.md)); the guide says to fit before fine-tuning marks rather than
engineering around it.
