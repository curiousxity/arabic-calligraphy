import type { Block, MirrorBlock, MirrorMode } from "../../types";
import { RADIAL_COUNT_MIN, RADIAL_COUNT_MAX, DEFAULT_RADIAL_COUNT, DEFAULT_RADIAL_RADIUS } from "../../lib/mirror";
import { makeId } from "./utils";
import { CollapsibleSection, OpacityRow, RangeRow, RotationRow, SelectRow } from "./FormControls";

export type MirrorPanelProps = {
  selectedBlock: MirrorBlock;
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
  mirrorSourceLabel,
  onSelectMirrorSource,
  onUpdateSelectedBlock,
  isOpen,
  onToggle,
}) => {
  // The suffix of every control id here.
  const selectedId = selectedBlock.id;
  return (
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

          <OpacityRow
            selectedId={selectedId}
            value={selectedBlock.opacity}
            onChange={(v) => onUpdateSelectedBlock({ opacity: v })}
          />

          <RotationRow
            selectedId={selectedId}
            value={selectedBlock.rotation}
            onChange={(v) => onUpdateSelectedBlock({ rotation: v })}
          />
        </div>
      </CollapsibleSection>
    </div>
  );
};
