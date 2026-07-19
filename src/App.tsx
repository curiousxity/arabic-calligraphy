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
import type { Block, GlyphWarp, GlyphHandleMode } from "./types";

type CanvasPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

type EditorSnapshot = {
  blocks: Block[];
  canvasPresetId: string;
  customCanvasSize: { width: number; height: number };
  backgroundColor: string;
};

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

const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "square", label: "Instagram Square (1080×1080)", width: 1080, height: 1080 },
  { id: "story", label: "Story (1080×1920)", width: 1080, height: 1920 },
  { id: "a4", label: "Print A4 (2480×3508)", width: 2480, height: 3508 },
];

const STORAGE_KEY = "calligraphy-layout-v2";
const MIN_SCALE = 0.05;
const MAX_SCALE = 3;
const STAGE_PADDING = 0;
const SIDEBAR_COLLAPSED_WIDTH = 28;
const DEFAULT_TEXT_FONT_SIZE = 53;
const DEFAULT_NEW_BLOCK_FONT_SIZE = 53;

const DEFAULT_BLOCK: Block = {
  id: 1,
  text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
  x: 0,
  y: 0,
  fontSize: DEFAULT_TEXT_FONT_SIZE,
  color: "#0066cc",
  fontFamily: "TahaNaskhRegular",
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

const parseCustomCanvasSize = (
  value: unknown
): { width: number; height: number } | null => {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { width?: unknown }).width === "number" &&
    typeof (value as { height?: unknown }).height === "number"
  ) {
    const { width, height } = value as { width: number; height: number };
    return { width: clamp(Math.round(width), 50, 8000), height: clamp(Math.round(height), 50, 8000) };
  }
  return null;
};

const computeFitToViewport = (
  canvasWidth: number,
  viewportHeight: number,
  preset: CanvasPreset
) => {
  const availW = Math.max(1, canvasWidth - STAGE_PADDING * 2);
  const availH = Math.max(1, viewportHeight - STAGE_PADDING * 2);
  const scaleX = availW / preset.width;
  const scaleY = availH / preset.height;
  const scale = clamp(Math.max(scaleX, scaleY), MIN_SCALE, MAX_SCALE);
  const scaledW = preset.width * scale;
  const scaledH = preset.height * scale;

  return {
    scale,
    position: {
      x: (canvasWidth - scaledW) / 2,
      y: Math.max(STAGE_PADDING, (viewportHeight - scaledH) / 2),
    },
  };
};

