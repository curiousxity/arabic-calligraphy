#!/usr/bin/env python3
"""Turn an upstream font into one the app can draw.

Two upstream shapes break the canvas without any error:

* **CFF2 outlines** (variable OpenType .otf). opentype.js, which supplies
  glyph outlines to the canvas, cannot read CFF2 — HarfBuzz shapes the text
  and then nothing is drawn. Converted here to TrueType quadratics.
* **Colour tables** (COLR/CPAL/SVG). The browser draws them in colour in the
  font picker's preview while the canvas draws monochrome outlines, so the
  preview lies. `--strip-color` removes them.

Variable fonts are always instanced at their default axis values: the app
has no axis controls, and a static file keeps mergePuaGlyphs.py simple.

Usage:
    python3 scripts/prepareFont.py IN OUT.ttf [--strip-color]

Worked examples (.claude/rules/bundled-fonts.md):
    prepareFont.py RanaKufi.otf public/fonts/RanaKufi.ttf
    prepareFont.py Raqq.ttf     public/fonts/Raqq.ttf --strip-color

Check the font's licence permits modification before running this.
Requires: pip install fonttools
"""
import argparse

from fontTools.ttLib import TTFont, newTable
from fontTools.varLib import instancer
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen


def cff_to_glyf(font):
    order = font.getGlyphOrder()
    gs = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(None)
        # CFF contours run counter-clockwise; TrueType's run clockwise.
        gs[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    for tag in ("CFF ", "CFF2", "VORG"):
        if tag in font:
            del font[tag]
    font["loca"] = newTable("loca")
    font["glyf"] = glyf
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for k in ("maxZones", "maxTwilightPoints", "maxStorage", "maxFunctionDefs",
              "maxInstructionDefs", "maxStackElements", "maxSizeOfInstructions",
              "maxComponentElements", "maxPoints", "maxContours",
              "maxCompositePoints", "maxCompositeContours", "maxComponentDepth"):
        setattr(maxp, k, 0)
    maxp.maxZones = 1
    font["head"].glyphDataFormat = 0
    # CFF2 carries no glyph names; a format-2 post table keeps them.
    post = font["post"]
    post.formatType = 2.0
    post.extraNames = []
    post.mapping = {}
    post.glyphOrder = order
    font.sfntVersion = "\x00\x01\x00\x00"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--strip-color", action="store_true",
                    help="remove COLR, CPAL and SVG colour tables")
    args = ap.parse_args()

    font = TTFont(args.src)
    if "fvar" in font:
        defaults = {a.axisTag: a.defaultValue for a in font["fvar"].axes}
        font = instancer.instantiateVariableFont(font, defaults)
        print("instanced at", defaults)
    if "CFF2" in font or "CFF " in font:
        cff_to_glyf(font)
        print("converted CFF outlines to TrueType")
    if args.strip_color:
        for tag in ("COLR", "CPAL", "SVG "):
            if tag in font:
                del font[tag]
                print("removed", tag.strip())
    font.save(args.out)
    print("wrote", args.out)


if __name__ == "__main__":
    main()
