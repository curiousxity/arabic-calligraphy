import { useEffect, useState } from "react";
import {
  shapeText,
  type HarfBuzzGlyph,
  type ShapedTextResult,
} from "../lib/harfbuzz";

export const FONT_URLS: Record<string, string> = {
  TahaNaskhRegular: "/fonts/TahaNaskhRegular.ttf",
  Kufi: "/fonts/Kufi.ttf",
  Kufi2: "/fonts/Kufi2.ttf",
  Thuluth: "/fonts/Thuluth.ttf",
  ThuluthDeco: "/fonts/ThuluthDeco.ttf",
  Wessam: "/fonts/Wessam.ttf",
  Yekan: "/fonts/Yekan.ttf",
  NotoSans: "/fonts/NotoSans.ttf",
  Lateef: "/fonts/Lateef.ttf",
  Amiri: "/fonts/Amiri.ttf",
  Ruqaa: "/fonts/Ruqaa.ttf",
  Qahiri: "/fonts/Qahiri.ttf",
  Scheherazade: "/fonts/Scheherazade.ttf",
  Urdu: "/fonts/Urdu.ttf",
  AlFatemi: "/fonts/AlFatemi.otf",
  FatemiMaqala: "/fonts/FatemiMaqala.ttf",
};

const DEBUG_LOG = import.meta.env.DEV;

export type ShapedGlyphsState = {
  glyphs: HarfBuzzGlyph[];
  font: ShapedTextResult["font"] | null;
  unitsPerEm: number;
  isLoading: boolean;
  /** True once shaping has finished and produced at least one renderable glyph. */
  hbLoaded: boolean;
  /** The text actually shaped (after diacritic-stripping) — `glyph.cl` indexes into this, not the raw `text` argument. */
  shapableText: string;
};

/**
 * Shapes `text` in `fontFamily` via HarfBuzz, tracking load/error state and
 * guarding against setting state after the component has unmounted or the
 * inputs have changed again. Shared by ShapedText, ShapeFillText, and
 * TextOnPathText, which all need the same glyph data.
 */
export function useShapedGlyphs(text: string, fontFamily: string): ShapedGlyphsState {
  const fontUrl = FONT_URLS[fontFamily] ?? FONT_URLS.NotoSans;

  const [hbLoaded, setHbLoaded] = useState(false);
  const [shapeData, setShapeData] = useState<{
    glyphs: HarfBuzzGlyph[];
    font: ShapedTextResult["font"] | null;
    unitsPerEm: number;
    isLoading: boolean;
    shapableText: string;
  }>({
    glyphs: [],
    font: null,
    unitsPerEm: 1000,
    isLoading: true,
    shapableText: "",
  });

  useEffect(() => {
    let alive = true;

    // Mark loading before kicking off the async shapeText() fetch below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHbLoaded(false);
    setShapeData((prev) => ({ ...prev, isLoading: true }));

    shapeText(text || "", fontUrl)
      .then((r) => {
        if (!alive) return;

        const glyphs = r.glyphs ?? [];
        const font = r.font ?? null;
        const hasGlyphs = !!font && glyphs.length > 0;

        setShapeData({
          glyphs,
          font,
          unitsPerEm: r.unitsPerEm || 1000,
          isLoading: false,
          shapableText: r.shapableText ?? "",
        });

        setHbLoaded(hasGlyphs);
      })
      .catch((err) => {
        if (DEBUG_LOG) {
          console.error("useShapedGlyphs: shapeText failed", {
            text,
            fontFamily,
            fontUrl,
            err,
          });
        }

        if (!alive) return;

        setShapeData({
          glyphs: [],
          font: null,
          unitsPerEm: 1000,
          isLoading: false,
          shapableText: "",
        });

        setHbLoaded(false);
      });

    return () => {
      alive = false;
    };
  }, [text, fontUrl, fontFamily]);

  return { ...shapeData, hbLoaded };
}
