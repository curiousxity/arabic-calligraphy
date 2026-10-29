"""Build the studio stroke library (public/pen/studio-strokes.json) from the fitted pen strokes.

    python -I -X utf8 scripts/pen/studiolib.py SCRATCH [OUT]

SCRATCH is the fitting work folder: studio/registry.json (every shape's strokes, each an outline hash and a corner;
the pair halves fitted after it was made come from the stamps, studio/catalog.py),
me/penreview.json (each fitted stroke's chosen fit and the batch it came from), me/twins.json (strokes that copy a
twin's fit, moved by the difference of their corners), me/gaps.json (patches filling gaps that lie wholly inside a
split stroke's ink: the user, 2026-10-29) and me/trims.json (a split stroke's joint trimmed and filled to the studio
edge: decision 54 and the user's "yes" to every split joint). Each batch folder me/<tag>/pen.json holds the fits.

A fit's nodes are in nuqta from the shape's origin (x at its right-most ink, y = 0 at the stamp's top, y down); the
library stores them in the stamp's own units (PPN to the nuqta) and the app rebuilds the fitter's cubic handles from
them (gpufit._controls = build.py's Catmull-Rom tangents, a third of the chord; `controls` here is the reference the
app's test is pinned to), so the app sweeps exactly the path that was scored. Angle and width ease linearly between nodes and the nib is centred, as in penSweep.ts. A split
stroke is several paths (its pieces and the nib-tip joint fills); its patches are added to the ink and its erase
rings taken away, erase first (strokeInk in src/lib/studioStrokes.ts)."""
import json, math, os, sys

PPN = 25.9
PEN = PPN / 1.65


def controls(P):
    n = len(P)
    d = []
    for i in range(n):
        a, b = P[max(i - 1, 0)], P[min(i + 1, n - 1)]
        if i == 0:
            a, b = P[0], P[1]
        elif i == n - 1:
            a, b = P[-2], P[-1]
        v = (b[0] - a[0], b[1] - a[1]); m = math.hypot(*v) or 1e-9
        d.append((v[0] / m, v[1] / m))
    out = []
    for i in range(n - 1):
        ch = math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1])
        out.append(((P[i][0] + d[i][0] * ch / 3, P[i][1] + d[i][1] * ch / 3),
                    (P[i + 1][0] - d[i + 1][0] * ch / 3, P[i + 1][1] - d[i + 1][1] * ch / 3)))
    return out


def r2(v):
    """Stamp units to a tenth (0.004 nuqta): well under a pixel at any size the app draws, and the file a third."""
    return round(v, 1)


def pen_path(nodes, origin, shift):
    """A fit's nodes in stamp units, each [x, y, angle] or [x, y, angle, width] (width 1 left out). The app builds the
    cubic handles from them (studioStrokes.ts penPathOf, the fitter's Catmull-Rom rule, which a move and a scale leave
    unchanged), so the curve is the one that was scored."""
    out = []
    for q in nodes:
        n = [r2(q["p"][0] * PPN + origin[0] + shift[0]), r2(q["p"][1] * PPN + origin[1] + shift[1]), round(q["angle"], 1)]
        if abs(q.get("width", 1) - 1) > 1e-6:
            n.append(round(q["width"], 3))
        out.append(n)
    return out


def ring(pts, shift):
    return [[r2(x + shift[0]), r2(y + shift[1])] for x, y in pts]


