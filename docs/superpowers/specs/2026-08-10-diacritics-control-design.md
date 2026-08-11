# Tashkeel / Diacritics Control — Design

Date: 2026-08-10
Status: Approved, ready for implementation planning

## Summary

Per-instance control over Arabic diacritical marks (tashkeel/harakat —
fatha, kasra, damma, shadda, sukun, etc.) on plain text blocks: hover any
diacritic on the canvas to reveal handles for repositioning it vertically,
resizing it, and hiding it individually — without touching the underlying
text or the font's own mark-attachment shaping for every other diacritic
in the block.

This is the second of four planned features (text on path is complete;
per-glyph/gradient color and a visible undo/redo thumbnail history are
still to come, each getting its own design).

## Existing behavior this builds on

The app already has a diacritics keyboard (`PresetKeyboard` in
`Sidebar.tsx`, backed by `DIACRITICS` in `lib/presets.ts`) that inserts
tashkeel characters into a block's text at the cursor, and a destructive
"Clear diacritics" button (`clearDiacritics` in `App.tsx`) that strips
every diacritic from the text entirely. Diacritics are shaped normally by
HarfBuzz today — positioned via the loaded font's own GPOS mark-attachment
rules, with `stripUnsupportedDiacritics` (`lib/harfbuzz.ts`) silently
dropping any diacritic character the loaded font has no glyph for, to
avoid rendering `.notdef` tofu boxes. There is currently no control over
size, vertical placement, or per-instance visibility beyond "type it or
don't" and "delete all of them."

## Non-goals for v1

- **Only plain `text` blocks** (`ShapedText.tsx`). Shape Fill (tiled
  rows), Shape Warp (bounding-envelope remap), and Text on Path (curve
  placement) each put a diacritic's on-screen position through additional
  transforms beyond the simple pen-advance `ShapedText.tsx` uses, and
  correctly locating a hover-handle in each of those coordinate spaces is
  real, separate design work — worth a follow-up once this lands, not
  bundled in here.
- **No per-diacritic-type dial** (a single "fatha size" slider affecting
  every fatha in the block). Control is purely per-instance.
- **No non-destructive block-level visibility toggle** beyond what
  per-instance hiding already provides — a user wanting to hide every
  diacritic in a block hides them one at a time (or uses the existing
  destructive "Clear diacritics", which remains unchanged).

## Data model

A new type in `src/types.ts`:

```ts
export type DiacriticOverride = {
  glyphIndex: number;
  scale?: number;
  offsetY?: number;
  hidden?: boolean;
};
```

- `glyphIndex` keys into the shaped glyph array — the exact same scheme
  `GlyphStretchHandle` already uses for the Stretch tool, including that
  scheme's known fragility (a text edit *before* a diacritic in the string
  can shift which glyph index an override lands on after re-shaping).
  That's pre-existing, accepted behavior in this codebase, not a new
  risk this feature introduces.
- `scale` — multiplier on the diacritic's natural size, default `1`.
- `offsetY` — additional vertical shift in local (unscaled) units,
  default `0`.
- `hidden` — when `true`, the glyph is skipped entirely during drawing;
  its advance-width contribution to pen position is unaffected, so
  hiding one mark never reflows surrounding letters.

`diacriticOverrides?: DiacriticOverride[]` is added to `TextBlock`
specifically (not `BlockCommon`) — since this feature is `ShapedText`-only
for v1, unlike the Stretch tool's genuinely shared fields, it shouldn't
appear as a meaningless always-empty array on `ImageBlock`/
`ShapeFillBlock`/`ShapeWarpBlock`/`TextPathBlock`.

## Identifying diacritic glyph instances

`ShapedText.tsx` already computes `glyphHitBoxes` — screen-space
`x`/`y`/`width`/`height` per shaped glyph, in one pass over every glyph in
the run (`glyphMetrics` `useMemo`), used today for the Stretch tool's
click-to-select hit-testing. Diacritics are included in this array already
(HarfBuzz shapes them as their own glyph entries with their own outline
and bounding box), so no new hit-testing machinery is needed — the
existing pass already gives real on-screen coordinates for every
diacritic in the block.

