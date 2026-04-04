/**
 * ArabicKeyboard — v3 (Round 4)
 *
 * Design goals:
 *  - LIGHT palette: white/pale-blue keys on a soft blue-gray body (no dark navy)
 *  - Compact and contained: fits sidebar width without keys overflowing
 *  - Keys use flexWrap + percentage sizing so they always reflow inside the container
 *  - Smaller key height (34px instead of 42px)
 *  - Accent/danger keys remain coloured (blue / red)
 */

import React, { useState } from "react";

// Arabic keyboard rows — standard QWERTY-position Arabic layout
const ROWS: string[][] = [
  ["ض", "ص", "ث", "ق", "ف", "غ", "ع", "ه", "خ", "ح", "ج", "د"],
  ["ش", "س", "ي", "ب", "ل", "ا", "ت", "ن", "م", "ك", "ط"],
  ["ئ", "ء", "ؤ", "ر", "لا", "ى", "ة", "و", "ز", "ظ"],
  ["ذ", "آ", "إ", "أ", "ـ", "،", ".", "؟", "!"],
];

// Common diacritics
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
  accent?: boolean;
  danger?: boolean;
}> = ({ label, onPress, accent, danger }) => {
  const [pressed, setPressed] = useState(false);

  return (
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
          : accent
          ? pressed ? "#1e50b3" : "linear-gradient(180deg,#3b82f6 0%,#1d4ed8 100%)"
          : pressed
          ? "#c8d9f0"
          : "linear-gradient(180deg,#ffffff 0%,#deeaf8 100%)",
        color: danger || accent ? "#fff" : "#0d2a5e",
        boxShadow: pressed
          ? "0 1px 0 rgba(0,60,120,0.2)"
          : "0 2px 0 rgba(0,60,120,0.22), 0 1px 2px rgba(0,0,0,0.08)",
      }}
    >
      {label}
    </button>
  );
};

export const ArabicKeyboard: React.FC<Props> = ({
  onKey,
  onSpace,
  onBackspace,
  style,
  onClose,
}) => {
  const [showDiacritics, setShowDiacritics] = useState(false);

  return (
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
      {/* Top bar: diacritics toggle + label + close */}
      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 5,
        paddingInline: 2,
      }}>
        <button
          type="button"
          onClick={() => setShowDiacritics((v) => !v)}
          style={{
            background: showDiacritics ? "#3b82f6" : "rgba(0,80,160,0.12)",
            border: "none",
            borderRadius: 6,
            color: showDiacritics ? "#fff" : "#1e3a6e",
            fontSize: 11,
            padding: "3px 8px",
            cursor: "pointer",
            fontWeight: 500,
          }}
        >
          {showDiacritics ? "حروف" : "تشكيل"}
        </button>

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

      {/* Diacritics row (conditional) */}
      {showDiacritics && (
        <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 3 }}>
          {DIACRITIC_ROW.map((k) => (
            <Key key={k} label={k} onPress={() => onKey(k)} accent />
          ))}
        </div>
      )}

      {/* Main letter rows */}
      {ROWS.map((row, ri) => (
        <div key={ri} style={{ display: "flex", width: "100%", marginBottom: 2 }}>
          {row.map((k) => (
            <Key key={k} label={k} onPress={() => onKey(k)} />
          ))}
          {ri === 0 && (
            <Key label="⌫" onPress={onBackspace} danger />
          )}
        </div>
      ))}

      {/* Bottom action row */}
      <div style={{ display: "flex", alignItems: "center", marginTop: 2, width: "100%", gap: 2 }}>
        {/* Space bar */}
        <button
          type="button"
          onPointerDown={(e) => (e.currentTarget.style.transform = "translateY(1px)")}
          onPointerUp={(e) => { e.currentTarget.style.transform = "translateY(0)"; onSpace(); }}
          onPointerLeave={(e) => (e.currentTarget.style.transform = "translateY(0)")}
          style={{
            flex: 1,
            height: 34,
            borderRadius: 6,
            border: "1px solid rgba(0,80,160,0.18)",
            background: "linear-gradient(180deg,#ffffff 0%,#deeaf8 100%)",
            boxShadow: "0 2px 0 rgba(0,60,120,0.22), 0 1px 2px rgba(0,0,0,0.08)",
            cursor: "pointer",
            color: "#0d2a5e",
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: 1,
            transition: "transform 0.06s, box-shadow 0.06s",
          }}
        >
          مسافة
        </button>

        <Key label="↵" onPress={() => onKey("\n")} accent />
      </div>
    </div>
  );
};

export default ArabicKeyboard;
