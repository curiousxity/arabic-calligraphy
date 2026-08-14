# Stream B — Muthanna & radial composition

**Read `PARALLEL-PHASE-1.md` first.** Branch: `stream/b-muthanna-radial`.

## What this is

Muthanna (مثنى, "doubled") is classical mirror calligraphy: a composition
and its reflection about an axis, reading toward each other. Radial
composition arranges N copies of a motif around a centre (medallions,
shamsa). Neither is expressible today. Both reduce to one primitive: a
**linked block that re-renders another block's content under a transform**,
staying live as the source is edited.

## Design

### `MirrorBlock` (new fifth `Block` variant, STREAM-B anchor in `types.ts`)

```ts
type MirrorBlock = BlockCommon & {
  type: "mirror";
  sourceId: string;                       // the block being reflected
  mode: "mirrorX" | "mirrorY" | "radial";
  radialCount?: number;                   // radial only, 2–16, default 6
  radialRadius?: number;                  // px from the mirror block's origin
};
```

It carries `BlockCommon` like every variant (the unused-fields
simplification is deliberate and documented in CLAUDE.md — follow it).
Position is its own: the user drags the mirror independently; the transform
applies to the source's *content*, not its canvas location.

### `src/components/MirrorBlockView.tsx` (new, exclusively owned)

A `react-konva` Group that mounts the **source block's own renderer**
(`ShapedText` / `ShapeFillText` / `TextOnPathText` / `ImageBlockView`)
inside transform wrapper(s):

- `mirrorX`: inner Group with `scaleX: -1` (reflection about the vertical
  axis — the classical muthanna); `mirrorY` likewise with `scaleY: -1`.
- `radial`: `radialCount` inner Groups, copy *i* rotated `i · 360/count`
  degrees about the block origin, each offset by `radialRadius`.

Because it renders from the source block's props out of App state, edits to
the source re-render every copy for free — no sync machinery. The inner
renderer must be **non-interactive** (`listening: false` on the inner
Group): all hit-testing belongs to the mirror block's own drag surface, and
none of the per-glyph hover overlays mount inside a mirror (pass none of
their arming props). Source lookup is by id each render; a **missing source
renders nothing** and the block is removed by the same cleanup pass that
handles group dissolution.

`src/lib/mirror.ts` holds the pure parts (radial transform math, source
resolution, cycle guard) and is unit-tested. **A mirror whose source is
itself a mirror is rejected at creation** — one level only, or render
recursion needs real design.

### App + Sidebar (anchors)

- "Add mirror" / "Add radial" actions: enabled with exactly one non-mirror
  block selected; creates the mirror beside it, `sourceId` set. Deleting a
  source deletes (with history) its mirrors.
- Type panel **Mirror** (per the sidebar naming rule: named after the block
  type, directly under Content): mode select, radial count + radius sliders,
  and a "Select source" button. Content/Typography panels do not apply to a
  mirror (its content is the source's); hide them for this type the way
  Image already hides text controls.
- `updateBlock`'s `as Block` cast covers the new variant; do not spread the
  cast further (CLAUDE.md rule).
- Save/load: mirrors persist like any block; `applyParsedLayoutPayload`
  drops a mirror whose `sourceId` no longer resolves (shapeWarp-filter
  precedent).

### CanvasStage (anchored, one edit)

One case in the block→renderer map inside the STREAM-B anchor, spreading
the existing `commonProps`. Export needs nothing: mirrors are ordinary
stage children.

## Testing

Unit: radial math (angles/offsets), cycle rejection, orphan filtering.
E2E (`e2e/mirror.spec.ts`): create text → add mirrorX → ink appears in the
mirror's region; edit source text → mirror region changes; delete source →
mirror gone; radial with count 8 renders 8 ink clusters.

## Out of scope

Nesting mirrors; per-copy styling; skewing/arc-bending the reflection to
kiss the source's baseline (real muthanna refinement — future spec);
"flatten to independent blocks".
