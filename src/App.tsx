import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import type Konva from "konva";
import { Sidebar } from "./components/Sidebar";
import { CanvasStage } from "./components/CanvasStage";
import { MorphGlyphEditor } from "./components/MorphGlyphEditor";
import { ConfirmDialog, type ConfirmDialogRequest } from "./components/ConfirmDialog";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useDebouncedHistoryPush } from "./hooks/useDebouncedHistoryPush";
import { useExport } from "./hooks/useExport";
import { isTypingTarget } from "./lib/dom";
import { triggerDownload } from "./lib/download";
import { STARTER_TEMPLATES } from "./lib/templates";
import { FONT_URLS } from "./hooks/useShapedGlyphs";
import {
  MIN_SCALE,
  MAX_SCALE,
  getBlocksBoundingBox,
  padBox,
  computeFitToBox,
  DEFAULT_EMPTY_BOUNDS,
} from "./lib/canvasBounds";
import type { StretchDefinition } from "./lib/strokeSchema/deriveCatalog";
import { mapNormToRealBox } from "./lib/strokeSchema/schemaGeometry";
import { arcPathD } from "./lib/textPath";
import type { Block, GlyphEdit, GlyphStretchHandle, GlyphRig, GlyphRigAxis } from "./types";

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

export type NamedProjectMeta = { name: string; savedAt: number };
type NamedProjectsStore = Record<string, { savedAt: number; payload: unknown }>;

type GlyphBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** HarfBuzz glyph id within this block's font — stable per font binary, used to key reusable glyph rigs. */
  glyphId?: number;
  /** Pen offset baked into x/y; 0/omitted where the box is already in glyph-local space (ShapeFillText). */
  gx?: number;
  gy?: number;
};

const glyphBoxesEqual = (a: GlyphBox[] | undefined, b: GlyphBox[]): boolean => {
  if (!a) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const aa = a[i];
    const bb = b[i];
    if (
      aa.glyphIndex !== bb.glyphIndex ||
      aa.x !== bb.x ||
      aa.y !== bb.y ||
      aa.width !== bb.width ||
      aa.height !== bb.height ||
      aa.glyphId !== bb.glyphId ||
      aa.gx !== bb.gx ||
      aa.gy !== bb.gy
    ) {
      return false;
    }
  }
  return true;
};

const STORAGE_KEY = "calligraphy-layout-v2";
const NAMED_PROJECTS_KEY = "harfcanvas-named-projects-v1";
const GLYPH_RIGS_KEY = "harfcanvas-glyph-rigs-v1";
const SIDEBAR_COLLAPSED_WIDTH = 28;
/** Zoom level for the very first paint of the default starter content (a fresh session, no saved layout). */
const INITIAL_VIEW_SCALE = 2.75;
const RIGHT_PANEL_WIDTH = 280;
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

