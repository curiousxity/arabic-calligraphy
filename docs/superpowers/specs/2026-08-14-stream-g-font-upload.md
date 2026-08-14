# Stream G — User font upload

**Read `PARALLEL-PHASE-2.md` first.** Branch: `stream/g-font-upload`.

## What exists today, and what Phase 0 changed

Adding a font was a five-place edit (file, `@font-face`, `FONT_OPTIONS`,
`FONT_URLS`, measured `NUQTA_EM_RATIO`) plus a PUA glyph merge. The Morph
removal deleted the nuqta requirement — the one step that needed offline
*measurement* — so a font is now just "bytes HarfBuzz can shape plus a
display name," which is exactly what an upload can supply at runtime.

## Design

### `src/lib/customFonts.ts` (exclusively owned)

```ts
export type CustomFont = { key: string; label: string; addedAt: number };
export async function addCustomFont(file: File): Promise<CustomFont | { error: string }>;
export async function listCustomFonts(): Promise<CustomFont[]>;
export async function removeCustomFont(key: string): Promise<void>;
export async function getCustomFontUrl(key: string): Promise<string | null>; // object URL, cached
```

- **Storage: IndexedDB**, not localStorage — fonts run 100KB–2MB and the
  5MB string quota is too tight. One small hand-rolled wrapper (open DB,
  one object store, get/put/delete/getAll) — no new dependency. Best-effort
  like every store in this app: IndexedDB unavailable degrades to
  in-memory-for-the-session, never a crash.
- **Validation before accept:** parse with the already-vendored
  `opentype.js`; reject unparseable files with a human message. Read the
  family name from the `name` table for the default label; `key` is
  `custom-<slug>-<hash>` so two versions of one family can coexist.
- Re-adding an existing key calls `clearShapeCache()` (the documented
  requirement when bytes change under a URL) and revokes the old object
  URL.

### The registry seam (`useShapedGlyphs.ts` — G owns this file this phase)

Replace direct `FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans` lookups with
`resolveFontUrl(fontFamily)`: built-ins first, then the custom registry,
then the NotoSans fallback. Custom fonts also register a runtime
`FontFace` (from the same bytes) so the sidebar dropdown previews them —
the `@font-face`-in-CSS step becomes a runtime call. `FONT_OPTIONS` in
`Sidebar.tsx` stays the static built-in list; the dropdown renders
built-ins + `listCustomFonts()` (anchor region), custom entries marked and
deletable.

### `src/components/FontUploadDialog.tsx` (exclusively owned)

File input (`.ttf,.otf`), label field prefilled from the name table, the
two honest caveats printed right in the dialog:

1. **Presets symbols** — the ten PUA honorifics exist only in bundled
   fonts; in an uploaded font the Presets row will show missing-glyph
   boxes. Say it, don't engineer around it.
2. **Licence** — the user is responsible for having the right to use the
   font; uploaded fonts stay in this browser only.

### Saved projects

Projects reference fonts **by key only** — bytes are never embedded in the
layout payload (a cloud save would balloon and Supabase rows have limits).
Loading a project whose font key resolves to nothing falls back to
NotoSans **with a visible one-line notice** ("Font 'X' isn't available in
this browser — using Noto Sans"), not silently — the silent version of
this is the exact misdiagnosis trap CLAUDE.md documents for `FONT_URLS`
omissions. The notice mechanism can be the same transient message row the
export/copy results already use.

## Testing

Unit: key slugging/hashing; validation rejects garbage bytes (real
opentype.js, no mocks — parse a real font fixture from `public/fonts/` and
a truncated copy); resolveFontUrl precedence; cache-clear on re-add. E2E
(`e2e/font-upload.spec.ts`): upload a real .ttf via Playwright's file
chooser → font appears in dropdown → select it → text re-renders (ink
changes); reload page → font persists; delete → fallback notice on a
project using it.

## Out of scope

Embedding font bytes in cloud saves; WOFF2 (harfbuzzjs wants raw
ttf/otf — note, don't build decompression); Google-Fonts browsing; PUA
honorific injection into uploads.
