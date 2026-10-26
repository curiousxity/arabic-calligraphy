"""A letter or word cut from Hashim's page as fitting pieces, where the plate wins over the studio (the dal,
2026-10-20; every letter since 2026-10-21).

python jdplatecut.py NAME vx,vy OUT_CHECK.png (--guide STUDIO_ID | --cuts CUTS --seeds SEEDS) [--page PNG]
                     [--view X,Y] [--nib PX]
NAME: the plate shape's key (e.g. h65-dal); vx,vy: a point on the ink in view coordinates (the page 1800 px wide;
--view: the view point at the image's top-left corner, 300,380 for the p. 65 rows; --page: the full-resolution
render, 7015 px to the page's width, default JD_HASHIM65). The page gives a silhouette only; it is split into pieces
one of two ways:
- --guide STUDIO_ID[,ID...] [--pick]: the studio's strokes for the same letter are scaled to his letter's height and laid over it, and
  each ink pixel goes to the stroke(s) it falls in (the rest to the nearest), so the pieces overlap where the
  studio's do. For a letter standing alone (the p. 65 alphabet). With several ids (or --pick), jdguidepick.py
  lays each over his ink at its best size, stretch, turn and place (GPU), and the best one guides at that pose.
- --cuts "x0,y0,x1,y1;..." --seeds "s0:x,y;s1:x,y": straight cuts through the ink, in the image's px, chosen by eye
  where one stroke meets the next, and a point inside each piece. For a word in a composition, where no studio shape
  matches his stretched forms; the cut is shown to the user before anything is fitted.
Each piece's outline is smoothed (the scan's edge fuzz, about a pixel) and written as cubic curves between its
corners, the short cap segments the fitter's band finder looks for. Writes JD_WORK/plates.json[NAME] =
{"T", "origin", "strokes": [[sid, d], ...], "source"} in page px, --nib px to the nib, so T = PEN / nib; jdcatalog
serves it beside the studio's shapes. Never copies the plate into the library: the pieces are references the pen is
fitted to, as the studio's are."""
import argparse, json, os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(1, os.path.dirname(HERE))
from jdcatalog import strokes, piece_kind, PEN, PEN_U, WORK
from ribbon import parse, ring_samples  # the branch's own copy: only the outline reader is needed here
sys.stdout.reconfigure(encoding="utf-8")
ap = argparse.ArgumentParser()
ap.add_argument("name"); ap.add_argument("pt"); ap.add_argument("check")
ap.add_argument("--guide"); ap.add_argument("--pick", action="store_true"); ap.add_argument("--rigid", action="store_true"); ap.add_argument("--cuts"); ap.add_argument("--seeds")
ap.add_argument("--page", default=os.environ.get("JD_HASHIM65")); ap.add_argument("--view", default="300,380")
ap.add_argument("--nib", type=float, default=40.0)  # Hashim's nib on p. 65, px (ledger: Units and the pen)
a = ap.parse_args()
name, pt, check, NIB = a.name, a.pt, a.check, a.nib
K = 7015 / 1800                              # page px per view px
VX, VY = map(float, a.view.split(","))

