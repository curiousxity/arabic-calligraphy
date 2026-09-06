# Per-glyph rotation — design (2026-09-06)

The fourth handle on the per-glyph overlay: turn a single letter about its own
centre. Implemented; this file carries the argument, not the mechanics — those
are in `CLAUDE.md`, "Per-glyph move, scale & rotate".

Planned in `docs/superpowers/plans/2026-09-06-remaining-work-program.md`, §5.4,
as `glyph-rotation` (M–L, build-with-caveats).

---

## The one decision that mattered

Where the rotation sits in the composition. Both answers render something
plausible, and only one of them leaves the existing handles working.

**Chosen — inside the scale, about the glyph's raw box centre:**

```
translate(gx, gy) → translate(offset) → scale(sx, sy)
                  → translate(pivot) → rotate(θ) → translate(-pivot)
                  → [diacritic override] → outline
```

**Rejected — outside the scale**, i.e. turning the already-scaled letter.

### Why outside fails, and why it would have looked fine

Outside the scale, the pivot expressed in the space the scale handles work in
becomes `(boxCentreX − gx) × scaleX`. It therefore *moves as the glyph is
scaled*.

That matters because of a property this repo has already been bitten by twice.
`GlyphTransformHoverHandles` snapshots `pivotX`/`pivotY` and `startDistanceX`/
`startDistanceY` once, at `onDragStart`, and measures every subsequent frame
from those frozen values — deliberately, because `glyphHitBoxes` is memoized on
`glyphTransforms`, so reading the live box each frame feeds the previous
frame's scale back into the current frame's arithmetic and the gesture
converges on the wrong value. The measured symptom, recorded in `CLAUDE.md`,
is that asking for 2× lands near 1.45×.

A scale-dependent pivot reintroduces exactly that divergence by a different
route: the drag-start snapshot is taken against one pivot and the renderer
then uses another.

The trap is that **the error is identically zero at rotation 0**. Every unit
test that existed, and both e2e drags, exercise rotation 0. The rejected design
ships green.

### The guard

`glyphTransform.test.ts` → *"round-trips with a rotation and a non-unit start
scale set together"*. It restates the overlay's own drag arithmetic — rest
distance from the drawn box, pivot at `gx + offsetX`, `scaleFromHandleDrag` to
recover the extent — with `rotation: 30` and `startScale: 1.8` set at once.

It was verified by building the rejected `transformedBox` (scale first, then
rotate the scaled box) and re-running: **exactly that one assertion fails**,
and all 70 others pass. That is the whole argument for the test's existence,
and it is why it must not be weakened into a rotation-only or scale-only case.

### What the choice costs

At a *non-uniform* scale, a turned letter is stretched along the block's axes
rather than along its own — visually a shear. Identical either way whenever
`scaleX === scaleY`, which is almost every real use. Accepted deliberately by
the maintainer before implementation; stated plainly in the guide rather than
hidden.

---

## Two smaller findings

**The drawn box's centre *is* the rotation pivot.** `transformedBox` turns the
raw outline box about its centre and takes the AABB, an operation that leaves
that centre exactly where it was; the subsequent scale is about the pen origin,
which maps the pivot the same way it maps the AABB centre. Verified over 20 000
random (box, origin, offset, scale, angle) draws: worst divergence 4.5e-13.

So the overlay needs no pivot threaded into it at all, and the rotate drag
reuses the point the blue move dot already sits on. The pivot map that *is*
threaded through goes to the renderer only, and comes from `glyphMetrics`
rather than a `getBoundingBox()` in the draw loop because those boxes are
**post-cut** — a surgically lengthened letter must turn about the centre of
what it is, not of what it was.

**The dot's placement is a correctness constraint, not styling.** Below the box
centre it lands under a mark's hit rect (`DiacriticHoverHandles` mounts after
this overlay, with a `fontSize * 0.5` vertical margin, and Konva routes to the
topmost listening shape). The failure is not an inert dot: the gesture goes to
the mark and records a diacritic override. Pinned by asserting the *drag*, and
verified to fail — `Rect.diacritic-hit` — against a below-centre placement.

---

## Open questions

1. **Should a non-uniform scale rotate along the letter's own axes?** The
   accepted shear above. Fixing it means the full adapter refactor and a
   scale-dependent pivot, i.e. re-solving the problem this design avoids;
   worth revisiting only if a real composition looks wrong, not on principle.
2. **Should a turned letter count toward the block's measured width?** It does
   not today, matching move and scale, so a turned letter can overhang the page
   margin and Fit to width will not see it. Making it count means folding the
   per-glyph transforms into the block's `bounds`, which the metrics memo
   deliberately keeps raw — transforming one glyph would otherwise resize the
   block and shift every other glyph on canvas.
3. **A fifth handle for skew?** Not asked for. Noted only because the
   composition now has an obvious slot for it.
