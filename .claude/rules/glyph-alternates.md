---
paths:
  - "src/lib/glyphAlternates*.ts"
  - "src/lib/fontFeatureNames*.ts"
  - "src/lib/alternateTargets*.ts"
  - "src/hooks/useGlyphAlternates.ts"
  - "src/components/AlternateHoverHandles.tsx"
  - "src/components/sidebar/AlternateStrip.tsx"
  - "e2e/glyph-alternates.spec.ts"
---

# Next Shape — per-letter alternate glyphs

Click a letter on a text block to step through the alternate shapes its
OpenType font already contains (Kelk's "Next Shape", on OpenType instead of
a proprietary variant library). Spec:
`docs/superpowers/specs/2026-10-10-next-shape-design.md`.

- **Keyed by letter ordinal, not text offset.** `GlyphAlternate.letter`
  counts characters skipping tatweel and combining marks
  (`letterOffsets`). Kashida and Fit to width only insert tatweel and
  shaping only strips marks, so **nothing remaps alternates** —
  `kashidaTextPatch` deliberately does not touch them. `char` is a
  checksum: a typed edit that shifts a letter drops its alternate rather
  than moving it onto another character.
- **Shaping:** `featureStringFor` turns the list into ranged HarfBuzz
  features (`ss01[5:6]=1`) against the *shapable* text. Tags are validated
  (`isOptionalFeature`) before splicing, so a hand-edited save cannot
  inject into the feature string. The shape cache is per font
  (`fontUrl → text|alternatesKey`), which is what lets
  `clearShapeCache(fontUrl)` still drop exactly one font.
- **Discovery** is `probeAlternates` (pure, shaping injected so Vitest
  can run it on real harfbuzzjs): per letter, reshape once per optional
  tag (values 1–4 for `salt`/`aalt`/`jalt`/`swsh`), keep results whose
  cluster glyphs differ, de-duplicate. Capped at `MAX_PROBE_LETTERS`.
  Runs only while the tool is armed (`useGlyphAlternates`, called once in
  App for the selected block).
- **Names** come from the font's own FeatureParams via
  `readFeatureNames` — opentype.js does not resolve them.
- **Overlay is pointer-resolved** (`AlternateHoverHandles` over
  `lib/alternateTargets.ts`). One transparent listening `Rect` spans every
  target, and the letter under the pointer is found by `hitTestTargets`
  (box pre-check, then ray cast; the **last** match wins, which is paint
  order). It is **not** one Konva node per letter: a Shape Fill silhouette
  tiles ~23,000 letters, and that many listening nodes froze the tab when
  the removed glyph-transform overlay tried it. Two nodes, whatever the
  count; `e2e` asserts `alternate-hit` is exactly one on a Shape Fill.
  - **Targets are group-space polygons**, built by each renderer from
    geometry it already has.
    - **Text:** the per-letter union of hit boxes, offset by
      `bx + localDrawX`.
    - **Shape Fill:** every tiled instance, through
      `makeShapeFillInstanceAdapter`, so rotation, row fit and
      `shapeScale` hold. The tiling walk runs while the diacritic tool or
      Next Shape is armed.
    - **Curve:** each letter's widest glyph through `curveGlyphPlacements`
      / `curvePlacementToGroup`, the same placement the draw loop uses, so
      the outline tilts with the letter.
  - **Only a press on a target belongs to the tool.** It cancels bubbling,
    so a drifting click never starts a block drag, and a press in a gap
    bubbles, so the block still drags. The pick happens on **release**
    within `CLICK_SLOP`, for the *pressed* letter. Konva's `click` does not
    fire once the pointer has moved, and neighbours overlap.
  - **A `dblclick` is swallowed if either press hit a letter within
    `DOUBLE_CLICK_WINDOW_MS`.** The first click changes the shape and moves
    the outline, so the second press often lands in a gap. Without this,
    the block's edit handler would focus the textarea with the whole text
    selected.
  - **Tests** address targets through a non-listening marker
    (`.alternate-targets`, attr `centers`, capped at 500), read by
    `e2e/harf.ts`'s `alternateTargetCenters`.
- **Sidebar view** is `alternatePanelView` (pure). A strip it can already
  draw wins over "loading", or the strip blinks out on every pick. The
  strip's letter goes through `resolveAlternateTarget`, which drops it once a
  text edit puts a different character at that ordinal.
- **Interactions:** a shape change drops stroke cuts on that letter
  (their `glyphId` checksum), which is correct. A ligature-forming
  alternate can shift diacritic-override indices after it; those are
  re-validated and drop.
- **Block-level style sets** (`styleSets: string[]`, `ss01`–`ss20` only,
  via `activeStyleSets`) apply a set to every letter. `featureStringFor`
  emits them **first**, then per letter: the block's sets switched back off
  on that letter's range (`ss01[5:6]=0`), then its own choice. HarfBuzz
  applies features in order (verified: the reverse order does not give the
  plain glyph back). So a hand-picked letter shows exactly what was picked,
  and the per-letter feature `"none"` (`NO_STYLE_SETS`, "Without style
  sets") exempts one letter and adds nothing. `probeAlternates` probes from
  the block's sets, with them off on the letter for every candidate.
  `probeStyleSets` lists only the sets that change this text; the sidebar
  keeps a set that is on listed even after the text stops using it, so it
  can always be unticked. Sets need no hit-testing, so they reach text,
  Shape Fill and Curve (`supportsStyleSets`).
- **Scope (per-letter tool):** text, Shape Fill (one pick applies to every
  tile, as diacritic overrides do) and Curve (`supportsGlyphAlternates`).
  Per-tile choices were offered and declined. The practice sheet and name
  designs ignore alternates.
