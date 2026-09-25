---
paths:
  - "e2e/**"
  - "playwright.config.ts"
  - "src/lib/testBridge.ts"
---

# End-to-end tests (`e2e/`, `playwright.config.ts`, `src/lib/testBridge.ts`)

`npm run e2e` runs the browser suite; `npm run e2e:ui` opens Playwright's
interactive runner. Chromium only. The config's `webServer` starts
`npm run dev` on port 5173 with `--strictPort` (and reuses a server already
listening there), so a clean checkout needs nothing but
`npx playwright install chromium`.

Two setup details that are easy to undo by accident:

- **Vitest and Playwright both claim `*.spec.ts`.** `vite.config.ts` carries
  a `test.exclude` listing `e2e/**` for exactly this reason. Keep e2e specs
  in `e2e/`, never under `src/`.
- **Playwright transpiles without typechecking**, so nothing in the normal
  loop would catch a type error in a spec. `e2e/tsconfig.json` exists for
  that: `npx tsc --noEmit -p e2e/tsconfig.json`. It is not wired into
  `tsconfig.json`'s project references because it needs the DOM lib that
  `tsconfig.node.json` deliberately omits.

**The bridge.** Konva draws everything into one `<canvas>`, so the DOM says
almost nothing about the artboard. `src/lib/testBridge.ts` publishes
`window.__HARF__ = { getBlocks, getSelectedIds, getStage }` in **dev builds
only** — `import.meta.env.DEV` is substituted with `false` in a production
build, so the assignment is unreachable and dropped (verified: no `__HARF__`
anywhere in `dist/`). `App.tsx` wires it in one `useEffect` keyed on
`[blocks, effectiveSelectedIds]`; re-installing on change is cheaper than
threading refs and keeps the closures fresh.

It is deliberately **read-only**. Tests drive the app the way a user does
and use the bridge only to check what happened; a setter here would let a
test pass while the interaction it claims to cover is broken. `getStage` is
what makes on-screen geometry reachable — `node.getClientRect()` already
folds in the stage's pan/zoom, so adding the container's own offset lands a
Konva node in the same page coordinates `page.mouse` speaks.

Appearance is asserted in **pixels, not through the bridge**: `e2e/harf.ts`'s
`inkPixels` reads `getImageData` off the live stage canvas and counts dark
pixels. Reading the live canvas rather than a screenshot keeps the
coordinate space identical to the mouse helpers' and needs no PNG decoder.
Keep such assertions coarse — "is there ink in this region" — never
exact-image, or font rasterisation differences across machines will flake.

**Trusted drags reach Konva's hover-mounted handles.** This was the open
question the harness was built to settle, and the answer is yes: both the
plain block drag and the diacritic move-handle drag pass. The older
conclusion that scripted drags "fall through to the block underneath" was an
artifact of extension-injected synthetic events; Playwright drives real CDP
input.

Two real defects sat behind that headline and `e2e/harf.ts` worked around
both. **Both are fixed** (see [diacritics.md](diacritics.md) for the fix),
and the workarounds went with them, as the note here always said they should.
They are recorded because the measurements are the reason the fix is shaped
the way it is:

- **A hover-mounted diacritic handle flickered off on alternate mouse
  moves.** The hover hit `Rect` and the handle `Circle` were siblings, so as
  soon as the mounted handle covered the pointer, the next mousemove
  retargeted hover to the `Circle` and fired `mouseleave` on the `Rect`,
  clearing `hoveredKey` and unmounting the handle. Measured: over eight
  0.5px moves across a mark, the handle was mounted on exactly every other
  one, and `stage.getIntersection` alternated `Circle` /
  `Rect.diacritic-hit` in lockstep. `armDiacriticMoveHandle` used to
  re-issue the same move until the pointer sat on a mounted handle; its
  remaining loop is only for *overlapping* hit rects, which is a separate
  and still-real thing.
- **A drag whose first step was small lost the handle mid-gesture.** Konva
  suppresses its enter/leave processing only once a drag's status reaches
  `dragging`, not while it is merely `ready` — so the first mousemove still
  retargeted hover, the overlay unmounted the node the drag was attached to,
  and the gesture died attached to an orphan. Measured at the app's default
  2.75x zoom: first steps of 2px and 10px lost it, 20px and 40px completed
  normally. `dragFromHere` was therefore pinned to a single jump; it now
  drags in 24 interpolated steps, which is both the honest gesture and the
  regression test. `draggingKey`, the sticky-hover flag meant to prevent
  this, could never do it: it is set in `onDragStart`, which runs *after*
  the `mouseleave` that has already unmounted the handle. It is kept as
  belt-and-braces for a handle dragged outside its own hit rect.

`shapeText` used to throw on empty text (`JSON.parse` of an empty shaping
result), logging a `console.error` whenever a user cleared the Content
textarea. It now returns the empty result before building any HarfBuzz
objects, so a "no console errors" assertion is no longer pinned to the boot
test — `core.spec.ts` asserts it across a clear/retype/clear cycle.

Every stream from Phase 1 of the 2026-08-14 program on owns its own
`e2e/<stream>.spec.ts`, so those files never conflict; the shared helpers
live in `e2e/harf.ts`.

`dragFromHere` takes an optional `via` — one explicit small first step before
the interpolated travel, for the drags that start parked on a hover-mounted
dot. Six call sites hand-rolled that gesture, one of them citing this
helper's own rationale in a comment while not calling it.

**Arming a hover-mounted handle goes through `parkOnDot`.** Every overlay
here arms the same way — sweep probes until a dot mounts, move onto the
nearest one, confirm it is hit-testable — and the sequencing of those
`settleFrames` and `hitTargetAt` calls is what the harness's flake-resistance
rests on. It had been copied four times across three specs before this was
extracted, so a caller now supplies only its probe grid and the colour it
wants. `strokeProbes` is shared for the same reason: two specs arm the
stretch tool on different blocks, and which letters carry a straight stroke
depends on the font, so the grid is the only thing they have in common. A
spec importing a helper from another *spec* is not the way to share one —
Playwright would register that file's tests twice.
