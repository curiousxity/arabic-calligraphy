import React from "react";

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
