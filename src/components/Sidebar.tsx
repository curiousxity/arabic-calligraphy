import React, { useEffect, useRef, useState } from "react";
import {
  DIACRITICS,
  SPECIALS,
  PERSIAN,
  URDU,
  PRESETS,
} from "../lib/presets";
import type { Block, TextAlign, ShapeWarpMode, GlyphHandle, GlyphHandleMode } from "../types";
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
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "./Icons";

export type SidebarProps = {
  blocks: Block[];
  selectedBlock?: Block;
  showGrid: boolean;
  snapToGrid: boolean;
  isMobile: boolean;
  width: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;

  canvasPresetId: string;
  onChangeCanvasPreset: (id: string) => void;
  customCanvasSize: { width: number; height: number };
  onChangeCustomSize: (width: number, height: number) => void;

  backgroundColor: string;
  onChangeBackgroundColor: (color: string) => void;

  onAddBlock: () => void;
  onDuplicateBlock: () => void;
  onDeleteBlock: () => void;

  onExportPNG: () => void;
  onExportJPEG: () => void;
  onExportSVG: () => void;
  onExportPDF: () => void;
  transparentExport: boolean;
  onToggleTransparentExport: (value: boolean) => void;

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
  onUngroupBlock?: (id: number) => void;
  onZoomToBlock?: (id: number) => void;

  onClearDiacritics: () => void;
  onInsertPreset: (value: string) => void;

  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;

  onToggleGlyphEditMode?: () => void;
  onAddGlyphHandle?: () => void;
  onDeleteGlyphHandle?: (blockId: number, glyphIndex: number, handleId: string) => void;
  onUpdateGlyphHandle?: (
    blockId: number,
    glyphIndex: number,
    handleId: string,
    patch: Partial<GlyphHandle>
  ) => void;
  onResetShapeWarp?: (blockId: number) => void;
  onFitShapeFillSpacing?: (blockId: number) => void;
};

const HANDLE_MODE_COLORS: Record<GlyphHandleMode, string> = {
  pinch: "#ff4d4f",
  move: "#4d94ff",
  scaleX: "#22c55e",
  scaleY: "#eab308",
};