im = cv2.imread(a.page, 0)
ink = cv2.morphologyEx((im < 150).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
n, lab, st, cen = cv2.connectedComponentsWithStats(ink, 8)
vx, vy = map(float, pt.split(",")); x, y = int((vx - VX) * K), int((vy - VY) * K)
r = lab[y - 40:y + 40, x - 40:x + 40]; ids, c = np.unique(r[r > 0], return_counts=True); i = ids[np.argmax(c)]
m = (lab == i).astype(np.uint8); ys, xs = np.nonzero(m)
# the crop reaches 4 pens past his letter, so the dots beside it come in too (as other ink), for a guide's dots to
# claim (2026-10-25)
PAD = int(4 * NIB)
y0, y1, x0, x1 = max(ys.min() - PAD, 0), ys.max() + PAD + 1, max(xs.min() - PAD, 0), xs.max() + PAD + 1
m = m[y0:y1, x0:x1]; lab_c = lab[y0:y1, x0:x1] * (1 - m)
m = (cv2.GaussianBlur(m.astype(np.float32), (0, 0), 1.2) > 0.5).astype(np.uint8)  # the scan's edge fuzz
ys, xs = np.nonzero(m); H = ys.max() - ys.min() + 1

if a.guide:
    # the studio's strokes scaled to his letter's height and laid over it, top and right edges together
    Su = NIB / PEN_U
    ids = a.guide.split(","); posed = ""
    if len(ids) > 1 or a.pick:
        # several candidates: jdguidepick lays each over his ink (GPU) and the best one guides, at its best pose
        from jdguidepick import pick
        # posed by the strokes on his letter's own ink: the dots are other ink, claimed after
        best, M, iou, table = pick(m, [[ring_samples(parse(d))[0] * Su for sid, d in strokes(k) if piece_kind(sid) != "nuqta"]
                                       for k in ids])
        print("  candidates:", "; ".join(f"{k} {t['iou']:.3f}" for k, t in zip(ids, table)))
        a.guide = ids[best]; posed = f", picked from {','.join(ids)} (overlap {iou:.3f}, {table[best]['pose']})"
    rings = [(sid, ring_samples(parse(d))[0] * Su) for sid, d in strokes(a.guide)]
    if not posed:
        pts = np.concatenate([r for _, r in rings]); sc = H / (pts[:, 1].max() - pts[:, 1].min())
        pts *= sc; dx, dy = xs.max() - pts[:, 0].max(), ys.min() - pts[:, 1].min()
        M = np.array([[sc, 0, dx], [0, sc, dy]])
    sc = float(np.sqrt(abs(np.linalg.det(M[:, :2]))))
    # then each body stroke, and each mark's strokes together, placed again on its own over the ink the others leave
    # (strokes mesh, they don't sit rigidly: 2026-10-25); the dots keep the shape's pose and claim his dots below
    Mof = {sid: M for sid, _ in rings}
    if not a.rigid:
        from jdguidepick import refine
        groups = {}
        for sid, ring in rings:
            if piece_kind(sid) != "nuqta":
                groups.setdefault(sid.split(".")[0] if "." in sid else sid, []).append((sid, ring))
        gk = list(groups)
        Ms, ious = refine(m, [[r for _, r in groups[g]] for g in gk], M, ["." in groups[g][0][0] for g in gk], pad=1.5 * NIB)
        for g, Mg, v in zip(gk, Ms, ious):
            for sid, _ in groups[g]:
                Mof[sid] = Mg
            A = Mg[:, :2] @ np.linalg.inv(M[:, :2])
            print(f"  placed again: {g} overlap {v}, size x{np.sqrt(abs(np.linalg.det(A))):.2f}, turn {np.degrees(np.arctan2(A[1, 0], A[0, 0])):.0f} deg,"
                  f" moved {np.linalg.norm(Mg[:, 2] + Mg[:, :2] @ np.zeros(2) - M[:, 2]) / NIB:.2f} pens at the origin")
    # where each stroke landed against where the studio's composed shape puts it, in pens of his nib: the crown is a
    # structure of its own whose distance from the letter varies (the user, 2026-10-25), so this is recorded per
    # letter as a measurement, never held fixed
    placed = {}
    for sid, ring in rings:
        A0, A1 = M, Mof[sid]; c = ring.mean(0)
        d0, d1 = A0[:, :2] @ c + A0[:, 2], A1[:, :2] @ c + A1[:, 2]
        R = A1[:, :2] @ np.linalg.inv(A0[:, :2])
        placed[sid] = {"moved_pens": [round(float(v) / NIB, 2) for v in d1 - d0],
                       "size": round(float(np.sqrt(abs(np.linalg.det(R)))), 3),
                       "turn_deg": round(float(np.degrees(np.arctan2(R[1, 0], R[0, 0]))), 1)}
    regions = []
    for sid, ring in rings:
        Ms_ = Mof[sid]
        z = np.zeros_like(m); cv2.fillPoly(z, [np.round((ring @ Ms_[:, :2].T + Ms_[:, 2]) * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
        regions.append((sid, cv2.dilate(z, np.ones((9, 9), np.uint8))))
    # a dot is its own ink: it takes none of the letter's, only a dot of his: of the small blobs within 3 pens of his
    # letter, the one nearest where the guide puts its dot, up to 4.5 pens from it (his dots sit elsewhere than the
    # studio's: the zay's above
    # the head where the studio's is far to the left)
    dot = [piece_kind(sid) == "nuqta" for sid, _ in regions]
    own = [m & z * (not t) for (_, z), t in zip(regions, dot)]
    # where a mark's guide lies over a body stroke's, the ink is the body's: a crown's hairline running down beside
    # the stem takes none of the stem
    body_core = np.zeros_like(m)
    for (sid, _), r in zip(regions, rings):
        if piece_kind(sid) == "body":
            Ms_ = Mof[sid]; cv2.fillPoly(body_core, [np.round((r[1] @ Ms_[:, :2].T + Ms_[:, 2]) * 16).astype(np.int32)], 1, cv2.LINE_8, 4)
    for j, (sid, _) in enumerate(regions):
        if piece_kind(sid) not in ("body", "nuqta"):
            own[j] = own[j] & (1 - body_core)
    left = m & (1 - np.maximum.reduce([z for (_, z), t in zip(regions, dot) if not t]))
    if left.any():
        dts = [cv2.distanceTransform((1 - z).astype(np.uint8), cv2.DIST_L2, 5) if not t else np.full(m.shape, 1e9, np.float32)
               for (_, z), t in zip(regions, dot)]
        near = np.argmin(np.stack(dts), 0)
        for j in range(len(own)): own[j] |= left & (near == j)
    near_letter = cv2.distanceTransform((1 - m).astype(np.uint8), cv2.DIST_L2, 5)
    taken = set()
    for j, ((sid, z), t) in enumerate(zip(regions, dot)):
        if not t:
            continue
        zy, zx = np.nonzero(z); c = np.array([zx.mean(), zy.mean()])
        best_, bd = None, 4.5 * NIB
        for lb in np.unique(lab_c[lab_c > 0]):
            if lb in taken:
                continue
            by, bx = np.nonzero(lab_c == lb)
            if len(by) > 4 * NIB ** 2 or near_letter[by, bx].min() > 3 * NIB:   # a neighbour's letter, or too far
                continue
            dd = np.linalg.norm([bx.mean() - c[0], by.mean() - c[1]])
            if dd < bd:
                best_, bd = lb, dd
        if best_ is not None:
            taken.add(best_); own[j] = (lab_c == best_).astype(np.uint8)
            print(f"  {sid}: his dot {bd / NIB:.2f} pens from the guide's")
    how = f"cut with the studio's {a.guide} strokes as the guide{posed}"
    print(f"{name}: {m.sum() / NIB ** 2:.2f} pen^2 of ink, {H / NIB:.2f} pens tall; studio {a.guide} scaled x{sc:.3f} in pens to the height;",
          "; ".join(f"{sid} {o.sum() / NIB ** 2:.2f} pen^2" for (sid, _), o in zip(regions, own)), f"(left over {left.sum() / NIB ** 2:.2f})")
else:
    # cut lines drawn two px wide through the ink; each piece is the part holding its seed, the cut ink split
    # between the pieces either side so nothing is lost
    cut = np.zeros_like(m)
    for seg in a.cuts.split(";"):
        p, q = np.array(seg.split(","), float).reshape(2, 2)
        cv2.line(cut, tuple(int(v) for v in p - [x0, y0]), tuple(int(v) for v in q - [x0, y0]), 1, 2)
    parts = cv2.connectedComponents((m & (1 - cut)).astype(np.uint8), connectivity=4)[1]
    regions, own = [], []
    for s in a.seeds.split(";"):
        sid, xy = s.split(":"); sx, sy = map(int, xy.split(",")); k = parts[sy - y0, sx - x0]
        assert k > 0, f"seed {sid} is not on the ink"
        regions.append((sid, None)); own.append((parts == k).astype(np.uint8))
    dts = np.stack([cv2.distanceTransform((1 - o).astype(np.uint8), cv2.DIST_L2, 5) for o in own])
    near = np.argmin(dts, 0)
    for j in range(len(own)): own[j] |= m & cut & (near == j)
    rest = m & (1 - np.maximum.reduce(own))
    how = f"cut by hand at {a.cuts}"
    print(f"{name}: {m.sum() / NIB ** 2:.2f} pen^2 of ink, {H / NIB:.2f} pens tall;",
          "; ".join(f"{sid} {o.sum() / NIB ** 2:.2f} pen^2" for (sid, _), o in zip(regions, own)), f"(in no piece {rest.sum() / NIB ** 2:.2f})")


# a piece's outline is its largest blob, so any other blob of it would be lost: each goes to the piece it touches
# most (a strip of a stroke the guide missed, handed to the nearest region across a neighbour's ink; 2026-10-25)
for _ in range(5):
    moved = False
    for j in range(len(own)):
        nb_, lb_ = cv2.connectedComponents(own[j].astype(np.uint8), connectivity=8)
        if nb_ <= 2:
            continue
        big = 1 + int(np.argmax([(lb_ == i).sum() for i in range(1, nb_)]))
        for i in range(1, nb_):
            if i == big:
                continue
            c = (lb_ == i).astype(np.uint8); rim = cv2.dilate(c, np.ones((3, 3), np.uint8)) & (1 - c)
            touch = [int((rim & own[k]).sum()) if k != j else 0 for k in range(len(own))]
            k = int(np.argmax(touch))
            if touch[k] > 0:
                own[k] = own[k] | c; own[j] = own[j] & (1 - c); moved = True
            else:
                print(f"  {regions[j][0]}: a blob of {int(c.sum())} px touches no other piece, left out")
    if not moved:
        break


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


def holes(mask):
    """The windows (%) inside a piece's largest blob, each as an outline: the outline itself is the outer edge only,
    so a window is kept beside it rather than filled (the user, 2026-10-25)."""
    cs, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    if hier is None:
        return []
    outer = max((i for i in range(len(cs)) if hier[0][i][3] < 0), key=lambda i: cv2.contourArea(cs[i]))
    out = []
    for i in range(len(cs)):
        if hier[0][i][3] == outer and cv2.contourArea(cs[i]) >= 0.02 * NIB ** 2:
            P = cs[i][:, 0, :].astype(float) + [x0, y0]
            out.append("M " + " L ".join("%.1f %.1f" % tuple(q) for q in P[::2]) + " Z")
    return out


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


plate = {"T": [PEN / NIB, PEN / NIB, 0, 0], "origin": [float(xs.max() + x0 + 1) * PEN / NIB, 0.0], "strokes": [], "pieces": {},
         "source": f"Hashim, {os.path.basename(a.page)} at view {pt}, {how}", "nib_px": NIB}
if a.guide:
    plate["guide"] = {"id": a.guide, "M": M.round(4).tolist(), "crop_px": [int(x0), int(y0)],
                      "parts": {sid: Mof[sid].round(4).tolist() for sid, _ in rings}}  # crop px = M @ ring px; page px = crop + crop_px
chk = np.full((*m.shape, 3), 255, np.uint8); chk[lab_c > 0] = (230, 230, 230); chk[m > 0] = (200, 200, 200)
cols = [(30, 80, 220), (200, 30, 30), (30, 160, 60), (160, 60, 200), (20, 160, 200), (120, 120, 40)]
for j, ((sid, _), o) in enumerate(zip(regions, own)):
    if o.sum() < 30:  # a guide stroke over none of his ink (a dot or cap of the studio's that his letter lacks here)
        print(f"  {sid}: on {int(o.sum())} px of his ink, left out"); continue
    d, segs = outline(o)
    plate["strokes"].append([sid, d])
    # what the piece is, and its thickest run in pens (a crown's teardrop may want a narrower nib than the body's)
    plate["pieces"][sid] = {"kind": piece_kind(sid) if a.guide else "body",
                            "thick_pens": round(2 * float(cv2.distanceTransform(o.astype(np.uint8), cv2.DIST_L2, 5).max()) / NIB, 2)}
    hs = holes(o.astype(np.uint8))
    if hs:
        plate["pieces"][sid]["holes"] = hs
        print(f"  {sid}: {len(hs)} window{'s' if len(hs) > 1 else ''} kept open")
    if a.guide and sid in placed:
        plate["pieces"][sid]["placed"] = placed[sid]
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
