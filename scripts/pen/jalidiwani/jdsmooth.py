"""How smooth an outline is, beside the reference's: the measure for the smoothing pass (the user, 2026-10-21: "the
studio has smoother strokes"). Both are read off filled masks at R raster px to the nuqta.

- sharp: places where our outline turns more than SHARP degrees over 0.05 nuqta each way and the reference has no
  such turn within 0.12 nuqta: a notch or a point where two strokes meet, a barb at a cap.
- bends: where the outline's curvature changes sign, counted with a dead band (BEND per nuqta) so pixel noise is not
  counted: on a smooth edge only the letter's own S-turns count, on a wobbling one every wobble does. Given as ours
  and the reference's."""
import math
import numpy as np, cv2

SHARP, BEND = 18.0, 0.6


def contours(mask):
    cs, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return [c[:, 0, :].astype(float) for c in cs if len(c) > 50]


def _smooth(C, s):
    k = max(1, int(3 * s)); g = np.exp(-0.5 * (np.arange(-k, k + 1) / s) ** 2); g /= g.sum()
    wrap = lambda v: np.convolve(np.r_[v[-k:], v, v[:k]], g, "valid")
    return np.c_[wrap(C[:, 0]), wrap(C[:, 1])]


def _turn(C, win):
    a, c = np.roll(C, win, 0), np.roll(C, -win, 0)
    u, v = C - a, c - C
    return np.degrees(np.arctan2(u[:, 0] * v[:, 1] - u[:, 1] * v[:, 0], (u * v).sum(1)))


def sharp_turns(mask, R):
    out = []
    for C in contours(mask):
        C = _smooth(C, 2); t = _turn(C, max(2, int(0.05 * R))); big = np.abs(t) > SHARP
        i = 0
        while i < len(t):
            if big[i]:
                j = i
                while j < len(t) and big[j]: j += 1
                k = i + int(np.argmax(np.abs(t[i:j]))); out.append(C[k]); i = j
            else:
                i += 1
    return out


def bends(mask, R):
    n = 0
    for C in contours(mask):
        C = _smooth(C, 0.03 * R)
        win = max(2, int(0.08 * R))
        kappa = np.radians(_turn(C, win)) / (2 * win / R)  # per nuqta
        sign = 0
        for x in kappa[np.abs(kappa) > BEND]:
            s = 1 if x > 0 else -1
            if sign and s != sign: n += 1
            sign = s
    return n


def measure(A, B, R):
    """(sharp turns ours only, bends ours, bends the reference's) for our mask A and the reference's B."""
    sb = sharp_turns(B, R)
    ours = [p for p in sharp_turns(A, R) if all(np.linalg.norm(p - q) > 0.12 * R for q in sb)]
    return len(ours), bends(A, R), bends(B, R), ours
