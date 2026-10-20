"""Where our ink pokes furthest past the studio's: per shape, the worst spots (> 0.08 nuqta), and a close-up of each.
python jdpoke.py QUEUE OUTPREFIX id [id ...]   (JD_PREFER as jdsheet)"""
import os, sys
import numpy as np, cv2
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(sys.argv[1], "code"))
argv = sys.argv; sys.argv = argv[:2] + ["x", "100"]
import jdsheet
PX, UP = 100.0, 4; nq = PX * UP
jdsheet.PX, jdsheet.SC = PX, PX / jdsheet.PPN
for k in argv[3:]:
    hulls, rings, info = jdsheet.shape(k); A, B = jdsheet.masks(hulls, rings)
    D = cv2.distanceTransform((1 - B).astype(np.uint8), cv2.DIST_L2, 5) * ((A & (1 - B)) > 0)
    spots = []
    for _ in range(4):
        y, x = np.unravel_index(D.argmax(), D.shape); v = D[y, x] / nq
        if v < 0.08: break
        spots.append((v, x, y)); cv2.circle(D, (int(x), int(y)), int(0.6 * nq), 0, -1)
    H, W = A.shape; img = np.full((H, W, 3), 255, np.uint8)
    img[(A & B) > 0] = (150, 150, 150); img[(A & (1 - B)) > 0] = (30, 30, 200); img[(B & (1 - A)) > 0] = (220, 80, 30)
    for i, (v, x, y) in enumerate(spots):
        r = int(0.7 * nq); c = img[max(0, y - r):y + r, max(0, x - r):x + r]
        cv2.imwrite(f"{argv[2]}_{k}_{i}.png", cv2.resize(c, None, fx=0.5, fy=0.5, interpolation=cv2.INTER_AREA))
        print(k, i, "out %.2f nuqta at (%.1f, %.1f) of (%.1f, %.1f)" % (v, x / nq, y / nq, W / nq, H / nq))
