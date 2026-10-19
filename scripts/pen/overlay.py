"""Draw the stroke-library preview (scripts/pen/preview.mjs) over its plates.

    python -I -X utf8 scripts/pen/overlay.py preview.json OUT_DIR

For each item: the plate (or a blank sheet), the vector-set underlay in grey,
each ink stroke in red at half strength (so the ink deepens where strokes
cross, as the app's stroke opacity shows), the centre lines in blue with
their nodes. Cropped to the ink with room around it. One PNG per item."""
import sys, os, json
import numpy as np
import cv2

SUB = 4                      # sub-pixel bits for cv2's anti-aliased drawing
INK = (40, 40, 200)          # BGR red
CENTRE = (200, 90, 20)       # BGR blue
GREY = (150, 150, 150)

def load(path):
    data = np.fromfile(path, dtype=np.uint8)     # unicode-safe on Windows
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise SystemExit(f"cannot read plate {path}")
    return img

def pts(ring):
    return np.round(np.array(ring, dtype=np.float64) * (1 << SUB)).astype(np.int32)

def main(json_path, out_dir):
    doc = json.load(open(json_path, encoding="utf-8"))
    items, zoom = doc["items"], doc.get("zoom", 1)
    for it in items:
        if it["plate"]:
            img = load(it["plate"])
        else:
            w, h = int(it["size"][0]) + 1, int(it["size"][1]) + 1
            img = np.full((h, w, 3), 255, np.uint8)
        if it["underlay"]:
            layer = img.copy()
            cv2.fillPoly(layer, [pts(r) for r in it["underlay"]], GREY, lineType=cv2.LINE_AA, shift=SUB)
            img = cv2.addWeighted(layer, 0.45, img, 0.55, 0)
        for stroke in it["strokes"]:
            if not stroke:
                continue
            layer = img.copy()
            cv2.fillPoly(layer, [pts(r) for r in stroke], INK, lineType=cv2.LINE_AA, shift=SUB)
            img = cv2.addWeighted(layer, 0.5, img, 0.5, 0)
        for line in it["centre"]:
            cv2.polylines(img, [pts(line)], False, CENTRE, 1, lineType=cv2.LINE_AA, shift=SUB)
        for n in it["nodes"]:
            cv2.circle(img, (int(round(n[0] * (1 << SUB))), int(round(n[1] * (1 << SUB)))), 3 << SUB, CENTRE, 1, lineType=cv2.LINE_AA, shift=SUB)
        # crop to the ink, half its size again around it, on a plate
        if it["plate"]:
            allp = [p for s in it["strokes"] for r in s for p in r] + it["nodes"]
            if allp:
                a = np.array(allp)
                x1, y1 = a.min(0); x2, y2 = a.max(0)
                mx, my = (x2 - x1) * 0.5 + 40, (y2 - y1) * 0.5 + 40
                h, w = img.shape[:2]
                img = img[max(0, int(y1 - my)):min(h, int(y2 + my)), max(0, int(x1 - mx)):min(w, int(x2 + mx))]
        if zoom != 1:
            img = cv2.resize(img, None, fx=zoom, fy=zoom, interpolation=cv2.INTER_CUBIC)
        name = "".join(c if c.isalnum() or c in "._-" else "_" for c in it["name"])
        target = os.path.join(out_dir, f"{name}.png")
        ok, buf = cv2.imencode(".png", img)
        buf.tofile(target)
        print(target)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
