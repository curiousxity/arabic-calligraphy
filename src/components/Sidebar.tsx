import React, { useEffect, useRef, useState } from "react";
import {
  DIACRITICS,
  SPECIALS,
  PERSIAN,
  URDU,
  PRESETS,
} from "../lib/presets";
import type { Block, TextAlign, ShapeWarpMode } from "../types";
import type { NamedProjectMeta } from "../App";
import { extractSvgPaths } from "../lib/svgImport";
import { arcPathD, wavePathD, circlePathD } from "../lib/textPath";
import { parseSvgPath, type SvgCmd } from "../lib/svgPath";
import { STARTER_TEMPLATES } from "../lib/templates";
import type { StarterTemplate } from "../lib/templates";
import { TemplateWizardDialog } from "./TemplateWizardDialog";
import { LayersPanel } from "./sidebar/LayersPanel";
import { HistoryPopover, type HistoryTimelineEntry } from "./sidebar/HistoryPopover";
import { makeId } from "./sidebar/utils";
import {
  SelectRow,
  ColorRow,
  RangeRow,
  PresetKeyboard,
  FontSelectRow,
  CollapsibleSection,
  CheckboxRow,
} from "./sidebar/FormControls";
import { FloatingArabicKeyboard } from "./sidebar/FloatingKeyboard";
import { ImageTraceDialog } from "./ImageTraceDialog";
import {
  TrashIcon,
  CopyIcon,
  PlusIcon,
  ShapesIcon,
  PathTextIcon,
  CircleDashedIcon,
  UndoIcon,
  RedoIcon,
  SaveIcon,
  FolderOpenIcon,
  DownloadIcon,
  UploadIcon,
  ImageIcon,
  TraceWandIcon,
  VectorIcon,
  FileTextIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  AlignLeftIcon,
  AlignCenterHIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignMiddleIcon,
  AlignBottomIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
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
  namedProjects?: NamedProjectMeta[];
  onSaveNamedProject?: (name: string) => void;
  onLoadNamedProject?: (name: string, source: "local" | "cloud") => void;
  onDeleteNamedProject?: (name: string, source: "local" | "cloud") => void;

  cloudConfigured?: boolean;
  session?: import("@supabase/supabase-js").Session | null;
  onSignIn?: (email: string) => Promise<{ error: string | null }>;
  onSignOut?: () => void;
  saveDestination?: "local" | "cloud";
  onChangeSaveDestination?: (dest: "local" | "cloud") => void;

  onAddShapeFillBlock?: (svgPathData: string, w: number, h: number) => void;
  onAddShapeWarpBlock?: (svgPathData: string, w: number, h: number) => void;
  onAddTextPathBlock?: () => void;
  onAddImageBlock?: () => void;
  onGenerateFromTemplate?: (templateId: string, values: string[]) => void;
  onRandomizeLayout?: () => void;

  onToggleGrid: (v: boolean) => void;
  onToggleSnap: (v: boolean) => void;
  showRulers?: boolean;
  onToggleRulers?: (v: boolean) => void;
  guideCount?: number;
  onClearGuides?: () => void;

  onSelectBlock: (id: number | null, additive?: boolean) => void;
  selectedIds?: number[];
  editRequestSignal?: number;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  onUpdateBlock?: (id: number, patch: Partial<Block>) => void;
  onReorderBlocks?: (blocks: Block[]) => void;
  onMergeBlocks?: (idA: number, idB: number) => void;
  onUngroupBlock?: (id: number) => void;
  onZoomToBlock?: (id: number) => void;

  onClearDiacritics: () => void;

  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  historyEntries: HistoryTimelineEntry[];
  onJumpToHistory: (steps: number) => void;
  onCaptureCurrentThumbnail: () => string;

  onToggleKashidaEditMode?: () => void;
  onToggleDiacriticEditMode?: () => void;
  showMorphEditorMobile?: boolean;
  onToggleMorphEditorMobile?: () => void;
  onResetShapeWarp?: (blockId: number) => void;
  onFitShapeFillSpacing?: (blockId: number) => void;
  onAlignSelected?: (edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => void;
  onDistributeSelected?: (axis: "x" | "y") => void;
  onGroupSelected?: () => void;

  // Parallel-stream prop declarations — see docs/superpowers/specs/PARALLEL.md.
  // Every stream's props are optional, so this component still typechecks in a
  // worktree where the other three streams' props do not exist yet.
  // ---- STREAM-A: smart guides ----
  snapToBlockEdges?: boolean;
  onToggleSnapToBlockEdges?: (checked: boolean) => void;
  // ---- /STREAM-A ----
  // ---- STREAM-B: kashida auto-justify ----
  // ---- /STREAM-B ----
  // ---- STREAM-C: export presets ----
  // ---- /STREAM-C ----
  // ---- STREAM-D: user guide ----
  // ---- /STREAM-D ----
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
  { value: "Scheherazade", label: "Scheherazade", cssFamily: "Scheherazade" },
  { value: "Urdu", label: "Urdu", cssFamily: "Urdu" },
];

/** Serializes parsed SVG path commands back into a `d` string (module-local, one-off — mirrors ShapedText.tsx's commandsToSvgPath). */
function cmdsToD(cmds: SvgCmd[]): string {
  const parts: string[] = [];
  for (const c of cmds) {
    switch (c.type) {
      case "M": parts.push(`M ${c.x} ${c.y}`); break;
      case "L": parts.push(`L ${c.x} ${c.y}`); break;
      case "C": parts.push(`C ${c.x1} ${c.y1}, ${c.x2} ${c.y2}, ${c.x} ${c.y}`); break;
      case "Q": parts.push(`Q ${c.x1} ${c.y1}, ${c.x} ${c.y}`); break;
      case "Z": parts.push("Z"); break;
    }
  }
  return parts.join(" ");
}

/**
 * Keeps only the first subpath of an SVG path `d` string (everything up to,
 * but not including, the second `M` command). `extractSvgPaths` legitimately
 * concatenates every shape in an uploaded SVG into one `d` string for
 * shapeFill/shapeWarp's union-silhouette use case, but a text-path curve
 * needs a single open path — the phantom jump between subpaths would
 * otherwise inflate arc length and route glyphs through empty space.
 */
function firstSubpath(d: string): { d: string; hadMultiple: boolean } {
  const cmds = parseSvgPath(d);
  const secondMoveIndex = cmds.findIndex((c, i) => i > 0 && c.type === "M");
  if (secondMoveIndex === -1) return { d, hadMultiple: false };
  return { d: cmdsToD(cmds.slice(0, secondMoveIndex)), hadMultiple: true };
}

/**
 * A quiet rule between the sidebar's three tiers — what you set once per
 * project, what acts on the canvas, and what belongs to the selected block.
 * Deliberately lighter than a panel title: it groups the panels below it
 * without competing with their own headings.
 */
const SidebarTier: React.FC<{ label: string }> = ({ label }) => (
  <div
    aria-hidden="true"
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      margin: "4px 2px 2px",
      color: "var(--text-muted)",
      fontSize: 10,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
    }}
  >
    <span style={{ flex: 1, height: 1, background: "var(--border-soft)", minWidth: 0 }} />
    {label}
    <span style={{ flex: 1, height: 1, background: "var(--border-soft)", minWidth: 0 }} />
  </div>
);

