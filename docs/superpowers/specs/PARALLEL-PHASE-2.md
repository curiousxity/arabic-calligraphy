# Phase 2 parallel contract — read this before your spec

Three features built simultaneously in three git worktrees off `main`
(which now contains Phases 0 and 1). Same single rule as
`PARALLEL-PHASE-1.md`: **touch only what your ownership table lists**; an
edit you need outside it is a spec bug to report, not resolve.

| Stream | Feature | Branch | Spec |
|---|---|---|---|
| E | Saveable styles & palettes | `stream/e-styles-palettes` | `2026-08-14-stream-e-styles-palettes.md` |
| F | Ink & surface | `stream/f-ink-surface` | `2026-08-14-stream-f-ink-surface.md` |
| G | User font upload | `stream/g-font-upload` | `2026-08-14-stream-g-font-upload.md` |

Merge order: **F → G → E.**

## Exclusively owned

| Path | Owner |
|---|---|
| `src/lib/textStyles.ts`, `src/lib/textStyles.test.ts` | E |
| `src/lib/palettes.ts`, `src/lib/palettes.test.ts` | E |
| `src/components/PaletteSwatches.tsx` | E |
| `src/lib/blockFill.ts`, `src/lib/blockFill.test.ts` | F |
| `src/data/textures/**` | F |
| `src/lib/customFonts.ts`, `src/lib/customFonts.test.ts` | G |
| `src/components/FontUploadDialog.tsx` | G |
| `e2e/styles.spec.ts` | E |
| `e2e/ink-surface.spec.ts` | F |
| `e2e/font-upload.spec.ts` | G |
| `src/components/guide/sections/styles.tsx` | E |
| `src/components/guide/sections/ink-surface.tsx` | F |
| `src/components/guide/sections/custom-fonts.tsx` | G |

## Shared, with per-stream anchors (landed by the prep commit)

| File | E | F | G |
|---|---|---|---|
| `src/App.tsx` | styles/palette state | fill + page-surface state | custom-font registry wiring |
| `src/components/Sidebar.tsx` | Typography → Styles row | Effects → Fill section; Artboard → Surface row | font picker + Upload… entry |
| `src/types.ts` | — | `BlockFill` + block field | — |
| `src/components/ShapedText.tsx` | — | **F only** (fill resolution in draw) | — |
| `src/components/ShapeFillText.tsx` | — | **F only** | — |
| `src/components/TextOnPathText.tsx` | — | **F only** | — |
| `src/hooks/useShapedGlyphs.ts` | — | — | **G only** (`resolveFontUrl` seam) |
| `src/index.css` | — | — | `STREAM-G` block |
| `CLAUDE.md` / `PROGRESS.md` | own anchor | own anchor | own anchor |

The three renderers belong to F alone this phase; the font-URL seam to G
alone. E stays out of both — a style *apply* is a normal
`updateSelectedBlock` patch and needs no renderer change. Full verification
loop plus your own e2e file before reporting done.
