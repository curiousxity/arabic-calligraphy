#!/usr/bin/env python3
"""Merge the sidebar's honorific PUA glyphs into a font.

Every font in public/fonts/ is expected to carry the honorific symbols the
sidebar's "Presets" row inserts. They live natively in FatemiMaqala.ttf and
are copied into every other face. A font added without this step renders
those buttons as missing-glyph boxes — silently, and only for that font.

The codepoint list is PARSED FROM src/lib/presets.ts rather than hardcoded.
That is deliberate: the list is neither eight glyphs nor a contiguous range
(E83A-E83F are unused, and E841/E842 sit past E840), and a hardcoded range
has already shipped a bug once by omitting the last two. If PRESETS changes,
this script follows it automatically.

Usage:
    python3 scripts/mergePuaGlyphs.py TARGET.ttf OUT.ttf [--rename NewName]

`--rename` sets the family / full / PostScript names. It is REQUIRED when
the source font is under the OFL with a Reserved Font Name, because a
modified version may not keep that name. See public/fonts/*-OFL.txt.

Requires: pip install fonttools
"""
import argparse
import os
import re
import sys

from fontTools.ttLib import TTFont
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PRESETS_TS = os.path.join(REPO, "src", "lib", "presets.ts")
DEFAULT_SOURCE = os.path.join(REPO, "public", "fonts", "FatemiMaqala.ttf")


def read_preset_codepoints(path=PRESETS_TS):
    """Extract the \\uXXXX escapes from the PRESETS array in presets.ts."""
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"export const PRESETS\s*=\s*\[(.*?)\]", src, re.S)
    if not m:
        raise SystemExit(f"could not find the PRESETS array in {path}")
    cps = [int(h, 16) for h in re.findall(r"\\u([0-9A-Fa-f]{4})", m.group(1))]
    if not cps:
        raise SystemExit(f"PRESETS in {path} contains no \\uXXXX escapes")
    return cps


def merge(source_path, target_path, out_path, new_name=None):
    cps = read_preset_codepoints()
    print(f"{len(cps)} preset codepoints from presets.ts: "
          f"{' '.join(f'{c:04X}' for c in cps)}")

    src = TTFont(source_path)
    dst = TTFont(target_path)

    if src["head"].unitsPerEm != dst["head"].unitsPerEm:
        raise SystemExit(
            f"unitsPerEm mismatch: source {src['head'].unitsPerEm} vs "
            f"target {dst['head'].unitsPerEm}. The glyphs would come out the "
            "wrong size; rescale before merging."
        )

    if "glyf" not in dst:
        raise SystemExit("target is not a TrueType (glyf) font; CFF merging "
                         "is not implemented")

    src_cmap = src.getBestCmap()
    src_gs = src.getGlyphSet()
    order = dst.getGlyphOrder()

    added, missing, overwritten = [], [], []

    for cp in cps:
        sname = src_cmap.get(cp)
        if not sname:
            missing.append(f"{cp:04X}")
            continue

        # Decompose so copied glyphs never reference the source's glyph order.
        rec = DecomposingRecordingPen(src_gs)
        src_gs[sname].draw(rec)
        pen = TTGlyphPen(None)
        rec.replay(pen)

        new_glyph_name = f"honorific{cp:04X}"
        while new_glyph_name in order:
            new_glyph_name += "_x"

        dst["glyf"].glyphs[new_glyph_name] = pen.glyph()
        dst["hmtx"].metrics[new_glyph_name] = src["hmtx"].metrics[sname]
        order.append(new_glyph_name)

        # Overwrite the codepoint in every unicode subtable. The target's own
        # glyph (if any) stays in the file; GSUB references glyph NAMES, so a
        # font's internal contextual logic is unaffected by this remap.
        for t in dst["cmap"].tables:
            if t.isUnicode():
                if cp in t.cmap:
                    overwritten.append(f"{cp:04X}")
                t.cmap[cp] = new_glyph_name

        added.append((cp, sname, new_glyph_name))

    dst.setGlyphOrder(order)
    try:
        dst["maxp"].numGlyphs = len(order)
    except Exception:
        pass

    if new_name:
        for rec in dst["name"].names:
            if rec.nameID in (1, 3, 4, 6):
                rec.string = (new_name.encode("utf_16_be")
                              if rec.platformID == 3
                              else new_name.encode("latin-1"))

    dst.save(out_path)

    print(f"\nmerged {len(added)}/{len(cps)} glyphs into {out_path}")
    for cp, sname, new in added:
        print(f"  U+{cp:04X}  {sname:16} -> {new}")
    if overwritten:
        print(f"cmap entries replaced (target's own PUA): "
              f"{' '.join(sorted(set(overwritten)))}")
    if missing:
        print(f"WARNING missing from source: {' '.join(missing)}", file=sys.stderr)
    if new_name:
        print(f"renamed family/full/PostScript to: {new_name}")
    return len(missing) == 0


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("target", help="font to merge INTO")
    ap.add_argument("out", help="output path")
    ap.add_argument("--source", default=DEFAULT_SOURCE,
                    help="font to copy the glyphs FROM (default: FatemiMaqala.ttf)")
    ap.add_argument("--rename", default=None,
                    help="new family/full/PostScript name; required for OFL "
                         "fonts with a Reserved Font Name")
    args = ap.parse_args()
    ok = merge(args.source, args.target, args.out, args.rename)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
