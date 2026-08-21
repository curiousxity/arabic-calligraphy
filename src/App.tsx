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
import { arcPathD } from "./lib/textPath";
import type { Block, DiacriticOverride, GlyphTransform, StrokeCut } from "./types";
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
import type { MirrorMode } from "./types";
import { applyKashida, type KashidaSlot } from "./lib/tatweel";
import { solveFitToWidth, type FitToWidthResult } from "./lib/fitToWidth";
import { mergeGlyphTransform } from "./lib/glyphTransform";
import { measureShapedRun, measureShapedWidth } from "./lib/measureShapedText";
import { cutAdvanceTotal, remapCutsAfterInsert } from "./lib/strokeCuts";
import { nuqtaUnits } from "./lib/nuqta";
import {
  buildNameDesign,
  describeNameDesign,
  estimateRunBox,
  normalizeRunBox,
} from "./lib/nameDesign";
import type { NameDesignSelection } from "./components/NameDesignDialog";

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
 * per-type placement convention (text is center-anchored, shape/image
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

/**
 * The three block types whose renderers mount DiacriticHoverHandles. Image
 * and textPath blocks inherit `diacriticOverrides` from BlockCommon but have
 * no way to edit or apply it, so the mutators below must not write to them.
 */
const supportsDiacriticOverrides = (
  b: Block
): b is Extract<Block, { type: "text" | "shapeFill" }> =>
  b.type === "text" || b.type === "shapeFill";

/**
 * Plain text blocks only for v1 — the other block types carry the
 * `glyphTransforms`/`glyphTransformMode` fields via BlockCommon but no other
 * renderer reads them, so accepting an edit there would silently discard it.
 */
const supportsGlyphTransforms = (b: Block): b is Extract<Block, { type: "text" }> =>
  b.type === "text";

/**
 * Plain text blocks only, for the same reason as `supportsGlyphTransforms`
 * above: every block type carries `strokeCuts` via BlockCommon, but only
 * `ShapedText` performs the outline surgery, so a wider guard would accept
 * edits here and silently discard them — the trap CLAUDE.md records against
 * `supportsDiacriticOverrides`.
 */
const supportsStrokeCuts = (b: Block): b is Extract<Block, { type: "text" }> =>
  b.type === "text";

const STORAGE_KEY = "calligraphy-layout-v2";
const NAMED_PROJECTS_KEY = "harfcanvas-named-projects-v1";
const SIDEBAR_COLLAPSED_WIDTH = 28;
/** Zoom level for the very first paint of the default starter content (a fresh session, no saved layout). */
const INITIAL_VIEW_SCALE = 2.75;
const DEFAULT_TEXT_FONT_SIZE = 53;
const DEFAULT_NEW_BLOCK_FONT_SIZE = 53;

const DEFAULT_BLOCK: Block = {
  id: 1,
  text: "حرف",
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
  ornamental: false,
  warpX: 0,
  warpY: 0,
  type: "text",
};

const isBrowser = typeof window !== "undefined";

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/**
 * Fields the removed Morph Glyph Editor wrote onto blocks. A project saved
 * before 2026-08-14 still carries them; nothing reads them any more, so they
 * are stripped on load rather than left to ride along in every subsequent
 * save — same treatment, and the same reasoning, as the `shapeWarp` filter
 * in `applyParsedLayoutPayload`.
 */
const MORPH_BLOCK_FIELDS = [
  "glyphEdits",
  "glyphRigValues",
  "glyphMaskEdit",
  "glyphEditTool",
  "selectedGlyphIndex",
  "kashidaAmount",
  "kashidaEditMode",
] as const;

const stripMorphFields = (block: Block): Block => {
  const next = { ...block } as Block & Record<string, unknown>;
  for (const field of MORPH_BLOCK_FIELDS) delete next[field];
  return next;
};

const App: React.FC = () => {
  const [confirmRequest, setConfirmRequest] = useState<ConfirmDialogRequest | null>(null);
  const [pendingPlacement, setPendingPlacement] = useState<PendingPlacement | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
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
  const scheduleTextPathHistoryPush = useDebouncedHistoryPush(pushHistory);
  const scheduleDiacriticHistoryPush = useDebouncedHistoryPush(pushHistory);
  const scheduleGlyphTransformHistoryPush = useDebouncedHistoryPush(pushHistory);

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
      scheduleDiacriticHistoryPush();
    },
    [scheduleDiacriticHistoryPush]
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

  const updateGlyphTransform = useCallback(
    (blockId: number, glyphIndex: number, patch: Partial<GlyphTransform>) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || !supportsGlyphTransforms(b)) return b;
          const existing = (b.glyphTransforms ?? []).find((t) => t.glyphIndex === glyphIndex);
          // `mergeGlyphTransform` owns the stale-entry rule — see its comment.
          const merged = mergeGlyphTransform(existing, glyphIndex, patch);
          const nextTransforms = existing
            ? (b.glyphTransforms ?? []).map((t) =>
                t.glyphIndex === glyphIndex ? merged : t
              )
            : [...(b.glyphTransforms ?? []), merged];
          return { ...b, glyphTransforms: nextTransforms };
        })
      );
      // Debounced: one continuous drag collapses to a single undo entry,
      // the same treatment a diacritic drag gets.
      scheduleGlyphTransformHistoryPush();
    },
    [scheduleGlyphTransformHistoryPush]
  );

  const toggleGlyphTransformMode = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphTransforms(b)
            ? { ...b, glyphTransformMode: !b.glyphTransformMode }
            : b
        )
      );
    },
    [pushHistory]
  );

  const resetGlyphTransforms = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && supportsGlyphTransforms(b) ? { ...b, glyphTransforms: [] } : b
        )
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
      // Debounced, so one continuous drag is a single undo entry — the same
      // treatment a glyph-transform or diacritic drag gets.
      scheduleGlyphTransformHistoryPush();
    },
    [scheduleGlyphTransformHistoryPush]
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
      scheduleTextPathHistoryPush();
    },
    [scheduleTextPathHistoryPush]
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
      const filtered = dissolveSingletonGroups(prev.filter((b) => !idsToDelete.has(b.id)));
      setSelectedId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
    setSelectedIds([]);
  }, [effectiveSelectedIds, blocks, pushHistory]);

  useEffect(() => {
    if (!isBrowser) return;
    const NUDGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

    const handleKeyDown = (e: KeyboardEvent) => {
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
            };
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
        b.type === "image" ? b : ({ ...b, fontFamily: font, color: textColor } as Block)
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

  const resizeShapeFillBlock = useCallback(
    (id: number, scale: number) => {
      updateBlock(id, { shapeScale: clamp(scale, 0.2, 3) });
    },
    [updateBlock]
  );

  const resizeImageBlock = useCallback(
    (id: number, scale: number) => {
      updateBlock(id, { imageScale: clamp(scale, 0.05, 10) });
    },
    [updateBlock]
  );

  const reorderBlocks = useCallback(
    (newBlocks: Block[]) => {
      pushHistory();
      setBlocks(dissolveSingletonGroups(newBlocks));
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
    };

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
    // Projects saved before the Shape Warp block type was removed can still
    // carry blocks of that type. Nothing renders them any more, so drop them
    // rather than letting CanvasStage's exhaustive type switch fall through to
    // an unrendered block that still occupies the layer list and selection.
    //
    // The same goes for the Morph Glyph Editor's per-block fields: a save from
    // before its removal still carries them, and stripping them here is what
    // keeps an old project loading cleanly instead of half-rendered.
    const parsedBlocks = Array.isArray(parsed.blocks)
      ? (parsed.blocks as Block[])
          .filter((b) => (b as { type?: string }).type !== "shapeWarp")
          .map(stripMorphFields)
      : null;
    // `let` because the STREAM-B sanitation region below reassigns it.
    let blocksToLoad: Block[] | null = parsedBlocks;
    // blocksToLoad, e.g. dropping mirrors whose sourceId no longer resolves) ----
    // A mirror renders its source's content, so one whose source is missing
    // from the payload would occupy the layer list and the selection while
    // drawing nothing. Dropped on load for the same reason, and by the same
    // precedent, as the `shapeWarp` filter above.
    if (blocksToLoad) blocksToLoad = dropOrphanedMirrors(blocksToLoad);
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

  const addImageBlock = (dataUrl: string, naturalWidth: number, naturalHeight: number) => {
    const newId = createNextId();
    const maxDim = (Math.max(canvasWidth, stageViewportHeight) / stageScale) * 0.6;
    const fitScale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight, 1));
    const displayWidth = naturalWidth * fitScale;
    const displayHeight = naturalHeight * fitScale;

    beginPlacement(
      {
        ...DEFAULT_BLOCK,
        id: newId,
        text: "",
        type: "image",
        imageDataUrl: dataUrl,
        imageScale: 1,
        shapeWidth: displayWidth,
        shapeHeight: displayHeight,
        x: 0,
        y: 0,
      },
      displayWidth,
      displayHeight,
      -displayWidth / 2,
      -displayHeight / 2,
      "New Image"
    );
  };

  const uploadImageBlock = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const img = new window.Image();
        img.onload = () => {
          addImageBlock(dataUrl, img.naturalWidth || 300, img.naturalHeight || 300);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    };

    input.click();
  };

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

  const addMirrorBlock = (mode: MirrorMode) => {
    if (!mirrorSourceCandidate) return;
    pushHistory();
    const newId = createNextId();
    const block = buildMirrorBlock(newId, mirrorSourceCandidate, mode);
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
  // Both actions deliberately delegate to the existing creation paths rather
  // than building a block themselves: a built-in ornament must land on the
  // canvas in exactly the state an uploaded SVG or image does, placement
  // flow and all.
  const insertOrnamentShapeFill = (pathData: string, w: number, h: number) => {
    addShapeFillBlock(pathData, w, h);
  };

  const insertOrnamentFrame = (dataUrl: string, w: number, h: number) => {
    addImageBlock(dataUrl, w, h);
  };

  const p1cSidebarProps: Partial<SidebarProps> = {
    onInsertOrnamentShapeFill: insertOrnamentShapeFill,
    onInsertOrnamentFrame: insertOrnamentFrame,
  };
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
      const cuts = selectedBlock.strokeCuts ?? [];
      updateSelectedBlock(
        cuts.length > 0
          ? { text: next, strokeCuts: remapCutsAfterInsert(cuts, slot.index, delta) }
          : { text: next }
      );
    },
    [selectedBlock, updateSelectedBlock]
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
  const [isBuildingNameDesign, setIsBuildingNameDesign] = useState(false);

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
      const { id, text, fontFamily, fontSize, fontStyle, strokeWidth, warpX, strokeCuts } =
        selectedBlock;
      const fontUrl = resolveFontUrl(fontFamily);
      // The italic shear, the faux-bold stroke, the outline and the horizontal
      // warp all widen what is drawn beyond the glyph outlines. Measuring
      // without them would let the fit promise a width an italic, outlined or
      // warped block then overshot.
      const runStyle = {
        italic: fontStyle === "italic" || fontStyle === "bold italic",
        bold: fontStyle === "bold" || fontStyle === "bold italic",
        strokeWidth,
        warpX,
        // Straight-stroke cuts widen the drawn run too, and shaping cannot
        // see them — they are geometry rather than characters. One nuqta at
        // `fontSize` is the px-space unit, matching the space `inkExtentBox`
        // reports in.
        cutWidth: cutAdvanceTotal(strokeCuts ?? [], nuqtaUnits(fontFamily, fontSize)),
      };

      setIsFittingWidth(true);
      try {
        const result = await solveFitToWidth({
          text,
          target,
          measure: (candidate) =>
            measureShapedWidth(candidate, fontUrl, fontSize, runStyle),
        });
        // A no-op result must not push history — clicking Fit on an
        // already-fitted run should not cost an undo step.
        if (result.text !== text) updateBlock(id, { text: result.text });
        setExportStatus(describeFitResult(result, target, text));
      } catch (err) {
        console.error("fit to width failed", err);
        setExportStatus("Could not fit this text to width.");
      } finally {
        setIsFittingWidth(false);
      }
    },
    [selectedBlock, updateBlock]
  );

  /**
   * "Name designs": write the selected name in the style picked from the
   * gallery, and add whatever companion blocks the chosen layout needs.
   *
   * Modeled on `fitSelectedBlockToWidth` directly above, for the same reason:
   * it has to shape the text to find out how wide the name draws, so it is
   * async, and the selection can change while it runs. The block is therefore
   * **captured by id** — patching "the selected block" on the way out would
   * rewrite whatever the user selected in the meantime.
   *
   * The measurement is taken in the *new* font, not the current one: every
   * layout spaces itself by how wide the name draws, and that is a property
   * of the style just chosen. When shaping fails the composition still
   * happens, on a rough estimate — a loose arrangement the user can drag into
   * place beats no arrangement at all.
   *
   * One `pushHistory()` covers the style change and the added blocks
   * together, so a whole design is a single undo.
   */
  const applyNameDesign = async (selection: NameDesignSelection) => {
    const source = selectedBlock;
    if (!source || source.type !== "text") return;
    if (source.text.trim() === "") {
      setExportStatus("Type a name into this block first.");
      return;
    }

    const { id, text, fontSize, fontStyle, strokeWidth, warpX, lineHeight } = source;
    // The same four terms `fitSelectedBlockToWidth` measures with: the
    // outlines are not the whole of what is drawn, and a composition spaced
    // by outlines alone sets an italic or outlined name too close.
    const runStyle = {
      italic: fontStyle === "italic" || fontStyle === "bold italic",
      bold: fontStyle === "bold" || fontStyle === "bold italic",
      strokeWidth,
      warpX,
    };

    setIsBuildingNameDesign(true);
    try {
      let run;
      try {
        const measured = await measureShapedRun(
          text,
          resolveFontUrl(selection.fontFamily),
          fontSize,
          runStyle
        );
        run = normalizeRunBox(measured, fontSize, lineHeight);
      } catch (err) {
        console.error("name design measurement failed", err);
        run = estimateRunBox(text, fontSize);
      }

      const plan = buildNameDesign(
        {
          source,
          layout: selection.layout,
          fontFamily: selection.fontFamily,
          run,
          radialCount: selection.radialCount,
          frameId: selection.frameId,
          frameColor: selection.frameColor,
        },
        createNextId
      );

      pushHistory();
      setBlocks((prev) => {
        const index = prev.findIndex((b) => b.id === id);
        // The block was deleted while we were measuring; there is nothing to
        // build the design around any more.
        if (index < 0) return prev;
        const patched = prev.map((b) => (b.id === id ? ({ ...b, ...plan.patch } as Block) : b));
        if (plan.added.length === 0) return patched;
        // A frame must be drawn before the name or it covers it; a reflection
        // is a peer and goes on top, where every new block goes.
        return plan.placement === "behind"
          ? [...patched.slice(0, index), ...plan.added, ...patched.slice(index)]
          : [...patched, ...plan.added];
      });
      setExportStatus(describeNameDesign(plan, selection.layout));
    } finally {
      setIsBuildingNameDesign(false);
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
          .filter((b) => b.type !== "image" && b.type !== "mirror")
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
    !!selectedBlock &&
    selectedBlock.type !== "image" &&
    isFontUnavailable(selectedBlock.fontFamily, FONT_URLS);

  const p2gSidebarProps: Partial<SidebarProps> = {
    customFonts,
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
      <Sidebar
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
        onAddImageBlock={uploadImageBlock}
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
        onToggleGlyphTransformMode={toggleGlyphTransformMode}
        onResetGlyphTransforms={resetGlyphTransforms}
        onToggleStrokeCutMode={toggleStrokeCutMode}
        onClearStrokeCuts={clearStrokeCuts}
        onFitShapeFillSpacing={fitShapeFillSpacing}
        onAlignSelected={alignSelectedBlocks}
        onDistributeSelected={distributeSelectedBlocks}
        onGroupSelected={groupSelectedBlocks}
        {...streamASidebarProps}
        {...streamCSidebarProps}
        {...streamDSidebarProps}
        {...p1aSidebarProps}
        {...p1bSidebarProps}
        {...p1cSidebarProps}
        {...p1dSidebarProps}
        {...p2eSidebarProps}
        {...p2fSidebarProps}
        {...p2gSidebarProps}
        onApplyNameDesign={applyNameDesign}
        isBuildingNameDesign={isBuildingNameDesign}
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
          onDragDiacriticOverride={dragDiacriticOverride}
          onToggleDiacriticHidden={toggleDiacriticHidden}
          onUpdateGlyphTransform={updateGlyphTransform}
          onSetStrokeCut={setStrokeCut}
          onResizeShapeFillBlock={resizeShapeFillBlock}
          onResizeImageBlock={resizeImageBlock}
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

      <ConfirmDialog request={confirmRequest} onCancel={() => setConfirmRequest(null)} />
    </div>
  );
};

export default App;