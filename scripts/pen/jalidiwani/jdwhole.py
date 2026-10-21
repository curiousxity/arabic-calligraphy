"""Whole-shape refits (<name>.w): each stroke polished again from its trimmed nodes, scored as the whole letter, its
union with the other strokes (held at their trimmed nodes) against all the letter's pieces.

Every fit so far scores a stroke alone against its own piece, with the neighbours' ground ignored, so where two
strokes meet neither sees the other's ink: a cap that pokes past the letter's outline beside a neighbour, or stops
short of it, costs that stroke nothing. The smoothing check of 2026-10-21 (jdsmooth.py) found the rough spots the user
saw ("the studio has smoother strokes") at those meetings and at caps, none along an edge. fitjob's own "refine" mode
with `pieces` = the letter and `others` = the neighbours' nodes scores exactly that; the shared code is unchanged.

python jdwhole.py QUEUE NODES_DIR id [id ...]   NODES_DIR: <id>.json {sid: nodes} (jdtrim.py's output)."""
import json, os, socket, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from jdcatalog import strokes, job, transform

EDGE, ROUGH = 5.0, 0.05  # the second pass's outline weight; the fit's own smoothness weight

if __name__ == "__main__":
    q, nd, ids = sys.argv[1], sys.argv[2], sys.argv[3:]
    n = 0
    for k in ids:
        d_of = dict(strokes(k)); Tk = transform(k)
        nodes = json.load(open(os.path.join(nd, k + ".json")))
        for sid, ns in nodes.items():
            j = job(k, sid, d_of[sid])
            j.update(name=j["name"] + ".w", mode="refine", start=ns, ignore=[],
                     pieces=[[Tk, d] for _, d in strokes(k)],
                     refine={"rough": ROUGH, "edge": EDGE, "others": [o for osid, o in nodes.items() if osid != sid]})
            dst = os.path.join(q, "todo", j["name"] + ".json"); tmp = dst + f".{socket.gethostname()}.tmp"
            open(tmp, "wb").write(json.dumps(j).encode()); os.replace(tmp, dst); n += 1
    print("queued", n)
