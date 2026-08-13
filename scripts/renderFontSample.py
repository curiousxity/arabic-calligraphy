"""Shape Arabic with real HarfBuzz and rasterize, to judge a font's quality.

Mirrors the app's own pipeline (harfbuzzjs -> rtl/arab -> opentype.js outlines)
closely enough for a visual verdict: uharfbuzz shapes, fontTools supplies the
outlines, matplotlib fills them with the even-odd rule so counters stay open.
"""
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.path import Path as MPath
from matplotlib.patches import PathPatch

import uharfbuzz as hb
from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

FONT = sys.argv[1]
OUT = sys.argv[2]
LINES = sys.argv[3:] or ["بسم الله الرحمن الرحيم"]


def shape(path, text):
    with open(path, "rb") as fh:
        data = fh.read()
    face = hb.Face(data)
    font = hb.Font(face)
    buf = hb.Buffer()
    buf.add_str(text)
    buf.direction = "rtl"
    buf.script = "Arab"
    buf.language = "ar"
    hb.shape(font, buf, {"kern": True, "liga": True})
    return buf.glyph_infos, buf.glyph_positions, face.upem


tt = TTFont(FONT, lazy=True)
try:
    tt.reader.tables.pop("gvar", None)
except Exception:
    pass
gs = tt.getGlyphSet()
order = tt.getGlyphOrder()

fig, axes = plt.subplots(len(LINES), 1, figsize=(11, 2.6 * len(LINES)))
if len(LINES) == 1:
    axes = [axes]

for ax, text in zip(axes, LINES):
    infos, poss, upem = shape(FONT, text)
    verts, codes = [], []
    x = y = 0.0
    for info, pos in zip(infos, poss):
        gname = order[info.codepoint]
        pen = DecomposingRecordingPen(gs)
        try:
            gs[gname].draw(pen)
        except Exception:
            pen.value = []
        ox, oy = x + pos.x_offset, y + pos.y_offset
        cur = None
        for op, args in pen.value:
            if op == "moveTo":
                cur = (args[0][0] + ox, args[0][1] + oy)
                verts.append(cur)
                codes.append(MPath.MOVETO)
            elif op == "lineTo":
                verts.append((args[0][0] + ox, args[0][1] + oy))
                codes.append(MPath.LINETO)
            elif op == "curveTo":
                for p in args:
                    verts.append((p[0] + ox, p[1] + oy))
                codes.extend([MPath.CURVE4] * 3)
            elif op == "qCurveTo":
                pts = [p for p in args if p is not None]
                # approximate: treat quadratics as a polyline through points
                for p in pts:
                    verts.append((p[0] + ox, p[1] + oy))
                    codes.append(MPath.LINETO)
            elif op == "closePath":
                verts.append((0, 0))
                codes.append(MPath.CLOSEPOLY)
        x += pos.x_advance
        y += pos.y_advance

    if verts:
        patch = PathPatch(MPath(verts, codes), facecolor="#22314f",
                          edgecolor="none", fill=True)
        ax.add_patch(patch)
    ax.set_xlim(min(v[0] for v in verts) - 100, max(v[0] for v in verts) + 100)
    ax.set_ylim(-upem * 0.6, upem * 1.0)
    ax.set_aspect("equal")
    ax.axis("off")
    ax.set_title(text, fontsize=9, color="#888")

plt.tight_layout()
plt.savefig(OUT, dpi=110, facecolor="white")
print("wrote", OUT)
