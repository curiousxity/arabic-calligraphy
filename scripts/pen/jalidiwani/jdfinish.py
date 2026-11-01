"""The finish at a joint where two pen strokes meet (the joining proposal's finishing step, approved 2026-10-30 on the
sin's tooth: 299.s1, 301.s1, 309.s1). It smooths our own ink at the meeting point and never copies the studio's
outline there: copied, the studio's facets and V came back (the user, 2026-10-29: a stroke "should be smooth without
facets or jagged edges"; a V or an angle belongs where two strokes adjoin).

  - inside FILL_ZONE nibs of the joint, notches between the strokes close (a morphological closing, CLOSE nuqta);
  - inside SHAVE_ZONE nibs of the tip (the ink's highest point in the zone, a tooth's peak), thin tips come off (an
    opening, OPEN nuqta). The shave stays at the tip: over the whole zone it cut through a tooth's thin rising stroke.

The filled patch is under 0.01 square nuqta a tooth. It works on a raster of the ink; the caller draws the strokes.

cap() rounds a tooth's needle point with a small cap of our own ink (the user, 2026-11-01, the sin's teeth: "Caps", the
small one). Holding the nib across the way up at the tooth's start (40 and 55 degrees) only cut the teeth down: a flat
nib makes a slanted flat, not a round end. Rounding by an opening cut the teeth into knobs. The cap adds, never cuts."""
import numpy as np
import cv2

FILL_ZONE, SHAVE_ZONE = 0.8, 0.35   # nibs
CLOSE, OPEN = 0.10, 0.07            # nuqta
CAP = 0.012                         # nuqta, the cap's radius: 0.018 began to read as a knob, 0.025 was one


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


def tips(letter, at, px_per_nuqta, rc):
    """The tooth points of a letter's own ink (0/1 raster) near `at`: each column's top ink, a local highest point
    standing 0.2 nuqta above both sides and under 0.4 nuqta wide 0.2 nuqta down. The letter's own strokes only: a
    neighbour's ink above hid the sin's second tooth."""
    N = px_per_nuqta; span = int(1.5 * N); cx, cy = int(at[0]), int(at[1])
    x0, x1, y0 = max(cx - span, 0), min(cx + span, letter.shape[1]), max(cy - 2 * span, 0)
    win = letter[y0:cy + span, x0:x1]
    top = np.array([np.argmax(win[:, i]) if win[:, i].any() else win.shape[0] for i in range(win.shape[1])], float)

    def narrow(i, t):
        row = win[min(t + int(0.2 * N), win.shape[0] - 1)]
        lo = max(0, i - int(rc)); on = np.nonzero(row[lo:i + int(rc) + 1])[0]  # a leaning wall leaves the point's column
        if not len(on):
            return False
        j = k = lo + on[np.argmin(np.abs(on + lo - i))]
        while j > 0 and row[j - 1]:
            j -= 1
        while k < len(row) - 1 and row[k + 1]:
            k += 1
        return k - j < 0.4 * N
    out = []
    for i in range(1, len(top) - 1):
        if top[i] > top[i - 1] or top[i] > top[i + 1] or top[i] >= win.shape[0]:
            continue
        l, r = top[max(0, i - span // 2):i], top[i + 1:i + 1 + span // 2]
        if len(l) and len(r) and min(l.max(), r.max()) - top[i] > 0.2 * N and narrow(i, int(top[i]))                 and all(abs(i + x0 - q[0]) > 2 * rc for q in out):
            out.append((i + x0, int(top[i]) + y0))
    return out


def cap(ink, letter, at, px_per_nuqta, r=CAP):
    """ink with a round cap of radius r nuqta on each of the letter's tooth points near `at`: a disc whose top is the
    point, set down the tooth's axis, joined to the tooth by their convex hull. The points, and the raster."""
    rc = r * px_per_nuqta
    found = tips(letter, at, px_per_nuqta, rc)
    for tx, ty in found:
        ny, nx = np.nonzero(_disc(ink.shape, (tx, ty), 5 * rc) & ink)
        ax = np.array([nx.mean() - tx, ny.mean() - ty]); ax /= max(np.linalg.norm(ax), 1e-6)
        disc = _disc(ink.shape, np.array([tx, ty]) + ax * rc, rc)
        dy, dx = np.nonzero(disc)
        pts = np.vstack([np.c_[nx, ny][np.hypot(nx - tx, ny - ty) < 5 * rc], np.c_[dx, dy]]).astype(np.int32)
        ink = ink | disc | cv2.fillConvexPoly(np.zeros_like(ink), cv2.convexHull(pts), 1)
    return found, ink
