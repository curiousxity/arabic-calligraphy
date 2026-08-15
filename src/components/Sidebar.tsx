import React, { useEffect, useRef, useState } from "react";
import {
  DIACRITICS,
  SPECIALS,
  PERSIAN,
  URDU,
  PRESETS,
} from "../lib/presets";
import type { Block, MirrorMode, TextAlign } from "../types";
// STREAM-B (muthanna/radial): the file has no anchored import region, so this
// sits with the other lib imports. Used only by the STREAM-B regions below.
import { RADIAL_COUNT_MIN, RADIAL_COUNT_MAX, DEFAULT_RADIAL_COUNT, DEFAULT_RADIAL_RADIUS } from "../lib/mirror";
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
import { GuideLauncher } from "./guide/GuideLauncher";
import {
  findKashidaSlots,
  readKashida,
  MAX_KASHIDA_PER_SLOT,
  TATWEEL,
  type KashidaSlot,
} from "../lib/tatweel";
import {
  TrashIcon,
  CopyIcon,
  PlusIcon,
  ShapesIcon,
  PathTextIcon,
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
  AlignLeftIcon,
  AlignCenterHIcon,
  AlignRightIcon,
  AlignTopIcon,
  AlignMiddleIcon,
  AlignBottomIcon,
  DistributeHorizontalIcon,
  DistributeVerticalIcon,
} from "./Icons";
// Appended at the end of the import block: this file's imports carry no
// per-stream anchors, and appending is the lowest-conflict place to add one.
import {
  ARTBOARD_PRESETS,
  exportPixelSize,
  toDisplayUnit,
  fromDisplayUnit,
  type ArtboardConfig,
  type ArtboardUnit,
} from "../lib/artboard";
import { OrnamentPickerButton } from "./OrnamentPicker";
// ---- STREAM-E: styles & palettes — imports ----
// ---- /STREAM-E ----
// ---- STREAM-F: ink & surface — imports ----
import { fillToCss, resolveFill, type BlockFill, type FillStop } from "../lib/blockFill";
import type { ArtboardSurface, TextureDef } from "../data/textures";
// ---- /STREAM-F ----
// ---- STREAM-G: font upload — imports ----
// ---- /STREAM-G ----

