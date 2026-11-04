"""A stroke patched from the studio's outline where it misses most (the user, 2026-11-03: 187.s2, 207.s2, 072.s1 and
092.s0, approved). Each round finds the largest blob of ours-only or studio-only ink (after a 5 px opening, so a
hairline sliver along an edge doesn't count) and lays a jdendcap patch of R nuqta on its centroid. It stops after N
rounds or when the largest blob is under MIN px at 400 px a nuqta. The tips still want their own patches (jdendcap).
  python jdautopatch.py IN/pen.json OUT/pen.json STROKE [N [R [AT ...]]]       (JD_* env as jdpenjob)
AT is a patch aimed by eye after a look at the result, laid before the rounds: X,Y:R in nuqta, or first:R / last:R
for a tip (192.s2's needle, 235.s5's squared tip)."""
import json, os, sys
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import jdpenjob as J  # noqa: E402
import jdendcap  # noqa: E402

N, R, MIN, PX = 3, 0.5, 400, 400


def others_near(p, st, c, r_):
    return [v["nodes"] for kk, v in p.items() if kk != st and kk.split("~")[0].split(".")[0] == st.split(".")[0]
            and min(np.hypot(q["p"][0] - c[0], q["p"][1] - c[1]) for q in v["nodes"]) < r_ + 1.5]


def lay(rec, cap):
    had = rec.get("endcap"); rec["endcap"] = cap if not had else (had if isinstance(had, list) else [had]) + [cap]


def autopatch(p, st, n=N, r_=R, at=()):
    import cv2
    rec = p[st]
    for a in at:
        w, r1 = a.rsplit(":", 1)
        c = rec["nodes"][0]["p"] if w == "first" else rec["nodes"][-1]["p"] if w == "last" else [float(v) for v in w.split(",")]
        lay(rec, jdendcap.endcap(st, rec, float(r1), list(c), others_near(p, st, c, float(r1))))
        print(st, "patch at", w, c, "r", r1)
    piece, _, O = J.job_of(st); ring = J.ref_ring(piece)
    for _ in range(n):
        x1, y1 = ring.min(0) - J.PPN * 0.3; x2, y2 = ring.max(0) + J.PPN * 0.3
        r = PX / J.PPN; W, H = int((x2 - x1) * r) + 1, int((y2 - y1) * r) + 1
        A, Bm = J.ink([rec["nodes"]], [ring], O, x1, y1, r, H, W)
        A = A.astype(bool)
        if rec.get("endcap"):
            A = jdendcap.apply(A, rec["endcap"], O, x1, y1, r)
        miss = cv2.morphologyEx((A ^ Bm.astype(bool)).astype(np.uint8), cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
        k_, _, stats, cen = cv2.connectedComponentsWithStats(miss)
        if k_ < 2:
            break
        k = 1 + stats[1:, cv2.CC_STAT_AREA].argmax()
        if stats[k, cv2.CC_STAT_AREA] < MIN:
            break
        c = (np.array([cen[k][0] / r + x1, cen[k][1] / r + y1]) - O) / J.PPN
        lay(rec, jdendcap.endcap(st, rec, r_, list(c), others_near(p, st, c, r_)))
        print(st, "patch at", c.round(3), "area", stats[k, cv2.CC_STAT_AREA])
    return p


if __name__ == "__main__":
    src, dst, st = sys.argv[1:4]
    p = autopatch(json.load(open(src)), st, int(sys.argv[4]) if len(sys.argv) > 4 else N,
                  float(sys.argv[5]) if len(sys.argv) > 5 else R, sys.argv[6:])
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    json.dump(p, open(dst, "w"))
