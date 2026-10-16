/**
 * The tashkeel library: every mark the sidebar offers, grouped, and filtered
 * down to what the selected block's font can actually draw.
 *
 * Pure (no harfbuzz, no React) so the filtering is testable against the real
 * font files. See .claude/rules/tashkeel-library.md.
 */

export type TashkeelItem = {
  /** What gets inserted at the caret. */
  text: string;
  /** English name for the button's tooltip. */
  name: string;
  /**
   * Shown on the button instead of `text`. Marks are drawn on a tatweel so
   * they have a letter to sit on; a lone combining mark renders against a
   * dotted circle or not at all.
   */
  display?: string;
};

export type TashkeelGroup = {
  id: string;
  title: string;
  items: TashkeelItem[];
  /** One line under the title, for a group that needs explaining. */
  note?: string;
};

const TATWEEL = "\u0640";

const mark = (text: string, name: string): TashkeelItem => ({
  text,
  name,
  display: TATWEEL + text,
});

/** The nine everyday marks — the old إِعْرَاب row, always shown first and open. */
export const BASIC_GROUP: TashkeelGroup = {
  id: "basic",
  title: "إِعْرَاب",
  items: [
    mark("\u064E", "Fatha"),
    mark("\u064B", "Fathatan"),
    mark("\u064F", "Damma"),
    mark("\u064C", "Dammatan"),
    mark("\u0650", "Kasra"),
    mark("\u064D", "Kasratan"),
    mark("\u0652", "Sukun"),
    mark("\u0651", "Shadda"),
    mark("\u0670", "Superscript alef"),
  ],
};

export const MORE_GROUPS: TashkeelGroup[] = [
  {
    id: "shadda",
    title: "Shadda combinations",
    items: [
      mark("\u0651\u064E", "Shadda with fatha"),
      mark("\u0651\u064F", "Shadda with damma"),
      mark("\u0651\u0650", "Shadda with kasra"),
      mark("\u0651\u064B", "Shadda with fathatan"),
      mark("\u0651\u064C", "Shadda with dammatan"),
      mark("\u0651\u064D", "Shadda with kasratan"),
    ],
  },
  {
    id: "other",
    title: "Hamza, madda & more",
    items: [
      mark("\u0653", "Madda above"),
      mark("\u0654", "Hamza above"),
      mark("\u0655", "Hamza below"),
      mark("\u0656", "Subscript alef"),
      mark("\u0657", "Inverted damma"),
      mark("\u0658", "Noon ghunna"),
      mark("\u065E", "Fatha with two dots"),
    ],
  },
  {
    id: "quranic",
    title: "Quranic marks",
    items: [
      mark("\u06E1", "Small high dotless khah (jazm sukun)"),
      mark("\u06DF", "Small high rounded zero"),
      mark("\u06E0", "Small high upright rectangular zero"),
      mark("\u06E2", "Small high meem (iqlab)"),
      mark("\u06ED", "Small low meem"),
      mark("\u06E8", "Small high noon"),
      mark("\u06E7", "Small high yeh"),
      mark("\u06DC", "Small high seen"),
      mark("\u06E3", "Small low seen"),
      mark("\u06E4", "Small high madda"),
      mark("\u06EA", "Empty centre low stop"),
      mark("\u06EB", "Empty centre high stop"),
      mark("\u06EC", "Rounded high stop with filled centre"),
    ],
  },
  {
    id: "waqf",
    title: "Stop signs (waqf)",
    items: [
      mark("\u06D6", "Sala — pausing is permitted, continuing preferred"),
      mark("\u06D7", "Qala — pausing preferred"),
      mark("\u06D8", "Meem — pausing required"),
      mark("\u06D9", "Lam-alef — do not pause"),
      mark("\u06DA", "Jeem — pausing permitted"),
      mark("\u06DB", "Three dots — pause at one of the two"),
    ],
  },
  {
    id: "honorific",
    title: "Honorific signs",
    note: "Put these after a name.",
    items: [
      mark("\u0610", "Sallallahu alayhi wa sallam"),
      mark("\u0611", "Alayhis salaam"),
      mark("\u0612", "Rahmatullah alayh"),
      mark("\u0613", "Radiallahu anhu"),
      mark("\u0614", "Takhallus"),
    ],
  },
];

/**
 * Marks a font carries beyond Unicode, keyed by font key (`FontChoice.value`).
 *
 * Only glyphs that work as *typed* characters belong here. Most fonts' Private
 * Use Area glyphs fail that: Thuluth's decorated marks are what its own GSUB
 * swaps in for ordinary harakat (so the basic and shadda groups already draw
 * them — the buttons preview in the block's font), and a PUA character typed
 * between two letters is non-joining to HarfBuzz, so it breaks the join on
 * both sides. Jameel Noori's two honorifics survive because they go at the end
 * of a word, where there is no join left to break, and its GPOS attaches them.
 */
export const FONT_EXTRAS: Record<string, TashkeelGroup> = {
  Urdu: {
    id: "font-extras",
    title: "Only in this font",
    note: "Put these at the end of a word — inside a word they break the join.",
    items: [
      { text: "\uE000", name: "Radiallahu anhu (رضی اللہ عنہ)", display: TATWEEL + "\uE000" },
      { text: "\uE002", name: "Rahmatullah alayh (رحمۃ اللہ علیہ)", display: TATWEEL + "\uE002" },
    ],
  },
};

/** The slice of an opentype.js `Font` this module needs. */
export type GlyphLookup = { charToGlyphIndex(ch: string): number };

/** True when the font has a glyph for every character of `text`. */
export function fontHasAll(font: GlyphLookup, text: string): boolean {
  for (const ch of text) {
    if (!font.charToGlyphIndex(ch)) return false;
  }
  return true;
}

/**
 * The library for one font: the basic marks, the font's own extras, then the
 * other standard groups — each with the marks the font can't draw removed. A group left empty is
 * dropped, so a font with no Quranic marks shows no Quranic heading.
 *
 * With no font (still loading, or failed to load) everything is returned:
 * hiding the whole library for a moment reads as a bug, and a missing mark is
 * already stripped before shaping (`stripUnsupportedDiacritics`).
 */
export function tashkeelGroupsFor(
  font: GlyphLookup | null,
  fontKey: string
): TashkeelGroup[] {
  const extras = FONT_EXTRAS[fontKey];
  const all = [BASIC_GROUP, ...(extras ? [extras] : []), ...MORE_GROUPS];
  if (!font) return all;
  return all
    .map((g) => ({ ...g, items: g.items.filter((it) => fontHasAll(font, it.text)) }))
    .filter((g) => g.items.length > 0);
}
