/**
 * Saved text styles — a name plus the *styling* fields of a block, so a look
 * built once on one block can be dropped onto another instead of being rebuilt
 * dial by dial.
 *
 * Local-only by design, exactly like `lib/exportPresets.ts` (this module is
 * deliberately another instance of that pattern): a style describes how *this
 * browser* likes to letter, not what a project contains, so it stays out of the
 * saved layout payload and out of the Supabase named-project store. Every read
 * and write is wrapped, because localStorage throws in privacy mode and when
 * the quota is exhausted, and losing a style is never worth breaking the editor
 * over.
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
};

export const TEXT_STYLES_KEY = "harfcanvas-text-styles-v1";

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

const isTextStyle = (value: unknown): value is TextStyle => {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<TextStyle>;
  if (typeof s.id !== "string" || s.id.length === 0) return false;
  if (typeof s.name !== "string" || s.name.length === 0) return false;
  // A style whose fields are all missing or malformed would apply nothing; a
  // single usable field is enough to keep it, and the bad ones are dropped by
  // `styleToPatch` anyway.
  return STYLE_FIELDS.some((field) => {
    const v = (s as Record<string, unknown>)[field];
    return v !== undefined && isStyleValue(field, v);
  });
};

/** Reads the saved styles, falling back to `[]` on empty or unreadable storage. */
export function loadStyles(): TextStyle[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(TEXT_STYLES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTextStyle);
  } catch {
    // Corrupt JSON or privacy mode. Unlike export presets there is nothing
    // sensible to ship as a default here — a style is by definition the user's.
    return [];
  }
}

/** Best-effort persist; a storage failure is swallowed exactly as the other local stores do. */
export function saveStyles(styles: TextStyle[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(TEXT_STYLES_KEY, JSON.stringify(styles));
  } catch {
    // Privacy mode or quota — the styles simply don't survive this session.
  }
}

/** Replaces the entry sharing `style`'s id, or appends it when the id is new. Pure. */
export function upsertStyle(styles: TextStyle[], style: TextStyle): TextStyle[] {
  const index = styles.findIndex((s) => s.id === style.id);
  if (index === -1) return [...styles, style];
  const next = [...styles];
  next[index] = style;
  return next;
}

/** Drops the entry with `id`, leaving the rest in order. Pure. */
export function removeStyle(styles: TextStyle[], id: string): TextStyle[] {
  return styles.filter((s) => s.id !== id);
}
