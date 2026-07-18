import React, { useEffect, useRef, useState } from "react";
import ArabicKeyboard from "./ArabicKeyboard";
import {
  DIACRITICS,
  SPECIALS,
  PERSIAN,
  URDU,
  PRESETS,
} from "../lib/presets";
import type { Block, TextAlign, ShapeWarpMode } from "../types";
import { extractSvgPaths } from "../lib/svgImport";
import { LayersPanel } from "./sidebar/LayersPanel";
import { makeId } from "./sidebar/utils";
import { SelectRow, ColorRow, RangeRow, PresetKeyboard } from "./sidebar/FormControls";
import {
  TrashIcon,
  CopyIcon,
  PlusIcon,
  ShapesIcon,
  CircleDashedIcon,
  UndoIcon,
  RedoIcon,
  SaveIcon,
  FolderOpenIcon,
  DownloadIcon,
  UploadIcon,
  ImageIcon,
  VectorIcon,
  FileTextIcon,
} from "./Icons";

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
  onAddShapeWarpBlock?: (svgPathData: string, w: number, h: number) => void;

  onToggleGrid: (v: boolean) => void;
  onToggleSnap: (v: boolean) => void;

  onSelectBlock: (id: number | null) => void;
  editRequestSignal?: number;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  onUpdateBlock?: (id: number, patch: Partial<Block>) => void;
  onReorderBlocks?: (blocks: Block[]) => void;
  onMergeBlocks?: (idA: number, idB: number) => void;
  onZoomToBlock?: (id: number) => void;

  showKeyboard: boolean;
  onToggleKeyboard: () => void;
  onClearDiacritics: () => void;
  onInsertPreset: (value: string) => void;

  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  onToggleGlyphEditMode?: () => void;
  onAddGlyphHandle?: () => void;
};

