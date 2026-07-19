import type { RefObject } from "react";
import type Konva from "konva";
import type { Block } from "../types";

const EXPORT_PADDING = 0;

/** PNG/SVG/PDF export handlers for the current stage contents. */
export function useExport(stageRef: RefObject<Konva.Stage | null>, blocks: Block[]) {
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

    if (!isFinite(minX)) return null;

    return {
      x: minX - EXPORT_PADDING,
      y: minY - EXPORT_PADDING,
      width: maxX - minX + 2 * EXPORT_PADDING,
      height: maxY - minY + 2 * EXPORT_PADDING,
    };
  };

  /**
   * Hides the on-screen alignment grid (and, optionally, the artboard
   * background fill) while `fn` runs, so exports never bake in either.
   */
  const withExportAdjustments = async <T,>(
    stage: Konva.Stage,
    opts: { transparent?: boolean },
    fn: () => T | Promise<T>
  ): Promise<T> => {
    const gridNode = stage.findOne("#grid-lines");
    const bgNode = opts.transparent ? stage.findOne("#artboard-background") : null;
    const gridWasVisible = gridNode?.visible() ?? false;
    const bgWasVisible = bgNode?.visible() ?? false;
    gridNode?.visible(false);
    bgNode?.visible(false);
    if (gridNode || bgNode) stage.batchDraw();
    try {
      return await fn();
    } finally {
      gridNode?.visible(gridWasVisible);
      bgNode?.visible(bgWasVisible);
      if (gridNode || bgNode) stage.batchDraw();
    }
  };

  const handleExportPNG = async (transparent = false) => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = getBlocksBoundingBox();
    if (!box) return;

    const dataURL = await withExportAdjustments(stage, { transparent }, () =>
      stage.toDataURL({
        mimeType: "image/png",
        quality: 1,
        pixelRatio: 2,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
    );

    const link = document.createElement("a");
    link.download = "calligraphy.png";
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportJPEG = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = getBlocksBoundingBox();
    if (!box) return;

    const dataURL = await withExportAdjustments(stage, {}, () =>
      stage.toDataURL({
        mimeType: "image/jpeg",
        quality: 0.92,
        pixelRatio: 2,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
    );

    const link = document.createElement("a");
    link.download = "calligraphy.jpg";
    link.href = dataURL;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleExportSVG = async (transparent = false) => {
    const stage = stageRef.current;
    if (!stage) return;
    const box = getBlocksBoundingBox();
    if (!box) return;

    const { exportStageSVG } = await import("react-konva-to-svg");
    const exported = await withExportAdjustments(stage, { transparent }, () =>
      exportStageSVG(stage, false)
    );
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

    const dataURL = await withExportAdjustments(stage, {}, () =>
      stage.toDataURL({
        mimeType: "image/png",
        quality: 1,
        pixelRatio: 2,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })
    );

    const pxToMm = (px: number) => (px * 25.4) / 96;
    const imgWidthMm = pxToMm(box.width);
    const imgHeightMm = pxToMm(box.height);

    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: imgWidthMm > imgHeightMm ? "landscape" : "portrait",
      unit: "mm",
      format: [imgWidthMm, imgHeightMm],
    });
    pdf.addImage(dataURL, "PNG", 0, 0, imgWidthMm, imgHeightMm);
    pdf.save("calligraphy.pdf");
  };

  return {
    getBlocksBoundingBox,
    handleExportPNG,
    handleExportJPEG,
    handleExportSVG,
    handleExportPDF,
  };
}
