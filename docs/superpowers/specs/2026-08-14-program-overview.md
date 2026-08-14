# Program overview — the 2026-08-14 batch

Nine workstreams across three phases: remove the Morph Glyph Editor
subsystem, then build the artboard, Muthanna/radial composition, an
ornament library, tatweel-based kashida, saveable styles, ink & surface,
and user font upload — with Playwright e2e coverage underneath all of it.

This document is the map: what runs when, in what order things merge, and
what each terminal types. Each stream has its own spec (listed below) and
each parallel phase has a `PARALLEL-PHASE-N.md` ownership contract modeled
on the 2026-08-12 run's `PARALLEL.md`.

## Phases

### Phase 0 — clear the ground

| Stream | Feature | Branch | Spec |
|---|---|---|---|
| R | Remove the Morph subsystem | `stream/r-remove-morph` | `2026-08-14-stream-r-remove-morph.md` |
| P | Playwright e2e infrastructure | `stream/p-playwright` | `2026-08-14-stream-p-playwright.md` |

R and P may run in parallel (P touches only `package.json`, its own config,
and a new `e2e/` directory). **Merge order: R first, then P** — P rebases
onto the post-removal `main` and confirms its tests still describe features
that exist.

R runs *alone* against the app source. No Phase 1 stream may start until R
is merged: R deletes large regions of `App.tsx`, `Sidebar.tsx`,
`ShapedText.tsx`, and `ShapeFillText.tsx`, and anything running beside it
inherits unresolvable conflicts.

### Phase 1 — four parallel streams (after Phase 0 merges + prep commit)

| Stream | Feature | Branch | Spec |
|---|---|---|---|
| A | Artboard | `stream/a-artboard` | `2026-08-14-stream-a-artboard.md` |
| B | Muthanna & radial composition | `stream/b-muthanna-radial` | `2026-08-14-stream-b-muthanna-radial.md` |
| C | Ornament & frame library | `stream/c-ornament-library` | `2026-08-14-stream-c-ornament-library.md` |
| D | Tatweel kashida | `stream/d-tatweel-kashida` | `2026-08-14-stream-d-tatweel-kashida.md` |

Contract: `PARALLEL-PHASE-1.md`. **Merge order: A → B → D → C** (heaviest
`CanvasStage`/export surface first; C is data + one Sidebar panel and merges
last trivially).

### Phase 2 — three parallel streams (after Phase 1 merges + prep commit)

| Stream | Feature | Branch | Spec |
|---|---|---|---|
| E | Saveable styles & palettes | `stream/e-styles-palettes` | `2026-08-14-stream-e-styles-palettes.md` |
| F | Ink & surface | `stream/f-ink-surface` | `2026-08-14-stream-f-ink-surface.md` |
| G | User font upload | `stream/g-font-upload` | `2026-08-14-stream-g-font-upload.md` |

Contract: `PARALLEL-PHASE-2.md`. **Merge order: F → G → E.**

F depends on A's artboard for page backgrounds (its block-fill work is
independent); G depends on R having removed the per-font nuqta requirement.
Both dependencies are satisfied by phase ordering.

## Rules that apply to every stream

1. **Read your phase's `PARALLEL-*.md` contract first, then your spec.**
   Touch only files your ownership table lists. A needed edit outside your
   list is a spec bug — stop, finish the rest, and report it.
2. **Verification loop:** typecheck → lint → tests → build, in that order,
   before claiming done. (`npx tsc --noEmit -p tsconfig.app.json`,
   `npm run lint`, `npm test`, `npm run build`.)
3. **From Phase 1 on, every stream owes at least one Playwright e2e test**
   in its own `e2e/<stream>.spec.ts` file (Phase 0's P stream builds the
   harness). e2e files are exclusively owned per stream, so they never
   conflict.
4. **Docs:** each stream updates `CLAUDE.md` (its own anchor region),
   `PROGRESS.md` (one entry), and — where user-facing — adds or edits its
   own guide section under `src/components/guide/sections/`.
5. Follow the repo-wide conventions in `CLAUDE.md` (version bump hook,
   real-font test policy, `min-width: 0` in sidebar rows, etc.).

## What the human types

Phase 0, terminal 1 (this repo, on `main`):

```
claude
> Read docs/superpowers/specs/2026-08-14-program-overview.md, then implement
  docs/superpowers/specs/2026-08-14-stream-r-remove-morph.md on branch
  stream/r-remove-morph.
```

Phase 0, terminal 2:

```
git -C /Users/mopro/Desktop/arabic-calligraphy worktree add -b stream/p-playwright ../arabic-calligraphy-p-playwright HEAD
cd /Users/mopro/Desktop/arabic-calligraphy-p-playwright && npm install && claude
> Read docs/superpowers/specs/2026-08-14-program-overview.md, then implement
  docs/superpowers/specs/2026-08-14-stream-p-playwright.md.
```

When both report done: return to the orchestrating session and say
**"merge phase 0 and prep phase 1"**. The orchestrator merges R then P,
lands the Phase 1 anchor prep commit (the `STREAM-A/B/C/D` anchor comments
listed in `PARALLEL-PHASE-1.md`), and prints the four Phase 1 worktree
commands — same shape as terminal 2 above, one per stream, each reading the
Phase 1 contract plus its own spec.

Same again at the Phase 1 → Phase 2 boundary: **"merge phase 1 and prep
phase 2"**.

`scripts/setupParallel.sh` from the 2026-08-12 run can be reused by editing
its `streams=()` array, or the worktree commands can be run by hand; the
orchestrator prints them either way.
