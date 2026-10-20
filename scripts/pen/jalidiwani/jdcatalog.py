"""The studio's Jali Diwani shapes (scratchpad studio-data, saved 2026-10-20 with the user's OK) as fitting jobs.

As the Thuluth catalogue (that session's catalog.py), but the studio draws Jali Diwani 5.58x smaller: 4.644 units to
the dot and a 3.6-unit pen (measured; docs/calligraphy/jali-diwani-ledger.md). Each piece is scaled by S in its
transform, never in the data, so the fitter works at Thuluth's 25.9 px to the nuqta. Job names start "jd-"."""
import hashlib, json, os, re
DATA = os.environ.get("JD_STUDIO_DATA") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "studio-data")
UPD, PEN_U = 4.644, 3.6          # studio units to the dot; the studio's pen in units
PPN = 25.9                        # screen px to the nuqta, as Thuluth's
S = PPN / UPD                     # studio unit -> screen px
PEN = PEN_U * S
T = [S, S, 0, 0]
db = json.load(open(os.path.join(DATA, "db.json"), encoding="utf-8"))
stamps = json.load(open(os.path.join(DATA, "stamps.pack.json"), encoding="utf-8"))
inkbox = json.load(open(os.path.join(DATA, "inkbox.json"), encoding="utf-8"))


def strokes(k):
    return re.findall(r'<g id="(s\d+)"><path d="([^"]+)"', stamps[k])


def key(d):
    """The outline moved to its own corner, hashed: the same stroke drawn in two shapes has one key."""
    nums = [float(x) for x in re.findall(r"-?\d+\.?\d*", d)]
    x0, y0 = min(nums[0::2]), min(nums[1::2])
    return hashlib.sha1(" ".join("%.2f %.2f" % (x - x0, y - y0) for x, y in zip(nums[0::2], nums[1::2])).encode()).hexdigest()[:16]


def origin(k):
    """x at the shape's right-most ink, y = 0 at the stamp's top. inkbox is measured from the stamp's 2-unit margin, so
    the margin goes back on (Thuluth's catalogue leaves it off: 0.08 nuqta there, 0.43 here)."""
    return [(inkbox[k][2] + 2) * S, 0.0]


def job(k, sid, d):
    return {"name": f"jd-{k}.{sid}", "piece": [T, d], "origin": origin(k), "ppn": PPN, "pen": PEN,
            "ignore": [[T, od] for osid, od in strokes(k) if osid != sid]}
