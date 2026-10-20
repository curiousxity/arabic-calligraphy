"""Queue studio shapes' strokes as jd- jobs. python jdsubmit.py QUEUE id [id ...]
Writes job files straight into QUEUE/todo and never syncs code: the queue runs the Thuluth session's fitting code, and
this branch's copy is older (fitqueue.submit would overwrite it). Keeps registry.json: stroke key -> job, and every
shape's strokes -> key."""
import json, os, socket, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from jdcatalog import strokes, key, job
q, ids = sys.argv[1], sys.argv[2:]
reg_f = os.path.join(os.environ.get("JD_WORK") or HERE, "registry.json")
reg = json.load(open(reg_f)) if os.path.exists(reg_f) else {"fits": {}, "shapes": {}}
n = 0
for k in ids:
    reg["shapes"][k] = []
    for sid, d in strokes(k):
        h = key(d)
        reg["shapes"][k].append([sid, h])
        if h in reg["fits"]:
            continue
        j = job(k, sid, d); reg["fits"][h] = {"job": j["name"]}
        dst = os.path.join(q, "todo", j["name"] + ".json")
        for sub in ("done", "failed"):
            for ext in (".json", ".log"):
                try: os.remove(os.path.join(q, sub, j["name"] + ext))
                except FileNotFoundError: pass
        tmp = dst + f".{socket.gethostname()}.tmp"
        open(tmp, "wb").write(json.dumps(j).encode()); os.replace(tmp, dst); n += 1
json.dump(reg, open(reg_f, "w"))
print("queued", n, "strokes for", len(ids), "shapes")
