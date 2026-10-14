import type { Block, GuideShape, MirrorMode, VerseLayout } from "../../types";
import { extractSvgPaths } from "../../lib/svgImport";
import { AddGuideButton } from "../GuideDialog";
import { VerseButton } from "../VerseDialog";
import { HistoryPopover, type HistoryTimelineEntry } from "./HistoryPopover";
import { DemoHover, type DemoMedia } from "./FormControls";
import {
  TrashIcon,
  CopyIcon,
  PlusIcon,
  ShapesIcon,
  PathTextIcon,
  UndoIcon,
  RedoIcon,
} from "../Icons";

/** How long the pointer must rest on an Add button before its demo opens. */
const BLOCK_DEMO_DELAY = 400;

/** Recordings shown on hover over the Add buttons; captions are set at the call site. */
const BLOCK_DEMOS = {
  text: { src: "/demos/add-text.gif", alt: "Placing a new text block on the canvas", width: 400 },
  shapeFill: { src: "/demos/add-shape-fill.gif", alt: "A shape filled with rows of text", width: 400 },
  curvedText: { src: "/demos/add-curved-text.gif", alt: "Placing text that follows a curve", width: 400 },
  mirror: { src: "/demos/add-mirror.gif", alt: "Adding a mirrored copy of a block", width: 400 },
  medallion: { src: "/demos/add-medallion.gif", alt: "Repeating a block radially as a medallion", width: 400 },
} satisfies Record<string, DemoMedia>;

export type BlockControlsPanelProps = {
  blocks: Block[];
  selectedBlock?: Block;
  onAddBlock: () => void;
  onAddShapeFillBlock?: (svgPathData: string, w: number, h: number) => void;
  onAddTextPathBlock?: () => void;
  onAddGuide?: (shape: GuideShape) => void;
  /** Adds a mirror of the selected block. Enabled only while `canAddMirrorBlock`. */
  onAddMirrorBlock?: (mode: MirrorMode) => void;
  /** Exactly one block is selected and it is not itself a mirror. */
  canAddMirrorBlock?: boolean;
  onDuplicateBlock: () => void;
  onDeleteBlock: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  historyEntries: HistoryTimelineEntry[];
  onJumpToHistory: (steps: number) => void;
  onCaptureCurrentThumbnail: () => string;
  onCreateVerse?: (lines: string[], layout: VerseLayout) => void;
  isJustifyingVerse?: boolean;
};

/**
 * Block Controls, first panel of the canvas tier: the Add grid, the Selected
 * pair (duplicate, delete), History (undo, redo, thumbnails) and New verse.
 */
