---
paths:
  - "public/fonts/**"
  - "src/lib/presets.ts"
  - "src/hooks/useShapedGlyphs.ts"
  - "src/index.css"
---

# Font files carry custom glyphs — don't blindly replace them

`public/fonts/*.ttf|otf` are not stock font files. `FatemiMaqala.ttf` has custom Private Use Area glyphs (honorific symbols used by the sidebar's "Presets" row) that were manually merged (via a Python `fontTools` script, not committed to the repo) into every *other* font file in `public/fonts/` too, so those symbols render regardless of the selected font — **except three fonts whose licences forbid it** (see "Fonts shipped without the honorifics" below). If a font file in `public/fonts/` is ever regenerated/replaced from an upstream source, those PUA glyphs will be lost and the Presets buttons will silently show missing-glyph boxes in every font except FatemiMaqala again.

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
   font picker uses to preview the block's text in each font;
3. `FONT_OPTIONS` in `src/components/Sidebar.tsx` — a hand-ordered array of
   `{ genre, value, label, cssFamily }`, and **the only thing that decides whether
   a font appears in the picker at all**. It is ordered by `genre`: the
   font picker starts a heading wherever the genre changes, so a font placed away from its genre's block makes that heading
   appear twice. `value` is persisted in saved blocks and must never be
   renamed; `label` is free (the `Kufi` key is labelled Janna, `Urdu` is
   Jameel Noori, `Kufi2` is Reem Kufi);
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

**Retired from the picker on 2026-10-13, in favour of `UKIJDiwani`.**
Layla Diwani's own medial meem and medial hah are drawn so small and flat
that محمد reads as نصر (احمد, محمود likewise). That is the upstream design,
not our modification: compared against an upstream copy, all 459 original
glyphs and the GSUB are byte-identical, and HarfBuzz picks the right forms
(meem.init, hah.medi, meem.medi, dal.fina) in the browser and on the canvas
alike. The file, `FONT_URLS` entry and `@font-face` stay so saved blocks
still render; its `FONT_OPTIONS` entry carries `retired: true`, which keeps
it out of the font picker unless it is the selected block's current font
(see [sidebar.md](sidebar.md)).

**`UKIJDiwani.ttf` replaces it** — UKIJ Diwani Tom (`UKIJDiT.ttf`, v3.10,
Uyghur Computer Science Association) with the ten honorifics merged in;
nothing else touched (all 628 original glyphs and GSUB/GPOS/GDEF verified
byte-identical after the merge). Licence: upstream offers OFL-1.1 or
LGPL-3 — that is how Debian's audited `fonts-ukij-uyghur` copyright records
every UKIJ file — and we take the OFL. The font's own name table says
"LGPL" and "all rights reserved", which is why the audited reading is
recorded in `public/fonts/UKIJDiwani-OFL.txt`. No Reserved Font Name, so the
family name is kept. Chosen over the other UKIJ cuts and the OFL
alternatives on 2026-10-13: plain `UKIJDi` drops letters (فاطمة) and
tashkeel, `DiK`/`DiY` are shadowed/outlined and cover only the Uyghur
subset, and Mirza and Katibeh read well but are Naskh-like display faces,
not Diwani. It has full Arabic, tashkeel, Persian and digits, real GPOS and
GDEF, and no colour tables. Its only optional features are UKIJ's own
`zz01`–`zz08`, which Next Shape does not offer, so it has no alternates.

`Diwani.ttf` was **deleted** on 2026-08-12. It mapped **zero Arabic
codepoints**: its cmaps were 8-bit legacy tables of the old "Arabic
letterforms on Latin byte positions" kind, so HarfBuzz could not shape with
it at all. It was also never registered in `FONT_URLS`, which is why the
breakage went unnoticed. Do not restore it from git history expecting a
working Diwani — **`HarfCanvasDiwani.ttf` replaces it** (see above). Worth
knowing if another Diwani is ever sought: Google Fonts has none, and most
named Diwani faces (DecoType Diwani, Diwani Letter, Diwani Bent) are
proprietary or free-for-personal-use only, so they cannot be vendored here.

## Fonts shipped without the honorifics

Added 2026-10-13 with the genre picker, to match the styles the name-generator
sites offer: **Gulzar** (Nastaliq), **Blaka** (Wide Kufi) — both OFL, no
Reserved Font Name, honorifics merged as usual — and three that are *not* OFL:

| key | genre | licence | modified? |
|---|---|---|---|
| `Raqq` | Mushaf Kufi | AGPL-3.0 | instanced static; COLR/CPAL/SVG colour tables removed |
| `RanaKufi` | Decorated Kufi | AGPL-3.0 | instanced static; CFF2 → TrueType |
| `Rabat` | Maghribi | "may be used freely, no copying of glyphs" | no — byte-for-byte upstream |

**None of the three carries the honorific glyphs, on purpose.** The glyphs
come from FatemiMaqala, which is all-rights-reserved; merging them into an
AGPL font makes a combined work the AGPL cannot cover, and Rabat's licence
forbids modification outright. The Presets buttons draw missing-glyph boxes
in these three — and so do SVG/PDF exports of Rabat raise the same
embedded-outline question as the AGPL caveat below. Don't "fix" that with `mergePuaGlyphs.py`. The exemption list
lives in `SHIPS_WITHOUT_HONORIFICS` in `src/lib/bundledFonts.test.ts`, which
fails if any other font lacks the full set.

Why the modifications:
- **CFF2 is unreadable by opentype.js** ("Font doesn't contain TrueType or
  CFF outlines"), so Rana Kufi upstream would shape in HarfBuzz and then draw
  nothing. Converted by `scripts/prepareFont.py` (instancer + `Cu2QuPen`, max error
  1 unit); Raqq by the same script with `--strip-color`.
- **Colour tables split preview from canvas.** The browser draws COLR/SVG
  glyphs in colour in the picker; the canvas draws monochrome outlines. Raqq's
  colour layers are only its red vowel dots, so stripping them costs nothing
  on canvas and makes the preview honest.

Coverage gaps: **Rana Kufi has no tashkeel, no آ and no Persian letters.**
Marks are dropped before shaping by `stripUnsupportedDiacritics` (as with
Qahiri); آ and Persian letters draw as the crossed `.notdef` box — checked
in the app 2026-10-13, no error. Raqq maps shadda to an
empty glyph, which is period-correct. Rana Kufi's space is 0.05 em by design, so
words nearly touch; Word spacing in Typography is the remedy.

**AGPL caveat:** a design exported as SVG or PDF embeds outlines of Raqq or
Rana Kufi, and the AGPL has no font exception. PNG/JPEG carry pixels only.
Licence and provenance for each sit beside it as `<Name>-LICENSE.txt` /
`<Name>-OFL.txt`.

`src/lib/bundledFonts.test.ts` shapes every `FONT_URLS` font with real
HarfBuzz and checks opentype.js returns outlines for each glyph — the check
that catches a CFF2 file — and that each is registered in `@font-face` and
`FONT_OPTIONS` (Noto Sans excepted: its preview uses the system family).
