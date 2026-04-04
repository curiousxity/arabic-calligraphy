import React, { useRef, useState } from "react";
import ArabicKeyboard from "./ArabicKeyboard";
import { DIACRITICS, SPECIALS, PERSIAN, URDU, PRESETS } from "./SidebarPresets";
import type { Block } from "../types";

export type SidebarProps = {
  blocks: Block[];
  selectedBlock?: Block;
  showGrid: boolean;
  snapToGrid: boolean;
  isMobile: boolean;
  width: number;
  canvasPresetId: string;
  onChangeCanvasPreset: (id: string) => void;
  backgroundColor: string;
  onChangeBackgroundColor: (color: string) => void;
  onAddBlock: () => void;
  onDuplicateBlock: () => void;
  onDeleteBlock: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportPDF: () => void;
  onSaveLayout: () => void;
  onLoadLayout: () => void;
  onDownloadLayout: () => void;
  onUploadLayout: () => void;
  onAddShapeFillBlock?: (svgPathData: string, w: number, h: number) => void;
  onToggleGrid: (v: boolean) => void;
  onToggleSnap: (v: boolean) => void;
  onSelectBlock: (id: number | null) => void;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  onUpdateBlock?: (id: number, patch: Partial<Block>) => void;
  onReorderBlocks?: (blocks: Block[]) => void;
  onMergeBlocks?: (idA: number, idB: number) => void;
  showKeyboard: boolean;
  onToggleKeyboard: () => void;
  onClearDiacritics: () => void;
  onInsertPreset: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const SLIDER_DEFAULTS: Record<string, number> = {
  fontSize: 53,
  opacity: 1,
  rotation: 0,
  strokeWidth: 0,
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0.35,
  shapeFillSpacing: 1.3,
  shapeFillScaleX: 1,
  shapeFillScaleY: 1,
  shapeFillTextRotation: 0,
  shapeScale: 1,
};

const makeId = (base: string, suffix?: string | number) =>
  suffix == null ? base : `${base}-${suffix}`;

const SelectRow = ({
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

const ColorRow = ({
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
}) => (
  <label className="field" htmlFor={id}>
    <span className="fieldTitle">{label}</span>
    <input
      id={id}
      name={name}
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="sidebarColorInput"
    />
  </label>
);

const RangeRow = ({
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
  suffix?: string;
  fieldKey?: string;
}) => {
  const defaultVal = fieldKey !== undefined ? (SLIDER_DEFAULTS[fieldKey] ?? value) : value;

  const handleDoubleClick = () => {
    if (fieldKey !== undefined) onChange(defaultVal);
  };

  return (
    <label
      className="field"
      htmlFor={id}
      title={fieldKey ? `Double-click to reset to ${defaultVal}` : undefined}
    >
      <span className="fieldTitle">
        {label}{" "}
        {suffix ? <span style={{ color: "#6b7280", fontWeight: 500 }}>{suffix}</span> : null}
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
        onDoubleClick={handleDoubleClick}
        className="rangeInput"
        style={{ cursor: "pointer" }}
      />
    </label>
  );
};

const PresetKeyboard = ({
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
              className={`sidebarPresetKeyboardKey ${
                key.length > 1 ? "sidebarPresetKeyboardKeyWide" : ""
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      ))}
    </div>
  </div>
);

function svgElementToPathData(el: Element): string {
  const tag = el.tagName.toLowerCase().replace(/^.*:/, "");
  switch (tag) {
    case "path":
      return el.getAttribute("d") ?? "";
    case "rect": {
      const rx = parseFloat(el.getAttribute("rx") ?? "0");
      const ry = parseFloat(el.getAttribute("ry") ?? rx.toString());
      const ex = parseFloat(el.getAttribute("x") ?? "0");
      const ey = parseFloat(el.getAttribute("y") ?? "0");
      const w = parseFloat(el.getAttribute("width") ?? "0");
      const h = parseFloat(el.getAttribute("height") ?? "0");
      if (rx === 0 && ry === 0) return `M ${ex} ${ey} H ${ex + w} V ${ey + h} H ${ex} Z`;
      const r = Math.min(rx, w / 2, ry, h / 2);
      return (
        `M ${ex + r} ${ey} H ${ex + w - r} Q ${ex + w} ${ey} ${ex + w} ${ey + r} ` +
        `V ${ey + h - r} Q ${ex + w} ${ey + h} ${ex + w - r} ${ey + h} ` +
        `H ${ex + r} Q ${ex} ${ey + h} ${ex} ${ey + h - r} ` +
        `V ${ey + r} Q ${ex} ${ey} ${ex + r} ${ey} Z`
      );
    }
    case "circle": {
      const cx = parseFloat(el.getAttribute("cx") ?? "0");
      const cy = parseFloat(el.getAttribute("cy") ?? "0");
      const r = parseFloat(el.getAttribute("r") ?? "0");
      const k = 0.5522847498;
      return (
        `M ${cx} ${cy - r} C ${cx + r * k} ${cy - r} ${cx + r} ${cy - r * k} ${cx + r} ${cy} ` +
        `C ${cx + r} ${cy + r * k} ${cx + r * k} ${cy + r} ${cx} ${cy + r} ` +
        `C ${cx - r * k} ${cy + r} ${cx - r} ${cy + r * k} ${cx - r} ${cy} ` +
        `C ${cx - r} ${cy - r * k} ${cx - r * k} ${cy - r} ${cx} ${cy - r} Z`
      );
    }
    case "ellipse": {
      const cx = parseFloat(el.getAttribute("cx") ?? "0");
      const cy = parseFloat(el.getAttribute("cy") ?? "0");
      const rx2 = parseFloat(el.getAttribute("rx") ?? "0");
      const ry2 = parseFloat(el.getAttribute("ry") ?? "0");
      const k = 0.5522847498;
      return (
        `M ${cx} ${cy - ry2} C ${cx + rx2 * k} ${cy - ry2} ${cx + rx2} ${cy - ry2 * k} ${cx + rx2} ${cy} ` +
        `C ${cx + rx2} ${cy + ry2 * k} ${cx + rx2 * k} ${cy + ry2} ${cx} ${cy + ry2} ` +
        `C ${cx - rx2 * k} ${cy + ry2} ${cx - rx2} ${cy + ry2 * k} ${cx - rx2} ${cy} ` +
        `C ${cx - rx2} ${cy - ry2 * k} ${cx - rx2 * k} ${cy - ry2} ${cx} ${cy - ry2} Z`
      );
    }
    case "polygon":
    case "polyline": {
      const pts = (el.getAttribute("points") ?? "")
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean);
      if (pts.length < 2) return "";
      let d = `M ${pts[0]} ${pts[1]}`;
      for (let i = 2; i < pts.length - 1; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
      if (tag === "polygon") d += " Z";
      return d;
    }
    default:
      return "";
  }
}

/**
 * Normalize all SVG coordinate numbers in a path string by multiplying by
 * (targetSize / sourceSize). This handles both tiny icon SVGs (24px) and
 * large illustration SVGs (2000px) — everything ends up at TARGET_SIZE × TARGET_SIZE.
 */
const TARGET_SVG_SIZE = 500;

function scaleSvgPathNumbers(d: string, scaleX: number, scaleY: number): string {
  // We re-serialize via a simple token pass: scale every numeric token.
  // Commands that mix x/y coords (C, Q, etc.) alternate x then y implicitly,
  // so we track the coord parity per-command.
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens) return d;

  const out: string[] = [];
  let cmd = "";
  let argIdx = 0; // argument index within current command

  // How many args per command (absolute)
  const argCounts: Record<string, number> = {
    M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
  };
  // Which arg indices are X coords (0-based within the arg group)
  const xArgIdx: Record<string, number[]> = {
    M: [0], L: [0], H: [0], V: [], C: [0, 2, 4], S: [0, 2], Q: [0, 2], T: [0],
    A: [5], // arc endpoint x
  };
  const yArgIdx: Record<string, number[]> = {
    M: [1], L: [1], H: [], V: [0], C: [1, 3, 5], S: [1, 3], Q: [1, 3], T: [1],
    A: [6], // arc endpoint y
  };

  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) {
      cmd = tok.toUpperCase();
      argIdx = 0;
      out.push(tok);
    } else {
      const n = parseFloat(tok);
      const count = argCounts[cmd] ?? 2;
      const posInGroup = count > 0 ? argIdx % count : 0;
      const isX = (xArgIdx[cmd] ?? []).includes(posInGroup);
      const isY = (yArgIdx[cmd] ?? []).includes(posInGroup);
      let scaled = n;
      if (isX) scaled = n * scaleX;
      else if (isY) scaled = n * scaleY;
      // A command: args 0-4 are radii/flags, also scale radii (0=rx, 1=ry)
      if (cmd === "A" && (posInGroup === 0)) scaled = n * scaleX;
      if (cmd === "A" && (posInGroup === 1)) scaled = n * scaleY;
      out.push(String(parseFloat(scaled.toFixed(3))));
      argIdx++;
    }
  }
  return out.join(" ");
}

/**
 * Parse a simple SVG transform="translate(x,y) scale(s)" attribute into a matrix.
 * Returns [a, b, c, d, e, f] (SVG matrix). Only handles translate/scale/matrix.
 */
function parseTransform(t: string): [number,number,number,number,number,number] {
  let a=1,b=0,c=0,d=1,e=0,f=0;
  const mat = t.match(/matrix\(([^)]+)\)/);
  if (mat) { [a,b,c,d,e,f] = mat[1].split(/[\s,]+/).map(Number); return [a,b,c,d,e,f]; }
  const trans = t.match(/translate\(([^)]+)\)/);
  if (trans) { const [tx,ty=0] = trans[1].split(/[\s,]+/).map(Number); e=tx; f=ty; }
  const scale = t.match(/scale\(([^)]+)\)/);
  if (scale) { const [sx,sy=sx] = scale[1].split(/[\s,]+/).map(Number); a*=sx; d*=sy; }
  return [a,b,c,d,e,f];
}

/** Accumulate ancestor transforms from a DOM element up to the SVG root. */
function getAccumulatedTransform(el: Element): [number,number,number,number,number,number] {
  const mats: Array<[number,number,number,number,number,number]> = [];
  let node: Element | null = el;
  while (node && node.tagName.toLowerCase() !== "svg") {
    const t = node.getAttribute("transform");
    if (t) mats.unshift(parseTransform(t));
    node = node.parentElement;
  }
  // Multiply all matrices left-to-right
  let r: [number,number,number,number,number,number] = [1,0,0,1,0,0];
  for (const m of mats) {
    r = [
      r[0]*m[0]+r[2]*m[1], r[1]*m[0]+r[3]*m[1],
      r[0]*m[2]+r[2]*m[3], r[1]*m[2]+r[3]*m[3],
      r[0]*m[4]+r[2]*m[5]+r[4], r[1]*m[4]+r[3]*m[5]+r[5],
    ];
  }
  return r;
}


function extractSvgPaths(svgText: string): { pathData: string; w: number; h: number } | null {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) return null;
  const svgEl = doc.querySelector("svg");
  const vb = svgEl?.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
  const srcW = (vb?.[2] ?? parseFloat(svgEl?.getAttribute("width") ?? "400")) || 400;
  const srcH = (vb?.[3] ?? parseFloat(svgEl?.getAttribute("height") ?? "400")) || 400;
  // Scale everything to TARGET_SVG_SIZE — handles tiny icon SVGs and huge illustrations
  const sx = TARGET_SVG_SIZE / srcW;
  const sy = TARGET_SVG_SIZE / srcH;

  // querySelectorAll descends into nested <g> elements automatically
  const shapeEls = doc.querySelectorAll("path, rect, circle, ellipse, polygon, polyline");
  const parts: string[] = [];

  shapeEls.forEach((el) => {
    // Skip invisible elements
    const display = el.getAttribute("display") ?? el.closest("[display]")?.getAttribute("display");
    if (display === "none") return;
    const visibility = el.getAttribute("visibility") ?? el.closest("[visibility]")?.getAttribute("visibility");
    if (visibility === "hidden") return;

    let d = svgElementToPathData(el);
    if (!d) return;

    // Apply accumulated ancestor transforms (handles nested <g transform="...">)
    const mat = getAccumulatedTransform(el);
    if (!(mat[0]===1&&mat[1]===0&&mat[2]===0&&mat[3]===1&&mat[4]===0&&mat[5]===0)) {
      d = applyTransformToPathString(d, mat);
    }

    parts.push(scaleSvgPathNumbers(d, sx, sy));
  });

  if (parts.length === 0) return null;
  return { pathData: parts.join(" "), w: TARGET_SVG_SIZE, h: TARGET_SVG_SIZE };
}

/** Apply a matrix transform to all absolute coordinates in a path d string. */
function applyTransformToPathString(d: string, m: [number,number,number,number,number,number]): string {
  const [a,b,c,dd,e,f] = m;
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g);
  if (!tokens) return d;
  // First normalize to absolute commands, then apply matrix
  // For simplicity: only apply matrix to x/y pairs (covers M,L,C,Q,Z)
  // This works correctly for the shapes we extract (which are already absolute from svgElementToPathData)
  const out: string[] = [];
  let cmd = "";
  const nums: number[] = [];
  const flush = () => {
    if (!cmd) return;
    switch (cmd.toUpperCase()) {
      case "M": case "L": case "T":
        for (let i=0;i<nums.length;i+=2) {
          const nx=a*nums[i]+c*nums[i+1]+e, ny=b*nums[i]+dd*nums[i+1]+f;
          out.push(cmd,String(parseFloat(nx.toFixed(3))),String(parseFloat(ny.toFixed(3))));
          cmd="L"; // subsequent pairs are lineto
        }
        break;
      case "C":
        for (let i=0;i<nums.length;i+=6) {
          const pts = [nums[i],nums[i+1],nums[i+2],nums[i+3],nums[i+4],nums[i+5]];
          const t: number[] = [];
          for (let j=0;j<6;j+=2){t.push(a*pts[j]+c*pts[j+1]+e,b*pts[j]+dd*pts[j+1]+f);}
          out.push("C",...t.map(v=>String(parseFloat(v.toFixed(3)))));
        }
        break;
      case "Q": case "S":
        for (let i=0;i<nums.length;i+=4) {
          const t: number[] = [];
          for (let j=0;j<4;j+=2){t.push(a*nums[j]+c*nums[j+1]+e,b*nums[j]+dd*nums[j+1]+f);}
          out.push(cmd,...t.map(v=>String(parseFloat(v.toFixed(3)))));
        }
        break;
      case "H":
        for (const x of nums) out.push("L",String(parseFloat((a*x+e).toFixed(3))),String(parseFloat(f.toFixed(3))));
        break;
      case "V":
        for (const y of nums) out.push("L",String(parseFloat(e.toFixed(3))),String(parseFloat((dd*y+f).toFixed(3))));
        break;
      case "Z":
        out.push("Z");
        break;
      default:
        out.push(cmd,...nums.map(String));
    }
    nums.length=0;
  };
  for (const tok of tokens) {
    if (/^[MmLlHhVvCcSsQqTtAaZz]$/.test(tok)) { flush(); cmd=tok.toUpperCase(); }
    else nums.push(parseFloat(tok));
  }
  flush();
  return out.join(" ");
}

const blockTypeIcon = (b: Block) => (b.type === "shapeFill" ? "✦" : "T");

type LayersPanelProps = {
  blocks: Block[];
  selectedId?: number;
  onSelect: (id: number) => void;
  onToggleLock: (id: number) => void;
  onMoveUp: (id: number) => void;
  onMoveDown: (id: number) => void;
  onDelete: (id: number) => void;
  onMerge: (idA: number, idB: number) => void;
  onRename: (id: number, name: string) => void;
};

const LayersPanel: React.FC<LayersPanelProps> = ({
  blocks,
  selectedId,
  onSelect,
  onToggleLock,
  onMoveUp,
  onMoveDown,
  onDelete,
  onMerge,
  onRename,
}) => {
  const [mergeTarget, setMergeTarget] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);

  const reversed = [...blocks].reverse();

  const startEdit = (block: Block, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(block.id);
    setEditValue(block.name ?? `Block ${block.id}`);
    setTimeout(() => editRef.current?.select(), 0);
  };

  const commitEdit = () => {
    if (editingId !== null) {
      onRename(editingId, editValue.trim() || `Block ${editingId}`);
    }
    setEditingId(null);
  };

  const handleMergeClick = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (mergeTarget === null) setMergeTarget(id);
    else if (mergeTarget === id) setMergeTarget(null);
    else {
      onMerge(mergeTarget, id);
      setMergeTarget(null);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {mergeTarget !== null && (
        <div
          style={{
            fontSize: 11,
            color: "#0066cc",
            background: "#e8f0fe",
            borderRadius: 8,
            padding: "4px 8px",
            textAlign: "center",
          }}
        >
          Click ⊕ on another layer to merge
        </div>
      )}

      {reversed.map((block) => {
        const isSelected = block.id === selectedId;
        const isMerge = block.id === mergeTarget;
        const label = block.name ?? `Block ${block.id}`;

        return (
          <div
            key={block.id}
            onClick={() => onSelect(block.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "5px 7px",
              borderRadius: 10,
              background: isSelected ? "#dbeafe" : isMerge ? "#fef9c3" : "#f0f4fa",
              border: `1px solid ${isSelected ? "#93c5fd" : isMerge ? "#fcd34d" : "transparent"}`,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <span style={{ fontSize: 13, width: 18, textAlign: "center", flexShrink: 0 }}>
              {blockTypeIcon(block)}
            </span>

            {editingId === block.id ? (
              <input
                ref={editRef}
                id={makeId("layer-name", block.id)}
                name={makeId("layerName", block.id)}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1,
                  fontSize: 12,
                  border: "1px solid #3b82f6",
                  borderRadius: 5,
                  padding: "1px 5px",
                  background: "#fff",
                  outline: "none",
                  direction: "rtl",
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => startEdit(block, e)}
                title="Double-click to rename"
                style={{
                  flex: 1,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "#111827",
                  direction: "rtl",
                }}
              >
                {label}
              </span>
            )}

            <button
              type="button"
              title={block.locked ? "Unlock" : "Lock"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleLock(block.id);
              }}
              className="layerIconBtn"
            >
              {block.locked ? "🔒" : "🔓"}
            </button>
            <button
              type="button"
              title="Move up"
              onClick={(e) => {
                e.stopPropagation();
                onMoveUp(block.id);
              }}
              className="layerIconBtn"
            >
              ▲
            </button>
            <button
              type="button"
              title="Move down"
              onClick={(e) => {
                e.stopPropagation();
                onMoveDown(block.id);
              }}
              className="layerIconBtn"
            >
              ▼
            </button>
            <button
              type="button"
              title={isMerge ? "Cancel merge" : "Merge with another layer"}
              onClick={(e) => handleMergeClick(block.id, e)}
              className="layerIconBtn"
              style={{ background: isMerge ? "#fcd34d" : "transparent", borderRadius: 4 }}
            >
              ⊕
            </button>
            <button
              type="button"
              title="Delete layer"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(block.id);
              }}
              className="layerIconBtn"
              style={{ color: "#dc2626" }}
            >
              ✕
            </button>
          </div>
        );
      })}

      {blocks.length === 0 && (
        <div style={{ fontSize: 12, color: "#9ca3af", textAlign: "center", padding: 8 }}>
          No layers yet
        </div>
      )}
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  blocks,
  selectedBlock,
  showGrid,
  snapToGrid,
  isMobile,
  width,
  canvasPresetId,
  onChangeCanvasPreset,
  backgroundColor,
  onChangeBackgroundColor,
  onAddBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onExportPNG,
  onExportSVG,
  onExportPDF,
  onSaveLayout,
  onLoadLayout,
  onDownloadLayout,
  onUploadLayout,
  onAddShapeFillBlock,
  onToggleGrid,
  onToggleSnap,
  onSelectBlock,
  onUpdateSelectedBlock,
  onUpdateBlock,
  onReorderBlocks,
  onMergeBlocks,
  showKeyboard,
  onToggleKeyboard,
  onClearDiacritics,
  onInsertPreset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const [showStyling, setShowStyling] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);
  const [showFileActions, setShowFileActions] = useState(false);
  const [showLayers, setShowLayers] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  const selectedText = selectedBlock?.text ?? "";
  const selectedOpacity = selectedBlock?.opacity ?? 1;
  const selectedShadowOpacity = selectedBlock?.shadowOpacity ?? 0.35;
  const selectedRotation = selectedBlock?.rotation ?? 0;

  const updateText = (text: string) => {
    if (selectedBlock) onUpdateSelectedBlock({ text });
  };

  const activeBlockLabel = selectedBlock
    ? (selectedBlock.name ?? `Block ${selectedBlock.id}`) + ` (${selectedBlock.type})`
    : "Block";

  const handleKeyboardKey = (k: string) => {
    if (!selectedBlock) return;
    const before = selectedText.substring(0, cursorPosition);
    const after = selectedText.substring(cursorPosition);
    const newText = before + k + after;
    const newPos = cursorPosition + k.length;
    onUpdateSelectedBlock({ text: newText });
    setCursorPosition(newPos);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleKeyboardSpace = () => handleKeyboardKey(" ");

  const handleKeyboardBackspace = () => {
    if (!selectedBlock || cursorPosition === 0) return;
    const newText =
      selectedText.substring(0, cursorPosition - 1) + selectedText.substring(cursorPosition);
    const newPos = cursorPosition - 1;
    onUpdateSelectedBlock({ text: newText });
    setCursorPosition(newPos);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleToggleLock = (id: number) => {
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    if (onUpdateBlock) onUpdateBlock(id, { locked: !block.locked });
    else if (selectedBlock?.id === id) onUpdateSelectedBlock({ locked: !block.locked });
  };

  const handleMoveLayer = (id: number, dir: "up" | "down") => {
    if (!onReorderBlocks) return;
    const idx = blocks.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const nb = [...blocks];
    const swap = dir === "up" ? idx + 1 : idx - 1;
    if (swap < 0 || swap >= nb.length) return;
    [nb[idx], nb[swap]] = [nb[swap], nb[idx]];
    onReorderBlocks(nb);
  };

  const handleRename = (id: number, name: string) => {
    if (onUpdateBlock) onUpdateBlock(id, { name });
    else if (selectedBlock?.id === id) onUpdateSelectedBlock({ name });
  };

  const handleSvgUpload = () => {
    if (!onAddShapeFillBlock) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = extractSvgPaths(e.target?.result as string);
        if (!result) {
          alert(
            "No supported shape elements found in SVG (path, rect, circle, ellipse, polygon, polyline)."
          );
          return;
        }
        onAddShapeFillBlock(result.pathData, result.w, result.h);
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const selectedId = selectedBlock?.id ?? "none";

  return (
    <div
      style={{
        width,
        height: "100%",
        padding: 0,
        boxSizing: "border-box",
        borderRight: isMobile ? "none" : "1px solid #dbe2ea",
        borderBottom: isMobile ? "1px solid #dbe2ea" : "none",
        background: "linear-gradient(180deg, #e8edf2 0%, #dde3ea 100%)",
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: "relative",
        flexShrink: 0,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <div className="sidebarInner">
        <div className="sidebarPanel">
          <h2
            className="sidebarTitle"
            style={{
              fontSize: isMobile ? 18 : 20,
              textAlign: "center",
              color: "#111827",
              letterSpacing: "-0.02em",
            }}
          >
            Mohammed's Calligraphy
          </h2>
        </div>

        <div className="sidebarPanel">
          <div className="sidebarSectionTitle">Block Controls</div>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={onDeleteBlock}
              disabled={!selectedBlock || blocks.length === 0}
              className="sidebarCircleButton"
              title="Delete"
            >
              −
            </button>
            <button
              type="button"
              onClick={onDuplicateBlock}
              disabled={!selectedBlock}
              className="sidebarCircleButton"
              title="Duplicate"
            >
              ⧉
            </button>
            <button
              type="button"
              onClick={onAddBlock}
              className="sidebarCircleButton"
              title="Add text block"
            >
              +
            </button>
            {onAddShapeFillBlock && (
              <button
                type="button"
                className="sidebarCircleButton"
                title="Upload SVG shape — use a simple flat SVG with path/rect/circle/ellipse elements. Avoid SVGs with nested transforms or complex filters."
                onClick={handleSvgUpload}
              >
                ✦
              </button>
            )}
          </div>

          <div style={{ height: 8 }} />

          <div style={{ display: "flex", justifyContent: "center", gap: 10 }}>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="sidebarCircleButton"
              title="Undo"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="sidebarCircleButton"
              title="Redo"
            >
              ↷
            </button>
          </div>
        </div>

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowLayers((v) => !v)}
            className="sidebarSectionButton"
          >
            <span>Layers</span>
            <span>{showLayers ? "−" : "+"}</span>
          </button>

          {showLayers && (
            <div style={{ marginTop: 10 }}>
              <LayersPanel
                blocks={blocks}
                selectedId={selectedBlock?.id}
                onSelect={(id) => onSelectBlock(id)}
                onToggleLock={handleToggleLock}
                onMoveUp={(id) => handleMoveLayer(id, "up")}
                onMoveDown={(id) => handleMoveLayer(id, "down")}
                onDelete={(id) => {
                  const idx = blocks.findIndex((b) => b.id === id);
                  const remaining = blocks.filter((b) => b.id !== id);
                  const next = remaining[idx] ?? remaining[idx - 1];
                  onReorderBlocks?.(remaining);
                  onSelectBlock(next?.id ?? null);
                }}
                onMerge={(a, b) => onMergeBlocks?.(a, b)}
                onRename={handleRename}
              />
            </div>
          )}
        </div>

        {selectedBlock && (
          <div className="sidebarPanel">
            <label htmlFor={makeId("block-text", selectedId)} className="sr-only">
              Block text
            </label>
            <textarea
              ref={textareaRef}
              id={makeId("block-text", selectedId)}
              name={makeId("blockText", selectedId)}
              className="sidebarTextarea"
              value={selectedText}
              onChange={(e) => updateText(e.target.value)}
              onSelect={(e) => setCursorPosition(e.currentTarget.selectionStart ?? 0)}
              placeholder="Select a block to edit..."
            />
          </div>
        )}

        {selectedBlock && (
          <div className="sidebarPanel">
            <button
              type="button"
              onClick={() => setShowStyling((v) => !v)}
              className="sidebarSectionButton"
            >
              <span>Styling</span>
              <span>{showStyling ? "−" : "+"}</span>
            </button>

            {showStyling && (
              <div className="sectionPanel">
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <SelectRow
                    id={makeId("font-family", selectedId)}
                    name={makeId("fontFamily", selectedId)}
                    label="Font family"
                    value={selectedBlock.fontFamily}
                    onChange={(v) => onUpdateSelectedBlock({ fontFamily: v })}
                  >
                    <option value="AlFatemi">Al Fatemi</option>
                    <option value="FatemiMaqala">Fatemi Maqala</option>
                    <option value="TahaNaskhRegular">Taha Naskh</option>
                    <option value="Kufi">Kufi</option>
                    <option value="Kufi2">Kufi2</option>
                    <option value="Thuluth">Thuluth</option>
                    <option value="ThuluthDeco">Thuluth Deco</option>
                    <option value="Wessam">Wessam</option>
                    <option value="Yekan">Yekan</option>
                    <option value="NotoSans">Noto Sans</option>
                    <option value="Lateef">Lateef</option>
                    <option value="Amiri">Amiri</option>
                    <option value="Ruqaa">Ruqaa</option>
                    <option value="Qahiri">Qahiri</option>
                    <option value="Urdu">Urdu</option>
                  </SelectRow>

                  <SelectRow
                    id={makeId("font-style", selectedId)}
                    name={makeId("fontStyle", selectedId)}
                    label="Font style"
                    value={selectedBlock.fontStyle ?? "normal"}
                    onChange={(v) => onUpdateSelectedBlock({ fontStyle: v as Block["fontStyle"] })}
                  >
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                    <option value="italic">Italic</option>
                    <option value="bold italic">Bold italic</option>
                  </SelectRow>
                </div>

                <RangeRow
                  id={makeId("font-size", selectedId)}
                  name={makeId("fontSize", selectedId)}
                  label="Font size"
                  value={selectedBlock.fontSize}
                  min={selectedBlock.type === "shapeFill" ? 4 : 12}
                  max={selectedBlock.type === "shapeFill" ? 400 : 200}
                  onChange={(v) => onUpdateSelectedBlock({ fontSize: v })}
                  fieldKey="fontSize"
                />

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <ColorRow
                    id={makeId("text-color", selectedId)}
                    name={makeId("textColor", selectedId)}
                    label="Text color"
                    value={selectedBlock.color}
                    onChange={(v) => onUpdateSelectedBlock({ color: v })}
                  />
                  <RangeRow
                    id={makeId("opacity", selectedId)}
                    name={makeId("opacity", selectedId)}
                    label="Opacity"
                    value={selectedOpacity}
                    min={0.1}
                    max={1}
                    step={0.05}
                    onChange={(v) => onUpdateSelectedBlock({ opacity: v })}
                    suffix={`${Math.round(selectedOpacity * 100)}%`}
                    fieldKey="opacity"
                  />
                </div>

                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <div className="sidebarSectionTitle">Rotation</div>
                  <RangeRow
                    id={makeId("rotation", selectedId)}
                    name={makeId("rotation", selectedId)}
                    label="Rotation"
                    value={selectedRotation}
                    min={-180}
                    max={180}
                    step={1}
                    onChange={(v) => onUpdateSelectedBlock({ rotation: v })}
                    suffix={`${selectedRotation}°`}
                    fieldKey="rotation"
                  />
                </div>

                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <div className="sidebarSectionTitle">Stroke</div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: 10,
                    }}
                  >
                    <ColorRow
                      id={makeId("stroke-color", selectedId)}
                      name={makeId("strokeColor", selectedId)}
                      label="Stroke color"
                      value={selectedBlock.stroke ?? "#000000"}
                      onChange={(v) => onUpdateSelectedBlock({ stroke: v })}
                    />
                    <RangeRow
                      id={makeId("stroke-width", selectedId)}
                      name={makeId("strokeWidth", selectedId)}
                      label="Stroke width"
                      value={selectedBlock.strokeWidth ?? 0}
                      min={0}
                      max={14}
                      onChange={(v) => onUpdateSelectedBlock({ strokeWidth: v })}
                      fieldKey="strokeWidth"
                    />
                  </div>
                </div>

                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <div className="sidebarSectionTitle">Shadow</div>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: 10,
                    }}
                  >
                    <ColorRow
                      id={makeId("shadow-color", selectedId)}
                      name={makeId("shadowColor", selectedId)}
                      label="Shadow color"
                      value={selectedBlock.shadowColor ?? "#000000"}
                      onChange={(v) => onUpdateSelectedBlock({ shadowColor: v })}
                    />
                    <RangeRow
                      id={makeId("shadow-blur", selectedId)}
                      name={makeId("shadowBlur", selectedId)}
                      label="Shadow blur"
                      value={selectedBlock.shadowBlur ?? 0}
                      min={0}
                      max={40}
                      onChange={(v) => onUpdateSelectedBlock({ shadowBlur: v })}
                      fieldKey="shadowBlur"
                    />
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                      gap: 10,
                      marginTop: 8,
                    }}
                  >
                    <RangeRow
                      id={makeId("shadow-offset-x", selectedId)}
                      name={makeId("shadowOffsetX", selectedId)}
                      label="Shadow X"
                      value={selectedBlock.shadowOffsetX ?? 0}
                      min={-40}
                      max={40}
                      onChange={(v) => onUpdateSelectedBlock({ shadowOffsetX: v })}
                      fieldKey="shadowOffsetX"
                    />
                    <RangeRow
                      id={makeId("shadow-offset-y", selectedId)}
                      name={makeId("shadowOffsetY", selectedId)}
                      label="Shadow Y"
                      value={selectedBlock.shadowOffsetY ?? 0}
                      min={-40}
                      max={40}
                      onChange={(v) => onUpdateSelectedBlock({ shadowOffsetY: v })}
                      fieldKey="shadowOffsetY"
                    />
                  </div>

                  <RangeRow
                    id={makeId("shadow-opacity", selectedId)}
                    name={makeId("shadowOpacity", selectedId)}
                    label="Shadow opacity"
                    value={selectedShadowOpacity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(v) => onUpdateSelectedBlock({ shadowOpacity: v })}
                    suffix={`${Math.round(selectedShadowOpacity * 100)}%`}
                    fieldKey="shadowOpacity"
                  />
                </div>

                {selectedBlock.type === "shapeFill" && (
                  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Shape Fill</div>

                    <RangeRow
                      id={makeId("shape-scale", selectedId)}
                      name={makeId("shapeScale", selectedId)}
                      label="Shape scale"
                      value={selectedBlock.shapeScale ?? 1}
                      min={0.2}
                      max={3}
                      step={0.05}
                      onChange={(v) => onUpdateSelectedBlock({ shapeScale: v })}
                      suffix={`${(selectedBlock.shapeScale ?? 1).toFixed(2)}×`}
                      fieldKey="shapeScale"
                    />

                    <RangeRow
                      id={makeId("shape-fill-spacing", selectedId)}
                      name={makeId("shapeFillSpacing", selectedId)}
                      label="Line spacing"
                      value={selectedBlock.shapeFillSpacing ?? 1.3}
                      min={0.8}
                      max={4}
                      step={0.05}
                      onChange={(v) => onUpdateSelectedBlock({ shapeFillSpacing: v })}
                      suffix={`${(selectedBlock.shapeFillSpacing ?? 1.3).toFixed(2)}×`}
                      fieldKey="shapeFillSpacing"
                    />

                    <RangeRow
                      id={makeId("shape-fill-scale-x", selectedId)}
                      name={makeId("shapeFillScaleX", selectedId)}
                      label="Stretch horizontal"
                      value={selectedBlock.shapeFillScaleX ?? 1}
                      min={0.2}
                      max={3}
                      step={0.05}
                      onChange={(v) => onUpdateSelectedBlock({ shapeFillScaleX: v })}
                      suffix={`${(selectedBlock.shapeFillScaleX ?? 1).toFixed(2)}×`}
                      fieldKey="shapeFillScaleX"
                    />

                    <RangeRow
                      id={makeId("shape-fill-scale-y", selectedId)}
                      name={makeId("shapeFillScaleY", selectedId)}
                      label="Stretch vertical"
                      value={selectedBlock.shapeFillScaleY ?? 1}
                      min={0.2}
                      max={3}
                      step={0.05}
                      onChange={(v) => onUpdateSelectedBlock({ shapeFillScaleY: v })}
                      suffix={`${(selectedBlock.shapeFillScaleY ?? 1).toFixed(2)}×`}
                      fieldKey="shapeFillScaleY"
                    />

                    <RangeRow
                      id={makeId("shape-fill-text-rotation", selectedId)}
                      name={makeId("shapeFillTextRotation", selectedId)}
                      label="Glyph rotation"
                      value={selectedBlock.shapeFillTextRotation ?? 0}
                      min={-180}
                      max={180}
                      step={1}
                      onChange={(v) => onUpdateSelectedBlock({ shapeFillTextRotation: v })}
                      suffix={`${selectedBlock.shapeFillTextRotation ?? 0}°`}
                      fieldKey="shapeFillTextRotation"
                    />

                    <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                      Base shape: {selectedBlock.shapeWidth ?? 400} × {selectedBlock.shapeHeight ?? 400}px
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <div className="sidebarPanel">
          <button type="button" onClick={onToggleKeyboard} className="sidebarSectionButton">
            <span>Arabic Keyboard</span>
            <span>{showKeyboard ? "−" : "+"}</span>
          </button>

          {showKeyboard && (
            <div className="keyboardWrap">
              <ArabicKeyboard
                onKey={handleKeyboardKey}
                onSpace={handleKeyboardSpace}
                onBackspace={handleKeyboardBackspace}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowHelpers((v) => !v)}
            className="sidebarSectionButton"
          >
            <span>Arabic Helpers</span>
            <span>{showHelpers ? "−" : "+"}</span>
          </button>

          {showHelpers && (
            <div className="sectionPanel">
              <PresetKeyboard
                title="Diacritics"
                rows={[DIACRITICS.slice(0, 6), DIACRITICS.slice(6)]}
                onPick={handleKeyboardKey}
              />
              <button
                type="button"
                onClick={onClearDiacritics}
                className="sidebarSmallAction"
                style={{ background: "#f9fafb" }}
              >
                Clear diacritics
              </button>
              <PresetKeyboard
                title="Presets"
                rows={[PRESETS.slice(0, 5), PRESETS.slice(5)]}
                onPick={onInsertPreset}
              />
              <PresetKeyboard
                title="Specials"
                rows={[SPECIALS.slice(0, 6), SPECIALS.slice(6)]}
                onPick={onInsertPreset}
              />
              <PresetKeyboard
                title="Persian"
                rows={[PERSIAN.slice(0, 6), PERSIAN.slice(6)]}
                onPick={onInsertPreset}
              />
              <PresetKeyboard
                title="Urdu"
                rows={[URDU.slice(0, 6), URDU.slice(6)]}
                onPick={onInsertPreset}
              />
            </div>
          )}
        </div>

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowFileActions((v) => !v)}
            className="sidebarSectionButton"
          >
            <span>Save / Export</span>
            <span>{showFileActions ? "−" : "+"}</span>
          </button>

          {showFileActions && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>

              {/* Row 1: Browser save / load */}
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button type="button" onClick={onSaveLayout} className="sidebarCircleButton" title="Quick-save to browser">
                  💾
                </button>
                <button type="button" onClick={onLoadLayout} className="sidebarCircleButton" title="Load from browser">
                  📂
                </button>
              </div>

              {/* Row 2: JSON file download / upload */}
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button type="button" onClick={onDownloadLayout} className="sidebarCircleButton sidebarCircleButton--light" title="Download layout as .json">
                  ⬇
                </button>
                <button type="button" onClick={onUploadLayout} className="sidebarCircleButton sidebarCircleButton--light" title="Upload .json layout file">
                  ⬆
                </button>
              </div>

              {/* Row 3: Export image formats — at the bottom */}
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button type="button" onClick={onExportPNG} className="sidebarCircleButton sidebarCircleButton--light" title="Export PNG">
                  PNG
                </button>
                <button type="button" onClick={onExportSVG} className="sidebarCircleButton sidebarCircleButton--light" title="Export SVG">
                  SVG
                </button>
                <button type="button" onClick={onExportPDF} className="sidebarCircleButton sidebarCircleButton--light" title="Export PDF">
                  PDF
                </button>
              </div>

            </div>
          )}
        </div>

        <div className="sidebarPanel">
          <div className="sidebarSectionTitle">Canvas Size</div>
          <div className="shell">
            <select
              id="canvas-preset"
              name="canvasPreset"
              value={canvasPresetId}
              onChange={(e) => onChangeCanvasPreset(e.target.value)}
              className="select"
            >
              <option value="story">Story (1080×1920)</option>
              <option value="square">Instagram Square (1080×1080)</option>
              <option value="a4">Print A4 (2480×3508)</option>
            </select>
          </div>

          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12, marginTop: 10 }}>
            <div className="sidebarSectionTitle">Background Color</div>
            <input
              id="background-color"
              name="backgroundColor"
              type="color"
              value={backgroundColor}
              onChange={(e) => onChangeBackgroundColor(e.target.value)}
              className="sidebarColorInput"
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <label className="checkboxRow" htmlFor="show-grid">
              <input
                id="show-grid"
                name="showGrid"
                type="checkbox"
                checked={showGrid}
                onChange={(e) => onToggleGrid(e.target.checked)}
              />{" "}
              Show gridlines
            </label>
            <label className="checkboxRow" htmlFor="snap-to-grid">
              <input
                id="snap-to-grid"
                name="snapToGrid"
                type="checkbox"
                checked={snapToGrid}
                onChange={(e) => onToggleSnap(e.target.checked)}
              />{" "}
              Snap to gridlines
            </label>
          </div>
        </div>

        <p
          style={{
            fontSize: 11,
            color: "#9ca3af",
            margin: "0 4px 8px",
            textAlign: "center",
          }}
        >
          Double-click a layer name to rename · Double-click a slider to reset
        </p>
      </div>
    </div>
  );
};

export default Sidebar;