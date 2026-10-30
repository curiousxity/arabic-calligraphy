"""The finish at a joint where two pen strokes meet (the joining proposal's finishing step, approved 2026-10-30 on the
sin's tooth: 299.s1, 301.s1, 309.s1). It smooths our own ink at the meeting point and never copies the studio's
outline there: copied, the studio's facets and V came back (the user, 2026-10-29: a stroke "should be smooth without
facets or jagged edges"; a V or an angle belongs where two strokes adjoin).

  - inside FILL_ZONE nibs of the joint, notches between the strokes close (a morphological closing, CLOSE nuqta);
  - inside SHAVE_ZONE nibs of the tip (the ink's highest point in the zone, a tooth's peak), thin tips come off (an
    opening, OPEN nuqta). The shave stays at the tip: over the whole zone it cut through a tooth's thin rising stroke.

The filled patch is under 0.01 square nuqta a tooth. It works on a raster of the ink; the caller draws the strokes."""
import numpy as np
import cv2

FILL_ZONE, SHAVE_ZONE = 0.8, 0.35   # nibs
CLOSE, OPEN = 0.10, 0.07            # nuqta


def _disc(shape, c, rad):
    return cv2.circle(np.zeros(shape, np.uint8), (int(c[0]), int(c[1])), int(rad), 1, -1)


def _kernel(px):
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * max(1, int(px)) + 1,) * 2)


def finish(ink, at, px_per_nuqta, nib_px, shave_tip=True):
    """ink: a 0/1 raster of the strokes; at: the joint, raster px; nib_px: the nib's length, raster px. The finished
    raster, and (filled, shaved) masks."""
    zone = _disc(ink.shape, at, FILL_ZONE * nib_px)
    closed = cv2.morphologyEx(ink, cv2.MORPH_CLOSE, _kernel(CLOSE * px_per_nuqta))
    out = np.where(zone == 1, closed, ink).astype(np.uint8)
    if shave_tip and (ink & zone).any():
        ys, xs = np.nonzero(ink & zone)
        tip = _disc(ink.shape, (xs[np.argmin(ys)], ys.min()), SHAVE_ZONE * nib_px)
        opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, _kernel(OPEN * px_per_nuqta))
        out = np.where(tip == 1, opened, out).astype(np.uint8)
    return out, (out == 1) & (ink == 0), (ink == 1) & (out == 0)
