import type { RefObject } from "react";
import type Konva from "konva";
import type { Block } from "../types";
import { getBlocksBoundingBox as getBlocksBoundingBoxShared } from "../lib/canvasBounds";
import { triggerDownload } from "../lib/download";

/** PNG/SVG/PDF export handlers for the current stage contents. */
export function useExport(stageRef: RefObject<Konva.Stage | null>, blocks: Block[]) {
  const getBlocksBoundingBox = (stage: Konva.Stage) =>
    getBlocksBoundingBoxShared(stage, blocks);

  /**
   * Hides the on-screen alignment grid (and, optionally, the artboard
   * background fill) while `fn` runs, so exports never bake in either.
   * Also resets the stage's zoom/pan to a neutral 1:1 transform for the
   * duration of `fn` — both the blocks' bounding box and toDataURL's crop
   * are computed in the stage's *current* transformed space, so exporting
   * while zoomed/panned would otherwise capture whatever's currently in the
   * viewport instead of the blocks' true position on the artboard.
   */
  const withExportAdjustments = async <T,>(
    stage: Konva.Stage,
    opts: { transparent?: boolean },
    fn: (stage: Konva.Stage) => T | Promise<T>
  ): Promise<T> => {
    const gridNode = stage.findOne("#grid-lines");
    const bgNode = opts.transparent ? stage.findOne("#artboard-background") : null;
    const gridWasVisible = gridNode?.visible() ?? false;
    const bgWasVisible = bgNode?.visible() ?? false;
    gridNode?.visible(false);
    bgNode?.visible(false);

    const prevScale = { x: stage.scaleX(), y: stage.scaleY() };
    const prevPosition = { x: stage.x(), y: stage.y() };
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });

    stage.batchDraw();
    try {
      return await fn(stage);
    } finally {
      gridNode?.visible(gridWasVisible);
      bgNode?.visible(bgWasVisible);
      stage.scale(prevScale);
      stage.position(prevPosition);
      stage.batchDraw();
    }
  };

  const handleExportPNG = async (transparent = false) => {
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, { transparent }, (s) => {
      const box = getBlocksBoundingBox(s);
      if (!box) return null;
      return {
        dataURL: s.toDataURL({
          mimeType: "image/png",
          quality: 1,
          pixelRatio: 2,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }),
      };
    });
    if (!result) return;

    triggerDownload(result.dataURL, "calligraphy.png");
  };

  const handleExportJPEG = async () => {
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, {}, (s) => {
      const box = getBlocksBoundingBox(s);
      if (!box) return null;
      return {
        dataURL: s.toDataURL({
          mimeType: "image/jpeg",
          quality: 0.92,
          pixelRatio: 2,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }),
      };
    });
    if (!result) return;

    triggerDownload(result.dataURL, "calligraphy.jpg");
  };

  const handleExportSVG = async (transparent = false) => {
    const stage = stageRef.current;
    if (!stage) return;

    const { exportStageSVG } = await import("react-konva-to-svg");
    const result = await withExportAdjustments(stage, { transparent }, async (s) => {
      const box = getBlocksBoundingBox(s);
      if (!box) return null;
      const exported = await exportStageSVG(s, false);
      return { box, exported };
    });
    if (!result) return;
    const { box, exported } = result;

    // exportStageSVG always renders at the full stage size and returns a
    // complete <svg width=... height=...> covering the whole canvas, not
    // just the blocks' bounding box. Strip its outer <svg> wrapper (if any)
    // and rebuild it around `box` so the SVG export crops the same way the
    // PNG/JPEG/PDF exports already do via toDataURL's x/y/width/height.
    const rawSvgText = String(exported).trim();
    const innerMatch = rawSvgText.match(/^<svg[^>]*>([\s\S]*)<\/svg>\s*$/i);
    const innerSvgText = innerMatch ? innerMatch[1] : rawSvgText;
    const finalSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${innerSvgText}</svg>`;

    const blob = new Blob([finalSvg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, "calligraphy.svg", true);
  };

  const handleExportPDF = async () => {
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, {}, (s) => {
      const box = getBlocksBoundingBox(s);
      if (!box) return null;
      return {
        box,
        dataURL: s.toDataURL({
          mimeType: "image/png",
          quality: 1,
          pixelRatio: 2,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        }),
      };
    });
    if (!result) return;
    const { box, dataURL } = result;

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
