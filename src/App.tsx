import React, { useEffect, useMemo, useRef, useState } from "react";
import type Konva from "konva";
import { exportStageSVG } from "react-konva-to-svg";
import { Sidebar } from "./components/Sidebar";
import { CanvasStage } from "./components/CanvasStage";

type Block = {
  id: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  opacity?: number;
  stroke?: string;
  strokeWidth?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  locked?: boolean;
};

type CanvasPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
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
  fontSize: 60,
  color: "#0066cc",
  fontFamily: "TahaNaskhRegular",
  fontStyle: "normal",
  opacity: 1,
  stroke: "#000000",
  strokeWidth: 0,
  shadowColor: "#000000",
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
  shadowOpacity: 0.35,
  locked: false,
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

  const stageRef = useRef<any>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(320);
  const nextIdRef = useRef(2);

  const currentPreset =
    CANVAS_PRESETS.find((p) => p.id === canvasPresetId) ?? CANVAS_PRESETS[0];

  const effectiveSidebarWidth = isMobile
    ? viewportWidth
    : Math.min(Math.max(sidebarWidth, 220), Math.max(260, viewportWidth - 260));

  const canvasWidth = Math.max(0, viewportWidth - effectiveSidebarWidth);
  const canvasHeight = currentPreset.height;
  const height = viewportHeight;

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
	  // Check if we have no blocks AND valid dimensions
	  if (blocks.length === 0 && canvasWidth > 0) {
		// Use the current preset dimensions for true centering on the canvas
		const centerX = currentPreset.width / 2;
		const centerY = currentPreset.height / 2;

		setBlocks([
		  { 
			...DEFAULT_BLOCK, 
			x: centerX, 
			y: centerY 
		  }
		]);
		setSelectedId(1);
	  }
	}, [blocks.length, canvasWidth, currentPreset]);
	
  useEffect(() => {
	  
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingSidebar || isMobile) return;
      const delta = e.clientX - resizeStartX.current;
      const newWidth = resizeStartWidth.current + delta;
      const sidebarMin = 220;
      const sidebarMax = Math.max(260, viewportWidth - 260);
      setSidebarWidth(Math.min(Math.max(newWidth, sidebarMin), sidebarMax));
    };
	
    const handleMouseUp = () => setIsResizingSidebar(false);

    if (!isBrowser) return;

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizingSidebar, isMobile, viewportWidth]);

  useEffect(() => {
    if (blocks.length === 0 && canvasWidth > 0 && canvasHeight > 0) {
      setBlocks([{ ...DEFAULT_BLOCK, x: canvasWidth / 2, y: canvasHeight / 2 }]);
      setSelectedId(1);
    }
  }, [blocks.length, canvasWidth, canvasHeight]);

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

  const updateSelectedBlock = (patch: Partial<Block>) => {
    if (!selectedBlock) return;
    setBlocks((prev) => prev.map((b) => (b.id === selectedBlock.id ? { ...b, ...patch } : b)));
  };

  const addBlock = () => {
    const newId = createNextId();
    const newBlock: Block = {
      ...DEFAULT_BLOCK,
      id: newId,
      text: "جديد",
	x: currentPreset.width / 2, // Use preset width
	y: currentPreset.height / 2, // Use preset height      fontSize: 50,
      color: "#990000",
    };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedId(newId);
  };

  const duplicateSelectedBlock = () => {
    if (!selectedBlock) return;
    const newId = createNextId();
    const copy: Block = {
      ...selectedBlock,
      id: newId,
      x: selectedBlock.x + 20,
      y: selectedBlock.y + 20,
    };
    setBlocks((prev) => [...prev, copy]);
    setSelectedId(newId);
  };

  const deleteSelectedBlock = () => {
    if (!selectedBlock) return;
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

    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return null;
    }

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

  const saveLayout = () => {
    if (!isBrowser) return;
    const payload = { blocks, selectedId, canvasPresetId, backgroundColor, stageScale, stagePosition, panMode };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };

  const loadLayout = () => {
    if (!isBrowser) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.blocks)) setBlocks(parsed.blocks);
      if (typeof parsed.selectedId === "number" || parsed.selectedId === null) setSelectedId(parsed.selectedId);
      if (typeof parsed.canvasPresetId === "string") setCanvasPresetId(parsed.canvasPresetId);
      if (typeof parsed.backgroundColor === "string") setBackgroundColor(parsed.backgroundColor);
      if (typeof parsed.stageScale === "number") setStageScale(parsed.stageScale);
      if (
        parsed.stagePosition &&
        typeof parsed.stagePosition.x === "number" &&
        typeof parsed.stagePosition.y === "number"
      ) {
        setStagePosition(parsed.stagePosition);
      }
      if (typeof parsed.panMode === "boolean") setPanMode(parsed.panMode);
    } catch {
      // ignore invalid saved data
    }
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
        onChangeCanvasPreset={setCanvasPresetId}
        backgroundColor={backgroundColor}
        onChangeBackgroundColor={setBackgroundColor}
        onAddBlock={addBlock}
        onDuplicateBlock={duplicateSelectedBlock}
        onDeleteBlock={deleteSelectedBlock}
        onExportPNG={handleExportPNG}
        onExportSVG={handleExportSVG}
        onSaveLayout={saveLayout}
        onLoadLayout={loadLayout}
        onToggleGrid={setShowGrid}
        onToggleSnap={setSnapToGrid}
        onSelectBlock={setSelectedId}
        onUpdateSelectedBlock={updateSelectedBlock}
        showKeyboard={showKeyboard}
        onToggleKeyboard={() => setShowKeyboard((v) => !v)}
        onClearDiacritics={(block) =>
          onUpdateClearDiacritics(block, updateSelectedBlock)
        }
        onInsertPreset={(value) =>
          selectedBlock && updateSelectedBlock({ text: selectedBlock.text + value })
        }
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

      <div ref={canvasContainerRef} style={{ flex: 1, position: "relative" }}>
        <CanvasStage
          blocks={blocks}
          snapToGrid={snapToGrid}
          showGrid={showGrid}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          backgroundColor={backgroundColor}
          stageRef={stageRef}
          stageScale={stageScale}
          stagePosition={stagePosition}
          panMode={panMode}
          onTogglePanMode={setPanMode}
          onUpdateStage={updateStageZoom}
          onUpdateBlockPosition={(id, x, y) =>
            setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, x, y } : b)))
          }
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

function onUpdateClearDiacritics(
  block: { text: string } | undefined,
  updateSelectedBlock: (patch: Partial<Block>) => void
) {
  if (!block) return;
  updateSelectedBlock({ text: block.text.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "") });
}

export default App;