export const Sidebar: React.FC<SidebarProps> = ({
  blocks,
  selectedBlock,
  selectedIds = [],
  showGrid,
  snapToGrid,
  isMobile,
  width,
  isCollapsed = false,
  onToggleCollapse,
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
  namedProjects = [],
  onSaveNamedProject,
  onLoadNamedProject,
  onDeleteNamedProject,
  cloudConfigured = false,
  session = null,
  onSignIn,
  onSignOut,
  saveDestination = "local",
  onChangeSaveDestination,
  onAddShapeFillBlock,
  onAddShapeWarpBlock,
  onAddTextPathBlock,
  onAddImageBlock,
  onGenerateFromTemplate,
  onRandomizeLayout,
  onToggleGrid,
  onToggleSnap,
  showRulers = false,
  onToggleRulers,
  guideCount = 0,
  onClearGuides,
  onSelectBlock,
  editRequestSignal,
  onUpdateSelectedBlock,
  onUpdateBlock,
  onReorderBlocks,
  onMergeBlocks,
  onUngroupBlock,
  onZoomToBlock,
  onClearDiacritics,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  historyEntries,
  onJumpToHistory,
  onCaptureCurrentThumbnail,
  onToggleKashidaEditMode,
  onToggleDiacriticEditMode,
  showMorphEditorMobile,
  onToggleMorphEditorMobile,
  onResetShapeWarp,
  onFitShapeFillSpacing,
  onAlignSelected,
  onDistributeSelected,
  onGroupSelected,
  // Parallel-stream destructuring — match your declarations above.
  // ---- STREAM-A: smart guides ----
  snapToBlockEdges,
  onToggleSnapToBlockEdges,
  // ---- /STREAM-A ----
  // ---- STREAM-B: kashida auto-justify ----
  // ---- /STREAM-B ----
  // ---- STREAM-C: export presets ----
  // ---- /STREAM-C ----
  // ---- STREAM-D: user guide ----
  // ---- /STREAM-D ----
}) => {
  const [showText, setShowText] = useState(false);
  const [showTransform, setShowTransform] = useState(false);
  const [showEffects, setShowEffects] = useState(false);
  const [effectsTab, setEffectsTab] = useState<"outline" | "shadow">("outline");
  const [showContent, setShowContent] = useState(true);
  const [showFileActions, setShowFileActions] = useState(false);
  const [showLayers, setShowLayers] = useState(!isMobile);
  const [showAlign, setShowAlign] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [wizardTemplate, setWizardTemplate] = useState<StarterTemplate | null>(null);
  const [namedProjectInput, setNamedProjectInput] = useState("");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInStatus, setSignInStatus] = useState<
    | { kind: "idle" }
    | { kind: "sending" }
    | { kind: "sent" }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [showSignInForm, setShowSignInForm] = useState(false);
  const selectionCount = selectedIds.length > 1 ? selectedIds.length : 1;
  const [showBackgroundSettings, setShowBackgroundSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [imageTraceFile, setImageTraceFile] = useState<File | null>(null);

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
        textareaRef.current.focus({ preventScroll: true });
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleKeyboardBackspace = () => {
    if (!selectedBlock || cursorPosition <= 0) return;
    const before = selectedText.substring(0, cursorPosition - 1);
    const after = selectedText.substring(cursorPosition);
    const newPos = cursorPosition - 1;
    onUpdateSelectedBlock({ text: before + after });
    setCursorPosition(newPos);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus({ preventScroll: true });
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

  const handleImageTraceUpload = () => {
    if (!onAddShapeWarpBlock) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        alert("Please choose an image file (PNG, JPG, etc.).");
        return;
      }
      setImageTraceFile(file);
    };

    input.click();
  };

  const handleTextPathSvgUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = extractSvgPaths(e.target?.result as string, undefined, true);
        if (!result) {
          alert(
            "No supported shape elements found in SVG (path, rect, circle, ellipse, polygon, polyline)."
          );
          return;
        }

        // extractSvgPaths concatenates every matched shape into one `d`
        // string, which is correct for shapeFill/shapeWarp (they want the
        // union silhouette) but wrong for a text-path curve: the jump from
        // one subpath's end to the next subpath's `M` would be treated as a
        // real curve segment. Keep only the first subpath here.
        const { d: firstSubpathD, hadMultiple } = firstSubpath(result.pathData);
        if (hadMultiple) {
          alert(
            "This SVG has multiple shapes/subpaths — only the first one was used as the text path."
          );
        }
        onUpdateSelectedBlock({ textPathD: firstSubpathD });
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
            <div
              style={{
                fontSize: 11,
                textAlign: "center",
                color: "var(--text-muted)",
                marginTop: 2,
              }}
            >
              v{__APP_VERSION__}
            </div>
          </div>
        </div>

        <SidebarTier label="document" />

        {onGenerateFromTemplate && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Start from a Template"
              isOpen={showTemplates}
              onToggle={() => setShowTemplates((v) => !v)}
            >
              <div className="sectionPanel">
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Opens a wizard to fill in the text.
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  {STARTER_TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setWizardTemplate(t)}
                      className="sidebarSmallAction"
                      title={t.description}
                      style={{ textAlign: "center", height: "auto", padding: "10px 8px" }}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {onRandomizeLayout && blocks.length > 0 && (
                  <button
                    type="button"
                    onClick={onRandomizeLayout}
                    className="sidebarSmallAction"
                    title="Randomize the font, text color, and background color"
                    style={{ textAlign: "center" }}
                  >
                    🎲 Randomize Look
                  </button>
                )}
              </div>
            </CollapsibleSection>
          </div>
        )}

        <div className="sidebarPanel">
          <CollapsibleSection
            title="Background & Grid"
            isOpen={showBackgroundSettings}
            onToggle={() => setShowBackgroundSettings((v) => !v)}
          >
            <div className="sectionPanel">
              <ColorRow
                id="background-color"
                name="backgroundColor"
                label="Background color"
                value={backgroundColor}
                onChange={onChangeBackgroundColor}
              />

              <div style={{ display: "grid", gap: 8 }}>
                <CheckboxRow
                  id="show-grid"
                  label="Show gridlines"
                  checked={showGrid}
                  onChange={onToggleGrid}
                />

                <CheckboxRow
                  id="snap-to-grid"
                  label="Snap to gridlines"
                  checked={snapToGrid}
                  onChange={onToggleSnap}
                />

                {/* ---- STREAM-A: smart guides ---- */}
                <CheckboxRow
                  id="snap-to-block-edges"
                  label="Snap to block edges"
                  checked={snapToBlockEdges ?? true}
                  onChange={(checked) => onToggleSnapToBlockEdges?.(checked)}
                />
                {/* ---- /STREAM-A ---- */}

                <CheckboxRow
                  id="show-rulers"
                  label="Show rulers (click a ruler to drop a snap guide)"
                  checked={showRulers}
                  onChange={(checked) => onToggleRulers?.(checked)}
                />

                {guideCount > 0 && (
                  <button
                    type="button"
                    onClick={onClearGuides}
                    className="sidebarSmallAction"
                  >
                    Clear {guideCount} guide{guideCount === 1 ? "" : "s"}
                  </button>
                )}
              </div>
            </div>
          </CollapsibleSection>
        </div>

        <div className="sidebarPanel">
          <CollapsibleSection
            title="Project & Export"
            isOpen={showFileActions}
            onToggle={() => setShowFileActions((v) => !v)}
          >
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

              {(onSaveNamedProject || namedProjects.length > 0) && (
                <div
                  style={{
                    borderTop: "1px solid var(--border-soft)",
                    paddingTop: 10,
                    marginTop: 4,
                  }}
                >
                  {cloudConfigured && (
                    <div style={{ marginBottom: 10 }}>
                      {session ? (
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            fontSize: 12,
                            color: "var(--text-secondary)",
                          }}
                        >
                          <span
                            style={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {session.user.email}
                          </span>
                          <button
                            type="button"
                            onClick={() => onSignOut?.()}
                            className="layerIconBtn"
                            style={{ width: "auto", padding: "0 8px", fontSize: 11 }}
                          >
                            Sign out
                          </button>
                        </div>
                      ) : showSignInForm ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              type="email"
                              value={signInEmail}
                              onChange={(e) => setSignInEmail(e.target.value)}
                              onKeyDown={async (e) => {
                                if (
                                  e.key === "Enter" &&
                                  signInEmail.trim() &&
                                  onSignIn &&
                                  signInStatus.kind !== "sending"
                                ) {
                                  setSignInStatus({ kind: "sending" });
                                  const { error } = await onSignIn(signInEmail.trim());
                                  setSignInStatus(
                                    error ? { kind: "error", message: error } : { kind: "sent" }
                                  );
                                }
                              }}
                              placeholder="you@example.com"
                              className="hexInput"
                              style={{ fontFamily: "inherit", letterSpacing: 0 }}
                            />
                            <button
                              type="button"
                              onClick={async () => {
                                if (
                                  !signInEmail.trim() ||
                                  !onSignIn ||
                                  signInStatus.kind === "sending"
                                )
                                  return;
                                setSignInStatus({ kind: "sending" });
                                const { error } = await onSignIn(signInEmail.trim());
                                setSignInStatus(
                                  error ? { kind: "error", message: error } : { kind: "sent" }
                                );
                              }}
                              disabled={!signInEmail.trim() || signInStatus.kind === "sending"}
                              className="sidebarPillButton"
                              style={{ flex: "0 0 auto" }}
                            >
                              {signInStatus.kind === "sending" ? "Sending…" : "Send link"}
                            </button>
                          </div>
                          {signInStatus.kind === "sent" && (
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              Check your email for a sign-in link.
                            </span>
                          )}
                          {signInStatus.kind === "error" && (
                            <span style={{ fontSize: 11, color: "var(--danger)" }}>
                              {signInStatus.message}
                            </span>
                          )}
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowSignInForm(true)}
                          className="layerIconBtn"
                          style={{ width: "auto", padding: "0 8px", fontSize: 11 }}
                        >
                          Sign in to save projects to the cloud
                        </button>
                      )}
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                    Named saves — keep several in-progress designs in this browser at once.
                  </div>

                  {cloudConfigured && (
                    <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                      <button
                        type="button"
                        onClick={() => onChangeSaveDestination?.("local")}
                        className={
                          saveDestination === "local"
                            ? "sidebarPillButton sidebarPillButton--active"
                            : "sidebarPillButton"
                        }
                        style={{ flex: "0 0 auto", padding: "0 10px" }}
                      >
                        Local
                      </button>
                      <button
                        type="button"
                        onClick={() => session && onChangeSaveDestination?.("cloud")}
                        disabled={!session}
                        title={session ? undefined : "Sign in to save to cloud"}
                        className={
                          saveDestination === "cloud"
                            ? "sidebarPillButton sidebarPillButton--active"
                            : "sidebarPillButton"
                        }
                        style={{ flex: "0 0 auto", padding: "0 10px" }}
                      >
                        Cloud
                      </button>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      value={namedProjectInput}
                      onChange={(e) => setNamedProjectInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && namedProjectInput.trim()) {
                          onSaveNamedProject?.(namedProjectInput.trim());
                          setNamedProjectInput("");
                        }
                      }}
                      placeholder="Project name…"
                      className="hexInput"
                      style={{ fontFamily: "inherit", letterSpacing: 0 }}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!namedProjectInput.trim()) return;
                        onSaveNamedProject?.(namedProjectInput.trim());
                        setNamedProjectInput("");
                      }}
                      disabled={!namedProjectInput.trim()}
                      className="sidebarPillButton"
                      style={{ flex: "0 0 auto" }}
                    >
                      Save As
                    </button>
                  </div>

                  {namedProjects.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        marginTop: 8,
                      }}
                    >
                      {namedProjects.map((p) => (
                        <div
                          key={`${p.source}:${p.name}`}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            background: "var(--row-bg)",
                            borderRadius: 8,
                            padding: "5px 7px",
                          }}
                        >
                          {cloudConfigured && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                color: "var(--text-muted)",
                                textTransform: "uppercase",
                                letterSpacing: "0.03em",
                                flex: "0 0 auto",
                              }}
                            >
                              {p.source === "cloud" ? "Cloud" : "Local"}
                            </span>
                          )}
                          <span
                            style={{
                              flex: 1,
                              fontSize: 12,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              color: "var(--text-primary)",
                            }}
                            title={new Date(p.savedAt).toLocaleString()}
                          >
                            {p.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => onLoadNamedProject?.(p.name, p.source)}
                            className="layerIconBtn"
                            title="Load this project"
                            aria-label={`Load ${p.name}`}
                          >
                            <FolderOpenIcon size={13} />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteNamedProject?.(p.name, p.source)}
                            className="layerIconBtn"
                            title="Delete this saved project"
                            aria-label={`Delete ${p.name}`}
                            style={{ color: "var(--danger)" }}
                          >
                            <CloseIcon size={13} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

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

                <CheckboxRow
                  id="transparent-export"
                  label="Transparent background (PNG/SVG)"
                  checked={transparentExport}
                  onChange={onToggleTransparentExport}
                />
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
          </CollapsibleSection>
        </div>

        <SidebarTier label="canvas" />

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
              className="sidebarCircleButton sidebarCircleButton--danger"
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
              <>
                <button
                  type="button"
                  className="sidebarCircleButton"
                  title="Upload SVG for Shape Warp"
                  aria-label="Upload SVG for Shape Warp"
                  onClick={() => handleSvgUpload("shapeWarp")}
                >
                  <CircleDashedIcon size={14} />
                </button>

                <button
                  type="button"
                  className="sidebarCircleButton"
                  title="Trace image for Shape Warp"
                  aria-label="Trace image for Shape Warp"
                  onClick={handleImageTraceUpload}
                >
                  <TraceWandIcon size={14} />
                </button>
              </>
            )}

            {imageTraceFile && (
              <ImageTraceDialog
                file={imageTraceFile}
                onCancel={() => setImageTraceFile(null)}
                onConfirm={(pathData, w, h) => {
                  onAddShapeWarpBlock?.(pathData, w, h);
                  setImageTraceFile(null);
                }}
              />
            )}

            {onAddTextPathBlock && (
              <button
                type="button"
                className="sidebarCircleButton"
                title="Add Text on Path"
                onClick={onAddTextPathBlock}
              >
                <PathTextIcon size={14} />
              </button>
            )}

            {onAddImageBlock && (
              <button
                type="button"
                className="sidebarCircleButton"
                title="Upload image (PNG/JPG)"
                onClick={onAddImageBlock}
              >
                <ImageIcon size={14} />
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

            <HistoryPopover
              historyEntries={historyEntries}
              onJumpTo={onJumpToHistory}
              onCaptureCurrentThumbnail={onCaptureCurrentThumbnail}
            />
          </div>
        </div>

        <div className="sidebarPanel">
          <CollapsibleSection title="Layers" isOpen={showLayers} onToggle={() => setShowLayers((v) => !v)}>
            <div style={{ marginTop: 10 }}>
              <LayersPanel
                blocks={blocks}
                selectedId={selectedBlock?.id}
                selectedIds={selectedIds}
                onSelect={(id, additive) => onSelectBlock(id, additive)}
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
                onAddBlock={onAddBlock}
              />
            </div>
          </CollapsibleSection>
        </div>

        {selectedBlock && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Align & Arrange"
              isOpen={showAlign}
              onToggle={() => setShowAlign((v) => !v)}
            >
              <div className="sectionPanel">
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {selectionCount > 1
                    ? `Aligning ${selectionCount} selected layers to each other.`
                    : "Aligning to the canvas. Shift/Ctrl-click other layers to align them to each other instead."}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(6, 1fr)",
                    gap: 6,
                    justifyItems: "center",
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onAlignSelected?.("left")}
                    className="sidebarCircleButton"
                    title="Align left"
                    aria-label="Align left"
                  >
                    <AlignLeftIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAlignSelected?.("centerX")}
                    className="sidebarCircleButton"
                    title="Align center (horizontal)"
                    aria-label="Align center horizontal"
                  >
                    <AlignCenterHIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAlignSelected?.("right")}
                    className="sidebarCircleButton"
                    title="Align right"
                    aria-label="Align right"
                  >
                    <AlignRightIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAlignSelected?.("top")}
                    className="sidebarCircleButton"
                    title="Align top"
                    aria-label="Align top"
                  >
                    <AlignTopIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAlignSelected?.("centerY")}
                    className="sidebarCircleButton"
                    title="Align middle (vertical)"
                    aria-label="Align middle vertical"
                  >
                    <AlignMiddleIcon size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onAlignSelected?.("bottom")}
                    className="sidebarCircleButton"
                    title="Align bottom"
                    aria-label="Align bottom"
                  >
                    <AlignBottomIcon size={14} />
                  </button>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    disabled={selectionCount < 3}
                    onClick={() => onDistributeSelected?.("x")}
                    className="sidebarPillButton"
                    title="Distribute horizontally (needs 3+ selected)"
                    aria-label="Distribute horizontally"
                  >
                    <DistributeHorizontalIcon size={13} /> Distribute H
                  </button>
                  <button
                    type="button"
                    disabled={selectionCount < 3}
                    onClick={() => onDistributeSelected?.("y")}
                    className="sidebarPillButton"
                    title="Distribute vertically (needs 3+ selected)"
                    aria-label="Distribute vertically"
                  >
                    <DistributeVerticalIcon size={13} /> Distribute V
                  </button>
                </div>

                {selectionCount > 1 && (
                  <button
                    type="button"
                    onClick={() => onGroupSelected?.()}
                    className="sidebarSmallAction"
                  >
                    Group {selectionCount} selected layers
                  </button>
                )}
              </div>
            </CollapsibleSection>
          </div>
        )}

        <SidebarTier label="selected" />

        {selectedBlock && selectedBlock.type !== "image" && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Content"
              isOpen={showContent}
              onToggle={() => setShowContent((v) => !v)}
            >
              <div className="sectionPanel">
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

                <button
                  type="button"
                  onClick={() => setShowKeyboard((v) => !v)}
                  className="sidebarSectionButton"
                  aria-expanded={showKeyboard}
                  aria-pressed={showKeyboard}
                >
                  <span>Arabic Keyboard</span>
                  <span>{showKeyboard ? "Hide" : "Show"}</span>
                </button>


                <PresetKeyboard
                  title="إِعْرَاب"
                  rows={[DIACRITICS.slice(0, 6), DIACRITICS.slice(6)]}
                  onPick={handleKeyboardKey}
                  large
                />

                <button
                  type="button"
                  onClick={onClearDiacritics}
                  className="sidebarSmallAction"
                  style={{ background: "var(--bg-input)" }}
                >
                  Clear diacritics
                </button>

                {(selectedBlock?.type === "text" ||
                  selectedBlock?.type === "shapeFill" ||
                  selectedBlock?.type === "shapeWarp") &&
                  (selectedBlock.diacriticOverrides?.length ?? 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => onUpdateSelectedBlock({ diacriticOverrides: [] })}
                      className="sidebarSmallAction"
                      style={{ background: "var(--bg-input)" }}
                    >
                      Reset diacritic overrides
                    </button>
                  )}

                <PresetKeyboard
                  title="Presets"
                  rows={[PRESETS]}
                  onPick={handleKeyboardKey}
                  fontFamily={selectedBlock?.fontFamily ?? "FatemiMaqala"}
                />

                <PresetKeyboard
                  title="Specials"
                  rows={[SPECIALS.slice(0, 6), SPECIALS.slice(6)]}
                  onPick={handleKeyboardKey}
                />

                <PresetKeyboard
                  title="Urdu-Farsi Characters"
                  rows={[PERSIAN, URDU]}
                  onPick={handleKeyboardKey}
                />
              </div>
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type === "image" && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Image" isOpen={showText} onToggle={() => setShowText((v) => !v)}>
              <div className="sectionPanel">
                <RangeRow
                  id={makeId("image-scale", selectedId)}
                  name={makeId("imageScale", selectedId)}
                  label="Scale"
                  value={selectedBlock.imageScale ?? 1}
                  min={0.05}
                  max={10}
                  step={0.05}
                  onChange={(v) => onUpdateSelectedBlock({ imageScale: v })}
                  suffix={(selectedBlock.imageScale ?? 1).toFixed(2)}
                  fieldKey="imageScale"
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

                <RangeRow
                  id={makeId("rotation", selectedId)}
                  name={makeId("rotation", selectedId)}
                  label="Rotation"
                  value={selectedRotation}
                  min={-180}
                  max={180}
                  onChange={(v) => onUpdateSelectedBlock({ rotation: v })}
                  suffix={`${selectedRotation}°`}
                  fieldKey="rotation"
                />

                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  Tip: drag the gold handle on the image's corner (canvas) to resize.
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type === "shapeFill" && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Shape Fill"
              isOpen={showText}
              onToggle={() => setShowText((v) => !v)}
            >
              <div className="sectionPanel">
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                      Tip: drag the gold handle on the shape's corner (canvas) to resize.
                    </div>

                    <CheckboxRow
                      id={makeId("diacritic-edit-mode", selectedId)}
                      label="Diacritic tool"
                      checked={!!selectedBlock.diacriticEditMode}
                      onChange={() => onToggleDiacriticEditMode?.()}
                    />

                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                      Hover a tashkeel mark on the canvas to move, resize, or hide it. One
                      change applies to every repetition of that mark in the fill.
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
              </div>
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type === "shapeWarp" && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Shape Warp"
              isOpen={showText}
              onToggle={() => setShowText((v) => !v)}
            >
              <div className="sectionPanel">
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                        Reset to defaults
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
              </div>
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type === "textPath" && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Curve" isOpen={showText} onToggle={() => setShowText((v) => !v)}>
              <div className="sectionPanel">
                <button
                  type="button"
                  className="sidebarPillButton"
                  style={
                    selectedBlock.textPathEditMode
                      ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                      : undefined
                  }
                  onClick={() =>
                    onUpdateSelectedBlock({ textPathEditMode: !selectedBlock.textPathEditMode })
                  }
                >
                  {selectedBlock.textPathEditMode ? "Done Editing Curve" : "Edit Curve"}
                </button>

                <SelectRow
                  id={makeId("text-path-preset", selectedId)}
                  name={makeId("textPathPreset", selectedId)}
                  label="Preset"
                  value="custom"
                  onChange={(v) => {
                    if (v === "arc") {
                      onUpdateSelectedBlock({ textPathD: arcPathD(400, 120) });
                    } else if (v === "wave") {
                      onUpdateSelectedBlock({ textPathD: wavePathD(400, 120) });
                    } else if (v === "circle") {
                      onUpdateSelectedBlock({ textPathD: circlePathD(300, 300) });
                    }
                  }}
                >
                  <option value="custom">Custom</option>
                  <option value="arc">Arc</option>
                  <option value="wave">Wave</option>
                  <option value="circle">Circle</option>
                </SelectRow>

                <button
                  type="button"
                  className="sidebarPillButton"
                  onClick={handleTextPathSvgUpload}
                >
                  Upload SVG Path
                </button>

                <label className="field">
                  <span className="fieldTitle">
                    <input
                      type="checkbox"
                      checked={selectedBlock.textPathReversed ?? false}
                      onChange={(e) =>
                        onUpdateSelectedBlock({ textPathReversed: e.target.checked })
                      }
                      style={{ marginRight: 6 }}
                    />
                    Flip direction
                  </span>
                </label>

                <RangeRow
                  id={makeId("text-path-baseline-offset", selectedId)}
                  name={makeId("textPathBaselineOffset", selectedId)}
                  label="Baseline offset"
                  value={selectedBlock.textPathBaselineOffset ?? 0}
                  min={-60}
                  max={60}
                  onChange={(v) => onUpdateSelectedBlock({ textPathBaselineOffset: v })}
                  suffix={selectedBlock.textPathBaselineOffset ?? 0}
                  fieldKey="textPathBaselineOffset"
                />
              </div>
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type !== "image" && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Typography" isOpen={showText} onToggle={() => setShowText((v) => !v)}>
              <div className="sectionPanel">
                <FontSelectRow
                  id={makeId("font-family", selectedId)}
                  label="Font family"
                  value={selectedBlock.fontFamily}
                  options={FONT_OPTIONS}
                  onChange={(v) => onUpdateSelectedBlock({ fontFamily: v })}
                  previewSuffix="— أبجد"
                />

                {selectedBlock.type === "textPath" ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Letter size on a text-path block is set by the curve's length — drag the
                    curve longer or shorter in Edit Curve mode, or change the text.
                  </div>
                ) : (
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
                    suffix={`${Math.round(selectedBlock.fontSize)}px`}
                    fieldKey="fontSize"
                  />
                )}

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

                {selectedBlock.type === "text" && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Kashida</div>

                    <CheckboxRow
                      id={makeId("kashida-edit-mode", selectedId)}
                      label="Kashida tool"
                      checked={!!selectedBlock.kashidaEditMode}
                      onChange={() => onToggleKashidaEditMode?.()}
                    />

                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                      Drag a gold handle between two connected letters on the canvas to
                      elongate the connector (tatweel).
                    </div>
                  </div>
                )}

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
              </div>
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type !== "image" && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Transform"
              isOpen={showTransform}
              onToggle={() => setShowTransform((v) => !v)}
            >
              <div className="sectionPanel">
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
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type !== "image" && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Effects" isOpen={showEffects} onToggle={() => setShowEffects((v) => !v)}>
              <div className="sectionPanel">
                <div style={{ display: "flex", gap: 6 }}>
                  {(
                    [
                      { key: "outline", label: "Outline" },
                      { key: "shadow", label: "Shadow" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setEffectsTab(tab.key)}
                      className="sidebarPillButton"
                      style={
                        effectsTab === tab.key
                          ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                          : undefined
                      }
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {effectsTab === "outline" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                    <ColorRow
                      id={makeId("stroke-color", selectedId)}
                      name={makeId("strokeColor", selectedId)}
                      label="Outline color"
                      value={selectedBlock.stroke}
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

                {effectsTab === "shadow" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
                    <ColorRow
                      id={makeId("shadow-color", selectedId)}
                      name={makeId("shadowColor", selectedId)}
                      label="Shadow color"
                      value={selectedBlock.shadowColor}
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
            </CollapsibleSection>
          </div>
        )}


        {isMobile && selectedBlock && selectedBlock.type !== "image" && (
          <div className="sidebarPanel">
            <button
              type="button"
              onClick={onToggleMorphEditorMobile}
              className="sidebarSectionButton"
              aria-expanded={showMorphEditorMobile}
              aria-pressed={showMorphEditorMobile}
            >
              <span>Morph Glyph Editor</span>
              <span>{showMorphEditorMobile ? "Hide" : "Show"}</span>
            </button>
          </div>
        )}

        <div className="sidebarPanel">
          <CollapsibleSection
            title="Shortcuts"
            isOpen={showShortcuts}
            onToggle={() => setShowShortcuts((v) => !v)}
          >
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
          </CollapsibleSection>
        </div>

        {wizardTemplate && onGenerateFromTemplate && (
          <TemplateWizardDialog
            key={wizardTemplate.id}
            template={wizardTemplate}
            onCancel={() => setWizardTemplate(null)}
            onGenerate={(values) => {
              onGenerateFromTemplate(wizardTemplate.id, values);
              setWizardTemplate(null);
            }}
          />
        )}

        <FloatingArabicKeyboard
          open={showKeyboard && !!selectedBlock}
          onClose={() => setShowKeyboard(false)}
          onInsert={handleKeyboardKey}
          onBackspace={handleKeyboardBackspace}
        />
      </div>
    </div>
  );
};

export default Sidebar;