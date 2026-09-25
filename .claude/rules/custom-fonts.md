---
paths:
  - "src/lib/customFonts*.ts"
  - "src/components/FontUploadDialog.tsx"
  - "e2e/font-upload.spec.ts"
---

# User-uploaded fonts (`src/lib/customFonts.ts`, `FontUploadDialog.tsx`)

A user can add their own `.ttf`/`.otf` from Typography → **Upload a font…**.
This is the runtime counterpart of the five-place source edit documented in
"Adding a new font" in [bundled-fonts.md](bundled-fonts.md), and it exists *because* the Morph removal deleted
the one step that needed offline measurement (the per-font nuqta): a font is
now just "bytes HarfBuzz can shape plus a display name," which an upload can
supply. It does **not** replace that section — a bundled font still needs all
of it, and only a bundled font gets the PUA honorifics.

- **Storage is IndexedDB**, not `localStorage`: fonts run 100KB–2MB and the
  5MB string quota is too tight. The wrapper is ~60 lines in `customFonts.ts`
  — one DB, one object store — rather than a dependency. Best-effort like
  every store here: `memoryStore` is both the fallback when IndexedDB is
  unavailable (privacy mode) *and* the authority for reads, so a rejected
  write still behaves normally for the session instead of throwing.
- **`customFonts.ts` must not import `./harfbuzz`.** That module statically
  imports harfbuzzjs, whose CJS/ESM shape throws under Vitest's Node loader
  before any test code runs — the same reason `diacritics.ts` keeps its
  distance, and what lets `customFonts.test.ts` parse real fonts from
  `public/fonts/` directly. The one thing it needs from harfbuzz —
  `clearShapeCache` when bytes change under an object URL — arrives through
  `setShapeCacheInvalidator`, wired once at the top of `useShapedGlyphs.ts`,
  which already owns both halves.
- **`resolveFontUrl(fontFamily)` (in `useShapedGlyphs.ts`) is now the only
  legitimate way to get a font's URL** — built-in, then the custom registry,
  then Noto Sans. Indexing `FONT_URLS` directly is the bug this replaces: an
  uploaded font has no entry there and would silently render as Noto Sans.
  It is **synchronous** because the shaping hook computes a URL during
  render, which is why the registry keeps a sync `customFontUrl(key)` map of
  already-created object URLs and `App.tsx` calls `primeCustomFonts()` once
  at boot. Until that resolves, a custom family answers the fallback and
  re-renders onto its own bytes a frame later — settling `customFonts` state
  is what triggers that re-render.
- **The key is `custom-<slug>-<hash>`** (FNV-1a over the file). Hashing the
  bytes is what lets two versions of one family coexist and makes
  re-uploading the same file idempotent; the label is free text and never
  part of the key, so renaming an upload cannot fork it. The key doubles as
  a CSS `font-family` and as a block's `fontFamily`, which is why
  `slugifyFamily` emits nothing that would need quoting or escaping.
- **A `FontFace` is registered from the same bytes**, which is the runtime
  replacement for a bundled font's `@font-face` rule in `index.css` — it is
  what lets the picker preview an uploaded family in itself. `FONT_OPTIONS`
  stays the static built-in list; the picker's `options` prop appends
  `customFonts`. That append is load-bearing rather than cosmetic:
  `FontSelectRow` falls back to `options[0]` for an unknown value, so a
  custom font missing from the list would leave the trigger naming the wrong
  family.
- **Projects reference fonts by key only** — bytes are never in the layout
  payload (a cloud row has limits). A key that resolves to nothing renders in
  Noto Sans *and says so*: an effect over `blocks` in `App.tsx` reports it
  through the existing transient status row, and the Typography panel shows a
  notice for the selected block. Silence here is exactly the misdiagnosis
  trap [bundled-fonts.md](bundled-fonts.md) records for a missing `FONT_URLS` entry, so don't "tidy"
  either notice away. The block keeps its key, so re-uploading the file
  restores it.
- Deliberately out of scope: embedding bytes in saves, WOFF/WOFF2
  (harfbuzzjs wants uncompressed ttf/otf — the dialog says so rather than
  bundling a decompressor), Google-Fonts browsing, and injecting the PUA
  honorifics into an upload. The Presets row will show missing-glyph boxes in
  an uploaded font; the dialog and the guide both say so up front.
<!-- ---- /STREAM-G ---- -->
