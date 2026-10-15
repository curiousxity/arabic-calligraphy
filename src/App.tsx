import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import type Konva from "konva";
import { Sidebar, type SidebarProps } from "./components/Sidebar";
import { CanvasStage, type CanvasStageProps } from "./components/CanvasStage";
import { ConfirmDialog, type ConfirmDialogRequest } from "./components/ConfirmDialog";
import { StartScreen } from "./components/StartScreen";
import { shouldShowStartScreen, STARTER_TEXT } from "./lib/startScreen";
import { fontChoicesWith } from "./lib/fontCatalog";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useDebouncedHistoryPush } from "./hooks/useDebouncedHistoryPush";
import { useExport } from "./hooks/useExport";
import { isTypingTarget } from "./lib/dom";
import { installTestBridge } from "./lib/testBridge";
import { triggerDownload } from "./lib/download";
import { STARTER_TEMPLATES, buildBlocksFromTemplate } from "./lib/templates";
import { FONT_URLS, resolveFontUrl } from "./hooks/useShapedGlyphs";
import {
  MIN_SCALE,
  MAX_SCALE,
  getBlocksBoundingBox,
  padBox,
  computeFitToBox,
  DEFAULT_EMPTY_BOUNDS,
} from "./lib/canvasBounds";
import {
  supportsDiacriticOverrides,
  supportsGlyphAlternates,
  supportsStrokeCuts,
  supportsStyleSets,
  isStackBlock,
  supportsDetachedMarks,
  hasOwnFont,
} from "./lib/blockCapabilities";
import { useGlyphAlternates, useStyleSets } from "./hooks/useGlyphAlternates";
import {
  activeStyleSets,
  alternatesKey,
  charAtLetter,
  setAlternate,
  type AlternateChoice,
  type AlternateTarget,
} from "./lib/glyphAlternates";
import { arcPathD } from "./lib/textPath";
import { GUIDE_DEFAULTS, containerPolygon, guidePathD, svgGuidePathD, uploadedGuideSource } from "./lib/guideShapes";
import { arrangeStackInShape, type FillerShape } from "./lib/stackArrange";
import { parseSvgPath } from "./lib/svgPath";
import {
  attachTextToGuide,
  deleteBlocksDetachingGuides,
  detachFromGuide,
  dropOrphanedAttachments,
  hasOrphanedAttachments,
  newAttachedText,
  reorderDetachingGuides,
  syncAttachedToGuides,
  ATTACHED_TEXT_FONT_SIZE,
  type WritingSession,
} from "./lib/guides";
import { DEFAULT_ATTACHMENT } from "./lib/guidePlacement";
import type { GuideAttachment, GuideBlock, GuideParams, GuideShape } from "./types";
import type { Block, DiacriticOverride, DetachedMarkOverride, StackBlock, StrokeCut } from "./types";
import type { Session } from "@supabase/supabase-js";
import {
  isCloudConfigured,
  signInWithEmail,
  signOut as cloudSignOut,
  getSession,
  onAuthStateChange,
  saveCloudProject,
  listCloudProjects,
  loadCloudProject,
  deleteCloudProject,
} from "./lib/cloudProjects";
// Appended at the end of the import block on purpose (2026-08-12 parallel
// run); later parallel streams use the labeled import anchors below instead.
import {
  loadPresets as loadExportPresets,
  savePresets as saveExportPresets,
  upsertPreset as upsertExportPreset,
  removePreset as removeExportPreset,
  type ExportPreset,
  type ExportFormat,
} from "./lib/exportPresets";
// ---- STREAM-E: styles & palettes — imports ----
import {
  captureStyle,
  styleToPatch,
  loadStyles,
  saveStyles,
  upsertStyle,
  removeStyle,
  type TextStyle,
} from "./lib/textStyles";
import {
  allPalettes,
  loadPalettes,
  savePalettes,
  upsertPalette,
  removePalette,
  DEFAULT_PALETTES,
  MAX_PALETTE_COLORS,
  type Palette,
} from "./lib/palettes";
// ---- /STREAM-E ----
// ---- STREAM-F: ink & surface — imports ----
import { GOLD_PRESETS, type BlockFill } from "./lib/blockFill";
import {
  NO_SURFACE,
  TEXTURES,
  getTexture,
  readArtboardSurface,
  textureTileUrl,
  type ArtboardSurface,
} from "./data/textures";
// ---- /STREAM-F ----
// ---- STREAM-G: font upload — imports ----
import {
  addCustomFont,
  describeFontKey,
  isFontUnavailable,
  listCustomFonts,
  primeCustomFonts,
  removeCustomFont,
  type CustomFont,
} from "./lib/customFonts";
// ---- /STREAM-G ----
import {
  DEFAULT_CUSTOM_ARTBOARD,
  artboardRect,
  clampMargin,
  marginRect,
  configFromPreset,
  findArtboardPreset,
  isArtboardConfig,
  withDpi,
  withOrientation,
  withSize,
  type ArtboardConfig,
  type ArtboardUnit,
} from "./lib/artboard";
import {
  buildMirrorBlock,
  dropOrphanedMirrors,
  hasOrphanedMirrors,
  isMirrorSourceCandidate,
} from "./lib/mirror";
import { applyKashida, findKashidaSlots, readKashida, type KashidaSlot } from "./lib/tatweel";
import { runStyleForBlock, solveFitToWidth, type FitToWidthResult } from "./lib/fitToWidth";
import { measureShapedRun, measureShapedWidth } from "./lib/measureShapedText";
import { applySpacing, spacingForBlock } from "./lib/spacing";
import { layoutVerse, verseAnchor, DEFAULT_LINE_GAP, DEFAULT_COLUMN_GAP } from "./lib/verseLayout";
import {
  justifyLine,
  naturalWidth,
  baseFontSizeForLine,
  baseSpacingForLine,
  describeVerseResult,
  type JustifyLineResult,
  type LineMeasure,
} from "./lib/verseJustify";
import type { TextBlock, VerseLayout, VerseSettings } from "./types";
import { buildCutPlan, cutAdvanceTotal, outlineBounds, remapCutsForEdits } from "./lib/strokeCuts";
import { remapMarksForEdits } from "./lib/detachedMarks";
import { nibFloorFraction, nuqtaUnits } from "./lib/nuqta";
import { shapeText } from "./lib/harfbuzz";
import { convertRunToStack, splitPieceAtCut, fillerShapes, teardropShape, bendCurveAt, type UnjoinedPair } from "./lib/stackConvert";
import type { CurveTrace } from "./lib/stackCurve";
import { assembleStackOutline } from "./lib/stackOutline";
import { isOverrideGlyphChar } from "./lib/glyphOverrides";
import { sanitizeLegacyBlocks } from "./lib/legacySaves";
import {
  buildComposition,
  describeComposition,
  estimateRunBox,
  normalizeRunBox,
  type CompositionSelection,
} from "./lib/composition";

/**
 * The status-row line for a finished fit. Each outcome says what actually
 * happened rather than a bare "done" — "already-wider" in particular is not
 * a failure, and the user needs to know the run cannot be narrowed by
 * kashida alone.
 */
function describeFitResult(
  result: FitToWidthResult,
  target: number,
  originalText: string
): string {
  const width = Math.round(result.width);
  const goal = Math.round(target);
  switch (result.reason) {
    case "no-slots":
      return "No stretchable joins in this text — a kashida needs two letters that join.";
    case "already-wider":
      // This branch does return the run with every kashida stripped, which is
      // the narrowest it can be made — but that silently discards kashida the
      // user set by hand, so when it happens the message has to say so rather
      // than reading as "nothing was done".
      return result.text !== originalText
        ? `Removed the existing kashida, but the text is still ${width}px — fitting into ${goal}px needs a smaller font size.`
        : `Already ${width}px with no kashida — fitting into ${goal}px needs a smaller font size.`;
    case "capped":
      return `Every join stretched to its limit — ${width}px of ${goal}px.`;
    default:
      return `Fitted to ${width}px of ${goal}px using ${result.total} kashida.`;
  }
}

const hslToHex = (h: number, s: number, l: number): string => {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) =>
    light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
};

const dissolveSingletonGroups = (list: Block[]): Block[] => {
  const counts = new Map<number, number>();
  for (const b of list) {
    if (b.groupId != null) counts.set(b.groupId, (counts.get(b.groupId) ?? 0) + 1);
  }
  return list.map((b) =>
    b.groupId != null && counts.get(b.groupId) === 1 ? { ...b, groupId: undefined } : b
  );
};

type EditorSnapshot = {
  blocks: Block[];
  backgroundColor: string;
  /** The page — a document property like the background colour, so undoable like one. */
  artboard: ArtboardConfig | null;
};

/**
 * A freshly-built block that hasn't been dropped onto the canvas yet — it
 * follows the cursor as a ghost (rendered by CanvasStage, never part of
 * `blocks`) until a click inside the canvas area commits it at that
 * position. `block.x`/`block.y` here track the raw cursor position; the
 * per-type placement convention (text is center-anchored, shape
 * blocks are top-left-anchored) is reconciled via commitOffsetX/Y only at
 * commit time.
 */
type PendingPlacement = {
  block: Block;
  width: number;
  height: number;
  commitOffsetX: number;
  commitOffsetY: number;
  label: string;
};

export type NamedProjectMeta = { name: string; savedAt: number; source: "local" | "cloud" };
type NamedProjectsStore = Record<string, { savedAt: number; payload: unknown }>;

const STORAGE_KEY = "calligraphy-layout-v2";
const NAMED_PROJECTS_KEY = "harfcanvas-named-projects-v1";
const SIDEBAR_COLLAPSED_WIDTH = 28;
/** Zoom level for the very first paint of the default starter content (a fresh session, no saved layout). */
const INITIAL_VIEW_SCALE = 2.75;
const DEFAULT_TEXT_FONT_SIZE = 53;
const DEFAULT_NEW_BLOCK_FONT_SIZE = 53;

const DEFAULT_BLOCK: Block = {
  id: 1,
  text: STARTER_TEXT,
  x: 0,
  y: 0,
  fontSize: DEFAULT_TEXT_FONT_SIZE,
  color: "#1e3a5f",
  fontFamily: "FatemiMaqala",
  fontStyle: "normal",
  align: "center",
  lineHeight: 1.2,
  opacity: 1,
  stroke: "#000000",
  strokeWidth: 0,
  shadowColor: "#000000",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0.35,
  locked: false,
  rotation: 0,
  type: "text",
};

const isBrowser = typeof window !== "undefined";

/**
 * Width a block's straight-stroke cuts add to its drawn run.
 *
 * Shaping cannot see cuts — they are geometry, not characters — so every
 * measurement of a block's drawn width has to add them back. One nuqta at the
 * block's own `fontSize` is the px-space unit, matching the space
 * `inkExtentBox` reports in. It lives here rather than in `fitToWidth.ts`
 * because summing them needs the nuqta table that module deliberately keeps
 * out; `runStyleForBlock` takes the result as a required argument.
 */
