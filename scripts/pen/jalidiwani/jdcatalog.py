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
# the studio's shapes were extracted from Omar Uddin's Jali Diwani vector sheet (2026-10-25): JD_EXACT names a
# stamps.exact.json holding the sheet's own strokes laid in each stamp's frame (research t20), served in place of the
# extraction; its pen is the sheet's, 3.8 units (its dot's long side, and its thickest strokes)
_ef = os.environ.get("JD_EXACT")
exact = json.load(open(_ef, encoding="utf-8")) if _ef else {"stamps": {}, "marks": {}}
if _ef:
    PEN_U = exact["pen_u"]
PREFIX = os.environ.get("JD_PREFIX") or "jd-"   # a job name's prefix: a new source gets its own, never reusing old fits
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
# the letters as the studio composes them (2026-10-25, read one at a time from its Letter shapes picker with the Crowns
# switch on): key "family-Form|stamp" -> the stamp's strokes plus its marks (crowns, the kaf's upper stroke, the ط's
# stem, dots) as strokes of their own, named "<mark id>.<stroke id>", e.g. "T05.s0" (the user, 2026-10-25: "treat this
# as a collection of strokes that mesh into each other")
_cf = os.environ.get("JD_COMPOSED") or os.path.join(DATA, "..", "studio-composed", "composed.json")
composed = json.load(open(_cf, encoding="utf-8")) if os.path.exists(_cf) else {"letters": {}, "marks": {}}
mark_kinds = {}
_mk = os.path.join(DATA, "marks-kinds.json")
if os.path.exists(_mk):
    mark_kinds = {k: v["kind"] for k, v in json.load(open(_mk, encoding="utf-8")).items()}
# a mark (crown, dots, the kaf's stroke, the ط's stem) is fitted once, in its own frame and unturned: where it sits on
# each letter is that letter's matrix in composed.json, the variable the user asked for (2026-10-25)
for _k in composed["marks"]:
    db.setdefault(_k, {"group": "mark", "form": mark_kinds.get(_k, "mark"), "variant": _k})


def _is_mark(k):
    return k in composed["marks"] and k not in stamps


def _mark_src(k):
    return exact["marks"].get(k) or composed["marks"].get(k, [])


def _mark_strokes(k):
    """A mark's strokes, a stroke of several dots split into one per dot (T23's two, T27's three): each is its own dab
    of the pen, s0a, s0b, ..."""
    out = []
    for sid, d in _mark_src(k):
        parts = [p.strip() for p in re.split(r"(?=M)", d) if p.strip()]
        out += [(sid, d)] if len(parts) == 1 else [(sid + "abcdefgh"[i], p) for i, p in enumerate(parts)]
    return out


def _affine_d(d, A):
    """An M/C/L/Z outline with every point moved by the 2x3 affine A (exact for cubics)."""
    out, nums = [], []
    for tok in re.findall(r"[MCLZ]|-?\d*\.?\d+(?:e-?\d+)?", d):
        if tok in "MCLZ":
            out.append(tok); continue
        nums.append(float(tok))
        if len(nums) == 2:
            x, y = A[0][0] * nums[0] + A[0][1] * nums[1] + A[0][2], A[1][0] * nums[0] + A[1][1] * nums[1] + A[1][2]
            out.append("%.3f %.3f" % (x, y)); nums = []
    return " ".join(out)


def _mul(P, Q):
    """Two SVG matrices (a b c d e f) composed, P after Q, as a 2x3."""
    a, b, c, d, e, f = P; A = [[a, c, e], [b, d, f]]
    a, b, c, d, e, f = Q; B = [[a, c, e], [b, d, f], [0, 0, 1]]
    return [[sum(A[i][k] * B[k][j] for k in range(3)) for j in range(3)] for i in range(2)]


def strokes(k):
    if k in plates:
        return [tuple(s) for s in plates[k]["strokes"]]
    if "|" in k:
        e = composed["letters"][k]
        out = strokes(e["stamp"])
        for kind, mid, outer, inner in e["marks"]:
            A = _mul(outer, inner); A[0][2] += 2; A[1][2] += 2   # the stamp sits at translate(-2 -2) in the letter
            out += [(f"{mid}.{sid}", _affine_d(d, A)) for sid, d in _mark_src(mid)]
        return out
    if _is_mark(k):
        return _mark_strokes(k)
    if k in exact["stamps"]:
        return [tuple(s) for s in exact["stamps"][k]]
    return re.findall(r'<g id="(s\d+)"><path d="([^"]+)"', stamps[k])


def piece_kind(sid):
    """'body' for a stamp's own stroke, else the mark's kind (crown, nuqta, ...) from the studio's marks-kinds."""
    if "." not in sid:
        return "body"
    mid = sid.split(".")[0]
    return mark_kinds.get(mid) or {"T16": "ta-stem", "T18": "kaf-stroke"}.get(mid, "mark")


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
    if _is_mark(k):                   # a mark has no inkbox: its right-most ink in its own frame
        return [max(float(x) for _, d in _mark_src(k) for x in re.findall(r"-?\d*\.?\d+", d)[0::2]) * S, 0.0]
    return [(inkbox[k][2] + 2) * S, 0.0]


def job(k, sid, d):
    Tk = transform(k)
    return {"name": f"{PREFIX}{k}.{sid}", "piece": [Tk, d], "origin": origin(k), "ppn": PPN, "pen": PEN,
            "ignore": [[Tk, od] for osid, od in strokes(k) if osid != sid]}
