import type { RefObject } from "react";
import type Konva from "konva";
import type { Block } from "../types";
import { EXPORT_HIDDEN } from "../lib/exportChrome";
import {
  getBlocksBoundingBox as getBlocksBoundingBoxShared,
  unionRect,
} from "../lib/canvasBounds";
import {
  SCREEN_DPI,
  artboardRect,
  exportPixelRatio,
  pxToMm,
  type ArtboardConfig,
} from "../lib/artboard";
import { triggerDownload } from "../lib/download";
import type { ExportFormat } from "../lib/exportPresets";

/** Per-call export overrides. Every field defaults to the app's long-standing behaviour. */
export type ExportOptions = {
  /** Raster oversampling — becomes `toDataURL`'s `pixelRatio`. */
  scale?: number;
  /** Drop the artboard background fill (PNG/SVG only — JPEG and PDF have no alpha). */
  transparent?: boolean;
  /** Filename stem; the extension is appended per format. */
  baseName?: string;
};

/** Result of a clipboard copy. Reported rather than thrown, matching the hook's other early returns. */
export type CopyResult = { ok: true } | { ok: false; reason: string };

const DEFAULT_SCALE = 2;
const DEFAULT_BASE_NAME = "calligraphy";
const ALL_FORMATS: ExportFormat[] = ["png", "jpeg", "svg", "pdf"];

/**
 * The handlers used to take a bare `transparent` boolean. They now take an
 * options object, but still accept the boolean so existing call sites keep
 * their exact previous behaviour without being touched.
 */
type ExportArg = boolean | ExportOptions;

const normalizeOptions = (arg: ExportArg | undefined) => {
  const opts = typeof arg === "boolean" ? { transparent: arg } : (arg ?? {});
  return {
    scale: opts.scale ?? DEFAULT_SCALE,
    transparent: opts.transparent ?? false,
    baseName: opts.baseName ?? DEFAULT_BASE_NAME,
  };
};

/** Decodes a `data:` URL into a Blob without a fetch round-trip (which some CSPs block for data: URLs). */
const dataURLToBlob = (dataURL: string): Blob => {
  const [header, base64] = dataURL.split(",");
  const mime = header.match(/:(.*?);/)?.[1] ?? "image/png";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
};

/** Browsers throttle downloads fired in the same tick, so `handleExportAll` spaces them out. */
const DOWNLOAD_GAP_MS = 250;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How the page (if any) shapes an export. Both fields default to the
 * pre-artboard behaviour, so `useExport(stageRef, blocks)` — which is how
 * this hook has always been called — is byte-identical to before.
 */
export type ExportArtboard = {
  /** The document's page, or null for freeform (crop to the blocks, as ever). */
  config: ArtboardConfig | null;
  /** Crop overhanging ink at the page edge. Off exports the union of page and content. */
  clipToPage: boolean;
};

const NO_ARTBOARD: ExportArtboard = { config: null, clipToPage: true };

