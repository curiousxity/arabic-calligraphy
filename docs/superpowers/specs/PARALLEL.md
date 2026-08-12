# Parallel streams contract — read this before your spec

Four features are being built simultaneously in four git worktrees off `main`,
by four independent Claude instances that cannot see each other's work. This
document is the contract that keeps them from colliding. Read it fully, then
read your own stream spec.

| Stream | Feature | Branch | Spec |
|---|---|---|---|
| A | Bounds-aware smart guides | `stream/a-smart-guides` | `2026-08-12-stream-a-smart-guides.md` |
| B | Kashida auto-justify | `stream/b-auto-justify` | `2026-08-12-stream-b-auto-justify.md` |
| C | Export upgrades | `stream/c-export` | `2026-08-12-stream-c-export.md` |
| D | In-app user guide | `stream/d-user-guide` | `2026-08-12-stream-d-user-guide.md` |

## The single rule

**Touch only the files your spec's ownership table lists.** If your work seems
to require editing a file you don't own, that is a spec bug, not a licence.
Stop, do the rest of the work, and report the conflict at the end instead of
resolving it yourself — the whole point of the split is that no two streams
ever edit the same region of the same file.

Refactoring outside your ownership list is forbidden even when it is obviously
correct. It will be a merge conflict, and it will be discarded.

## File ownership

### Exclusively owned (only one stream may create or edit each)

| Path | Owner |
|---|---|
| `src/lib/snapping.ts`, `src/lib/snapping.test.ts` | A |
| `src/lib/justify.ts`, `src/lib/justify.test.ts` | B |
| `src/lib/exportPresets.ts`, `src/lib/exportPresets.test.ts` | C |
| `src/hooks/useExport.ts` | C |
| `src/components/guide/**` *except* `sections/` | D |
| `src/components/guide/sections/smart-guides.tsx` | A |
| `src/components/guide/sections/auto-justify.tsx` | B |
| `src/components/guide/sections/export.tsx` | C |
| `src/components/guide/sections/*.tsx` (all others) | D |

### Shared, with per-stream anchors

These four files are edited by more than one stream. Each carries anchor
comments landed in the prep commit. **Insert only between your own anchors.**
Git merges non-overlapping hunks in the same file cleanly; overlapping ones do
not merge, and the streams' regions were chosen to sit far apart.

| File | A | B | C | D |
|---|---|---|---|---|
| `src/App.tsx` | `STREAM-A` anchors | `STREAM-B` | `STREAM-C` | `STREAM-D` (prop bundle only) |
| `src/components/Sidebar.tsx` | Background & Grid panel | Typography → Kashida | Project & Export | header button |
| `src/components/CanvasStage.tsx` | **A only** | — | — | — |
| `src/index.css` | `STREAM-A` block | — | — | `STREAM-D` block |
| `CLAUDE.md` | after "Canvas pan and zoom" | after "Stroke-schema-driven glyph editor" | after "Export" | after "Sidebar structure" |

Anchors look like this, and every one of them is already in place on `main`:

```ts
// ---- STREAM-A: smart guides — state ----
// ---- /STREAM-A ----
```

`src/App.tsx` gives each stream two regions — **state** (near the other
`useState` calls, around line 227) and **handlers** (just above the `return`,
because a handler in this file must be physically defined above its first
reference and everything it closes over is declared higher up).

**Getting props into `<Sidebar>` and `<CanvasStage>`.** Do *not* add attributes
to those JSX elements. Their prop lists are hundreds of adjacent one-line
attributes — precisely the shape that will not merge. Instead, each stream owns
a prop bundle declared in its handler region:

```ts
// ---- STREAM-A: smart guides — handlers ----
const streamASidebarProps: Partial<SidebarProps> = {};
const streamACanvasProps: Partial<CanvasStageProps> = {};
// ---- /STREAM-A ----
```

These are already spread into the JSX (`{...streamASidebarProps}`), so filling
one in is all that is needed — the JSX itself never changes. Declare the props
themselves between your anchors in `Sidebar.tsx`'s `SidebarProps` type and its
destructuring list, and mark them optional (`?`), so the component still
typechecks in a worktree where the other three streams' props do not exist.

If your insertion does not fit inside your anchors, put it in a file you own
and call it from between the anchors. A stream should be adding roughly
*calls*, not *logic*, to shared files.

### Forbidden to every stream

`src/types.ts`, `package.json` (except the automatic version bump), any file
under `public/fonts/`, `src/data/strokeSchemas/`, and every renderer
(`ShapedText.tsx`, `ShapeFillText.tsx`, `ShapeWarpText.tsx`, `TextOnPathText.tsx`,
`ImageBlockView.tsx`). All four features were scoped specifically so that none
of them needs to change a block type or a rendering engine. If yours seems to,
re-read your spec.

## The guide section contract

The prep commit adds `src/components/guide/types.ts` and
`src/components/guide/registry.ts`. The registry auto-loads every file matching
`./sections/*.tsx` via `import.meta.glob`, exactly as
`src/lib/strokeSchema/registry.ts` already does for stroke schemas. **Dropping
a file in that folder is the entire integration step** — there is no index to
edit, so no stream ever conflicts with another over registration.

Every stream authors exactly one section file documenting its own feature:

```tsx
// src/components/guide/sections/smart-guides.tsx
import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "smart-guides",
  title: "Aligning blocks",
  order: 40,
  keywords: ["snap", "align", "guide", "edge", "distribute"],
  Body: () => (
    <>
      <p>…</p>
    </>
  ),
};
```

Write it for a calligrapher, not a programmer: what the feature does, how to
reach it, and what the non-obvious behaviour is. No file paths, no type names,
no mention of streams or specs. Use the `order` value your spec assigns you so
the drawer's section list stays in a sensible sequence. Stream D owns the
drawer that renders these; if D has not merged yet, your section file simply
sits unused, which is fine and expected — it must still typecheck.

## Verification, identical for all four streams

Before your final commit, in this order:

```bash
npx tsc --noEmit -p tsconfig.app.json
npm run lint
npm test
npm run build
```

All four must pass. Do not report the work complete on a partial pass; paste
the failing output instead. New pure logic must land with a `*.test.ts` beside
it — every lib module in this project that carries real math has one, and the
two features with solver/geometry math (A and B) are exactly the kind that fail
silently without tests.

## Committing

Commit to your own branch in small, reviewable commits. Do **not** merge to
`main`, do not rebase onto other streams, and do not `git pull`. Expect
`package.json` and `package-lock.json` in every diff — a pre-commit hook bumps
the patch version on every commit and that is the mechanism working, documented
in `CLAUDE.md`.

## Merge protocol (run by the integrating session, not by streams)

Merge order is **A → C → B → D**:

- A and C are structurally independent and touch different shared regions.
- B merges third so its solver runs against a settled tree; it is the stream
  most likely to need a mid-flight correction.
- D merges last so the drawer ships with all three feature sections already
  present in `sections/`.

Every merge will conflict on `package.json` and `package-lock.json` because
both branches bumped the version. The resolution is always the same — take the
higher version and regenerate the lockfile:

```bash
git checkout --ours package.json          # main's version wins
npm install --package-lock-only            # rewrite the lockfile to match
git add package.json package-lock.json
```

Do not hand-edit `package-lock.json`. The version-bump hook deliberately skips
merges (it checks for `MERGE_HEAD`), so the merge commit itself will not bump
again.

After all four merges, run the four verification commands once more on `main`,
then start the dev server and confirm by hand: a drag snapping to another
block's edge, a kashida fit, a clipboard copy, and the guide drawer listing
seven or more sections including all three feature sections.
