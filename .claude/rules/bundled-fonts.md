---
paths:
  - "public/fonts/**"
  - "src/lib/presets.ts"
  - "src/hooks/useShapedGlyphs.ts"
  - "src/index.css"
---

# Font files carry custom glyphs — don't blindly replace them

`public/fonts/*.ttf|otf` are not stock font files. `FatemiMaqala.ttf` has custom Private Use Area glyphs (honorific symbols used by the sidebar's "Presets" row) that were manually merged (via a Python `fontTools` script, not committed to the repo) into every *other* font file in `public/fonts/` too, so those symbols render regardless of the selected font. If a font file in `public/fonts/` is ever regenerated/replaced from an upstream source, those PUA glyphs will be lost and the Presets buttons will silently show missing-glyph boxes in every font except FatemiMaqala again.

**There are TEN of those glyphs, and they are not a contiguous range.** The
authoritative list is `PRESETS` in `src/lib/presets.ts`:

    E833 E834 E835 E836 E837 E838 E839 E840 E841 E842

`E83A`–`E83F` are unused, and `E841`/`E842` sit *past* `E840`. Earlier
revisions of this file described them as "8 glyphs, U+E833-E840", which is
wrong twice over — a merge script written from that range silently omits
the last two, and the only symptom is the final two Presets buttons
rendering as missing-glyph boxes in the affected font. That exact bug was
hit and fixed on 2026-08-12. **Derive the list from `PRESETS`, never from a
range.**

**Adding a new font is a five-place edit plus a glyph merge, not a file
copy.** There is no single font registry — a font must be added to *all
four* of these or it half-works in a way that is easy to misdiagnose:

1. the file itself in `public/fonts/`;
2. an `@font-face` rule at the top of `src/index.css` — this is what the
   sidebar's dropdown uses to preview each font's own name;
3. `FONT_OPTIONS` in `src/components/Sidebar.tsx` — a hand-ordered array of
   `{ value, label, cssFamily }`, and **the only thing that decides whether
   a font appears in the picker at all**;
4. `FONT_URLS` in `src/hooks/useShapedGlyphs.ts` — what HarfBuzz actually
   shapes with.

(There used to be a fifth: a measured per-font nuqta in `src/lib/nuqta.ts`.
It went with the stroke subsystem — see [removed-subsystems.md](removed-subsystems.md). The
measurements themselves survive in `docs/archive/nuqta-measurements.md`, so
anything that needs a nuqta again starts from there rather than re-measuring.)

Then merge the ten honorific glyphs into the file (see above).

Each omission fails differently, and none of them fails loudly:
registering in `FONT_URLS` alone shapes correctly but leaves the font
invisible in the UI; adding to `FONT_OPTIONS` alone makes it selectable but
`FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans` silently falls back to Noto
Sans, so the picker shows a name that renders as a different font.

`HarfCanvasDiwani.ttf` is the worked example of all of this, added
2026-08-12. It is a **modified version of Layla Diwani** (OFL, Mohammed
Isam): the ten honorifics were merged in, and the family / full / PostScript
names were changed because the upstream reserves the name `LaylaDiwani`
under the OFL, and a Modified Version may not carry a Reserved Font Name.
Four of the ten codepoints (U+E833–E836) were already mapped by the original
to its own contextual variants; only those *cmap entries* were replaced —
the original glyphs remain in the file, and its GSUB is unaffected because
substitutions reference glyph names rather than codepoints. Provenance and
the full licence live beside it in `public/fonts/HarfCanvasDiwani-OFL.txt`;
keep that file with the font. Known limitation: the upstream has **no GPOS
table**, so mark positioning relies on advances alone and the
diacritic-detection fallback in `lib/diacritics.ts` that keys on nonzero
GPOS `dx`/`dy` cannot fire on it.

Two traps when merging those PUA glyphs into a third-party font:

- **The target range may already be occupied.** Fonts built in FontForge
  routinely auto-assign PUA codepoints to unencoded contextual variants.
  Layla Diwani, evaluated 2026-08-12, already maps U+E833–E836 — four of
  the eight honorific slots. Overwriting those *cmap entries* is safe in
  practice because GSUB substitutions reference glyph names rather than
  codepoints, so the font's internal contextual logic keeps working; but
  the collision must be checked and handled deliberately, not assumed away.
- **OFL Reserved Font Names.** Merging glyphs creates a Modified Version.
  If the upstream font declares a Reserved Font Name (Layla Diwani reserves
  `LaylaDiwani` among others), the modified file **must be renamed** — its
  `name` table included — or redistribution breaches the licence.

`Diwani.ttf` was **deleted** on 2026-08-12. It mapped **zero Arabic
codepoints**: its cmaps were 8-bit legacy tables of the old "Arabic
letterforms on Latin byte positions" kind, so HarfBuzz could not shape with
it at all. It was also never registered in `FONT_URLS`, which is why the
breakage went unnoticed. Do not restore it from git history expecting a
working Diwani — **`HarfCanvasDiwani.ttf` replaces it** (see above). Worth
knowing if another Diwani is ever sought: Google Fonts has none, and most
named Diwani faces (DecoType Diwani, Diwani Letter, Diwani Bent) are
proprietary or free-for-personal-use only, so they cannot be vendored here.
