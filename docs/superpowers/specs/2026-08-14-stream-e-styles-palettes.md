# Stream E — Saveable styles & palettes

**Read `PARALLEL-PHASE-2.md` first.** Branch: `stream/e-styles-palettes`.

## What exists today

Every block styles itself from scratch; nothing carries a look from one
block to another except copy/paste of whole blocks. Multi-block
compositions drift incoherent. The nearest precedent is
`lib/exportPresets.ts` — a small localStorage store of named settings with
pure list functions — and this stream is deliberately two more instances of
that exact pattern.

## Design

### `src/lib/textStyles.ts` (exclusively owned, pure + storage)

```ts
export type TextStyle = {
  id: string; name: string;
  // Every field optional: a style sets only what it captured.
  fontFamily?: string; fontSize?: number; color?: string;
  strokeColor?: string; strokeWidth?: number;
  shadowColor?: string; shadowBlur?: number; shadowOffsetX?: number;
  shadowOffsetY?: number; letterSpacing?: number; lineHeight?: number;
};
export function captureStyle(block: Block, name: string): TextStyle; // reads the styling fields off BlockCommon
export function styleToPatch(style: TextStyle): Partial<Block>;      // what updateSelectedBlock applies
export function loadStyles(): TextStyle[]; export function saveStyles(s: TextStyle[]): void;
export function upsertStyle(list, style): TextStyle[]; export function removeStyle(list, id): TextStyle[];
```

Storage key `harfcanvas-text-styles-v1`, best-effort try/catch falling back
to `[]` — byte-for-byte the exportPresets conventions, including
overwrite-by-name on save. Match the exact field names `BlockCommon` uses
(read `types.ts` first; the list above is indicative, not authoritative).

### `src/lib/palettes.ts` (exclusively owned)

`Palette = { id, name, colors: string[] }` (≤ 12 colors), same store
pattern, key `harfcanvas-palettes-v1`, plus 3–4 shipped defaults (ivory/
navy/gold "Manuscript", black/red "Rubrication", etc. — defined in code,
not storage, and always listed first).

### App + Sidebar (anchors)

- Typography panel gains a **Styles** row: dropdown of saved styles +
  Apply (patches every selected block via the existing
  `updateSelectedBlock` — one history push for the gesture) + "Save style
  from block…" (name prompt, `captureStyle`) + delete.
- Every `ColorRow` gains palette swatches: `FormControls.tsx`'s `ColorRow`
  is **not** in this stream's ownership — so the swatch strip renders from
  the Styles row's own anchor region as a small `PaletteSwatches`
  component owned here, mounted beside the existing colour inputs it can
  reach *within its anchors* (Typography colour, at minimum). If reaching
  the other ColorRows cleanly requires touching `FormControls.tsx`, that
  is the known spec bug to report, not fix — v1 ships with swatches on the
  Typography colour only.
- Styles and palettes are **local-only** (not in saved projects, not in
  Supabase), matching export presets. Applying a style is undoable;
  managing the style list is not history-tracked (it isn't document
  state).

## Testing

Unit: capture→patch round-trip only touches styling fields (never `text`,
`x/y`, `type`); store fallback on corrupt JSON; overwrite-by-name;
defaults-always-present for palettes. E2E (`e2e/styles.spec.ts`): style two
blocks differently → save style from first → apply to second → bridge
confirms the second's colour/font changed and text didn't; reload page →
style still listed.

## Out of scope

Cloud sync of styles; per-project palettes saved into the layout payload;
style *linking* (edit style → blocks update); paragraph styles.