const makeHandleId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `gh-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const App: React.FC = () => {
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [isMobile, setIsMobile] = useState(isBrowser ? window.innerWidth <= 768 : false);
  const [canvasPresetId, setCanvasPresetId] = useState<string>("story");
  const [customCanvasSize, setCustomCanvasSize] = useState<{ width: number; height: number }>({
    width: 1080,
    height: 1080,
  });
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [panMode, setPanMode] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(isBrowser ? window.innerWidth : 1200);
  const [viewportHeight, setViewportHeight] = useState(isBrowser ? window.innerHeight : 800);

  const [glyphBoxesByBlock, setGlyphBoxesByBlock] = useState<Record<number, GlyphBox[]>>({});

  const currentPreset: CanvasPreset = useMemo(
    () =>
      canvasPresetId === "custom"
        ? {
            id: "custom",
            label: "Custom",
            width: customCanvasSize.width,
            height: customCanvasSize.height,
          }
        : CANVAS_PRESETS.find((p) => p.id === canvasPresetId) ?? CANVAS_PRESETS[0],
    [canvasPresetId, customCanvasSize]
  );

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

  const initialFit = computeFitToViewport(
    Math.max(1, isBrowser ? window.innerWidth - 320 : 880),
    isBrowser ? window.innerHeight : 800,
    CANVAS_PRESETS.find((p) => p.id === "story") ?? CANVAS_PRESETS[0]
  );

  const [stageScale, setStageScale] = useState(initialFit.scale);
  const [stagePosition, setStagePosition] = useState(initialFit.position);

  const [blocks, setBlocks] = useState<Block[]>(() => {
    const preset = CANVAS_PRESETS.find((p) => p.id === "story") ?? CANVAS_PRESETS[0];
    return [
      {
        ...DEFAULT_BLOCK,
        x: preset.width / 2,
        y: preset.height * 0.25,
      },
    ];
  });

  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(320);
  const nextIdRef = useRef(2);
  const clipboardRef = useRef<Block | null>(null);
  const [editRequestSignal, setEditRequestSignal] = useState(0);
  const moveTimeoutRef = useRef<number | null>(null);
  const customSizeTimeoutRef = useRef<number | null>(null);
  const lastAutoFitSignatureRef = useRef<string>("");
  const didHydrateLayoutRef = useRef(false);
  const skipNextAutoFitRef = useRef(false);

  const selectedBlock = useMemo(
    () => (selectedId == null ? undefined : blocks.find((b) => b.id === selectedId)),
    [blocks, selectedId]
  );

  const getSnapshot = useCallback(
    (): EditorSnapshot => ({ blocks, canvasPresetId, customCanvasSize, backgroundColor }),
    [blocks, canvasPresetId, customCanvasSize, backgroundColor]
  );

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    setBlocks(snapshot.blocks);
    setCanvasPresetId(snapshot.canvasPresetId);
    setCustomCanvasSize(snapshot.customCanvasSize);
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

  const updateBlockPositionWithHistory = useCallback(
    (id: number, x: number, y: number) => {
      setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)));
      if (moveTimeoutRef.current != null) window.clearTimeout(moveTimeoutRef.current);
      moveTimeoutRef.current = window.setTimeout(() => pushHistory(), 300);
    },
    [pushHistory]
  );

  const changeCustomCanvasSize = useCallback(
    (width: number, height: number) => {
      setCanvasPresetId("custom");
      setCustomCanvasSize({
        width: clamp(Math.round(width), 50, 8000),
        height: clamp(Math.round(height), 50, 8000),
      });
      if (customSizeTimeoutRef.current != null) window.clearTimeout(customSizeTimeoutRef.current);
      customSizeTimeoutRef.current = window.setTimeout(() => pushHistory(), 300);
    },
    [pushHistory]
  );

  const fitStageToViewport = useCallback(
    (options?: { force?: boolean }) => {
      if (canvasWidth <= 0 || stageViewportHeight <= 0) return;

      const fit = computeFitToViewport(canvasWidth, stageViewportHeight, currentPreset);
      const signature = [
        currentPreset.id,
        canvasWidth,
        stageViewportHeight,
        Math.round(fit.scale * 10000),
        Math.round(fit.position.x),
        Math.round(fit.position.y),
      ].join(":");

      if (!options?.force && lastAutoFitSignatureRef.current === signature) return;

      lastAutoFitSignatureRef.current = signature;
      setStageScale(fit.scale);
      setStagePosition(fit.position);
      setPanMode(false);
    },
    [canvasWidth, stageViewportHeight, currentPreset]
  );

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
          // One-time layout hydration on mount; fits the stage to the current viewport.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          fitStageToViewport({ force: true });
          return;
        }

        const parsed = JSON.parse(raw);

        if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
        if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
          setSelectedId(parsed.selectedId);
        }
        if (typeof parsed.canvasPresetId === "string") setCanvasPresetId(parsed.canvasPresetId);
        const parsedCustomSize = parseCustomCanvasSize(parsed.customCanvasSize);
        if (parsedCustomSize) setCustomCanvasSize(parsedCustomSize);
        if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
        if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);

        const samePreset =
          typeof parsed.canvasPresetId === "string"
            ? parsed.canvasPresetId === currentPreset.id
            : true;

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
          samePreset &&
          viewportCloseEnough &&
          typeof parsed.stageScale === "number" &&
          parsed.stagePosition &&
          typeof parsed.stagePosition.x === "number" &&
          typeof parsed.stagePosition.y === "number"
        ) {
          setStageScale(clamp(parsed.stageScale, MIN_SCALE, MAX_SCALE));
          setStagePosition(parsed.stagePosition);
          skipNextAutoFitRef.current = true;
        } else {
          fitStageToViewport({ force: true });
        }
      } catch {
        fitStageToViewport({ force: true });
      }
    }
  }, [currentPreset.id, fitStageToViewport, viewportWidth, viewportHeight]);

  useEffect(() => {
    if (canvasWidth <= 0 || stageViewportHeight <= 0) return;

    if (skipNextAutoFitRef.current) {
      skipNextAutoFitRef.current = false;
      return;
    }

    // Re-fit the stage transform whenever the canvas/preset dimensions change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fitStageToViewport({ force: true });
  }, [canvasWidth, stageViewportHeight, canvasPresetId, fitStageToViewport]);

  if (blocks.length === 0) {
    setBlocks([
      {
        ...DEFAULT_BLOCK,
        x: currentPreset.width / 2,
        y: currentPreset.height * 0.25,
      },
    ]);
    setSelectedId(1);
  }

  const deleteSelectedBlock = useCallback(() => {
    if (!selectedBlock) return;
    pushHistory();
    setBlocks((prev) => {
      const filtered = prev.filter((b) => b.id !== selectedBlock.id);
      setSelectedId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
  }, [selectedBlock, pushHistory]);

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
            };
            setBlocks((prev) => [...prev, copy]);
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
        if (selectedBlock && !selectedBlock.locked) {
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
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    handleUndo,
    handleRedo,
    selectedBlock,
    updateBlockPositionWithHistory,
    pushHistory,
    deleteSelectedBlock,
  ]);

  const createNextId = () => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  };

  const updateSelectedBlock = useCallback(
    (patch: Partial<Block>) => {
      if (!selectedBlock) return;
      pushHistory();
      setBlocks((prev) =>
        prev.map((b) => (b.id === selectedBlock.id ? { ...b, ...patch } : b))
      );
    },
    [selectedBlock, pushHistory]
  );

  const updateBlock = useCallback(
    (id: number, patch: Partial<Block>) => {
      pushHistory();
      setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    },
    [pushHistory]
  );

  const reorderBlocks = useCallback(
    (newBlocks: Block[]) => {
      pushHistory();
      setBlocks(newBlocks);
    },
    [pushHistory]
  );

  const mergeBlocks = useCallback(
    (idA: number, idB: number) => {
      pushHistory();
      setBlocks((prev) => {
        const a = prev.find((b) => b.id === idA);
        const b = prev.find((b) => b.id === idB);
        if (!a || !b) return prev;
        const merged: Block = { ...a, text: `${a.text} ${b.text}`.trim() };
        return prev.map((bl) => (bl.id === idA ? merged : bl)).filter((bl) => bl.id !== idB);
      });
      setSelectedId(idA);
    },
    [pushHistory]
  );

  const getCenterStagePos = useCallback(() => {
    const stage = stageRef.current;
    const container = canvasContainerRef.current;
    if (!stage || !container) {
      return { x: currentPreset.width / 2, y: currentPreset.height / 2 };
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
      x: pos?.x ?? currentPreset.width / 2,
      y: pos?.y ?? currentPreset.height / 2,
    };
  }, [currentPreset]);

  const zoomToBlock = useCallback(
    (id: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const node = stage.findOne(`#block-${id}`);
      if (!node) return;

      const rect = node.getClientRect({ relativeTo: stage });
      const ZOOM_PADDING = 60;
      const availW = Math.max(1, canvasWidth - ZOOM_PADDING * 2);
      const availH = Math.max(1, stageViewportHeight - ZOOM_PADDING * 2);
      const scale = clamp(
        Math.min(availW / Math.max(rect.width, 1), availH / Math.max(rect.height, 1)),
        MIN_SCALE,
        MAX_SCALE
      );

      const position = {
        x: canvasWidth / 2 - (rect.x + rect.width / 2) * scale,
        y: stageViewportHeight / 2 - (rect.y + rect.height / 2) * scale,
      };

      setStageScale(scale);
      setStagePosition(position);
      setPanMode(false);
    },
    [canvasWidth, stageViewportHeight]
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
      color: "#0066cc",
      x,
      y,
    };

    setBlocks((prev) => [...prev, newBlock]);
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
    };

    setBlocks((prev) => [...prev, copy]);
    setSelectedId(newId);
  };

  const { handleExportPNG, handleExportSVG, handleExportPDF } = useExport(stageRef, blocks);

  const buildLayoutPayload = () => ({
    blocks,
    selectedId,
    canvasPresetId,
    customCanvasSize,
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

  const loadLayout = () => {
    if (!isBrowser) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
      if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
        setSelectedId(parsed.selectedId);
      }
      if (typeof parsed.canvasPresetId === "string") setCanvasPresetId(parsed.canvasPresetId);
      const parsedCustomSize = parseCustomCanvasSize(parsed.customCanvasSize);
      if (parsedCustomSize) setCustomCanvasSize(parsedCustomSize);
      if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
      if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);

      const loadedPresetId = parsed.canvasPresetId ?? canvasPresetId;
      const loadedPresetDims: CanvasPreset =
        loadedPresetId === "custom"
          ? {
              id: "custom",
              label: "Custom",
              width: (parsedCustomSize ?? customCanvasSize).width,
              height: (parsedCustomSize ?? customCanvasSize).height,
            }
          : CANVAS_PRESETS.find((p) => p.id === loadedPresetId) ?? currentPreset;

      const currentFit = computeFitToViewport(
        canvasWidth || Math.max(1, viewportWidth - effectiveSidebarWidth),
        stageViewportHeight || viewportHeight,
        loadedPresetDims
      );

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
        skipNextAutoFitRef.current = true;
      } else {
        setStageScale(currentFit.scale);
        setStagePosition(currentFit.position);
      }
    } catch {
      fitStageToViewport({ force: true });
    }
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

          if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
          if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
            setSelectedId(parsed.selectedId);
          }
          if (typeof parsed.canvasPresetId === "string") setCanvasPresetId(parsed.canvasPresetId);
          const parsedCustomSize = parseCustomCanvasSize(parsed.customCanvasSize);
          if (parsedCustomSize) setCustomCanvasSize(parsedCustomSize);
          if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
          if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);

          setTimeout(() => {
            fitStageToViewport({ force: true });
          }, 0);
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
    setSelectedId(newId);
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
        showGrid={showGrid}
        snapToGrid={snapToGrid}
        isMobile={isMobile}
        width={effectiveSidebarWidth}
        isCollapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        canvasPresetId={canvasPresetId}
        onChangeCanvasPreset={(id) => {
          pushHistory();
          setCanvasPresetId(id);
        }}
        customCanvasSize={customCanvasSize}
        onChangeCustomSize={changeCustomCanvasSize}
        backgroundColor={backgroundColor}
        onChangeBackgroundColor={(color) => {
          pushHistory();
          setBackgroundColor(color);
        }}
        onAddBlock={addBlock}
        onDuplicateBlock={duplicateSelectedBlock}
        onDeleteBlock={deleteSelectedBlock}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onExportPDF={handleExportPDF}
        onSaveLayout={saveLayout}
        onLoadLayout={loadLayout}
        onDownloadLayout={downloadLayout}
        onUploadLayout={uploadLayout}
        onAddShapeFillBlock={addShapeFillBlock}
        onAddShapeWarpBlock={addShapeWarpBlock}
        onToggleGrid={setShowGrid}
        onToggleSnap={setSnapToGrid}
        onSelectBlock={setSelectedId}
        editRequestSignal={editRequestSignal}
        onUpdateSelectedBlock={updateSelectedBlock}
        onUpdateBlock={updateBlock}
        onReorderBlocks={reorderBlocks}
        onMergeBlocks={mergeBlocks}
        onZoomToBlock={zoomToBlock}
        showKeyboard={showKeyboard}
        onToggleKeyboard={() => setShowKeyboard((v) => !v)}
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
          snapToGrid={snapToGrid}
          showGrid={showGrid}
          viewportWidth={canvasWidth}
          artboardWidth={currentPreset.width}
          artboardHeight={currentPreset.height}
          stageViewportHeight={stageViewportHeight}
          backgroundColor={backgroundColor}
          stageRef={stageRef}
          stageScale={stageScale}
          stagePosition={stagePosition}
          panMode={panMode}
          onTogglePanMode={setPanMode}
          onUpdateStage={updateStageZoom}
          onUpdateBlockPosition={updateBlockPositionWithHistory}
          onSelectBlock={setSelectedId}
          onEditBlock={requestTextEdit}
          onSelectGlyph={selectGlyphForBlock}
          onUpdateGlyphHandle={updateGlyphHandle}
          onGlyphBoxesChange={updateGlyphBoxes}
        />
      </div>
    </div>
  );
};

export default App;