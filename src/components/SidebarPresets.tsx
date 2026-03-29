import React from "react";

export const DIACRITICS = ["َ", "ً", "ُ", "ٌ", "ِ", "ٍ", "ْ", "ّ", "ٰ"];
export const SPECIALS = ["ـ", "لا", "لآ", "لأ", "لإ", "ﷲ", "ﷺ", "ﷻ", "ء", "أ", "إ", "آ", "ؤ", "ئ", "ة", "ى"];
export const PERSIAN = ["پ", "چ", "گ", "ک", "ی", "ە"];
export const URDU = ["ٹ", "ڈ", "ڑ", "ں", "ھ", "ے", "ۓ"];
export const PRESETS = [
  // Phrase presets
  "بِسْمِ",
  "اللّٰه",
  "الرَّحْمٰن",
  "الرَّحِيم",
  "مَحَمَّد",

  // Private Use Area honorifics (Fatemi PUA glyphs)

  "\uE833",  // 
  "\uE834",  // 
  "\uE835",  // 
  "\uE836",  // 
  "\uE838",  // 
  "\uE839",  // 
  "\uE837",  //   طول الله عمره الشريف symbol
  "\uE840",  // 
];

export type PresetButtonProps = {
  label: string;
  onClick: () => void;
  style?: React.CSSProperties;
};

export const PresetButton: React.FC<PresetButtonProps> = ({ label, onClick, style }) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      border: "1px solid #cfcfcf",
      background: "#fff",
      color: "#111827",
      borderRadius: 8,
      padding: "7px 10px",
      cursor: "pointer",
      fontSize: label.length > 3 ? 12 : 14,
      fontWeight: 600,
      lineHeight: 1.1,
      boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
      ...style,
    }}
  >
    {label}
  </button>
);
