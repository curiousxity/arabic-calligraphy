"""Fit a part's pen path to a reference plate: move its nodes and turn its
nib until the swept ink covers the plate's ink and nothing else.

    python -I -X utf8 scripts/pen/fit.py PART [--path N] --plate books/f24_R.png
        --origin X Y --ppn PX_PER_NUQTA [--at DX DY] [--pen PX] [--rounds N]
        [--fix-pos] [--write] [--out DIR]

The part's nodes come from scripts/pen/spec.json (nuqta, y down); `--at`
places the part (nuqta) as its form does, and the plate maps the form's
origin to `--origin` px at `--ppn` px per nuqta. The ink is the plate's dark
pixels that the starting path's ink reaches (annotations elsewhere on the
plate are left out). The sweep follows src/lib/penSweep.ts: the nib angle
and width share are linear along each cubic, a node's `keep` holds one end
of the nib down. The fit minimises the squared difference between the two
inks, both blurred so that a half-covered stroke still pulls the path
towards it, plus a small cost on the nib's turn between neighbouring nodes.

Writes OUT/<part>-fit.png: the plate on the left, the fitted ink on the
right, and between them the difference (plate ink the pen misses in blue,
pen ink outside the plate in red, both in grey). Prints the coverage (share
of the plate's ink the pen covers) and the spill (pen ink outside it, as a
share of the plate's ink). With --write the fitted nodes replace the
part's path in spec.json (rebuild penData with build.py afterwards).
Plates are local research material and are never committed."""
import argparse, json, math, os, sys
import numpy as np
import cv2
from scipy.optimize import minimize

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import node as as_node, path as build_path  # noqa: E402

PLATES = os.environ.get("HARF_PLATES", "//monas/homes/monas/Mohammed/Calligraphy resources/plates")
NUQTA_PENS = 1.65      # penLibrary.ts NUQTA / PEN
DEFAULT_ANGLE = 145
SUB = 4                # cv2 sub-pixel bits
BLUR = 2.0             # px: the loss compares inks blurred this much
TURN_COST = 5e-5       # per degree squared of nib turn between neighbouring nodes, x ink area
BEND_COST = 0.02       # per nuqta squared of a node's offset from its neighbours' midpoint: keeps the path from wobbling
WIDTH_COST = 0.05      # per squared change of the width share between neighbouring nodes: tapers stay gradual
PARTIAL_COST = 0.02    # per squared lift of the nib (1 - width share): thickness comes from turning the nib, lifting is for tapers


def load(path):
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"cannot read {path}")
    return img


def bez(p0, p1, p2, p3, t):
    u = 1 - t
    return (u ** 3)[:, None] * p0 + (3 * u * u * t)[:, None] * p1 + (3 * u * t * t)[:, None] * p2 + (t ** 3)[:, None] * p3


def nib_ends(c, ang, wid, keep, pen):
    a = np.radians(ang)
    u = np.stack([np.cos(a), -np.sin(a)], 1)
    w = np.clip(wid, 0, 1)[:, None] * pen
    h = pen / 2
    if keep == "a":
        A = c + u * h
        return A, A - u * w
    if keep == "b":
        B = c - u * h
        return B + u * w, B
    return c + u * w / 2, c - u * w / 2


def render(lib_path, to_px, pen, shape, step=0.7):
    """The swept ink of a built path (build.py's output, nuqta) as a 0..1 mask."""
    m = np.zeros(shape, np.uint8)
    prev = lib_path["start"]
    for s in lib_path["segs"]:
        to = s["to"]
        P = [to_px(np.array(q, float)) for q in (prev["p"], s["c1"], s["c2"], to["p"])]
        a0, a1 = prev.get("angle", DEFAULT_ANGLE), to.get("angle", DEFAULT_ANGLE)
        w0, w1 = prev.get("width", 1), to.get("width", 1)
        approx = sum(np.hypot(*(P[i + 1] - P[i])) for i in range(3)) + abs(a1 - a0) * math.pi / 180 * pen
        n = max(4, int(approx / step))
        t = np.linspace(0, 1, n + 1)
        c = bez(*P, t)
        e0, e1 = nib_ends(c, a0 + (a1 - a0) * t, w0 + (w1 - w0) * t, prev.get("keep") or to.get("keep"), pen)
        for i in range(n):
            quad = np.array([e0[i], e1[i], e1[i + 1], e0[i + 1]])
            hull = cv2.convexHull(np.round(quad * (1 << SUB)).astype(np.int32))
            cv2.fillConvexPoly(m, hull, 255, lineType=cv2.LINE_AA, shift=SUB)
        prev = to
    return m.astype(np.float64) / 255


