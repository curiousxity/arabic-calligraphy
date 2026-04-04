/**
 * ArabicKeyboard — v4
 *
 * Changes:
 *  - Diacritics row is now always visible (no toggle button).
 *  - Diacritic keys use the same style as regular letter keys.
 *  - Removed the تشكيل / حروف toggle button from the top bar.
 *  - Top bar kept only for the "Arabic" label and optional close button.
 */

import React from "react";

// Arabic keyboard rows — standard QWERTY-position Arabic layout
const ROWS: string[][] = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج", "د"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ئ", "ء", "ؤ", "ر", "لا", "ى", "ة", "و", "ز", "ظ"],
  ["ذ", "آ", "إ", "أ", "ـ", "،", ".", "؟", "!"],
];

// Diacritics — always shown
const DIACRITIC_ROW: string[] = ["َ", "ً", "ُ", "ٌ", "ِ", "ٍ", "ْ", "ّ", "ٰ", "ٓ", "ٔ", "ٕ"];

type Props = {
  onKey: (key: string) => void;
  onSpace: () => void;
  onBackspace: () => void;
  style?: React.CSSProperties;
  onClose?: () => void;
};

/** A single keycap. Width is fluid (flex) so rows never overflow their container. */
const Key: React.FC<{
  label: string;
  onPress: () => void;
  danger?: boolean;
  pressed: boolean;
  setPressed: (v: boolean) => void;
}> = ({ label, onPress, danger, pressed, setPressed }) => (
  <button
    type="button"
    onPointerDown={() => setPressed(true)}
    onPointerUp={() => { setPressed(false); onPress(); }}
    onPointerLeave={() => setPressed(false)}
    style={{
      flex: "1 1 0",
      minWidth: 0,
      height: 34,
      padding: "0 2px",
      margin: "2px",
      borderRadius: 6,
      border: "1px solid rgba(0,80,160,0.18)",
      cursor: "pointer",
      fontFamily: "inherit",
      fontSize: 15,
      fontWeight: 500,
      userSelect: "none",
      transition: "transform 0.06s, box-shadow 0.06s",
      transform: pressed ? "translateY(1px)" : "translateY(0)",
      background: danger
        ? pressed ? "#b91c1c" : "linear-gradient(180deg,#ef4444 0%,#c81e1e 100%)"
        : pressed
        ? "#c8d9f0"
        : "linear-gradient(180deg,#ffffff 0%,#deeaf8 100%)",
      color: danger ? "#fff" : "#0d2a5e",
      boxShadow: pressed
        ? "0 1px 0 rgba(0,60,120,0.2)"
        : "0 2px 0 rgba(0,60,120,0.22), 0 1px 2px rgba(0,0,0,0.08)",
    }}
  >
    {label}
  </button>
);

/** Stateful wrapper so each key tracks its own pressed state independently */
const KeyStateful: React.FC<{ label: string; onPress: () => void; danger?: boolean }> = ({
  label, onPress, danger,
}) => {
  const [pressed, setPressed] = React.useState(false);
  return <Key label={label} onPress={onPress} danger={danger} pressed={pressed} setPressed={setPressed} />;
};

export const ArabicKeyboard: React.FC<Props> = ({
  onKey,
  onSpace,
  onBackspace,
  style,
  onClose,
}) => (
  <div
    style={{
      background: "linear-gradient(180deg, #dce8f5 0%, #c8daf0 100%)",
      borderRadius: 12,
      padding: "8px 6px 10px",
      boxShadow: "0 4px 16px rgba(0,60,120,0.18), 0 1px 4px rgba(0,0,0,0.1)",
      border: "1px solid rgba(0,80,160,0.18)",
      direction: "rtl",
      width: "100%",
      boxSizing: "border-box",
      overflow: "hidden",
      ...style,
    }}
  >
    {/* Top bar: label + optional close */}
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 5,
      paddingInline: 2,
    }}>
      <div style={{ width: 44 }} />
      <span style={{ color: "#4a6fa5", fontSize: 11, fontWeight: 500, letterSpacing: 0.5 }}>
        Arabic
      </span>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "rgba(0,80,160,0.1)",
            border: "none",
            borderRadius: 6,
            color: "#1e3a6e",
            fontSize: 11,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      ) : <div style={{ width: 44 }} />}
    </div>

    {/* Diacritics row — always visible, same style as letter keys */}
    <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 3 }}>
      {DIACRITIC_ROW.map((k) => (
        <KeyStateful key={k} label={k} onPress={() => onKey(k)} />
      ))}
    </div>

    {/* Main letter rows */}
    {ROWS.map((row, ri) => (
      <div key={ri} style={{ display: "flex", width: "100%", marginBottom: 2 }}>
        {row.map((k) => (
          <KeyStateful key={k} label={k} onPress={() => onKey(k)} />
        ))}
        {ri === 0 && (
          <KeyStateful label="⌫" onPress={onBackspace} danger />
        )}
      </div>
    ))}

    {/* Bottom action row */}
    <div style={{ display: "flex", alignItems: "center", marginTop: 2, width: "100%", gap: 2 }}>
      <SpaceBar onSpace={onSpace} />
      <KeyStateful label="↵" onPress={() => onKey("\n")} />
    </div>
  </div>
);

/** Space bar with its own pressed state */
const SpaceBar: React.FC<{ onSpace: () => void }> = ({ onSpace }) => {
  const [pressed, setPressed] = React.useState(false);
  return (
    <button
      type="button"
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => { setPressed(false); onSpace(); }}
      onPointerLeave={() => setPressed(false)}
      style={{
        flex: 1,
        height: 34,
        borderRadius: 6,
        border: "1px solid rgba(0,80,160,0.18)",
        background: pressed ? "#c8d9f0" : "linear-gradient(180deg,#ffffff 0%,#deeaf8 100%)",
        boxShadow: pressed
          ? "0 1px 0 rgba(0,60,120,0.2)"
          : "0 2px 0 rgba(0,60,120,0.22), 0 1px 2px rgba(0,0,0,0.08)",
        cursor: "pointer",
        color: "#0d2a5e",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: 1,
        transform: pressed ? "translateY(1px)" : "translateY(0)",
        transition: "transform 0.06s, box-shadow 0.06s",
      }}
    >
      مسافة
    </button>
  );
};

export default ArabicKeyboard;
