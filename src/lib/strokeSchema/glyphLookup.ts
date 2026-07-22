import { useMemo } from "react";
import { classifyJoiningForms } from "../arabicJoining";
import type { HarfBuzzGlyph } from "../harfbuzz";
import { deriveStretchCatalog, type StretchDefinition } from "./deriveCatalog";
import { getLigatureSchema, getStrokeSchema } from "./registry";

function codepointHex(cp: number): string {
  return cp.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Maps each distinct HarfBuzz cluster value to how many source characters it
 * spans, by sorting cluster values into logical (typed) order regardless of
 * the shaped glyph array's own order (which for RTL text runs opposite to
 * typing order — see the note on ShapedTextResult in lib/harfbuzz.ts). A
 * span of 1 is an ordinary single-character glyph; a span > 1 means several
 * characters were fused into one glyph by the font's GSUB ligature rules
 * (e.g. "الله" collapsing into a single Allah-ligature glyph).
 */
export function computeClusterSpans(clusters: number[], textLength: number): Map<number, number> {
  const sorted = Array.from(new Set(clusters)).sort((a, b) => a - b);
  const spans = new Map<number, number>();

  for (let k = 0; k < sorted.length; k++) {
    const start = sorted[k];
    const end = k + 1 < sorted.length ? sorted[k + 1] : textLength;
    spans.set(start, Math.max(end - start, 1));
  }

  return spans;
}

/**
 * Maps each shaped glyph occurrence to the stroke-schema stretch definitions
 * available for it — font-agnostic, so any font rendering the same letter
 * (or letter sequence) gets the same catalog. `glyph.cl` indexes into
 * `shapableText` (see the note on ShapedTextResult in lib/harfbuzz.ts), not
 * the block's raw text, so callers must pass the shaped text, not the block
 * text.
 *
 * Two lookup paths:
 * - A glyph whose cluster spans exactly one character is looked up by
 *   (baseLetter codepoint, joining form) via getStrokeSchema, same as always.
 * - A glyph whose cluster spans multiple characters is a ligature (several
 *   letters fused into one glyph by the font's own GSUB rules) — looked up
 *   by the literal fused letter sequence via getLigatureSchema instead.
 *
 * Either way, no matching schema entry simply means no catalog for that
 * glyph — identical to today's generic behavior for un-authored letters.
 */
export function useGlyphSchemaCatalog(
  shapableText: string,
  glyphs: HarfBuzzGlyph[]
): Record<number, StretchDefinition[]> {
  return useMemo(() => {
    if (!shapableText || glyphs.length === 0) return {};

    const classified = classifyJoiningForms(shapableText);
    const clusterSpans = computeClusterSpans(
      glyphs.map((g) => g.cl ?? 0),
      shapableText.length
    );
    const result: Record<number, StretchDefinition[]> = {};

    for (let i = 0; i < glyphs.length; i++) {
      const cluster = glyphs[i].cl ?? 0;
      const span = clusterSpans.get(cluster) ?? 1;

      if (span > 1) {
        const sequence = Array.from(shapableText.slice(cluster, cluster + span)).map((ch) =>
          codepointHex(ch.codePointAt(0) ?? 0)
        );
        const schema = getLigatureSchema(sequence);
        if (schema) result[i] = deriveStretchCatalog(schema);
        continue;
      }

      const entry = classified[cluster];
      if (!entry || entry.form == null) continue;

      const schema = getStrokeSchema(codepointHex(entry.codepoint), entry.form);
      if (!schema) continue;

      result[i] = deriveStretchCatalog(schema);
    }

    return result;
  }, [shapableText, glyphs]);
}
