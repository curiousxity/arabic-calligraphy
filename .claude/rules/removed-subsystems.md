---
paths:
  - "docs/archive/**"
  - "scripts/*.py"
  - "src/lib/dragAxis*.ts"
---

# Removed subsystems — the Morph Glyph Editor and everything under it

Removed wholesale on **2026-08-14**. What went: the Morph Glyph Editor panel
and its Stretch tool, the stroke schemas (`src/lib/strokeSchema/`, 105 JSONs),
the per-font stroke spines (`src/lib/strokeSpines/`, 30 tables), glyph rigs,
join pins, the per-font nuqta table and nuqta snapping, the block-level Kashida
dial, the tatweel-gap Kashida tool, Fit width / auto-justify
(`src/lib/justify.ts`), and By-stroke/Lasso mask editing
(`src/lib/glyphContours.ts`).

**Why.** The stack's core promise — strokes that extend — was measured inert.
The kashida dial did not widen a run at all (the rendered extent was unchanged
across the dial's whole travel, so Fit width could never fit); taking a letter
as a given font actually draws it, only ~14% of authored stretch zones had a
verified spine and therefore a handle; and the strokes that did move deformed
rather than extended. The user chose removal over continued repair. Phase 1's
tatweel stream replaces the elongation story with one that works.

**Where it lives if it is ever wanted back.** `docs/archive/nuqta-measurements.md`
carries the expensive, human-verified part — the per-font nuqta table, measured
two independent ways — plus the pre-removal SHA
(`fbe942cadec8c82596948309248a99a1fbb21f90`) that every deleted file can be
recovered from. The offline Python tooling (`scripts/measureNuqta.py`,
`deriveStrokeSpines.py`, `auditSpineOrientation.py`) is deliberately **kept**:
scripts are inert, and they are the other half of "don't redo the work." Read
that archive file before resurrecting anything from git history, exactly as the
`shapeWarp` note in CLAUDE.md asks.

**What survived, and why it is where it is:**

- **Per-glyph move, scale & rotate** (`lib/glyphTransform.ts`,
  `GlyphTransformHoverHandles.tsx`) — [glyph-transform.md](glyph-transform.md). Its arming
  checkbox used to live in the Morph panel and now sits in Sidebar →
  Typography, plain-text-only, matching the arming rule it always had.
- **Diacritic overrides** — untouched, including the Shape Fill "Diacritic
  tool" checkbox.
- **`projectOntoAxis`** — was `lib/strokeSchema/dragAxis.ts`, now
  `src/lib/dragAxis.ts`, because the two surviving hover-handle overlays use it
  as their Konva `dragBoundFunc` rail. Its siblings `dotPositionForFactor` and
  `factorForPosition` went with the stretch tool.
- **`lib/arabicJoining.ts`** — deliberately kept **consumer-less**. Its only
  caller was the deleted `strokeSchema/glyphLookup.ts`; the tatweel stream
  needs it next. Don't delete it as dead code.

**Old saves.** `App.tsx`'s `stripMorphFields` deletes `glyphEdits`,
`glyphRigValues`, `glyphMaskEdit`, `glyphEditTool`, `selectedGlyphIndex`,
`kashidaAmount` and `kashidaEditMode` off every block in
`applyParsedLayoutPayload` — same mechanism and same reasoning as the
`shapeWarp` filter beside it. A project saved before the removal loads with
those edits dropped rather than half-rendered. The layout payload's `version`
moved 4 → 5 and no longer embeds `glyphRigs`. The `harfcanvas-glyph-rigs-v1`
localStorage key is simply orphaned; nothing reads or clears it.