def main(sp, out):
    me = os.path.join(sp, "me")
    reg = json.load(open(os.path.join(sp, "studio", "registry.json")))
    rev = json.load(open(os.path.join(me, "penreview.json")))
    twins = json.load(open(os.path.join(me, "twins.json")))
    gaps = json.load(open(os.path.join(me, "gaps.json"))) if os.path.exists(os.path.join(me, "gaps.json")) else {}
    trims = json.load(open(os.path.join(me, "trims.json"))) if os.path.exists(os.path.join(me, "trims.json")) else {}
    sys.path.insert(0, os.path.join(sp, "studio"))
    from catalog import origin, strokes as stamp_strokes, db, key, corner  # noqa: E402  origin: x at the shape's right-most ink
    batches = {}

    def batch(tag):
        if tag not in batches:
            batches[tag] = json.load(open(os.path.join(me, tag, "pen.json")))
        return batches[tag]

    def stroke(k, shift):
        """k's chosen fit as {recipe, pens, patches, erase}, moved by shift (stamp units of the using shape)."""
        v = rev[k]; d = batch(v["src"]); s = k.split(".")[0]; O = origin(s)
        e = d[k]
        if v["recipe"] == "split":
            pens = [pen_path(d[p]["nodes"], O, shift) for p in e["parts"]] + [pen_path(j, O, shift) for j in e.get("joint", [])]
        else:
            pens = [pen_path(e["nodes"], O, shift)]
        g = gaps.get(k, {}) if v["recipe"] == "split" else {}
        t = trims.get(k, {}) if v["recipe"] == "split" else {}
        out = {"recipe": v["recipe"], "pens": pens}
        if g.get("patches") or t.get("fill"):
            out["patches"] = [ring(p, shift) for p in g.get("patches", []) + t.get("fill", [])]
        if t.get("erase"):
            out["erase"] = [ring(p, shift) for p in t["erase"]]
        out["iou"] = round(v["score"]["iou"], 3)
        return out

    # the registry's shapes, and the pair halves fitted after it was made (020g, 028r: db pair_of, pair_role)
    ids = {s: [sid for sid, _h, _c in lst] for s, lst in reg["shapes"].items()}
    for k in rev:
        s = k.split(".")[0]
        if "~" not in k and s not in ids:
            ids[s] = [sid for sid, _d in stamp_strokes(s)]
    shapes, missing = {}, []
    for s, sids in sorted(ids.items()):
        strokes = []
        for sid in sids:
            k = f"{s}.{sid}"
            if k in twins:
                src, sh = twins[k]["from"], twins[k]["shift"]
                if src not in rev:
                    missing.append(k); continue
                st = stroke(src, sh); st["twin"] = src
            elif k in rev:
                st = stroke(k, (0.0, 0.0))
            elif s not in reg["shapes"] and key(dict(stamp_strokes(s))[sid]) in reg["fits"]:
                # a pair half's stroke repeating an outline fitted elsewhere (the registry's outline hash), copied as
                # twins.py copies a twin: moved by the difference of the corners
                f = reg["fits"][key(dict(stamp_strokes(s))[sid])]; c = corner(dict(stamp_strokes(s))[sid])
                src = twins[f["job"]]["from"] if f["job"] in twins else f["job"]
                if src not in rev:
                    missing.append(k); continue
                sh = [round(c[0] - f["corner"][0] + (twins[f["job"]]["shift"][0] if f["job"] in twins else 0), 3),
                      round(c[1] - f["corner"][1] + (twins[f["job"]]["shift"][1] if f["job"] in twins else 0), 3)]
                st = stroke(src, sh); st["twin"] = src
            else:
                missing.append(k); continue
            strokes.append({"id": sid, **st})
        e = db[s]
        shapes[s] = {"group": e.get("group"), "form": e.get("form"), "variant": e.get("variant"),
                     **({"pairOf": e["pair_of"], "pairRole": e.get("pair_role")} if e.get("pair_of") else {}),
                     "origin": [r2(origin(s)[0]), 0], "strokes": strokes}
    lib = {"version": 1, "ppn": PPN, "pen": round(PEN, 4), "shapes": shapes}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(lib, open(out, "w"), separators=(",", ":"))
    n = sum(len(v["strokes"]) for v in shapes.values())
    print(f"{len(shapes)} shapes, {n} strokes, {sum(1 for v in shapes.values() for x in v['strokes'] if x['recipe'] == 'split')} written in pieces; "
          f"{os.path.getsize(out) / 1e6:.1f} MB -> {out}")
    if missing:
        print("strokes with no fit:", len(missing), missing[:20])


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, "..", "..", "public", "pen", "studio-strokes.json"))
