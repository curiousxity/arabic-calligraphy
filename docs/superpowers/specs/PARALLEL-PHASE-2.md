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

## Anchor mechanics (landed by the prep commit — all on `main` now)

Same paired-comment convention as Phase 1; insert only between your own
`STREAM-E` / `STREAM-F` / `STREAM-G` pair. The Phase 1 anchors were retired
after that merge — informational comments naming other streams are history,
not licences.

- **App.tsx** regions per stream: imports, state, handlers (with pre-created
  prop bundles `p2eSidebarProps`, `p2fSidebarProps` + `p2fCanvasProps`,
  `p2gSidebarProps`, already spread at the call sites); F additionally gets
  payload-build and payload-read regions for persisting the page surface.
  Fill your bundle; never edit the shared JSX prop lists.
- **The page-surface seam already exists** — F does **not** touch
  `CanvasStage.tsx`: the prep commit added `surfaceRectProps?: Konva.RectConfig`,
  spread last into the `#artboard-background` rect. Put the texture/tint
  fill props into `p2fCanvasProps.surfaceRectProps` and they land on the
  page rect (they override its `fill`).
- **Sidebar.tsx**: per-stream import, props-type and destructure regions,
  plus JSX regions — E at the top of Typography's panel; F at the top of
  Effects' panel and at the end of the Artboard panel (Surface row); G
  beside the font picker in Typography. All stream props must be optional
  (they arrive via `Partial<SidebarProps>`).
- **types.ts**: F has a region above `BlockCommon` for `BlockFill` and one
  inside `BlockCommon` for the optional `fill` field.
- **index.css**: `STREAM-G` block at the end. **CLAUDE.md** and
  **PROGRESS.md**: one labeled region per stream.
- Commit your work on your branch when done — Phase 1's streams left
  everything uncommitted and the orchestrator had to commit for them.