const cutWidthForBlock = (block: Block): number =>
  cutAdvanceTotal(block.strokeCuts ?? [], nuqtaUnits(block.fontFamily, block.fontSize));

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const App: React.FC = () => {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmDialogRequest | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [showStart, setShowStart] = useState(() => {
    if (!isBrowser) return false;
    // Touching the `localStorage` global can itself throw when site data is
    // blocked (see textStyles.ts); shouldShowStartScreen guards the read.
    try {
      return shouldShowStartScreen(localStorage, STORAGE_KEY);
    } catch {
      return true;
    }
  });
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [showRulers, setShowRulers] = useState(false);
  const [guides, setGuides] = useState<{ horizontal: number[]; vertical: number[] }>({
    horizontal: [],
    vertical: [],
  });
  const [transparentExport, setTransparentExport] = useState(true);

  // Parallel-stream insertion points — see docs/superpowers/specs/
  // PARALLEL-PHASE-2.md. Each stream adds its state only between its own
  // anchors, so independent branches merge into this file without
  // overlapping hunks.
  // ---- STREAM-E: styles & palettes — state ----
  // Both stores are local-only and are *not* document state: they never enter
  // the layout payload, the undo snapshot, or the Supabase project store —
  // exactly the choice `exportPresets` already makes. Applying a style is
  // undoable (it edits blocks); managing the lists is not.
  const [textStyles, setTextStyles] = useState<TextStyle[]>(() => loadStyles());
  const [selectedTextStyleId, setSelectedTextStyleId] = useState("");
  const [newTextStyleName, setNewTextStyleName] = useState("");
  const [userPalettes, setUserPalettes] = useState<Palette[]>(() => loadPalettes());
  const [selectedPaletteId, setSelectedPaletteId] = useState(DEFAULT_PALETTES[0].id);
  // ---- /STREAM-E ----
  // ---- STREAM-F: ink & surface — state ----
  // The page's paper. Kept *out* of ArtboardConfig deliberately: a surface is
  // a look, and `null` freeform pages get one too, so it is not a property of
  // "there is a page". Saved with the document; not in the undo snapshot,
  // which this stream's anchors do not reach.
  // A new document opens on bare paper — the flat background colour, no
  // texture. A surface is a deliberate choice the user makes, not something
  // a fresh canvas arrives already wearing.
  //
  // This reverses the 2026-08-20 interface pass, which opened on washi so the
  // first screen would not read as graph paper. That argument was about the
  // grid, and the same pass fixed the grid directly: it now draws as a
  // one-device-pixel hairline at any zoom instead of ~2.75px at the default
  // 275%. With the grid no longer shouting, the texture is not needed to
  // drown it out.
  //
  // The zoom caveat that picked washi over the others still holds and still
  // matters when choosing one: a surface is drawn in document space, so the
  // stage's scale magnifies its grain, and at 275% parchment's mottling and
  // laid-paper's chain lines smear into blotches that read as staining.
  //
  // Only the *default* moves. `readArtboardSurface` is unchanged, so a saved
  // project keeps whatever surface it was saved with — including washi.
  const [artboardSurface, setArtboardSurface] = useState<ArtboardSurface>(NO_SURFACE);
  // ---- /STREAM-F ----
  // ---- STREAM-G: font upload — state ----
  // The user's uploaded fonts. Not part of the document: a project references
  // a font by key and the bytes live in this browser, so this is neither
  // saved nor undoable — it is a property of the installation, like the
  // export presets.
  const [customFonts, setCustomFonts] = useState<CustomFont[]>([]);
  // Built-ins then uploads, for every surface that lists fonts: the start
  // screen here and, through the Sidebar, the strip and the picker dialog.
  const fontChoices = useMemo(() => fontChoicesWith(customFonts), [customFonts]);
  // Whether the shared status row is currently showing *this* stream's
  // unavailable-font notice, so clearing it can never wipe an export result.
  const fontNoticeShownRef = useRef(false);
  // ---- /STREAM-G ----
  // `null` is freeform — no page, exactly the behaviour that predates this
  // feature, and what every save written before it loads as. Part of the
  // document (saved, and in the undo snapshot) rather than of the view.
  const [artboard, setArtboard] = useState<ArtboardConfig | null>(null);
  // Whether an export crops overhanging ink at the page edge. A view/export
  // preference, not a document property — deliberately not saved, like the
  // transparency and scale controls beside it.
  const [clipToPage, setClipToPage] = useState(true);
  // Which slot the Kashida stepper is pointed at, as an *ordinal* into
  // `findKashidaSlots`' list rather than a text offset: inserting tatweels
  // shifts every later offset but never reorders or renumbers the slots, so
  // the ordinal survives the edit the stepper itself makes. The Sidebar
  // clamps it against the current slot count, which is what makes an
  // arbitrary text edit (or a different block) safe rather than out of range.
  const [kashidaSlotOrdinal, setKashidaSlotOrdinal] = useState(0);

  // Snap a dragged block's visible edges and centres, not just its origin.
  // Session-only, like the grid toggle beside it — deliberately not persisted.
  const [snapToBlockEdges, setSnapToBlockEdges] = useState(true);
  // Presets are read once at mount; they live in this browser only, never in
  // a saved project or the cloud store.
  const [exportPresets, setExportPresets] = useState<ExportPreset[]>(() =>
    loadExportPresets()
  );
  const [selectedExportPresetId, setSelectedExportPresetId] = useState("");
  const [exportScale, setExportScale] = useState(2);
  const [exportFormats, setExportFormats] = useState<ExportFormat[]>([
    "png",
    "jpeg",
    "svg",
    "pdf",
  ]);
  const [newExportPresetName, setNewExportPresetName] = useState("");
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const [localProjects, setLocalProjects] = useState<NamedProjectMeta[]>(() => {
    if (!isBrowser) return [];
    try {
      const raw = localStorage.getItem(NAMED_PROJECTS_KEY);
      if (!raw) return [];
      const store = JSON.parse(raw) as NamedProjectsStore;
      return Object.entries(store)
        .map(([name, entry]) => ({ name, savedAt: entry.savedAt, source: "local" as const }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  });
  const [session, setSession] = useState<Session | null>(null);
  const [cloudProjects, setCloudProjects] = useState<NamedProjectMeta[]>([]);
  const [saveDestination, setSaveDestination] = useState<"local" | "cloud">("local");
  const cloudConfigured = isCloudConfigured();

  // Incremented at the start of every refreshCloudProjects() call; a slow
  // listCloudProjects() resolving after the user has since signed out (or
  // into a different account) checks its captured generation against this
  // ref and drops the stale result instead of repopulating state with it.
  const cloudProjectsRequestRef = useRef(0);

  const refreshCloudProjects = useCallback(async () => {
    const generation = ++cloudProjectsRequestRef.current;
    if (!session) {
      setCloudProjects([]);
      return;
    }
    const list = await listCloudProjects();
    if (cloudProjectsRequestRef.current !== generation) return;
    setCloudProjects(list.map((p) => ({ ...p, source: "cloud" as const })));
  }, [session]);

  useEffect(() => {
    if (!cloudConfigured) return;
    let cancelled = false;
    getSession().then((s) => {
      if (!cancelled) setSession(s);
    });
    const unsubscribe = onAuthStateChange((s) => {
      setSession(s);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [cloudConfigured]);

  useEffect(() => {
    refreshCloudProjects();
  }, [refreshCloudProjects]);

  // Covers externally-triggered sign-outs too (token expiry, another tab
  // signing out) — not just the in-app Sign out button, which also resets
  // this directly in handleSignOut.
  useEffect(() => {
    if (!session) setSaveDestination("local");
  }, [session]);

  const namedProjects = useMemo<NamedProjectMeta[]>(
    () => [...localProjects, ...cloudProjects].sort((a, b) => b.savedAt - a.savedAt),
    [localProjects, cloudProjects]
  );

  const [isMobile, setIsMobile] = useState(isBrowser ? window.innerWidth <= 768 : false);
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(isBrowser ? window.innerWidth : 1200);
  const [viewportHeight, setViewportHeight] = useState(isBrowser ? window.innerHeight : 800);

  const effectiveSidebarWidth = isMobile
    ? viewportWidth
    : sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : Math.min(Math.max(sidebarWidth, 220), Math.max(260, viewportWidth - 260));

  const mobileSidebarBudget = Math.min(viewportHeight * 0.45, 420);
  const stageViewportHeight = isMobile
    ? Math.max(240, viewportHeight - mobileSidebarBudget)
    : viewportHeight;

  const initialFit = computeFitToBox(
    Math.max(1, isBrowser ? window.innerWidth - 320 : 880),
    isBrowser ? window.innerHeight : 800,
    DEFAULT_EMPTY_BOUNDS,
    0
  );

  const [stageScale, setStageScale] = useState(initialFit.scale);
  const [stagePosition, setStagePosition] = useState(initialFit.position);

  const [blocks, setBlocks] = useState<Block[]>(() => [
    {
      ...DEFAULT_BLOCK,
      x: 0,
      y: 0,
    },
  ]);

  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(320);
  const nextIdRef = useRef(2);
  const nextGroupIdRef = useRef(1);
  const clipboardRef = useRef<Block | null>(null);
  const [editRequestSignal, setEditRequestSignal] = useState(0);
  const didHydrateLayoutRef = useRef(false);
  const prevViewportRef = useRef({ w: 0, h: 0 });

  const selectedBlock = useMemo(
    () => (selectedId == null ? undefined : blocks.find((b) => b.id === selectedId)),
    [blocks, selectedId]
  );

  // Next Shape: discovery runs only for the selected text block, and only
  // while its tool is armed. The last letter clicked is UI state, not
  // document state — it is neither saved nor undoable.
  const alternateBlock =
    selectedBlock && supportsGlyphAlternates(selectedBlock) && selectedBlock.glyphAlternateMode
      ? selectedBlock
      : null;
  const glyphAlternatesState = useGlyphAlternates(
    alternateBlock?.text ?? "",
    alternateBlock?.fontFamily ?? "",
    alternateBlock?.glyphAlternates,
    alternateBlock !== null,
    alternateBlock?.styleSets
  );
  // The style-set toggles are probed whenever a block that can carry them is
  // selected: one shaping pass per set, cheap enough not to need arming.
  const styleSetsBlock =
    selectedBlock && supportsStyleSets(selectedBlock) ? selectedBlock : null;
  const styleSetsState = useStyleSets(
    styleSetsBlock?.text ?? "",
    styleSetsBlock?.fontFamily ?? "",
    styleSetsBlock !== null
  );
  const [alternateTarget, setAlternateTarget] = useState<AlternateTarget | null>(null);

  const canvasWidth = isMobile
    ? viewportWidth
    : Math.max(0, viewportWidth - effectiveSidebarWidth);

  const effectiveSelectedIds = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : selectedId != null ? [selectedId] : []),
    [selectedIds, selectedId]
  );

  // STREAM-P (e2e test bridge). Dev-only, no-op in production builds — see
  // lib/testBridge.ts. Re-installed whenever the values it exposes change,
  // which is cheaper and less error-prone than threading them through refs.
  useEffect(
    () =>
      installTestBridge({
        getBlocks: () => blocks,
        getSelectedIds: () => effectiveSelectedIds,
        getStage: () => stageRef.current,
      }),
    [blocks, effectiveSelectedIds]
  );

  const selectBlock = useCallback(
    (id: number | null, additive = false) => {
      if (id == null || !additive) {
        setSelectedIds([]);
        setSelectedId(id);
        return;
      }
      setSelectedIds((prev) => {
        const base = prev.length > 0 ? prev : selectedId != null ? [selectedId] : [];
        return base.includes(id) ? base.filter((x) => x !== id) : [...base, id];
      });
      setSelectedId(id);
    },
    [selectedId]
  );

  const getSnapshot = useCallback(
    (): EditorSnapshot => ({ blocks, backgroundColor, artboard }),
    [blocks, backgroundColor, artboard]
  );

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setBlocks(snapshot.blocks);
    setBackgroundColor(snapshot.backgroundColor);
    setArtboard(snapshot.artboard);
  }, []);

  /**
   * Rasterizes the live stage at low resolution for history thumbnails.
   * No grid/background hiding (unlike useExport's toDataURL calls) — this
   * is a cheap approximate preview, not export-quality output.
   */
  const captureHistoryThumbnail = useCallback(() => {
    try {
      return stageRef.current?.toDataURL({ pixelRatio: 0.15 }) ?? "";
    } catch {
      return "";
    }
  }, []);

  const { pushHistory, handleUndo, handleRedo, jumpBy, canUndo, canRedo, historyEntries } =
    useUndoRedo(getSnapshot, applySnapshot, captureHistoryThumbnail);

  const scheduleMoveHistoryPush = useDebouncedHistoryPush(pushHistory);

  const dragDiacriticOverride = useCallback(
    (blockId: number, glyphIndex: number, patch: Partial<DiacriticOverride>) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsDiacriticOverrides(b)) return b;
          const existing = (b.diacriticOverrides ?? []).find((o) => o.glyphIndex === glyphIndex);
          const nextOverrides = existing
            ? (b.diacriticOverrides ?? []).map((o) =>
                o.glyphIndex === glyphIndex ? { ...o, ...patch } : o
              )
            : [...(b.diacriticOverrides ?? []), { glyphIndex, ...patch }];
          return { ...b, diacriticOverrides: nextOverrides };
        })
      );
      // No push here: the handle's drag start already took one through
      // `onBeginDiacriticDrag`, so a drag is one undo step however long it
      // pauses midway.
    },
    []
  );

  const toggleDiacriticHidden = useCallback(
    (blockId: number, glyphIndex: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsDiacriticOverrides(b)) return b;
          const existing = (b.diacriticOverrides ?? []).find((o) => o.glyphIndex === glyphIndex);
          const nextHidden = !(existing?.hidden ?? false);
          const nextOverrides = existing
            ? (b.diacriticOverrides ?? []).map((o) =>
                o.glyphIndex === glyphIndex ? { ...o, hidden: nextHidden } : o
              )
            : [...(b.diacriticOverrides ?? []), { glyphIndex, hidden: nextHidden }];
          return { ...b, diacriticOverrides: nextOverrides };
        })
      );
    },
    [pushHistory]
  );

  /**
   * Write one stroke cut, replacing any cut already at the same place on the
   * same letter. A cut of zero nuqta is a removal rather than a stored
   * no-op, so dragging a handle back to rest leaves the block clean.
   */
  const setStrokeCut = useCallback(
    (blockId: number, cut: StrokeCut) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsStrokeCuts(b)) return b;
          const rest = (b.strokeCuts ?? []).filter(
            (c) => !(c.cluster === cut.cluster && c.localX === cut.localX)
          );
          return { ...b, strokeCuts: cut.nuqta > 0 ? [...rest, cut] : rest };
        })
      );
      // No push here: the handle's drag start already took one through
      // `onBeginStrokeCut`, so a drag is a single undo entry however long it
      // pauses midway. A time-based debounce cannot tell a pause from a new
      // gesture, and recorded a mid-drag state as its own entry.
    },
    []
  );

  const setStackPieces = useCallback(
    (blockId: number, patches: { id: string; x?: number; y?: number; rotation?: number }[]) => {
      const byId = new Map(patches.map((p) => [p.id, p]));
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !isStackBlock(b)) return b;
          return { ...b, pieces: b.pieces.map((p) => { const q = byId.get(p.id); return q ? { ...p, ...q, id: p.id } : p; }) };
        })
      );
      // No push: the overlay's drag start took one through `onBeginStackEdit`.
    },
    []
  );

  const splitStackPiece = useCallback(
    (blockId: number, pieceId: string, cut: { cutX: number; angle: number }) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || !isStackBlock(block)) return null;
      const next = splitPieceAtCut(block.pieces, block.joins, pieceId, cut);
      if (!next) return null;
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId && isStackBlock(b) ? { ...b, pieces: next.pieces, joins: next.joins } : b))
      );
      // The cap is the piece the split appended; the overlay pulls it in the same gesture.
      const cap = next.pieces[next.pieces.length - 1];
      return { id: cap.id, x: cap.x, y: cap.y };
    },
    [blocks, pushHistory]
  );

  /** Free the curved stroke the hover traced and replace it with a join; the
   *  overlay bends that join in the same gesture. One history step for both. */
  const bendStackCurve = useCallback(
    (blockId: number, pieceId: string, trace: CurveTrace) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || !isStackBlock(block)) return null;
      const next = bendCurveAt(block.pieces, block.joins, pieceId, trace);
      if (!next) { setExportStatus("That curve could not be freed cleanly."); return null; }
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (b.id === blockId && isStackBlock(b) ? { ...b, pieces: next.pieces, joins: next.joins } : b))
      );
      setExportStatus("Curve freed; drag to bend, double-click to restore.");
      return next.joinId;
    },
    [blocks, pushHistory]
  );

  /** Editor preference, not block state: dragging a stack letter carries the letters after it. */
  const [stackMoveTogether, setStackMoveTogether] = useState(true);
  /** Editor preference, not block state: "Fill a guide shape" busies the gaps with tashkeel. */
  const [stackFillGaps, setStackFillGaps] = useState(true);

  const setStackJoinBow = useCallback((blockId: number, joinId: string, bend: { bow: number; depth: number }) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id !== blockId || !isStackBlock(b) ? b
          : { ...b, joins: b.joins.map((j) => (j.id === joinId ? { ...j, bow: bend.bow, depth: bend.depth } : j)) }
      )
    );
  }, []);

  const setDetachedMark = useCallback(
    (blockId: number, o: DetachedMarkOverride) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsDetachedMarks(b)) return b;
          const rest = (b.detachedMarkOverrides ?? []).filter(
            (m) => !(m.cluster === o.cluster && m.glyphId === o.glyphId && m.mark === o.mark)
          );
          const keep = o.dx !== 0 || o.dy !== 0;
          return { ...b, detachedMarkOverrides: keep ? [...rest, o] : rest };
        })
      );
      // No push: the drag start took one through `onBeginDetachedMarkDrag`.
    },
    []
  );

  const toggleDetachedMarkMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsDetachedMarks(b)
            ? { ...b, detachedMarkEditMode: !b.detachedMarkEditMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  const clearDetachedMarks = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsDetachedMarks(b) ? { ...b, detachedMarkOverrides: [] } : b
        )
      );
    },
    [pushHistory]
  );

  const toggleStrokeCutMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsStrokeCuts(b)
            ? { ...b, strokeCutEditMode: !b.strokeCutEditMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  const clearStrokeCuts = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsStrokeCuts(b) ? { ...b, strokeCuts: [] } : b
        )
      );
    },
    [pushHistory]
  );

  /** One discrete undo step per pick — no debounce, it is not a drag. */
  const pickGlyphAlternate = useCallback(
    (blockId: number, letter: number, choice: AlternateChoice | null) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || !supportsGlyphAlternates(block)) return;
      const char = charAtLetter(block.text, letter);
      if (char === null) return;
      setAlternateTarget({ blockId, letter, char });
      const next = setAlternate(block.glyphAlternates, letter, char, choice);
      if (alternatesKey(next) === alternatesKey(block.glyphAlternates)) return;
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphAlternates(b) ? { ...b, glyphAlternates: next } : b
        )
      );
    },
    [blocks, pushHistory]
  );

  const toggleGlyphAlternateMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphAlternates(b)
            ? { ...b, glyphAlternateMode: !b.glyphAlternateMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  /** Tick or untick one block-level style set — one undo step. */
  const toggleStyleSet = useCallback(
    (blockId: number, tag: string) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsStyleSets(b)) return b;
          const current = activeStyleSets(b.styleSets);
          const next = current.includes(tag)
            ? current.filter((t) => t !== tag)
            : activeStyleSets([...current, tag]).sort();
          return { ...b, styleSets: next };
        })
      );
    },
    [pushHistory]
  );

  const resetGlyphAlternates = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphAlternates(b) ? { ...b, glyphAlternates: [] } : b
        )
      );
    },
    [pushHistory]
  );

  const fitShapeFillSpacing = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type !== "shapeFill") return b;
          const shapeHeight = b.shapeHeight ?? 400;
          const fontSize = b.fontSize;
          const firstLineY = fontSize * 0.85;
          const available = Math.max(shapeHeight - firstLineY, fontSize);
          const currentLineH = fontSize * (b.shapeFillSpacing ?? 1.3);
          const numRows = Math.max(1, Math.round(available / currentLineH));
          const newSpacing = clamp(available / numRows / fontSize, 0.5, 4);
          return { ...b, shapeFillSpacing: newSpacing };
        })
      );
    },
    [pushHistory]
  );

  const updateBlockPositionWithHistory = useCallback(
    (id: number, x: number, y: number) => {
      setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)));
      scheduleMoveHistoryPush();
    },
    [scheduleMoveHistoryPush]
  );

  const updateTextPathD = useCallback(
    (id: number, d: string) => {
      setBlocks((prev) =>
        prev.map((b) => (b.id === id && b.type === "textPath" ? { ...b, textPathD: d } : b))
      );
      // No push here: `TextPathEditOverlay` calls `onBeginTextPathEdit`
      // before every edit — a drag's start, an anchor added or removed.
    },
    []
  );

  const zoomToRect = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, marginPx = 60) => {
      if (canvasWidth <= 0 || stageViewportHeight <= 0) return;
      const fit = computeFitToBox(canvasWidth, stageViewportHeight, rect, marginPx);
      setStageScale(fit.scale);
      setStagePosition(fit.position);
      setPanMode(false);
    },
    [canvasWidth, stageViewportHeight]
  );

  const resetView = useCallback(
    (targetBlocks: Block[] = blocks) => {
      const stage = stageRef.current;
      const box = stage ? getBlocksBoundingBox(stage, targetBlocks) : null;
      zoomToRect(padBox(box ?? DEFAULT_EMPTY_BOUNDS), 0);
    },
    [blocks, zoomToRect]
  );

  /**
   * Like `resetView`, but anchors the content's top edge near the top of the
   * viewport (7% down) instead of vertically centering it, and always zooms
   * to `INITIAL_VIEW_SCALE` rather than fitting content to the viewport —
   * used only for the very first paint of the default starter content, not
   * general "fit all content" (that's what the toolbar's Reset View button
   * and `resetView` are for).
   */
  const fitInitialView = useCallback(
    (targetBlocks: Block[]) => {
      if (canvasWidth <= 0 || stageViewportHeight <= 0) return;
      const stage = stageRef.current;
      const box = stage ? getBlocksBoundingBox(stage, targetBlocks) : null;
      const b = padBox(box ?? DEFAULT_EMPTY_BOUNDS);
      setStageScale(INITIAL_VIEW_SCALE);
      setStagePosition({
        x: canvasWidth / 2 - (b.x + b.width / 2) * INITIAL_VIEW_SCALE,
        y: stageViewportHeight * 0.07 - b.y * INITIAL_VIEW_SCALE,
      });
      setPanMode(false);
    },
    [canvasWidth, stageViewportHeight]
  );

  // No pushHistory: the start screen precedes the first edit, and undo
  // should not reopen it.
  const beginFromStart = (text: string, fontFamily: string) => {
    const next: Block[] = [{ ...DEFAULT_BLOCK, id: 1, text, fontFamily }];
    setBlocks(next);
    setSelectedIds([]);
    setSelectedId(1);
    setShowStart(false);
    fitInitialView(next);
  };

  const zoomToActualSize = useCallback(() => {
    if (canvasWidth <= 0 || stageViewportHeight <= 0) return;
    const stage = stageRef.current;
    const box = stage ? getBlocksBoundingBox(stage, blocks) : null;
    const b = padBox(box ?? DEFAULT_EMPTY_BOUNDS);
    setStageScale(1);
    setStagePosition({
      x: canvasWidth / 2 - (b.x + b.width / 2),
      y: stageViewportHeight / 2 - (b.y + b.height / 2),
    });
    setPanMode(false);
  }, [blocks, canvasWidth, stageViewportHeight]);

  useEffect(() => {
    if (!isBrowser) return;
    const handleResize = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
      setIsMobile(window.innerWidth <= 768);
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    nextIdRef.current = Math.max(2, ...blocks.map((b) => b.id + 1));
  }, [blocks]);

  useEffect(() => {
    if (!didHydrateLayoutRef.current) {
      didHydrateLayoutRef.current = true;
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
          // One-time layout hydration on mount; anchors the default starter
          // content near the top of the viewport instead of centering it.
          fitInitialView(blocks);
          return;
        }

        applyParsedLayoutPayload(JSON.parse(raw));
      } catch {
        resetView();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewportWidth, viewportHeight]);

  useEffect(() => {
    const prev = prevViewportRef.current;
    if (prev.w > 0 && prev.h > 0 && (prev.w !== canvasWidth || prev.h !== stageViewportHeight)) {
      // Keep whatever world-space point was centered before the resize still
      // centered after it, instead of rescaling — standard infinite-canvas
      // behavior (there's no declared page size to re-fit to anymore).
      const worldCenterX = (prev.w / 2 - stagePosition.x) / stageScale;
      const worldCenterY = (prev.h / 2 - stagePosition.y) / stageScale;
      setStagePosition({
        x: canvasWidth / 2 - worldCenterX * stageScale,
        y: stageViewportHeight / 2 - worldCenterY * stageScale,
      });
    }
    prevViewportRef.current = { w: canvasWidth, h: stageViewportHeight };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasWidth, stageViewportHeight]);

  if (blocks.length === 0) {
    setBlocks([
      {
        ...DEFAULT_BLOCK,
        x: 0,
        y: 40,
      },
    ]);
    setSelectedId(1);
  }

  const deleteSelectedBlock = useCallback(() => {
    if (effectiveSelectedIds.length === 0) return;
    const idsToDelete = new Set(
      blocks.filter((b) => effectiveSelectedIds.includes(b.id) && !b.locked).map((b) => b.id)
    );
    if (idsToDelete.size === 0) return;
    pushHistory();
    setBlocks((prev) => {
      // Deleting a guide detaches its surviving texts in this same step, so
      // one undo restores the guide with its texts still attached.
      const filtered = dissolveSingletonGroups(deleteBlocksDetachingGuides(prev, idsToDelete));
      setSelectedId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
    setSelectedIds([]);
  }, [effectiveSelectedIds, blocks, pushHistory]);

  // Writing on a guide (see guides.md). The text block is created by the
  // first letter, not by opening the session, so Escape before typing leaves
  // no block and no undo entry.
  const [writing, setWriting] = useState<WritingSession | null>(null);

  /** The style a text written on a guide opens with: the first text block's, like Add text to guide. */
  const writtenTextStyle = useCallback((): Partial<Block> => {
    const styleSource = blocks.find((b) => b.type === "text");
    return styleSource ? styleToPatch(captureStyle(styleSource, "guide")) : {};
  }, [blocks]);

  /** Creates the attached text a session writes into, with its first letters; selects it. */
  const createWrittenText = useCallback(
    (session: WritingSession, text: string): number | null => {
      const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === session.guideId);
      if (!guide) return null;
      const id = nextIdRef.current++;
      pushHistory();
      const block: Block = {
        ...newAttachedText(id, guide, writtenTextStyle()),
        text,
        guide: { id: guide.id, ...session.attachment },
      };
      setBlocks((prev) => [...prev, block]);
      setSelectedIds([]);
      setSelectedId(id);
      return id;
    },
    [blocks, pushHistory, writtenTextStyle]
  );

  /**
   * Opens writing on a guide. A double-click passes where it landed; a key
   * press on a selected guide passes null and takes the guide's default
   * place. Either way the run is anchored at its reading start, so letters
   * already typed stay put as more arrive. `seed` is that first key, which
   * creates the block at once.
   */
  const beginWritingOnGuide = useCallback(
    (guideId: number, offset: number | null, seed = "") => {
      if (!blocks.some((b) => b.type === "guide" && b.id === guideId)) return;
      const attachment = { ...DEFAULT_ATTACHMENT, align: "start" as const, ...(offset === null ? {} : { offset }) };
      const fontSize = (writtenTextStyle().fontSize as number | undefined) ?? ATTACHED_TEXT_FONT_SIZE;
      const session: WritingSession = { guideId, textId: null, attachment, fontSize };
      if (seed) {
        const id = createWrittenText(session, seed);
        if (id === null) return;
        setWriting({ ...session, textId: id });
        return;
      }
      setSelectedIds([]);
      setSelectedId(guideId);
      setWriting(session);
    },
    [blocks, writtenTextStyle, createWrittenText]
  );

  useEffect(() => {
    if (!isBrowser) return;
    const NUDGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

    const handleKeyDown = (e: KeyboardEvent) => {
      // The start overlay hides the editor; its shortcuts (delete, nudge,
      // paste, undo) must not act on the block underneath it.
      if (showStart) return;
      const meta = e.ctrlKey || e.metaKey;
      const typing = isTypingTarget(e.target);

      if (meta && !typing) {
        if (e.key === "c") {
          if (selectedBlock) clipboardRef.current = { ...selectedBlock };
          return;
        }
        if (e.key === "v") {
          if (clipboardRef.current) {
            e.preventDefault();
            pushHistory();
            const newId = nextIdRef.current++;
            const copy: Block = {
              ...clipboardRef.current,
              id: newId,
              x: clipboardRef.current.x + 20,
              y: clipboardRef.current.y + 20,
              groupId: undefined,
              // A copy is a plain block: keeping the tag would slot it into
              // the verse (or a later verse that reused the id) on Justify.
              verse: undefined,
            } as Block;
            setBlocks((prev) => [...prev, copy]);
            setSelectedIds([]);
            setSelectedId(newId);
          }
          return;
        }
      }

      if (meta) {
        if (e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          handleUndo();
        }
        if ((e.key === "z" && e.shiftKey) || e.key === "y") {
          e.preventDefault();
          handleRedo();
        }
        return;
      }

      // A printable key on a selected guide starts writing on it. Space is
      // left to the canvas, where it pans (CanvasStage's handler).
      if (!typing && !e.altKey && e.key.length === 1 && e.key !== " " && selectedBlock?.type === "guide" && !writing) {
        e.preventDefault();
        beginWritingOnGuide(selectedBlock.id, null, e.key);
        return;
      }

      if ((e.key === "Delete" || e.key === "Backspace") && !typing) {
        if (effectiveSelectedIds.length > 0) {
          e.preventDefault();
          deleteSelectedBlock();
        }
        return;
      }

      if (NUDGE_KEYS.has(e.key) && !typing) {
        if (!selectedBlock || selectedBlock.locked) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        let { x, y } = selectedBlock;
        if (e.key === "ArrowUp") y -= step;
        if (e.key === "ArrowDown") y += step;
        if (e.key === "ArrowLeft") x -= step;
        if (e.key === "ArrowRight") x += step;
        updateBlockPositionWithHistory(selectedBlock.id, x, y);
        if (selectedBlock.groupId != null) {
          const deltaX = x - selectedBlock.x;
          const deltaY = y - selectedBlock.y;
          for (const other of blocks) {
            if (other.id === selectedBlock.id || other.groupId !== selectedBlock.groupId) continue;
            updateBlockPositionWithHistory(other.id, other.x + deltaX, other.y + deltaY);
          }
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    selectedBlock,
    effectiveSelectedIds,
    blocks,
    updateBlockPositionWithHistory,
    pushHistory,
    deleteSelectedBlock,
    writing,
    beginWritingOnGuide,
    showStart,
  ]);

  const createNextId = () => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  };

  const generateFromTemplate = (templateId: string, values: string[]) => {
    const template = STARTER_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    pushHistory();
    const templateBlocks = buildBlocksFromTemplate(template, values);
    const newBlocks: Block[] = templateBlocks.map((b) => ({ ...b, id: createNextId() }));
    setBlocks(newBlocks);
    setBackgroundColor(template.backgroundColor);
    setShowGrid(false);
    setSelectedIds([]);
    setSelectedId(newBlocks[0]?.id ?? null);
    setTimeout(() => resetView(newBlocks), 0);
  };

  const randomizeLayout = () => {
    if (blocks.length === 0) return;
    pushHistory();

    const fontFamilies = Object.keys(FONT_URLS);
    const font = fontFamilies[Math.floor(Math.random() * fontFamilies.length)];

    const bgLight = 15 + Math.random() * 75;
    const bg = hslToHex(Math.random() * 360, 35 + Math.random() * 40, bgLight);
    const textLight = bgLight > 55 ? 8 + Math.random() * 18 : 82 + Math.random() * 15;
    const textColor = hslToHex(Math.random() * 360, 40 + Math.random() * 40, textLight);

    setBackgroundColor(bg);
    setBlocks((prev) =>
      prev.map((b) =>
        b.type === "guide" ? b : ({ ...b, fontFamily: font, color: textColor } as Block)
      )
    );
  };

  const updateSelectedBlock = useCallback(
    (patch: Partial<Block>) => {
      if (!selectedBlock) return;
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (b.id === selectedBlock.id ? ({ ...b, ...patch } as Block) : b))
      );
    },
    [selectedBlock, pushHistory]
  );

  const updateBlock = useCallback(
    (id: number, patch: Partial<Block>) => {
      pushHistory();
      setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)));
    },
    [pushHistory]
  );

  /** Every change of the writing field: the first letters create the block, later ones update it. */
  const writeText = useCallback(
    (text: string) => {
      if (!writing) return;
      if (writing.textId !== null) {
        updateBlock(writing.textId, { text });
        return;
      }
      if (!text) return;
      const id = createWrittenText(writing, text);
      setWriting(id === null ? null : { ...writing, textId: id });
    },
    [writing, updateBlock, createWrittenText]
  );

  /** Double-click on attached text: keep writing it where it is. */
  const beginWritingText = useCallback(
    (textId: number) => {
      const block = blocks.find((b) => b.id === textId);
      if (block?.type !== "textPath" || !block.guide) return;
      const { id: guideId, ...attachment } = block.guide;
      setSelectedIds([]);
      setSelectedId(textId);
      setWriting({ guideId, textId, attachment, fontSize: block.fontSize });
    },
    [blocks]
  );

  /** Ends writing. A text emptied by the user is removed; the guide is selected in its place. */
  const endWriting = useCallback(() => {
    if (!writing) return;
    if (writing.textId !== null) {
      const block = blocks.find((b) => b.id === writing.textId);
      if (block && block.text === "") {
        pushHistory();
        setBlocks((prev) => prev.filter((b) => b.id !== writing.textId));
        setSelectedIds([]);
        setSelectedId(writing.guideId);
      }
    }
    setWriting(null);
  }, [writing, blocks, pushHistory]);

  // A session whose block or guide is gone (undo, a delete from Layers, a
  // load) closes on its own. Derived, like the orphan passes: no history.
  useEffect(() => {
    if (!writing) return;
    const guideGone = !blocks.some((b) => b.type === "guide" && b.id === writing.guideId);
    const textGone = writing.textId !== null && !blocks.some((b) => b.id === writing.textId);
    if (guideGone || textGone) setWriting(null);
  }, [writing, blocks]);

  const resizeShapeFillBlock = useCallback(
    (id: number, scale: number) => {
      updateBlock(id, { shapeScale: clamp(scale, 0.2, 3) });
    },
    [updateBlock]
  );

  const reorderBlocks = useCallback(
    (newBlocks: Block[]) => {
      pushHistory();
      // The Layers panel deletes through reorder; a guide removed that way
      // must detach its texts just as the Delete key does.
      setBlocks((prev) => dissolveSingletonGroups(reorderDetachingGuides(prev, newBlocks)));
    },
    [pushHistory]
  );

  const groupBlocks = useCallback(
    (idA: number, idB: number) => {
      pushHistory();
      setBlocks((prev) => {
        const a = prev.find((b) => b.id === idA);
        const b = prev.find((b) => b.id === idB);
        if (!a || !b) return prev;

        const groupId = a.groupId ?? b.groupId ?? nextGroupIdRef.current++;
        const memberIds = new Set(
          prev
            .filter(
              (bl) =>
                bl.id === idA ||
                bl.id === idB ||
                (a.groupId != null && bl.groupId === a.groupId) ||
                (b.groupId != null && bl.groupId === b.groupId)
            )
            .map((bl) => bl.id)
        );

        return prev.map((bl) => (memberIds.has(bl.id) ? { ...bl, groupId } : bl));
      });
      setSelectedIds([]);
      setSelectedId(idA);
    },
    [pushHistory]
  );

  const groupSelectedBlocks = useCallback(() => {
    if (effectiveSelectedIds.length < 2) return;
    pushHistory();
    const groupId = nextGroupIdRef.current++;
    const idSet = new Set(effectiveSelectedIds);
    setBlocks((prev) => prev.map((b) => (idSet.has(b.id) ? { ...b, groupId } : b)));
  }, [effectiveSelectedIds, pushHistory]);

  const getSelectedNodeRects = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return [];
    return effectiveSelectedIds
      .map((id) => {
        const node = stage.findOne(`#block-${id}`);
        const block = blocks.find((b) => b.id === id);
        if (!node || !block) return null;
        const rect = node.getClientRect({ relativeTo: stage });
        return { id, block, rect };
      })
      .filter(
        (
          x
        ): x is { id: number; block: Block; rect: { x: number; y: number; width: number; height: number } } =>
          x !== null
      );
  }, [effectiveSelectedIds, blocks]);

  const alignSelectedBlocks = useCallback(
    (edge: "left" | "centerX" | "right" | "top" | "centerY" | "bottom") => {
      const items = getSelectedNodeRects();
      if (items.length === 0) return;

      let refX0: number, refX1: number, refY0: number, refY1: number;
      if (items.length === 1) {
        const stage = stageRef.current;
        const box = stage ? getBlocksBoundingBox(stage, blocks) : null;
        const ref = box ?? items[0].rect;
        refX0 = ref.x;
        refX1 = ref.x + ref.width;
        refY0 = ref.y;
        refY1 = ref.y + ref.height;
      } else {
        refX0 = Math.min(...items.map((it) => it.rect.x));
        refX1 = Math.max(...items.map((it) => it.rect.x + it.rect.width));
        refY0 = Math.min(...items.map((it) => it.rect.y));
        refY1 = Math.max(...items.map((it) => it.rect.y + it.rect.height));
      }

      const deltas = new Map<number, { dx: number; dy: number }>();
      for (const { id, rect } of items) {
        let dx = 0;
        let dy = 0;
        switch (edge) {
          case "left":
            dx = refX0 - rect.x;
            break;
          case "centerX":
            dx = (refX0 + refX1) / 2 - (rect.x + rect.width / 2);
            break;
          case "right":
            dx = refX1 - (rect.x + rect.width);
            break;
          case "top":
            dy = refY0 - rect.y;
            break;
          case "centerY":
            dy = (refY0 + refY1) / 2 - (rect.y + rect.height / 2);
            break;
          case "bottom":
            dy = refY1 - (rect.y + rect.height);
            break;
        }
        deltas.set(id, { dx, dy });
      }

      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          const delta = deltas.get(b.id);
          return delta ? { ...b, x: b.x + delta.dx, y: b.y + delta.dy } : b;
        })
      );
    },
    [getSelectedNodeRects, blocks, pushHistory]
  );

  const distributeSelectedBlocks = useCallback(
    (axis: "x" | "y") => {
      const items = getSelectedNodeRects();
      if (items.length < 3) return;

      const sorted = [...items].sort((a, b) =>
        axis === "x" ? a.rect.x - b.rect.x : a.rect.y - b.rect.y
      );
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const firstEdge = axis === "x" ? first.rect.x : first.rect.y;
      const lastEdge =
        axis === "x" ? last.rect.x + last.rect.width : last.rect.y + last.rect.height;
      const totalSize = sorted.reduce(
        (sum, it) => sum + (axis === "x" ? it.rect.width : it.rect.height),
        0
      );
      const gap = (lastEdge - firstEdge - totalSize) / (sorted.length - 1);

      const deltas = new Map<number, number>();
      let cursor = firstEdge;
      for (const it of sorted) {
        const size = axis === "x" ? it.rect.width : it.rect.height;
        const currentPos = axis === "x" ? it.rect.x : it.rect.y;
        deltas.set(it.id, cursor - currentPos);
        cursor += size + gap;
      }

      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          const delta = deltas.get(b.id);
          if (delta == null) return b;
          return axis === "x" ? { ...b, x: b.x + delta } : { ...b, y: b.y + delta };
        })
      );
    },
    [getSelectedNodeRects, pushHistory]
  );

  const ungroupBlock = useCallback(
    (id: number) => {
      pushHistory();
      setBlocks((prev) =>
        dissolveSingletonGroups(
          prev.map((bl) => (bl.id === id ? { ...bl, groupId: undefined } : bl))
        )
      );
    },
    [pushHistory]
  );

  const getCenterStagePos = useCallback(() => {
    const stage = stageRef.current;
    const container = canvasContainerRef.current;
    if (!stage || !container) {
      return { x: 0, y: 0 };
    }

    const viewRect = container.getBoundingClientRect();
    const centerScreenX = viewRect.left + viewRect.width / 2;
    const centerScreenY = viewRect.top + viewRect.height / 2;

    const oldPointer = stage.getPointerPosition();
    stage.setPointersPositions({ clientX: centerScreenX, clientY: centerScreenY });
    const pos = stage.getRelativePointerPosition();

    if (oldPointer) {
      stage.setPointersPositions({ clientX: oldPointer.x, clientY: oldPointer.y });
    }

    return {
      x: pos?.x ?? 0,
      y: pos?.y ?? 0,
    };
  }, []);

  const stagePosFromClient = useCallback((clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    stage.setPointersPositions({ clientX, clientY });
    const pos = stage.getRelativePointerPosition();
    return { x: pos?.x ?? 0, y: pos?.y ?? 0 };
  }, []);

  const zoomToBlock = useCallback(
    (id: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const node = stage.findOne(`#block-${id}`);
      if (!node) return;
      zoomToRect(node.getClientRect({ relativeTo: stage }));
    },
    [zoomToRect]
  );

  const beginPlacement = useCallback(
    (block: Block, width: number, height: number, commitOffsetX: number, commitOffsetY: number, label: string) => {
      const { x, y } = getCenterStagePos();
      setPendingPlacement({
        block: { ...block, x, y },
        width,
        height,
        commitOffsetX,
        commitOffsetY,
        label,
      });
    },
    [getCenterStagePos]
  );

  // Mirrors pendingPlacement so the click handler below can read the latest
  // value synchronously without going through a setState updater — updater
  // functions are called twice under StrictMode (it double-invokes them to
  // catch impure ones), so the commit's side effects (pushHistory, setBlocks,
  // ...) must not live inside one, or they'd double-fire.
  const pendingPlacementRef = useRef<PendingPlacement | null>(null);
  useEffect(() => {
    pendingPlacementRef.current = pendingPlacement;
  }, [pendingPlacement]);

  // Drives the "new block follows the cursor until you click to drop it"
  // flow: while a placement is pending, track the mouse over the canvas
  // area only (never the sidebars) and commit/cancel on click/Escape.
  useEffect(() => {
    if (!pendingPlacement) return;
    const container = canvasContainerRef.current;
    if (!container) return;

    const handleMouseMove = (e: MouseEvent) => {
      const { x, y } = stagePosFromClient(e.clientX, e.clientY);
      setPendingPlacement((prev) => (prev ? { ...prev, block: { ...prev.block, x, y } } : prev));
    };

    const handleClick = (e: MouseEvent) => {
      const prev = pendingPlacementRef.current;
      if (!prev) return;
      const { x, y } = stagePosFromClient(e.clientX, e.clientY);
      pushHistory();
      const finalBlock: Block = {
        ...prev.block,
        x: x + prev.commitOffsetX,
        y: y + prev.commitOffsetY,
      };
      setBlocks((bs) => [...bs, finalBlock]);
      setSelectedIds([]);
      setSelectedId(finalBlock.id);
      setPendingPlacement(null);
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      setPendingPlacement(null);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingPlacement(null);
    };

    const prevCursor = container.style.cursor;
    container.style.cursor = "crosshair";
    container.addEventListener("mousemove", handleMouseMove);
    container.addEventListener("click", handleClick);
    container.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      container.style.cursor = prevCursor;
      container.removeEventListener("mousemove", handleMouseMove);
      container.removeEventListener("click", handleClick);
      container.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("keydown", handleKeyDown);
    };
    // Re-runs only when placement starts/ends (not on every cursor-follow
    // update) — handlers close over the latest state via functional setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPlacement != null, pushHistory, stagePosFromClient]);

  const addBlock = () => {
    const newId = createNextId();
    beginPlacement(
      {
        ...DEFAULT_BLOCK,
        id: newId,
        text: "نَصٌّ جَدِيدٌ",
        fontSize: DEFAULT_NEW_BLOCK_FONT_SIZE,
        color: "#1e3a5f",
        x: 0,
        y: 0,
      },
      160,
      60,
      0,
      0,
      "New Text"
    );
  };

  const duplicateSelectedBlock = () => {
    if (!selectedBlock) return;
    pushHistory();

    const newId = createNextId();
    const copy: Block = {
      ...selectedBlock,
      id: newId,
      x: selectedBlock.x - 20,
      y: selectedBlock.y + 20,
      groupId: undefined,
      // See the paste handler: a copied verse line is not a member of the verse.
      verse: undefined,
    } as Block;

    setBlocks((prev) => [...prev, copy]);
    setSelectedIds([]);
    setSelectedId(newId);
  };

  const { handleExportPNG, handleExportJPEG, handleExportSVG, handleExportPDF } = useExport(
    stageRef,
    blocks
  );

  const buildLayoutPayload = () => ({
    blocks,
    selectedId,
    backgroundColor,
    stageScale,
    stagePosition,
    panMode,
    viewportWidth,
    viewportHeight,
    artboard,
    // ---- STREAM-F: ink & surface — payload fields ----
    artboardSurface,
    // ---- /STREAM-F ----
    version: 5,
  });

  const saveLayout = () => {
    if (!isBrowser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildLayoutPayload()));
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — saving layout is best-effort.
    }
  };

  // Shared body for applying a parsed saved-layout payload (from localStorage,
  // a named project, or an uploaded file) to editor state. Callers wrap this
  // in their own try/catch since they differ in failure behavior (silent
  // resetView vs. an alert).
  const applyParsedLayoutPayload = (parsed: Record<string, unknown>) => {
    // Removed block types are dropped and removed fields stripped; see `lib/legacySaves.ts`.
    const parsedBlocks = Array.isArray(parsed.blocks)
      ? sanitizeLegacyBlocks(parsed.blocks as unknown[])
      : null;
    // `let` because the STREAM-B sanitation region below reassigns it.
    let blocksToLoad: Block[] | null = parsedBlocks;
    // blocksToLoad, e.g. dropping mirrors whose sourceId no longer resolves) ----
    // A mirror renders its source's content, so one whose source is missing
    // from the payload would occupy the layer list and the selection while
    // drawing nothing. Dropped on load for the same reason, and by the same
    // precedent, as the removed-type filter above.
    // A block grouped only with a dropped one would keep a lone group badge,
    // so singleton groups dissolve here as they do after a delete.
    if (blocksToLoad)
      blocksToLoad = dissolveSingletonGroups(dropOrphanedAttachments(dropOrphanedMirrors(blocksToLoad)));
    const loadedBlocks: Block[] = blocksToLoad ?? blocks;
    if (blocksToLoad) setBlocks(blocksToLoad);
    if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
      setSelectedIds([]);
      setSelectedId(parsed.selectedId);
    }
    if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
    if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);
    // Anything that isn't a well-formed config — including the field being
    // absent, which is every project saved before pages existed — loads as
    // freeform. Loading replaces the document, so this must run even when the
    // key is missing, or an old project would inherit the current page.
    setArtboard(isArtboardConfig(parsed.artboard) ? parsed.artboard : null);
    // ---- STREAM-F: ink & surface — payload read ----
    // Absent (every project written before surfaces existed) loads as bare
    // paper, and loading replaces the document — so this runs even when the
    // key is missing, exactly as the artboard read above does.
    setArtboardSurface(readArtboardSurface(parsed.artboardSurface));
    // ---- /STREAM-F ----

    const savedViewportWidth =
      typeof parsed.viewportWidth === "number" ? parsed.viewportWidth : null;
    const savedViewportHeight =
      typeof parsed.viewportHeight === "number" ? parsed.viewportHeight : null;

    const viewportCloseEnough =
      savedViewportWidth != null &&
      savedViewportHeight != null &&
      Math.abs(savedViewportWidth - viewportWidth) < 80 &&
      Math.abs(savedViewportHeight - viewportHeight) < 80;

    const stagePosition = parsed.stagePosition as { x?: unknown; y?: unknown } | null | undefined;

    if (
      viewportCloseEnough &&
      typeof parsed.stageScale === "number" &&
      stagePosition &&
      typeof stagePosition.x === "number" &&
      typeof stagePosition.y === "number"
    ) {
      setStageScale(clamp(parsed.stageScale, MIN_SCALE, MAX_SCALE));
      setStagePosition({ x: stagePosition.x, y: stagePosition.y });
    } else {
      setTimeout(() => resetView(loadedBlocks), 0);
    }
  };

  const applyStoredPayload = (raw: string) => {
    try {
      applyParsedLayoutPayload(JSON.parse(raw));
    } catch {
      resetView();
    }
  };

  const loadLayout = () => {
    if (!isBrowser) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    applyStoredPayload(raw);
  };

  const readNamedProjectsStore = (): NamedProjectsStore => {
    if (!isBrowser) return {};
    try {
      const raw = localStorage.getItem(NAMED_PROJECTS_KEY);
      return raw ? (JSON.parse(raw) as NamedProjectsStore) : {};
    } catch {
      return {};
    }
  };

  const refreshNamedProjectsList = (store: NamedProjectsStore) => {
    setLocalProjects(
      Object.entries(store)
        .map(([name, entry]) => ({ name, savedAt: entry.savedAt, source: "local" as const }))
        .sort((a, b) => b.savedAt - a.savedAt)
    );
  };

  const saveNamedProjectLocal = (trimmed: string) => {
    if (!isBrowser) return;
    try {
      const store = readNamedProjectsStore();
      store[trimmed] = { savedAt: Date.now(), payload: buildLayoutPayload() };
      localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
      refreshNamedProjectsList(store);
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — best-effort.
    }
  };

  const saveNamedProjectCloud = async (trimmed: string) => {
    const { error } = await saveCloudProject(trimmed, buildLayoutPayload());
    if (error) {
      alert(
        error === "Not signed in."
          ? "Couldn't save to cloud — not signed in."
          : "Couldn't save to cloud — check your connection and try again."
      );
      return;
    }
    await refreshCloudProjects();
  };

  const saveNamedProject = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (saveDestination === "cloud") {
      saveNamedProjectCloud(trimmed);
    } else {
      saveNamedProjectLocal(trimmed);
    }
  };

  const loadNamedProject = (name: string, source: "local" | "cloud") => {
    if (source === "local") {
      const store = readNamedProjectsStore();
      const entry = store[name];
      if (!entry) return;
      applyStoredPayload(JSON.stringify(entry.payload));
      return;
    }
    loadCloudProject(name).then((result) => {
      if (!result) {
        alert("Couldn't load that cloud project — check your connection and try again.");
        return;
      }
      try {
        applyParsedLayoutPayload(result.payload as Record<string, unknown>);
      } catch {
        alert("Couldn't load that cloud project — check your connection and try again.");
      }
    });
  };

  const deleteNamedProject = (name: string, source: "local" | "cloud") => {
    if (source === "local") {
      const store = readNamedProjectsStore();
      delete store[name];
      try {
        localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
      } catch {
        // best-effort
      }
      refreshNamedProjectsList(store);
      return;
    }
    deleteCloudProject(name).then(({ error }) => {
      if (error) {
        alert("Couldn't delete that cloud project — check your connection and try again.");
        return;
      }
      refreshCloudProjects();
    });
  };

  const handleSignIn = (email: string) => signInWithEmail(email);

  const handleSignOut = () => {
    cloudSignOut();
    setCloudProjects([]);
    setSaveDestination("local");
  };

  const requestDeleteNamedProject = (name: string, source: "local" | "cloud") => {
    setConfirmRequest({
      title: `Delete "${name}"?`,
      message:
        source === "local"
          ? "This removes the saved project from this browser for good — unlike canvas edits, it isn't covered by Ctrl+Z."
          : "This removes the saved project from your cloud account for good — unlike canvas edits, it isn't covered by Ctrl+Z.",
      confirmLabel: "Delete project",
      onConfirm: () => {
        setConfirmRequest(null);
        deleteNamedProject(name, source);
      },
    });
  };

  const downloadLayout = () => {
    const json = JSON.stringify(buildLayoutPayload(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "calligraphy-layout.json", true);
  };

  const uploadLayout = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          applyParsedLayoutPayload(JSON.parse(e.target?.result as string));
        } catch {
          alert("Invalid layout file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const updateStageZoom = (scale: number, position: { x: number; y: number }) => {
    setStageScale(clamp(scale, MIN_SCALE, MAX_SCALE));
    setStagePosition(position);
  };

  const addGuide = useCallback((axis: "horizontal" | "vertical", position: number) => {
    setGuides((prev) => ({ ...prev, [axis]: [...prev[axis], position] }));
  }, []);

  const moveGuide = useCallback(
    (axis: "horizontal" | "vertical", index: number, position: number) => {
      setGuides((prev) => ({
        ...prev,
        [axis]: prev[axis].map((v, i) => (i === index ? position : v)),
      }));
    },
    []
  );

  const removeGuide = useCallback((axis: "horizontal" | "vertical", index: number) => {
    setGuides((prev) => ({ ...prev, [axis]: prev[axis].filter((_, i) => i !== index) }));
  }, []);

  const clearGuides = useCallback(() => {
    setGuides({ horizontal: [], vertical: [] });
  }, []);

  const addShapeFillBlock = (
    svgPathData: string,
    shapeWidth: number,
    shapeHeight: number
  ) => {
    const newId = createNextId();
    const autoFontSize = Math.max(8, Math.round(shapeHeight / 18));

    beginPlacement(
      {
        ...DEFAULT_BLOCK,
        id: newId,
        text: "“كما أن كل المنحنيات ترتبط بمراكزها أو بؤرها، كذلك يرتبط كل جمالٍ في الشخصية بالروح.” — هنري ديفيد ثورو",
        fontSize: autoFontSize,
        type: "shapeFill",
        shapeSvgPath: svgPathData,
        shapeWidth,
        shapeHeight,
        shapeScale: 1,
        shapeFillSpacing: 1.4,
        shapeFillScaleX: 1,
        shapeFillScaleY: 1,
        shapeFillTextRotation: 0,
        x: 0,
        y: 0,
      },
      shapeWidth,
      shapeHeight,
      -shapeWidth / 2,
      -shapeHeight / 2,
      "New Shape Fill"
    );
  };

  const addTextPathBlock = () => {
    const newId = createNextId();
    const width = 400;
    const height = 120;

    beginPlacement(
      {
        ...DEFAULT_BLOCK,
        id: newId,
        text: "“السحر يسكن في المنحنيات، لا في الزوايا.” — ماسون كولي",
        type: "textPath",
        textPathD: arcPathD(width, height),
        textPathReversed: true,
        textPathBaselineOffset: 0,
        textPathEditMode: false,
        x: 0,
        y: 0,
      },
      width,
      height,
      -width / 2,
      -height / 2,
      "New Text on Path"
    );
  };

  // Guides: dashed construction paths that Curve text can attach to.
  // See .claude/rules/guides.md.
  const addGuideBlock = (shape: GuideShape) => {
    const newId = createNextId();
    const params = GUIDE_DEFAULTS[shape];
    const w = params.width ?? 300;
    const h = params.height ?? params.width ?? 300;
    const guide: GuideBlock = {
      ...DEFAULT_BLOCK,
      id: newId,
      text: "",
      type: "guide",
      guideShape: shape,
      guideParams: params,
      guideD: guidePathD(shape, params),
      guideEditMode: shape === "pen",
      x: 0,
      y: 0,
    };
    // Guide paths are centred on the origin, so the click is the centre.
    beginPlacement(guide, w, h, 0, 0, "New Guide");
  };

  /** A guide from an uploaded outline, at its natural size, placed by a click like the others. */
  const addSvgGuideBlock = (pathData: string) => {
    const src = uploadedGuideSource(pathData);
    if (!src) { setExportStatus("That SVG has no outline to use as a guide."); return; }
    const guide: GuideBlock = {
      ...DEFAULT_BLOCK,
      id: createNextId(),
      text: "",
      type: "guide",
      guideShape: "svg",
      guideParams: { width: src.width, height: src.height },
      guideSvgD: src.d,
      guideD: src.d,
      x: 0,
      y: 0,
    };
    beginPlacement(guide, src.width, src.height, 0, 0, "New Guide");
  };

  const updateGuideParams = (params: GuideParams) => {
    if (selectedBlock?.type !== "guide" || selectedBlock.guideShape === "pen") return;
    const next = { ...selectedBlock.guideParams, ...params };
    if (selectedBlock.guideShape === "svg") {
      // One size: the outline scales uniformly to the width, so the height follows.
      const source = selectedBlock.guideSvgD ?? selectedBlock.guideD;
      const w = next.width ?? GUIDE_DEFAULTS.svg.width ?? 300;
      const ratio = (selectedBlock.guideParams?.height ?? w) / Math.max(selectedBlock.guideParams?.width ?? w, 1);
      updateSelectedBlock({ guideParams: { width: w, height: w * ratio }, guideD: svgGuidePathD(source, w) });
      return;
    }
    updateSelectedBlock({ guideParams: next, guideD: guidePathD(selectedBlock.guideShape, next) });
  };

  /**
   * Arrange a stack's letters to fill a closed guide, synchronously from the
   * *current* state: rows from the bottom up in reading order, outer letters
   * hugging and leaning into the edge, free stems drawn out, the block sized
   * to the shape and moved onto the guide, and the gaps busied with the
   * offered ornaments. Existing fillers are stripped first so a re-run never
   * accumulates them. One history step (updateBlock).
   */
  const arrangeStackNow = (blockId: number, guideId: number, fillers: FillerShape[], fontNote: string) => {
    const block = blocks.find((b) => b.id === blockId);
    if (!block || !isStackBlock(block)) { setExportStatus("The composition changed while its font was loading; nothing was arranged."); return; }
    const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === guideId);
    if (!guide) { setExportStatus("That guide is gone; nothing was arranged."); return; }
    const shapePx = containerPolygon(parseSvgPath(guide.guideD));
    if (!shapePx) { setExportStatus("That guide is not a closed shape, so there is nothing to fill."); return; }
    let result: ReturnType<typeof arrangeStackInShape>;
    try {
      result = arrangeStackInShape({
        pieces: block.pieces.filter((p) => !p.filler), joins: block.joins, shapePx,
        fontSize: block.fontSize, unitsPerEm: block.unitsPerEm, fillers, pullStems: true,
      });
    } catch (err) {
      setExportStatus(`Could not arrange the letters: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (!result) { setExportStatus("Could not fit the letters inside that guide."); return; }
    updateBlock(block.id, {
      pieces: result.pieces, joins: result.joins, fontSize: result.fontSize,
      x: guide.x, y: guide.y, rotation: guide.rotation ?? 0,
    });
    const letters = result.pieces.filter((p) => p.role === "letter" && p.parentId === undefined).length;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    setExportStatus(
      `Arranged ${plural(letters, "letter")} in ${plural(result.rows, "row")} inside the guide` +
      (result.fillers > 0 ? `, ${plural(result.fillers, "ornament")} added` : "") +
      (result.stems > 0 ? `, ${plural(result.stems, "stem")} lengthened` : "") + fontNote + "."
    );
  };
  // The font load below awaits; by then this render's closures are stale.
  // The ref always holds the latest render's handler, so the arrange runs
  // against current blocks and pushes a current history snapshot.
  const arrangeStackNowRef = useRef(arrangeStackNow);
  arrangeStackNowRef.current = arrangeStackNow;

  /** "Fill a guide shape": load the block's font for its tashkeel (when the
   *  panel's "Fill gaps with tashkeel" is on), then arrange from current state. */
  const arrangeStackInGuide = async (guideId: number) => {
    if (!selectedBlock || !isStackBlock(selectedBlock)) return;
    const { id, source, unitsPerEm, nib } = selectedBlock;
    let fillers: FillerShape[] = [];
    let fontNote = "";
    if (stackFillGaps) {
      try {
        const shaped = await shapeText(source.text, resolveFontUrl(source.fontFamily));
        fillers = fillerShapes(shaped.font, unitsPerEm, nib.width);
      } catch {
        fillers = [teardropShape(nib.width)];
        fontNote = " (font unavailable; teardrops used)";
      }
    }
    arrangeStackNowRef.current(id, guideId, fillers, fontNote);
  };

  /** Stack layout back to its home arrangement; fillers go (home is the
   *  conversion, which had none). updateSelectedBlock pushes the one history step. */
  const resetStackLayout = () => {
    if (!selectedBlock || !isStackBlock(selectedBlock)) return;
    updateSelectedBlock({
      pieces: selectedBlock.pieces.filter((p) => !p.filler).map((p) => ({ ...p, x: p.homeX, y: p.homeY, rotation: 0 })),
      joins: selectedBlock.joins.map((j) => ({ ...j, bow: j.rest?.bow ?? 0, depth: j.rest?.depth ?? 0 })),
    });
  };

  /** Pen-guide point edits; the overlay's onBeginChange already pushed history. */
  const updateGuideD = (id: number, d: string) => {
    setBlocks((prev) => prev.map((b) => (b.id === id && b.type === "guide" ? { ...b, guideD: d } : b)));
  };

  /** Replaces a whole block — a spread patch cannot remove a key such as `guide`. */
  const replaceBlockWithHistory = (id: number, block: Block) => {
    pushHistory();
    setBlocks((prev) => prev.map((b) => (b.id === id ? block : b)));
  };

  const addTextToGuide = () => {
    if (selectedBlock?.type !== "guide") return;
    const guide = selectedBlock;
    const styleSource = blocks.find((b) => b.type === "text");
    const id = createNextId();
    pushHistory();
    setBlocks((prev) => [
      ...prev,
      newAttachedText(id, guide, styleSource ? styleToPatch(captureStyle(styleSource, "guide")) : {}),
    ]);
    setSelectedIds([]);
    setSelectedId(id);
  };

  const attachSelectedToGuide = (guideId: number) => {
    if (selectedBlock?.type !== "text") return;
    const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === guideId);
    if (!guide) return;
    const { block, dropped } = attachTextToGuide(selectedBlock, guide);
    replaceBlockWithHistory(block.id, block);
    setExportStatus(
      dropped.length ? `Attached to the guide. Dropped: ${dropped.join(", ")}.` : "Attached to the guide."
    );
  };

  const detachSelectedFromGuide = () => {
    if (selectedBlock?.type !== "textPath" || !selectedBlock.guide) return;
    const guideId = selectedBlock.guide.id;
    const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === guideId);
    if (!guide) return;
    replaceBlockWithHistory(selectedBlock.id, detachFromGuide(selectedBlock, guide));
  };

  const updateGuideAttachment = (patch: Partial<GuideAttachment>) => {
    if (selectedBlock?.type !== "textPath" || !selectedBlock.guide) return;
    updateSelectedBlock({ guide: { ...selectedBlock.guide, ...patch } });
  };

  /**
   * A slide along the guide, from a drag. History is pushed once, on the
   * gesture's first frame — the debounced move push would open a second
   * undo step whenever the user paused mid-slide.
   */
  const slideAlongGuide = (id: number, offset: number, first: boolean) => {
    if (first) pushHistory();
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id && b.type === "textPath" && b.guide ? { ...b, guide: { ...b.guide, offset } } : b
      )
    );
  };

  // Not saved, not undoable: what the renderer measured, for the panel's note.
  const [guideShrink, setGuideShrink] = useState<ReadonlyMap<number, number>>(() => new Map());
  const reportGuideLayout = useCallback((id: number, shrink: number) => {
    setGuideShrink((prev) => (prev.get(id) === shrink ? prev : new Map(prev).set(id, shrink)));
  }, []);

  const startSidebarResize = (e: React.MouseEvent) => {
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    setIsResizingSidebar(true);
  };

  useEffect(() => {
    if (!isResizingSidebar) return;

    const handleMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX.current;
      setSidebarWidth(
        clamp(resizeStartWidth.current + delta, 220, Math.max(260, viewportWidth - 260))
      );
    };

    const handleUp = () => setIsResizingSidebar(false);

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
  }, [isResizingSidebar, viewportWidth]);

  const clearDiacritics = useCallback(() => {
    if (!selectedBlock) return;
    updateSelectedBlock({
      text: selectedBlock.text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, ""),
    });
  }, [selectedBlock, updateSelectedBlock]);

  const requestTextEdit = useCallback((id: number) => {
    setSelectedIds([]);
    setSelectedId(id);
    setEditRequestSignal((v) => v + 1);
  }, []);

  // Parallel-stream handler anchors (see PARALLEL.md). Handlers live here
  // rather than beside their state because everything they close over —
  // pushHistory, setBlocks, the block mutators — is declared above this point,
  // and this file's handlers must be defined above their first reference.
  //
  // Each stream also owns one `stream*SidebarProps` bundle (and stream A a
  // `streamACanvasProps`), spread into the JSX below. Filling a bundle here
  // is how a stream gets props into <Sidebar>/<CanvasStage> without editing
  // the shared JSX at all — the props lists are hundreds of lines of adjacent
  // single-line attributes, which is precisely the shape that does not merge.
  const streamASidebarProps: Partial<SidebarProps> = {
    snapToBlockEdges,
    onToggleSnapToBlockEdges: setSnapToBlockEdges,
  };
  const streamACanvasProps: Partial<CanvasStageProps> = { snapToBlockEdges };
  // A second `useExport(...)` call rather than extending the destructure at
  // the original call site: that line sits outside every stream's anchors.
  // The hook holds no state of its own — it only closes over the stage ref
  // and the blocks — so calling it twice costs nothing.
  const { handleCopyPNG, handleExportAll } = useExport(stageRef, blocks);

  const copyPNGToClipboard = async () => {
    const result = await handleCopyPNG({
      scale: exportScale,
      transparent: transparentExport,
    });
    setExportStatus(result.ok ? "Copied to the clipboard." : result.reason);
  };

  const exportAllFormats = () => {
    setExportStatus(null);
    void handleExportAll({
      scale: exportScale,
      transparent: transparentExport,
      formats: exportFormats,
    });
  };

  const toggleExportFormat = (format: ExportFormat) => {
    setExportFormats((prev) =>
      prev.includes(format)
        ? // Never let the list empty out — "export all" with nothing ticked
          // would be a button that silently does nothing.
          prev.length === 1
          ? prev
          : prev.filter((f) => f !== format)
        : [...prev, format]
    );
  };

  // Selecting a preset loads its settings into the controls above, so what a
  // preset will do is visible before it is run.
  const selectExportPreset = (id: string) => {
    setSelectedExportPresetId(id);
    const preset = exportPresets.find((p) => p.id === id);
    if (!preset) return;
    setExportScale(preset.scale);
    setTransparentExport(preset.transparent);
    setExportFormats(preset.formats);
    setNewExportPresetName(preset.name);
  };

  const runExportPreset = () => {
    const preset = exportPresets.find((p) => p.id === selectedExportPresetId);
    if (!preset) return;
    setExportStatus(null);
    void handleExportAll({
      scale: preset.scale,
      transparent: preset.transparent,
      formats: preset.formats,
    });
  };

  const saveExportPreset = () => {
    const name = newExportPresetName.trim();
    if (!name) return;
    // Overwrite by name, matching how the named-project store already behaves.
    const existing = exportPresets.find((p) => p.name === name);
    const preset: ExportPreset = {
      id: existing?.id ?? `preset-${Date.now().toString(36)}`,
      name,
      scale: exportScale,
      transparent: transparentExport,
      formats: exportFormats,
    };
    const next = upsertExportPreset(exportPresets, preset);
    setExportPresets(next);
    saveExportPresets(next);
    setSelectedExportPresetId(preset.id);
    setExportStatus(`Preset “${name}” saved.`);
  };

  const deleteExportPreset = () => {
    if (!selectedExportPresetId) return;
    const next = removeExportPreset(exportPresets, selectedExportPresetId);
    setExportPresets(next);
    saveExportPresets(next);
    setSelectedExportPresetId("");
  };

  const streamCSidebarProps: Partial<SidebarProps> = {
    onCopyPNG: copyPNGToClipboard,
    onExportAll: exportAllFormats,
    exportStatus,
    exportScale,
    onChangeExportScale: setExportScale,
    exportFormats,
    onToggleExportFormat: toggleExportFormat,
    exportPresets,
    selectedExportPresetId,
    onSelectExportPreset: selectExportPreset,
    onRunExportPreset: runExportPreset,
    newExportPresetName,
    onChangeNewExportPresetName: setNewExportPresetName,
    onSaveExportPreset: saveExportPreset,
    onDeleteExportPreset: deleteExportPreset,
  };
  const streamDSidebarProps: Partial<SidebarProps> = {};

  // Phase 1 (2026-08-14 run) prop bundles — same mechanism as above, fresh
  // names so they can't collide with the merged 2026-08-12 bundles. Each
  // stream fills only its own pair; all are already spread at the call sites.
  const applyArtboard = (next: ArtboardConfig | null) => {
    pushHistory();
    setArtboard(next);
  };

  /**
   * `""` is the freeform option, `"custom"` keeps the current dimensions but
   * detaches them from a named size; anything else is a preset id.
   *
   * Choosing a page also fits the view to it. Without that, picking A4 at
   * 300dpi drops a 2480 × 3508 rectangle around a block sized for the old
   * viewport and nothing visibly happens — the page is simply off-screen.
   */
  const chooseArtboardPreset = (id: string) => {
    if (id === "") {
      applyArtboard(null);
      return;
    }
    if (id === "custom") {
      applyArtboard(artboard ? { ...artboard, presetId: null } : DEFAULT_CUSTOM_ARTBOARD);
      if (!artboard) {
        setTimeout(() => zoomToRect(padBox(artboardRect(DEFAULT_CUSTOM_ARTBOARD)), 0), 0);
      }
      return;
    }
    const preset = findArtboardPreset(id);
    if (!preset) return;
    const next = configFromPreset(preset, artboard?.margin ?? 0);
    applyArtboard(next);
    setTimeout(() => zoomToRect(padBox(artboardRect(next)), 0), 0);
  };

  const updateArtboard = (next: ArtboardConfig) => applyArtboard(next);

  const changeArtboardSize = (width: number, height: number) => {
    if (!artboard) return;
    updateArtboard(withSize(artboard, width, height));
  };

  const changeArtboardUnit = (unit: ArtboardUnit) => {
    if (!artboard) return;
    // Display-only: the stored pixels don't move, so this isn't undoable.
    setArtboard({ ...artboard, unit });
  };

  const changeArtboardDpi = (dpi: number) => {
    if (!artboard) return;
    updateArtboard(withDpi(artboard, dpi));
  };

  const changeArtboardOrientation = (orientation: "portrait" | "landscape") => {
    if (!artboard) return;
    updateArtboard(withOrientation(artboard, orientation));
  };

  const changeArtboardMargin = (margin: number) => {
    if (!artboard) return;
    updateArtboard({ ...artboard, margin: clampMargin(margin, artboard) });
  };

  // A third `useExport(...)`, for the same reason the second one above exists:
  // the original call site sits outside every stream's anchors, and the hook
  // holds no state of its own. These handlers replace the artboard-unaware
  // ones in the props bundle below — every `p1a*` spread lands after the
  // explicit JSX props and after the other bundles, so the last write wins.
  // With `artboard` null they are byte-identical to the ones they shadow.
  const artboardExport = { config: artboard, clipToPage };
  const {
    handleExportPNG: exportPagePNG,
    handleExportJPEG: exportPageJPEG,
    handleExportSVG: exportPageSVG,
    handleExportPDF: exportPagePDF,
    handleCopyPNG: copyPagePNG,
    handleExportAll: exportPageAll,
  } = useExport(stageRef, blocks, artboardExport);

  const p1aSidebarProps: Partial<SidebarProps> = {
    artboard,
    onChooseArtboardPreset: chooseArtboardPreset,
    onChangeArtboardSize: changeArtboardSize,
    onChangeArtboardUnit: changeArtboardUnit,
    onChangeArtboardDpi: changeArtboardDpi,
    onChangeArtboardOrientation: changeArtboardOrientation,
    onChangeArtboardMargin: changeArtboardMargin,
    clipToPage,
    onToggleClipToPage: setClipToPage,
    onExportPNG: () => exportPagePNG({ transparent: transparentExport }),
    onExportJPEG: () => exportPageJPEG({}),
    onExportSVG: () => exportPageSVG({ transparent: transparentExport }),
    onExportPDF: () => exportPagePDF({}),
    onCopyPNG: async () => {
      const result = await copyPagePNG({
        scale: exportScale,
        transparent: transparentExport,
      });
      setExportStatus(result.ok ? "Copied to the clipboard." : result.reason);
    },
    onExportAll: () => {
      setExportStatus(null);
      void exportPageAll({
        scale: exportScale,
        transparent: transparentExport,
        formats: exportFormats,
      });
    },
    onRunExportPreset: () => {
      const preset = exportPresets.find((p) => p.id === selectedExportPresetId);
      if (!preset) return;
      setExportStatus(null);
      void exportPageAll({
        scale: preset.scale,
        transparent: preset.transparent,
        formats: preset.formats,
      });
    },
  };
  const p1aCanvasProps: Partial<CanvasStageProps> = { artboard };
  /**
   * A mirror reflects exactly one block, so the add actions need exactly one
   * block selected — and that block may not itself be a mirror. Rejecting a
   * mirror here is the whole cycle guard: with one level only, no chain of
   * sources can close on itself and `MirrorBlockView` can never recurse.
   */
  const mirrorSourceCandidate =
    effectiveSelectedIds.length === 1 && isMirrorSourceCandidate(selectedBlock)
      ? selectedBlock
      : null;

  // Always a horizontal mirror: the radial medallion is made from Compositions.
  const addMirrorBlock = () => {
    if (!mirrorSourceCandidate) return;
    pushHistory();
    const newId = createNextId();
    const block = buildMirrorBlock(newId, mirrorSourceCandidate, "mirrorX");
    setBlocks((prev) => [...prev, block]);
    setSelectedIds([]);
    setSelectedId(newId);
  };

  const selectedMirrorSource =
    selectedBlock?.type === "mirror"
      ? blocks.find((b) => b.id === selectedBlock.sourceId)
      : undefined;

  /**
   * Deleting a source takes its reflections with it.
   *
   * This lives in an effect over `blocks` rather than inside
   * `deleteSelectedBlock` so that *every* route to a vanished source is
   * covered — the delete button, the Delete key, the Layers panel's own
   * delete, a reorder that drops one. It deliberately does not `pushHistory`:
   * the action that removed the source already pushed, and the snapshot it
   * took still holds both blocks, so one undo restores the pair.
   */
  useEffect(() => {
    if (!hasOrphanedMirrors(blocks)) return;
    const kept = dropOrphanedMirrors(blocks);
    const keptIds = new Set(kept.map((b) => b.id));
    setBlocks(kept);
    setSelectedIds((prev) => prev.filter((id) => keptIds.has(id)));
    setSelectedId((prev) =>
      prev != null && !keptIds.has(prev) ? kept[kept.length - 1]?.id ?? null : prev
    );
  }, [blocks]);

  // Attached texts carry their guide's geometry in their own fields, so a
  // drag, a mirror, or the orphan fallback below never sees stale values.
  // Derived state, like the orphan passes: no history.
  useEffect(() => {
    const synced = syncAttachedToGuides(blocks);
    if (synced !== blocks) setBlocks(synced);
  }, [blocks]);

  // An attached text whose guide vanished outside delete becomes a plain
  // Curve block. Like the mirror pass above: no history.
  useEffect(() => {
    if (!hasOrphanedAttachments(blocks)) return;
    setBlocks(dropOrphanedAttachments(blocks));
  }, [blocks]);

  const p1bSidebarProps: Partial<SidebarProps> = {
    onAddMirrorBlock: addMirrorBlock,
    canAddMirrorBlock: mirrorSourceCandidate != null,
    onSelectMirrorSource: () => {
      if (selectedMirrorSource) selectBlock(selectedMirrorSource.id);
    },
    mirrorSourceLabel: selectedMirrorSource
      ? selectedMirrorSource.name ?? `Block ${selectedMirrorSource.id}`
      : undefined,
  };
  const p1bCanvasProps: Partial<CanvasStageProps> = {};
  /**
   * The patch a tatweel-inserting text edit owes: the new text, plus every
   * field keyed by a source-text offset carried across the insertions.
   *
   * Both callers below go through this rather than restating the rule. Right
   * now that field is `strokeCuts`; the point of the helper is that the next
   * one is added here instead of at whichever call site its author happened
   * to be looking at — the omission CLAUDE.md records against
   * `runStyleForBlock`, where one caller gained a term inline and the other
   * silently went on without it.
   *
   * `strokeCuts` is left off the patch entirely when the block carries none,
   * so a block that never had the field does not acquire an empty array.
   */
  const kashidaTextPatch = useCallback(
    (block: Block, text: string, edits: readonly { index: number; delta: number }[]) => {
      const cuts = block.strokeCuts;
      const marks = block.detachedMarkOverrides;
      return {
        text,
        ...(cuts?.length ? { strokeCuts: remapCutsForEdits(cuts, edits) } : {}),
        ...(marks?.length ? { detachedMarkOverrides: remapMarksForEdits(marks, edits) } : {}),
      };
    },
    []
  );

  // Kashida is an ordinary text edit — `applyKashida` returns a new string
  // and it goes through `updateSelectedBlock` like anything the user could
  // have typed, so shaping, history (that call pushes it), saving, and every
  // downstream per-glyph consumer see exactly what they always see. That is
  // the point: the removed stroke-stretch kashida sat outside the text and
  // therefore never widened the shaped run at all.
  const setKashidaAtSlot = useCallback(
    (slot: KashidaSlot, count: number) => {
      if (!selectedBlock) return;
      const next = applyKashida(selectedBlock.text, slot, count);
      if (next === selectedBlock.text) return;
      // Stroke cuts are keyed by source-text offset, so inserting or removing
      // tatweels here moves every cut after the slot. `applyKashida` knows
      // exactly where it edited, so remap in the same patch — one
      // `pushHistory()` still covers the whole edit, and a stretch is not
      // silently dropped because an unrelated join was widened.
      const delta = next.length - selectedBlock.text.length;
      updateSelectedBlock(
        kashidaTextPatch(selectedBlock, next, [{ index: slot.index, delta }])
      );
    },
    [selectedBlock, updateSelectedBlock, kashidaTextPatch]
  );

  // Fit to width. The target defaults to the page's margin box — the content
  // area is what a line of text is actually meant to span — falling back to
  // the page edges when there is no margin. `fitTargetWidth` holds only a
  // user's *override* of that, so `null` means "track the page", and a
  // freeform document (which has no page at all) simply requires a typed
  // number. Not part of the document: it is a control setting, like the
  // export scale, so it is neither saved nor undoable.
  const [fitTargetWidth, setFitTargetWidth] = useState<number | null>(null);
  const [isFittingWidth, setIsFittingWidth] = useState(false);

  const fitTargetDefault = useMemo(() => {
    if (!artboard) return null;
    const box = marginRect(artboard) ?? artboardRect(artboard);
    return Math.round(box.width);
  }, [artboard]);

  const fitSelectedBlockToWidth = useCallback(
    async (target: number) => {
      if (!selectedBlock || selectedBlock.type !== "text") return;
      if (!Number.isFinite(target) || target <= 0) {
        setExportStatus("Enter a target width first.");
        return;
      }

      // The block is captured by id rather than by reference: solving is
      // async (it shapes several candidate strings), and the selection can
      // change while it runs — patching "the selected block" on the way out
      // would then rewrite whatever the user selected in the meantime.
      const { id, text, fontFamily, fontSize } = selectedBlock;
      const fontUrl = resolveFontUrl(fontFamily);
      // The italic shear, the faux-bold stroke, the outline and any
      // straight-stroke cuts all widen what is drawn beyond the glyph
      // outlines. Measuring without them would let the fit promise a width
      // an italic, outlined or stretched block then overshot.
      const runStyle = runStyleForBlock(selectedBlock, cutWidthForBlock(selectedBlock));

      setIsFittingWidth(true);
      try {
        const result = await solveFitToWidth({
          text,
          target,
          measure: (candidate) =>
            // Candidates only insert tatweel, which never moves a letter
            // ordinal, so the block's alternates apply to every one unchanged.
            measureShapedWidth(
              candidate,
              fontUrl,
              fontSize,
              runStyle,
              selectedBlock.glyphAlternates,
              selectedBlock.styleSets,
              spacingForBlock(selectedBlock)
            ),
        });
        // A no-op result must not push history — clicking Fit on an
        // already-fitted run should not cost an undo step.
        if (result.text !== text) {
          // A fit mutates the block's text, so it owes the same debt
          // `setKashidaAtSlot` pays: every straight-stroke cut is keyed by an
          // offset into that text, and inserting tatweels moves the ones
          // after each insertion. Without this the cuts survive the write and
          // are then dropped by `buildCutPlan`'s glyphId checksum — the
          // stretch vanishes, *and* the run comes out narrower than the fit
          // promised, because `cutWidthForBlock` had already counted those
          // cuts into the width being solved for.
          //
          // `result.edits` is highest-offset-first, which is the only order
          // this can run in: remapping upwards would shift each later edit's
          // offset by whatever an earlier one added.
          updateBlock(id, kashidaTextPatch(selectedBlock, result.text, result.edits));
        }
        setExportStatus(describeFitResult(result, target, text));
      } catch (err) {
        console.error("fit to width failed", err);
        setExportStatus("Could not fit this text to width.");
      } finally {
        setIsFittingWidth(false);
      }
    },
    [selectedBlock, updateBlock, kashidaTextPatch]
  );

  // Verse: several ordinary text blocks justified to one width and laid out
  // as stacked lines or bayt couplets. See .claude/rules/verse.md.
  const [isJustifyingVerse, setIsJustifyingVerse] = useState(false);

  /** A per-line measure: each line's own font, style, alternates and size. */
  const measureForLine = (line: TextBlock): LineMeasure => {
    const fontUrl = resolveFontUrl(line.fontFamily);
    return (text, fontSize, spacing) => {
      const sized = { ...line, fontSize };
      return measureShapedWidth(
        text,
        fontUrl,
        fontSize,
        runStyleForBlock(sized, cutWidthForBlock(sized)),
        line.glyphAlternates,
        line.styleSets,
        spacing
      );
    };
  };

  /**
   * Measures and solves every line, returning one patch per line id. Async and
   * side-effect free; callers push history and write the patches in one go,
   * so a whole verse is one undo step.
   */
  const solveVerse = async (
    lines: readonly TextBlock[],
    verseId: number,
    settings: VerseSettings,
    anchor: { x: number; y: number }
  ) => {
    const inputs = lines.map((line) => ({
      line,
      measure: measureForLine(line),
      baseFontSize: baseFontSizeForLine(line),
      base: baseSpacingForLine(line),
    }));
    const target =
      settings.width ??
      Math.max(
        0,
        ...(await Promise.all(
          inputs.map((i) => naturalWidth(i.line.text, i.baseFontSize, i.base, i.measure))
        ))
      );
    const results: JustifyLineResult[] = [];
    for (const i of inputs) {
      results.push(
        await justifyLine({
          text: i.line.text,
          baseFontSize: i.baseFontSize,
          userSpacing: i.base,
          target,
          measure: i.measure,
        })
      );
    }
    const positions = layoutVerse(
      lines.length,
      { ...settings, target, fontSize: inputs[0]?.baseFontSize ?? DEFAULT_NEW_BLOCK_FONT_SIZE },
      anchor
    );
    const patches = new Map<number, Partial<TextBlock>>();
    inputs.forEach((i, index) => {
      const r = results[index];
      patches.set(i.line.id, {
        ...kashidaTextPatch(i.line, r.text, r.edits),
        fontSize: r.fontSize,
        letterSpacing: i.base.letter + r.addedLetter,
        wordSpacing: i.base.word + r.addedWord,
        x: positions[index].x,
        y: positions[index].y,
        align: "center",
        verse: {
          ...settings,
          id: verseId,
          index,
          baseFontSize: i.baseFontSize,
          fittedFontSize: r.fontSize,
          baseLetterSpacing: i.base.letter,
          baseWordSpacing: i.base.word,
          fittedLetterSpacing: i.base.letter + r.addedLetter,
          fittedWordSpacing: i.base.word + r.addedWord,
        },
      });
    });
    return { patches, status: describeVerseResult(results, target) };
  };

  /** Re-justifies the selected block's verse, optionally with new settings. One undo step. */
  const justifyVerse = async (overrides?: Partial<VerseSettings>) => {
    if (!selectedBlock || selectedBlock.type !== "text" || !selectedBlock.verse) return;
    if (isJustifyingVerse) return;
    const verseId = selectedBlock.verse.id;
    const lines = blocks
      .filter((b): b is TextBlock => b.type === "text" && b.verse?.id === verseId)
      .sort((a, b) => a.verse!.index - b.verse!.index || a.id - b.id);
    const tag = lines[0].verse!;
    const settings: VerseSettings = {
      layout: tag.layout,
      width: tag.width,
      lineGap: tag.lineGap,
      columnGap: tag.columnGap,
      ...overrides,
    };
    // Read the anchor in the layout the blocks are in *now*, before any
    // override changes it — that is what keeps a dragged verse in place.
    const anchor = verseAnchor(
      lines.map((l) => ({ x: l.x, y: l.y, index: l.verse!.index })),
      tag.layout
    );
    const solvedText = new Map(lines.map((l) => [l.id, l.text]));
    setIsJustifyingVerse(true);
    // Pushed before the await, while this render's snapshot is still the
    // current state: after it, `pushHistory` would snapshot the blocks as they
    // were at the click, folding any edit made during the solve into this undo.
    pushHistory();
    try {
      const { patches, status } = await solveVerse(lines, verseId, settings, anchor);
      setBlocks((prev) =>
        prev.map((b) => {
          const patch = patches.get(b.id);
          // A line deleted during the solve has no entry to match, and one
          // whose text was edited meanwhile keeps the edit; the rest land.
          if (!patch || b.text !== solvedText.get(b.id)) return b;
          return { ...b, ...patch } as Block;
        })
      );
      setExportStatus(status);
    } catch (err) {
      console.error("verse justify failed", err);
      setExportStatus("Could not justify this verse.");
    } finally {
      setIsJustifyingVerse(false);
    }
  };

  /** Creates a verse from typed lines, justified and laid out. One undo step. */
  const createVerse = async (rawLines: string[], layout: VerseLayout) => {
    const texts = rawLines.map((l) => l.trim()).filter((l) => l !== "");
    if (texts.length === 0) {
      setExportStatus("Type at least one line of verse.");
      return;
    }
    // A justified line's size and spacing include Justify's own shrink and
    // fill; the new verse starts from that line's base, not from those.
    const style: Partial<Block> =
      selectedBlock?.type === "text"
        ? {
            ...styleToPatch(captureStyle(selectedBlock, "verse")),
            fontSize: baseFontSizeForLine(selectedBlock),
            letterSpacing: baseSpacingForLine(selectedBlock).letter,
            wordSpacing: baseSpacingForLine(selectedBlock).word,
          }
        : {};
    const verseId =
      1 + Math.max(0, ...blocks.map((b) => (b.type === "text" ? b.verse?.id ?? 0 : 0)));
    const groupId = texts.length > 1 ? nextGroupIdRef.current++ : undefined;
    const settings: VerseSettings = {
      layout,
      lineGap: DEFAULT_LINE_GAP,
      columnGap: DEFAULT_COLUMN_GAP,
    };
    const lines: TextBlock[] = texts.map(
      (text) =>
        ({
          ...DEFAULT_BLOCK,
          fontSize: DEFAULT_NEW_BLOCK_FONT_SIZE,
          ...style,
          id: createNextId(),
          text,
          type: "text",
          groupId,
        }) as TextBlock
    );
    const fontSize = lines[0].fontSize;
    const rows = layout === "bayt" ? Math.ceil(lines.length / 2) : lines.length;
    // Centre the new verse on the artboard (whose centre is the origin) or the
    // freeform origin, which is where a fresh session's content sits.
    const anchor = { x: 0, y: -((rows - 1) * DEFAULT_LINE_GAP * fontSize) / 2 };
    setIsJustifyingVerse(true);
    // Before the await, for the reason `justifyVerse` gives.
    pushHistory();
    try {
      const { patches, status } = await solveVerse(lines, verseId, settings, anchor);
      const built: Block[] = lines.map((l) => ({ ...l, ...patches.get(l.id) }));
      setBlocks((prev) => [...prev, ...built]);
      setSelectedIds([]);
      setSelectedId(built[0].id);
      setExportStatus(status);
    } catch (err) {
      console.error("verse create failed", err);
      setExportStatus("Could not create this verse.");
    } finally {
      setIsJustifyingVerse(false);
    }
  };

  /**
   * Compositions: add the companion blocks the chosen layout needs around the
   * selected text, in the font it already has.
   *
   * Modeled on `fitSelectedBlockToWidth` directly above, for the same reason:
   * it has to shape the text to find out how wide it draws, so it is async,
   * and the selection can change while it runs. The block is therefore
   * **captured by id** — inserting around "the selected block" on the way
   * out would build around whatever the user selected in the meantime. When
   * shaping fails the composition still happens, on a rough estimate — a
   * loose arrangement the user can drag into place beats no arrangement.
   *
   * One `pushHistory()` covers the added blocks, so a whole composition is a
   * single undo.
   */
  const applyComposition = async (selection: CompositionSelection) => {
    const source = selectedBlock;
    if (!source || source.type !== "text") return;
    if (source.text.trim() === "") {
      setExportStatus("Type some text into this block first.");
      return;
    }

    const { id, text, fontSize, lineHeight, fontFamily } = source;

    let run = estimateRunBox(text, fontSize);
    try {
      const measured = await measureShapedRun(
        text,
        resolveFontUrl(fontFamily),
        fontSize,
        // The same terms `fitSelectedBlockToWidth` measures with: the
        // outlines are not the whole of what is drawn, and a composition
        // spaced by outlines alone sets an italic, outlined or stretched
        // text too close to its own reflection.
        runStyleForBlock(source, cutWidthForBlock(source)),
        undefined,
        undefined,
        spacingForBlock(source)
      );
      run = normalizeRunBox(measured, fontSize, lineHeight);
    } catch (err) {
      console.error("composition measurement failed", err);
    }

    // `CompositionSelection` is `CompositionRequest` minus the two fields
    // only this handler can supply, so spreading it cannot leave one behind.
    const plan = buildComposition({ source, run, ...selection }, createNextId);

    pushHistory();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      // The block was deleted while we were measuring; there is nothing to
      // build the composition around any more.
      if (index < 0) return prev;
      // A reflection is a peer and goes on top, where every new block goes.
      return [...prev, ...plan.added];
    });
    setExportStatus(describeComposition(plan));
  };

  /**
   * Bake the selected text block into a stack block. One-way (undo restores
   * the text block). Captured by id like `applyComposition`: shaping is
   * async and the selection can change meanwhile.
   *
   * Joins the detector cannot cut get a tatweel inserted and are cut there
   * instead — only when the shaped text equals the block text (the cluster
   * offsets index the shaped text) and the block has no diacritic overrides
   * (they are keyed by glyph index, which an insertion shifts). A tatweel is
   * kept only at a slot it actually made joinable; the status says how many.
   */
  const convertSelectedBlockToStack = async () => {
    const source = selectedBlock;
    if (!source || source.type !== "text") return;
    if (source.text.trim() === "") { setExportStatus("Type some text into this block first."); return; }
    if (source.verse) {
      setExportStatus("Verse lines cannot be converted to a stacked composition yet. Remove the line from its verse first.");
      return;
    }
    if (source.fontStyle && source.fontStyle !== "normal") {
      setExportStatus("Turn off italic and bold before converting to a stacked composition.");
      return;
    }
    if ([...source.text].some((ch) => isOverrideGlyphChar(ch.codePointAt(0)))) {
      setExportStatus("Honorific glyphs cannot be converted to a stacked composition.");
      return;
    }
    const { id, fontFamily, fontSize } = source;
    const fontUrl = resolveFontUrl(fontFamily);
    const overrides = source.diacriticOverrides ?? [];
    const marks = source.detachedMarkOverrides ?? [];
    const baseCuts = source.strokeCuts ?? [];
    const shapeAndConvert = async (text: string, cuts: StrokeCut[]) => {
      const shaped = await shapeText(text, fontUrl, source.glyphAlternates, source.styleSets);
      const upm = Math.max(shaped.unitsPerEm || 1000, 1);
      const glyphs = applySpacing(shaped.glyphs, shaped.shapableText, spacingForBlock(source), upm);
      const cutPlan = cuts.length ? buildCutPlan(glyphs, cuts, nuqtaUnits(fontFamily, upm)) : null;
      const result = convertRunToStack({
        glyphs, font: shaped.font, unitsPerEm: upm, shapableText: shaped.shapableText,
        cutPlan, diacriticOverrides: overrides, fontSize,
        detachedMarkOverrides: marks, fontFamily,
      });
      return { shaped, upm, result };
    };
    /** One tatweel at the slot of each pair, always from the block's own text,
     *  highest offset first so earlier insertions do not move later ones. */
    const withTatweels = (pairs: readonly UnjoinedPair[]) => {
      let text = source.text;
      const slots = findKashidaSlots(text);
      const counts = readKashida(text, slots);
      const edits: { index: number; delta: number; pair: UnjoinedPair }[] = [];
      for (const u of [...pairs].sort((a, b) => b.laterCl - a.laterCl)) {
        const slot = slots.find((sl) => sl.index > u.earlierCl && sl.index <= u.laterCl);
        if (!slot) continue;
        const next = applyKashida(text, slot, (counts.get(slot.index) ?? 0) + 1);
        edits.push({ index: slot.index, delta: next.length - text.length, pair: u });
        text = next;
      }
      return { text, edits, cuts: remapCutsForEdits(baseCuts, edits) };
    };
    try {
      let { shaped, upm, result } = await shapeAndConvert(source.text, baseCuts);
      let inserted = 0;
      const before = result.unjoined.length;
      // Mark overrides are keyed by cluster like cuts, but the retry re-shapes
      // from scratch, so it is refused the same way tashkeel overrides are.
      if (before > 0 && shaped.shapableText === source.text && overrides.length === 0 && marks.length === 0) {
        const all = withTatweels(result.unjoined);
        if (all.edits.length) {
          const trial = await shapeAndConvert(all.text, all.cuts);
          // An original offset in the retried text: every insertion at or
          // before it pushed it along.
          const moved = (p: number) => p + all.edits.reduce((n, e) => n + (e.index <= p ? e.delta : 0), 0);
          const still = new Set(trial.result.unjoined.map((u) => u.earlierCl));
          const helped = all.edits.filter((e) => !still.has(moved(e.pair.earlierCl))).map((e) => e.pair);
          if (helped.length === all.edits.length) {
            if (trial.result.unjoined.length < before) {
              ({ shaped, upm, result } = trial);
              inserted = all.edits.length;
            }
          } else if (helped.length > 0) {
            // Again from the block's own text, with only the tatweels that
            // helped, so none is left at a slot that stayed unjoined.
            const some = withTatweels(helped);
            const kept = await shapeAndConvert(some.text, some.cuts);
            if (kept.result.unjoined.length < before) {
              ({ shaped, upm, result } = kept);
              inserted = some.edits.length;
            }
          }
        }
      }
      const nib = { width: nuqtaUnits(fontFamily, upm), minFraction: nibFloorFraction(fontFamily) };
      // The stack centres its ink on (x, y); a left- or right-aligned text
      // block anchors an edge there instead (ShapedText's `bx`). Keep that
      // edge where it was, along the block's own rotated x axis.
      const align = source.align ?? "center";
      let { x, y } = source;
      if (align !== "center") {
        const ink = outlineBounds(assembleStackOutline(result.pieces, result.joins, nib));
        const bw = Math.max((ink.x2 - ink.x1) * (fontSize / upm), 20);
        const dx = align === "left" ? bw / 2 : -bw / 2;
        const r = ((source.rotation ?? 0) * Math.PI) / 180;
        x += dx * Math.cos(r);
        y += dx * Math.sin(r);
      }
      const stack: StackBlock = {
        id, type: "stack", name: source.name, text: source.text, x, y,
        fontSize, color: source.color, fontFamily, fontStyle: source.fontStyle, opacity: source.opacity,
        stroke: source.stroke, strokeWidth: source.strokeWidth, shadowColor: source.shadowColor,
        shadowBlur: source.shadowBlur, shadowOffsetX: source.shadowOffsetX, shadowOffsetY: source.shadowOffsetY,
        shadowOpacity: source.shadowOpacity, locked: source.locked, rotation: source.rotation,
        groupId: source.groupId, fill: source.fill,
        source: { text: source.text, fontFamily },
        unitsPerEm: upm,
        nib,
        pieces: result.pieces, joins: result.joins,
      };
      replaceBlockWithHistory(id, stack);
      const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
      const parts: string[] = [];
      if (inserted > 0) parts.push(`${plural(inserted, "tatweel")} inserted to make joins`);
      if (result.unjoined.length > 0) {
        parts.push(`${plural(result.unjoined.length, "join")} could not be cut and stay rigid`);
      }
      setExportStatus(parts.length ? `Converted; ${parts.join("; ")}.` : "Converted to a stacked composition.");
    } catch (err) {
      console.error("stack conversion failed", err);
      setExportStatus("Could not convert this block.");
    }
  };

  const p1dSidebarProps: Partial<SidebarProps> = {
    kashidaSlotOrdinal,
    onSelectKashidaSlot: setKashidaSlotOrdinal,
    onSetKashidaAtSlot: setKashidaAtSlot,
    fitTargetOverride: fitTargetWidth,
    fitTargetPageDefault: fitTargetDefault,
    isFittingWidth,
    onChangeFitTargetWidth: setFitTargetWidth,
    onFitToWidth: fitSelectedBlockToWidth,
    onCreateVerse: createVerse,
    onJustifyVerse: justifyVerse,
    isJustifyingVerse,
  };

  // Phase 2 (2026-08-14 run) prop bundles — same mechanism as the p1* set
  // above, which is now finished feature code. Each stream fills only its
  // own; all are already spread at the call sites. F's canvas bundle is how
  // the page surface reaches CanvasStage's `surfaceRectProps` seam.
  // ---- STREAM-E: styles & palettes — handlers & props ----
  // The one mutating primitive this stream needs. `updateSelectedBlock` patches
  // the single selected block; a style is meant to bring a whole selection into
  // line, so this walks `effectiveSelectedIds` instead — with **one**
  // `pushHistory()` for the gesture, so applying a style to six blocks is one
  // undo rather than six.
  const patchSelectedBlocks = useCallback(
    (patch: Partial<Block>) => {
      if (effectiveSelectedIds.length === 0) return;
      const ids = new Set(effectiveSelectedIds);
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (ids.has(b.id) ? ({ ...b, ...patch } as Block) : b))
      );
    },
    [effectiveSelectedIds, pushHistory]
  );

  const palettes = useMemo(() => allPalettes(userPalettes), [userPalettes]);

  // Selecting a style loads its name into the save field, so overwriting the
  // style you just applied is one click — the same affordance `selectExportPreset`
  // offers for presets.
  const selectTextStyle = (id: string) => {
    setSelectedTextStyleId(id);
    const style = textStyles.find((s) => s.id === id);
    if (style) setNewTextStyleName(style.name);
  };

  const applyTextStyle = () => {
    const style = textStyles.find((s) => s.id === selectedTextStyleId);
    if (!style) return;
    patchSelectedBlocks(styleToPatch(style));
  };

  const saveTextStyleFromBlock = () => {
    const name = newTextStyleName.trim();
    if (!name || !selectedBlock) return;
    // Overwrite by name, matching the export-preset and named-project stores.
    const existing = textStyles.find((s) => s.name === name);
    const style = captureStyle(selectedBlock, name);
    const next = upsertStyle(textStyles, existing ? { ...style, id: existing.id } : style);
    setTextStyles(next);
    saveStyles(next);
    setSelectedTextStyleId(existing?.id ?? style.id);
  };

  const deleteTextStyle = () => {
    if (!selectedTextStyleId) return;
    const next = removeStyle(textStyles, selectedTextStyleId);
    setTextStyles(next);
    saveStyles(next);
    setSelectedTextStyleId("");
  };

  // A palette built from what is already on the canvas: every block's ink and
  // outline colour, de-duplicated in the order they are met, capped by the
  // store's own limit. Named rather than prompted-for, and overwritten by that
  // name, so re-running it after a colour change refreshes the palette in place.
  const savePaletteFromCanvas = () => {
    const seen: string[] = [];
    for (const b of blocks) {
      for (const c of [b.color, b.stroke]) {
        if (typeof c !== "string" || !c) continue;
        const key = c.toLowerCase();
        if (!seen.some((s) => s.toLowerCase() === key)) seen.push(c);
      }
    }
    if (seen.length === 0) return;
    const name = "From canvas";
    const existing = userPalettes.find((p) => p.name === name);
    const palette: Palette = {
      id: existing?.id ?? `palette-${Date.now().toString(36)}`,
      name,
      colors: seen.slice(0, MAX_PALETTE_COLORS),
    };
    const next = upsertPalette(userPalettes, palette);
    setUserPalettes(next);
    savePalettes(next);
    setSelectedPaletteId(palette.id);
  };

  const deletePalette = () => {
    // The shipped palettes live in code, so there is nothing to delete for them
    // — `removePalette` is a no-op on a default id, and the button is disabled.
    const next = removePalette(userPalettes, selectedPaletteId);
    if (next.length === userPalettes.length) return;
    setUserPalettes(next);
    savePalettes(next);
    setSelectedPaletteId(DEFAULT_PALETTES[0].id);
  };

  const p2eSidebarProps: Partial<SidebarProps> = {
    textStyles,
    selectedTextStyleId,
    onSelectTextStyle: selectTextStyle,
    onApplyTextStyle: applyTextStyle,
    newTextStyleName,
    onChangeNewTextStyleName: setNewTextStyleName,
    onSaveTextStyle: saveTextStyleFromBlock,
    onDeleteTextStyle: deleteTextStyle,
    palettes,
    selectedPaletteId,
    onSelectPalette: setSelectedPaletteId,
    onPickPaletteColor: (color: string) => patchSelectedBlocks({ color }),
    onSavePaletteFromCanvas: savePaletteFromCanvas,
    onDeletePalette: deletePalette,
    canDeletePalette: userPalettes.some((p) => p.id === selectedPaletteId),
  };
  // ---- /STREAM-E ----
  // ---- STREAM-F: ink & surface — handlers & props ----
  // A solid fill keeps writing the block's own `color` and clears `fill`, so
  // a block only ever carries the new field while it is actually a gradient.
  // That is what makes every pre-existing block and save render unchanged,
  // and it keeps `color` meaningful for everything else that reads it.
  const setBlockFill = useCallback(
    (fill: BlockFill | undefined) => {
      pushHistory();
      if (!fill || fill.type === "solid") {
        updateSelectedBlock({ fill: undefined, ...(fill ? { color: fill.color } : {}) });
      } else {
        updateSelectedBlock({ fill });
      }
    },
    [pushHistory, updateSelectedBlock]
  );

  const changeArtboardSurface = useCallback((patch: Partial<ArtboardSurface>) => {
    setArtboardSurface((prev) => ({ ...prev, ...patch }));
  }, []);

  const surfaceTexture = getTexture(artboardSurface.textureId);
  const surfaceTint = artboardSurface.tint ?? surfaceTexture?.defaultTint ?? backgroundColor;

  // The tile is rasterized once per (texture, tint) and handed to Konva as an
  // <img>. `textureTileUrl` caches the data URL, so this only regenerates
  // when the paper actually changes — not on every render or every drag.
  const [surfaceImage, setSurfaceImage] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    if (!surfaceTexture) {
      setSurfaceImage(null);
      return;
    }
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (live) setSurfaceImage(img);
    };
    img.src = textureTileUrl(surfaceTexture, surfaceTint);
    return () => {
      live = false;
    };
  }, [surfaceTexture, surfaceTint]);

  const p2fSidebarProps: Partial<SidebarProps> = {
    blockFill: selectedBlock?.fill,
    blockColor: selectedBlock?.color,
    onSetBlockFill: setBlockFill,
    fillPresets: GOLD_PRESETS,
    textures: TEXTURES,
    artboardSurface,
    onChangeArtboardSurface: changeArtboardSurface,
  };
  const p2fCanvasProps: Partial<CanvasStageProps> = {
    // Spread last into the page rect, so these win over its flat `fill`.
    // Nothing else about the rect changes — which is also why the export
    // path's existing "hide #artboard-background when transparent" already
    // suppresses the texture, with no export-side change at all.
    surfaceRectProps: surfaceImage
      ? {
          fillPriority: "pattern",
          fillPatternImage: surfaceImage,
          fillPatternRepeat: "repeat",
        }
      : undefined,
  };
  // ---- /STREAM-F ----
  // ---- STREAM-G: font upload — handlers & props ----
  // Loads every stored font, creates its object URL and registers its
  // FontFace. Until this resolves `resolveFontUrl` answers Noto Sans for a
  // custom family; settling this state is what re-renders the blocks onto
  // their real bytes (the shaping hook keys on the URL it computes).
  useEffect(() => {
    let alive = true;
    primeCustomFonts()
      .then((fonts) => {
        if (alive) setCustomFonts(fonts);
      })
      .catch(() => {
        // Storage unavailable — the app runs with the bundled fonts only.
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleAddCustomFont = useCallback(async (file: File, label?: string) => {
    const result = await addCustomFont(file, label);
    if (!("error" in result)) setCustomFonts(await listCustomFonts());
    return result;
  }, []);

  const handleRemoveCustomFont = useCallback(async (key: string) => {
    await removeCustomFont(key);
    setCustomFonts(await listCustomFonts());
  }, []);

  // A block keeps its font key even when nothing can resolve it — deleting an
  // upload, or opening a project saved in another browser. The render falls
  // back to Noto Sans on its own; this is what makes that fallback *visible*,
  // since a silently substituted font is the exact misdiagnosis trap CLAUDE.md
  // records for a missing FONT_URLS entry. In an effect over `blocks` rather
  // than inside the load handlers, so every route is covered (load, project
  // open, undo, deleting a font a live block uses) — the `dropOrphanedMirrors`
  // effect above is the same shape and the same reasoning.
  useEffect(() => {
    const missing = [
      ...new Set(
        blocks
          .filter(hasOwnFont)
          .map((b) => b.fontFamily)
          .filter((key) => key && isFontUnavailable(key, FONT_URLS))
      ),
    ];
    if (missing.length === 0) {
      // Only ever clears a message this effect wrote — an export result
      // sharing the row must not be wiped by an unrelated block edit.
      if (fontNoticeShownRef.current) {
        fontNoticeShownRef.current = false;
        setExportStatus(null);
      }
      return;
    }
    const named = missing.map((key) => `'${describeFontKey(key)}'`).join(", ");
    fontNoticeShownRef.current = true;
    setExportStatus(
      `${missing.length > 1 ? "Fonts" : "Font"} ${named} ${
        missing.length > 1 ? "aren't" : "isn't"
      } available in this browser — using Noto Sans.`
    );
  }, [blocks, customFonts]);

  const selectedFontUnavailable =
    !!selectedBlock && hasOwnFont(selectedBlock) && isFontUnavailable(selectedBlock.fontFamily, FONT_URLS);

  const p2gSidebarProps: Partial<SidebarProps> = {
    customFonts,
    fontChoices,
    onAddCustomFont: handleAddCustomFont,
    onRemoveCustomFont: handleRemoveCustomFont,
    missingFontKey: selectedFontUnavailable ? selectedBlock.fontFamily : null,
  };
  // ---- /STREAM-G ----

  return (
    <div
      style={{
        height: "100vh",
        width: "100vw",
        display: "flex",
        flexDirection: isMobile ? "column" : "row",
        margin: 0,
        padding: 0,
        overflow: "hidden",
        background: "var(--bg-page)",
      }}
    >
      {/* The start screen is a modal overlay: `inert` takes everything under it
          out of the tab order and the pointer, so Tab cannot reach Add text or
          Quick save behind it. `display: contents` keeps this wrapper out of the
          root's flex layout. */}
      <div style={{ display: "contents" }} inert={showStart}>
      <Sidebar
        onConvertToStack={convertSelectedBlockToStack}
        onResetStackLayout={resetStackLayout}
        onArrangeStackInGuide={arrangeStackInGuide}
        stackMoveTogether={stackMoveTogether}
        onStackMoveTogether={setStackMoveTogether}
        stackFillGaps={stackFillGaps}
        onStackFillGaps={setStackFillGaps}
        blocks={blocks}
        selectedBlock={selectedBlock}
        selectedIds={selectedIds}
        showGrid={showGrid}
        snapToGrid={snapToGrid}
        isMobile={isMobile}
        width={effectiveSidebarWidth}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        backgroundColor={backgroundColor}
        onChangeBackgroundColor={(color) => {
          pushHistory();
          setBackgroundColor(color);
        }}
        onAddBlock={addBlock}
        onDuplicateBlock={duplicateSelectedBlock}
        onDeleteBlock={deleteSelectedBlock}
        onExportPNG={() => handleExportPNG(transparentExport)}
        onExportJPEG={handleExportJPEG}
        onExportSVG={() => handleExportSVG(transparentExport)}
        onExportPDF={handleExportPDF}
        transparentExport={transparentExport}
        onToggleTransparentExport={setTransparentExport}
        onSaveLayout={saveLayout}
        onLoadLayout={loadLayout}
        onDownloadLayout={downloadLayout}
        onUploadLayout={uploadLayout}
        cloudConfigured={cloudConfigured}
        session={session}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        saveDestination={saveDestination}
        onChangeSaveDestination={setSaveDestination}
        namedProjects={namedProjects}
        onSaveNamedProject={saveNamedProject}
        onLoadNamedProject={loadNamedProject}
        onDeleteNamedProject={requestDeleteNamedProject}
        onAddShapeFillBlock={addShapeFillBlock}
        onAddTextPathBlock={addTextPathBlock}
        onAddGuide={addGuideBlock}
        onAddSvgGuide={addSvgGuideBlock}
        onUpdateGuideParams={updateGuideParams}
        onAddTextToGuide={addTextToGuide}
        onAttachToGuide={attachSelectedToGuide}
        onDetachFromGuide={detachSelectedFromGuide}
        onUpdateGuideAttachment={updateGuideAttachment}
        guideShrink={guideShrink}
        onGenerateFromTemplate={generateFromTemplate}
        onRandomizeLayout={randomizeLayout}
        onToggleGrid={setShowGrid}
        onToggleSnap={setSnapToGrid}
        showRulers={showRulers}
        onToggleRulers={setShowRulers}
        guideCount={guides.horizontal.length + guides.vertical.length}
        onClearGuides={clearGuides}
        onSelectBlock={selectBlock}
        editRequestSignal={editRequestSignal}
        onUpdateSelectedBlock={updateSelectedBlock}
        onUpdateBlock={updateBlock}
        onReorderBlocks={reorderBlocks}
        onMergeBlocks={groupBlocks}
        onUngroupBlock={ungroupBlock}
        onZoomToBlock={zoomToBlock}
        onClearDiacritics={clearDiacritics}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        historyEntries={historyEntries}
        onJumpToHistory={jumpBy}
        onCaptureCurrentThumbnail={captureHistoryThumbnail}
        onToggleDiacriticEditMode={() => {
          if (!selectedBlock || selectedBlock.type !== "shapeFill") return;
          updateSelectedBlock({
            diacriticEditMode: !selectedBlock.diacriticEditMode,
          });
        }}
        onToggleStrokeCutMode={toggleStrokeCutMode}
        glyphAlternatesState={glyphAlternatesState}
        alternateTarget={alternateTarget}
        onToggleGlyphAlternateMode={toggleGlyphAlternateMode}
        onResetGlyphAlternates={resetGlyphAlternates}
        onPickGlyphAlternate={pickGlyphAlternate}
        styleSetsState={styleSetsState}
        onToggleStyleSet={toggleStyleSet}
        onClearStrokeCuts={clearStrokeCuts}
        onToggleDetachedMarkMode={toggleDetachedMarkMode}
        onClearDetachedMarks={clearDetachedMarks}
        onFitShapeFillSpacing={fitShapeFillSpacing}
        onAlignSelected={alignSelectedBlocks}
        onDistributeSelected={distributeSelectedBlocks}
        onGroupSelected={groupSelectedBlocks}
        {...streamASidebarProps}
        {...streamCSidebarProps}
        {...streamDSidebarProps}
        {...p1aSidebarProps}
        {...p1bSidebarProps}
        {...p1dSidebarProps}
        {...p2eSidebarProps}
        {...p2fSidebarProps}
        {...p2gSidebarProps}
        onApplyComposition={applyComposition}
      />

      {!isMobile && !sidebarCollapsed && (
        <div
          onMouseDown={startSidebarResize}
          style={{
            width: 6,
            cursor: "col-resize",
            background:
              "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.06), rgba(0,0,0,0))",
            flexShrink: 0,
          }}
        />
      )}

      <div
        ref={canvasContainerRef}
        style={{
          flex: 1,
          position: "relative",
          height: stageViewportHeight,
          overflow: "hidden",
        }}
      >
        <CanvasStage
          blocks={blocks}
          selectedId={selectedId}
          selectedIds={selectedIds}
          snapToGrid={snapToGrid}
          showGrid={showGrid}
          showRulers={showRulers}
          guides={guides}
          onAddGuide={addGuide}
          onMoveGuide={moveGuide}
          onRemoveGuide={removeGuide}
          {...streamACanvasProps}
          {...p1aCanvasProps}
          {...p1bCanvasProps}
          {...p2fCanvasProps}
          viewportWidth={canvasWidth}
          stageViewportHeight={stageViewportHeight}
          backgroundColor={backgroundColor}
          stageRef={stageRef}
          stageScale={stageScale}
          stagePosition={stagePosition}
          panMode={panMode}
          onTogglePanMode={setPanMode}
          onUpdateStage={updateStageZoom}
          onResetView={resetView}
          onZoomToActualSize={zoomToActualSize}
          onUpdateBlockPosition={updateBlockPositionWithHistory}
          onSelectBlock={selectBlock}
          onEditBlock={requestTextEdit}
          onUpdateTextPathD={updateTextPathD}
          onUpdateGuideD={updateGuideD}
          onGuideLayout={reportGuideLayout}
          onSlideAlongGuide={slideAlongGuide}
          writing={writing}
          onBeginWritingOnGuide={beginWritingOnGuide}
          onBeginWritingText={beginWritingText}
          onWriteText={writeText}
          onEndWriting={endWriting}
          onBeginTextPathEdit={pushHistory}
          onBeginDiacriticDrag={pushHistory}
          onDragDiacriticOverride={dragDiacriticOverride}
          onToggleDiacriticHidden={toggleDiacriticHidden}
          onBeginStrokeCut={pushHistory}
          onBeginDetachedMarkDrag={pushHistory}
          onSetDetachedMark={setDetachedMark}
          onBeginStackEdit={pushHistory}
          onSetStackPieces={setStackPieces}
          onSetStackJoinBow={setStackJoinBow}
          onSplitStackPiece={splitStackPiece}
          onBendStackCurve={bendStackCurve}
          stackMoveTogether={stackMoveTogether}
          alternateLetters={glyphAlternatesState.letters}
          onPickGlyphAlternate={pickGlyphAlternate}
          onSetStrokeCut={setStrokeCut}
          onResizeShapeFillBlock={resizeShapeFillBlock}
          ghostBlock={
            pendingPlacement
              ? {
                  x: pendingPlacement.block.x,
                  y: pendingPlacement.block.y,
                  width: pendingPlacement.width,
                  height: pendingPlacement.height,
                  label: pendingPlacement.label,
                }
              : null
          }
        />
      </div>
      </div>

      <ConfirmDialog request={confirmRequest} onCancel={() => setConfirmRequest(null)} />
      {showStart && <StartScreen fonts={fontChoices} onPick={beginFromStart} onSkip={() => setShowStart(false)} />}
    </div>
  );
};

export default App;