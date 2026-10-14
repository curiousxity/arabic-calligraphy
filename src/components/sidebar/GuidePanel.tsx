import type { GuideBlock, GuideParams, TextPathBlock } from "../../types";
import { GUIDE_DEFAULTS } from "../../lib/guideShapes";
import { RangeRow } from "./FormControls";

type Row = { key: keyof GuideParams; label: string; min: number; max: number; suffix?: string };

/** The size controls each shape offers. Line angle is the block's rotation (Transform). */
const ROWS: Record<Exclude<GuideBlock["guideShape"], "pen">, Row[]> = {
  circle: [{ key: "width", label: "Diameter", min: 40, max: 1200 }],
  ellipse: [
    { key: "width", label: "Width", min: 40, max: 1600 },
    { key: "height", label: "Height", min: 40, max: 1600 },
  ],
  arc: [
    { key: "width", label: "Diameter", min: 40, max: 1600 },
    { key: "sweep", label: "Sweep", min: 10, max: 350, suffix: "°" },
  ],
  wave: [
    { key: "width", label: "Width", min: 40, max: 1600 },
    { key: "amplitude", label: "Amplitude", min: 0, max: 200 },
  ],
  line: [{ key: "width", label: "Length", min: 40, max: 1600 }],
  teardrop: [{ key: "width", label: "Width", min: 40, max: 1200 }, { key: "height", label: "Height", min: 40, max: 1600 }],
  almond: [{ key: "width", label: "Width", min: 40, max: 1200 }, { key: "height", label: "Height", min: 40, max: 1600 }],
};

/**
 * The Guide type panel: the shape's size, Add text, and the texts already
 * on it. See .claude/rules/guides.md.
 */
export const GuidePanel: React.FC<{
  guide: GuideBlock;
  texts: readonly TextPathBlock[];
  onParams: (params: GuideParams) => void;
  onAddText: () => void;
  onSelect: (id: number) => void;
  onToggleEdit: () => void;
}> = ({ guide, texts, onParams, onAddText, onSelect, onToggleEdit }) => {
  const params = { ...GUIDE_DEFAULTS[guide.guideShape], ...guide.guideParams };
  return (
    <div className="sectionPanel">
      {guide.guideShape === "pen" ? (
        <button type="button" className="sidebarPillButton" onClick={onToggleEdit}>
          {guide.guideEditMode ? "Done editing points" : "Edit points"}
        </button>
      ) : (
        ROWS[guide.guideShape].map((r) => (
          <RangeRow
            key={r.key}
            id={`guide-${guide.id}-${r.key}`}
            name={`guide${r.key}`}
            label={r.label}
            value={Math.round(params[r.key] ?? 0)}
            min={r.min}
            max={r.max}
            step={1}
            suffix={r.suffix}
            onChange={(v) => onParams({ [r.key]: v })}
          />
        ))
      )}
      <button type="button" className="sidebarSectionButton" aria-label="Add text to guide" onClick={onAddText}>
        <span>Add text to guide</span>
        <span>+</span>
      </button>
      {texts.length > 0 && (
        <div className="field">
          <span className="fieldTitle">On this guide</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
            {texts.map((t) => (
              <button
                key={t.id}
                type="button"
                className="sidebarSmallAction"
                dir="rtl"
                lang="ar"
                style={{ textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                onClick={() => onSelect(t.id)}
              >
                {t.text.slice(0, 24) || "(empty)"}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
