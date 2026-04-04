import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
import type Konva from "konva";
import { exportStageSVG } from "react-konva-to-svg";
import { Sidebar } from "./components/Sidebar";
import { CanvasStage } from "./components/CanvasStage";
import jsPDF from "jspdf";
import type { Block } from "./types";

type CanvasPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
};

type EditorSnapshot = {
  blocks: Block[];
  canvasPresetId: string;
  backgroundColor: string;
};

const CANVAS_PRESETS: CanvasPreset[] = [
  { id: "square", label: "Instagram Square (1080×1080)", width: 1080, height: 1080 },
  { id: "story", label: "Story (1080×1920)", width: 1080, height: 1920 },
  { id: "a4", label: "Print A4 (2480×3508)", width: 2480, height: 3508 },
];

const EXPORT_PADDING = 40;
const STORAGE_KEY = "calligraphy-layout-v1";
const MIN_SCALE = 0.25;
const MAX_SCALE = 3;

const DEFAULT_BLOCK: Block = {
  id: 1,
  text: "بِسْمِ اللهِ الرَّحْمٰنِ الرَّحِيمِ",
  x: 0,
  y: 0,
  fontSize: 53,
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
  embossStrength: 0,
  type: "text",
};

const isBrowser = typeof window !== "undefined";

const App: React.FC = () => {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(1);
  const [showGrid, setShowGrid] = useState(true);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [isMobile, setIsMobile] = useState(isBrowser ? window.innerWidth <= 768 : false);
  const [canvasPresetId, setCanvasPresetId] = useState<string>("story");
  const [backgroundColor, setBackgroundColor] = useState<string>("#ffffff");
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [panMode, setPanMode] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(isBrowser ? window.innerWidth : 1200);
  const [viewportHeight, setViewportHeight] = useState(isBrowser ? window.innerHeight : 800);

  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(320);
  const nextIdRef = useRef(2);
  const undoStackRef = useRef<EditorSnapshot[]>([]);
  const redoStackRef = useRef<EditorSnapshot[]>([]);
  const moveTimeoutRef = useRef<number | null>(null);

  const currentPreset =
    CANVAS_PRESETS.find((p) => p.id === canvasPresetId) ?? CANVAS_PRESETS[0];

  const effectiveSidebarWidth = isMobile
    ? viewportWidth
    : Math.min(Math.max(sidebarWidth, 220), Math.max(260, viewportWidth - 260));

  const canvasWidth = Math.max(0, viewportWidth - effectiveSidebarWidth);
  // canvasHeight = artboard logical height (used for stage content / grid).
  // stageViewportHeight = the actual pixel height of the stage DOM element.
  const canvasHeight = currentPreset.height;
  const stageViewportHeight = viewportHeight;

  const getSnapshot = useCallback(
    (): EditorSnapshot => ({ blocks, canvasPresetId, backgroundColor }),
    [blocks, canvasPresetId, backgroundColor]
  );

  const applySnapshot = (snapshot: EditorSnapshot) => {
    setBlocks(snapshot.blocks);
    setCanvasPresetId(snapshot.canvasPresetId);
    setBackgroundColor(snapshot.backgroundColor);
  };

  const pushHistory = useCallback(() => {
    undoStackRef.current.push(getSnapshot());
    redoStackRef.current = [];
  }, [getSnapshot]);

  const handleUndo = useCallback(() => {
    const prev = undoStackRef.current.pop();
    if (!prev) return;
    redoStackRef.current.push(getSnapshot());
    applySnapshot(prev);
  }, [getSnapshot]);

  const handleRedo = useCallback(() => {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push(getSnapshot());
    applySnapshot(next);
  }, [getSnapshot]);

  const updateBlockPositionWithHistory = (id: number, x: number, y: number) => {
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)));
    if (moveTimeoutRef.current != null) window.clearTimeout(moveTimeoutRef.current);
    moveTimeoutRef.current = window.setTimeout(() => {
      pushHistory();
    }, 300);
  };

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
    if (blocks.length !== 0 || canvasWidth <= 0 || canvasHeight <= 0) return;
    const stage = stageRef.current;
    const container = canvasContainerRef.current;
    if (!stage || !container) return;

    const viewRect = container.getBoundingClientRect();
    const centerScreenX = viewRect.left + viewRect.width / 2;
    const targetScreenY = viewRect.top + viewRect.height * 0.2;
    const oldPointer = stage.getPointerPosition();

    stage.setPointersPositions({ clientX: centerScreenX, clientY: targetScreenY });
    const pos = stage.getRelativePointerPosition();
    const cx = pos?.x ?? 0;
    const cy = pos?.y ?? 0;

    if (oldPointer) {
      stage.setPointersPositions({ clientX: oldPointer.x, clientY: oldPointer.y });
    }

    setBlocks([{ ...DEFAULT_BLOCK, x: cx, y: cy }]);
    setSelectedId(1);
  }, [blocks.length, canvasWidth, canvasHeight, stageScale, stagePosition]);

  useEffect(() => {
    if (!isBrowser) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar || isMobile) return;
      const delta = e.clientX - resizeStartX.current;
      const newWidth = resizeStartWidth.current + delta;
      const sidebarMin = 220;
      const sidebarMax = Math.max(260, viewportWidth - 260);
      setSidebarWidth(Math.min(Math.max(newWidth, sidebarMin), sidebarMax));
    };
    const handleMouseUp = () => setIsResizingSidebar(false);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar, isMobile, viewportWidth]);

  useEffect(() => {
    if (!isBrowser) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.ctrlKey || e.metaKey;
      if (!meta) return;

      if (e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      }
      if ((e.key === "z" && e.shiftKey) || e.key === "y") {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo]);

  useEffect(() => {
    nextIdRef.current = Math.max(2, ...blocks.map((b) => b.id + 1));
  }, [blocks]);

  const selectedBlock = useMemo(
    () => (selectedId == null ? undefined : blocks.find((b) => b.id === selectedId)),
    [blocks, selectedId]
  );

  const createNextId = () => {
    const id = nextIdRef.current;
    nextIdRef.current += 1;
    return id;
  };

  const updateSelectedBlock = useCallback(
    (patch: Partial<Block>) => {
      if (!selectedBlock) return;
      pushHistory();
      setBlocks((prev) => prev.map((b) => (b.id === selectedBlock.id ? { ...b, ...patch } : b)));
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

        const merged: Block = {
          ...a,
          text: `${a.text} ${b.text}`.trim(),
        };

        return prev
          .map((bl) => (bl.id === idA ? merged : bl))
          .filter((bl) => bl.id !== idB);
      });
      setSelectedId(idA);
    },
    [pushHistory]
  );

  const getCenterStagePos = () => {
    const stage = stageRef.current;
    const container = canvasContainerRef.current;
    if (!stage || !container) return { x: 0, y: 0 };

    const viewRect = container.getBoundingClientRect();
    const centerScreenX = viewRect.left + viewRect.width / 2;
    const centerScreenY = viewRect.top + viewRect.height / 2;
    const oldPointer = stage.getPointerPosition();

    stage.setPointersPositions({ clientX: centerScreenX, clientY: centerScreenY });
    const pos = stage.getRelativePointerPosition();

    if (oldPointer) {
      stage.setPointersPositions({ clientX: oldPointer.x, clientY: oldPointer.y });
    }

    return { x: pos?.x ?? 0, y: pos?.y ?? 0 };
  };

  const addBlock = () => {
    pushHistory();
    const newId = createNextId();
    const { x, y } = getCenterStagePos();

    const newBlock: Block = {
      ...DEFAULT_BLOCK,
      id: newId,
      text: "نَصٌّ جَدِيدٌ",
      fontSize: 50,
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

  const deleteSelectedBlock = () => {
    if (!selectedBlock) return;
    pushHistory();

    setBlocks((prev) => {
      const filtered = prev.filter((b) => b.id !== selectedBlock.id);
      setSelectedId(filtered.length > 0 ? filtered[0].id : null);
      return filtered;
    });
  };

  const getBlocksBoundingBox = () => {
    const stage = stageRef.current;
    if (!stage || blocks.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    blocks.forEach((block) => {
      const node = stage.findOne(`#block-${block.id}`) as Konva.Node | null;
      if (!node) return;
      const rect = node.getClientRect({ relativeTo: stage });
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    });

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) return null;

    return {
      x: minX - EXPORT_PADDING,
      y: minY - EXPORT_PADDING,
      width: maxX - minX + 2 * EXPORT_PADDING,
      height: maxY - minY + 2 * EXPORT_PADDING,
    };
  };

  const handleExportPNG = () => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = getBlocksBoundingBox();
    if (!box) return;

    const dataURL = stage.toDataURL({
      mimeType: "image/png",
      quality: 1,
      pixelRatio: 2,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });

    const link = document.createElement("a");
    link.download = "calligraphy.png";
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportSVG = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = getBlocksBoundingBox();
    if (!box) return;

    const exported = await exportStageSVG(stage, false);
    const svgText = String(exported).trim();

    const finalSvg = svgText.startsWith("<svg")
      ? svgText
      : `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${svgText}</svg>`;

    const blob = new Blob([finalSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "calligraphy.svg";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleExportPDF = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = getBlocksBoundingBox();
    if (!box) return;

    const dataURL = stage.toDataURL({
      mimeType: "image/png",
      quality: 1,
      pixelRatio: 2,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });

    const pxToMm = (px: number) => (px * 25.4) / 96;
    const imgWidthMm = pxToMm(box.width);
    const imgHeightMm = pxToMm(box.height);

    const pdf = new jsPDF({
      orientation: imgWidthMm > imgHeightMm ? "landscape" : "portrait",
      unit: "mm",
      format: [imgWidthMm, imgHeightMm],
    });

    pdf.addImage(dataURL, "PNG", 0, 0, imgWidthMm, imgHeightMm);
    pdf.save("calligraphy.pdf");
  };

  const buildLayoutPayload = () => ({
    blocks,
    selectedId,
    canvasPresetId,
    backgroundColor,
    stageScale,
    stagePosition,
    panMode,
    version: 2,
  });

  const applyLayoutPayload = (parsed: any) => {
    if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
    if (typeof parsed.selectedId === "number" || parsed.selectedId === null) {
      setSelectedId(parsed.selectedId);
    }
    if (typeof parsed.canvasPresetId === "string") setCanvasPresetId(parsed.canvasPresetId);
    if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
    if (typeof parsed.stageScale === "number") setStageScale(parsed.stageScale);
    if (parsed.stagePosition && typeof parsed.stagePosition.x === "number") {
      setStagePosition(parsed.stagePosition);
    }
    if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);
  };

  const saveLayout = () => {
    if (!isBrowser) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(buildLayoutPayload()));
  };

  const loadLayout = () => {
    if (!isBrowser) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      applyLayoutPayload(JSON.parse(raw));
    } catch {
      // ignore
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
          applyLayoutPayload(JSON.parse(e.target?.result as string));
        } catch {
          alert("Invalid layout file.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const updateStageZoom = (scale: number, position: { x: number; y: number }) => {
    setStageScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale)));
    setStagePosition(position);
  };

  const startSidebarResize = (e: React.MouseEvent) => {
    resizeStartX.current = e.clientX;
    resizeStartWidth.current = sidebarWidth;
    setIsResizingSidebar(true);
  };

  const addShapeFillBlock = (svgPathData: string, shapeWidth: number, shapeHeight: number) => {
    pushHistory();
    const newId = createNextId();
    const { x, y } = getCenterStagePos();

    // Auto-size fontSize so roughly 10-15 rows fit inside the shape height.
    // This gives a dense fill regardless of SVG size.
    const autoFontSize = Math.max(8, Math.round(shapeHeight / 12));

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

  const clearDiacritics = useCallback(() => {
    if (!selectedBlock) return;
    updateSelectedBlock({
      text: selectedBlock.text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, ""),
    });
  }, [selectedBlock, updateSelectedBlock]);

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
        background: "#e0e0e0",
      }}
    >
      <Sidebar
        blocks={blocks}
        selectedBlock={selectedBlock}
        showGrid={showGrid}
        snapToGrid={snapToGrid}
        isMobile={isMobile}
        width={effectiveSidebarWidth}
        canvasPresetId={canvasPresetId}
        onChangeCanvasPreset={(id) => {
          pushHistory();
          setCanvasPresetId(id);
        }}
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
        onToggleGrid={setShowGrid}
        onToggleSnap={setSnapToGrid}
        onSelectBlock={setSelectedId}
        onUpdateSelectedBlock={updateSelectedBlock}
        onUpdateBlock={updateBlock}
        onReorderBlocks={reorderBlocks}
        onMergeBlocks={mergeBlocks}
        showKeyboard={showKeyboard}
        onToggleKeyboard={() => setShowKeyboard((v) => !v)}
        onClearDiacritics={clearDiacritics}
        onInsertPreset={(value) =>
          selectedBlock && updateSelectedBlock({ text: selectedBlock.text + value })
        }
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={undoStackRef.current.length > 0}
        canRedo={redoStackRef.current.length > 0}
      />

      <div
        onMouseDown={isMobile ? undefined : startSidebarResize}
        style={{
          width: isMobile ? "100%" : 6,
          cursor: isMobile ? "default" : "col-resize",
          background: isMobile
            ? "transparent"
            : "linear-gradient(180deg, rgba(0,0,0,0), rgba(0,0,0,0.06), rgba(0,0,0,0))",
          flexShrink: 0,
        }}
      />

      <div
        ref={canvasContainerRef}
        style={{ flex: 1, position: "relative", height: viewportHeight, overflow: "hidden" }}
      >
        <CanvasStage
          blocks={blocks}
          snapToGrid={snapToGrid}
          showGrid={showGrid}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
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
          showKeyboard={showKeyboard}
          onKeyFromKeyboard={(k) =>
            selectedBlock && updateSelectedBlock({ text: selectedBlock.text + k })
          }
          onSpaceFromKeyboard={() =>
            selectedBlock && updateSelectedBlock({ text: selectedBlock.text + " " })
          }
          onBackspaceFromKeyboard={() =>
            selectedBlock && updateSelectedBlock({ text: selectedBlock.text.slice(0, -1) })
          }
        />
      </div>
    </div>
  );
};

export default App;