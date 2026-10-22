"""The ink's outline smoothed as the app draws it (src/lib/outlineSmooth.ts, the same steps and settings): each ring
split at its real corners, every run between two corners resampled evenly and smoothed by penalised least squares on
its second differences, ends and the samples near a corner pinned, at the strongest setting that moves no point more
than TOL. Units are nuqta.

    from outline import smooth_ring, smooth_mask
"""
import numpy as np
import cv2
from scipy.linalg import solveh_banded

STEP, TOL, CORNER_DEG, CORNER_ARM, CORNER_PAD = 0.01, 0.015, 40.0, 0.08, 0.12  # penLayout.ts SMOOTH
LADDER = [10 ** ((e - 2) / 2) for e in range(15)]


def _along(r, i, d, reach):
    n, k, acc = len(r), i, 0.0
    for _ in range(n - 1):
        if acc >= reach:
            break
        nk = (k + d) % n; acc += float(np.hypot(*(r[nk] - r[k]))); k = nk
    return r[k]


def _corners(r):
    n = len(r)
    turn = np.zeros(n)
    for i in range(n):
        u = r[i] - _along(r, i, -1, CORNER_ARM); v = _along(r, i, 1, CORNER_ARM) - r[i]
        turn[i] = abs(np.degrees(np.arctan2(u[0] * v[1] - u[1] * v[0], u @ v)))
    out = []
    for i in range(n):
        if turn[i] <= CORNER_DEG:
            continue
        ip, inx = (i - 1) % n, (i + 1) % n
        prev = turn[ip] if np.hypot(*(r[ip] - r[i])) <= CORNER_ARM else 0
        nxt = turn[inx] if np.hypot(*(r[inx] - r[i])) <= CORNER_ARM else 0
        if turn[i] >= prev and turn[i] > nxt:
            out.append(i)
    return out


def _resample(p, step=STEP):
    s = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]; n = max(1, int(np.ceil(s[-1] / step)))
    t = np.linspace(0, s[-1], n + 1)
    return np.c_[np.interp(t, s, p[:, 0]), np.interp(t, s, p[:, 1])]


def _solve(x, a, b, lam):
    """min |q - x|^2 + lam |D2 q|^2 with q = x outside [a, b] (one column), banded."""
    n = len(x); d0 = np.ones(n); d1 = np.zeros(n); d2 = np.zeros(n)
    i = np.arange(n - 2)
    np.add.at(d0, i, lam); np.add.at(d0, i + 1, 4 * lam); np.add.at(d0, i + 2, lam)
    np.add.at(d1, i, -2 * lam); np.add.at(d1, i + 1, -2 * lam); np.add.at(d2, i, lam)
    m = b - a + 1; rhs = x[a:b + 1].copy()
    if a >= 1:
        rhs[0] -= d1[a - 1] * x[a - 1]
        if m > 1: rhs[1] -= d2[a - 1] * x[a - 1]
    if a >= 2: rhs[0] -= d2[a - 2] * x[a - 2]
    if b + 1 < n:
        rhs[m - 1] -= d1[b] * x[b + 1]
        if m > 1: rhs[m - 2] -= d2[b - 1] * x[b + 1]
    if b + 2 < n: rhs[m - 1] -= d2[b] * x[b + 2]
    ab = np.zeros((3, m)); ab[2] = d0[a:b + 1]; ab[1, 1:] = d1[a:b]; ab[0, 2:] = d2[a:b - 1]
    q = x.copy(); q[a:b + 1] = solveh_banded(ab, rhs); return q


def _smooth_run(p, a, b):
    if b - a < 2:
        return p
    best = p
    for lam in LADDER:
        c = np.c_[_solve(p[:, 0], a, b, lam), _solve(p[:, 1], a, b, lam)]
        if np.hypot(*(c - p).T).max() > TOL:
            break
        best = c
    return best


def smooth_ring(r):
    """One closed ring (n x 2, no repeated last point), smoothed between its corners."""
    r = np.asarray(r, float)
    if len(r) < 4 or np.hypot(*np.diff(np.vstack([r, r[:1]]), axis=0).T).sum() < 8 * STEP:
        return r
    pad = int(round(CORNER_PAD / STEP)); cs = _corners(r)
    if not cs:
        s = _resample(np.vstack([r, r[:1]]))[:-1]; n = len(s); w = min(n, 4 * pad + 50)
        ext = np.vstack([s[n - w:], s, s[:w]])
        return _smooth_run(ext, 1, len(ext) - 2)[w:w + n]
    out = []
    for k, a in enumerate(cs):
        b = cs[(k + 1) % len(cs)]
        idx = list(range(a, b + 1)) if b > a else list(range(a, len(r))) + list(range(0, b + 1))
        run = _resample(r[idx])
        out.append(_smooth_run(run, pad + 1, len(run) - 2 - pad)[:-1])
    return np.vstack(out)


def smooth_mask(A, pxn):
    """A solid ink mask (0/1, `pxn` px to the nuqta) redrawn from its smoothed outlines."""
    cs, _ = cv2.findContours(A.astype(np.uint8), cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    rings = [smooth_ring(c[:, 0, :].astype(float) / pxn) for c in cs if len(c) >= 3]
    out = np.zeros_like(A)
    cv2.fillPoly(out, [np.round(r * pxn * 16).astype(np.int32) for r in rings], 1, cv2.LINE_8, 4)
    return out
