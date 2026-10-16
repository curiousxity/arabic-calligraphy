import type { GuideAttachment } from "../../types";
import { CheckboxRow, RangeRow } from "./FormControls";

const Pills = <T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
}) => (
  <div className="field" role="radiogroup" aria-label={label}>
    <span className="fieldTitle">{label}</span>
    <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "sidebarPillButton sidebarSmallAction--accent" : "sidebarPillButton"}
          style={{ minWidth: 0 }}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  </div>
);

/**
 * The "On guide" controls for an attached Curve text: where it sits along
 * its guide, which side, flipped or not, and Detach. See .claude/rules/guides.md.
 */
export const GuideAttachmentPanel: React.FC<{
  blockId: number;
  attachment: GuideAttachment;
  shrink?: number;
  onChange: (patch: Partial<GuideAttachment>) => void;
  onDetach: () => void;
}> = ({ blockId, attachment, shrink, onChange, onDetach }) => (
  <div className="sectionPanel">
    <RangeRow
      id={`guide-pos-${blockId}`}
      name="guidePosition"
      label="Position along guide"
      value={Math.round(attachment.offset * 1000) / 10}
      min={0}
      max={100}
      step={0.5}
      suffix="%"
      onChange={(v) => onChange({ offset: v / 100 })}
    />
    <Pills
      label="Align"
      value={attachment.align}
      options={[
        { value: "start", label: "Start" },
        { value: "center", label: "Centre" },
        { value: "end", label: "End" },
      ]}
      onChange={(align) => onChange({ align })}
    />
    <Pills
      label="Side"
      value={attachment.side}
      options={[
        { value: "outside", label: "Outside" },
        { value: "inside", label: "Inside" },
      ]}
      onChange={(side) => onChange({ side })}
    />
    <CheckboxRow
      id={`guide-flip-${blockId}`}
      label="Flip"
      checked={attachment.flip}
      onChange={(flip) => onChange({ flip })}
    />
    <RangeRow
      id={`guide-gap-${blockId}`}
      name="guideGap"
      label="Gap"
      value={attachment.gap}
      min={0}
      max={1}
      step={0.01}
      onChange={(gap) => onChange({ gap })}
    />
    {shrink !== undefined && shrink < 0.999 && (
      <span className="nameDesignHint">Shrunk to {Math.round(shrink * 100)}% to fit the guide.</span>
    )}
    <button
      type="button"
      className="sidebarSectionButton"
      onClick={onDetach}
      title="Free this text from the guide. It stays where it is as ordinary curved text."
    >
      <span>Detach from guide</span>
    </button>
  </div>
);
