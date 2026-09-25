---
paths:
  - "src/lib/diacritic*.ts"
  - "src/components/DiacriticHoverHandles.tsx"
  - "e2e/diacritics.spec.ts"
---

# Per-instance diacritic control (`src/lib/diacritics.ts`, `DiacriticHoverHandles.tsx`)

Plain text blocks support per-instance adjustment of individual tashkeel
marks (harakat, tanween, sukun, shadda, etc.) — hovering any diacritic on
a selected block's canvas shows three small handles: drag one vertically
to reposition it, drag another to resize it, and click a third to hide
just that one instance. This is separate from, and non-destructive
relative to, the existing "Clear diacritics" button (`clearDiacritics` in
`App.tsx`), which permanently removes every diacritic character from the
block's text — overrides only change how a diacritic *renders*, never the
underlying text, and a "Reset diacritic overrides" button clears them
without touching the text either.

`lib/diacritics.ts`'s
`findDiacriticGlyphIndices(glyphs, font, shapableText)` identifies which
shaped glyphs are diacritics by glyph identity, **not** by cluster lookup:
HarfBuzz's default cluster level (`MONOTONE_GRAPHEMES`) merges a base
letter with every combining mark following it into one cluster whose
value is the *base letter's* character offset, so a mark glyph's own
`glyph.cl` never points at the mark's own character — asking the source
text *which* glyph is a mark (what an earlier version of this function
did) silently detects nothing on real shaped text.

What a cluster's source span can still answer is **how many** marks were
typed there, and that count is the budget the detection spends:

