import type { Block, ShapeFillBlock } from "../../types";
import { makeId } from "./utils";
import { CheckboxRow, CollapsibleSection, RangeRow } from "./FormControls";

export type ShapeFillPanelProps = {
  selectedBlock: ShapeFillBlock;
  /** The selected block's id, the suffix of every control id here. */
  selectedId: number | string;
  isMobile: boolean;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  onToggleDiacriticEditMode?: () => void;
  onFitShapeFillSpacing?: (blockId: number) => void;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * The Shape Fill type panel: the diacritic tool, shape scale, row spacing
 * (and Fit exactly), the per-axis text scale and the text rotation.
 */
export const ShapeFillPanel: React.FC<ShapeFillPanelProps> = ({
  selectedBlock,
  selectedId,
  isMobile,
  onUpdateSelectedBlock,
  onToggleDiacriticEditMode,
  onFitShapeFillSpacing,
  isOpen,
  onToggle,
}) => (
    <div className="sidebarPanel">
      <CollapsibleSection
        title="Shape Fill"
        isOpen={isOpen}
        onToggle={onToggle}
      >
        <div className="sectionPanel">
            <div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                Tip: drag the gold handle on the shape's corner (canvas) to resize.
              </div>

              <CheckboxRow
                id={makeId("diacritic-edit-mode", selectedId)}
                label="Diacritic tool"
                checked={!!selectedBlock.diacriticEditMode}
                onChange={() => onToggleDiacriticEditMode?.()}
                demo={{
                  src: "/demos/diacritic-hover-handles.gif",
                  alt: "Hovering a diacritic mark shows reposition, resize and hide handles",
                }}
              />

              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                Hover a tashkeel mark on the canvas to move, resize, or hide it. One
                change applies to every repetition of that mark in the fill.
              </div>

              <RangeRow
                id={makeId("shape-scale", selectedId)}
                name={makeId("shapeScale", selectedId)}
                label="Shape scale"
                value={selectedBlock.shapeScale ?? 1}
                min={0.2}
                max={3}
                step={0.05}
                onChange={(v) => onUpdateSelectedBlock({ shapeScale: v })}
                suffix={(selectedBlock.shapeScale ?? 1).toFixed(2)}
                fieldKey="shapeScale"
              />

              <RangeRow
                id={makeId("fill-spacing", selectedId)}
                name={makeId("shapeFillSpacing", selectedId)}
                label="Text spacing"
                value={selectedBlock.shapeFillSpacing ?? 1.3}
                min={0.5}
                max={4}
                step={0.05}
                onChange={(v) =>
                  onUpdateSelectedBlock({ shapeFillSpacing: v })
                }
                suffix={(selectedBlock.shapeFillSpacing ?? 1.3).toFixed(2)}
                fieldKey="shapeFillSpacing"
              />

              <button
                type="button"
                onClick={() => onFitShapeFillSpacing?.(selectedBlock.id)}
                className="sidebarSmallAction"
                style={{ marginTop: 4 }}
                title="Adjust row spacing so rows evenly fill the shape's height"
              >
                Fit exactly
              </button>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <RangeRow
                  id={makeId("fill-scale-x", selectedId)}
                  name={makeId("shapeFillScaleX", selectedId)}
                  label="Scale X"
                  value={selectedBlock.shapeFillScaleX ?? 1}
                  min={0.1}
                  max={3}
                  step={0.05}
                  onChange={(v) =>
                    onUpdateSelectedBlock({ shapeFillScaleX: v })
                  }
                  suffix={(selectedBlock.shapeFillScaleX ?? 1).toFixed(2)}
                  fieldKey="shapeFillScaleX"
                />

                <RangeRow
                  id={makeId("fill-scale-y", selectedId)}
                  name={makeId("shapeFillScaleY", selectedId)}
                  label="Scale Y"
                  value={selectedBlock.shapeFillScaleY ?? 1}
                  min={0.1}
                  max={3}
                  step={0.05}
                  onChange={(v) =>
                    onUpdateSelectedBlock({ shapeFillScaleY: v })
                  }
                  suffix={(selectedBlock.shapeFillScaleY ?? 1).toFixed(2)}
                  fieldKey="shapeFillScaleY"
                />
              </div>

              <RangeRow
                id={makeId("fill-text-rotation", selectedId)}
                name={makeId("shapeFillTextRotation", selectedId)}
                label="Text rotation"
                value={selectedBlock.shapeFillTextRotation ?? 0}
                min={-180}
                max={180}
                step={1}
                onChange={(v) =>
                  onUpdateSelectedBlock({ shapeFillTextRotation: v })
                }
                suffix={selectedBlock.shapeFillTextRotation ?? 0}
                fieldKey="shapeFillTextRotation"
              />
            </div>
        </div>
      </CollapsibleSection>
    </div>
);