To determine *which* glyph indices are diacritics: `ARABIC_DIACRITIC_RE`
(currently a private constant in `lib/harfbuzz.ts`, used only by
`stripUnsupportedDiacritics`) is exported, and for each glyph its source
character is looked up via `glyph.cl` indexing into
`shapeData.shapableText` — the same cluster-to-source-character mapping
technique `strokeSchema/glyphLookup.ts` already uses for a different
purpose (mapping shaped glyphs back to stroke-schema entries). Matching
that character against the exported regex identifies diacritic glyph
indices. This is glue between two pieces of existing infrastructure, not
new detection logic.

## Render-time application

Inside `drawWarpedGlyphRun` (the shared per-glyph draw loop in
`ShapedText.tsx`), immediately after the existing `ctx.translate(gx, gy)`
step and before the glyph's outline commands are traced, a diacritic
glyph with a matching override gets an additional
`ctx.translate(0, offsetY); ctx.scale(scale, scale);` — pivoting around
`(gx, gy)`, the glyph's own pen-attachment point, so a diacritic grows,
shrinks, or shifts without drifting away from the letter it's attached
to. This mirrors the exact structure the function already uses for the
Private-Use-Area "override glyph" preset symbols (translate + scale
before tracing the path), just conditioned on "is this glyph index a
diacritic with a stored override" instead of "is this a PUA preset
glyph." A `hidden: true` override skips the glyph's draw call entirely
(the `continue` happens before `ctx.fill()`/`ctx.stroke()`, after the pen
position has already advanced), so hiding a mark never reflows the rest
of the line.

## On-canvas hover interaction

A new component, `DiacriticHoverHandles.tsx`, rendered as a sibling
inside `ShapedText`'s Konva `Group`, active only when the block is
selected (`isSelected`) — matching every other interactive on-canvas
overlay in this app (the shapeFill/image resize handle, the text-path
curve-edit dots), none of which are ever active on an unselected block.

It reuses `glyphHitBoxes` (already computed, already passed up via
`onGlyphBoxesChange`) filtered down to diacritic glyph indices, and tracks
which single diacritic the mouse currently hovers via a small invisible
hover-`Rect` per diacritic hit box (`onMouseEnter`/`onMouseLeave`). Only
the currently-hovered diacritic shows handles — never more than one set
at a time, which is what keeps many-diacritics text from turning into
visual clutter:

- **Move handle** at the diacritic's current position — vertical drag
  sets `offsetY` directly from the drag delta.
- **Resize handle** offset slightly to the side of the move handle —
  drag distance from the diacritic's anchor point (`gx`, `gy`) sets
  `scale`.
- **Small × button** — click toggles `hidden`. A hidden diacritic's own
  hover-`Rect` stays in place (at its original, un-drawn position) so it
  remains hoverable and can be un-hidden the same way.

## Integration

- **History:** live dragging (move handle, resize handle) follows the
  same debounced-history pattern the text-on-path curve editor already
  established (`useDebouncedHistoryPush`) — state updates immediately on
  every drag frame, one undo step is recorded once the gesture settles.
  The hide-button click is a discrete, single-shot mutation and goes
  through `pushHistory()` immediately first, like every other click-driven
  mutation in the app.
- **Export:** the hover-handle overlay only ever renders for whichever
  diacritic the mouse currently hovers on a *selected* block; exports run
  with no live mouse interaction, so no special export-hiding logic
  (unlike the text-path curve editor's `#text-path-edit-layer-*` hiding)
  should be needed. This assumption gets an explicit manual verification
  step in the plan rather than being taken on faith.
- **Reset action:** a small "Reset diacritic overrides" control (a
  sidebar button, placed near the existing "Clear diacritics" button)
  clears `diacriticOverrides` for the selected block without touching its
  text — the non-destructive counterpart to the existing destructive
  clear.

## Testing

The diacritic-detection logic (glyph cluster → source character →
regex match against the exported `ARABIC_DIACRITIC_RE`) is pure and
straightforward to unit-test if factored into a small standalone helper
(e.g. in `lib/harfbuzz.ts` alongside the newly-exported regex, or a new
tiny `lib/diacritics.ts`) rather than inlined directly into
`DiacriticHoverHandles.tsx` — consistent with this codebase's existing
convention of unit-testing pure `lib/*.ts` logic while leaving Konva
rendering components themselves untested. The render-time
translate/scale/hide application inside `drawWarpedGlyphRun` and the
hover-handle component itself are not unit-tested, matching how every
other Konva-rendering code path in this app is verified manually rather
than with component tests.
