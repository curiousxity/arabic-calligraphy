#!/usr/bin/env python3
"""Audit the shipped stroke-spine tables' point ORDER against the contract in
src/lib/strokeSpines/types.ts: "ordered from the zone's fromNode end to its
toNode end".

Reads only the committed JSON tables and the fonts. It deliberately shares NO
code with scripts/deriveStrokeSpines.py — own schema loader, own bezier
flattener (32 segments against the generator's 8), own port of the
proportional seed mapping, and a real-glyph box computed two different ways —
so that it can disagree with the generator. Sharing a helper would make it
restate the generator's decision instead of testing it.

Three criteria, reported per font and split full-stroke vs partial zone.
Keeping that split is the point of this script: for a FULL-stroke zone the
slice's endpoints ARE the branch's endpoints, so criteria A and B restate the
orientation rule the generator already applied and cannot fail. Every audit
before 2026-08-14 measured only those, and so could not see 35 partial-zone
spines that were running backwards.

  A  the stroke's node0 seed: is points[0] nearer it than points[-1] is?
     (Near-tautological. Retained because it is what the Task 3 re-review
     measured, and reproducing it is how the 0-vs-4 disagreement between the
     two reviews was resolved as a difference of criteria, not of fact.)
  B  the ZONE's own fromNode seed, same question — the literal contract.
     Also cross-checked against the zone's toNode seed.
  C  translation-invariant direction: the sign of
     dot(points[-1] - points[0], seed(toNode) - seed(fromNode)). Cancels any
     uniform offset in the mapping, so it errs differently from A and B.

Every criterion is derived from the proportional schema->glyph mapping this
project exists to replace (median 0.37 nuqta / p90 1.43 from real ink), since
the schema is the only source of which end of a stroke is its fromNode. Treat
a sub-0.5-nuqta verdict here as noise, not as a finding.

Usage:
    python3 scripts/auditSpineOrientation.py                      # all fonts
    python3 scripts/auditSpineOrientation.py tight                # BoundsPen boxes
    python3 scripts/auditSpineOrientation.py --tables DIR         # e.g. an older
        # revision's tables extracted with `git show REV:path > DIR/Font.json`
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FONT_DIR = ROOT / "public" / "fonts"
TABLE_DIR = ROOT / "src" / "data" / "strokeSpines"
SCHEMA_DIR = ROOT / "src" / "data" / "strokeSchemas"

from fontTools.ttLib import TTFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.basePen import BasePen


def ratios():
    src = (ROOT / "src" / "lib" / "nuqta.ts").read_text()
    body = src.split("NUQTA_EM_RATIO", 1)[1].split("{", 1)[1].split("}", 1)[0]
    return {m.group(1): float(m.group(2)) for m in re.finditer(r"(\w+)\s*:\s*([0-9.]+)", body)}


def load_schemas():
    out = {}
    for p in sorted(SCHEMA_DIR.glob("*.json")):
        d = json.loads(p.read_text())
        g = d.get("glyph", {})
        if "id" in g:
            out[g["id"]] = d
    return out


class Flat(BasePen):
    def __init__(self, gs):
        super().__init__(gs)
        self.contours = []
        self._cur = []

    def _moveTo(self, pt):
        if self._cur:
            self.contours.append(self._cur)
        self._cur = [pt]

    def _lineTo(self, pt):
        self._cur.append(pt)

    def _curveToOne(self, p1, p2, p3):
        p0 = self._cur[-1]
        for i in range(1, 33):
            t = i / 32
            u = 1 - t
            self._cur.append((
                u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0],
                u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]))

    def _closePath(self):
        if self._cur:
            self.contours.append(self._cur)
            self._cur = []


def boxes(tt, name):
    gs = tt.getGlyphSet()
    bp = BoundsPen(gs)
    gs[name].draw(bp)
    tight = bp.bounds
    rec = DecomposingRecordingPen(gs)
    gs[name].draw(rec)
    f = Flat(gs)
    rec.replay(f)
    if f._cur:
        f.contours.append(f._cur)
    pts = [p for c in f.contours for p in c]
    flat = (min(p[0] for p in pts), min(p[1] for p in pts),
            max(p[0] for p in pts), max(p[1] for p in pts)) if pts else None
    return tight, flat


def mapper(desc, box):
    xs = [n["x"] for c in desc["glyph"]["components"] for s in c["strokes"] for n in s["path"]["nodes"]]
    ys = [n["y"] for c in desc["glyph"]["components"] for s in c["strokes"] for n in s["path"]["nodes"]]
    sx0, sx1, sy0, sy1 = min(xs), max(xs), min(ys), max(ys)
    sw, sh = max(sx1 - sx0, 1e-6), max(sy1 - sy0, 1e-6)
    rx0, ry0, rx1, ry1 = box
    return lambda x, y: (rx0 + (x - sx0) / sw * (rx1 - rx0), ry0 + (y - sy0) / sh * (ry1 - ry0))


def dist(p, q):
    return ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2) ** 0.5


def clamp(i, n):
    if i is None:
        return None
    return i if 0 <= i < n else None


def audit(family, bbox_kind="flat", table_dir=None):
    r = ratios()[family]
    fp = next(p for ext in (".ttf", ".otf") for p in [FONT_DIR / f"{family}{ext}"] if p.exists())
    tt = TTFont(fp, fontNumber=0, lazy=False)
    if "gvar" in tt:  # Kufi2/NotoSans: gvar glyph count disagrees with maxp
        del tt["gvar"]
    upm = tt["head"].unitsPerEm
    nq = upm * r
    order = tt.getGlyphOrder()
    schemas = load_schemas()
    table = json.loads(((table_dir or TABLE_DIR) / f"{family}.json").read_text())
    rows = []
    for gid, entry in table["glyphs"].items():
        desc = schemas[entry["schemaGlyph"]]
        name = order[int(gid)]
        tight, flat = boxes(tt, name)
        box = flat if bbox_kind == "flat" else tight
        mp = mapper(desc, box)
        strokes = {s["id"]: s for c in desc["glyph"]["components"] for s in c["strokes"]}
        for sp in entry["spines"]:
            st = strokes[sp["strokeId"]]
            nodes = st["path"]["nodes"]
            n = len(nodes)
            z = st["editBehavior"]["stretchZones"][sp["zoneIndex"]]
            fi, ti = clamp(z.get("fromNode"), n), clamp(z.get("toNode"), n)
            pts = sp["points"]
            p0, p1 = (pts[0]["x"], pts[0]["y"]), (pts[-1]["x"], pts[-1]["y"])
            s_from = mp(nodes[0]["x"], nodes[0]["y"])
            z_from = mp(nodes[fi]["x"], nodes[fi]["y"])
            z_to = mp(nodes[ti]["x"], nodes[ti]["y"])
            A_fwd = dist(p0, s_from) < dist(p1, s_from)
            A_delta = abs(dist(p0, s_from) - dist(p1, s_from)) / nq
            B_fwd = dist(p0, z_from) < dist(p1, z_from)
            B_delta = abs(dist(p0, z_from) - dist(p1, z_from)) / nq
            Bto_fwd = dist(p1, z_to) < dist(p0, z_to)
            vx, vy = p1[0] - p0[0], p1[1] - p0[1]
            wx, wy = z_to[0] - z_from[0], z_to[1] - z_from[1]
            C_dot = vx * wx + vy * wy
            C_norm = C_dot / max(((vx*vx+vy*vy)**0.5) * ((wx*wx+wy*wy)**0.5), 1e-9)
            rows.append(dict(
                font=family, gid=gid, schemaGlyph=entry["schemaGlyph"], strokeId=sp["strokeId"],
                zoneIndex=sp["zoneIndex"], fromNode=fi, toNode=ti, nnodes=n,
                full=({fi, ti} == {0, n - 1}),
                A_fwd=A_fwd, A_delta=A_delta, B_fwd=B_fwd, B_delta=B_delta,
                Bto_agrees=(Bto_fwd == B_fwd), C_fwd=(C_dot > 0), C_cos=C_norm))
    return rows


if __name__ == "__main__":
    argv = sys.argv[1:]
    if "--tables" in argv:
        k = argv.index("--tables")
        TABLE_DIR = Path(argv[k + 1]).resolve()
        del argv[k:k + 2]
    bbox_kind = "flat"
    if argv and argv[0] in ("flat", "tight"):
        bbox_kind, argv = argv[0], argv[1:]
    fams = argv or sorted(p.stem for p in TABLE_DIR.glob("*.json"))
    allrows = []
    print(f"bbox={bbox_kind}")
    hdr = f"{'font':<18}{'n':>5}{'A_rev':>7}{'B_rev':>7}{'B_revD':>8}{'C_rev':>7}  | partial-only: A_rev B_rev C_rev / npartial"
    print(hdr)
    for f in fams:
        rows = audit(f, bbox_kind=bbox_kind, table_dir=TABLE_DIR)
        allrows += rows
        part = [r for r in rows if not r["full"]]
        print(f"{f:<18}{len(rows):>5}{sum(not r['A_fwd'] for r in rows):>7}"
              f"{sum(not r['B_fwd'] for r in rows):>7}"
              f"{sum((not r['B_fwd']) and r['B_delta']>=0.5 for r in rows):>8}"
              f"{sum(not r['C_fwd'] for r in rows):>7}  | "
              f"{sum(not r['A_fwd'] for r in part):>5}{sum(not r['B_fwd'] for r in part):>6}"
              f"{sum(not r['C_fwd'] for r in part):>6} / {len(part)}")
    full = [r for r in allrows if r["full"]]
    part = [r for r in allrows if not r["full"]]
    print(f"\nTOTAL n={len(allrows)} full={len(full)} partial={len(part)}")
    for label, rs in (("full", full), ("partial", part)):
        print(f"  {label:8} A_rev={sum(not r['A_fwd'] for r in rs):3}  "
              f"B_rev={sum(not r['B_fwd'] for r in rs):3}  "
              f"B_rev_decisive={sum((not r['B_fwd']) and r['B_delta']>=0.5 for r in rs):3}  "
              f"C_rev={sum(not r['C_fwd'] for r in rs):3}")

