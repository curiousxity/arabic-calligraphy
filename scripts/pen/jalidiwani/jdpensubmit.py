"""Pen-held fits of Jali Diwani strokes on the Geekmini (jdpenjob.py through the queue's "scan" mode, scanjob.py).
  python jdpensubmit.py submit QUEUE TAG [--env K=V ...] stroke ...   one job per stroke, "shape.sN" or a bare shape
  python jdpensubmit.py collect QUEUE TAG OUTDIR                    OUTDIR/pen.json merged, each stroke's picture a png
The bundle (QUEUE/bundles/jd-TAG.zip) holds this folder's jdcatalog.py and jdpenjob.py beside a copy of the queue's
own code/ (so the fit runs the code the workers run), and the data jdcatalog reads: JD_STUDIO_DATA, JD_COMPOSED and
JD_EXACT as set here. Job files go straight into QUEUE/todo; the queue's code is never synced (jdsubmit.py)."""
import base64, glob, json, os, socket, sys, zipfile
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
cmd, q, tag, rest = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:]
info_f = os.path.join(q, "bundles", f"jd-{tag}.jobs.json")
if cmd == "submit":
    from jdcatalog import strokes
    env = {"JD_STUDIO_DATA": "{bundle}/studio-data", "JD_COMPOSED": "{bundle}/composed.json",
           "JD_EXACT": "{bundle}/stamps.exact.json", "JD_WORK": "{bundle}/work"}
    while rest and rest[0] == "--env":
        k, v = rest[1].split("=", 1); env[k] = v; rest = rest[2:]
    names = [s for x in rest for s in ([x] if "." in x else [f"{x}.{sid}" for sid, _ in strokes(x)])]
    z = os.path.join(q, "bundles", f"jd-{tag}.zip"); tmp = z + f".{socket.gethostname()}.tmp"
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in glob.glob(os.path.join(q, "code", "*.py")):
            zf.write(f, "jd/" + os.path.basename(f))
        for f in ("jdcatalog.py", "jdpenjob.py"):
            zf.write(os.path.join(HERE, f), "jd/" + f)
        # this branch's gpufit over the queue's, until the queue's has window_worst's runaway check (2026-10-26: a
        # runaway on the mark T21.s0 drew a 15 GB raster) and _ink_b's guard for a batch wholly out of frame (2026-10-27,
        # T21.s0 again); a duplicate name in a zip, the later entry wins on extract
        qg = open(os.path.join(q, "code", "gpufit.py"), encoding="utf-8").read()
        if "far > RUNAWAY:\n        return far" not in qg or "max(1, int(pw.max()))" not in qg:
            zf.write(os.path.join(HERE, "..", "gpufit.py"), "jd/gpufit.py")
        data = os.environ["JD_STUDIO_DATA"]
        for f in ("db.json", "stamps.pack.json", "inkbox.json", "marks-kinds.json"):
            zf.write(os.path.join(data, f), "studio-data/" + f)
        zf.write(os.environ["JD_COMPOSED"], "composed.json")
        zf.write(os.environ["JD_EXACT"], "stamps.exact.json")
        zf.writestr("work/.keep", "")
    os.replace(tmp, z)
    jobs = []
    for st in names:
        name = f"jdpen-{tag}-{st}"
        job = {"name": name, "mode": "scan", "bundle": os.path.basename(z), "argv": ["jd/jdpenjob.py", "{out}", st], "env": env}
        dst = os.path.join(q, "todo", name + ".json"); t = dst + f".{socket.gethostname()}.tmp"
        open(t, "w").write(json.dumps(job)); os.replace(t, dst); jobs.append(name)
    json.dump({"names": jobs, "strokes": names}, open(info_f, "w"))
    print(os.path.basename(z), len(jobs), "jobs:", " ".join(names))
else:
    out = rest[0]; os.makedirs(out, exist_ok=True)
    info = json.load(open(info_f))
    pf = os.path.join(out, "pen.json")
    res, left = (json.load(open(pf)) if os.path.exists(pf) else {}), []
    for name in info["names"]:
        f = os.path.join(q, "done", name + ".json")
        if not os.path.exists(f):
            left.append(name + (" (failed)" if os.path.exists(os.path.join(q, "failed", name + ".json")) else "")); continue
        files = json.load(open(f, encoding="utf-8"))["files"]
        res.update(json.loads(files.get("pen.json", "{}")))
        for st, b64 in json.loads(files.get("pics.json", "{}")).items():
            open(os.path.join(out, st + ".png"), "wb").write(base64.b64decode(b64))
    json.dump(res, open(pf, "w"), indent=1)
    print(len(res), "strokes in", out, "; not yet:", left)
