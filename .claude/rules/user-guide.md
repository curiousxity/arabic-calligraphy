---
paths:
  - "src/components/guide/**"
---

# In-app user guide (`src/components/guide/`)

A "?" button at the top-left of the sidebar header opens a right-side
slide-over drawer of searchable help pages. No router, no markdown
renderer, no new dependency — pages are plain TSX components, which is the
whole reason for the format: they can use the app's own CSS custom
properties and stay in the repo beside the code they describe.

- `types.ts` declares `GuideSection` (`id`/`title`/`order`/`keywords`/`Body`).
  `registry.ts` auto-loads every `./sections/*.tsx` via `import.meta.glob`
  and sorts by `order` then `title`. **Dropping a file in `sections/` is the
  entire integration step** — there is no index to edit, so nothing ever has
  to be registered. Don't replace the glob with an explicit list.
- `registry.ts` also exports `filterGuideSections(sections, query)`, matching
  case-insensitively against `title` *and* `keywords`. `keywords` exists
  precisely so a user typing "tashkeel" finds a page titled "Type and text";
  when adding a section, list the words a calligrapher would type, not the
  words in the heading.
- `GuideLauncher.tsx` is the button plus the drawer, mounted as a single
  element from `Sidebar.tsx`'s header panel. Open/closed state is local to
  that component **by design** — reading the guide is not an edit, so it must
  never reach `App.tsx`'s state, the undo stack, or the saved-layout payload.
- `GuideDrawer.tsx` portals to `document.body` (the sidebar is an
  overflow-hidden scrolling column that would clip a slide-over). It is deliberately mounted from
  `Sidebar.tsx` and **not** from `CanvasStage.tsx`: anything inside the Konva
  stage risks being baked into an export.
- The active section is *derived* (`filtered.find(id) ?? filtered[0]`) rather
  than stored, so narrowing the filter past the current selection can't leave
  the body pane showing a page that is no longer in the list.
- Focus moves to the search field on open and is restored on unmount to
  whatever was focused before (the "?" button). The drawer captures
  `document.activeElement` at mount instead of taking a ref, which keeps it
  independent of where it is mounted from.
- `sections/*.tsx` are written for calligraphers: no file paths, no type
  names, no architecture. `order` values leave gaps (10, 20, 30, 50, 70, 90,
  100) for feature pages added later.