const FONT_OPTIONS: { value: string; label: string; cssFamily: string }[] = [
  { value: "FatemiMaqala", label: "Fatemi Maqala", cssFamily: "FatemiMaqala" },
  { value: "AlFatemi", label: "Al Fatemi", cssFamily: "AlFatemi" },
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
  isCollapsed = false,
  onToggleCollapse,
  canvasPresetId,
  onChangeCanvasPreset,
  customCanvasSize,
  onChangeCustomSize,
  backgroundColor,
  onChangeBackgroundColor,
  onAddBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onExportPNG,
  onExportJPEG,
  onExportSVG,
  onExportPDF,
  transparentExport,
  onToggleTransparentExport,
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
  onUngroupBlock,
  onZoomToBlock,
  onClearDiacritics,
  onInsertPreset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onToggleGlyphEditMode,
  onAddGlyphHandle,
  onDeleteGlyphHandle,
  onUpdateGlyphHandle,
  onResetShapeWarp,
  onFitShapeFillSpacing,
}) => {
  const [showStyling, setShowStyling] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);
  const [showFileActions, setShowFileActions] = useState(false);
  const [showLayers, setShowLayers] = useState(!isMobile);
  const [showCanvasSettings, setShowCanvasSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showStroke, setShowStroke] = useState(false);
  const [showShadow, setShowShadow] = useState(false);

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

  if (!isMobile && isCollapsed) {
    return (
      <div
        style={{
          width,
          height: "100%",
          flexShrink: 0,
          borderRight: "1px solid var(--border)",
          background:
            "linear-gradient(180deg, var(--bg-sidebar-start) 0%, var(--bg-sidebar-end) 100%)",
          display: "flex",
          justifyContent: "center",
          paddingTop: 12,
        }}
      >
        <button
          type="button"
          onClick={onToggleCollapse}
          className="sidebarCircleButton"
          title="Show sidebar"
          aria-label="Show sidebar"
        >
          <ChevronRightIcon size={14} />
        </button>
      </div>
    );
  }

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
        <div className="sidebarPanel" style={{ position: "relative" }}>
          {!isMobile && onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              className="layerIconBtn"
              style={{ position: "absolute", top: 8, insetInlineEnd: 8 }}
              title="Hide sidebar"
              aria-label="Hide sidebar"
            >
              <ChevronLeftIcon size={14} />
            </button>
          )}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: isMobile ? "4px 0 2px" : "8px 0 4px",
            }}
          >
            <img
              src="/logo-icon.png"
              alt="HarfCanvas"
              style={{
                width: isMobile ? 76 : 104,
                height: isMobile ? 76 : 104,
                borderRadius: 18,
                flexShrink: 0,
                boxShadow: "0 0 0 1px var(--border), 0 6px 24px rgba(212, 175, 55, 0.3)",
              }}
            />
            <h2
              className="sidebarTitle"
              style={{
                fontSize: isMobile ? 22 : 26,
                textAlign: "center",
                color: "var(--text-primary)",
                letterSpacing: "0.01em",
                fontWeight: 600,
                margin: 0,
              }}
            >
              HarfCanvas
            </h2>
          </div>
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
                onUngroup={(id) => onUngroupBlock?.(id)}
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

                {selectedBlock.type === "text" && (
                  <RangeRow
                    id={makeId("line-height", selectedId)}
                    name={makeId("lineHeight", selectedId)}
                    label="Line height"
                    value={selectedBlock.lineHeight ?? 1.2}
                    min={0.8}
                    max={3}
                    step={0.05}
                    onChange={(v) => onUpdateSelectedBlock({ lineHeight: v })}
                    suffix={(selectedBlock.lineHeight ?? 1.2).toFixed(2)}
                    fieldKey="lineHeight"
                  />
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
                  <button
                    type="button"
                    onClick={() => setShowStroke((v) => !v)}
                    className="sidebarSectionButton"
                    aria-expanded={showStroke}
                  >
                    <span>Outline</span>
                    <span>{showStroke ? "−" : "+"}</span>
                  </button>

                  {showStroke && (
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                        gap: 10,
                        marginTop: 10,
                      }}
                    >
                      <ColorRow
                        id={makeId("stroke-color", selectedId)}
                        name={makeId("strokeColor", selectedId)}
                        label="Outline color"
                        value={selectedBlock.stroke ?? "#000000"}
                        onChange={(v) => onUpdateSelectedBlock({ stroke: v })}
                      />

                      <RangeRow
                        id={makeId("stroke-width", selectedId)}
                        name={makeId("strokeWidth", selectedId)}
                        label="Outline width"
                        value={selectedBlock.strokeWidth ?? 0}
                        min={0}
                        max={20}
                        onChange={(v) => onUpdateSelectedBlock({ strokeWidth: v })}
                        suffix={selectedBlock.strokeWidth ?? 0}
                        fieldKey="strokeWidth"
                      />
                    </div>
                  )}
                </div>

                <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                  <button
                    type="button"
                    onClick={() => setShowShadow((v) => !v)}
                    className="sidebarSectionButton"
                    aria-expanded={showShadow}
                  >
                    <span>Shadow</span>
                    <span>{showShadow ? "−" : "+"}</span>
                  </button>

                  {showShadow && (
                    <div style={{ marginTop: 10 }}>
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
                  )}
                </div>

                {selectedBlock.type === "shapeWarp" && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
                        Shape Warp
                      </div>
                      <button
                        type="button"
                        onClick={() => onResetShapeWarp?.(selectedBlock.id)}
                        className="layerIconBtn"
                        title="Reset shape warp to defaults"
                      >
                        Reset
                      </button>
                    </div>

                    <label className="checkboxRow" style={{ marginTop: 10 }}>
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
                      Add handle
                    </button>

                    {selectedBlock.selectedGlyphIndex != null &&
                      (() => {
                        const glyphIndex = selectedBlock.selectedGlyphIndex;
                        const handles =
                          selectedBlock.glyphWarps?.find((w) => w.glyphIndex === glyphIndex)
                            ?.handles ?? [];
                        if (handles.length === 0) return null;

                        return (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 6,
                              marginTop: 8,
                            }}
                          >
                            {handles.map((h) => (
                              <div
                                key={h.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 6,
                                  background: "var(--row-bg)",
                                  borderRadius: 8,
                                  padding: "4px 6px",
                                }}
                              >
                                <span
                                  style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 999,
                                    flexShrink: 0,
                                    background: HANDLE_MODE_COLORS[h.mode],
                                  }}
                                />
                                <select
                                  value={h.mode}
                                  onChange={(e) =>
                                    onUpdateGlyphHandle?.(selectedBlock.id, glyphIndex, h.id, {
                                      mode: e.target.value as GlyphHandleMode,
                                    })
                                  }
                                  className="select"
                                  style={{ flex: 1, fontSize: 12 }}
                                >
                                  <option value="pinch">Pinch</option>
                                  <option value="move">Move</option>
                                  <option value="scaleX">Scale X</option>
                                  <option value="scaleY">Scale Y</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() =>
                                    onDeleteGlyphHandle?.(selectedBlock.id, glyphIndex, h.id)
                                  }
                                  className="layerIconBtn"
                                  title="Delete handle"
                                  aria-label="Delete handle"
                                  style={{ color: "var(--danger)" }}
                                >
                                  <CloseIcon size={12} />
                                </button>
                              </div>
                            ))}
                          </div>
                        );
                      })()}

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
                    <div className="sidebarSectionTitle" style={{ marginBottom: 4 }}>
                      Shape Fill
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                      Tip: drag the gold handle on the shape's corner (canvas) to resize.
                    </div>

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

                    <button
                      type="button"
                      onClick={() => onFitShapeFillSpacing?.(selectedBlock.id)}
                      className="sidebarSmallAction"
                      style={{ marginTop: 4 }}
                      title="Adjust row spacing so rows evenly fill the shape's height"
                    >
                      Fit exactly
                    </button>

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
                  rows={[PRESETS]}
                  onPick={onInsertPreset}
                  fontFamily={selectedBlock?.fontFamily ?? "FatemiMaqala"}
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
            <span>Project &amp; Export</span>
            <span>{showFileActions ? "−" : "+"}</span>
          </button>

          {showFileActions && (
            <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
                Your project
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -4 }}>
                Keeps every layer editable. Quick save/load uses this browser only —
                download a file to keep a backup or move it to another device.
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <button
                  type="button"
                  onClick={onSaveLayout}
                  className="sidebarPillButton"
                  title="Quick-save to this browser (overwrites the last quick save)"
                  aria-label="Quick save"
                >
                  <SaveIcon size={13} /> Quick save
                </button>

                <button
                  type="button"
                  onClick={onLoadLayout}
                  className="sidebarPillButton"
                  title="Load the last quick save from this browser"
                  aria-label="Quick load"
                >
                  <FolderOpenIcon size={13} /> Quick load
                </button>

                <button
                  type="button"
                  onClick={onDownloadLayout}
                  className="sidebarPillButton"
                  title="Download your project as a file you can reopen later"
                  aria-label="Download project file"
                >
                  <DownloadIcon size={13} /> Download file
                </button>

                <button
                  type="button"
                  onClick={onUploadLayout}
                  className="sidebarPillButton"
                  title="Open a previously downloaded project file"
                  aria-label="Open project file"
                >
                  <UploadIcon size={13} /> Open file
                </button>
              </div>

              <div
                style={{
                  borderTop: "1px solid var(--border-soft)",
                  paddingTop: 10,
                  marginTop: 4,
                }}
              >
                <div className="sidebarSectionTitle" style={{ marginBottom: 0 }}>
                  Export image
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, marginBottom: 8 }}>
                  Saves a flattened picture or document for sharing — layers can't be
                  edited afterward.
                </div>

                <label className="checkboxRow" htmlFor="transparent-export">
                  <input
                    id="transparent-export"
                    name="transparentExport"
                    type="checkbox"
                    checked={transparentExport}
                    onChange={(e) => onToggleTransparentExport(e.target.checked)}
                  />
                  Transparent background (PNG/SVG)
                </label>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
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
                  onClick={onExportJPEG}
                  className="sidebarPillButton"
                  title="Export JPEG"
                  aria-label="Export JPEG"
                >
                  <ImageIcon size={13} /> JPEG
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
                  <option value="custom">Custom</option>
                </select>
              </div>

              {canvasPresetId === "custom" && (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                    gap: 10,
                  }}
                >
                  <label className="field" htmlFor="custom-canvas-width">
                    <span className="fieldTitle">Width (px)</span>
                    <div className="shell">
                      <input
                        id="custom-canvas-width"
                        name="customCanvasWidth"
                        type="number"
                        min={50}
                        max={8000}
                        value={customCanvasSize.width}
                        onChange={(e) =>
                          onChangeCustomSize(
                            Number(e.target.value) || customCanvasSize.width,
                            customCanvasSize.height
                          )
                        }
                        className="select"
                        style={{ cursor: "text" }}
                      />
                    </div>
                  </label>

                  <label className="field" htmlFor="custom-canvas-height">
                    <span className="fieldTitle">Height (px)</span>
                    <div className="shell">
                      <input
                        id="custom-canvas-height"
                        name="customCanvasHeight"
                        type="number"
                        min={50}
                        max={8000}
                        value={customCanvasSize.height}
                        onChange={(e) =>
                          onChangeCustomSize(
                            customCanvasSize.width,
                            Number(e.target.value) || customCanvasSize.height
                          )
                        }
                        className="select"
                        style={{ cursor: "text" }}
                      />
                    </div>
                  </label>
                </div>
              )}

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

        <div className="sidebarPanel">
          <button
            type="button"
            onClick={() => setShowShortcuts((v) => !v)}
            className="sidebarSectionButton"
            aria-expanded={showShortcuts}
          >
            <span>Shortcuts</span>
            <span>{showShortcuts ? "−" : "+"}</span>
          </button>

          {showShortcuts && (
            <div
              className="sectionPanel"
              style={{ fontSize: 12, color: "var(--text-secondary)" }}
            >
              {[
                ["Double-click a block", "Jump to its text field"],
                ["Double-click a layer name", "Rename it"],
                ["Double-click a layer row", "Zoom to that block"],
                ["Double-click a slider", "Reset it to default"],
                ["Arrow keys", "Nudge selected block (Shift = bigger steps)"],
                ["Delete / Backspace", "Delete selected block"],
                ["Ctrl+Z / Ctrl+Y", "Undo / redo"],
                ["Ctrl+C / Ctrl+V", "Copy / paste selected block"],
                ["Hold Space, or middle-click drag", "Pan the canvas"],
              ].map(([key, desc]) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    padding: "3px 0",
                  }}
                >
                  <span style={{ color: "var(--text-primary)" }}>{key}</span>
                  <span style={{ color: "var(--text-muted)", textAlign: "right" }}>
                    {desc}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Sidebar;