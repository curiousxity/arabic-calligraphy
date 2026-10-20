"""Jali Diwani comparison sheet: per shape, ours | the studio's | overlay (ours only red, studio only blue).
python jdsheet.py QUEUE OUT.png PX id [id ...]   PX: output px to the nuqta. Prints per shape overlap and per stroke
results. Both inks drawn at 4x and scaled down alike, as the Thuluth sheets (that session's sheet.py)."""
import json, os, sys
import numpy as np, cv2
from PIL import Image, ImageDraw, ImageFont
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(sys.argv[1], "code"))  # the queue's own code draws what it fitted
from jdcatalog import db, strokes, origin, transform, PPN, PEN
from pieces import ref_ring, path_hulls
q, out, PX, ids = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4:]
reg = json.load(open(os.path.join(os.environ.get("JD_WORK") or HERE, "registry.json")))
SC, UP = PX / PPN, 4
PAPER, INK = (246, 240, 228), (66, 52, 40)
fnt = ImageFont.truetype("segoeui.ttf", 15)


PREFER = os.environ.get("JD_PREFER", "")  # e.g. ".e": that pass where it exists


def result(name):
    """The pass named in JD_PREFER where it exists; else the best of the first fit and its second pass (.u), by
    overlap less the 95th-percentile outline gap, as the Thuluth sheets choose."""
    f = os.path.join(q, "done", name + PREFER + ".json")
    if PREFER and os.path.exists(f):
        return json.load(open(f, encoding="utf-8"))
    rs = [json.load(open(f, encoding="utf-8")) for f in (os.path.join(q, "done", name + x + ".json") for x in ("", ".u"))
          if os.path.exists(f)]
    return max(rs, key=lambda r: r["score"]["iou"] - r["score"]["gap95"]) if rs else None


NODES = os.environ.get("JD_NODES", "")  # a folder of <id>.json {sid: nodes} (jdtrim.py) to draw instead of the queue's


def shape(k):
    hulls, rings, info = [], [], []
    d_of = dict(strokes(k)); Tk = transform(k)
    f = os.path.join(NODES, k + ".json") if NODES else ""
    if f and os.path.exists(f):
        for sid, nodes in json.load(open(f)).items():
            rings.append(ref_ring([Tk, d_of[sid]])); hulls += path_hulls(nodes, np.array(origin(k)), PPN, PEN)
            info.append(f"{sid}: trimmed, {len(nodes)} nodes")
        return hulls, rings, info
    for sid, h in reg["shapes"][k]:
        rings.append(ref_ring([Tk, d_of[sid]]))
        r = result(reg["fits"][h]["job"])
        if r is None:
            info.append(f"{sid}: waiting"); continue
        k0 = reg["fits"][h]["job"][3:].split(".")[0]
        assert k0 == k, "a stroke shared with another shape needs its corner offset"
        hulls += path_hulls(r["nodes"], np.array(origin(k)), PPN, PEN)
        info.append(f"{sid}: {r['name'][-2:] if r['name'][-2:] in ('.u', '.e') else 'first'} {r['kind']} {r['score']['iou']:.3f} gap95 {r['score']['gap95']:.2f} max {r['score']['gap_max']:.2f}")
    return hulls, rings, info


def masks(hulls, rings):
    pts = np.concatenate(rings + hulls)
    x1, y1 = pts.min(0) - 4; x2, y2 = pts.max(0) + 4
    W, H = (int((x2 - x1) * SC) + 1) * UP, (int((y2 - y1) * SC) + 1) * UP
    px = lambda r: np.round((np.asarray(r) - [x1, y1]) * SC * UP * 16).astype(np.int32)
    A, B = np.zeros((H, W), np.uint8), np.zeros((H, W), np.uint8)
    for h in hulls:
        cv2.fillConvexPoly(A, cv2.convexHull(px(h)), 1, cv2.LINE_8, 4)
    for r in rings:
        L = np.zeros_like(B); cv2.fillPoly(L, [px(r)], 1, cv2.LINE_8, 4); B |= L
    return A, B


def down(m):
    return cv2.resize(m.astype(np.float32), (m.shape[1] // UP, m.shape[0] // UP), interpolation=cv2.INTER_AREA)[..., None]


def ink(m):
    c = down(m); return Image.fromarray((np.array(PAPER, np.float32) * (1 - c) + np.array(INK, np.float32) * c).round().astype(np.uint8))


def diff(A, B):
    a, b = down(A & (1 - B)), down(B & (1 - A)); both = down(A & B)
    img = np.array((255, 255, 255), np.float32) * (1 - a - b - both) + np.array((200, 30, 30), np.float32) * a \
        + np.array((30, 80, 220), np.float32) * b + np.array((150, 150, 150), np.float32) * both
    return Image.fromarray(img.clip(0, 255).round().astype(np.uint8))


cells = []
for k in ids:
    hulls, rings, info = shape(k)
    A, B = masks(hulls, rings) if hulls else masks([], rings)
    iou = (A & B).sum() / max(1, (A | B).sum())
    # how far our ink pokes out past the studio's, and falls short of it, in nuqta: slivers and barbs the overlap misses
    nq = PX * UP
    poke = cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5)[(A & (1 - B)) > 0].max(initial=0) / nq
    short = cv2.distanceTransform((1 - A).astype(np.uint8), cv2.DIST_L2, 5)[(B & (1 - A)) > 0].max(initial=0) / nq
    e = db[k]; print(k, e["group"], e["form"], "v" + e["variant"], "overlap %.3f out %.2f short %.2f" % (iou, poke, short), "|", "; ".join(info))
    cells.append((f"{k} {e['group']} {e['form']} v{e['variant']}  overlap {iou:.3f}  out {poke:.2f}  short {short:.2f} nuqta", [ink(A), ink(B), diff(A, B)]))
if __name__ == "__main__":
    PAD = 14
    W = max(sum(t.width for t in ts) + 4 * PAD for _, ts in cells)
    H = sum(max(t.height for t in ts) + 2 * PAD + 22 for _, ts in cells) + 40
    sheet = Image.new("RGB", (W, H), "white"); d = ImageDraw.Draw(sheet)
    d.text((PAD, 8), "ours | reference (the studio; Hashim's p. 65 for plate shapes) | difference (red: ours only, blue: reference only, grey: both)", fill=(60, 60, 60), font=fnt)
    y = 40
    for label, ts in cells:
        d.text((PAD, y), label, fill=(20, 20, 20), font=fnt); y += 22
        x = PAD; h = max(t.height for t in ts)
        for t in ts:
            sheet.paste(t, (x, y + h - t.height)); x += t.width + PAD
        y += h + 2 * PAD
    sheet.save(out); print(out, sheet.size)
