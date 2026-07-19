import type { TextBlock } from "../types";

export type StarterTemplate = {
  id: string;
  label: string;
  description: string;
  canvasPresetId: "square" | "story" | "a4";
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
  locked: false,
  rotation: 0,
};

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: "bismillah-card",
    label: "Bismillah Card",
    description: "Centered Bismillah in gold on a navy square.",
    canvasPresetId: "square",
    backgroundColor: "#0d1526",
    blocks: [
      {
        ...baseText,
        text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
        fontFamily: "FatemiMaqala",
        color: "#d4af37",
        fontSize: 110,
        x: 540,
        y: 460,
      },
    ],
  },
  {
    id: "eid-greeting",
    label: "Eid Greeting",
    description: "Large greeting with a subtitle line, sized for a story post.",
    canvasPresetId: "story",
    backgroundColor: "#f2ead9",
    blocks: [
      {
        ...baseText,
        text: "عِيدكُم مُبارَك",
        fontFamily: "TahaNaskhRegular",
        color: "#a8791a",
        fontSize: 140,
        x: 540,
        y: 760,
      },
      {
        ...baseText,
        text: "كل عام وأنتم بخير",
        fontFamily: "Amiri",
        color: "#1a2340",
        fontSize: 60,
        x: 540,
        y: 980,
      },
    ],
  },
  {
    id: "name-monogram",
    label: "Name Monogram",
    description: "A single bold word, centered — good for names or short titles.",
    canvasPresetId: "square",
    backgroundColor: "#ffffff",
    blocks: [
      {
        ...baseText,
        text: "اسم",
        fontFamily: "Thuluth",
        color: "#1e3a5f",
        fontSize: 260,
        x: 540,
        y: 540,
      },
    ],
  },
  {
    id: "quote-card",
    label: "Quote Card",
    description: "A body line with a smaller attribution, sized for print (A4).",
    canvasPresetId: "a4",
    backgroundColor: "#faf5e8",
    blocks: [
      {
        ...baseText,
        text: "وَقُل رَّبِّ زِدْنِي عِلْمًا",
        fontFamily: "TahaNaskhRegular",
        color: "#1a2340",
        fontSize: 130,
        x: 1240,
        y: 1500,
      },
      {
        ...baseText,
        text: "سورة طه ١١٤",
        fontFamily: "Amiri",
        color: "#8a92a8",
        fontSize: 55,
        x: 1240,
        y: 1750,
      },
    ],
  },
];
