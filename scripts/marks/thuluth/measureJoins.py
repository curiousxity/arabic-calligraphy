"""Measure the ends of the Thuluth pieces, so the schema's join thresholds
come from data (stroke-cuts.md: measure before loosening a detector).
usage: python -I -X utf8 scripts/marks/thuluth/measureJoins.py

For every vector piece, by its position (starting, middle, finishing), print
the end run's thickness in pens, how many ink runs the end column holds,
and its slope, at the ends a join needs: the right end (entry) of middle and
finishing forms, the left end (exit) of starting and middle forms. Then the
percentiles per end."""
import sys, os, numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from joinGeometry import library, Ink, end_run, PEN

stats = {"right": [], "left": []}
for i, n, w, h, d in library():
    if not i.startswith("thuluth-v"): continue
    pos = n.split(", ")[-2] if n.count(", ") >= 2 else ""
    need = {"middle": ("right", "left"), "finishing": ("right",), "starting": ("left",)}.get(pos, ())
    if not need: continue
    ink = Ink(d)
    for side in need:
        r = end_run(ink, side)
        if r is None: print(i, side, "EMPTY"); continue
        stats[side].append((r["thick"] / PEN, r["runs"], r["slope"]))
        print(f"{i:18s} {side:5s} thick {r['thick'] / PEN:4.2f} pen  runs {r['runs']}  slope {r['slope']:+.2f}  {n}")
for side, v in stats.items():
    a = np.array(v)
    if not len(a): continue
    print(f"\n{side}: n={len(a)} thick p10/50/90 = {np.percentile(a[:, 0], [10, 50, 90]).round(2)}  one-run share {np.mean(a[:, 1] == 1):.2f}  |slope| p90 {np.percentile(abs(a[:, 2]), 90):.2f}")
