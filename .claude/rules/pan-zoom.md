---
paths:
  - "src/lib/canvasBounds*.ts"
---

# Canvas pan and zoom (`CanvasStage.tsx`, `lib/canvasBounds.ts`)

**The alignment grid draws at `1 / stageScale`**, i.e. one device pixel at
any zoom, the same idiom the snap guides use. `strokeWidth` is in stage
units, so the fixed `1` it used to carry became ~2.75px at the default 275%
and the grid out-weighed the ink it exists to measure. Worth knowing when
reading `e2e/` failures: a sub-pixel line antialiases into a few extra colour
buckets, which is why `ink-surface.spec.ts`'s flat-baseline guard is 30
rather than 20.

A wheel event zooms only when `ctrlKey`/`metaKey` is set — which is how
browsers report a trackpad pinch as well as an explicit ctrl+wheel; a
plain wheel or two-finger scroll pans instead.

The zoom multiplier comes from `zoomFactorFromWheel(deltaY, deltaMode)`,
which is **exponential in the wheel's actual travel** rather than a fixed
step per event. This distinction is the whole reason that function exists:
a trackpad pinch fires dozens of small-delta events per second while a
mouse wheel fires a few large ones, so the fixed ±10%-per-event this used
to do made pinching rocket through the entire zoom range. `deltaMode` is
normalized because Firefox commonly reports travel in lines rather than
pixels, and a single event's factor is clamped to 1.25 so one fast flick
cannot skip several zoom levels.

`ZOOM_STEP` (currently 1.15) is the single dial for how fast zooming
feels: the +/- buttons apply it per click, and `ZOOM_PER_PIXEL` is
*derived* from it so that one 100px mouse detent produces exactly the same
step. Tune that one constant rather than either input path, or the two
drift apart. Tested in `canvasBounds.test.ts`, which asserts the
button/detent equality against `ZOOM_STEP` itself so the test survives
retuning.
