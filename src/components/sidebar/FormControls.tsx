import React, { useEffect, useState } from "react";

const SLIDER_DEFAULTS: Record<string, number> = {
  fontSize: 53,
  opacity: 1,
  rotation: 0,
  strokeWidth: 0,
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0.35,
  warpX: 0,
  warpY: 0,
  shapeFillSpacing: 1.3,
  shapeFillScaleX: 1,
  shapeFillScaleY: 1,
  shapeFillTextRotation: 0,
  shapeScale: 1,
  warpShapePadding: 24,
  warpShapeStrength: 1,
};

export const SelectRow = ({
  id,
  name,
  label,
  value,
  onChange,
  children,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) => (
  <label className="field" htmlFor={id}>
    <span className="fieldTitle">{label}</span>
    <div className="shell">
      <select
        id={id}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="select"
      >
        {children}
      </select>
    </div>
  </label>
);

const COLOR_PALETTE = [
  "#000000",
  "#ffffff",
  "#c9a227",
  "#8b1e3f",
  "#0f5132",
  "#1e3a5f",
  "#6b21a8",
  "#9ca3af",
];

const isValidHex = (v: string) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v);

const normalizeHex = (v: string) =>
  v.length === 4
    ? `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase()
    : v.toLowerCase();

export const ColorRow = ({
  id,
  name,
  label,
  value,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) => {
  const [hexDraft, setHexDraft] = useState(value);

  useEffect(() => {
    setHexDraft(value);
  }, [value]);

  const commitHex = () => {
    const v = hexDraft.trim().startsWith("#") ? hexDraft.trim() : `#${hexDraft.trim()}`;
    if (isValidHex(v)) {
      onChange(normalizeHex(v));
    } else {
      setHexDraft(value);
    }
  };

  return (
    <div className="field">
      <span className="fieldTitle">{label}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          id={id}
          name={name}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="sidebarColorInput"
          style={{ width: 40, height: 32, flexShrink: 0, padding: 2 }}
          aria-label={label}
        />
        <input
          type="text"
          value={hexDraft}
          onChange={(e) => setHexDraft(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commitHex();
            }
          }}
          className="hexInput"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          aria-label={`${label} hex value`}
        />
      </div>
      <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
        {COLOR_PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            aria-label={`Set ${label.toLowerCase()} to ${c}`}
            className="paletteSwatch"
            style={{
              background: c,
              boxShadow:
                value.toLowerCase() === c
                  ? "0 0 0 2px var(--bg-panel), 0 0 0 4px var(--accent)"
                  : undefined,
            }}
          />
        ))}
      </div>
    </div>
  );
};

export const RangeRow = ({
  id,
  name,
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
  fieldKey,
}: {
  id: string;
  name: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string | number;
  fieldKey?: string;
}) => {
  const defaultVal =
    fieldKey !== undefined ? SLIDER_DEFAULTS[fieldKey] ?? value : value;

  return (
    <label
      className="field"
      htmlFor={id}
      title={fieldKey ? `Double-click to reset to ${defaultVal}` : undefined}
    >
      <span className="fieldTitle">
        {label}
        {suffix !== undefined ? (
          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}> {suffix}</span>
        ) : null}
      </span>
      <input
        id={id}
        name={name}
        type="range"
        min={min}
        max={max}
        step={step ?? 1}
        value={value}
        onChange={(e) =>
          onChange(step ? parseFloat(e.target.value) : parseInt(e.target.value, 10))
        }
        onDoubleClick={() => {
          if (fieldKey !== undefined) onChange(defaultVal);
        }}
        className="rangeInput"
        style={{ cursor: "pointer" }}
      />
    </label>
  );
};

export const PresetKeyboard = ({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: string[][];
  onPick: (v: string) => void;
}) => (
  <div className="sidebarPresetKeyboard">
    <div className="sidebarPresetKeyboardTitle">{title}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row, ri) => (
        <div key={ri} className="sidebarPresetKeyboardRow">
          {row.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={
                key.length > 1
                  ? "sidebarPresetKeyboardKey sidebarPresetKeyboardKeyWide"
                  : "sidebarPresetKeyboardKey"
              }
            >
              {key}
            </button>
          ))}
        </div>
      ))}
    </div>
  </div>
);
