# Stream C — Ornament & frame library

**Read `PARALLEL-PHASE-1.md` first.** Branch: `stream/c-ornament-library`.

## What exists today

Shape Fill blocks require the user to *upload* an SVG silhouette
(`lib/svgImport.ts`'s `extractSvgPaths` → `shapeSvgPath` on the block).
There is no built-in shape, so the feature is invisible to anyone without
their own SVG collection. Decorative frames don't exist at all.

## Design

### The ornament data (`src/data/ornaments/`, exclusively owned)

One TS module per ornament (not raw .svg files — same reasoning as guide
sections: no loader magic, typed, tree-shaken):

```ts
// src/data/ornaments/mihrab-arch.ts
export default {
  id: "mihrab-arch",
  name: "Mihrab arch",
  nameAr: "محراب",
  tags: ["frame", "arch"],
  viewBox: { w: 200, h: 300 },
  paths: ["M …"],            // one or more SVG path d strings
} satisfies OrnamentDef;
```

`src/lib/ornaments.ts` declares `OrnamentDef`, auto-loads every module via
`import.meta.glob` (the stroke-schema/guide-registry precedent — dropping a
file in the folder is the whole integration step), and exposes
`listOrnaments()` / `getOrnament(id)`.

**Authoring:** all geometry must be original — constructed from primitives
(arcs, polygons, circle arrays), not traced from found images. Initial set,
~10: mihrab arch, pointed/horseshoe arch, 8-point star (khatam), 12-point
star, circular medallion, ogee cartouche, crescent, teardrop (boteh),
rectangular border frame, scalloped roundel. Unit-test that every module
parses through the app's own `lib/svgPath.ts` (`pathToPolygon` returns a
non-degenerate polygon) — that is precisely what Shape Fill will do with it.

### The picker (`src/components/OrnamentPicker.tsx`, exclusively owned)

A dialog (portal to `document.body`, the MorphGlyphEditor/GuideDrawer
precedent) showing a thumbnail grid — each thumbnail is a tiny inline
`<svg>` rendering the ornament's paths, so no rasterization. Two actions
per ornament:

- **Fill with text** — builds a Shape Fill block via the existing creation
  path, synthesizing the same `{ pathData, w, h }` shape `extractSvgPaths`
  returns. Do not fork the block-creation logic; call the same handler the
  SVG-upload flow uses.
- **Insert as frame** — builds an `ImageBlock` from a data-URL SVG
  (serialize the paths into a standalone `<svg>`, `btoa` it). ImageBlock
  already renders data-URL images; a frame is a decoration, not a text
  container, so no new block type. Fill colour is baked at insert time from
  a small colour swatch in the dialog (the SVG is rasterized on load, so
  recolouring after insert is out of scope — say so in the guide page).

### App + Sidebar (anchors)

One handler in `App.tsx` (STREAM-C anchor) for each insert action, both
delegating to existing creation paths. Sidebar: a "Shapes & frames…"
button in the Shape Fill type panel's creation row and in the Add-block
row (STREAM-C anchor). Dialog styles in the `STREAM-C` block of
`index.css`.

## Testing

Unit: registry loads all modules; every ornament survives
`pathToPolygon`; data-URL serialization round-trips through `atob`.
E2E (`e2e/ornaments.spec.ts`): open picker → thumbnails render; "Fill with
text" on the medallion → Shape Fill block appears with tiled ink; "Insert
as frame" → image block appears.

## Out of scope

User-importable ornament packs; editable/recolourable vector frames (would
need a real vector-shape block type — future spec); tazhib illumination
patterns beyond the geometric initial set.
