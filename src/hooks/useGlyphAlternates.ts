import { useEffect, useState } from "react";
import type * as opentype from "opentype.js";
import { findAlternates, findStyleSets } from "../lib/harfbuzz";
import {
  activeStyleSets,
  alternatesKey,
  type LetterAlternates,
  type StyleSetOption,
} from "../lib/glyphAlternates";
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
  armed: boolean,
  styleSets?: string[]
): GlyphAlternatesState {
  const fontUrl = resolveFontUrl(fontFamily);
  const key = `${fontUrl}|${text}|${alternatesKey(alternates)}|${activeStyleSets(styleSets).join(",")}`;
  const [settled, setSettled] = useState<{ key: string; value: GlyphAlternatesState } | null>(null);

  useEffect(() => {
    if (!armed) return;
    let alive = true;
    findAlternates(text, fontUrl, alternates, styleSets)
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
  }, [armed, key, text, fontUrl, alternates, styleSets]);

  if (!armed) return IDLE;
  if (settled?.key !== key) return { ...(settled?.value ?? IDLE), loading: true };
  return settled.value;
}

export type StyleSetsState = {
  sets: StyleSetOption[];
  fontHasStyleSets: boolean;
  loading: boolean;
};

const NO_SETS: StyleSetsState = { sets: [], fontHasStyleSets: false, loading: false };

/**
 * The font's style sets that change this block's text, for the sidebar's
 * toggles. One shaping pass per set, so it runs whenever a block that can
 * carry sets is selected; "loading" is derived, exactly as above.
 */
export function useStyleSets(text: string, fontFamily: string, armed: boolean): StyleSetsState {
  const fontUrl = resolveFontUrl(fontFamily);
  const key = `${fontUrl}|${text}`;
  const [settled, setSettled] = useState<{ key: string; value: StyleSetsState } | null>(null);

  useEffect(() => {
    if (!armed) return;
    let alive = true;
    findStyleSets(text, fontUrl)
      .then((r) => {
        if (alive) setSettled({ key, value: { ...r, loading: false } });
      })
      .catch(() => {
        if (alive) setSettled({ key, value: NO_SETS });
      });
    return () => {
      alive = false;
    };
  }, [armed, key, text, fontUrl]);

  if (!armed) return NO_SETS;
  if (settled?.key !== key) return { ...(settled?.value ?? NO_SETS), loading: true };
  return settled.value;
}
