/**
 * A block's *look* — its styling fields, never its content — so new text can
 * be born looking like an existing block: text added to a guide copies the
 * last text written on it, and a new verse line copies the selected one.
 *
 * This was the engine of the Typography panel's saved Styles list (with a
 * localStorage store) until 2026-10-16, when the list and the palettes beside
 * it were removed from the UI. The capture/apply pair stayed because those
 * two callers use it.
 *
 * The field list is the intersection of "styling" and `BlockCommon`, and is
 * where the whole design lives: a style may never carry `text`, `x`/`y`, `id`
 * or `type`, or applying it would move blocks and overwrite their content.
 * That is asserted in `textStyles.test.ts` rather than only stated here.
 */

import type { Block } from "../types";
import type { FontStyle } from "../types";

/**
 * Every field is optional: a style records only what the block it was captured
 * from actually set, so applying it leaves untouched anything it never had an
 * opinion about.
 */
export type TextStyle = {
  id: string;
  name: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: FontStyle;
  color?: string;
  opacity?: number;
  /** `BlockCommon` calls the outline colour `stroke`, not `strokeColor`. */
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  /** Text blocks only; harmlessly inert on the other types, like the rest of `BlockCommon`. */
  lineHeight?: number;
  /** Text blocks only, like `lineHeight`. Fraction of font size; see lib/spacing.ts. */
  letterSpacing?: number;
  wordSpacing?: number;
};

/**
 * The single list of what a style captures and applies. Both `captureStyle`
 * and `styleToPatch` walk it, so the two can never drift apart — and adding a
 * field here is the entire edit needed to include it in both directions.
 */
const STYLE_FIELDS = [
  "fontFamily",
  "fontSize",
  "fontStyle",
  "color",
  "opacity",
  "stroke",
  "strokeWidth",
  "shadowColor",
  "shadowBlur",
  "shadowOffsetX",
  "shadowOffsetY",
  "shadowOpacity",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
] as const;

export type StyleField = (typeof STYLE_FIELDS)[number];

export const TEXT_STYLE_FIELDS: readonly StyleField[] = STYLE_FIELDS;

const isStyleValue = (field: StyleField, value: unknown): boolean => {
  switch (field) {
    case "fontSize":
    case "opacity":
    case "strokeWidth":
    case "shadowBlur":
    case "shadowOffsetX":
    case "shadowOffsetY":
    case "shadowOpacity":
    case "lineHeight":
    case "letterSpacing":
    case "wordSpacing":
      return typeof value === "number" && Number.isFinite(value);
    default:
      return typeof value === "string";
  }
};

/** Reads the styling fields off a block. Never `text`, position, `id` or `type`. */
export function captureStyle(block: Block, name: string): TextStyle {
  const style: TextStyle = {
    id: `style-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
  };
  const source = block as unknown as Record<string, unknown>;
  for (const field of STYLE_FIELDS) {
    const value = source[field];
    if (value === undefined || value === null) continue;
    if (!isStyleValue(field, value)) continue;
    (style as Record<string, unknown>)[field] = value;
  }
  return style;
}

/** The patch `updateSelectedBlock` applies — the style minus its identity. */
export function styleToPatch(style: TextStyle): Partial<Block> {
  const patch: Record<string, unknown> = {};
  for (const field of STYLE_FIELDS) {
    const value = (style as Record<string, unknown>)[field];
    if (value === undefined || value === null) continue;
    if (!isStyleValue(field, value)) continue;
    patch[field] = value;
  }
  return patch as Partial<Block>;
}
