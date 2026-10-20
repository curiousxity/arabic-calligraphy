"""A folder queue for pen fits, so the fitting can run on another computer than the one reading the studio.

    python scripts/pen/fitqueue.py work QUEUE [--jobs N]   a worker: fits every job that lands in QUEUE/todo
    python scripts/pen/fitqueue.py status QUEUE            what is waiting, running, done and failed
    python scripts/pen/fitqueue.py retry QUEUE             failed jobs back in line

    from fitqueue import submit, wait                      the reading side: hand jobs over, collect results

QUEUE is any folder every computer can reach (a NAS share). A job is one fitjob.py input file. Each submit copies
the fitting code into QUEUE/code, and a worker runs every job from a local snapshot of that copy, in a process of its
own, so a worker needs no repository, picks up a code change with its next job, and is never caught mid-update.
A job is claimed by renaming it from todo/ to running/, which only one worker can do, so any number of workers on
any number of computers can share a queue. Results land in done/ (or failed/, with the log)."""
import hashlib, json, os, shutil, socket, subprocess, sys, tempfile, time

HERE = os.path.dirname(os.path.abspath(__file__))
CODE = ["fitjob.py", "gpufit.py", "pieces.py", "ribbon.py", "build.py", "fitqueue.py"]
ROOT = ["start-worker.bat", "install-packages.bat", "README.txt"]  # fitqueue/, at the queue's top, for whoever sets a worker up
DIRS = ["todo", "running", "done", "failed", "code"]
HOST = socket.gethostname()


def _dirs(q):
    for d in DIRS:
        os.makedirs(os.path.join(q, d), exist_ok=True)


def _write(path, data):
    """Whole or not at all: a reader on another computer never sees half a file."""
    tmp = path + f".{HOST}.tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def sync_code(q):
    _dirs(q)
    for n in CODE:
        src = open(os.path.join(HERE, n), "rb").read()
        dst = os.path.join(q, "code", n)
        if not os.path.exists(dst) or open(dst, "rb").read() != src:
            _write(dst, src)
    for n in ROOT:
        src = open(os.path.join(HERE, "fitqueue", n), "rb").read()
        dst = os.path.join(q, n)
        if not os.path.exists(dst) or open(dst, "rb").read() != src:
            _write(dst, src)


def submit(q, job):
    """Queue one job (fitjob.py's input); a result of the same name from before is cleared."""
    sync_code(q)
    name = job["name"]
    for d, ext in (("done", ".json"), ("done", ".log"), ("failed", ".json"), ("failed", ".log")):
        try:
            os.remove(os.path.join(q, d, name + ext))
        except FileNotFoundError:
            pass
    _write(os.path.join(q, "todo", name + ".json"), json.dumps(job).encode())


def wait(q, names, poll=3.0, timeout=None, quiet=False):
    """Every named result, once all are in. A failed job raises, with the end of its log."""
    t, left, out = time.time(), set(names), {}
    while left:
        for n in sorted(left):
            if os.path.exists(os.path.join(q, "failed", n + ".json")):
                log = open(os.path.join(q, "failed", n + ".log"), encoding="utf-8", errors="replace").read()
                raise RuntimeError(f"fit {n} failed:\n{log[-2000:]}")
            f = os.path.join(q, "done", n + ".json")
            if os.path.exists(f):
                out[n] = json.load(open(f, encoding="utf-8"))
                left.discard(n)
                if not quiet:
                    r = out[n]
                    print(f"{n}: {r['kind']} iou {r['score']['iou']:.4f} ({r['seconds']}s on {r['host']})", flush=True)
        if left:
            if timeout is not None and time.time() - t > timeout:
                raise TimeoutError("still waiting for " + " ".join(sorted(left)))
            time.sleep(poll)
    return out


def _snapshot(q):
    """The queue's code, copied to this computer under its hash."""
    names = sorted(n for n in os.listdir(os.path.join(q, "code")) if n.endswith(".py"))
    blobs = {n: open(os.path.join(q, "code", n), "rb").read() for n in names}
    h = hashlib.sha1(b"".join(n.encode() + blobs[n] for n in names)).hexdigest()[:12]
    d = os.path.join(tempfile.gettempdir(), "harf-fit-code", h)
    if not os.path.exists(os.path.join(d, "fitjob.py")):
        os.makedirs(d, exist_ok=True)
        for n, b in blobs.items():
            open(os.path.join(d, n), "wb").write(b)
    return d


def _requeue(q, stem):
    try:
        os.replace(os.path.join(q, "running", f"{stem}@{HOST}.json"), os.path.join(q, "todo", stem + ".json"))
    except FileNotFoundError:
        pass


PACKAGES = {"numpy": "numpy", "scipy": "scipy", "cv2": "opencv-python-headless"}


