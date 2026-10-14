import type { Block, MirrorBlock, MirrorMode } from "../../types";
import { RADIAL_COUNT_MIN, RADIAL_COUNT_MAX, DEFAULT_RADIAL_COUNT, DEFAULT_RADIAL_RADIUS } from "../../lib/mirror";
import { makeId } from "./utils";
import { CollapsibleSection, RangeRow, SelectRow } from "./FormControls";

export type MirrorPanelProps = {
  selectedBlock: MirrorBlock;
  /** The selected block's id, the suffix of every control id here. */
  selectedId: number | string;
  selectedOpacity: number;
  selectedRotation: number;
  /** What to call the mirror's source. */
  mirrorSourceLabel?: string;
  onSelectMirrorSource?: () => void;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * The Mirror type panel: select the source, the mirror mode (and the radial
 * copies and radius), opacity and rotation. Mirror hides Typography, so it
 * carries its own Rotation row.
 */
export const MirrorPanel: React.FC<MirrorPanelProps> = ({
  selectedBlock,
  selectedId,
  selectedOpacity,
  selectedRotation,
  mirrorSourceLabel,
  onSelectMirrorSource,
  onUpdateSelectedBlock,
  isOpen,
  onToggle,
}) => (
    <div className="sidebarPanel">
      <CollapsibleSection
        title="Mirror"
        isOpen={isOpen}
        onToggle={onToggle}
      >
        <div className="sectionPanel">
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
            This block draws {mirrorSourceLabel ?? "another block"}'s content. Edit the
            text and typography on the source — every copy follows.
          </div>

          <button
            type="button"
            onClick={() => onSelectMirrorSource?.()}
            className="sidebarSmallAction"
            style={{ background: "var(--bg-input)" }}
            title="Select the block this mirror reflects"
          >
            Select source
          </button>

          <SelectRow
            id={makeId("mirror-mode", selectedId)}
            name={makeId("mirrorMode", selectedId)}
            label="Mode"
            value={selectedBlock.mode}
            onChange={(v) => onUpdateSelectedBlock({ mode: v as MirrorMode })}
          >
            <option value="mirrorX">Mirror across a vertical axis</option>
            <option value="mirrorY">Mirror across a horizontal axis</option>
            <option value="radial">Radial (around a centre)</option>
          </SelectRow>

          {selectedBlock.mode === "radial" && (
            <>
              <RangeRow
                id={makeId("radial-count", selectedId)}
                name={makeId("radialCount", selectedId)}
                label="Copies"
                value={selectedBlock.radialCount ?? DEFAULT_RADIAL_COUNT}
                min={RADIAL_COUNT_MIN}
                max={RADIAL_COUNT_MAX}
                step={1}
                onChange={(v) => onUpdateSelectedBlock({ radialCount: v })}
                suffix={selectedBlock.radialCount ?? DEFAULT_RADIAL_COUNT}
              />

              <RangeRow
                id={makeId("radial-radius", selectedId)}
                name={makeId("radialRadius", selectedId)}
                label="Radius"
                value={selectedBlock.radialRadius ?? DEFAULT_RADIAL_RADIUS}
                min={0}
                max={600}
                step={2}
                onChange={(v) => onUpdateSelectedBlock({ radialRadius: v })}
                suffix={`${Math.round(selectedBlock.radialRadius ?? DEFAULT_RADIAL_RADIUS)}px`}
              />
            </>
          )}

          <RangeRow
            id={makeId("opacity", selectedId)}
            name={makeId("opacity", selectedId)}
            label="Opacity"
            value={selectedOpacity}
            min={0.1}
            max={1}
            step={0.05}
            onChange={(v) => onUpdateSelectedBlock({ opacity: v })}
            suffix={`${Math.round(selectedOpacity * 100)}%`}
            fieldKey="opacity"
          />

          <RangeRow
            id={makeId("rotation", selectedId)}
            name={makeId("rotation", selectedId)}
            label="Rotation"
            value={selectedRotation}
            min={-180}
            max={180}
            onChange={(v) => onUpdateSelectedBlock({ rotation: v })}
            suffix={`${selectedRotation}°`}
            fieldKey="rotation"
          />
        </div>
      </CollapsibleSection>
    </div>
);
