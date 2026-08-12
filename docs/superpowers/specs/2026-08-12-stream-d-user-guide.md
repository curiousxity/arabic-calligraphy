# Stream D — In-app user guide

**Read `PARALLEL.md` first.** Branch: `stream/d-user-guide`.

## Goal

A user guide reachable from inside the app: a "?" button in the sidebar header
opens a slide-over drawer with searchable sections explaining how to use
HarfCanvas. No router, no new dependencies, works offline, ships with the code
so it cannot drift from it.

## What the prep commit already gave you

`src/components/guide/types.ts` and `src/components/guide/registry.ts` exist
on `main` before you branch:

```ts
export type GuideSection = {
  id: string;
  title: string;
  order: number;
  keywords: string[];
  Body: React.ComponentType;
};
```

`registry.ts` auto-loads every `./sections/*.tsx` via `import.meta.glob`, the
same pattern `src/lib/strokeSchema/registry.ts` uses for stroke schemas, and
returns them sorted by `order`. **Do not change that contract** — streams A, B,
and C are each dropping a section file into that folder right now, and the glob
is what lets them do it without touching a shared index.

Their three files (`smart-guides.tsx`, `auto-justify.tsx`, `export.tsx`) will
not exist in your worktree. That is expected; the drawer must render correctly
with whatever sections happen to be present, and must not hardcode a list.

## Design

### `src/components/guide/GuideDrawer.tsx`

A right-side slide-over above the canvas:

- Section list down the left of the drawer, body on the right; on narrow
  viewports collapse to a single scrolling column with the list on top. This
  app already has an `isMobile` path in `App.tsx`; match its breakpoint rather
  than inventing one.
- A text filter over `title` + `keywords`, matching case-insensitively. This is
  what `keywords` is for — a user looking for "tashkeel" should find the
  diacritics section even though the title says "marks".
- Esc closes. Clicking the backdrop closes. Focus moves into the drawer on
  open and returns to the "?" button on close.
- Mount it in `Sidebar.tsx` next to the header button, not in `CanvasStage` —
  it must never become part of the Konva stage, or it will end up in exports.

Open/closed state is local to the drawer's owner component; it does not belong
in `App.tsx`'s state and must not enter undo history or the saved-layout
payload.

### Sections you author

Everything except the three feature sections A, B, and C are writing. Suggested
ids and `order` values, leaving gaps at 40/60/80 for the other streams:

| order | id | Covers |
|---|---|---|
| 10 | `getting-started` | The artboard, adding your first text block, pan and zoom (plain wheel pans, ctrl/⌘+wheel or trackpad pinch zooms) |
| 20 | `blocks` | The five block types — text, Shape Fill, Shape Warp, Curve, Image — what each is for, and how to pick between Shape Fill and Shape Warp |
| 30 | `typography` | Fonts, size, colour, alignment, line height, and the Content panel's Arabic keyboard and preset rows |
| 50 | `layers` | Layers, grouping, locking, multi-select, align and arrange |
| 70 | `glyph-editing` | The Morph Glyph Editor: stretch handles, per-glyph move and scale, diacritic handles |
| 90 | `projects` | Save/load, named projects, local vs cloud, autosave, undo and the history thumbnails |
| 100 | `shortcuts` | Keyboard shortcuts, mirroring the existing Shortcuts panel |

Read the relevant source before writing each one — `CLAUDE.md` describes the
architecture accurately and is the fastest way in, but check the actual
components for what the UI literally says, so the guide names controls the way
the sidebar does.

**Write for a calligrapher, not a programmer.** No file paths, no type names,
no architecture. Say what a control does, where it is, and what surprises
people about it. The genuinely non-obvious things worth calling out:

- Shape Fill *tiles* text to fill a silhouette; Shape Warp draws it *once* and
  bends it into the shape. Users conflate these constantly.
- "Clear diacritics" deletes characters permanently; the per-mark hover handles
  only change how a mark is drawn and can be reset.
- On a Shape Fill block, one diacritic adjustment applies to every tiled
  repetition, because the adjustment is keyed to the glyph, not the copy.
- Text on a curve always scales to span the curve, so the font-size slider is
  hidden for those blocks — curve length is the size control.
- Editing text before a glyph you have hand-adjusted can move that adjustment
  onto a neighbouring letter. Finalise wording, then fine-tune.
- History and undo are session-only; they are not saved with a project.

### Styling

Append to `src/index.css` **only between the `STREAM-D` anchors**. Use the
existing CSS custom properties so the drawer themes correctly — navy+gold is
the unconditional `:root` default, with an ivory palette under
`@media (prefers-color-scheme: light)`, which is inverted from the usual
convention, so check that file's structure before assuming which block is the
default. Test both.

Watch the documented layout footgun: grid and flex children default to
`min-width: auto` and will overflow rather than shrink. Give the drawer's
list/body split explicit `min-width: 0`.

## Constraints

- **No new dependencies.** No markdown renderer, no router, no headless-UI
  library. Sections are TSX components; that is the whole reason for the
  format.
- Do not touch `App.tsx`, `CanvasStage.tsx`, or any renderer.
- Do not hardcode the section list or import section files directly.
- Do not add analytics, external links to docs sites, or a "what's new" feed.

## Tests

A small test that the registry sorts by `order` and that filtering matches on
both title and keywords. The drawer's rendering is not worth a jsdom test
harness; verify it by hand.

## Done when

The four verification commands pass, and by hand: the "?" opens the drawer,
every section renders, the filter narrows the list, Esc closes it, focus
returns to the button, both colour themes look right, and the drawer never
appears in an exported PNG.
