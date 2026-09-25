---
paths:
  - "src/lib/textStyles*.ts"
  - "src/lib/palettes*.ts"
  - "src/lib/exportPresets*.ts"
  - "src/components/PaletteSwatches.tsx"
  - "e2e/styles.spec.ts"
---

# Saveable text styles & palettes (`src/lib/textStyles.ts`, `src/lib/palettes.ts`, `PaletteSwatches.tsx`)

Two more instances of the `lib/exportPresets.ts` pattern, deliberately: a
named list in `localStorage`, best-effort try/catch on every read and write,
pure `upsert`/`remove` list functions, overwrite-by-name on save, and
**local-only** — neither store enters the layout payload, the undo snapshot,
or the Supabase named-project store. Keys are `harfcanvas-text-styles-v1`
and `harfcanvas-palettes-v1`.

- **A style is defined by what it refuses to carry.** `STYLE_FIELDS` in
  `textStyles.ts` is the single list both `captureStyle` and `styleToPatch`
  walk, so the two directions cannot drift; it holds only styling fields, so
  `text`, `x`/`y`, `id` and `type` can never ride along. `textStyles.test.ts`
  asserts that absence rather than only the presence of the fields — the
  round-trip test patches a *different* block and checks its text and
  position survived.
- **The field names come from `BlockCommon`, not from the spec.** The
  outline colour is `stroke` (not `strokeColor`), and there is no
  `letterSpacing` field in this codebase at all — the spec's indicative list
  named both, and both were resolved against `types.ts`. `lineHeight` lives
  on `TextBlock` only; it is captured and applied anyway, inert on the other
  types the same way `BlockCommon` is already inert in several places.
- **Palette defaults live in code, never in storage.** `loadPalettes`
  returns only the *user's* palettes and `savePalettes` writes only those;
  `allPalettes` prepends `DEFAULT_PALETTES`. So the shipped palettes cannot
  be corrupted, cannot go stale against a later release, and always list
  first — and a stored palette reusing a default's id is dropped rather than
  shadowing it.
- **`patchSelectedBlocks` in `App.tsx` is this stream's one mutating
  primitive.** `updateSelectedBlock` patches only the single selected block,
  and a style is meant to bring a whole selection into line, so this walks
  `effectiveSelectedIds` with **one** `pushHistory()` for the gesture —
  applying a style to six blocks is one undo. Managing the lists themselves
  is not history-tracked: it isn't document state.
- **`PaletteSwatches.tsx` is a component of its own rather than an addition
  to `FormControls.tsx`'s `ColorRow`**, which belongs to no stream this
  phase. It is mounted from the Styles region at the top of Typography, so
  the swatches drive the *text* colour; `ColorRow` keeps its own separate
  fixed grid of stock colours. Reaching the other `ColorRow`s (stroke,
  shadow, page) needs `FormControls.tsx` and was left for a later phase — a
  known, deliberate v1 limit, not an oversight.
<!-- ---- /STREAM-E ---- -->
