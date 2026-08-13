# HarfCanvas

A browser-based design tool for Arabic calligraphy.

Compose Arabic text on a canvas, flow it along a curve or pour it into a
shape, adjust individual letters and diacritics by hand, and export to PNG,
JPEG, SVG or PDF.

Text is shaped with **real HarfBuzz** compiled to WebAssembly — the same
engine your browser and operating system use — not a JavaScript
approximation. Letters connect, contextual forms are chosen by the font's
own rules, and ligatures fuse where the font says they should.

## What it does

**Typesetting**

- Arabic text shaped by HarfBuzz, rendered from real font outlines via
  [opentype.js](https://opentype.js.org/) onto a [Konva](https://konvajs.org/)
  canvas
- 17 bundled faces across Naskh, Thuluth, Kufi, Diwani, Ruq'ah, Nastaliq and
  more
- Four block types: plain text, text on an arbitrary curve, text poured into
  an SVG silhouette, and images
- An on-screen Arabic keyboard, plus one-tap insertion of harakat, honorific
  symbols and Urdu/Farsi letters

**Letter-level control** — the part that makes it a calligraphy tool rather
than a text box

- **Stretch individual strokes.** Drag a dot on a letter to lengthen its
  body, its tail, or the eye of a feh. The strokes each letter offers come
  from an anatomical decomposition of the letterform, authored per letter and
  per contextual form, covering the whole alphabet.
- **Measured in nuqta.** Stretch snaps to whole and half nuqta — the rhombic
  dot a reed nib makes, the unit traditional Arabic calligraphy actually
  measures in — reading "+1½ nuqta" rather than an abstract decimal. Hold
  Alt for free positioning.
- **Joins hold while you stretch.** The point where two letters connect is
  found from where their outlines physically overlap, and pinned, so
  lengthening one letter does not tear it away from its neighbour.
- **Kashida.** One dial distributes elongation across every eligible stroke
  in a block, weighted by how willing each stroke is to stretch — or solve
  it automatically to match a target width.
- **Per-mark diacritic control.** Move, resize or hide any single tashkeel
  mark without touching the text underneath.
- **Move and scale any single glyph**, and reshape outlines directly with a
  lasso or per-contour mask.

**Composition**

- Multi-select, grouping, alignment and distribution
- Snapping to other blocks' edges and centres, to ruler guides, and to a
  grid, with equal-spacing hints
- Undo/redo with a visual history you can jump back into
- Starter templates with a fill-in-the-blanks wizard
- Export presets, clipboard copy, and export-all-formats in one pass
- Named projects saved locally, and optionally synced to a Supabase account

## Running it

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually <http://localhost:5173>).

```bash
npm run build    # production build
npm test         # test suite
npm run lint
```

Node 20+ recommended. No API keys or services are required — cloud sync is
optional and the app runs fully offline without it.

### Optional: cloud sync

Named projects are stored in your browser by default. To also sync them to
an account, set

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

and apply the migration in `supabase/migrations/`. Without these the cloud
UI is hidden entirely and nothing else changes. Sign-in is email magic-link
only.

## Fonts and licensing

**Please read this before redistributing anything from `public/fonts/`.**

The bundled fonts come from several sources under several licences, and
**every one of them has been modified** — a set of ten honorific symbols
(ﷺ and similar) was merged into each file so those glyphs render regardless
of which face is selected. A modified font is not the upstream font, and
some licences constrain what you may then do with it.

One case is documented in full as the worked example: `HarfCanvasDiwani.ttf`
is a modified version of Layla Diwani (OFL, Mohammed Isam), renamed as the
OFL requires because the upstream reserves its name. Its licence and a note
on what changed sit beside it in `public/fonts/HarfCanvasDiwani-OFL.txt`.

The provenance of the remaining faces is **not** fully documented in this
repository. If you intend to redistribute this project or its fonts, verify
each file's licence yourself first. `scripts/FONTS.md` describes the tooling
and the obligations that come with modifying a font.

This repository does not currently carry a licence of its own, which means
default copyright applies to the code.

## Project documentation

- **`CLAUDE.md`** — the engineering guide: architecture, the reasoning behind
  each subsystem, and the traps. Long, and worth reading before changing
  rendering or shaping code.
- **`PROGRESS.md`** — what shipped when, what is known-broken, and what is
  deliberately not built yet.
- **`docs/superpowers/specs/`** — design documents for individual features.
- **`scripts/FONTS.md`** — adding and measuring fonts.

## Status

Actively developed, pre-1.0, and honest about its edges — see `PROGRESS.md`
for current limitations. Built with React 19, TypeScript, Vite, Konva,
harfbuzzjs and opentype.js.
