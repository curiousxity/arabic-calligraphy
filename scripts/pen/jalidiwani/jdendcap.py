"""A tail's last bit made the studio's own outline (the user, 2026-11-02, of 731's tail: allowed, after the Thuluth
session's endcap.py). A local refit of the tip, widths free or held, left waists, spills or a needle (n731f2, f3, h1),
so the pen fit is left as it is and, inside a disc of R nuqta round the tail's last node, the stroke's ink becomes the
studio's: ours past the studio edge erased, the studio's ink filled. The studio outline is rounded first (CUT rounds of
corner cutting), as a stroke is smooth (no facets even where the studio outline has them). R is picked where ours and
the studio already agree (731: under 0.003 nuqta from 0.2 nuqta back), so the disc's edge leaves no step.

The record gains "endcap": {"c": tip, "r": R, "erase": rings, "fill": rings}, all in node (nuqta) coordinates.
  python jdendcap.py IN/pen.json OUT/pen.json STROKE~cN [R]       (JD_* env as jdpenjob)"""
import json, os, sys
import numpy as np
from shapely.geometry import Point, Polygon
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import jdpenjob as J  # noqa: E402

R, CUT = 0.3, 2


def chaikin(r, n):
    for _ in range(n):
        a, b = r, np.roll(r, -1, axis=0)
        r = np.stack([0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b], axis=1).reshape(-1, 2)
    return r


def rings_of(g):
    gs = [g] if g.geom_type == "Polygon" else list(getattr(g, "geoms", []))
    return [[[round(x, 4), round(y, 4)] for x, y in p.exterior.coords[:-1]] for p in gs
            if p.geom_type == "Polygon" and p.area > 1e-6]


def endcap(stroke, rec, r=R):
    piece, _, O = J.job_of(stroke.split("~")[0])  # the letter's outline: the disc holds only the tail
    studio = Polygon(chaikin((J.ref_ring(piece) - O) / J.PPN, CUT)).buffer(0)
    c = rec["nodes"][-1]["p"]
    disc = Point(c).buffer(r, 64)
    return {"c": c, "r": r, "erase": rings_of(disc.difference(studio)), "fill": rings_of(disc.intersection(studio))}


def apply(A, cap, O, x1, y1, scale):
    """A (bool raster of our ink, px = (screen - [x1, y1]) * scale) with the cap's erase and fill drawn in."""
    import cv2
    to = lambda ring: np.round(((np.array(ring) * J.PPN + O) - [x1, y1]) * scale * 16).astype(np.int32)  # noqa: E731
    E, F = (np.zeros(A.shape, np.uint8) for _ in range(2))
    for M, rs in ((E, cap["erase"]), (F, cap["fill"])):
        if rs:
            cv2.fillPoly(M, [to(q) for q in rs], 1, cv2.LINE_8, 4)
    return (A & (E == 0)) | (F == 1)


if __name__ == "__main__":
    src, dst, st = sys.argv[1:4]
    p = json.load(open(src))
    p[st]["endcap"] = endcap(st, p[st], float(sys.argv[4]) if len(sys.argv) > 4 else R)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    json.dump(p, open(dst, "w"))
    print(st, "erase", len(p[st]["endcap"]["erase"]), "fill", len(p[st]["endcap"]["fill"]))
