/** One entry of the font picker's list — value, label, and the CSS family to preview in. */
export type FontChoice = {
  value: string;
  label: string;
  cssFamily: string;
  /** Calligraphic genre (Naskh, Kufi…) — the picker heads a group with it. */
  genre?: string;
  /**
   * No longer offered. Kept in the list so a saved block on it still renders
   * and the trigger can still name it; the gallery shows it only when it is
   * the selected block's current font.
   */
  retired?: boolean;
};

/**
 * The bundled fonts, grouped by calligraphic genre and listed in picker
 * order — the font picker starts a new heading wherever `genre` changes, so
 * a genre's fonts must sit together here.
 *
 * `value` is persisted in every saved block; never rename one. Labels are
 * free to change (the "Kufi" key is Janna LT, a modern sans, and "Urdu" is
 * Jameel Noori Nastaleeq).
 */
export const FONT_OPTIONS: FontChoice[] = [
  { genre: "Fatemi", value: "FatemiMaqala", label: "Fatemi Maqala", cssFamily: "FatemiMaqala" },
  { genre: "Fatemi", value: "AlFatemi", label: "Al Fatemi", cssFamily: "AlFatemi" },
  { genre: "Naskh", value: "TahaNaskhRegular", label: "Taha Naskh", cssFamily: "TahaNaskhRegular" },
  { genre: "Naskh", value: "Amiri", label: "Amiri", cssFamily: "Amiri" },
  { genre: "Naskh", value: "Scheherazade", label: "Scheherazade", cssFamily: "Scheherazade" },
  { genre: "Naskh", value: "Lateef", label: "Lateef", cssFamily: "Lateef" },
  { genre: "Thuluth", value: "Thuluth", label: "Thuluth", cssFamily: "Thuluth" },
  { genre: "Thuluth", value: "ThuluthDeco", label: "Thuluth Deco", cssFamily: "ThuluthDeco" },
  { genre: "Nastaliq", value: "Urdu", label: "Jameel Noori", cssFamily: "Urdu" },
  { genre: "Nastaliq", value: "Gulzar", label: "Gulzar", cssFamily: "Gulzar" },
  { genre: "Diwani", value: "UKIJDiwani", label: "UKIJ Diwani", cssFamily: "UKIJDiwani" },
  // Retired 2026-10-13: Layla Diwani's own medial meem and hah are drawn so
  // small that محمد reads as نصر. Kept so a saved block on it still renders
  // and still shows its name; hidden from the picker otherwise.
  {
    genre: "Diwani",
    value: "HarfCanvasDiwani",
    label: "Layla Diwani (retired)",
    cssFamily: "HarfCanvasDiwani",
    retired: true,
  },
  { genre: "Diwani", value: "Wessam", label: "Wessam", cssFamily: "Wessam" },
  { genre: "Ruqaa", value: "Ruqaa", label: "Ruqaa", cssFamily: "Ruqaa" },
  { genre: "Maghribi", value: "Rabat", label: "Rabat", cssFamily: "Rabat" },
  { genre: "Kufi", value: "Kufi2", label: "Reem Kufi", cssFamily: "Kufi2" },
  { genre: "Kufi", value: "Qahiri", label: "Qahiri", cssFamily: "Qahiri" },
  { genre: "Mushaf Kufi", value: "Raqq", label: "Raqq", cssFamily: "Raqq" },
  { genre: "Decorated Kufi", value: "RanaKufi", label: "Rana Kufi", cssFamily: "RanaKufi" },
  { genre: "Wide Kufi", value: "Blaka", label: "Blaka", cssFamily: "Blaka" },
  { genre: "Modern", value: "Yekan", label: "Yekan", cssFamily: "Yekan" },
  { genre: "Modern", value: "Kufi", label: "Janna", cssFamily: "Kufi" },
  { genre: "Modern", value: "NotoSans", label: "Noto Sans", cssFamily: "'Noto Sans Arabic'" },
];

/** Shown when the block has no text yet, so every card still has letters. */
export const SAMPLE_FALLBACK = "أبجد";

/** Consecutive runs of the same genre, in list order. */
export const groupByGenre = (fonts: FontChoice[]) => {
  const groups: { genre: string; fonts: FontChoice[] }[] = [];
  for (const font of fonts) {
    const genre = font.genre ?? "Other";
    const last = groups[groups.length - 1];
    if (last && last.genre === genre) last.fonts.push(font);
    else groups.push({ genre, fonts: [font] });
  }
  return groups;
};

/** Built-ins then uploads. An upload has to reach this list, not only the shaping seam. */
export const fontChoicesWith = (customFonts: { key: string; label: string }[]): FontChoice[] => [
  ...FONT_OPTIONS,
  ...customFonts.map((f) => ({
    value: f.key,
    label: `${f.label} (uploaded)`,
    cssFamily: `'${f.key}'`,
    genre: "Uploaded",
  })),
];

/** Retired fonts stay in the list for saved blocks but are offered only when already chosen. */
export const visibleFonts = (fonts: FontChoice[], current?: string): FontChoice[] =>
  fonts.filter((f) => !f.retired || f.value === current);