const makeHandleId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `gh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const removeStretchHandle = (
  glyphEdits: GlyphEdit[],
  glyphIndex: number,
  handleId: string
): GlyphEdit[] => {
  const existing = glyphEdits.find((g) => g.glyphIndex === glyphIndex);
  if (!existing) return glyphEdits;
  const nextStretches = existing.stretches.filter((h) => h.id !== handleId);
  return nextStretches.length > 0
    ? glyphEdits.map((g) =>
        g.glyphIndex === glyphIndex ? { ...g, stretches: nextStretches } : g
      )
    : glyphEdits.filter((g) => g.glyphIndex !== glyphIndex);
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
  const [namedProjects, setNamedProjects] = useState<NamedProjectMeta[]>(() => {
    if (!isBrowser) return [];
    try {
      const raw = localStorage.getItem(NAMED_PROJECTS_KEY);
      if (!raw) return [];
      const store = JSON.parse(raw) as NamedProjectsStore;
      return Object.entries(store)
        .map(([name, entry]) => ({ name, savedAt: entry.savedAt }))
        .sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  });
  const [glyphRigs, setGlyphRigs] = useState<GlyphRig[]>(() => {
    if (!isBrowser) return [];
    try {
      const raw = localStorage.getItem(GLYPH_RIGS_KEY);
      return raw ? (JSON.parse(raw) as GlyphRig[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    if (!isBrowser) return;
    try {
      localStorage.setItem(GLYPH_RIGS_KEY, JSON.stringify(glyphRigs));
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — best-effort, same as other localStorage writes here.
    }
  }, [glyphRigs]);

  const [isMobile, setIsMobile] = useState(isBrowser ? window.innerWidth <= 768 : false);
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(true);
  const [showMorphEditorMobile, setShowMorphEditorMobile] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(isBrowser ? window.innerWidth : 1200);
  const [viewportHeight, setViewportHeight] = useState(isBrowser ? window.innerHeight : 800);

  const [glyphBoxesByBlock, setGlyphBoxesByBlock] = useState<Record<number, GlyphBox[]>>({});
  const [glyphSchemaByBlock, setGlyphSchemaByBlock] = useState<
    Record<number, Record<number, StretchDefinition[]>>
  >({});

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

  const rightPanelVisible =
    !isMobile &&
    !!selectedBlock &&
    selectedBlock.type !== "image" &&
    selectedBlock.type !== "textPath";
  const effectiveRightPanelWidth =
    !rightPanelVisible || rightPanelCollapsed ? 0 : RIGHT_PANEL_WIDTH;

  const canvasWidth = isMobile
    ? viewportWidth
    : Math.max(0, viewportWidth - effectiveSidebarWidth - effectiveRightPanelWidth);

  const effectiveSelectedIds = useMemo(
    () => (selectedIds.length > 0 ? selectedIds : selectedId != null ? [selectedId] : []),
    [selectedIds, selectedId]
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
    (): EditorSnapshot => ({ blocks, backgroundColor }),
    [blocks, backgroundColor]
  );

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setBlocks(snapshot.blocks);
    setBackgroundColor(snapshot.backgroundColor);
  }, []);

  const { pushHistory, handleUndo, handleRedo, canUndo, canRedo } = useUndoRedo(
    getSnapshot,
    applySnapshot
  );

  const scheduleMoveHistoryPush = useDebouncedHistoryPush(pushHistory);
  const scheduleKashidaHistoryPush = useDebouncedHistoryPush(pushHistory);
  const scheduleGlyphEditHistoryPush = useDebouncedHistoryPush(pushHistory);
  const scheduleGlyphRigHistoryPush = useDebouncedHistoryPush(pushHistory);
  const scheduleTextPathHistoryPush = useDebouncedHistoryPush(pushHistory);

  const upsertGlyphEditRaw = useCallback(
    (
      blockId: number,
      glyphIndex: number,
      updater: (prev: GlyphEdit | undefined) => GlyphEdit
    ) => {
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;
          const glyphEdits = b.glyphEdits ?? [];
          const existing = glyphEdits.find((g) => g.glyphIndex === glyphIndex);
          const next = updater(existing);
          return {
            ...b,
            glyphEdits: [
              ...glyphEdits.filter((g) => g.glyphIndex !== glyphIndex),
              next,
            ].sort((a, b) => a.glyphIndex - b.glyphIndex),
          };
        })
      );
    },
    []
  );

  const upsertGlyphEdit = useCallback(
    (
      blockId: number,
      glyphIndex: number,
      updater: (prev: GlyphEdit | undefined) => GlyphEdit
    ) => {
      pushHistory();
      upsertGlyphEditRaw(blockId, glyphIndex, updater);
    },
    [pushHistory, upsertGlyphEditRaw]
  );

  // Live-drag version: updates immediately but only pushes one history entry
  // 300ms after the gesture settles, same debounce pattern as block dragging.
  const upsertGlyphEditDebounced = useCallback(
    (
      blockId: number,
      glyphIndex: number,
      updater: (prev: GlyphEdit | undefined) => GlyphEdit
    ) => {
      upsertGlyphEditRaw(blockId, glyphIndex, updater);
      scheduleGlyphEditHistoryPush();
    },
    [scheduleGlyphEditHistoryPush, upsertGlyphEditRaw]
  );

  const selectGlyphForBlock = useCallback((blockId: number, glyphIndex: number | null) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId && b.type !== "image" && b.type !== "textPath"
          ? { ...b, selectedGlyphIndex: glyphIndex, glyphMaskEdit: null }
          : b
      )
    );
  }, []);

  // Arming a mask edit from the Morph panel's per-stroke rows also selects
  // that glyph on the canvas and turns the Stretch tool on — the canvas
  // contour/lasso overlays only render for the selected glyph while the tool
  // is armed, and the panel no longer requires either as a precondition.
  const setGlyphMaskEditMode = useCallback(
    (blockId: number, glyphIndex: number, handleId: string, mode: "contours" | "lasso" | null) => {
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && b.type !== "image" && b.type !== "textPath"
            ? mode
              ? {
                  ...b,
                  glyphEditTool: "stretch" as const,
                  selectedGlyphIndex: glyphIndex,
                  glyphMaskEdit: { handleId, mode },
                }
              : { ...b, glyphMaskEdit: null }
            : b
        )
      );
    },
    []
  );

  const updateGlyphBoxes = useCallback((blockId: number, boxes: GlyphBox[]) => {
    setGlyphBoxesByBlock((prev) => {
		const prevBoxes = prev[blockId];
		if (glyphBoxesEqual(prevBoxes, boxes)) {
			return prev;
		}
		return {
			...prev,
			[blockId]: boxes,
		};
		});
  }, []);

  const updateGlyphSchema = useCallback(
    (blockId: number, catalog: Record<number, StretchDefinition[]>) => {
      setGlyphSchemaByBlock((prev) =>
        prev[blockId] === catalog ? prev : { ...prev, [blockId]: catalog }
      );
    },
    []
  );

  // Distributes a block-level "Kashida" 0-100 dial across every kashida-eligible,
  // schema-backed stretch handle in the block, weighted by each handle's own
  // `priority` (1-10, from the stroke schema) — a higher-priority stroke ramps
  // toward its own maxFactor faster than a lower-priority one at the same dial
  // position. Handles without a maxFactor (plain freehand handles) are untouched.
  const setBlockKashidaAmount = useCallback(
    (blockId: number, amount: number) => {
      const clampedAmount = Math.max(0, Math.min(100, amount));

      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;

          return {
            ...b,
            kashidaAmount: clampedAmount,
            glyphEdits: (b.glyphEdits ?? []).map((edit) => ({
              ...edit,
              stretches: edit.stretches.map((h) => {
                if (!h.kashidaEligible || h.maxFactor == null) return h;
                const weight = (h.priority ?? 5) / 10;
                const factor = Math.min(
                  h.maxFactor,
                  1 + (h.maxFactor - 1) * (clampedAmount / 100) * weight
                );
                return { ...h, factor };
              }),
            })),
          };
        })
      );
      scheduleGlyphEditHistoryPush();
    },
    [scheduleGlyphEditHistoryPush]
  );

  const updateStretchHandle = useCallback(
    (
      blockId: number,
      glyphIndex: number,
      handleId: string,
      patch: Partial<GlyphStretchHandle>
    ) => {
      upsertGlyphEditDebounced(blockId, glyphIndex, (prev) => ({
        glyphIndex,
        stretches: (prev?.stretches ?? []).map((h) =>
          h.id === handleId ? { ...h, ...patch } : h
        ),
      }));
    },
    [upsertGlyphEditDebounced]
  );

  // Kaleam-style slider flow: every stroke slider in the Morph panel is live
  // for every glyph with an authored schema — the first movement of a slider
  // creates its schema-backed handle on the spot (one undo step, via
  // upsertGlyphEdit's pushHistory), and subsequent movements just retune
  // `factor` through the debounced update path. No canvas glyph selection or
  // explicit "add handle" step exists anymore.
  const setStretchFactor = useCallback(
    (blockId: number, glyphIndex: number, definition: StretchDefinition, factor: number) => {
      const block = blocks.find((b) => b.id === blockId);
      if (!block || block.type === "image" || block.type === "textPath") return;

      const clamped = Math.max(definition.minFactor, Math.min(definition.maxFactor, factor));
      const existing = block.glyphEdits
        ?.find((g) => g.glyphIndex === glyphIndex)
        ?.stretches.find(
          (h) =>
            h.schemaStrokeId === definition.strokeId &&
            (h.schemaZoneIndex ?? 0) === definition.zoneIndex
        );

      if (existing) {
        updateStretchHandle(blockId, glyphIndex, existing.id, { factor: clamped });
        return;
      }

      const box = (glyphBoxesByBlock[blockId] ?? []).find((b) => b.glyphIndex === glyphIndex);

      // No dragging anymore — the axis is derived entirely from the schema's
      // own authored geometry (definition.anchorNorm/dragNorm, computed in
      // deriveStretchCatalog) mapped onto this glyph's real bounding box.
      // dragOrigin = the schema's natural (factor=1) endpoint; drag = that
      // same axis extrapolated out to maxFactor, which lib/glyphEdits.ts's
      // resolveValueMultiplier uses as the "full stretch" reference.
      const anchorPoint = box
        ? mapNormToRealBox(definition.anchorNorm, box)
        : { x: block.x, y: block.y };
      const dragOriginPoint = box
        ? mapNormToRealBox(definition.dragNorm, box)
        : { x: block.x + 80, y: block.y };
      const dragPoint = {
        x: anchorPoint.x + (dragOriginPoint.x - anchorPoint.x) * definition.maxFactor,
        y: anchorPoint.y + (dragOriginPoint.y - anchorPoint.y) * definition.maxFactor,
      };
      const bandWidth = box ? Math.max(20, Math.min(box.width, box.height) * 0.5) : 40;

      upsertGlyphEdit(blockId, glyphIndex, (prev) => {
        // Re-check inside the updater — a second slider event can land before
        // the render that would have found the handle via `blocks` above.
        const already = prev?.stretches.find(
          (h) =>
            h.schemaStrokeId === definition.strokeId &&
            (h.schemaZoneIndex ?? 0) === definition.zoneIndex
        );
        if (already) {
          return {
            glyphIndex,
            stretches: (prev?.stretches ?? []).map((h) =>
              h.id === already.id ? { ...h, factor: clamped } : h
            ),
          };
        }
        return {
          glyphIndex,
          stretches: [
            ...(prev?.stretches ?? []),
            {
              id: makeHandleId(),
              anchorX: anchorPoint.x,
              anchorY: anchorPoint.y,
              dragOriginX: dragOriginPoint.x,
              dragOriginY: dragOriginPoint.y,
              dragX: dragPoint.x,
              dragY: dragPoint.y,
              bandWidth,
              maskAuto: true,
              schemaStrokeId: definition.strokeId,
              schemaZoneIndex: definition.zoneIndex,
              factor: clamped,
              minFactor: definition.minFactor,
              maxFactor: definition.maxFactor,
              kashidaEligible: definition.kashidaEligible,
              priority: definition.priority,
            },
          ],
        };
      });
    },
    [blocks, glyphBoxesByBlock, updateStretchHandle, upsertGlyphEdit]
  );

  const deleteStretchHandle = useCallback(
    (blockId: number, glyphIndex: number, handleId: string) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;
          return {
            ...b,
            glyphEdits: removeStretchHandle(b.glyphEdits ?? [], glyphIndex, handleId),
            glyphMaskEdit: b.glyphMaskEdit?.handleId === handleId ? null : b.glyphMaskEdit,
          };
        })
      );
    },
    [pushHistory]
  );

  const saveStretchHandleAsRig = useCallback(
    (blockId: number, glyphIndex: number, handleId: string, name: string) => {
      const trimmed = name.trim();
      const block = blocks.find((b) => b.id === blockId);
      if (!block || block.type === "image" || block.type === "textPath" || !trimmed) return;

      const handle = block.glyphEdits
        ?.find((g) => g.glyphIndex === glyphIndex)
        ?.stretches.find((h) => h.id === handleId);
      const box = (glyphBoxesByBlock[blockId] ?? []).find((b) => b.glyphIndex === glyphIndex);
      if (!handle || !box || box.glyphId == null) return;

      const fontSize = block.fontSize;
      const gx = box.gx ?? 0;
      const gy = box.gy ?? 0;
      const glyphId = box.glyphId;
      const fontFamily = block.fontFamily;
      const newAxis: GlyphRigAxis = {
        id: makeHandleId(),
        name: trimmed,
        anchorX: (handle.anchorX - gx) / fontSize,
        anchorY: (handle.anchorY - gy) / fontSize,
        dragOriginX: (handle.dragOriginX - gx) / fontSize,
        dragOriginY: (handle.dragOriginY - gy) / fontSize,
        dragX: (handle.dragX - gx) / fontSize,
        dragY: (handle.dragY - gy) / fontSize,
        bandWidth: handle.bandWidth / fontSize,
        mask:
          handle.mask == null
            ? undefined
            : handle.mask.mode === "contours"
              ? handle.mask
              : {
                  mode: "lasso",
                  points: handle.mask.points.map((p) => ({
                    x: (p.x - gx) / fontSize,
                    y: (p.y - gy) / fontSize,
                  })),
                },
      };

      // Library mutation — deliberately not wrapped in pushHistory(); see
      // the "Undo/redo" design decision in the glyph-rigs plan.
      setGlyphRigs((prev) => {
        const idx = prev.findIndex((r) => r.fontFamily === fontFamily && r.glyphId === glyphId);
        if (idx === -1) {
          return [...prev, { fontFamily, glyphId, axes: [newAxis] }];
        }
        const next = [...prev];
        next[idx] = { ...next[idx], axes: [...next[idx].axes, newAxis] };
        return next;
      });

      // Block mutation — one undo step, removes the raw handle and seeds the
      // rig value to 1 so the deformation doesn't visually jump.
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;
          const nextGlyphEdits = removeStretchHandle(b.glyphEdits ?? [], glyphIndex, handleId);
          const values = (b.glyphRigValues ?? []).filter((v) => v.axisId !== newAxis.id);
          return {
            ...b,
            glyphEdits: nextGlyphEdits,
            glyphRigValues: [...values, { axisId: newAxis.id, value: 1 }],
          };
        })
      );
    },
    [blocks, glyphBoxesByBlock, pushHistory]
  );

  const deleteGlyphRigAxis = useCallback(
    (fontFamily: string, glyphId: number, axisId: string) => {
      setGlyphRigs((prev) =>
        prev
          .map((r) =>
            r.fontFamily === fontFamily && r.glyphId === glyphId
              ? { ...r, axes: r.axes.filter((a) => a.id !== axisId) }
              : r
          )
          .filter((r) => r.axes.length > 0)
      );
    },
    []
  );

  const setGlyphRigValue = useCallback(
    (blockId: number, axisId: string, value: number) => {
      const clamped = Math.max(-1, Math.min(1, value));
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type === "image" || b.type === "textPath") return b;
          const values = b.glyphRigValues ?? [];
          const existing = values.find((v) => v.axisId === axisId);
          return {
            ...b,
            glyphRigValues: existing
              ? values.map((v) => (v.axisId === axisId ? { ...v, value: clamped } : v))
              : [...values, { axisId, value: clamped }],
          };
        })
      );
      scheduleGlyphRigHistoryPush();
    },
    [scheduleGlyphRigHistoryPush]
  );

  const resetShapeWarp = useCallback(
    (blockId: number) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) =>
          b.id === blockId && b.type === "shapeWarp"
            ? {
                ...b,
                warpShapePadding: 24,
                warpShapeStrength: 1,
                warpShapeMode: "envelope",
                glyphEdits: [],
                selectedGlyphIndex: null,
              }
            : b
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

  const updateKashidaText = useCallback(
    (id: number, text: string) => {
      setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, text } : b)));
      scheduleKashidaHistoryPush();
    },
    [scheduleKashidaHistoryPush]
  );

  const updateTextPathD = useCallback(
    (id: number, d: string) => {
      setBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, textPathD: d } as Block) : b)));
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

        // Initial mount hydration intentionally doesn't merge embedded
        // glyphRigs — they're already loaded independently from their own
        // localStorage key at state-init time (see glyphRigs useState above).
        applyParsedLayoutPayload(JSON.parse(raw), { mergeRigs: false });
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

  const applyStarterTemplate = (templateId: string) => {
    const template = STARTER_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    pushHistory();
    const newBlocks: Block[] = template.blocks.map((b) => ({ ...b, id: createNextId() }));
    setBlocks(newBlocks);
    setBackgroundColor(template.backgroundColor);
    setShowGrid(false);
    setSelectedIds([]);
    setSelectedId(newBlocks[0]?.id ?? null);
    setTimeout(() => resetView(newBlocks), 0);
  };

  const requestApplyStarterTemplate = (templateId: string) => {
    const template = STARTER_TEMPLATES.find((t) => t.id === templateId);
    if (!template) return;
    setConfirmRequest({
      title: `Replace canvas with "${template.label}"?`,
      message:
        "This clears every block currently on the canvas. Ctrl+Z will bring your design back if you change your mind.",
      confirmLabel: "Replace canvas",
      onConfirm: () => {
        setConfirmRequest(null);
        applyStarterTemplate(templateId);
      },
    });
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

  const buildLayoutPayload = () => {
    const referencedAxisIds = new Set(
      blocks.flatMap((b) =>
        b.type === "image" ? [] : (b.glyphRigValues ?? []).map((v) => v.axisId)
      )
    );
    const embeddedGlyphRigs = glyphRigs.filter((r) =>
      r.axes.some((a) => referencedAxisIds.has(a.id))
    );

    return {
      blocks,
      selectedId,
      backgroundColor,
      stageScale,
      stagePosition,
      panMode,
      viewportWidth,
      viewportHeight,
      glyphRigs: embeddedGlyphRigs,
      version: 4,
    };
  };

  // Merges rigs embedded in a loaded/imported project into the local rig
  // library — local axes win on id conflict (importing someone else's
  // project can't clobber a locally-retuned axis), any axis id not already
  // present locally gets added.
  const mergeGlyphRigs = (embedded: GlyphRig[] | undefined) => {
    if (!embedded?.length) return;
    setGlyphRigs((prev) => {
      let next = prev;
      for (const incoming of embedded) {
        const idx = next.findIndex(
          (r) => r.fontFamily === incoming.fontFamily && r.glyphId === incoming.glyphId
        );
        if (idx === -1) {
          next = [...next, incoming];
          continue;
        }
        const localIds = new Set(next[idx].axes.map((a) => a.id));
        const missing = incoming.axes.filter((a) => !localIds.has(a.id));
        if (missing.length) {
          next = next.map((r, i) => (i === idx ? { ...r, axes: [...r.axes, ...missing] } : r));
        }
      }
      return next;
    });
  };

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
  const applyParsedLayoutPayload = (
    parsed: Record<string, unknown>,
    opts: { mergeRigs?: boolean } = {}
  ) => {
    const parsedBlocks = Array.isArray(parsed.blocks) ? (parsed.blocks as Block[]) : null;
    const loadedBlocks: Block[] = parsedBlocks ?? blocks;
    if (parsedBlocks) setBlocks(parsedBlocks);
    if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
      setSelectedIds([]);
      setSelectedId(parsed.selectedId);
    }
    if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
    if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);
    if (opts.mergeRigs !== false && Array.isArray(parsed.glyphRigs)) {
      mergeGlyphRigs(parsed.glyphRigs as GlyphRig[]);
    }

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
    setNamedProjects(
      Object.entries(store)
        .map(([name, entry]) => ({ name, savedAt: entry.savedAt }))
        .sort((a, b) => b.savedAt - a.savedAt)
    );
  };

  const saveNamedProject = (name: string) => {
    const trimmed = name.trim();
    if (!isBrowser || !trimmed) return;
    try {
      const store = readNamedProjectsStore();
      store[trimmed] = { savedAt: Date.now(), payload: buildLayoutPayload() };
      localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
      refreshNamedProjectsList(store);
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — best-effort.
    }
  };

  const loadNamedProject = (name: string) => {
    const store = readNamedProjectsStore();
    const entry = store[name];
    if (!entry) return;
    applyStoredPayload(JSON.stringify(entry.payload));
  };

  const deleteNamedProject = (name: string) => {
    const store = readNamedProjectsStore();
    delete store[name];
    try {
      localStorage.setItem(NAMED_PROJECTS_KEY, JSON.stringify(store));
    } catch {
      // best-effort
    }
    refreshNamedProjectsList(store);
  };

  const requestDeleteNamedProject = (name: string) => {
    setConfirmRequest({
      title: `Delete "${name}"?`,
      message:
        "This removes the saved project from this browser for good — unlike canvas edits, it isn't covered by Ctrl+Z.",
      confirmLabel: "Delete project",
      onConfirm: () => {
        setConfirmRequest(null);
        deleteNamedProject(name);
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
        text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
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

  const addShapeWarpBlock = (
    svgPathData: string,
    shapeWidth: number,
    shapeHeight: number
  ) => {
    const newId = createNextId();
    const autoFontSize = Math.max(8, Math.round(shapeHeight / 6));

    beginPlacement(
      {
        ...DEFAULT_BLOCK,
        id: newId,
        text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
        fontSize: autoFontSize,
        type: "shapeWarp",
        shapeSvgPath: svgPathData,
        warpShapeWidth: shapeWidth,
        warpShapeHeight: shapeHeight,
        warpShapePadding: 24,
        warpShapeStrength: 1,
        warpShapeMode: "envelope",
        x: 0,
        y: 0,
        glyphEditTool: null,
        selectedGlyphIndex: null,
        glyphEdits: [],
      },
      shapeWidth,
      shapeHeight,
      -shapeWidth / 2,
      -shapeHeight / 2,
      "New Shape Warp"
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
        text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
        type: "textPath",
        textPathD: arcPathD(width, height),
        textPathReversed: false,
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
        namedProjects={namedProjects}
        onSaveNamedProject={saveNamedProject}
        onLoadNamedProject={loadNamedProject}
        onDeleteNamedProject={requestDeleteNamedProject}
        onAddShapeFillBlock={addShapeFillBlock}
        onAddShapeWarpBlock={addShapeWarpBlock}
        onAddTextPathBlock={addTextPathBlock}
        onAddImageBlock={uploadImageBlock}
        onApplyTemplate={requestApplyStarterTemplate}
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
        onToggleKashidaEditMode={() => {
          if (!selectedBlock || selectedBlock.type !== "text") return;
          updateSelectedBlock({
            kashidaEditMode: !selectedBlock.kashidaEditMode,
          });
        }}
        showMorphEditorMobile={showMorphEditorMobile}
        onToggleMorphEditorMobile={() => setShowMorphEditorMobile((v) => !v)}
        onResetShapeWarp={resetShapeWarp}
        onFitShapeFillSpacing={fitShapeFillSpacing}
        onAlignSelected={alignSelectedBlocks}
        onDistributeSelected={distributeSelectedBlocks}
        onGroupSelected={groupSelectedBlocks}
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
          onSelectGlyph={selectGlyphForBlock}
          onUpdateStretchHandle={updateStretchHandle}
          glyphRigs={glyphRigs}
          onGlyphBoxesChange={updateGlyphBoxes}
          onGlyphSchemaChange={updateGlyphSchema}
          onKashidaTextChange={updateKashidaText}
          onUpdateTextPathD={updateTextPathD}
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

      <MorphGlyphEditor
        selectedBlock={selectedBlock}
        selectedGlyphBoxes={glyphBoxesByBlock[selectedBlock?.id ?? -1] ?? []}
        glyphCatalog={glyphSchemaByBlock[selectedBlock?.id ?? -1] ?? {}}
        glyphRigs={glyphRigs}
        onSetGlyphEditTool={(tool) => {
          if (!selectedBlock || selectedBlock.type === "image") return;
          updateSelectedBlock({ glyphEditTool: tool, glyphMaskEdit: null });
        }}
        onSetStretchFactor={setStretchFactor}
        onUpdateStretchHandle={updateStretchHandle}
        onDeleteStretchHandle={deleteStretchHandle}
        onSetGlyphMaskEditMode={setGlyphMaskEditMode}
        onSaveStretchHandleAsRig={saveStretchHandleAsRig}
        onSetGlyphRigValue={setGlyphRigValue}
        onDeleteGlyphRigAxis={deleteGlyphRigAxis}
        onSetBlockKashidaAmount={setBlockKashidaAmount}
        isMobile={isMobile}
        width={RIGHT_PANEL_WIDTH}
        isCollapsed={rightPanelCollapsed}
        onToggleCollapse={() => setRightPanelCollapsed((v) => !v)}
        mobileOpen={showMorphEditorMobile}
        onCloseMobile={() => setShowMorphEditorMobile(false)}
      />

      <ConfirmDialog request={confirmRequest} onCancel={() => setConfirmRequest(null)} />
    </div>
  );
};

export default App;