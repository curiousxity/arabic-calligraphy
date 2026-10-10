# Practice sheet export — design (2026-10-09)

A printable PDF that turns the selected text block into a calligraphy
practice sheet (*mashq*): a solid model row, faint rows to trace, and ruled
blank rows to write unaided, all drawn on a nuqta grid whose unit is the
width of the pen the learner holds. This file carries the argument and the
decisions; once built, the mechanics live in
`.claude/rules/practice-sheet.md`.

## Why

The sheet is the cheapest test of a learning product on top of the editor.
Generic starter kits ship a photocopied alphabet; this prints the learner's
own name, in a chosen style, at the size their actual qalam writes. It needs
no account, no billing and no font audit beyond the faces it uses, so it can
ship before any of those decisions are made.

## Scope

**In:** the selected plain `text` block; bundled or uploaded font; nib-width
or direct em-size scaling; A4 or US Letter portrait; model / trace / blank
row counts; PDF download; a footer naming style, nib and nuqta size.

**Out of v1, deliberately:** shape fill, text-on-path, square kufi, mirror
and image blocks (none are tracing material); per-glyph edits made in the
editor — diacritic overrides, glyph transforms, straight-stroke cuts — and
gradient or texture fills. Kashida *is* honoured because it is real tatweel
characters in the text. Alphabet sheets (one letter and its forms per page)
are a planned follow-up on the same page machinery, not part of this spec.

## The one decision that mattered

**Vector PDF from a pure layout module, not a second Konva stage.**

