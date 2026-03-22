import React from "react";

const ARABIC_KEY_ROWS: string[][] = [
  ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"],
  ["ذ", "ً", "ٌ", "ٍ", "َ", "ُ", "ِ", "ّ", "ْ", "ـ"],
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج", "د"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ئ", "ء", "ؤ", "ر", "لا", "ى", "ة", "و", "ز", "ظ"],
];

export type ArabicKeyboardProps = {
  onKey: (k: string) => void;
  onSpace: () => void;
  onBackspace: () => void;
  style?: React.CSSProperties;
};

const rowWidths = [0, 12, 0, 6, 18];

export const ArabicKeyboard: React.FC<ArabicKeyboardProps> = ({
  onKey,
  onSpace,
  onBackspace,
  style,
}) => (
  <div
    style={{
      ...style,
      direction: "rtl",
      fontFamily: "system-ui, sans-serif",
      borderRadius: 14,
      padding: 10,
      background: "#fafafa",
      border: "1px solid #cfcfcf",
      boxShadow: "0 8px 20px rgba(0,0,0,0.18)",
      boxSizing: "border-box",
    }}
  >
    <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>Keyboard</div>

    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {ARABIC_KEY_ROWS.map((row, rowIndex) => (
        <div
          key={rowIndex}
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 5,
            paddingInlineStart: rowWidths[rowIndex] ?? 0,
          }}
        >
          {row.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onKey(key)}
              style={{
                flex: rowIndex === 0 ? "1 1 0" : "1 1 0",
                minWidth: rowIndex === 0 ? 0 : 0,
                height: rowIndex === 0 ? 42 : 42,
                padding: "6px 4px",
                fontSize: key.length > 1 ? 14 : 18,
                textAlign: "center",
                borderRadius: 8,
                border: "1px solid #cfcfcf",
                background: "#fff",
                cursor: "pointer",
                lineHeight: 1.1,
                boxShadow: "0 1px 0 rgba(0,0,0,0.04)",
              }}
            >
              {key}
            </button>
          ))}
        </div>
      ))}
    </div>

    <div
      style={{
        display: "flex",
        gap: 8,
        justifyContent: "center",
        marginTop: 10,
        direction: "ltr",
      }}
    >
      <button
        type="button"
        onClick={onSpace}
        style={{
          padding: "8px 28px",
          fontSize: 14,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: "#f0f0f0",
          cursor: "pointer",
          minWidth: 120,
        }}
      >
        Space
      </button>
      <button
        type="button"
        onClick={onBackspace}
        style={{
          padding: "8px 18px",
          fontSize: 14,
          borderRadius: 8,
          border: "1px solid #ccc",
          background: "#f0f0f0",
          cursor: "pointer",
          minWidth: 120,
        }}
      >
        Backspace
      </button>
    </div>
  </div>
);

export default ArabicKeyboard;