def nodes_of(spec_nodes):
    out = []
    for n in spec_nodes:
        d = dict(as_node(n))
        d.setdefault("angle", DEFAULT_ANGLE)
        out.append(d)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("part")
    ap.add_argument("--path", type=int, default=0)
    ap.add_argument("--plate", required=True)
    ap.add_argument("--origin", type=float, nargs=2, required=True)
    ap.add_argument("--ppn", type=float, required=True)
    ap.add_argument("--at", type=float, nargs=2, default=[0, 0])
    ap.add_argument("--pen", type=float, default=None, help="pen width in plate px (default ppn / 1.65)")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--fix-pos", action="store_true", help="fit the nib's angle and width only")
    ap.add_argument("--nodes", help="start from these nodes (a JSON node list, spec.json's format) instead of the part's")
    ap.add_argument("--free", type=int, nargs=2, help="fit only nodes FIRST..LAST (inclusive); the rest stay put")
    ap.add_argument("--exclude", type=float, nargs=4, action="append", default=[], metavar=("X1", "Y1", "X2", "Y2"),
                    help="a box (nuqta, the form's frame) left out of the comparison: a neighbouring letter, a guide line")
    ap.add_argument("--pin", type=int, nargs="*", default=[], help="nodes whose position stays put (their nib still turns)")
    ap.add_argument("--window", type=int, default=0, help="fit this many nodes at a time, sliding by half, instead of all at once")
    ap.add_argument("--others", help="the part's other strokes, held still and drawn with this one (a JSON list of node lists)")
    ap.add_argument("--save", help="write the fitted node list to this JSON file")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--out", default=os.path.join(HERE, "..", "..", ".superpowers", "pen-preview"))
    a = ap.parse_args()

    spec_file = os.path.join(HERE, "spec.json")
    spec = json.load(open(spec_file, encoding="utf-8"))
    nodes = nodes_of(json.loads(a.nodes) if a.nodes else spec["parts"][a.part]["paths"][a.path])
    pen = a.pen or a.ppn / NUQTA_PENS
    plate = load(os.path.join(PLATES, a.plate))

    # work in a crop around the starting path, three pens of room
    def to_px_full(q):
        return np.array([a.origin[0] + (q[0] + a.at[0]) * a.ppn, a.origin[1] + (q[1] + a.at[1]) * a.ppn])
    other_nodes = [nodes_of(o) for o in json.loads(a.others)] if a.others else []
    pts = np.array([to_px_full(n["p"]) for n in nodes + [m for o in other_nodes for m in o]])
    x1, y1 = np.floor(pts.min(0) - 3 * pen).astype(int)
    x2, y2 = np.ceil(pts.max(0) + 3 * pen).astype(int)
    x1, y1 = max(0, x1), max(0, y1)
    crop = plate[y1:y2, x1:x2]
    shape = crop.shape[:2]
    to_px = lambda q: to_px_full(q) - [x1, y1]

    others = np.zeros(shape)
    for o in other_nodes:
        others = np.maximum(others, render(build_path(o), to_px, pen, shape))
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    _, ink = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    start_ink = np.maximum(render(build_path(nodes), to_px, pen, shape), others) > 0.5
    reach = cv2.dilate(start_ink.astype(np.uint8), np.ones((5, 5), np.uint8), iterations=int(pen / 4))
    n_lab, lab = cv2.connectedComponents((ink > 0).astype(np.uint8))
    keep_labels = set(np.unique(lab[(reach > 0) & (ink > 0)])) - {0}
    target = np.isin(lab, list(keep_labels)).astype(np.float64)
    care = np.ones(shape)
    for bx in a.exclude:
        p1, p2 = to_px([bx[0], bx[1]]), to_px([bx[2], bx[3]])
        cv2.rectangle(care, tuple(np.round(np.minimum(p1, p2)).astype(int)), tuple(np.round(np.maximum(p1, p2)).astype(int)), 0, -1)
    target *= care
    tb = cv2.GaussianBlur(target, (0, 0), BLUR)
    area = target.sum()

    # parameters: per node x, y (nuqta), angle (deg), width share
    free_pos = not a.fix_pos
    lo, hi = a.free if a.free else (0, len(nodes) - 1)
    def pack(ns):
        v = []
        for i, n in enumerate(ns):
            if not (lo <= i <= hi):
                continue
            if free_pos and i not in a.pin:
                v += [n["p"][0], n["p"][1]]
            v += [n["angle"], n.get("width", 1)]
        return np.array(v, float)

    def unpack(v):
        out, k = [], 0
        for i, n in enumerate(nodes):
            m = dict(n)
            if lo <= i <= hi:
                if free_pos and i not in a.pin:
                    m["p"] = [float(v[k]), float(v[k + 1])]
                    k += 2
                m["angle"] = float(v[k])
                w = float(np.clip(v[k + 1], 0.02, 1))
                k += 2
                if w < 0.999:
                    m["width"] = w
                else:
                    m.pop("width", None)
            out.append(m)
        return out

    def loss(v):
        ns = unpack(v)
        r = cv2.GaussianBlur(np.maximum(render(build_path(ns), to_px, pen, shape, 2.0), others) * care, (0, 0), BLUR)
        turn = sum((ns[i + 1]["angle"] - ns[i]["angle"]) ** 2 for i in range(len(ns) - 1))
        bend = sum((ns[i]["p"][0] - (ns[i - 1]["p"][0] + ns[i + 1]["p"][0]) / 2) ** 2 + (ns[i]["p"][1] - (ns[i - 1]["p"][1] + ns[i + 1]["p"][1]) / 2) ** 2 for i in range(1, len(ns) - 1) if not ns[i].get("corner"))
        # a path doubling back on itself between nodes is a fold, not a stroke (corners excepted)
        fold = 0.0
        for i in range(1, len(ns) - 1):
            if ns[i].get("corner"):
                continue
            u = np.subtract(ns[i]["p"], ns[i - 1]["p"]); w_ = np.subtract(ns[i + 1]["p"], ns[i]["p"])
            c = float(u @ w_) / (np.hypot(*u) * np.hypot(*w_) + 1e-9)
            fold += max(0.0, -0.3 - c) ** 2
        lift = sum((1 - n.get("width", 1)) ** 2 for n in ns)
        dw = sum((ns[i + 1].get("width", 1) - ns[i].get("width", 1)) ** 2 for i in range(len(ns) - 1))
        over = sum(max(0, n.get("width", 1) - 1) ** 2 for n in ns)
        return float(((r - tb) ** 2).sum()) / area + TURN_COST * turn / len(ns) + (BEND_COST * bend + WIDTH_COST * dw + PARTIAL_COST * lift) / len(ns) + 10 * over + fold

    full = (lo, hi)
    windows = [full]
    if a.window:
        windows = [(i, min(full[1], i + a.window - 1)) for i in range(full[0], full[1] + 1, max(1, a.window // 2))]
        windows = [w for w in windows if w[1] > w[0]] or [full]
    print(f"start loss {loss(pack(nodes)):.4f}")
    for rnd in range(a.rounds):
        for (lo, hi) in windows:
            res = minimize(loss, pack(nodes), method="Powell", options={"xtol": 1e-3, "ftol": 1e-5, "maxfev": 6000})
            nodes[:] = unpack(res.x)
        print(f"round {rnd + 1}: loss {res.fun:.4f}")
    lo, hi = full
    v = pack(nodes)
    fitted = unpack(v)

    ink_fit = (np.maximum(render(build_path(fitted), to_px, pen, shape), others) * care) > 0.5
    T = target > 0.5
    cover = (ink_fit & T).sum() / T.sum()
    spill = (ink_fit & ~T).sum() / T.sum()
    print(f"coverage {cover:.3f}  spill {spill:.3f}")
    for i, n in enumerate(fitted):
        print(i, [round(c, 3) for c in n["p"]], round(n["angle"], 1), round(n.get("width", 1), 2), n.get("keep", ""))

    diff = np.full(crop.shape, 255, np.uint8)
    diff[T & ~ink_fit] = (220, 120, 40)
    diff[~T & ink_fit] = (40, 40, 220)
    diff[T & ink_fit] = (170, 170, 170)
    pen_img = np.full(crop.shape, (228, 240, 246), np.uint8)
    pen_img[ink_fit] = (40, 52, 66)
    sheet = np.concatenate([crop, diff, pen_img], 1)
    z = max(1, int(round(600 / sheet.shape[0])))
    sheet = cv2.resize(sheet, None, fx=z, fy=z, interpolation=cv2.INTER_NEAREST)
    os.makedirs(a.out, exist_ok=True)
    target_png = os.path.join(a.out, f"{a.part}-fit.png")
    cv2.imencode(".png", sheet)[1].tofile(target_png)
    print(target_png)

    def out_node(n):
        o = {"p": [round(n["p"][0], 3), round(n["p"][1], 3)], "angle": round(n["angle"], 1)}
        if "width" in n:
            o["width"] = round(n["width"], 3)
        for k in ("keep", "corner", "dir", "tin", "tout"):
            if k in n:
                o[k] = n[k]
        return o
    if a.save:
        open(a.save, "w", encoding="utf-8").write(json.dumps([out_node(n) for n in fitted]))
    if a.write:
        spec = json.load(open(spec_file, encoding="utf-8"))   # re-read: another fit may have written meanwhile
        spec["parts"][a.part]["paths"][a.path] = [out_node(n) for n in fitted]
        open(spec_file, "w", encoding="utf-8", newline="\n").write(json.dumps(spec, ensure_ascii=False, indent=1) + "\n")
        print("spec.json updated")


if __name__ == "__main__":
    main()