The editor's text renderer could draw the sheet on an offscreen stage and the
existing PDF export could rasterise it. That would carry every editor edit
onto the sheet for free. It was rejected because the sheet has three
requirements the editor path serves badly: exact millimetre scale (the
artboard's px-at-dpi model can express it, but only indirectly), hairline
grey outlines that survive a home printer (rasterised at 300 dpi they fatten
or drop out), and testability (jsdom cannot rasterise, so the whole feature
would be untestable). A pure module that lays out in mm and a thin writer
that emits jsPDF vector paths meets all three. The cost is that per-glyph
editor edits do not appear in v1; nothing about the design prevents adding
them later.

## Scale

One nuqta on paper equals the nib width. `src/lib/nuqta.ts` already holds a
measured ratio of nuqta to font size per bundled face (fallback for uploaded
fonts), so:

```
emHeightMm = nibWidthMm / nuqtaRatio(fontFamily)
```

A 4 mm qalam in Thuluth (ratio 0.0918) gives a 43.6 mm em; the Thuluth alif
is about 7 nuqta, so roughly 28 mm, which is traditional practice size.

The **direct size override** sets `emHeightMm` instead and derives the nuqta
from it (`emHeightMm × ratio`), so the grid is always true to the drawn
letters, whichever input drove it.

**Overflow:** if the shaped run at that scale is wider than the printable
width, the whole sheet is scaled down to fit and the footer states the
resulting nuqta so the learner knows it is smaller than their nib. The
sheet never wraps text.

## Page geometry (`src/lib/practiceSheet.ts`, pure)

Input:

```ts
type PracticeSheetOptions = {
  page: "a4" | "letter";          // portrait only
  marginMm: number;               // default 15
  scale: { nibWidthMm: number } | { emHeightMm: number };
  rows: { model: number; trace: number; blank: number }; // default 1 / 3 / 3
  fontFamily: string;
};
```

plus an injected **measured run**: the shaped glyph advances and the font's
ascender/descender in font units. Shaping is injected, not imported, so the
module has no HarfBuzz dependency and is Vitest-importable; tests feed it
real-font runs through the `shapeReal` helper pattern used by
`fitToWidth.test.ts` and `diacritics.test.ts` (never hand-written fixtures).

Output is a page description in millimetres:

```ts
type PracticeSheetLayout = {
  pageMm: { width: number; height: number };
  emHeightMm: number;
  nuqtaMm: number;
  fitScale: number;               // 1 unless overflow shrank the sheet
  rows: { kind: "model" | "trace" | "blank"; baselineY: number; originX: number }[];
  grid: { x: number[]; y: number[]; heavyEvery: 5 };
  footer: string;
};
```

Rules:

- Row height is `(ascender − descender) / unitsPerEm × emHeightMm` plus one
  nuqta of air, so tall styles get taller rows rather than colliding.
- Rows are laid top to bottom in the order model → trace → blank. Rows that
  do not fit on the page are dropped from the end, never squeezed; the
  layout reports how many were dropped so the dialog can say so.
- The run is **right-aligned** to the printable area (`originX` is the pen
  origin for an RTL run, i.e. the right margin), since the hand starts at
  the right.
- Grid lines are at nuqta spacing from the page's left/top margin, every
  fifth line heavy. The grid spans the printable area, not the page edge.
- The baseline of each row is also a grid-independent heavy rule, so blank
  rows still carry a baseline.

## Drawing (`src/lib/practiceSheetPdf.ts`)

`buildPracticeSheetPdf(block, options)`:

1. Resolve the font URL through `resolveFontUrl` (never index `FONT_URLS`),
   shape the block text once with `shapeText`, and build the measured run
   from the result (`glyphs`, `font.ascender`, `font.descender`,
   `unitsPerEm`).
2. Call the pure layout.
3. Lazily `import("jspdf")` exactly as `useExport.ts` does, create a
   portrait document in mm at the page size, and for each row walk the glyph
   run, converting each glyph's `opentype` path (`font.glyphs.get(id).getPath`)
   to jsPDF path ops scaled by `emHeightMm / unitsPerEm × fitScale`, with y
   flipped (font y up, PDF y down).
   - `model` rows: fill black.
   - `trace` rows: stroke only, 0.15 mm, grey `#B4B4B4`, no fill.
   - `blank` rows: nothing but the rules.
4. Draw grid, baselines and the footer text, then return the `jsPDF`
   instance; the caller saves it as `practice-<slug of text>.pdf`.

Outline → PDF conversion is its own small pure function (`opentype` path
commands in, jsPDF `path()` op list out) so the coordinate flip and the
quadratic→cubic promotion jsPDF needs are unit-tested in isolation.

## UI

A **"Practice sheet…"** button in the Export panel, enabled only when
exactly one `text` block is selected (disabled with a tooltip otherwise).
It opens `PracticeSheetDialog`:

- Nib width in mm (number input, default 4, step 0.5), with a
  "set letter size directly" toggle that swaps it for an em-height input.
- Page size: A4 / US Letter.
- Three row-count inputs (defaults 1, 3, 3).
- A one-line readout: "Em 43.6 mm · nuqta 4.0 mm · 7 rows" that updates
  live from the pure layout, and a warning line when rows were dropped or
  the sheet was shrunk to fit.
- **Download** button.

Dialog state is local to the dialog and never reaches `App.tsx`, the same
boundary the in-app guide keeps. The dialog receives the selected block as a
prop and nothing else from the editor.

## Error handling

- No selected text block: the button is disabled; the dialog cannot open.
- Font fails to load or shape (uploaded font gone): the dialog shows the
  error inline and keeps the Download button disabled; nothing throws to
  the app.
- Empty or whitespace-only text: layout returns zero rows and the dialog
  says so.

## Testing

- `practiceSheet.test.ts`: scale maths from nib width and from em height
  for a known face; row heights from real ascender/descender; row dropping
  when the page is too short; right alignment of a real Amiri run inside
  the margin; fit-scale on an over-wide run; grid spacing equals the nuqta.
- `practiceSheetPdf.test.ts`: the outline→path converter on a known glyph
  (y flip, quadratic promotion, closed contours), and that building a sheet
  for a short run yields a one-page document. No pixel assertions.
- No e2e in v1; the dialog is simple form state.

## Documentation

- New `.claude/rules/practice-sheet.md` with `paths:` covering the two
  modules and the dialog; one line under "Subsystem notes" in `CLAUDE.md`;
  a shipped-entry in `PROGRESS.md` naming the v1 exclusions above.
- One guide section in `src/components/guide/sections/` written for
  calligraphers: what the rows are for and how to pick a nib width.

## Open questions

None blocking. Two things to decide when the alphabet-sheet follow-up is
designed, not now: whether the letter-forms table reuses this page layout
with one "row" per form, and whether sheets should carry a QR link back to
the design so a learner can reprint.