export type SidebarProps = {
  // Phase 2 parallel-stream prop declarations — each stream adds its own
  // (all optional, arriving via App.tsx's p2* bundles). See PARALLEL-PHASE-2.md.
  // ---- STREAM-E: styles & palettes — props ----
  // ---- /STREAM-E ----
  // ---- STREAM-F: ink & surface — props ----
  /** The selected block's gradient, if it has one. Undefined = flat `blockColor`. */
  blockFill?: BlockFill;
  /** The selected block's flat colour — what a solid fill reads and writes. */
  blockColor?: string;
  /** Undefined or a solid fill clears `fill` and writes `color` instead. */
  onSetBlockFill?: (fill: BlockFill | undefined) => void;
  fillPresets?: { id: string; name: string; fill: BlockFill }[];
  textures?: TextureDef[];
  artboardSurface?: ArtboardSurface;
  onChangeArtboardSurface?: (patch: Partial<ArtboardSurface>) => void;
  // ---- /STREAM-F ----
  // ---- STREAM-G: font upload — props ----
  // ---- /STREAM-G ----
  // Phase 1 parallel-stream prop declarations — each stream adds its own
  // (all optional, arriving via App.tsx's p1* bundles). See PARALLEL-PHASE-1.md.
  /** The document's page, or null for freeform. */
  artboard?: ArtboardConfig | null;
  /** `""` = freeform, `"custom"` = keep the size but detach it, otherwise a preset id. */
  onChooseArtboardPreset?: (id: string) => void;
  /** Both dimensions at once — a page's aspect is usually edited as a pair. */
  onChangeArtboardSize?: (width: number, height: number) => void;
  onChangeArtboardUnit?: (unit: ArtboardUnit) => void;
  onChangeArtboardDpi?: (dpi: number) => void;
  onChangeArtboardOrientation?: (orientation: "portrait" | "landscape") => void;
  onChangeArtboardMargin?: (margin: number) => void;
  clipToPage?: boolean;
  onToggleClipToPage?: (value: boolean) => void;
  /** Adds a mirror of the selected block. Enabled only while `canAddMirrorBlock`. */
  onAddMirrorBlock?: (mode: MirrorMode) => void;
  /** Exactly one block is selected and it is not itself a mirror. */
  canAddMirrorBlock?: boolean;
  /** Moves the selection to the selected mirror's source, so it can be edited. */
  onSelectMirrorSource?: () => void;
  /** What to call that source in the Mirror panel. */
  mirrorSourceLabel?: string;
  onInsertOrnamentShapeFill?: (pathData: string, w: number, h: number) => void;
  onInsertOrnamentFrame?: (dataUrl: string, w: number, h: number) => void;
  kashidaSlotOrdinal?: number;
  onSelectKashidaSlot?: (ordinal: number) => void;
  onSetKashidaAtSlot?: (slot: KashidaSlot, count: number) => void;
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

  onToggleDiacriticEditMode?: () => void;
  /** Arms the on-canvas per-glyph move/scale dots. Plain text blocks only. */
  onToggleGlyphTransformMode?: (blockId: number) => void;
  onResetGlyphTransforms?: (blockId: number) => void;
  onFitShapeFillSpacing?: (blockId: number) => void;
  onAlignSelected?: (edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => void;
  onDistributeSelected?: (axis: "x" | "y") => void;
  onGroupSelected?: () => void;

  // Parallel-stream prop declarations — see docs/superpowers/specs/PARALLEL.md.
  // Every stream's props are optional, so this component still typechecks in a
  // worktree where the other three streams' props do not exist yet.
  snapToBlockEdges?: boolean;
  onToggleSnapToBlockEdges?: (checked: boolean) => void;
  // The preset shape is spelled out structurally rather than imported from
  // `lib/exportPresets`, so this stream adds no line to the import block —
  // the one region of this file with no per-stream anchors.
  onCopyPNG?: () => void;
  onExportAll?: () => void;
  exportStatus?: string | null;
  exportScale?: number;
  onChangeExportScale?: (scale: number) => void;
  exportFormats?: ("png" | "jpeg" | "svg" | "pdf")[];
  onToggleExportFormat?: (format: "png" | "jpeg" | "svg" | "pdf") => void;
  exportPresets?: {
    id: string;
    name: string;
    scale: number;
    transparent: boolean;
    formats: ("png" | "jpeg" | "svg" | "pdf")[];
  }[];
  selectedExportPresetId?: string;
  onSelectExportPreset?: (id: string) => void;
  onRunExportPreset?: () => void;
  newExportPresetName?: string;
  onChangeNewExportPresetName?: (name: string) => void;
  onSaveExportPreset?: () => void;
  onDeleteExportPreset?: () => void;
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
  { value: "HarfCanvasDiwani", label: "Diwani", cssFamily: "HarfCanvasDiwani" },
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
 * shapeFill's union-silhouette use case, but a text-path curve
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
  // ---- STREAM-E: styles & palettes — destructure ----
  // ---- /STREAM-E ----
  // ---- STREAM-F: ink & surface — destructure ----
  blockFill,
  blockColor,
  onSetBlockFill,
  fillPresets = [],
  textures = [],
  artboardSurface,
  onChangeArtboardSurface,
  // ---- /STREAM-F ----
  // ---- STREAM-G: font upload — destructure ----
  // ---- /STREAM-G ----
  blocks,
  artboard = null,
  onChooseArtboardPreset,
  onChangeArtboardSize,
  onChangeArtboardUnit,
  onChangeArtboardDpi,
  onChangeArtboardOrientation,
  onChangeArtboardMargin,
  clipToPage = true,
  onToggleClipToPage,
  onAddMirrorBlock,
  canAddMirrorBlock,
  onSelectMirrorSource,
  mirrorSourceLabel,
  onInsertOrnamentShapeFill,
  onInsertOrnamentFrame,
  kashidaSlotOrdinal = 0,
  onSelectKashidaSlot,
  onSetKashidaAtSlot,
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
  onToggleDiacriticEditMode,
  onToggleGlyphTransformMode,
  onResetGlyphTransforms,
  onFitShapeFillSpacing,
  onAlignSelected,
  onDistributeSelected,
  onGroupSelected,
  // Parallel-stream destructuring — match your declarations above.
  snapToBlockEdges,
  onToggleSnapToBlockEdges,
  onCopyPNG,
  onExportAll,
  exportStatus,
  exportScale = 2,
  onChangeExportScale,
  exportFormats = ["png", "jpeg", "svg", "pdf"],
  onToggleExportFormat,
  exportPresets = [],
  selectedExportPresetId = "",
  onSelectExportPreset,
  onRunExportPreset,
  newExportPresetName = "",
  onChangeNewExportPresetName,
  onSaveExportPreset,
  onDeleteExportPreset,
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
  // Stream A (artboard). Panel open/close state has no anchor region in this
  // file; one line beside its neighbours is the smallest possible addition.
  const [showArtboard, setShowArtboard] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);

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

  const handleSvgUpload = () => {
    const onAdd = onAddShapeFillBlock;
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
        // string, which is correct for shapeFill (it wants the
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
          <GuideLauncher isMobile={isMobile} />
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
            title="Artboard"
            isOpen={showArtboard}
            onToggle={() => setShowArtboard((v) => !v)}
          >
            <div className="sectionPanel">
              <SelectRow
                id="artboard-preset"
                name="artboardPreset"
                label="Page size"
                value={artboard ? artboard.presetId ?? "custom" : ""}
                onChange={(v) => onChooseArtboardPreset?.(v)}
              >
                <option value="">No artboard (freeform)</option>
                <optgroup label="Print">
                  {ARTBOARD_PRESETS.filter((p) => p.group === "print").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Screen">
                  {ARTBOARD_PRESETS.filter((p) => p.group === "screen").map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </optgroup>
                <option value="custom">Custom size…</option>
              </SelectRow>

              {/* An IIFE rather than a helper component: everything below needs
                  the same unit-formatting closure, and this file's module scope
                  carries no per-stream anchor to declare one in. */}
              {artboard &&
                (() => {
                  const decimals = artboard.unit === "in" ? 2 : artboard.unit === "mm" ? 1 : 0;
                  const show = (px: number) =>
                    toDisplayUnit(px, artboard).toFixed(decimals);
                  const commit = (which: "width" | "height") => (raw: string) => {
                    const parsed = Number.parseFloat(raw);
                    if (!Number.isFinite(parsed) || parsed <= 0) return;
                    const px = fromDisplayUnit(parsed, artboard);
                    onChangeArtboardSize?.(
                      which === "width" ? px : artboard.width,
                      which === "height" ? px : artboard.height
                    );
                  };
                  const marginMax = Math.round(
                    Math.min(artboard.width, artboard.height) * 0.45
                  );
                  const size = exportPixelSize(artboard);

                  return (
                    <>
                      <div className="artboardSizeRow">
                        <label className="field" htmlFor="artboard-width">
                          <span className="fieldTitle">Width</span>
                          <input
                            id="artboard-width"
                            // Remounts whenever the stored size changes, so the
                            // field re-syncs after a preset or orientation
                            // switch without fighting the user mid-typing.
                            key={`w-${artboard.width}-${artboard.unit}`}
                            type="number"
                            min={1}
                            step={decimals ? 0.1 : 1}
                            defaultValue={show(artboard.width)}
                            className="hexInput artboardNumberInput"
                            onBlur={(e) => commit("width")(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                          />
                        </label>
                        <label className="field" htmlFor="artboard-height">
                          <span className="fieldTitle">Height</span>
                          <input
                            id="artboard-height"
                            key={`h-${artboard.height}-${artboard.unit}`}
                            type="number"
                            min={1}
                            step={decimals ? 0.1 : 1}
                            defaultValue={show(artboard.height)}
                            className="hexInput artboardNumberInput"
                            onBlur={(e) => commit("height")(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                            }}
                          />
                        </label>
                      </div>

                      <div className="artboardSizeRow">
                        <SelectRow
                          id="artboard-unit"
                          name="artboardUnit"
                          label="Units"
                          value={artboard.unit}
                          onChange={(v) => onChangeArtboardUnit?.(v as ArtboardUnit)}
                        >
                          <option value="px">Pixels</option>
                          <option value="mm">Millimetres</option>
                          <option value="in">Inches</option>
                        </SelectRow>
                        <SelectRow
                          id="artboard-dpi"
                          name="artboardDpi"
                          label="Resolution"
                          value={String(artboard.dpi)}
                          onChange={(v) => onChangeArtboardDpi?.(Number.parseInt(v, 10))}
                        >
                          <option value="72">72 dpi</option>
                          <option value="96">96 dpi (screen)</option>
                          <option value="150">150 dpi</option>
                          <option value="300">300 dpi (print)</option>
                          <option value="600">600 dpi</option>
                        </SelectRow>
                      </div>

                      <div className="field">
                        <span className="fieldTitle">Orientation</span>
                        <div className="artboardOrientation">
                          {(["portrait", "landscape"] as const).map((o) => (
                            <button
                              key={o}
                              type="button"
                              onClick={() => onChangeArtboardOrientation?.(o)}
                              className={
                                artboard.orientation === o
                                  ? "sidebarSmallAction sidebarSmallAction--accent"
                                  : "sidebarSmallAction"
                              }
                              aria-pressed={artboard.orientation === o}
                            >
                              {o === "portrait" ? "Portrait" : "Landscape"}
                            </button>
                          ))}
                        </div>
                      </div>

                      <RangeRow
                        id="artboard-margin"
                        name="artboardMargin"
                        label="Margin"
                        value={Math.min(artboard.margin, marginMax)}
                        min={0}
                        max={marginMax}
                        onChange={(v) => onChangeArtboardMargin?.(v)}
                        suffix={
                          artboard.margin > 0
                            ? `${show(artboard.margin)} ${artboard.unit}`
                            : "none"
                        }
                      />

                      <div className="artboardReadout">
                        Exports at <strong>{size.width} × {size.height} px</strong> — the
                        page's own pixel size, so the export scale setting doesn't
                        apply while an artboard is set.
                      </div>

                      <CheckboxRow
                        id="artboard-clip"
                        label="Clip exports to the page"
                        checked={clipToPage}
                        onChange={(checked) => onToggleClipToPage?.(checked)}
                      />
                    </>
                  );
                })()}

              <ColorRow
                id="background-color"
                name="backgroundColor"
                label={artboard ? "Page color" : "Background color"}
                value={backgroundColor}
                onChange={onChangeBackgroundColor}
              />
              {/* ---- STREAM-F: ink & surface — Surface row ---- */}
              {(() => {
                if (!artboardSurface) return null;
                const active = textures.find((t) => t.id === artboardSurface.textureId);
                return (
                  <>
                    <SelectRow
                      id="artboard-surface"
                      name="artboardSurface"
                      label="Paper surface"
                      value={artboardSurface.textureId ?? ""}
                      onChange={(v) =>
                        onChangeArtboardSurface?.({ textureId: v === "" ? null : v })
                      }
                    >
                      <option value="">None (flat colour)</option>
                      {textures.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </SelectRow>
                    {active && (
                      <ColorRow
                        id="artboard-surface-tint"
                        name="artboardSurfaceTint"
                        label="Paper tint"
                        value={artboardSurface.tint ?? active.defaultTint}
                        onChange={(v) => onChangeArtboardSurface?.({ tint: v })}
                      />
                    )}
                  </>
                );
              })()}
              {/* ---- /STREAM-F ---- */}
            </div>
          </CollapsibleSection>
        </div>

        <div className="sidebarPanel">
          <CollapsibleSection
            title="Background & Grid"
            isOpen={showBackgroundSettings}
            onToggle={() => setShowBackgroundSettings((v) => !v)}
          >
            {/* Background colour used to live here; it moved into the
                Artboard panel above, where it is the page's own colour. */}
            <div className="sectionPanel">
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

                <CheckboxRow
                  id="snap-to-block-edges"
                  label="Snap to block edges"
                  checked={snapToBlockEdges ?? true}
                  onChange={(checked) => onToggleSnapToBlockEdges?.(checked)}
                />

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

              <div
                style={{
                  borderTop: "1px solid var(--border-soft)",
                  paddingTop: 10,
                  marginTop: 4,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <button
                    type="button"
                    onClick={onCopyPNG}
                    className="sidebarPillButton"
                    title="Copy a PNG of the artwork to the clipboard"
                    aria-label="Copy PNG to clipboard"
                    style={{ minWidth: 0 }}
                  >
                    <ImageIcon size={13} /> Copy PNG
                  </button>
                  <button
                    type="button"
                    onClick={onExportAll}
                    className="sidebarPillButton"
                    title="Download every ticked format at once"
                    aria-label="Export all ticked formats"
                    style={{ minWidth: 0 }}
                  >
                    <FileTextIcon size={13} /> Export all
                  </button>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label
                    htmlFor="export-scale"
                    style={{ fontSize: 11, color: "var(--text-muted)", flex: "0 0 auto" }}
                  >
                    Scale
                  </label>
                  <input
                    id="export-scale"
                    type="number"
                    min={0.25}
                    max={8}
                    step={0.25}
                    value={exportScale}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      if (Number.isFinite(next) && next > 0) onChangeExportScale?.(next);
                    }}
                    className="hexInput"
                    style={{ minWidth: 0, flex: 1, fontFamily: "inherit", letterSpacing: 0 }}
                  />
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flex: "0 0 auto" }}>
                    ×
                  </span>
                </div>

                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {(["png", "jpeg", "svg", "pdf"] as const).map((format) => (
                    <button
                      key={format}
                      type="button"
                      onClick={() => onToggleExportFormat?.(format)}
                      className={
                        exportFormats.includes(format)
                          ? "sidebarPillButton sidebarPillButton--active"
                          : "sidebarPillButton"
                      }
                      style={{ flex: "0 0 auto", padding: "0 10px", minWidth: 0 }}
                      aria-pressed={exportFormats.includes(format)}
                      title={`Include ${format.toUpperCase()} in "Export all" and in a new preset`}
                    >
                      {format.toUpperCase()}
                    </button>
                  ))}
                </div>

                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <select
                    value={selectedExportPresetId}
                    onChange={(e) => onSelectExportPreset?.(e.target.value)}
                    className="select"
                    aria-label="Export preset"
                    style={{ minWidth: 0, flex: 1 }}
                  >
                    <option value="">Preset…</option>
                    {exportPresets.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={onRunExportPreset}
                    disabled={!selectedExportPresetId}
                    className="sidebarPillButton"
                    style={{ flex: "0 0 auto", padding: "0 10px" }}
                    title="Export using this preset"
                  >
                    Run
                  </button>
                  <button
                    type="button"
                    onClick={onDeleteExportPreset}
                    disabled={!selectedExportPresetId}
                    className="layerIconBtn"
                    title="Delete this preset"
                    aria-label="Delete this preset"
                    style={{ color: "var(--danger)", flex: "0 0 auto" }}
                  >
                    <CloseIcon size={13} />
                  </button>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="text"
                    value={newExportPresetName}
                    onChange={(e) => onChangeNewExportPresetName?.(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newExportPresetName.trim()) onSaveExportPreset?.();
                    }}
                    placeholder="Preset name…"
                    aria-label="New export preset name"
                    className="hexInput"
                    style={{ minWidth: 0, fontFamily: "inherit", letterSpacing: 0 }}
                  />
                  <button
                    type="button"
                    onClick={onSaveExportPreset}
                    disabled={!newExportPresetName.trim()}
                    className="sidebarPillButton"
                    style={{ flex: "0 0 auto" }}
                  >
                    Save preset
                  </button>
                </div>

                {exportStatus && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }} role="status">
                    {exportStatus}
                  </div>
                )}
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
                onClick={() => handleSvgUpload()}
              >
                <ShapesIcon size={14} />
              </button>
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
            {/* Inline SVGs rather than entries in Icons.tsx: that file is not
                this stream's to edit during the Phase 1 parallel run. */}
            {onAddMirrorBlock && (
              <>
                <button
                  type="button"
                  className="sidebarCircleButton"
                  disabled={!canAddMirrorBlock}
                  title={
                    canAddMirrorBlock
                      ? "Add a mirror (muthanna) of the selected block"
                      : "Select exactly one non-mirror block to mirror it"
                  }
                  aria-label="Add mirror block"
                  onClick={() => onAddMirrorBlock("mirrorX")}
                >
                  <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1v14" stroke="currentColor" strokeWidth={1.2} strokeDasharray="2 2" />
                    <path d="M6.5 4 2 8l4.5 4z" fill="currentColor" />
                    <path
                      d="M9.5 4 14 8l-4.5 4z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.2}
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>

                <button
                  type="button"
                  className="sidebarCircleButton"
                  disabled={!canAddMirrorBlock}
                  title={
                    canAddMirrorBlock
                      ? "Add a radial repetition of the selected block"
                      : "Select exactly one non-mirror block to repeat it radially"
                  }
                  aria-label="Add radial block"
                  onClick={() => onAddMirrorBlock("radial")}
                >
                  <svg width={14} height={14} viewBox="0 0 16 16" aria-hidden="true">
                    <g stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
                      <path d="M8 1.5v3.2M8 11.3v3.2M1.5 8h3.2M11.3 8h3.2" />
                      <path d="M3.4 3.4l2.3 2.3M10.3 10.3l2.3 2.3M12.6 3.4l-2.3 2.3M5.7 10.3l-2.3 2.3" />
                    </g>
                    <circle cx={8} cy={8} r={1.6} fill="currentColor" />
                  </svg>
                </button>
              </>
            )}
            {(onInsertOrnamentShapeFill || onInsertOrnamentFrame) && (
              <OrnamentPickerButton
                variant="circle"
                onInsertShapeFill={onInsertOrnamentShapeFill}
                onInsertFrame={onInsertOrnamentFrame}
              />
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

        {/* A mirror has no content or typography of its own — both come from
            its source — so it hides these two panels the way image already
            does. (STREAM-B edit outside its anchors; see the stream report.) */}
        {selectedBlock && selectedBlock.type !== "image" && selectedBlock.type !== "mirror" && (
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
                  selectedBlock?.type === "shapeFill") &&
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

        {selectedBlock && selectedBlock.type === "mirror" && (
          <div className="sidebarPanel">
            <CollapsibleSection
              title="Mirror"
              isOpen={showText}
              onToggle={() => setShowText((v) => !v)}
            >
              <div className="sectionPanel">
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                  This block draws {mirrorSourceLabel ?? "another block"}'s content. Edit the
                  text and typography on the source — every copy follows.
                </div>

                <button
                  type="button"
                  onClick={() => onSelectMirrorSource?.()}
                  className="sidebarSmallAction"
                  style={{ background: "var(--bg-input)" }}
                  title="Select the block this mirror reflects"
                >
                  Select source
                </button>

                <SelectRow
                  id={makeId("mirror-mode", selectedId)}
                  name={makeId("mirrorMode", selectedId)}
                  label="Mode"
                  value={selectedBlock.mode}
                  onChange={(v) => onUpdateSelectedBlock({ mode: v as MirrorMode })}
                >
                  <option value="mirrorX">Mirror across a vertical axis</option>
                  <option value="mirrorY">Mirror across a horizontal axis</option>
                  <option value="radial">Radial (around a centre)</option>
                </SelectRow>

                {selectedBlock.mode === "radial" && (
                  <>
                    <RangeRow
                      id={makeId("radial-count", selectedId)}
                      name={makeId("radialCount", selectedId)}
                      label="Copies"
                      value={selectedBlock.radialCount ?? DEFAULT_RADIAL_COUNT}
                      min={RADIAL_COUNT_MIN}
                      max={RADIAL_COUNT_MAX}
                      step={1}
                      onChange={(v) => onUpdateSelectedBlock({ radialCount: v })}
                      suffix={selectedBlock.radialCount ?? DEFAULT_RADIAL_COUNT}
                    />

                    <RangeRow
                      id={makeId("radial-radius", selectedId)}
                      name={makeId("radialRadius", selectedId)}
                      label="Radius"
                      value={selectedBlock.radialRadius ?? DEFAULT_RADIAL_RADIUS}
                      min={0}
                      max={600}
                      step={2}
                      onChange={(v) => onUpdateSelectedBlock({ radialRadius: v })}
                      suffix={`${Math.round(selectedBlock.radialRadius ?? DEFAULT_RADIAL_RADIUS)}px`}
                    />
                  </>
                )}

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
                {(onInsertOrnamentShapeFill || onInsertOrnamentFrame) && (
                  <OrnamentPickerButton
                    variant="wide"
                    onInsertShapeFill={onInsertOrnamentShapeFill}
                    onInsertFrame={onInsertOrnamentFrame}
                  />
                )}
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

        {selectedBlock && selectedBlock.type !== "image" && selectedBlock.type !== "mirror" && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Typography" isOpen={showText} onToggle={() => setShowText((v) => !v)}>
              <div className="sectionPanel">
                {/* ---- STREAM-E: styles & palettes — Styles row ---- */}
                {/* ---- /STREAM-E ---- */}
                {/* Everything this section needs is derived from the block's
                    own text, so it holds no state of its own beyond the
                    selected slot (which lives in App.tsx). Written as an IIFE
                    rather than a helper component because this stream owns
                    only the region between these two anchors. */}
                {(() => {
                  const slots = findKashidaSlots(selectedBlock.text);
                  if (slots.length === 0) {
                    return (
                      <div className="field">
                        <span className="fieldTitle">Kashida</span>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          No stretchable joins in this text — a kashida needs two
                          letters that join to each other.
                        </div>
                      </div>
                    );
                  }

                  // The ordinal is clamped rather than reset, so editing the
                  // text (which changes how many slots there are) can never
                  // point the stepper past the end of the list.
                  const ordinal = Math.min(Math.max(0, kashidaSlotOrdinal), slots.length - 1);
                  const slot = slots[ordinal];
                  const counts = readKashida(selectedBlock.text, slots);
                  const count = counts.get(slot.index) ?? 0;
                  const setCount = (n: number) =>
                    onSetKashidaAtSlot?.(slot, Math.min(MAX_KASHIDA_PER_SLOT, Math.max(0, n)));
                  const slotLabel = (s: KashidaSlot) => `${s.before} ${TATWEEL} ${s.after}`;

                  return (
                    <>
                      <SelectRow
                        id={makeId("kashida-slot", selectedId)}
                        name={makeId("kashidaSlot", selectedId)}
                        label="Kashida join"
                        value={String(ordinal)}
                        onChange={(v) => onSelectKashidaSlot?.(Number(v))}
                      >
                        {slots.map((s, i) => (
                          <option key={`${s.index}-${i}`} value={String(i)}>
                            {`${i + 1}. ${slotLabel(s)}`}
                            {(counts.get(s.index) ?? 0) > 0 ? ` (${counts.get(s.index)})` : ""}
                          </option>
                        ))}
                      </SelectRow>

                      <div className="field">
                        <span className="fieldTitle">Stretch this join</span>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                          }}
                        >
                          <button
                            type="button"
                            className="sidebarCircleButton"
                            aria-label="Shorten kashida"
                            disabled={count === 0}
                            onClick={() => setCount(count - 1)}
                          >
                            −
                          </button>
                          <span
                            aria-label="Kashida length"
                            style={{
                              minWidth: 24,
                              textAlign: "center",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {count}
                          </span>
                          <button
                            type="button"
                            className="sidebarCircleButton"
                            aria-label="Lengthen kashida"
                            disabled={count >= MAX_KASHIDA_PER_SLOT}
                            onClick={() => setCount(count + 1)}
                          >
                            +
                          </button>
                          <span
                            dir="rtl"
                            style={{ flex: 1, minWidth: 0, fontSize: 16, textAlign: "center" }}
                          >
                            {slot.before}
                            {TATWEEL.repeat(Math.max(1, count))}
                            {slot.after}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                          Adds tatweel characters to the text itself, so the letters
                          really connect. Apply kashida before fine-tuning marks.
                        </div>
                      </div>
                    </>
                  );
                })()}
                {/* ---- STREAM-G: font upload — upload entry + custom font list ---- */}
                {/* ---- /STREAM-G ---- */}
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
                    min={selectedBlock.type === "shapeFill" ? 4 : 12}
                    max={selectedBlock.type === "shapeFill" ? 400 : 200}
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

                {/* Relocated here when the Morph Glyph Editor panel was
                    removed. Plain text only — no other renderer reads
                    `glyphTransforms`, so arming it elsewhere would show dots
                    that move nothing. */}
                {selectedBlock.type === "text" && (
                  <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
                    <div className="sidebarSectionTitle">Move &amp; scale</div>

                    <CheckboxRow
                      id={makeId("glyph-transform-mode", selectedId)}
                      label="Move &amp; scale glyph"
                      checked={!!selectedBlock.glyphTransformMode}
                      onChange={() => onToggleGlyphTransformMode?.(selectedBlock.id)}
                    />

                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                      Hover a letter on the canvas to move it, or stretch it in x or y.
                      Neighbouring letters never shift.
                    </div>

                    {(selectedBlock.glyphTransforms?.length ?? 0) > 0 && (
                      <button
                        type="button"
                        onClick={() => onResetGlyphTransforms?.(selectedBlock.id)}
                        className="sidebarSmallAction"
                        style={{ background: "var(--bg-input)", marginTop: 8 }}
                      >
                        Reset glyph moves &amp; scales
                      </button>
                    )}
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
                {/* ---- STREAM-F: ink & surface — Fill section ---- */}
                {/*
                  An IIFE rather than a component: this stream owns no file to
                  put one in, and the same shape the Kashida controls already
                  use. It holds no state — the editor reads the block's own
                  fill and writes a whole new one on every change.
                */}
                {(() => {
                  const flat = blockColor ?? "#000000";
                  const current = resolveFill(blockFill, flat);
                  const stops: FillStop[] =
                    current.type === "solid"
                      ? [
                          { offset: 0, color: flat },
                          { offset: 1, color: "#ffffff" },
                        ]
                      : current.stops;
                  const angle = current.type === "linear" ? current.angle : 90;

                  const write = (next: BlockFill) => onSetBlockFill?.(next);
                  const writeStops = (nextStops: FillStop[]) =>
                    write(
                      current.type === "radial"
                        ? { type: "radial", stops: nextStops }
                        : { type: "linear", angle, stops: nextStops }
                    );

                  return (
                    <>
                      <SelectRow
                        id="block-fill-type"
                        name="blockFillType"
                        label="Fill"
                        value={current.type}
                        onChange={(v) => {
                          if (v === "solid") write({ type: "solid", color: flat });
                          else if (v === "radial") write({ type: "radial", stops });
                          else write({ type: "linear", angle, stops });
                        }}
                      >
                        <option value="solid">Flat colour</option>
                        <option value="linear">Linear gradient</option>
                        <option value="radial">Radial gradient</option>
                      </SelectRow>

                      <div className="field">
                        <span className="fieldTitle">Metallics</span>
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            flexWrap: "wrap",
                            // Grid/flex children default to min-width:auto and
                            // refuse to shrink — see CLAUDE.md's note on the
                            // sidebar's narrow width.
                            minWidth: 0,
                          }}
                        >
                          {fillPresets.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              title={preset.name}
                              aria-label={preset.name}
                              style={{
                                background: fillToCss(preset.fill),
                                width: 34,
                                height: 22,
                                minWidth: 0,
                                borderRadius: 4,
                                border: "1px solid var(--border-soft)",
                                cursor: "pointer",
                                padding: 0,
                              }}
                              onClick={() => write(preset.fill)}
                            />
                          ))}
                        </div>
                      </div>

                      {current.type === "solid" ? (
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          Flat ink uses the block's colour, set under Typography.
                        </div>
                      ) : (
                        <>
                          {current.type === "linear" && (
                            <RangeRow
                              id="block-fill-angle"
                              name="blockFillAngle"
                              label="Gradient angle"
                              value={angle}
                              min={0}
                              max={360}
                              step={1}
                              onChange={(v) => write({ type: "linear", angle: v, stops })}
                              suffix={`${angle}°`}
                            />
                          )}

                          <div className="field">
                            <span className="fieldTitle">Stops</span>
                            {stops.map((stop, i) => (
                              <div
                                key={i}
                                style={{
                                  display: "flex",
                                  gap: 6,
                                  alignItems: "center",
                                  minWidth: 0,
                                }}
                              >
                                <input
                                  type="color"
                                  aria-label={`Stop ${i + 1} colour`}
                                  value={stop.color}
                                  onChange={(e) =>
                                    writeStops(
                                      stops.map((s, j) =>
                                        j === i ? { ...s, color: e.target.value } : s
                                      )
                                    )
                                  }
                                />
                                <input
                                  type="range"
                                  aria-label={`Stop ${i + 1} position`}
                                  style={{ flex: 1, minWidth: 0 }}
                                  min={0}
                                  max={100}
                                  value={Math.round(stop.offset * 100)}
                                  onChange={(e) =>
                                    writeStops(
                                      stops.map((s, j) =>
                                        j === i
                                          ? { ...s, offset: Number(e.target.value) / 100 }
                                          : s
                                      )
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  className="sidebarPillButton"
                                  aria-label={`Remove stop ${i + 1}`}
                                  disabled={stops.length <= 2}
                                  onClick={() =>
                                    writeStops(stops.filter((_, j) => j !== i))
                                  }
                                >
                                  −
                                </button>
                              </div>
                            ))}
                            <button
                              type="button"
                              className="sidebarPillButton"
                              disabled={stops.length >= 4}
                              onClick={() =>
                                writeStops([
                                  ...stops,
                                  {
                                    offset: 1,
                                    color: stops[stops.length - 1]?.color ?? flat,
                                  },
                                ])
                              }
                            >
                              Add stop
                            </button>
                          </div>
                        </>
                      )}
                    </>
                  );
                })()}
                {/* ---- /STREAM-F ---- */}
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