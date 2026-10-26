"""Second passes, as the Thuluth catalogue's repass.py: every stroke whose best fit is under 0.92 overlap or more than
0.12 nuqta off the studio's outline anywhere is fitted again tighter (nodes 0.2 nuqta apart, outline weighed five
times), as <name>.u. Job files go straight into QUEUE/todo; code is never synced (see jdsubmit.py).
python jdrepass.py QUEUE"""
import json, os, socket, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from jdcatalog import strokes, job, PREFIX
q = sys.argv[1]
reg = json.load(open(os.path.join(os.environ.get("JD_WORK") or HERE, "registry.json")))
done = lambda n: os.path.exists(os.path.join(q, "done", n + ".json"))
queued = lambda n: done(n) or os.path.exists(os.path.join(q, "todo", n + ".json")) or any(
    f.split("@")[0] == n for f in os.listdir(os.path.join(q, "running")))
n = 0
for h, fit in reg["fits"].items():
    name = fit["job"]
    if not done(name) or queued(name + ".u"):
        continue
    s = json.load(open(os.path.join(q, "done", name + ".json")))["score"]
    if s["iou"] < 0.92 or s["gap_max"] > 0.12:
        k, sid = name[len(PREFIX):].split(".")
        j = job(k, sid, dict(strokes(k))[sid]); j.update(name=name + ".u", spacing=0.2, edge=5)
        dst = os.path.join(q, "todo", j["name"] + ".json"); tmp = dst + f".{socket.gethostname()}.tmp"
        open(tmp, "wb").write(json.dumps(j).encode()); os.replace(tmp, dst); n += 1
print("queued", n, "second passes")
