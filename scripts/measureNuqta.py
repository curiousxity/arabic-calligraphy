#!/usr/bin/env python3
"""Measure each font's nuqta (the rhombic dot the nib makes), two ways.

Arabic calligraphy measures stroke length in whole and half nuqta, and the
stroke schemas in src/data/strokeSchemas/ are authored in that unit
(`lengthDots` on every stroke). Converting those to pixels needs the nuqta's
size in each font, and there is no formula for it: the natural guess that the
alif's stem is one nuqta wide FAILS across this library (alif/dot ranges
~0.53 to ~1.68 where the rule predicts 1.00). Hence a measured, per-font
table.

Two independent methods, because neither alone covers every face:

  beh-dot   take the isolated beh (U+0628), keep contours that are compact
            (aspect 0.6-1.6) and on the expected side of the baseline,
            choose the smallest. Fails when base-codepoint glyphs are empty.

  modal     sweep EVERY glyph, keep small compact contours, take the mode of
            their sizes. Dots recur across many letters, so the nuqta is the
            commonest such contour. Needs no cmap, GSUB walk, or naming
            convention — this is the one that can read Qahiri.

Agreement between the two is the confidence signal. Where they disagree
(Ruqaa, Yekan at time of writing) a human should decide.

Usage:
    python3 scripts/measureNuqta.py [FONT ...]        # default: public/fonts/*

Requires: pip install fonttools
"""
import glob
import os
import sys
from collections import Counter

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen

# (codepoint, label, dot sits below the baseline?)
DOTTED = [(0x0628, "beh", True), (0x062C, "jeem", True),
          (0x0646, "noon", False), (0x0641, "feh", False),
          (0x0632, "zay", False), (0x0630, "dhal", False)]


def open_font(path):
    font = TTFont(path, fontNumber=0, lazy=True)
    # Some variable fonts here (Kufi2, NotoSans) have a corrupt `gvar` whose
    # glyph count disagrees with maxp, which makes getGlyphSet() throw. We
    # only want default-instance outlines, so drop it.
    try:
        font.reader.tables.pop("gvar", None)
        if "gvar" in font.tables:
            del font.tables["gvar"]
    except Exception:
        pass
    return font


def merged_cmap(font):
    m = {}
    for t in font["cmap"].tables:
        try:
            m.update(t.cmap)
        except Exception:
            pass
    return m


def contour_boxes(gs, name, upem):
    pen = DecomposingRecordingPen(gs)
    try:
        gs[name].draw(pen)
    except Exception:
        return []
    out, cur = [], []
    for op, args in pen.value:
        if op == "moveTo":
            if cur:
                out.append(cur)
            cur = [args[0]]
        elif op == "lineTo":
            cur.append(args[0])
        elif op == "qCurveTo":
            cur.extend(p for p in args if p is not None)
        elif op == "curveTo":
            cur.extend(args)
        elif op == "closePath":
            if cur:
                out.append(cur)
            cur = []
    if cur:
        out.append(cur)

    boxes = []
    for c in out:
        if len(c) < 3:
            continue
        xs = [p[0] for p in c]
        ys = [p[1] for p in c]
        b = (min(xs), min(ys), max(xs), max(ys))
        if (b[2] - b[0]) > upem * 0.005 and (b[3] - b[1]) > upem * 0.005:
            boxes.append(b)
    return boxes


def compact(b):
    w, h = b[2] - b[0], b[3] - b[1]
    return h > 0 and 0.6 <= w / h <= 1.6


def measure_beh(font, gs, cmap, upem):
    for cp, label, below in DOTTED:
        gname = cmap.get(cp)
        if not gname:
            continue
        boxes = contour_boxes(gs, gname, upem)
        if len(boxes) < 2:
            continue
        pool = [b for b in boxes
                if ((b[1] + b[3]) / 2 < 0) == below
                and abs((b[1] + b[3]) / 2) > upem * 0.02] or boxes
        # Compactness must be a HARD filter: decorative faces (ThuluthDeco)
        # carry tall thin flourishes of SMALLER area than the real dot, which
        # a smallest-area-wins rule picks by mistake.
        pool = [b for b in pool if compact(b)] or pool
        b = min(pool, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        return (b[2] - b[0], b[3] - b[1], label)
    return None


def measure_modal(font, gs, upem):
    sizes = Counter()
    q = max(1, round(upem / 200))  # quantize so near-identical dots group
    for gname in font.getGlyphOrder():
        for b in contour_boxes(gs, gname, upem):
            w, h = b[2] - b[0], b[3] - b[1]
            if not (upem * 0.02 <= w <= upem * 0.30):
                continue
            if not (upem * 0.02 <= h <= upem * 0.30):
                continue
            if not compact(b):
                continue
            sizes[(round(w / q) * q, round(h / q) * q)] += 1
    if not sizes:
        return None
    (w, h), n = sizes.most_common(1)[0]
    return (w, h, n)


def main():
    paths = sys.argv[1:] or sorted(glob.glob("public/fonts/*.ttf") +
                                   glob.glob("public/fonts/*.otf"))
    hdr = (f"{'font':<24}{'upem':>6}{'beh w':>7}{'beh h':>7}"
           f"{'modal w':>9}{'modal h':>9}{'dot/em':>9}{'alif/dot':>9}  agree")
    print(hdr)
    print("-" * len(hdr))

    for path in paths:
        name = os.path.basename(path)
        try:
            font = open_font(path)
            upem = font["head"].unitsPerEm
            cmap = merged_cmap(font)
            gs = font.getGlyphSet()

            if not any(0x0600 <= c <= 0x06FF for c in cmap):
                print(f"{name:<24}{upem:>6}  NO ARABIC CMAP — legacy 8-bit font")
                continue

            beh = measure_beh(font, gs, cmap, upem)
            modal = measure_modal(font, gs, upem)

            dw = (beh or modal or (0,))[0]
            alif = None
            gn = cmap.get(0x0627)
            if gn:
                ab = contour_boxes(gs, gn, upem)
                if ab:
                    alif = max(b[2] for b in ab) - min(b[0] for b in ab)

            agree = ""
            if beh and modal:
                agree = "yes" if abs(beh[0] - modal[0]) <= max(2, upem * 0.01) \
                    else "NO — check by hand"
            elif modal:
                agree = "modal only"

            print(f"{name:<24}{upem:>6}"
                  f"{(beh[0] if beh else 0):>7.0f}{(beh[1] if beh else 0):>7.0f}"
                  f"{(modal[0] if modal else 0):>9.0f}{(modal[1] if modal else 0):>9.0f}"
                  f"{(dw / upem if dw else 0):>9.4f}"
                  f"{(alif / dw if alif and dw else 0):>9.2f}  {agree}")
        except Exception as e:  # noqa: BLE001 — report, don't abort the sweep
            print(f"{name:<24}  ERROR {type(e).__name__}: {e}")

    print("\ndot/em   = nuqta width / em — the portable, font-independent unit")
    print("alif/dot = alif width in dot-widths; 'alif stem = 1 nuqta' predicts 1.00")
    print("           (it does not hold — that is why this table exists)")


if __name__ == "__main__":
    main()