/** PNG/JPEG/SVG/PDF export handlers (plus clipboard copy and export-all) for the current stage contents. */
export function useExport(
  stageRef: RefObject<Konva.Stage | null>,
  blocks: Block[],
  artboard: ExportArtboard = NO_ARTBOARD
) {
  const getBlocksBoundingBox = (stage: Konva.Stage) =>
    getBlocksBoundingBoxShared(stage, blocks);

  /**
   * The rectangle every format crops to.
   *
   * Without a page this is the blocks' bounding box, exactly as it always
   * was — which is why export dimensions used to move whenever a block did.
   * With one, the page *is* the crop, so the output size is a property of the
   * document rather than of where its contents happen to sit. A page with
   * nothing on it still exports (a blank sheet of that size); a freeform
   * canvas with nothing on it still returns null and the handlers bail, as
   * they always have.
   */
  const exportBox = (stage: Konva.Stage) => {
    const content = getBlocksBoundingBox(stage);
    if (!artboard.config) return content;
    const page = artboardRect(artboard.config);
    if (artboard.clipToPage || !content) return page;
    return unionRect(page, content);
  };

  const pixelRatio = (requestedScale: number) =>
    exportPixelRatio(artboard.config, requestedScale);

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
    const bgNode = opts.transparent ? stage.findOne("#artboard-background") : null;
    // Everything the editor draws over the artwork — the alignment grid, the
    // page outline and margin guide, the pen-tool and cell-paint overlays —
    // declares itself with one Konva name, so this hides them without
    // knowing what any of them are. A new overlay joins by carrying
    // `EXPORT_HIDDEN`; see that constant for the allowlist this replaced.
    const editOverlayNodes = stage.find(`.${EXPORT_HIDDEN}`);
    const bgWasVisible = bgNode?.visible() ?? false;
    const overlayVisibility = editOverlayNodes.map((n) => n.visible());
    bgNode?.visible(false);
    editOverlayNodes.forEach((n) => n.visible(false));

    const prevScale = { x: stage.scaleX(), y: stage.scaleY() };
    const prevPosition = { x: stage.x(), y: stage.y() };
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });

    stage.batchDraw();
    try {
      return await fn(stage);
    } finally {
      bgNode?.visible(bgWasVisible);
      editOverlayNodes.forEach((n, i) => n.visible(overlayVisibility[i]));
      stage.scale(prevScale);
      stage.position(prevPosition);
      stage.batchDraw();
    }
  };

  /** Rasterizes `box` (see `exportBox`); assumes it is already inside an adjustment pass. */
  const rasterize = (
    s: Konva.Stage,
    box: { x: number; y: number; width: number; height: number },
    mimeType: "image/png" | "image/jpeg",
    scale: number
  ) =>
    s.toDataURL({
      mimeType,
      quality: mimeType === "image/jpeg" ? 0.92 : 1,
      pixelRatio: scale,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
    });

  /**
   * `exportStageSVG` always renders at the full stage size and returns a
   * complete <svg width=... height=...> covering the whole canvas, not just
   * the blocks' bounding box. Strip its outer <svg> wrapper (if any) and
   * rebuild it around `box` so the SVG export crops the same way the
   * PNG/JPEG/PDF exports already do via toDataURL's x/y/width/height.
   */
  const cropSvg = (
    exported: unknown,
    box: { x: number; y: number; width: number; height: number }
  ) => {
    const rawSvgText = String(exported).trim();
    const innerMatch = rawSvgText.match(/^<svg[^>]*>([\s\S]*)<\/svg>\s*$/i);
    const innerSvgText = innerMatch ? innerMatch[1] : rawSvgText;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}" viewBox="${box.x} ${box.y} ${box.width} ${box.height}">${innerSvgText}</svg>`;
  };

  const downloadSvgText = (svgText: string, filename: string) => {
    const blob = new Blob([svgText], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, filename, true);
  };

  /**
   * px→mm for the PDF's page size. The conversion used to hardcode 96dpi,
   * which is right for a freeform export (stage px are screen px) but turns
   * an A4@300dpi page into a 656 × 928 mm poster. With a page set, its own
   * dpi is what makes 2480px come back out as 210mm.
   */
  const boxToMm = (px: number) => pxToMm(px, artboard.config?.dpi ?? SCREEN_DPI);

  const savePdf = async (
    dataURL: string,
    box: { width: number; height: number },
    filename: string
  ) => {
    const imgWidthMm = boxToMm(box.width);
    const imgHeightMm = boxToMm(box.height);
    const { default: jsPDF } = await import("jspdf");
    const pdf = new jsPDF({
      orientation: imgWidthMm > imgHeightMm ? "landscape" : "portrait",
      unit: "mm",
      format: [imgWidthMm, imgHeightMm],
    });
    pdf.addImage(dataURL, "PNG", 0, 0, imgWidthMm, imgHeightMm);
    pdf.save(filename);
  };

  const handleExportPNG = async (arg?: ExportArg) => {
    const { scale, transparent, baseName } = normalizeOptions(arg);
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, { transparent }, (s) => {
      const box = exportBox(s);
      if (!box) return null;
      return { dataURL: rasterize(s, box, "image/png", pixelRatio(scale)) };
    });
    if (!result) return;

    triggerDownload(result.dataURL, `${baseName}.png`);
  };

  const handleExportJPEG = async (arg?: ExportArg) => {
    // JPEG has no alpha channel, so a transparent request would silently
    // produce a black background — the background always stays in.
    const { scale, baseName } = normalizeOptions(arg);
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, {}, (s) => {
      const box = exportBox(s);
      if (!box) return null;
      return { dataURL: rasterize(s, box, "image/jpeg", pixelRatio(scale)) };
    });
    if (!result) return;

    triggerDownload(result.dataURL, `${baseName}.jpg`);
  };

  const handleExportSVG = async (arg?: ExportArg) => {
    const { transparent, baseName } = normalizeOptions(arg);
    const stage = stageRef.current;
    if (!stage) return;

    const { exportStageSVG } = await import("react-konva-to-svg");
    const result = await withExportAdjustments(stage, { transparent }, async (s) => {
      const box = exportBox(s);
      if (!box) return null;
      const exported = await exportStageSVG(s, false);
      return { box, exported };
    });
    if (!result) return;

    downloadSvgText(cropSvg(result.exported, result.box), `${baseName}.svg`);
  };

  const handleExportPDF = async (arg?: ExportArg) => {
    const { scale, baseName } = normalizeOptions(arg);
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, {}, (s) => {
      const box = exportBox(s);
      if (!box) return null;
      return { box, dataURL: rasterize(s, box, "image/png", pixelRatio(scale)) };
    });
    if (!result) return;

    await savePdf(result.dataURL, result.box, `${baseName}.pdf`);
  };

  /**
   * Copies a PNG of the artwork to the system clipboard.
   *
   * The `ClipboardItem` is deliberately handed a *promise* of the blob rather
   * than an awaited blob: Safari only honours `clipboard.write` when the item
   * is constructed synchronously inside the user-gesture task, and the render
   * itself is async. Chrome and Firefox accept the promise form equally, so
   * there is one code path. Nothing before `clipboard.write` awaits, which is
   * what keeps this call inside the gesture.
   */
  const handleCopyPNG = async (arg?: ExportArg): Promise<CopyResult> => {
    const { scale, transparent } = normalizeOptions(arg);
    const stage = stageRef.current;
    if (!stage || blocks.length === 0) {
      return { ok: false, reason: "Nothing on the canvas to copy yet." };
    }
    if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
      return {
        ok: false,
        reason:
          "This browser can't copy images to the clipboard (it needs a secure https page). Export a PNG instead.",
      };
    }

    const blobPromise = (async () => {
      const dataURL = await withExportAdjustments(stage, { transparent }, (s) => {
        const box = exportBox(s);
        return box ? rasterize(s, box, "image/png", pixelRatio(scale)) : null;
      });
      if (!dataURL) throw new Error("nothing to copy");
      return dataURLToBlob(dataURL);
    })();

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blobPromise })]);
      return { ok: true };
    } catch {
      return { ok: false, reason: "The browser blocked the clipboard copy. Export a PNG instead." };
    }
  };

  /**
   * Writes several formats from a *single* adjustment pass, rather than one
   * pass per format each toggling node visibility and the stage transform.
   * Both lazy imports are awaited inside that pass so the stage is still in
   * export state when they resolve.
   */
  const handleExportAll = async (arg?: ExportArg & { formats?: ExportFormat[] }) => {
    const { scale, transparent, baseName } = normalizeOptions(arg);
    const formats =
      typeof arg === "boolean" || !arg?.formats?.length ? ALL_FORMATS : arg.formats;
    const stage = stageRef.current;
    if (!stage) return;

    const result = await withExportAdjustments(stage, { transparent }, async (s) => {
      const box = exportBox(s);
      if (!box) return null;

      const png = formats.includes("png") ? rasterize(s, box, "image/png", pixelRatio(scale)) : null;

      let svgText: string | null = null;
      if (formats.includes("svg")) {
        const { exportStageSVG } = await import("react-konva-to-svg");
        svgText = cropSvg(await exportStageSVG(s, false), box);
      }

      // Transparency applies to PNG and SVG only — JPEG and PDF have no alpha
      // channel, and the single-format handlers have always kept the artboard
      // background for them. Put it back for those two, then hide it again so
      // the outer pass's `finally` still restores the original state.
      const bgNode = transparent ? s.findOne("#artboard-background") : null;
      bgNode?.visible(true);
      const jpeg = formats.includes("jpeg") ? rasterize(s, box, "image/jpeg", pixelRatio(scale)) : null;
      const pdf = formats.includes("pdf") ? rasterize(s, box, "image/png", pixelRatio(scale)) : null;
      bgNode?.visible(false);

      return { box, png, svgText, jpeg, pdf };
    });
    if (!result) return;

    // Sequenced with a short gap: browsers throttle downloads fired together.
    if (result.png) {
      triggerDownload(result.png, `${baseName}.png`);
      await wait(DOWNLOAD_GAP_MS);
    }
    if (result.jpeg) {
      triggerDownload(result.jpeg, `${baseName}.jpg`);
      await wait(DOWNLOAD_GAP_MS);
    }
    if (result.svgText) {
      downloadSvgText(result.svgText, `${baseName}.svg`);
      await wait(DOWNLOAD_GAP_MS);
    }
    if (result.pdf) {
      await savePdf(result.pdf, result.box, `${baseName}.pdf`);
    }
  };

  return {
    getBlocksBoundingBox,
    handleExportPNG,
    handleExportJPEG,
    handleExportSVG,
    handleExportPDF,
    handleCopyPNG,
    handleExportAll,
  };
}
