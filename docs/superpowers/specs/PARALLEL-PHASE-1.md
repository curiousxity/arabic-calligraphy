# Phase 1 parallel contract — read this before your spec

Four features built simultaneously in four git worktrees off `main` (which
already contains Phase 0: the Morph subsystem removal and the Playwright
harness), by four independent instances that cannot see each other's work.
Same contract as the 2026-08-12 run's `PARALLEL.md`; the single rule is
unchanged:

**Touch only the files your spec's ownership table lists.** A needed edit
outside your list is a spec bug, not a licence. Stop, do the rest, report
the conflict at the end. Refactoring outside your list is forbidden even
when obviously correct.

| Stream | Feature | Branch | Spec |
|---|---|---|---|
| A | Artboard | `stream/a-artboard` | `2026-08-14-stream-a-artboard.md` |
| B | Muthanna & radial | `stream/b-muthanna-radial` | `2026-08-14-stream-b-muthanna-radial.md` |
| C | Ornament & frame library | `stream/c-ornament-library` | `2026-08-14-stream-c-ornament-library.md` |
| D | Tatweel kashida | `stream/d-tatweel-kashida` | `2026-08-14-stream-d-tatweel-kashida.md` |

Merge order: **A → B → D → C.**

## Exclusively owned (only one stream may create or edit each)

| Path | Owner |
|---|---|
| `src/lib/artboard.ts`, `src/lib/artboard.test.ts` | A |
| `src/hooks/useExport.ts` | A |
| `src/lib/mirror.ts`, `src/lib/mirror.test.ts` | B |
| `src/components/MirrorBlockView.tsx` | B |
| `src/lib/ornaments.ts`, `src/lib/ornaments.test.ts` | C |
| `src/data/ornaments/**` | C |
| `src/components/OrnamentPicker.tsx` | C |
| `src/lib/tatweel.ts`, `src/lib/tatweel.test.ts` | D |
| `e2e/artboard.spec.ts` | A |
| `e2e/mirror.spec.ts` | B |
| `e2e/ornaments.spec.ts` | C |
| `e2e/tatweel.spec.ts` | D |
| `src/components/guide/sections/artboard.tsx` | A |
| `src/components/guide/sections/muthanna.tsx` | B |
| `src/components/guide/sections/ornaments.tsx` | C |
| `src/components/guide/sections/kashida.tsx` | D |

## Shared, with per-stream anchors

Anchor comments (`// ---- STREAM-A: … ----`) are landed by the prep commit
before worktrees are created. **Insert only between your own anchors.**

| File | A | B | C | D |
|---|---|---|---|---|
| `src/App.tsx` | artboard state + handlers | mirror handlers | insert-ornament handler | tatweel handlers |
| `src/components/Sidebar.tsx` | new Artboard panel (replaces part of Background & Grid) | Mirror type panel + Add menu entry | Shape Fill panel button + Add menu entry | Typography → Kashida section |
| `src/components/CanvasStage.tsx` | page rect, margins, snap targets (bulk owner) | one render case in the block map | — | — |
| `src/types.ts` | `ArtboardConfig` + save payload field | `MirrorBlock` variant | — | — |
| `src/index.css` | `STREAM-A` block | — | `STREAM-C` block (picker dialog) | — |
| `CLAUDE.md` | own anchor | own anchor | own anchor | own anchor |
| `PROGRESS.md` | own anchor | own anchor | own anchor | own anchor |

Anything not listed in either table is off-limits to everyone (the
orchestrator resolves stragglers at merge). Every stream: full verification
loop (tsc → lint → test → build) plus `npm run e2e` for your own spec file
before reporting done.

## Anchor mechanics (landed by the prep commit — all on `main` now)

Anchors are paired comments; insert only between your own pair:

```ts
// ---- STREAM-A: artboard — state ----
// ---- /STREAM-A ----
```

- **App.tsx** gives each stream four regions: imports (end of the import
  block), state, payload (A: build + read; B: sanitation via the
  `blocksToLoad` local in `applyParsedLayoutPayload`), and handlers. The
  handlers region pre-creates your prop bundles — `p1aSidebarProps`/
  `p1aCanvasProps`, `p1bSidebarProps`/`p1bCanvasProps`, `p1cSidebarProps`,
  `p1dSidebarProps` — already spread into `<Sidebar>`/`<CanvasStage>`. Fill
  your bundle; never edit the shared JSX prop lists. (Ignore the merged
  2026-08-12 `stream*Props` bundles — they are finished features.)
- **Sidebar.tsx** gives each stream a props-type region, a destructure
  region, and its JSX region(s): A before Background & Grid; B in the
  add-block row and before the Shape Fill type panel; C in the add-block row
  and inside the Shape Fill panel; D at the top of Typography's panel. All
  stream props must be optional (they arrive via `Partial<SidebarProps>`).
- **CanvasStage.tsx** is stream A's file except the three `STREAM-B` regions
  (props, destructure, render case).
- **types.ts**: stream B's region sits above the `Block` union; B alone may
  also edit the `BlockType` and `Block` union lines directly this phase.
- **CLAUDE.md** and **PROGRESS.md** have one labeled region per stream.

The retired 2026-08-12 anchors were removed in the same prep commit — the
old run's `PARALLEL.md` and its specs describe finished work, not yours.
