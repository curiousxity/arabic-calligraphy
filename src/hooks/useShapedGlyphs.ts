import { useEffect, useState } from "react";
import {
  clearShapeCache,
  shapeText,
  type HarfBuzzGlyph,
  type ShapedTextResult,
} from "../lib/harfbuzz";
import { pickFontUrl, setShapeCacheInvalidator } from "../lib/customFonts";

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
  // Modified version of Layla Diwani (OFL, Mohammed Isam) — renamed as the
  // OFL requires, with the honorific PUA glyphs merged in. Provenance and
  // licence: public/fonts/HarfCanvasDiwani-OFL.txt.
  HarfCanvasDiwani: "/fonts/HarfCanvasDiwani.ttf",
};

/** The family a block falls back to when its own font cannot be resolved. */
const FALLBACK_FONT_KEY = "NotoSans";

// `customFonts.ts` must not import `./harfbuzz` — that module statically
// imports harfbuzzjs, which throws under Vitest's Node loader and would take
// the custom-font unit suite with it. This file already owns both halves, so
// it is where the two are joined: replacing an uploaded font's bytes revokes
// its old object URL, and shaped results are cached against that URL.
setShapeCacheInvalidator(clearShapeCache);

/**
 * Where a family's bytes come from: a bundled font first, then the
 * user-uploaded registry, then Noto Sans. Every consumer must go through
 * this rather than indexing `FONT_URLS` directly — an uploaded font has no
 * entry there, and a direct lookup would silently render it as Noto Sans.
 *
 * Synchronous on purpose: the shaping hook computes a URL during render.
 * Until `primeCustomFonts()` resolves at boot, a custom family answers the
 * fallback and re-renders to its own bytes a frame later.
 */
export function resolveFontUrl(fontFamily: string): string {
  return pickFontUrl(fontFamily, FONT_URLS, FALLBACK_FONT_KEY);
}

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
  const fontUrl = resolveFontUrl(fontFamily);

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
