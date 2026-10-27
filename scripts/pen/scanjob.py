"""A laptop script run on a worker, for CPU work the laptop is too slow for: the defect scans of the studio sheets
first (the user, 2026-10-24: "If you can transfer this job to the geekmini do it"). fitjob.py runs it for mode "scan":
    bundle   a zip in the queue's bundles/ folder: the scripts and the data they read, laid out as the laptop's
             scratchpad is (me/, studio/, studio-data/), with scripts/pen beside them, since sheet.py imports from it
    argv     the script and its arguments, relative to the bundle; "{out}" is a folder whose .json files come back
    env      extra environment; "{bundle}" in a value is the bundle's folder
The script reads the queue's done/ folder through HARF_Q (look.py). It runs by scanrun.py, which stands in for PIL
where the worker has none. The result: {name, kind "scan", files {name: text}, log, seconds, host, score}."""
import hashlib, os, shutil, socket, subprocess, sys, tempfile, time, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))


def _unpack(z):
    """The bundle, unpacked once on this computer under its hash (jobs sharing a bundle share the folder)."""
    blob = open(z, "rb").read()
    d = os.path.join(tempfile.gettempdir(), "harf-scan", hashlib.sha1(blob).hexdigest()[:12])
    if not os.path.exists(d):
        tmp = tempfile.mkdtemp(dir=os.path.dirname(d) if os.path.isdir(os.path.dirname(d)) else None)
        zipfile.ZipFile(z).extractall(tmp)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        try:
            os.rename(tmp, d)
        except OSError:  # another job unpacked it first
            shutil.rmtree(tmp, ignore_errors=True)
    return d


def run(job):
    t = time.time()
    q = job["_queue"]
    d = _unpack(os.path.join(q, "bundles", job["bundle"]))
    out = tempfile.mkdtemp(prefix="harf-scan-out-")
    argv = [a.replace("{out}", out) for a in job["argv"]]
    env = dict(os.environ, HARF_Q=q, PYTHONIOENCODING="utf-8",
               **{k: v.replace("{bundle}", d) for k, v in job.get("env", {}).items()})
    p = subprocess.run([sys.executable, "-X", "utf8", "-B", os.path.join(HERE, "scanrun.py")] + argv, cwd=d, env=env,
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    log = (p.stdout + p.stderr)[-4000:]
    print(log, flush=True)
    if p.returncode:
        raise RuntimeError(f"{job['argv'][0]} exited {p.returncode}")
    files = {}
    for f in os.listdir(out):
        if f.endswith(".json"):
            files[f] = open(os.path.join(out, f), encoding="utf-8").read()
    shutil.rmtree(out, ignore_errors=True)
    return {"name": job["name"], "kind": "scan", "nodes": [], "files": files, "log": log, "score": {"iou": 0.0},
            "seconds": round(time.time() - t), "host": os.environ.get("HARF_WORKER") or socket.gethostname(),
            "cpus": os.cpu_count(), "gpu": False,
            "settings": {"bundle": job["bundle"], "argv": job["argv"]}}