def work(q, jobs):
    # a worker without its packages would take every job and fail it: refuse to start instead
    missing = []
    for mod, pkg in PACKAGES.items():
        try:
            __import__(mod)
        except ImportError:
            missing.append(pkg)
    if missing:
        sys.exit(f"this Python ({sys.executable}) is missing {', '.join(missing)}: run install-packages.bat, then start again")
    _dirs(q)
    # jobs this computer held when it last stopped go back in line
    for f in os.listdir(os.path.join(q, "running")):
        if f.endswith(f"@{HOST}.json"):
            _requeue(q, f[: -len(f"@{HOST}.json")])
    env = dict(os.environ, OMP_NUM_THREADS="1", OPENBLAS_NUM_THREADS="1", MKL_NUM_THREADS="1")
    tmp = os.path.join(tempfile.gettempdir(), "harf-fit-out")
    os.makedirs(tmp, exist_ok=True)
    active = {}  # stem -> (process, log file, out path, start)
    me = os.path.join(q, "code", "fitqueue.py")
    started = open(me, "rb").read() if os.path.exists(me) else None
    try:
        import torch
        gpu = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "none: torch is here but sees no CUDA GPU"
    except ImportError:
        gpu = "none: torch is not installed (install-packages.bat)"
    print(f"worker on {HOST}: {jobs} at a time, queue {q}; GPU {gpu}", flush=True)
    try:
        while True:
            # the worker's own code changed in the queue: take nothing new, and once the jobs in hand are done,
            # hand over to the new code
            updated = started is not None and open(me, "rb").read() != started
            if updated and not active:
                print("the worker's code was updated: restarting", flush=True)
                sys.exit(subprocess.call([sys.executable, me, "work", q, "--jobs", str(jobs)]))
            for stem, (p, logf, out, t0) in list(active.items()):
                if p.poll() is None:
                    continue
                logf.close()
                del active[stem]
                held = os.path.join(q, "running", f"{stem}@{HOST}.json")
                log = os.path.join(tmp, stem + ".log")
                if p.returncode == 0 and os.path.exists(out):
                    _write(os.path.join(q, "done", stem + ".log"), open(log, "rb").read())
                    _write(os.path.join(q, "done", stem + ".json"), open(out, "rb").read())
                    os.remove(held)
                    print(f"done   {stem} ({time.time() - t0:.0f}s)", flush=True)
                else:
                    _write(os.path.join(q, "failed", stem + ".log"), open(log, "rb").read())
                    os.replace(held, os.path.join(q, "failed", stem + ".json"))
                    print(f"FAILED {stem} (see failed/{stem}.log)", flush=True)
            while len(active) < jobs and not updated:
                todo = sorted(f for f in os.listdir(os.path.join(q, "todo")) if f.endswith(".json"))
                if not todo:
                    break
                stem = todo[0][:-5]
                held = os.path.join(q, "running", f"{stem}@{HOST}.json")
                try:
                    os.rename(os.path.join(q, "todo", todo[0]), held)
                except (FileNotFoundError, FileExistsError, PermissionError):
                    time.sleep(0.2)  # another worker took it
                    continue
                code = _snapshot(q)
                out = os.path.join(tmp, stem + ".json")
                if os.path.exists(out):
                    os.remove(out)
                logf = open(os.path.join(tmp, stem + ".log"), "wb")
                # not -I: that drops the user's site-packages, where pip puts packages when Python's own folder is
                # read-only, and every job would fail to import numpy
                p = subprocess.Popen([sys.executable, "-B", os.path.join(code, "fitjob.py"), held, out],
                                     stdout=logf, stderr=subprocess.STDOUT, env=env)
                active[stem] = (p, logf, out, time.time())
                print(f"start  {stem}", flush=True)
            time.sleep(2)
    except KeyboardInterrupt:
        for stem, (p, logf, _, _) in active.items():
            p.terminate()
            p.wait()
            logf.close()
            _requeue(q, stem)
        print("stopped; unfinished jobs are back in todo", flush=True)


def retry(q):
    _dirs(q)
    for f in os.listdir(os.path.join(q, "failed")):
        if f.endswith(".json"):
            os.replace(os.path.join(q, "failed", f), os.path.join(q, "todo", f))
            print("back in line:", f[:-5])
        elif f.endswith(".log"):
            os.remove(os.path.join(q, "failed", f))


def status(q):
    _dirs(q)
    for d in ("todo", "running", "done", "failed"):
        fs = sorted(f[:-5] for f in os.listdir(os.path.join(q, d)) if f.endswith(".json"))
        print(f"{d:8} {len(fs):3}  {' '.join(fs)}")


if __name__ == "__main__":
    cmd, q = sys.argv[1], sys.argv[2]
    if cmd == "work":
        n = int(sys.argv[sys.argv.index("--jobs") + 1]) if "--jobs" in sys.argv else max(1, (os.cpu_count() or 2) - 2)
        work(q, n)
    elif cmd == "status":
        status(q)
    elif cmd == "retry":
        retry(q)
    else:
        sys.exit(__doc__)
