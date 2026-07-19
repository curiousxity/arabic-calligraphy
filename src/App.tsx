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
import { useUndoRedo } from "./hooks/useUndoRedo";
import { useExport } from "./hooks/useExport";
import { isTypingTarget } from "./lib/dom";
import { STARTER_TEMPLATES } from "./lib/templates";
import {
  MIN_SCALE,
  MAX_SCALE,
  getBlocksBoundingBox,
  padBox,
  computeFitToBox,
  DEFAULT_EMPTY_BOUNDS,
} from "./lib/canvasBounds";
import type { Block, GlyphWarp, GlyphHandleMode } from "./types";

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

export type NamedProjectMeta = { name: string; savedAt: number };
type NamedProjectsStore = Record<string, { savedAt: number; payload: unknown }>;

type GlyphBox = {
  glyphIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
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
      aa.height !== bb.height
    ) {
      return false;
    }
  }
  return true;
};

const STORAGE_KEY = "calligraphy-layout-v2";
const NAMED_PROJECTS_KEY = "harfcanvas-named-projects-v1";
const SIDEBAR_COLLAPSED_WIDTH = 28;
const DEFAULT_TEXT_FONT_SIZE = 53;
const DEFAULT_NEW_BLOCK_FONT_SIZE = 53;

const DEFAULT_BLOCK: Block = {
  id: 1,
  text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
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

const App: React.FC = () => {
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
  const [isMobile, setIsMobile] = useState(isBrowser ? window.innerWidth <= 768 : false);
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff");
  const [sidebarWidth, setSidebarWidth] = useState(360);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(isBrowser ? window.innerWidth : 1200);
  const [viewportHeight, setViewportHeight] = useState(isBrowser ? window.innerHeight : 800);

  const [glyphBoxesByBlock, setGlyphBoxesByBlock] = useState<Record<number, GlyphBox[]>>({});

  const effectiveSidebarWidth = isMobile
    ? viewportWidth
    : sidebarCollapsed
      ? SIDEBAR_COLLAPSED_WIDTH
      : Math.min(Math.max(sidebarWidth, 220), Math.max(260, viewportWidth - 260));

  const canvasWidth = isMobile
    ? viewportWidth
    : Math.max(0, viewportWidth - effectiveSidebarWidth);

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
    {
      ...DEFAULT_BLOCK,
      id: 2,
      text: "حرف",
      x: 0,
      y: 100,
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
  const moveTimeoutRef = useRef<number | null>(null);
  const didHydrateLayoutRef = useRef(false);
  const prevViewportRef = useRef({ w: 0, h: 0 });

  const selectedBlock = useMemo(
    () => (selectedId == null ? undefined : blocks.find((b) => b.id === selectedId)),
    [blocks, selectedId]
  );

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

  const upsertGlyphWarp = useCallback(
    (
      blockId: number,
      glyphIndex: number,
      updater: (prev: GlyphWarp | undefined) => GlyphWarp
    ) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type !== "shapeWarp") return b;
          const glyphWarps = b.glyphWarps ?? [];
          const existing = glyphWarps.find((g) => g.glyphIndex === glyphIndex);
          const next = updater(existing);
          return {
            ...b,
            glyphWarps: [
              ...glyphWarps.filter((g) => g.glyphIndex !== glyphIndex),
              next,
            ].sort((a, b) => a.glyphIndex - b.glyphIndex),
          };
        })
      );
    },
    [pushHistory]
  );

  const selectGlyphForBlock = useCallback((blockId: number, glyphIndex: number | null) => {
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === blockId && b.type === "shapeWarp" ? { ...b, selectedGlyphIndex: glyphIndex } : b
      )
    );
  }, []);

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

  const addHandleToSelectedGlyph = useCallback(() => {
    if (!selectedBlock || selectedBlock.type !== "shapeWarp" || selectedBlock.selectedGlyphIndex == null) return;

    const blockId = selectedBlock.id;
    const glyphIndex = selectedBlock.selectedGlyphIndex;
    const handleId = makeHandleId();

    const boxes = glyphBoxesByBlock[blockId] ?? [];
    const box = boxes.find((b) => b.glyphIndex === glyphIndex);

    const centerX = box ? box.x + box.width / 2 : selectedBlock.x;
    const centerY = box ? box.y + box.height / 2 : selectedBlock.y;
    const radius = box ? Math.max(30, Math.max(box.width, box.height) * 0.8) : 80;

    upsertGlyphWarp(blockId, glyphIndex, (prev) => ({
      glyphIndex,
      handles: [
        ...(prev?.handles ?? []),
        {
          id: handleId,
          x: centerX,
          y: centerY,
          radius,
          strength: 0.5,
          mode: "pinch",
        },
      ],
    }));
  }, [selectedBlock, glyphBoxesByBlock, upsertGlyphWarp]);

  const updateGlyphHandle = useCallback(
    (
      blockId: number,
      glyphIndex: number,
      handleId: string,
      patch: {
        x?: number;
        y?: number;
        radius?: number;
        strength?: number;
        mode?: GlyphHandleMode;
      }
    ) => {
      upsertGlyphWarp(blockId, glyphIndex, (prev) => ({
        glyphIndex,
        handles: (prev?.handles ?? []).map((h) =>
          h.id === handleId ? { ...h, ...patch } : h
        ),
      }));
    },
    [upsertGlyphWarp]
  );

  const deleteGlyphHandle = useCallback(
    (blockId: number, glyphIndex: number, handleId: string) => {
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== blockId || b.type !== "shapeWarp") return b;
          const glyphWarps = b.glyphWarps ?? [];
          const existing = glyphWarps.find((g) => g.glyphIndex === glyphIndex);
          if (!existing) return b;
          const nextHandles = existing.handles.filter((h) => h.id !== handleId);
          return {
            ...b,
            glyphWarps:
              nextHandles.length > 0
                ? glyphWarps.map((g) =>
                    g.glyphIndex === glyphIndex ? { ...g, handles: nextHandles } : g
                  )
                : glyphWarps.filter((g) => g.glyphIndex !== glyphIndex),
          };
        })
      );
    },
    [pushHistory]
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
                glyphWarps: [],
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
      if (moveTimeoutRef.current != null) window.clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = window.setTimeout(() => pushHistory(), 300);
    },
    [pushHistory]
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
   * viewport (7% down) instead of vertically centering it — used only for
   * the very first paint of the default starter content, not general
   * "fit all content" (that's what the toolbar's Reset View button and
   * `resetView` are for).
   */
  const fitInitialView = useCallback(
    (targetBlocks: Block[]) => {
      if (canvasWidth <= 0 || stageViewportHeight <= 0) return;
      const stage = stageRef.current;
      const box = stage ? getBlocksBoundingBox(stage, targetBlocks) : null;
      const b = padBox(box ?? DEFAULT_EMPTY_BOUNDS);
      const fit = computeFitToBox(canvasWidth, stageViewportHeight, b, 0);
      setStageScale(fit.scale);
      setStagePosition({
        x: canvasWidth / 2 - (b.x + b.width / 2) * fit.scale,
        y: stageViewportHeight * 0.07 - b.y * fit.scale,
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

        const parsed = JSON.parse(raw);

        const hydratedBlocks: Block[] = Array.isArray(parsed.blocks) ? parsed.blocks : blocks;
        if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
        if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
          setSelectedIds([]);
          setSelectedId(parsed.selectedId);
        }
        if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
        if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);

        const savedViewportWidth =
          typeof parsed.viewportWidth === "number" ? parsed.viewportWidth : null;
        const savedViewportHeight =
          typeof parsed.viewportHeight === "number" ? parsed.viewportHeight : null;

        const viewportCloseEnough =
          savedViewportWidth != null &&
          savedViewportHeight != null &&
          Math.abs(savedViewportWidth - viewportWidth) < 80 &&
          Math.abs(savedViewportHeight - viewportHeight) < 80;

        if (
          viewportCloseEnough &&
          typeof parsed.stageScale === "number" &&
          parsed.stagePosition &&
          typeof parsed.stagePosition.x === "number" &&
          typeof parsed.stagePosition.y === "number"
        ) {
          setStageScale(clamp(parsed.stageScale, MIN_SCALE, MAX_SCALE));
          setStagePosition(parsed.stagePosition);
        } else {
          setTimeout(() => resetView(hydratedBlocks), 0);
        }
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

  const addBlock = () => {
    pushHistory();
    const newId = createNextId();
    const { x, y } = getCenterStagePos();

    const newBlock: Block = {
      ...DEFAULT_BLOCK,
      id: newId,
      text: "نَصٌّ جَدِيدٌ",
      fontSize: DEFAULT_NEW_BLOCK_FONT_SIZE,
      color: "#1e3a5f",
      x,
      y,
    };

    setBlocks((prev) => [...prev, newBlock]);
    setSelectedIds([]);
    setSelectedId(newId);
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
    version: 3,
  });

  const saveLayout = () => {
    if (!isBrowser) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildLayoutPayload()));
    } catch {
      // Ignore quota-exceeded / privacy-mode storage errors — saving layout is best-effort.
    }
  };

  const applyStoredPayload = (raw: string) => {
    try {
      const parsed = JSON.parse(raw);

      const loadedBlocks: Block[] = Array.isArray(parsed.blocks) ? parsed.blocks : blocks;
      if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
      if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
        setSelectedIds([]);
        setSelectedId(parsed.selectedId);
      }
      if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
      if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);

      const savedViewportWidth =
        typeof parsed.viewportWidth === "number" ? parsed.viewportWidth : null;
      const savedViewportHeight =
        typeof parsed.viewportHeight === "number" ? parsed.viewportHeight : null;

      const viewportCloseEnough =
        savedViewportWidth != null &&
        savedViewportHeight != null &&
        Math.abs(savedViewportWidth - viewportWidth) < 80 &&
        Math.abs(savedViewportHeight - viewportHeight) < 80;

      if (
        viewportCloseEnough &&
        typeof parsed.stageScale === "number" &&
        parsed.stagePosition &&
        typeof parsed.stagePosition.x === "number" &&
        typeof parsed.stagePosition.y === "number"
      ) {
        setStageScale(clamp(parsed.stageScale, MIN_SCALE, MAX_SCALE));
        setStagePosition(parsed.stagePosition);
      } else {
        setTimeout(() => resetView(loadedBlocks), 0);
      }
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

  const downloadLayout = () => {
    const json = JSON.stringify(buildLayoutPayload(), null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "calligraphy-layout.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
          const parsed = JSON.parse(e.target?.result as string);

          const uploadedBlocks: Block[] = Array.isArray(parsed.blocks) ? parsed.blocks : blocks;
          if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
          if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
            setSelectedIds([]);
            setSelectedId(parsed.selectedId);
          }
          if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
          if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);

          setTimeout(() => resetView(uploadedBlocks), 0);
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
    pushHistory();
    const newId = createNextId();
    const { x, y } = getCenterStagePos();

    const autoFontSize = Math.max(8, Math.round(shapeHeight / 18));

    const newBlock: Block = {
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
      x: x - shapeWidth / 2,
      y: y - shapeHeight / 2,
    };

    setBlocks((prev) => [...prev, newBlock]);
    setSelectedIds([]);
    setSelectedId(newId);
  };

  const addShapeWarpBlock = (
    svgPathData: string,
    shapeWidth: number,
    shapeHeight: number
  ) => {
    pushHistory();
    const newId = createNextId();
    const { x, y } = getCenterStagePos();

    const autoFontSize = Math.max(8, Math.round(shapeHeight / 6));

    const newBlock: Block = {
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
      x: x - shapeWidth / 2,
      y: y - shapeHeight / 2,
      glyphEditMode: false,
      selectedGlyphIndex: null,
      glyphWarps: [],
    };

    setBlocks((prev) => [...prev, newBlock]);
    setSelectedIds([]);
    setSelectedId(newId);
  };

  const addImageBlock = (dataUrl: string, naturalWidth: number, naturalHeight: number) => {
    pushHistory();
    const newId = createNextId();
    const { x, y } = getCenterStagePos();

    const maxDim = (Math.max(canvasWidth, stageViewportHeight) / stageScale) * 0.6;
    const fitScale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight, 1));
    const displayWidth = naturalWidth * fitScale;
    const displayHeight = naturalHeight * fitScale;

    const newBlock: Block = {
      ...DEFAULT_BLOCK,
      id: newId,
      text: "",
      type: "image",
      imageDataUrl: dataUrl,
      imageScale: 1,
      shapeWidth: displayWidth,
      shapeHeight: displayHeight,
      x: x - displayWidth / 2,
      y: y - displayHeight / 2,
    };

    setBlocks((prev) => [...prev, newBlock]);
    setSelectedIds([]);
    setSelectedId(newId);
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
        onDeleteNamedProject={deleteNamedProject}
        onAddShapeFillBlock={addShapeFillBlock}
        onAddShapeWarpBlock={addShapeWarpBlock}
        onAddImageBlock={uploadImageBlock}
        onApplyTemplate={applyStarterTemplate}
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
        onInsertPreset={(value) =>
          selectedBlock && updateSelectedBlock({ text: selectedBlock.text + value })
        }
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={canUndo}
        canRedo={canRedo}
        onToggleGlyphEditMode={() => {
          if (!selectedBlock || selectedBlock.type !== "shapeWarp") return;
          updateSelectedBlock({
            glyphEditMode: !selectedBlock.glyphEditMode,
          });
        }}
        onAddGlyphHandle={addHandleToSelectedGlyph}
        onDeleteGlyphHandle={deleteGlyphHandle}
        onUpdateGlyphHandle={updateGlyphHandle}
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
          onUpdateGlyphHandle={updateGlyphHandle}
          onGlyphBoxesChange={updateGlyphBoxes}
          onResizeShapeFillBlock={resizeShapeFillBlock}
          onResizeImageBlock={resizeImageBlock}
        />
      </div>
    </div>
  );
};

export default App;