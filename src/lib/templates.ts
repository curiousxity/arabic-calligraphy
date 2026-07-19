import type { TextBlock } from "../types";

export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  backgroundColor: string;
  blocks: Omit<TextBlock, "id">[];
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
  embossHighlightColor: "#ffffff",
  embossShadowColor: "#000000",
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
];
