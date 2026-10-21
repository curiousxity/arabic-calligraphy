"""The studio's Jali Diwani shapes (scratchpad studio-data, saved 2026-10-20 with the user's OK) as fitting jobs.

As the Thuluth catalogue (that session's catalog.py), but the studio draws Jali Diwani 5.58x smaller: 4.644 units to
the dot and a 3.6-unit pen (measured; docs/calligraphy/jali-diwani-ledger.md). Each piece is scaled by S in its
transform, never in the data, so the fitter works at Thuluth's 25.9 px to the nuqta. Job names start "jd-".

Where the plate wins over the studio (the dal, 2026-10-20), the letter is cut from Hashim's page by jdplatecut.py into
JD_WORK/plates.json and served here under its own key (h65-dal), with its own transform: strokes(), origin(),
transform() and job() answer for both kinds, and db has a label entry for each plate shape."""
import hashlib, json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.environ.get("JD_STUDIO_DATA") or os.path.join(HERE, "..", "studio-data")
WORK = os.environ.get("JD_WORK") or HERE
UPD, PEN_U = 4.644, 3.6          # studio units to the dot; the studio's pen in units
PPN = 25.9                        # screen px to the nuqta, as Thuluth's
S = PPN / UPD                     # studio unit -> screen px
PEN = PEN_U * S
T = [S, S, 0, 0]
db = json.load(open(os.path.join(DATA, "db.json"), encoding="utf-8"))
stamps = json.load(open(os.path.join(DATA, "stamps.pack.json"), encoding="utf-8"))
inkbox = json.load(open(os.path.join(DATA, "inkbox.json"), encoding="utf-8"))
_pf = os.path.join(WORK, "plates.json")
plates = json.load(open(_pf, encoding="utf-8")) if os.path.exists(_pf) else {}
for _k, _p in plates.items():
    db.setdefault(_k, {"group": "plate", "form": _k, "variant": "hashim"})


def strokes(k):
    if k in plates:
        return [tuple(s) for s in plates[k]["strokes"]]
    return re.findall(r'<g id="(s\d+)"><path d="([^"]+)"', stamps[k])


def transform(k):
    """The piece transform for shape k: the studio's scale, or the plate's (page px -> screen px by its nib)."""
    return plates[k]["T"] if k in plates else T


def ring(k, d, fine=4):
    """The outline of stroke d of shape k in screen px, sampled `fine` points to the screen px. pieces.ref_ring samples
    in the piece's own units before scaling, a point every 0.2 nuqta for the studio's, which draws its curves as
    polygons on a sheet at 80+ px to the nuqta."""
    from ribbon import parse, ring_samples  # the queue's code, on the path wherever this is called from a sheet
    a, dd, e, f = transform(k)
    segs = [tuple((x * a * fine, y * dd * fine) for x, y in s) for s in parse(d)]
    r = ring_samples(segs)[0] / fine
    return r + [e, f]


def key(d):
    """The outline moved to its own corner, hashed: the same stroke drawn in two shapes has one key."""
    nums = [float(x) for x in re.findall(r"-?\d+\.?\d*", d)]
    x0, y0 = min(nums[0::2]), min(nums[1::2])
    return hashlib.sha1(" ".join("%.2f %.2f" % (x - x0, y - y0) for x, y in zip(nums[0::2], nums[1::2])).encode()).hexdigest()[:16]


def origin(k):
    """x at the shape's right-most ink, y = 0 at the stamp's top. inkbox is measured from the stamp's 2-unit margin, so
    the margin goes back on (Thuluth's catalogue leaves it off: 0.08 nuqta there, 0.43 here)."""
    if k in plates:
        return list(plates[k]["origin"])
    return [(inkbox[k][2] + 2) * S, 0.0]


def job(k, sid, d):
    Tk = transform(k)
    return {"name": f"jd-{k}.{sid}", "piece": [Tk, d], "origin": origin(k), "ppn": PPN, "pen": PEN,
            "ignore": [[Tk, od] for osid, od in strokes(k) if osid != sid]}
