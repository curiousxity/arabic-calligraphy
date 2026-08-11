import type { TextBlock } from "../types";

export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  backgroundColor: string;
  blocks: Omit<TextBlock, "id">[];
  /**
   * One entry per block that should be user-editable through the Template
   * Wizard (TemplateWizardDialog.tsx) — every block in every template
   * currently gets exactly one field (no "primary vs. secondary block"
   * curation), but this stays optional so a future template added without
   * field metadata falls back to Sidebar.tsx's plain one-click-apply path
   * instead of erroring.
   */
  fields?: { blockIndex: number; label: string }[];
};

const baseText: Omit<TextBlock, "id" | "text" | "x" | "y" | "fontSize" | "fontFamily" | "color"> = {
  type: "text",
  fontStyle: "normal",
  align: "center",
  lineHeight: 1.2,
  opacity: 1,
  stroke: "#000000",
  strokeWidth: 0,
  shadowColor: "#000000",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0.35,
  locked: false,
  rotation: 0,
};

// Block coordinates are centered on the world origin (0,0) — the canvas has
// no declared page size, so "reset view" fits/centers on whatever the
// template's blocks' combined bounding box turns out to be.
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "bismillah-card",
    label: "Bismillah Card",
    description: "Centered Bismillah in gold on a navy square.",
    backgroundColor: "#0d1526",
    fields: [{ blockIndex: 0, label: "Bismillah phrase" }],
    blocks: [
      {
        ...baseText,
        text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
        fontFamily: "FatemiMaqala",
        color: "#d4af37",
        fontSize: 110,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "eid-greeting",
    label: "Eid Greeting",
    description: "Large greeting with a subtitle line, sized for a story post.",
    backgroundColor: "#f2ead9",
    fields: [
      { blockIndex: 0, label: "Main greeting" },
      { blockIndex: 1, label: "Subtitle" },
    ],
    blocks: [
      {
        ...baseText,
        text: "عِيدكُم مُبارَك",
        fontFamily: "TahaNaskhRegular",
        color: "#a8791a",
        fontSize: 140,
        x: 0,
        y: -110,
      },
      {
        ...baseText,
        text: "كل عام وأنتم بخير",
        fontFamily: "Amiri",
        color: "#1a2340",
        fontSize: 60,
        x: 0,
        y: 110,
      },
    ],
  },
  {
    id: "name-monogram",
    label: "Name Monogram",
    description: "A single bold word, centered — good for names or short titles.",
    backgroundColor: "#ffffff",
    fields: [{ blockIndex: 0, label: "Name" }],
    blocks: [
      {
        ...baseText,
        text: "اسم",
        fontFamily: "Thuluth",
        color: "#1e3a5f",
        fontSize: 260,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "quote-card",
    label: "Quote Card",
    description: "A body line with a smaller attribution, sized for print (A4).",
    backgroundColor: "#faf5e8",
    fields: [
      { blockIndex: 0, label: "Main verse" },
      { blockIndex: 1, label: "Reference" },
    ],
    blocks: [
      {
        ...baseText,
        text: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
        fontFamily: "TahaNaskhRegular",
        color: "#1a2340",
        fontSize: 130,
        x: 0,
        y: -125,
      },
      {
        ...baseText,
        text: "سورة طه ١١٤",
        fontFamily: "Amiri",
        color: "#8a92a8",
        fontSize: 55,
        x: 0,
        y: 125,
      },
    ],
  },
  {
    id: "salawat-card",
    label: "Salawat Card",
    description: "An elegant Salawat phrase in gold on deep navy.",
    backgroundColor: "#15213a",
    fields: [{ blockIndex: 0, label: "Salawat phrase" }],
    blocks: [
      {
        ...baseText,
        text: "اللَّهُمَّ صَلِّ عَلَى مُحَمَّد",
        fontFamily: "AlFatemi",
        color: "#d4af37",
        fontSize: 90,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "ramadan-greeting",
    label: "Ramadan Greeting",
    description: "Festive Ramadan greeting in gold on deep purple.",
    backgroundColor: "#2a1a3d",
    fields: [{ blockIndex: 0, label: "Greeting" }],
    blocks: [
      {
        ...baseText,
        text: "رَمَضَان مُبَارَك",
        fontFamily: "ThuluthDeco",
        color: "#e8c766",
        fontSize: 170,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "mashaallah-tag",
    label: "MashaAllah Tag",
    description: "A small punchy phrase — good for stickers or badges.",
    backgroundColor: "#f5eeda",
    fields: [{ blockIndex: 0, label: "Phrase" }],
    blocks: [
      {
        ...baseText,
        text: "مَا شَاءَ اللّٰه",
        fontFamily: "Wessam",
        color: "#8b1e3f",
        fontSize: 130,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "alhamdulillah-tag",
    label: "Alhamdulillah Tag",
    description: "A single word of gratitude on a warm cream background.",
    backgroundColor: "#f5f1e0",
    fields: [{ blockIndex: 0, label: "Phrase" }],
    blocks: [
      {
        ...baseText,
        text: "الحَمْدُ لِلّٰهِ",
        fontFamily: "Qahiri",
        color: "#0f5c4a",
        fontSize: 140,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "jumuah-greeting",
    label: "Jumu'ah Greeting",
    description: "Friday greeting in gold on deep green, geometric Kufi style.",
    backgroundColor: "#1b3a2f",
    fields: [{ blockIndex: 0, label: "Greeting" }],
    blocks: [
      {
        ...baseText,
        text: "جُمُعَة مُبَارَكَة",
        fontFamily: "Kufi2",
        color: "#e8c766",
        fontSize: 120,
        x: 0,
        y: 0,
      },
    ],
  },
  {
    id: "wedding-blessing",
    label: "Wedding Blessing",
    description: "A blessing line with a smaller occasion subtitle, blush palette.",
    backgroundColor: "#f9ece9",
    fields: [
      { blockIndex: 0, label: "Blessing" },
      { blockIndex: 1, label: "Subtitle" },
    ],
    blocks: [
      {
        ...baseText,
        text: "بَارَكَ اللهُ لَكُمَا",
        fontFamily: "Scheherazade",
        color: "#9c3b53",
        fontSize: 100,
        x: 0,
        y: -100,
      },
      {
        ...baseText,
        text: "زَفَافٌ مُبَارَك",
        fontFamily: "Lateef",
        color: "#6b6b6b",
        fontSize: 55,
        x: 0,
        y: 100,
      },
    ],
  },
  {
    id: "newborn-mabrook",
    label: "Newborn Mabrook",
    description: "Congratulations on a new baby, soft blue palette.",
    backgroundColor: "#eaf3f7",
    fields: [
      { blockIndex: 0, label: "Main word" },
      { blockIndex: 1, label: "Subtitle" },
    ],
    blocks: [
      {
        ...baseText,
        text: "مَبْرُوك",
        fontFamily: "Ruqaa",
        color: "#2f6b8f",
        fontSize: 170,
        x: 0,
        y: -100,
      },
      {
        ...baseText,
        text: "مَوْلُودٌ جَدِيد",
        fontFamily: "Amiri",
        color: "#8a92a8",
        fontSize: 55,
        x: 0,
        y: 110,
      },
    ],
  },
  {
    id: "condolence-card",
    label: "Condolence Card",
    description: "A somber black-on-white card with the Quranic verse reference.",
    backgroundColor: "#ffffff",
    fields: [
      { blockIndex: 0, label: "Main phrase" },
      { blockIndex: 1, label: "Verse reference" },
    ],
    blocks: [
      {
        ...baseText,
        text: "إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُون",
        fontFamily: "Yekan",
        color: "#2b2b2b",
        fontSize: 75,
        x: 0,
        y: -90,
      },
      {
        ...baseText,
        text: "سُورَة البَقَرَة ١٥٦",
        fontFamily: "Amiri",
        color: "#8a8a8a",
        fontSize: 45,
        x: 0,
        y: 90,
      },
    ],
  },
  {
    id: "shukran-tag",
    label: "Shukran Tag",
    description: "A punchy thank-you word — good for stickers or cards.",
    backgroundColor: "#fff8e7",
    fields: [{ blockIndex: 0, label: "Phrase" }],
    blocks: [
      {
        ...baseText,
        text: "شُكْرًا",
        fontFamily: "Kufi",
        color: "#a8791a",
        fontSize: 170,
        x: 0,
        y: 0,
      },
    ],
  },
];

/**
 * Builds a template's blocks with each field's text substituted in, indexed
 * positionally against `template.fields` (values[i] corresponds to
 * template.fields[i], not directly to template.blocks[i] — a field's own
 * `blockIndex` says which block it targets). A blank/whitespace-only value
 * falls back to that block's original authored text, so a user can't
 * generate a block with empty text by accident. Every other block property
 * (font, color, size, position) is untouched. Does not mutate `template`.
 */
export function buildBlocksFromTemplate(
  template: StarterTemplate,
  values: string[]
): Omit<TextBlock, "id">[] {
  const blocks = template.blocks.map((b) => ({ ...b }));
  const fields = template.fields ?? [];
  fields.forEach((field, i) => {
    const value = values[i]?.trim();
    if (value) {
      blocks[field.blockIndex] = { ...blocks[field.blockIndex], text: value };
    }
  });
  return blocks;
}
