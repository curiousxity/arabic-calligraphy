/**
 * Saved colour palettes — a name plus up to twelve colours, offered as swatches
 * beside the colour controls so a multi-block composition can be kept coherent
 * without re-typing hex values.
 *
 * Same store pattern as `lib/exportPresets.ts` and `lib/textStyles.ts`:
 * local-only, best-effort persistence, pure list functions. The shipped
 * defaults are defined *in code* rather than written into storage on first run,
 * so they cannot be corrupted, cannot go stale against a later release, and are
 * always listed first however the user's own palettes accumulate.
 */

export type Palette = {
  id: string;
  name: string;
  /** At most {@link MAX_PALETTE_COLORS}; CSS colour strings, normally hex. */
  colors: string[];
};

export const PALETTES_KEY = "harfcanvas-palettes-v1";

/** A strip wider than this stops reading as a palette and starts reading as a gradient. */
export const MAX_PALETTE_COLORS = 12;

/**
 * Shipped palettes, drawn from the manuscript tradition the app is for:
 * ivory/navy/gold leaf; the black-and-red rubrication of a chapter heading;
 * the ochres of an aged page; and a plain neutral ramp for layout work.
 */
export const DEFAULT_PALETTES: Palette[] = [
  {
    id: "default-manuscript",
    name: "Manuscript",
    colors: ["#f5efe0", "#e3d4ac", "#c9a227", "#8a6d1f", "#1c2a4a", "#0f1730"],
  },
  {
    id: "default-rubrication",
    name: "Rubrication",
    colors: ["#faf7f2", "#1a1a1a", "#a3161b", "#d4443f", "#7c6f5a"],
  },
  {
    id: "default-aged-page",
    name: "Aged page",
    colors: ["#efe3cb", "#d9c3a0", "#b08d57", "#7a5c3a", "#3f2f22"],
  },
  {
    id: "default-neutral",
    name: "Neutral",
    colors: ["#ffffff", "#d9d9d9", "#9a9a9a", "#5a5a5a", "#2b2b2b", "#000000"],
  },
];

const isPalette = (value: unknown): value is Palette => {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<Palette>;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    typeof p.name === "string" &&
    p.name.length > 0 &&
    Array.isArray(p.colors) &&
    p.colors.length > 0 &&
    p.colors.length <= MAX_PALETTE_COLORS &&
    p.colors.every((c) => typeof c === "string" && c.length > 0)
  );
};

/**
 * The user's saved palettes only — the defaults are *not* stored, and are
 * prepended by {@link allPalettes}. Falls back to `[]` on unreadable storage.
 */
export function loadPalettes(): Palette[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(PALETTES_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // A user palette that collides with a default's id would shadow it in the
    // dropdown, so those are dropped rather than merged.
    const defaultIds = new Set(DEFAULT_PALETTES.map((p) => p.id));
    return parsed.filter(isPalette).filter((p) => !defaultIds.has(p.id));
  } catch {
    return [];
  }
}

/** Best-effort persist of the *user's* palettes; the defaults are never written. */
export function savePalettes(palettes: Palette[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const defaultIds = new Set(DEFAULT_PALETTES.map((p) => p.id));
    localStorage.setItem(
      PALETTES_KEY,
      JSON.stringify(palettes.filter((p) => !defaultIds.has(p.id)))
    );
  } catch {
    // Privacy mode or quota — the palettes simply don't survive this session.
  }
}

/** What the picker lists: the shipped palettes first, then the user's own. Pure. */
export function allPalettes(userPalettes: Palette[]): Palette[] {
  const defaultIds = new Set(DEFAULT_PALETTES.map((p) => p.id));
  return [...DEFAULT_PALETTES, ...userPalettes.filter((p) => !defaultIds.has(p.id))];
}

/**
 * Replaces the entry sharing `palette`'s id, or appends it when the id is new.
 * Colours beyond {@link MAX_PALETTE_COLORS} are trimmed rather than rejected —
 * a palette built by sampling a busy canvas should not simply fail to save.
 * Pure.
 */
export function upsertPalette(palettes: Palette[], palette: Palette): Palette[] {
  const trimmed: Palette = { ...palette, colors: palette.colors.slice(0, MAX_PALETTE_COLORS) };
  const index = palettes.findIndex((p) => p.id === trimmed.id);
  if (index === -1) return [...palettes, trimmed];
  const next = [...palettes];
  next[index] = trimmed;
  return next;
}

/** Drops the entry with `id`, leaving the rest in order. A default id is a no-op. Pure. */
export function removePalette(palettes: Palette[], id: string): Palette[] {
  return palettes.filter((p) => p.id !== id);
}
