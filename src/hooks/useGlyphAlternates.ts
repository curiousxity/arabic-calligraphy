import { useEffect, useState } from "react";
import type * as opentype from "opentype.js";
import { findAlternates } from "../lib/harfbuzz";
import { alternatesKey, type LetterAlternates } from "../lib/glyphAlternates";
import type { GlyphAlternate } from "../types";
import { resolveFontUrl } from "./useShapedGlyphs";

export type GlyphAlternatesState = {
  letters: LetterAlternates[];
  fontHasAlternates: boolean;
  font: opentype.Font | null;
  unitsPerEm: number;
  loading: boolean;
};

const IDLE: GlyphAlternatesState = {
  letters: [],
  fontHasAlternates: false,
  font: null,
  unitsPerEm: 1000,
  loading: false,
};

/**
 * Every letter's alternate shapes for the block being edited. Runs only while
 * the tool is armed — probing reshapes the run per feature per letter. State
 * is set only from the resolved promise; "loading" is derived by comparing
 * the settled key with the current one, so no synchronous setState runs in
 * the effect.
 */
export function useGlyphAlternates(
  text: string,
  fontFamily: string,
  alternates: GlyphAlternate[] | undefined,
  armed: boolean
): GlyphAlternatesState {
  const fontUrl = resolveFontUrl(fontFamily);
  const key = `${fontUrl}|${text}|${alternatesKey(alternates)}`;
  const [settled, setSettled] = useState<{ key: string; value: GlyphAlternatesState } | null>(null);

  useEffect(() => {
    if (!armed) return;
    let alive = true;
    findAlternates(text, fontUrl, alternates)
      .then((r) => {
        if (!alive) return;
        setSettled({
          key,
          value: {
            letters: r.letters,
            fontHasAlternates: r.fontHasAlternates,
            font: r.font,
            unitsPerEm: r.unitsPerEm,
            loading: false,
          },
        });
      })
      .catch(() => {
        if (alive) setSettled({ key, value: IDLE });
      });
    return () => {
      alive = false;
    };
  }, [armed, key, text, fontUrl, alternates]);

  if (!armed) return IDLE;
  if (settled?.key !== key) return { ...(settled?.value ?? IDLE), loading: true };
  return settled.value;
}
