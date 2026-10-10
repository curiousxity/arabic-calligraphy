---
paths:
  - "src/lib/glyphAlternates*.ts"
  - "src/lib/fontFeatureNames*.ts"
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
- **Overlay** mounts first in `ShapedText` (letter-sized rects below the
  stroke rail and mark handles); hover handlers on the `Group`.
- **Interactions:** a shape change drops stroke cuts on that letter
  (their `glyphId` checksum), which is correct. A ligature-forming
  alternate can shift diacritic-override indices after it; those are
  re-validated and drop.
- **Scope:** text blocks only (`supportsGlyphAlternates`). Shape Fill and
  text-on-path are deferred; the practice sheet and name designs ignore
  alternates.