const FONT_OPTIONS: { value: string; label: string; cssFamily: string }[] = [
  { value: "AlFatemi", label: "Al Fatemi", cssFamily: "AlFatemi" },
  { value: "FatemiMaqala", label: "Fatemi Maqala", cssFamily: "FatemiMaqala" },
  { value: "TahaNaskhRegular", label: "Taha Naskh", cssFamily: "TahaNaskhRegular" },
  { value: "Kufi", label: "Kufi", cssFamily: "Kufi" },
  { value: "Kufi2", label: "Kufi 2", cssFamily: "Kufi2" },
  { value: "Thuluth", label: "Thuluth", cssFamily: "Thuluth" },
  { value: "ThuluthDeco", label: "Thuluth Deco", cssFamily: "ThuluthDeco" },
  { value: "Wessam", label: "Wessam", cssFamily: "Wessam" },
  { value: "Yekan", label: "Yekan", cssFamily: "Yekan" },
  { value: "NotoSans", label: "Noto Sans", cssFamily: "'Noto Sans Arabic'" },
  { value: "Lateef", label: "Lateef", cssFamily: "Lateef" },
  { value: "Amiri", label: "Amiri", cssFamily: "Amiri" },
  { value: "Ruqaa", label: "Ruqaa", cssFamily: "Ruqaa" },
  { value: "Qahiri", label: "Qahiri", cssFamily: "Qahiri" },
  { value: "Urdu", label: "Urdu", cssFamily: "Urdu" },
];

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
  onAddShapeWarpBlock,
  onToggleGrid,
  onToggleSnap,
  onSelectBlock,
  editRequestSignal,
  onUpdateSelectedBlock,
  onUpdateBlock,
  onReorderBlocks,
  onMergeBlocks,
  onZoomToBlock,
  showKeyboard,
  onToggleKeyboard,
  onClearDiacritics,
  onInsertPreset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleGlyphEditMode,
  onAddGlyphHandle,
}) => {
  const [showStyling, setShowStyling] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);
  const [showFileActions, setShowFileActions] = useState(false);
  const [showLayers, setShowLayers] = useState(!isMobile);
  const [showCanvasSettings, setShowCanvasSettings] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursorPosition, setCursorPosition] = useState(0);

  useEffect(() => {
    if (!editRequestSignal || !selectedBlock) return;
    const el = textareaRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus();
    el.select();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editRequestSignal]);

  const selectedText = selectedBlock?.text ?? "";
  const selectedOpacity = selectedBlock?.opacity ?? 1;
  const selectedShadowOpacity = selectedBlock?.shadowOpacity ?? 0.35;
  const selectedRotation = selectedBlock?.rotation ?? 0;
  const selectedId = selectedBlock?.id ?? "none";

  const updateText = (text: string) => {
    if (selectedBlock) onUpdateSelectedBlock({ text });
  };

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
    if (!selectedBlock || cursorPosition <= 0) return;
    const newText =
      selectedText.substring(0, cursorPosition - 1) +
      selectedText.substring(cursorPosition);
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

  const handleSvgUpload = (mode: "shapeFill" | "shapeWarp") => {
    const onAdd = mode === "shapeFill" ? onAddShapeFillBlock : onAddShapeWarpBlock;
    if (!onAdd) return;

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
        onAdd(result.pathData, result.w, result.h);
      };
      reader.readAsText(file);
    };

    input.click();
  };

  return (
    <div
      style={{
        width,
        height: isMobile ? "auto" : "100%",
        maxHeight: isMobile ? "45vh" : "none",
        padding: 0,
        boxSizing: "border-box",
        borderRight: isMobile ? "none" : "1px solid var(--border)",
        borderBottom: isMobile ? "1px solid var(--border)" : "none",
        background:
          "linear-gradient(180deg, var(--bg-sidebar-start) 0%, var(--bg-sidebar-end) 100%)",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
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
              color: "var(--text-primary)",
              letterSpacing: "-0.02em",
            }}
          >
            Mohammed&apos;s Calligraphy
          </h2>
        </div>

        <div className="sidebarPanel">
          <div className="sidebarSectionTitle">Block Controls</div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 10,
              flexWrap: "wrap",
            }}
          >
            <button
              type="button"
              onClick={onDeleteBlock}
              disabled={!selectedBlock || blocks.length === 0}
              className="sidebarCircleButton"
              title="Delete selected block"
              aria-label="Delete block"
            >
              <TrashIcon size={14} />
            </button>

            <button
              type="button"
              onClick={onDuplicateBlock}
              disabled={!selectedBlock}
              className="sidebarCircleButton"
              title="Duplicate selected block"
              aria-label="Duplicate block"
            >
              <CopyIcon size={14} />
            </button>

            <button
              type="button"
              onClick={onAddBlock}
              className="sidebarCircleButton"
              title="Add text block"
              aria-label="Add text block"
            >
              <PlusIcon size={14} />
            </button>

            {onAddShapeFillBlock && (
              <button
                type="button"
                className="sidebarCircleButton"
                title="Upload SVG for Shape Fill"
                onClick={() => handleSvgUpload("shapeFill")}
              >
                <ShapesIcon size={14} />
              </button>
            )}

            {onAddShapeWarpBlock && (
              <button
                type="button"
                className="sidebarCircleButton"
                title="Upload SVG for Shape Warp"
                onClick={() => handleSvgUpload("shapeWarp")}
              >
                <CircleDashedIcon size={14} />
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
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <UndoIcon size={14} />
            </button>

            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="sidebarCircleButton"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <RedoIcon size={14} />
            </button>
          </div>
        </div>

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowLayers((v) => !v)}
            className="sidebarSectionButton"
            aria-expanded={showLayers}
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
                onZoomTo={(id) => onZoomToBlock?.(id)}
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
              placeholder="Type Arabic text here..."
              dir="rtl"
              lang="ar"
              spellCheck={false}
              autoCorrect="off"
              autoCapitalize="off"
            />
          </div>
        )}

        {selectedBlock && (
          <div className="sidebarPanel">
            <button
              type="button"
              onClick={() => setShowStyling((v) => !v)}
              className="sidebarSectionButton"
              aria-expanded={showStyling}
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
                    {FONT_OPTIONS.map((f) => (
                      <option
                        key={f.value}
                        value={f.value}
                        style={{ fontFamily: f.cssFamily }}
                      >
                        {f.label} — أبجد
                      </option>
                    ))}
                  </SelectRow>

                  <SelectRow
                    id={makeId("font-style", selectedId)}
                    name={makeId("fontStyle", selectedId)}
                    label="Font style"
                    value={selectedBlock.fontStyle ?? "normal"}
                    onChange={(v) =>
                      onUpdateSelectedBlock({
                        fontStyle: v as Block["fontStyle"],
                      })
                    }
                  >
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                    <option value="italic">Italic</option>
                    <option value="bold italic">Bold Italic</option>
                  </SelectRow>
                </div>

                <RangeRow
                  id={makeId("font-size", selectedId)}
                  name={makeId("fontSize", selectedId)}
                  label="Font size"
                  value={selectedBlock.fontSize}
                  min={
                    selectedBlock.type === "shapeFill" ||
                    selectedBlock.type === "shapeWarp"
                      ? 4
                      : 12
                  }
                  max={
                    selectedBlock.type === "shapeFill" ||
                    selectedBlock.type === "shapeWarp"
                      ? 400
                      : 200
                  }
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

                {selectedBlock.type === "text" && (
                  <SelectRow
                    id={makeId("text-align", selectedId)}
                    name={makeId("textAlign", selectedId)}
                    label="Alignment"
                    value={selectedBlock.align ?? "center"}
                    onChange={(v) =>
                      onUpdateSelectedBlock({ align: v as TextAlign })
                    }
                  >
                    <option value="left">Left</option>
                    <option value="center">Center</option>
                    <option value="right">Right</option>
                  </SelectRow>
                )}

                <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
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
                    suffix={selectedRotation}
                    fieldKey="rotation"
                  />
                </div>

                {selectedBlock.type === "text" && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Warp</div>

                    <RangeRow
                      id={makeId("warp-x", selectedId)}
                      name={makeId("warpX", selectedId)}
                      label="Horizontal warp"
                      value={selectedBlock.warpX ?? 0}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(v) => onUpdateSelectedBlock({ warpX: v })}
                      suffix={selectedBlock.warpX ?? 0}
                      fieldKey="warpX"
                    />

                    <RangeRow
                      id={makeId("warp-y", selectedId)}
                      name={makeId("warpY", selectedId)}
                      label="Vertical warp"
                      value={selectedBlock.warpY ?? 0}
                      min={-100}
                      max={100}
                      step={1}
                      onChange={(v) => onUpdateSelectedBlock({ warpY: v })}
                      suffix={selectedBlock.warpY ?? 0}
                      fieldKey="warpY"
                    />
                  </div>
                )}

                <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
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
                      max={20}
                      onChange={(v) => onUpdateSelectedBlock({ strokeWidth: v })}
                      suffix={selectedBlock.strokeWidth ?? 0}
                      fieldKey="strokeWidth"
                    />
                  </div>
                </div>

                <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
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
                      max={60}
                      onChange={(v) => onUpdateSelectedBlock({ shadowBlur: v })}
                      suffix={selectedBlock.shadowBlur ?? 0}
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
                      min={-60}
                      max={60}
                      onChange={(v) => onUpdateSelectedBlock({ shadowOffsetX: v })}
                      suffix={selectedBlock.shadowOffsetX ?? 0}
                      fieldKey="shadowOffsetX"
                    />

                    <RangeRow
                      id={makeId("shadow-offset-y", selectedId)}
                      name={makeId("shadowOffsetY", selectedId)}
                      label="Shadow Y"
                      value={selectedBlock.shadowOffsetY ?? 0}
                      min={-60}
                      max={60}
                      onChange={(v) => onUpdateSelectedBlock({ shadowOffsetY: v })}
                      suffix={selectedBlock.shadowOffsetY ?? 0}
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

                {selectedBlock.type === "shapeWarp" && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Shape Warp</div>

                    <label className="checkboxRow">
                      <input
                        type="checkbox"
                        checked={!!selectedBlock.glyphEditMode}
                        onChange={() => onToggleGlyphEditMode?.()}
                      />
                      Glyph edit mode
                    </label>

                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>
                      Selected glyph:{" "}
                      {selectedBlock.selectedGlyphIndex != null
                        ? selectedBlock.selectedGlyphIndex
                        : "none"}
                    </div>

                    <button
                      type="button"
                      disabled={
                        !selectedBlock.glyphEditMode ||
                        selectedBlock.selectedGlyphIndex == null
                      }
                      onClick={() => onAddGlyphHandle?.()}
                      className="sidebarSmallAction"
                      style={{ marginTop: 8 }}
                    >
                      Add pinch handle
                    </button>

                    <SelectRow
                      id={makeId("warp-shape-mode", selectedId)}
                      name={makeId("warpShapeMode", selectedId)}
                      label="Warp mode"
                      value={selectedBlock.warpShapeMode ?? "envelope"}
                      onChange={(v) =>
                        onUpdateSelectedBlock({
                          warpShapeMode: v as ShapeWarpMode,
                        })
                      }
                    >
                      <option value="envelope">Envelope</option>
                      <option value="topBottom">Top Bottom</option>
                      <option value="stretch">Stretch</option>
                      <option value="radial">Radial</option>
                    </SelectRow>

                    <RangeRow
                      id={makeId("warp-shape-padding", selectedId)}
                      name={makeId("warpShapePadding", selectedId)}
                      label="Inner padding"
                      value={selectedBlock.warpShapePadding ?? 24}
                      min={0}
                      max={150}
                      step={1}
                      onChange={(v) =>
                        onUpdateSelectedBlock({ warpShapePadding: v })
                      }
                      suffix={`${selectedBlock.warpShapePadding ?? 24}px`}
                      fieldKey="warpShapePadding"
                    />

                    <RangeRow
                      id={makeId("warp-shape-strength", selectedId)}
                      name={makeId("warpShapeStrength", selectedId)}
                      label="Warp strength"
                      value={selectedBlock.warpShapeStrength ?? 1}
                      min={0}
                      max={2}
                      step={0.05}
                      onChange={(v) =>
                        onUpdateSelectedBlock({ warpShapeStrength: v })
                      }
                      suffix={(selectedBlock.warpShapeStrength ?? 1).toFixed(2)}
                      fieldKey="warpShapeStrength"
                    />

                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      Base shape: {selectedBlock.warpShapeWidth ?? 400} ×{" "}
                      {selectedBlock.warpShapeHeight ?? 400}px
                    </div>
                  </div>
                )}

                {selectedBlock.type === "shapeFill" && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
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
                      suffix={(selectedBlock.shapeScale ?? 1).toFixed(2)}
                      fieldKey="shapeScale"
                    />

                    <RangeRow
                      id={makeId("fill-spacing", selectedId)}
                      name={makeId("shapeFillSpacing", selectedId)}
                      label="Text spacing"
                      value={selectedBlock.shapeFillSpacing ?? 1.3}
                      min={0.5}
                      max={4}
                      step={0.05}
                      onChange={(v) =>
                        onUpdateSelectedBlock({ shapeFillSpacing: v })
                      }
                      suffix={(selectedBlock.shapeFillSpacing ?? 1.3).toFixed(2)}
                      fieldKey="shapeFillSpacing"
                    />

                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <RangeRow
                        id={makeId("fill-scale-x", selectedId)}
                        name={makeId("shapeFillScaleX", selectedId)}
                        label="Scale X"
                        value={selectedBlock.shapeFillScaleX ?? 1}
                        min={0.1}
                        max={3}
                        step={0.05}
                        onChange={(v) =>
                          onUpdateSelectedBlock({ shapeFillScaleX: v })
                        }
                        suffix={(selectedBlock.shapeFillScaleX ?? 1).toFixed(2)}
                        fieldKey="shapeFillScaleX"
                      />

                      <RangeRow
                        id={makeId("fill-scale-y", selectedId)}
                        name={makeId("shapeFillScaleY", selectedId)}
                        label="Scale Y"
                        value={selectedBlock.shapeFillScaleY ?? 1}
                        min={0.1}
                        max={3}
                        step={0.05}
                        onChange={(v) =>
                          onUpdateSelectedBlock({ shapeFillScaleY: v })
                        }
                        suffix={(selectedBlock.shapeFillScaleY ?? 1).toFixed(2)}
                        fieldKey="shapeFillScaleY"
                      />
                    </div>

                    <RangeRow
                      id={makeId("fill-text-rotation", selectedId)}
                      name={makeId("shapeFillTextRotation", selectedId)}
                      label="Text rotation"
                      value={selectedBlock.shapeFillTextRotation ?? 0}
                      min={-180}
                      max={180}
                      step={1}
                      onChange={(v) =>
                        onUpdateSelectedBlock({ shapeFillTextRotation: v })
                      }
                      suffix={selectedBlock.shapeFillTextRotation ?? 0}
                      fieldKey="shapeFillTextRotation"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {selectedBlock && (
          <div className="sidebarPanel">
            <button
              type="button"
              onClick={() => setShowHelpers((v) => !v)}
              className="sidebarSectionButton"
              aria-expanded={showHelpers}
            >
              <span>Arabic Helpers</span>
              <span>{showHelpers ? "−" : "+"}</span>
            </button>

            {showHelpers && (
              <div className="sectionPanel">
                <button
                  type="button"
                  onClick={onToggleKeyboard}
                  className="sidebarSmallAction"
                  style={{ marginBottom: 8 }}
                >
                  {showKeyboard ? "Hide keyboard" : "Show virtual keyboard"}
                </button>

                {showKeyboard && (
                  <ArabicKeyboard
                    onKey={handleKeyboardKey}
                    onSpace={handleKeyboardSpace}
                    onBackspace={handleKeyboardBackspace}
                  />
                )}

                <PresetKeyboard
                  title="Diacritics"
                  rows={[DIACRITICS.slice(0, 6), DIACRITICS.slice(6)]}
                  onPick={handleKeyboardKey}
                />

                <button
                  type="button"
                  onClick={onClearDiacritics}
                  className="sidebarSmallAction"
                  style={{ background: "var(--bg-input)" }}
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
        )}

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowFileActions((v) => !v)}
            className="sidebarSectionButton"
            aria-expanded={showFileActions}
          >
            <span>Save Export</span>
            <span>{showFileActions ? "−" : "+"}</span>
          </button>

          {showFileActions && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={onSaveLayout}
                  className="sidebarCircleButton"
                  title="Quick-save to browser memory"
                  aria-label="Save layout"
                >
                  <SaveIcon size={14} />
                </button>

                <button
                  type="button"
                  onClick={onLoadLayout}
                  className="sidebarCircleButton"
                  title="Load from browser memory"
                  aria-label="Load layout"
                >
                  <FolderOpenIcon size={14} />
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={onDownloadLayout}
                  className="sidebarPillButton"
                  title="Download layout as .json"
                  aria-label="Download layout JSON"
                >
                  <DownloadIcon size={13} /> JSON
                </button>

                <button
                  type="button"
                  onClick={onUploadLayout}
                  className="sidebarPillButton"
                  title="Upload .json layout file"
                  aria-label="Upload layout JSON"
                >
                  <UploadIcon size={13} /> JSON
                </button>
              </div>

              <div style={{ display: "flex", justifyContent: "center", gap: 8 }}>
                <button
                  type="button"
                  onClick={onExportPNG}
                  className="sidebarPillButton"
                  title="Export PNG"
                  aria-label="Export PNG"
                >
                  <ImageIcon size={13} /> PNG
                </button>

                <button
                  type="button"
                  onClick={onExportSVG}
                  className="sidebarPillButton"
                  title="Export SVG"
                  aria-label="Export SVG"
                >
                  <VectorIcon size={13} /> SVG
                </button>

                <button
                  type="button"
                  onClick={onExportPDF}
                  className="sidebarPillButton"
                  title="Export PDF"
                  aria-label="Export PDF"
                >
                  <FileTextIcon size={13} /> PDF
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowCanvasSettings((v) => !v)}
            className="sidebarSectionButton"
            aria-expanded={showCanvasSettings}
          >
            <span>Canvas Size</span>
            <span>{showCanvasSettings ? "−" : "+"}</span>
          </button>

          {showCanvasSettings && (
            <div className="sectionPanel">
              <div className="shell">
                <select
                  id="canvas-preset"
                  name="canvasPreset"
                  value={canvasPresetId}
                  onChange={(e) => onChangeCanvasPreset(e.target.value)}
                  className="select"
                  aria-label="Canvas size preset"
                >
                  <option value="story">Story (1080×1920)</option>
                  <option value="square">Instagram Square (1080×1080)</option>
                  <option value="a4">Print A4 (2480×3508)</option>
                </select>
              </div>

              <ColorRow
                id="background-color"
                name="backgroundColor"
                label="Background Color"
                value={backgroundColor}
                onChange={onChangeBackgroundColor}
              />

              <div style={{ display: "grid", gap: 8 }}>
                <label className="checkboxRow" htmlFor="show-grid">
                  <input
                    id="show-grid"
                    name="showGrid"
                    type="checkbox"
                    checked={showGrid}
                    onChange={(e) => onToggleGrid(e.target.checked)}
                  />
                  Show gridlines
                </label>

                <label className="checkboxRow" htmlFor="snap-to-grid">
                  <input
                    id="snap-to-grid"
                    name="snapToGrid"
                    type="checkbox"
                    checked={snapToGrid}
                    onChange={(e) => onToggleSnap(e.target.checked)}
                  />
                  Snap to gridlines
                </label>
              </div>
            </div>
          )}
        </div>

        <p
          style={{
            fontSize: 11,
            color: "var(--text-faint)",
            margin: "0 4px 8px",
            textAlign: "center",
          }}
        >
          Double-click a block on the canvas to jump to its text field. Double-click a
          layer name to rename. Double-click a slider to reset. Use the arrow keys to
          nudge the selected block (hold Shift for bigger steps).
        </p>
      </div>
    </div>
  );
};

export default Sidebar;