1. **Primary, unconditional** — the glyph's own Unicode codepoint(s), from
   `font.glyphs.get(g.g).unicodes` (opentype.js's cmap-derived metadata),
   tested against `ARABIC_DIACRITIC_RE`.
2. **Secondary, allowance-gated** — a glyph sharing its cluster with
   another and shaped like a mark: either a **zero advance** (a mark takes
   no width of its own) or a nonzero GPOS attachment offset (`dx`/`dy`).
   Zero-advance candidates are taken first, since a glyph carrying the
   run's advance is a base letter by definition.

The allowance is the count of `ARABIC_DIACRITIC_RE` characters in the
cluster's own source span, minus what the primary signal already took
there — which is why the third argument must be the **shaped** string
(`shapeText`'s `shapableText`, after `stripUnsupportedDiacritics`), the
one `glyph.cl` indexes into, and not the block's own text.

**Both secondary signals also describe things that are not diacritics,
and the allowance is the only thing separating them.** A letter's own
dots are a separate zero-advance GPOS-attached glyph in NotoSans, Ruqaa,
Kufi2 and Qahiri — before the gate, typing `حرف` in NotoSans armed the
overlay on the ف's dot, whose hide button would then have erased it — and
in that same font's `حَرْفٌ` the reh's final form carries `dx = -30` and
shares the sukun's cluster, so the *base letter* was flagged too. Neither
has a combining character behind it, so neither survives. Conversely
Thuluth, ThuluthDeco and Yekan encode their marks in the Private Use Area
and position them by their own outlines, defeating both the cmap check
and the `dx`/`dy` fallback; they are admitted on the zero advance,
because the source really does hold a mark there. Where a cluster offers
more mark-shaped glyphs than the source has marks, the excess is dropped
rather than guessed at — a mark without handles is an inconvenience, a
dot with a hide button is destructive.

**GDEF was evaluated for this and rejected**: `Thuluth.ttf`,
`ThuluthDeco.ttf` and `HarfCanvasDiwani.ttf` carry no GDEF table at all,
so glyph classes cannot arm the fonts that need arming — and where GDEF
does exist it classes a letter's dots as marks exactly like tashkeel, so
it cannot answer the false-positive half either.

`ARABIC_DIACRITIC_RE` itself now lives in `diacritics.ts` (not
`harfbuzz.ts`, which re-exports it for compatibility) specifically so
this module has no runtime dependency on harfbuzzjs, which lets
`diacritics.test.ts` shape real text with real harfbuzzjs directly rather
than mocking it — every assertion in that suite is checked against actual
HarfBuzz output for real fonts in `public/fonts/`, not hand-written
`{ g, cl }` fixtures (a fabricated-cluster version of this test suite is
exactly what let the cluster-lookup bug ship unnoticed once before).

Overrides (`DiacriticOverride` in `types.ts`: `scale`/`offsetY`/`hidden`,
default no-op) are keyed by glyph index — the same scheme
`GlyphTransform` also uses, including that scheme's known fragility (a text
edit before a diacritic in the string can
shift which glyph index its override lands on after re-shaping). Because
of that fragility, `ShapedText.tsx` recomputes `findDiacriticGlyphIndices`
for its own current glyph run each render and filters `diacriticOverrides`
down to only the glyph indices that call currently identifies as
diacritics before handing them to `drawWarpedGlyphRun` — a stale override
whose glyph index now lands on a base letter (rather than a mark) is
silently ignored instead of hiding or grotesquely scaling that letter.
Surviving overrides are applied inside `ShapedText.tsx`'s shared
`drawWarpedGlyphRun` as an
extra `ctx.translate`/`ctx.scale` pivoted on the glyph's own pen-origin
`(gx, gy)`, structurally identical to how that same function already
handles the Private-Use-Area "override glyph" preset symbols. A `hidden`
override skips the glyph's draw call but not its advance width, so hiding
a mark never reflows surrounding letters.

`DiacriticHoverHandles.tsx` is a separate component (not folded into
`ShapedText.tsx` itself) reusing `ShapedText`'s existing per-glyph
`glyphHitBoxes` — only the currently-hovered diacritic ever shows handles, which is what
keeps text with many marks from becoming visual clutter.

**The hover handlers sit on the per-placement `Group`, not on the hit
`Rect`,** and that placement is the whole reason the handles stay put. Konva
fires `mouseleave` on the old target passing the newly-entered shape as
`compareShape` (`Stage`'s pointer retarget), and `Node._fireAndBubble`
suppresses it at any node that is an *ancestor* of that new shape. With the
handlers on the Rect — a *sibling* of the handle Circles — the moment a
mounted handle covered the pointer, the next mousemove was a genuine
Rect→Circle leave: hover cleared, the handle unmounted, and it was present on
exactly every other move. The same race killed any drag whose first step was
small, because Konva only suppresses hover processing once a drag reaches
`dragging` rather than while it is merely `ready`. Hanging the handlers on
the common ancestor makes Rect→Circle an internal move that fires no leave at
all. Moving them back onto the Rect reintroduces both symptoms; the measured
numbers are in [e2e-tests.md](e2e-tests.md). The move
handle's `dragBoundFunc` captures the handle's absolute (stage-space) x
at `onDragStart` and holds it fixed for the drag's duration, rather than
returning the group-local `cx` Konva's `dragBoundFunc` contract requires
absolute coordinates for — mixing the two spaces there previously
teleported the handle sideways under any block offset/pan/zoom. The hover
hit-`Rect` is derived from the mark's actual rendered position
(`displayY`, i.e. original position + `offsetY`) and scaled size
(`box.width/height * scale`), not its original un-overridden box, so an
overridden mark's hoverable area tracks where it's actually drawn instead
of drifting away from it as `offsetY`/`scale` grow. It's active only
when the block is selected, matching every other interactive on-canvas
overlay in this app. Live handle drags follow the same debounced-history
pattern (`useDebouncedHistoryPush`) block dragging already established;
the hide-button click is a discrete, immediate `pushHistory()` mutation.

This feature covers plain text and Shape Fill blocks.
`DiacriticHoverHandles.tsx` takes a list of `DiacriticPlacement`s
(`src/lib/diacriticPlacement.ts`) rather than raw hit boxes — each carries
the mark's box in its renderer's own local space plus a matched
`toCanvas`/`toLocal` pair, so all of the overlay's arithmetic (hover, the
drag rail, the hit rect, the three handles) stays in local space and only
drawing and drag-readback cross into canvas space. `ShapedText`'s adapter
is a plain translation; `ShapeFillText`'s is the per-tile affine
transform, which deliberately ignores the italic shear.

Two behaviours differ per block type, both deliberate. **Order:**
`ShapedText` applies an override *after* its own `warpX`/`warpY` (it is a
`ctx` transform wrapping already-warped point math), while Shape Fill
applies it *before* its deformation — that deformation is the entire point
of the block type, and an override applied after would detach the mark from
its letter. **Arming:** plain text shows handles on selection, but Shape
Fill requires an explicit "Diacritic tool" checkbox (`diacriticEditMode` on `ShapeFillBlock`), because a fill
tiles its run across the whole silhouette and two marks can become 200+
instances. Because overrides are keyed by glyph index, one
adjustment applies to every tiled repetition.

That checkbox used to be the *sole* gate on `glyphInstances`'s memo and on
the block's `dragBoundFunc` pin. It is not any more: per-glyph transforms
reached Shape Fill and need the same instance layout and the same pin, so
both now read `diacriticEditMode || glyphTransformMode` (`pinDrag` in
`ShapeFillText`). Arming either tool is what makes the tiled layout get
computed and the silhouette stop being draggable.

`App.tsx`'s `dragDiacriticOverride`/`toggleDiacriticHidden` gate on
`supportsDiacriticOverrides(b)` rather than `b.type === "text"`. Widening
that guard is what actually makes the feature work on the two shape types —
`diacriticOverrides` lives on `BlockCommon`, so a narrower guard type-checks
perfectly while silently discarding every edit. That predicate and its three
siblings live in **`src/lib/blockCapabilities.ts`**, not in `App.tsx`: the
Sidebar needs the same rule to decide whether to offer a tool's arming
checkbox at all, and written out longhand there a capability widens in one
place and silently not the other — both still compile, and the symptom is a
checkbox that arms nothing.

Text-on-path blocks remain unsupported — their glyphs are rotated to a
curve tangent, which is separate design work.
