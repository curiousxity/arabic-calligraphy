---
paths:
  - "src/lib/mirror*.ts"
  - "src/components/MirrorBlockView.tsx"
  - "src/lib/blockRenderProps.ts"
  - "e2e/mirror.spec.ts"
---

# Mirror blocks — muthanna and radial (`src/lib/mirror.ts`, `MirrorBlockView.tsx`)

`mirror` is a fifth `Block` variant that draws **another block's content**
under a transform: a reflection (`mirrorX` / `mirrorY`, the classical
muthanna) or `radialCount` copies turned around a centre (a medallion or
shamsa). It is the one primitive both compositions reduce to.

- **It has no content of its own.** `sourceId` is resolved against `blocks`
  inside `CanvasStage`'s render map on every render, and `MirrorBlockView`
  mounts the *source's own renderer* (`ShapedText` / `ShapeFillText` /
  `TextOnPathText` / `ImageBlockView`) inside transform wrapper groups. That
  lookup is the entire "stays live as the source is edited" mechanism — there
  is no sync machinery, and nothing to keep in step. It also means every
  block type is mirrorable without touching the four render algorithms this
  file elsewhere refuses to merge.
- **The block-to-renderer prop mapping is `src/lib/blockRenderProps.ts`, and
  both call sites build from it.** This file used to map those props by hand,
  and dropped a field silently **four** times — `fill`, `strokeCuts`,
  `glyphTransforms`, then `kufiComposition`/`kufiCellEdits` — each fixed by
  adding the one line that had been missed, with nothing preventing a fifth.
  The failure mode is what makes it worth a module: `CanvasStage` looks
  correct, so only the mirror draws the wrong thing. The builders carry
  *content* only. Position, opacity, `isSelected`, `locked`/`draggable`, the
  `on*` handlers and every `*EditMode` arming flag are deliberately excluded,
  because those are exactly what the two callers must disagree about.
- **Position is its own.** The transform applies to the source's *content*,
  never to the source's place on the canvas — the user drags a mirror
  independently, which is how the two halves of a muthanna are brought
  together.
- **One level only.** A mirror may never be a mirror's source. This is
  checked when creating (`App.tsx`'s `mirrorSourceCandidate` gates both add
  buttons) *and* when resolving (`resolveMirrorSource` returns null for a
  mirror source), so the renderer cannot recurse even from a hand-edited save.
  Nesting is a deferred feature, not an oversight.
- **The inner content is `listening={false}`**, so no per-glyph hover overlay
  can ever mount inside a mirror and the source's own drag surface cannot
  swallow the gesture. `MirrorBlockView` passes none of those overlays' arming
  props either — belt and braces, since a Konva node is non-listening when any
  ancestor is.
- **Its drag surface therefore has to be measured.** The hit `Rect` is sized
  from `contentRef.getClientRect({ relativeTo: group })`, and the measurement
  runs in a short **rAF settle loop** rather than a plain effect: shaping is
  async and completes inside the *child*, which never re-runs a parent effect.
  The loop stops once the box holds still for a few frames and is hard-capped
  either way. Until it settles the block still has a small fallback grab area,
  never a zero-size one.
- **Radial geometry** lives in `radialCopyTransforms` (pure, tested). Copy *i*
  is turned `i · 360/count` degrees and pushed `radialRadius` along its own
  spoke — Konva rotates a Group about its own `(x, y)`, so setting both on the
  wrapper group needs no pivot arithmetic. Radius 0 stacks every copy on the
  centre, each still at its own angle.
- **Orphans.** A mirror whose source is gone renders nothing and is removed:
  on load by `dropOrphanedMirrors` in `applyParsedLayoutPayload` (the
  `shapeWarp`-filter precedent beside it), and at runtime by an effect over
  `blocks` in `App.tsx`. That effect deliberately does **not** `pushHistory` —
  the action that removed the source already pushed, and its snapshot holds
  both blocks, so one undo restores the pair. It lives in an effect rather
  than inside `deleteSelectedBlock` so every route to a vanished source is
  covered (delete button, Delete key, the Layers panel's own delete, a
  reorder).
- **Sidebar.** The type panel is `Mirror` (mode select, radial count/radius,
  and a "Select source" button that moves the selection to the source).
  Content and Typography are hidden for this type — a mirror has neither of
  its own — the same way `image` already hides them.
