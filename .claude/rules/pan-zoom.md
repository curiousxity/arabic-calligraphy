---
paths:
  - "src/lib/canvasBounds*.ts"
  - "src/hooks/useTouchPinch.ts"
  - "e2e/touch.spec.ts"
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

`ZOOM_STEP` (currently 1.3) is the single dial for how fast zooming
feels: the +/- buttons apply it per click, and `ZOOM_PER_PIXEL` is
*derived* from it so that one 100px mouse detent produces exactly the same
step. Tune that one constant rather than either input path, or the two
drift apart. Tested in `canvasBounds.test.ts`, which asserts the
button/detent equality against `ZOOM_STEP` itself so the test survives
retuning.

## Touch (`hooks/useTouchPinch.ts`)

One finger is Konva's: a block drag, a tap to select, or — on empty canvas —
a pan, **with or without the hand tool**. The Stage's `dragButtons` only
reaches Konva's check when the event has a `button`, and a `TouchEvent` has
none, so one finger on empty canvas has always panned; that predates the
touch work and is kept.
Two fingers are the canvas's: pan and zoom as **one** gesture, not two modes
— `pinchStep` (in `canvasBounds.ts`, unit-tested) keeps the content point
under the fingers' midpoint fixed while scaling by the ratio of their
spacing, so moving them together pans and spreading them zooms with no
threshold between the two. The anchor uses the *clamped* scale, so pinching
past a zoom limit pans rather than drifts.

Traps, each found by `e2e/touch.spec.ts`, which fails four of five tests with
the hook and `touch-action` removed:

- **Konva drives drags from touch events, not pointer events** —
  `touchstart` on its content element and `touchmove`/`touchend` on
  `window`. The hook listens on the stage container in the **capture**
  phase, which is the only place a second finger can be seen and swallowed
  before Konva treats it as a press on whatever block it landed on.
- **A drag already in progress is ended through Konva** (`stopDrag()` on
  each `DD._dragElements` entry, then `clear()`), so the block's `dragend`
  still commits where the first finger took it and undo removes it.
  `DD` is imported from `konva/lib/DragAndDrop`; `_dragElements` is
  underscored but typed, and is the only handle on "what is being dragged".
- **The gesture is owned until every finger lifts.** Lifting one finger of a
  pinch must not turn the other into a block drag or a tap.
- **The pinch carries its own view** rather than re-reading props, because
  several `touchmove`s arrive between React renders and a stale scale makes
  the zoom jitter.
- **The page itself must not zoom.** `touch-action: none` on the canvas area
  stops the browser claiming the gesture; the viewport meta's
  `maximum-scale=1, user-scalable=no` stops a pinch on the sidebar; iOS
  Safari ignores both for pinches, so `main.tsx` cancels its proprietary
  `gesturestart`/`gesturechange`. All three are needed — each covers a
  browser the others do not. Only `touch-action` is exercised by the
  Chromium e2e suite.

Every on-canvas drag goes through `DD` and is ended by `stopDrag()`.