export const BlockControlsPanel: React.FC<BlockControlsPanelProps> = ({
  blocks,
  selectedBlock,
  onAddBlock,
  onAddShapeFillBlock,
  onAddTextPathBlock,
  onAddGuide,
  onAddMirrorBlock,
  canAddMirrorBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  historyEntries,
  onJumpToHistory,
  onCaptureCurrentThumbnail,
  onCreateVerse,
  isJustifyingVerse,
}) => {
  const handleSvgUpload = () => {
    const onAdd = onAddShapeFillBlock;
    if (!onAdd) return;

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = extractSvgPaths(e.target?.result as string);
        if (!result) {
          alert(
            "No supported shape elements found in SVG (path, rect, circle, ellipse, polygon, polyline)."
          );
          return;
        }
        onAdd(result.pathData, result.w, result.h);
      };
      reader.readAsText(file);
    };

    input.click();
  };

  return (
    <div className="sidebarPanel">
      <div className="sidebarSectionTitle">Block Controls</div>

      {/* Three labelled groups rather than one wrapping row of identical
          chips. The old row let flex-wrap choose the shape, and at the
          sidebar's width it broke 8 / 1 / 3 — leaving one button
          stranded alone on a line of its own, which reads as a bug rather
          than a layout. A fixed four-column grid cannot orphan anything.
          Splitting Add from the destructive pair also moves Delete out of
          the leading position, where it sat immediately beside Duplicate. */}
      <div className="blockControlGroup">
        <div className="blockControlGroupLabel">Add</div>
        <div className="blockControlGrid">
          <DemoHover
            className="blockControlDemo"
            delay={BLOCK_DEMO_DELAY}
            demo={{ ...BLOCK_DEMOS.text, caption: "Add a text block" }}
          >
            <button
              type="button"
              onClick={onAddBlock}
              className="sidebarCircleButton"
              aria-label="Add text"
            >
              <PlusIcon size={15} />
            </button>
          </DemoHover>

          {onAddShapeFillBlock && (
            <DemoHover
              className="blockControlDemo"
              delay={BLOCK_DEMO_DELAY}
              demo={{ ...BLOCK_DEMOS.shapeFill, caption: "Add a shape filled with text, from an SVG…" }}
            >
              <button
                type="button"
                className="sidebarCircleButton"
                aria-label="Add shape fill"
                onClick={() => handleSvgUpload()}
              >
                <ShapesIcon size={15} />
              </button>
            </DemoHover>
          )}

          {onAddTextPathBlock && (
            <DemoHover
              className="blockControlDemo"
              delay={BLOCK_DEMO_DELAY}
              demo={{ ...BLOCK_DEMOS.curvedText, caption: "Add text on a curve" }}
            >
              <button
                type="button"
                className="sidebarCircleButton"
                aria-label="Add curved text"
                onClick={onAddTextPathBlock}
              >
                <PathTextIcon size={15} />
              </button>
            </DemoHover>
          )}
      {onAddGuide && <AddGuideButton onAdd={onAddGuide} />}

          {/* Inline SVGs rather than entries in Icons.tsx: that file is not
              this stream's to edit during the Phase 1 parallel run. */}
          {onAddMirrorBlock && (
            <>
              <DemoHover
                className="blockControlDemo"
                delay={BLOCK_DEMO_DELAY}
                demo={{
                  ...BLOCK_DEMOS.mirror,
                  caption: canAddMirrorBlock
                    ? "Add a mirror (muthanna) of the selected block"
                    : "Select exactly one non-mirror block to mirror it",
                }}
              >
                <button
                  type="button"
                  className="sidebarCircleButton"
                  disabled={!canAddMirrorBlock}
                  aria-label="Add mirror"
                  onClick={() => onAddMirrorBlock("mirrorX")}
                >
                  <svg width={15} height={15} viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M8 1v14" stroke="currentColor" strokeWidth={1.2} strokeDasharray="2 2" />
                    <path d="M6.5 4 2 8l4.5 4z" fill="currentColor" />
                    <path
                      d="M9.5 4 14 8l-4.5 4z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.2}
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </DemoHover>

              <DemoHover
                className="blockControlDemo"
                delay={BLOCK_DEMO_DELAY}
                demo={{
                  ...BLOCK_DEMOS.medallion,
                  caption: canAddMirrorBlock
                    ? "Add a medallion: radial copies of the selected block"
                    : "Select exactly one non-mirror block to repeat it radially",
                }}
              >
                <button
                  type="button"
                  className="sidebarCircleButton"
                  disabled={!canAddMirrorBlock}
                  aria-label="Add medallion"
                  onClick={() => onAddMirrorBlock("radial")}
                >
                  <svg width={15} height={15} viewBox="0 0 16 16" aria-hidden="true">
                    <g stroke="currentColor" strokeWidth={1.2} strokeLinecap="round">
                      <path d="M8 1.5v3.2M8 11.3v3.2M1.5 8h3.2M11.3 8h3.2" />
                      <path d="M3.4 3.4l2.3 2.3M10.3 10.3l2.3 2.3M12.6 3.4l-2.3 2.3M5.7 10.3l-2.3 2.3" />
                    </g>
                    <circle cx={8} cy={8} r={1.6} fill="currentColor" />
                  </svg>
                </button>
              </DemoHover>
            </>
          )}
        </div>
      </div>

      <div className="blockControlSplit">
        <div className="blockControlGroup">
          <div className="blockControlGroupLabel">Selected</div>
          <div className="blockControlGrid blockControlGrid--inline">
            <button
              type="button"
              onClick={onDuplicateBlock}
              disabled={!selectedBlock}
              className="sidebarCircleButton"
              title="Duplicate selected block"
              aria-label="Duplicate block"
            >
              <CopyIcon size={15} />
            </button>

            <button
              type="button"
              onClick={onDeleteBlock}
              disabled={!selectedBlock || blocks.length === 0}
              className="sidebarCircleButton sidebarCircleButton--danger"
              title="Delete selected block"
              aria-label="Delete block"
            >
              <TrashIcon size={15} />
            </button>
          </div>
        </div>

        <div className="blockControlGroup">
          <div className="blockControlGroupLabel">History</div>
          <div className="blockControlGrid blockControlGrid--inline">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="sidebarCircleButton"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
            >
              <UndoIcon size={15} />
            </button>

            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="sidebarCircleButton"
              title="Redo (Ctrl+Y)"
              aria-label="Redo"
            >
              <RedoIcon size={15} />
            </button>

            <HistoryPopover
              historyEntries={historyEntries}
              onJumpTo={onJumpToHistory}
              onCaptureCurrentThumbnail={onCaptureCurrentThumbnail}
            />
          </div>
        </div>
      </div>
      {onCreateVerse && (
        <div style={{ marginTop: 10 }}>
          <VerseButton onCreate={onCreateVerse} disabled={isJustifyingVerse} />
        </div>
      )}
    </div>
  );
};
