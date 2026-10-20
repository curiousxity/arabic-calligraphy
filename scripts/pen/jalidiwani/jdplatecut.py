"""A letter cut from Hashim's p. 65 as fitting pieces, where the plate wins over the studio (the dal, 2026-10-20).

python jdplatecut.py NAME vx,vy STUDIO_ID OUT_CHECK.png
NAME: the plate shape's key (e.g. h65-dal); vx,vy: a point on the letter in page-65 view coordinates (1800 px wide,
as jdplate.py); STUDIO_ID: the studio shape whose stroke split guides the cut. Hashim's page gives a silhouette only,
so the studio's strokes are scaled to his letter's height, laid over it, and each of his ink pixels goes to the
stroke(s) it falls in (the rest to the nearest), so the pieces overlap where the studio's do. Each piece's outline
is smoothed (the scan's edge fuzz, about a pixel at 40 px to the nib) and written as cubic curves between its
corners, the short cap segments the fitter's band finder looks for. Writes JD_WORK/plates.json[NAME] =
{"T", "origin", "strokes": [[sid, d], ...], "source"} in page px, 40 px to the nib, so T = PEN / 40; jdcatalog
serves it beside the studio's shapes. Never copies the plate into the library: the pieces are references the pen is
fitted to, as the studio's are."""
import json, os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(1, os.path.dirname(HERE))
from jdcatalog import strokes, PEN, PEN_U, WORK
from ribbon import parse, ring_samples  # the branch's own copy: only the outline reader is needed here
sys.stdout.reconfigure(encoding="utf-8")
name, pt, sid_studio, check = sys.argv[1:5]
NIB = 40.0                                   # Hashim's nib on the page, px (ledger: Units and the pen)
K = 7015 / 1800                              # page px per view px

im = cv2.imread(os.environ["JD_HASHIM65"], 0)
ink = cv2.morphologyEx((im < 150).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(ink, 8)
vx, vy = map(float, pt.split(",")); x, y = int((vx - 300) * K), int((vy - 380) * K)
r = lab[y - 40:y + 40, x - 40:x + 40]; ids, c = np.unique(r[r > 0], return_counts=True); i = ids[np.argmax(c)]
m = (lab == i).astype(np.uint8); ys, xs = np.nonzero(m)
y0, y1, x0, x1 = ys.min() - 8, ys.max() + 9, xs.min() - 8, xs.max() + 9
m = m[y0:y1, x0:x1]
m = (cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.2) > 0.5).astype(np.uint8)  # the scan's edge fuzz
ys, xs = np.nonzero(m); H = ys.max() - ys.min() + 1

# the studio's strokes scaled to his letter's height and laid over it, top and right edges together
Su = NIB / PEN_U
rings = [(sid, ring_samples(parse(d))[0] * Su) for sid, d in strokes(sid_studio)]
pts = np.concatenate([r for _, r in rings]); sc = H / (pts[:, 1].max() - pts[:, 1].min())
pts *= sc; dx, dy = xs.max() - pts[:, 0].max(), ys.min() - pts[:, 1].min()
regions = []
for sid, ring in rings:
    z = np.zeros_like(m); cv2.fillPoly(z, [np.round((ring * sc + [dx, dy]) * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    regions.append((sid, cv2.dilate(z, np.ones((9, 9), np.uint8))))
own = [m & z for _, z in regions]
left = m & (1 - np.maximum.reduce([z for _, z in regions]))
if left.any():
    dts = [cv2.distanceTransform((1 - z).astype(np.uint8), cv2.DIST_L2, 5) for _, z in regions]
    near = np.argmin(np.stack(dts), 0)
    for j in range(len(own)): own[j] |= left & (near == j)
print(f"{name}: {m.sum() / NIB ** 2:.2f} pen^2 of ink, {H / NIB:.2f} pens tall; studio {sid_studio} scaled x{sc:.3f} in pens to the height;",
      "; ".join(f"{sid} {o.sum() / NIB ** 2:.2f} pen^2" for (sid, _), o in zip(regions, own)), f"(left over {left.sum() / NIB ** 2:.2f})")


def cubic_fit(P):
    """One cubic through P[0]..P[-1] by least squares on chord-length parameters; (control points, worst error)."""
    t = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]; t /= max(t[-1], 1e-9)
    B = np.c_[(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3]
    rhs = P - np.outer(B[:, 0], P[0]) - np.outer(B[:, 3], P[-1])
    c, *_ = np.linalg.lstsq(B[:, 1:3], rhs, rcond=None)
    C = np.array([P[0], c[0], c[1], P[-1]]); err = np.linalg.norm(B @ C - P, axis=1)
    return C, err


def fit_run(P, tol=0.8):
    """Cubics through a run of outline points, split at the worst point until each is within tol px."""
    if len(P) < 4:
        return [np.array([P[0], P[0], P[-1], P[-1]])]
    C, err = cubic_fit(P)
    if err.max() <= tol or len(P) < 8:
        return [C]
    k = int(np.clip(np.argmax(err), 3, len(P) - 4))
    return fit_run(P[:k + 1], tol) + fit_run(P[k:], tol)


def outline(mask):
    cs, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    P = max(cs, key=cv2.contourArea)[:, 0, :].astype(float)
    corners = cv2.approxPolyDP(P.astype(np.float32), 3.0, True)[:, 0, :]
    idx = sorted(int(np.argmin(np.linalg.norm(P - q, axis=1))) for q in corners)
    runs, segs = [], []
    for a, b in zip(idx, idx[1:] + [idx[0] + len(P)]):
        run = np.array([P[k % len(P)] for k in range(a, b + 1)])
        segs += fit_run(run)
    d = "M %.2f %.2f " % tuple(segs[0][0] + [x0, y0]) + " ".join(
        "C " + " ".join("%.2f %.2f" % tuple(q + [x0, y0]) for q in s[1:]) for s in segs) + " Z"
    return d, segs


plate = {"T": [PEN / NIB, PEN / NIB, 0, 0], "origin": [float(xs.max() + x0 + 1) * PEN / NIB, 0.0], "strokes": [],
         "source": f"Hashim p. 65 at view {pt}, cut with the studio's {sid_studio} strokes as the guide", "nib_px": NIB}
chk = np.full((*m.shape, 3), 255, np.uint8); chk[m > 0] = (200, 200, 200)
cols = [(30, 80, 220), (200, 30, 30), (30, 160, 60), (160, 60, 200)]
for j, ((sid, _), o) in enumerate(zip(regions, own)):
    d, segs = outline(o)
    plate["strokes"].append([sid, d])
    print(f"  {sid}: {len(segs)} curves, shortest {min(np.linalg.norm(s[3] - s[0]) for s in segs):.1f} px")
    for s in segs:
        pts_ = np.array([(1 - t) ** 3 * s[0] + 3 * (1 - t) ** 2 * t * s[1] + 3 * (1 - t) * t ** 2 * s[2] + t ** 3 * s[3] for t in np.linspace(0, 1, 24)])
        cv2.polylines(chk, [np.round(pts_ * 16).astype(np.int32)], False, cols[j], 1, cv2.LINE_AA, 4)
cv2.imwrite(check, cv2.resize(chk, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC))
f = os.path.join(WORK, "plates.json")
plates = json.load(open(f, encoding="utf-8")) if os.path.exists(f) else {}
plates[name] = plate
json.dump(plates, open(f, "w", encoding="utf-8"), indent=1)
print("wrote", name, "to", f, "| check:", check)
