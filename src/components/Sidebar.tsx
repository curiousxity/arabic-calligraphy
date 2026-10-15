import React, { useEffect, useRef, useState } from "react";
import {
  DIACRITICS,
  SPECIALS,
  PERSIAN,
  URDU,
  PRESETS,
} from "../lib/presets";
import type { Block } from "../types";
import type { NamedProjectMeta } from "../App";
import { STARTER_TEMPLATES } from "../lib/templates";
import type { StarterTemplate } from "../lib/templates";
import { TemplateWizardDialog } from "./TemplateWizardDialog";
import { CompositionButton } from "./CompositionDialog";
import { FontPanel } from "./sidebar/FontPanel";
import type { FontChoice } from "../lib/fontCatalog";
import type { CompositionSelection } from "../lib/composition";
import type { GuideAttachment, GuideParams, GuideShape, VerseLayout, VerseSettings } from "../types";
import { VersePanel } from "./sidebar/VersePanel";
import { GuidePanel } from "./sidebar/GuidePanel";
import { StackPanel } from "./sidebar/StackPanel";
import { MirrorPanel } from "./sidebar/MirrorPanel";
import { CurvePanel } from "./sidebar/CurvePanel";
import { ShapeFillPanel } from "./sidebar/ShapeFillPanel";
import { BlockControlsPanel } from "./sidebar/BlockControlsPanel";
import { TypographyPanel } from "./sidebar/TypographyPanel";
import { EffectsPanel } from "./sidebar/EffectsPanel";
import { GUIDE_SHAPE_LABELS } from "../lib/guideShapes";
import { attachedTo, guidesIn } from "../lib/guides";
import { LayersPanel } from "./sidebar/LayersPanel";
import type { HistoryTimelineEntry } from "./sidebar/HistoryPopover";
import { makeId } from "./sidebar/utils";
import { hasOwnFont, supportsDiacriticOverrides } from "../lib/blockCapabilities";
import {
  SelectRow,
  ColorRow,
  RangeRow,
  PresetKeyboard,
  CollapsibleSection,
  CheckboxRow,
} from "./sidebar/FormControls";
import { FloatingArabicKeyboard } from "./sidebar/FloatingKeyboard";
import { GuideLauncher } from "./guide/GuideLauncher";
import type { KashidaSlot } from "../lib/tatweel";
import {
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
// ---- STREAM-E: styles & palettes — imports ----
import type { TextStyle } from "../lib/textStyles";
import type { Palette } from "../lib/palettes";
// ---- /STREAM-E ----
// ---- STREAM-F: ink & surface — imports ----
import type { BlockFill } from "../lib/blockFill";
import type { ArtboardSurface, TextureDef } from "../data/textures";
// ---- /STREAM-F ----
// ---- STREAM-G: font upload — imports ----
import { PracticeSheetButton } from "./PracticeSheetDialog";
import type { CustomFont } from "../lib/customFonts";
import type { AlternateChoice, AlternateTarget } from "../lib/glyphAlternates";
import type { GlyphAlternatesState, StyleSetsState } from "../hooks/useGlyphAlternates";
// ---- /STREAM-G ----

export type SidebarProps = {
  // Phase 2 parallel-stream prop declarations — each stream adds its own
  // (all optional, arriving via App.tsx's p2* bundles). See PARALLEL-PHASE-2.md.
  // ---- STREAM-E: styles & palettes — props ----
  /** Saved text styles, local-only (never part of a project). */
  textStyles?: TextStyle[];
  selectedTextStyleId?: string;
  onSelectTextStyle?: (id: string) => void;
  /** Applies the selected style to every selected block, as one undo step. */
  onApplyTextStyle?: () => void;
  newTextStyleName?: string;
  onChangeNewTextStyleName?: (name: string) => void;
  onSaveTextStyle?: () => void;
  onDeleteTextStyle?: () => void;
  /** Shipped palettes first, then the user's own. */
  palettes?: Palette[];
  selectedPaletteId?: string;
  onSelectPalette?: (id: string) => void;
  onPickPaletteColor?: (color: string) => void;
  onSavePaletteFromCanvas?: () => void;
  onDeletePalette?: () => void;
  canDeletePalette?: boolean;
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
  /** The user's uploaded fonts, appended to the built-in picker list. */
  customFonts?: CustomFont[];
  /** `fontChoicesWith(customFonts)`, built once in App for every surface that lists fonts. */
  fontChoices?: FontChoice[];
  onAddCustomFont?: (file: File, label?: string) => Promise<CustomFont | { error: string }>;
  /** Bake the selected text block into a stacked composition. */
  onConvertToStack?: () => void;
  onEditStack?: () => void;
  /** Arrange the selected stack's letters inside a closed guide. */
  onRemoveCustomFont?: (key: string) => void;
  /** Set when the selected block names a font this browser cannot resolve. */
  missingFontKey?: string | null;
  // ---- /STREAM-G ----
  /** Compositions: add the chosen layout's companion blocks around the selected text. */
  onApplyComposition?: (selection: CompositionSelection) => void;
  onCreateVerse?: (lines: string[], layout: VerseLayout) => void;
  onJustifyVerse?: (overrides?: Partial<VerseSettings>) => void;
  isJustifyingVerse?: boolean;
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
  onAddMirrorBlock?: () => void;
  /** Exactly one block is selected and it is not itself a mirror. */
  canAddMirrorBlock?: boolean;
  /** Moves the selection to the selected mirror's source, so it can be edited. */
  onSelectMirrorSource?: () => void;
  /** What to call that source in the Mirror panel. */
  mirrorSourceLabel?: string;
  kashidaSlotOrdinal?: number;
  onSelectKashidaSlot?: (ordinal: number) => void;
  onSetKashidaAtSlot?: (slot: KashidaSlot, count: number) => void;
  /**
   * Only what the user typed. Deliberately *not* the effective target: the
   * input shows this, so clearing the field leaves it cleared instead of
   * snapping the page's value straight back into the box.
   */
  fitTargetOverride?: number | null;
  /** The page's margin-box width, shown as the placeholder. Null in freeform. */
  fitTargetPageDefault?: number | null;
  isFittingWidth?: boolean;
  onChangeFitTargetWidth?: (width: number | null) => void;
  onFitToWidth?: (target: number) => void;
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
  /** Guides — see .claude/rules/guides.md. */
  onAddGuide?: (shape: GuideShape) => void;
  onAddSvgGuide?: (pathData: string) => void;
  onUpdateGuideParams?: (params: GuideParams) => void;
  onAddTextToGuide?: () => void;
  onAttachToGuide?: (guideId: number) => void;
  onDetachFromGuide?: () => void;
  onUpdateGuideAttachment?: (patch: Partial<GuideAttachment>) => void;
  /** Renderer-measured shrink per attached text; never saved. */
  guideShrink?: ReadonlyMap<number, number>;
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
  onToggleStrokeCutMode?: (blockId: number) => void;
  onClearStrokeCuts?: (blockId: number) => void;
  onToggleDetachedMarkMode?: (blockId: number) => void;
  onClearDetachedMarks?: (blockId: number) => void;
  /** Next Shape: discovery for the selected block, and the last letter clicked. */
  glyphAlternatesState?: GlyphAlternatesState;
  alternateTarget?: AlternateTarget | null;
  onToggleGlyphAlternateMode?: (blockId: number) => void;
  onResetGlyphAlternates?: (blockId: number) => void;
  onPickGlyphAlternate?: (blockId: number, letter: number, choice: AlternateChoice | null) => void;
  /** The font's style sets that change the selected block's text. */
  styleSetsState?: StyleSetsState;
  onToggleStyleSet?: (blockId: number, tag: string) => void;
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
  textStyles = [],
  selectedTextStyleId = "",
  onSelectTextStyle,
  onApplyTextStyle,
  newTextStyleName = "",
  onChangeNewTextStyleName,
  onSaveTextStyle,
  onDeleteTextStyle,
  palettes = [],
  selectedPaletteId = "",
  onSelectPalette,
  onPickPaletteColor,
  onSavePaletteFromCanvas,
  onDeletePalette,
  canDeletePalette = false,
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
  customFonts = [],
  fontChoices = [],
  onAddCustomFont,
  onConvertToStack,
  onEditStack,
  onRemoveCustomFont,
  missingFontKey = null,
  // ---- /STREAM-G ----
  onApplyComposition,
  onCreateVerse,
  onJustifyVerse,
  isJustifyingVerse,
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
  kashidaSlotOrdinal = 0,
  onSelectKashidaSlot,
  onSetKashidaAtSlot,
  fitTargetOverride = null,
  fitTargetPageDefault = null,
  isFittingWidth = false,
  onChangeFitTargetWidth,
  onFitToWidth,
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
  onAddGuide,
  onAddSvgGuide,
  onUpdateGuideParams,
  onAddTextToGuide,
  onAttachToGuide,
  onDetachFromGuide,
  onUpdateGuideAttachment,
  guideShrink,
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
  onToggleStrokeCutMode,
  onClearStrokeCuts,
  onToggleDetachedMarkMode,
  onClearDetachedMarks,
  glyphAlternatesState,
  alternateTarget,
  onToggleGlyphAlternateMode,
  onResetGlyphAlternates,
  onPickGlyphAlternate,
  styleSetsState,
  onToggleStyleSet,
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
  const [showEffects, setShowEffects] = useState(false);
  const [effectsTab, setEffectsTab] = useState<"outline" | "shadow">("outline");
  const [showFont, setShowFont] = useState(true);
  const [showContent, setShowContent] = useState(true);
  const [showVerse, setShowVerse] = useState(true);
  const [showGuide, setShowGuide] = useState(true);
  const [showStack, setShowStack] = useState(true);

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
                <PracticeSheetButton block={selectedIds.length > 1 ? undefined : selectedBlock} />

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

        <BlockControlsPanel
          selectedBlock={selectedBlock}
          onAddBlock={onAddBlock}
          onAddShapeFillBlock={onAddShapeFillBlock}
          onAddTextPathBlock={onAddTextPathBlock}
          onAddGuide={onAddGuide}
          onAddSvgGuide={onAddSvgGuide}
          onAddMirrorBlock={onAddMirrorBlock}
          canAddMirrorBlock={canAddMirrorBlock}
          onDuplicateBlock={onDuplicateBlock}
          onDeleteBlock={onDeleteBlock}
          onUndo={onUndo}
          onRedo={onRedo}
          canUndo={canUndo}
          canRedo={canRedo}
          historyEntries={historyEntries}
          onJumpToHistory={onJumpToHistory}
          onCaptureCurrentThumbnail={onCaptureCurrentThumbnail}
          onCreateVerse={onCreateVerse}
          isJustifyingVerse={isJustifyingVerse}
        />

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

        {/* Font comes first: picking a face is the decision everything else
            in this tier is styled around. Hidden where the block has no font
            of its own — a mirror draws its source, a guide is a path, and a
            stacked composition is a bake nothing re-shapes. */}
        {selectedBlock && hasOwnFont(selectedBlock) && (
          <FontPanel
            id={makeId("font-family", selectedId)}
            text={selectedText}
            value={selectedBlock.fontFamily}
            fonts={fontChoices}
            missingFontKey={missingFontKey}
            customFonts={customFonts}
            onChange={(v) => onUpdateSelectedBlock({ fontFamily: v })}
            onAddCustomFont={onAddCustomFont}
            onRemoveCustomFont={onRemoveCustomFont}
            isOpen={showFont}
            onToggle={() => setShowFont((v) => !v)}
          />
        )}

        {/* A mirror has no content or typography of its own — both come from
            its source — so it hides these two panels. */}
        {selectedBlock && hasOwnFont(selectedBlock) && (
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

                {/* Compositions: set this block's text into a pair, a
                    medallion or a frame. Plain text only — a Shape Fill run is
                    scaled to its silhouette and a Curve run to its curve, so the
                    measured run these layouts space themselves by is
                    meaningless there, the same reason Fit to width is
                    text-only. */}
                {selectedBlock?.type === "text" && onApplyComposition && (
                  <CompositionButton
                    text={selectedText}
                    cssFamily={
                      fontChoices.find((f) => f.value === selectedBlock.fontFamily)?.cssFamily ??
                      `'${selectedBlock.fontFamily}'`
                    }
                    onApply={onApplyComposition}
                  />
                )}

                {selectedBlock.type === "text" && onConvertToStack && (
                  <button
                    type="button"
                    className="sidebarSmallAction"
                    aria-label="Convert to stacked composition"
                    title="Bake the letters into movable pieces joined by curves. One-way; undo restores the text."
                    onClick={onConvertToStack}
                  >
                    Convert to stacked composition
                  </button>
                )}

                {/* Bend this block along a guide on the canvas. It becomes a
                    Curve block; the picker lists only the guides that exist. */}
                {selectedBlock?.type === "text" && onAttachToGuide && guidesIn(blocks).length > 0 && (
                  <SelectRow
                    id={makeId("attach-to-guide", selectedId)}
                    name={makeId("attachToGuide", selectedId)}
                    label="Attach to guide"
                    value=""
                    onChange={(v) => {
                      if (v !== "") onAttachToGuide(Number(v));
                    }}
                  >
                    <option value="">Choose a guide…</option>
                    {guidesIn(blocks).map((g) => (
                      <option key={g.id} value={String(g.id)}>
                        {g.name ?? `Guide · ${GUIDE_SHAPE_LABELS[g.guideShape]}`}
                      </option>
                    ))}
                  </SelectRow>
                )}


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

                {selectedBlock &&
                  supportsDiacriticOverrides(selectedBlock) &&
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
                  collapsible
                />

                <PresetKeyboard
                  title="Specials"
                  rows={[SPECIALS.slice(0, 6), SPECIALS.slice(6)]}
                  onPick={handleKeyboardKey}
                  collapsible
                />

                <PresetKeyboard
                  title="Urdu-Farsi Characters"
                  rows={[PERSIAN, URDU]}
                  onPick={handleKeyboardKey}
                  collapsible
                />
              </div>
            </CollapsibleSection>
          </div>
        )}

        {/* A verse line is an ordinary text block, so this sits under Content
            the way a type panel does — it is what that line has that others
            don't. See .claude/rules/verse.md. */}
        {selectedBlock?.type === "text" && selectedBlock.verse && onJustifyVerse && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Verse" isOpen={showVerse} onToggle={() => setShowVerse((v) => !v)}>
              <VersePanel
                verse={selectedBlock.verse}
                busy={!!isJustifyingVerse}
                onJustify={onJustifyVerse}
              />
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type === "mirror" && (
          <MirrorPanel
            selectedBlock={selectedBlock}
            mirrorSourceLabel={mirrorSourceLabel}
            onSelectMirrorSource={onSelectMirrorSource}
            onUpdateSelectedBlock={onUpdateSelectedBlock}
            isOpen={showText}
            onToggle={() => setShowText((v) => !v)}
          />
        )}

        {selectedBlock && selectedBlock.type === "shapeFill" && (
          <ShapeFillPanel
            selectedBlock={selectedBlock}
            isMobile={isMobile}
            onUpdateSelectedBlock={onUpdateSelectedBlock}
            onToggleDiacriticEditMode={onToggleDiacriticEditMode}
            onFitShapeFillSpacing={onFitShapeFillSpacing}
            isOpen={showText}
            onToggle={() => setShowText((v) => !v)}
          />
        )}

        {selectedBlock?.type === "guide" && onUpdateGuideParams && onAddTextToGuide && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Guide" isOpen={showGuide} onToggle={() => setShowGuide((v) => !v)}>
              <GuidePanel
                guide={selectedBlock}
                texts={attachedTo(blocks, selectedBlock.id)}
                onParams={onUpdateGuideParams}
                onAddText={onAddTextToGuide}
                onSelect={(id) => onSelectBlock(id)}
                onToggleEdit={() => onUpdateSelectedBlock({ guideEditMode: !selectedBlock.guideEditMode })}
                onRotation={(v) => onUpdateSelectedBlock({ rotation: v })}
              />
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock?.type === "stack" && onEditStack && (
          <div className="sidebarPanel">
            <CollapsibleSection title="Stacked composition" isOpen={showStack} onToggle={() => setShowStack((v) => !v)}>
              <StackPanel block={selectedBlock} onEdit={onEditStack} />
            </CollapsibleSection>
          </div>
        )}

        {selectedBlock && selectedBlock.type === "textPath" && (
          <CurvePanel
            selectedBlock={selectedBlock}
            onUpdateSelectedBlock={onUpdateSelectedBlock}
            onDetachFromGuide={onDetachFromGuide}
            onUpdateGuideAttachment={onUpdateGuideAttachment}
            guideShrink={guideShrink}
            isOpen={showText}
            onToggle={() => setShowText((v) => !v)}
          />
        )}

        {selectedBlock && selectedBlock.type !== "mirror" && selectedBlock.type !== "guide" && (
          <TypographyPanel
            selectedBlock={selectedBlock}
            onUpdateSelectedBlock={onUpdateSelectedBlock}
            textStyles={textStyles}
            selectedTextStyleId={selectedTextStyleId}
            onSelectTextStyle={onSelectTextStyle}
            onApplyTextStyle={onApplyTextStyle}
            newTextStyleName={newTextStyleName}
            onChangeNewTextStyleName={onChangeNewTextStyleName}
            onSaveTextStyle={onSaveTextStyle}
            onDeleteTextStyle={onDeleteTextStyle}
            palettes={palettes}
            selectedPaletteId={selectedPaletteId}
            onSelectPalette={onSelectPalette}
            onPickPaletteColor={onPickPaletteColor}
            onSavePaletteFromCanvas={onSavePaletteFromCanvas}
            onDeletePalette={onDeletePalette}
            canDeletePalette={canDeletePalette}
            kashidaSlotOrdinal={kashidaSlotOrdinal}
            onSelectKashidaSlot={onSelectKashidaSlot}
            onSetKashidaAtSlot={onSetKashidaAtSlot}
            fitTargetOverride={fitTargetOverride}
            fitTargetPageDefault={fitTargetPageDefault}
            isFittingWidth={isFittingWidth}
            onChangeFitTargetWidth={onChangeFitTargetWidth}
            onFitToWidth={onFitToWidth}
            styleSetsState={styleSetsState}
            onToggleStyleSet={onToggleStyleSet}
            glyphAlternatesState={glyphAlternatesState}
            alternateTarget={alternateTarget}
            onToggleGlyphAlternateMode={onToggleGlyphAlternateMode}
            onResetGlyphAlternates={onResetGlyphAlternates}
            onPickGlyphAlternate={onPickGlyphAlternate}
            onToggleStrokeCutMode={onToggleStrokeCutMode}
            onClearStrokeCuts={onClearStrokeCuts}
            onToggleDetachedMarkMode={onToggleDetachedMarkMode}
            onClearDetachedMarks={onClearDetachedMarks}
            isOpen={showText}
            onToggle={() => setShowText((v) => !v)}
          />
        )}

        {selectedBlock && selectedBlock.type !== "guide" && (
          <EffectsPanel
            selectedBlock={selectedBlock}
            isMobile={isMobile}
            onUpdateSelectedBlock={onUpdateSelectedBlock}
            blockFill={blockFill}
            blockColor={blockColor}
            onSetBlockFill={onSetBlockFill}
            fillPresets={fillPresets}
            effectsTab={effectsTab}
            setEffectsTab={setEffectsTab}
            isOpen={showEffects}
            onToggle={() => setShowEffects((v) => !v)}
          />
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