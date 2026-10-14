import type { Block, GuideAttachment, TextPathBlock } from "../../types";
import { extractSvgPaths } from "../../lib/svgImport";
import { arcPathD, wavePathD, circlePathD } from "../../lib/textPath";
import { parseSvgPath, type SvgCmd } from "../../lib/svgPath";
import { GuideAttachmentPanel } from "./GuideAttachmentPanel";
import { makeId } from "./utils";
import { CollapsibleSection, RangeRow, SelectRow } from "./FormControls";

/** Serializes parsed SVG path commands back into a `d` string (module-local, one-off — mirrors ShapedText.tsx's commandsToSvgPath). */
function cmdsToD(cmds: SvgCmd[]): string {
  const parts: string[] = [];
  for (const c of cmds) {
    switch (c.type) {
      case "M": parts.push(`M ${c.x} ${c.y}`); break;
      case "L": parts.push(`L ${c.x} ${c.y}`); break;
      case "C": parts.push(`C ${c.x1} ${c.y1}, ${c.x2} ${c.y2}, ${c.x} ${c.y}`); break;
      case "Q": parts.push(`Q ${c.x1} ${c.y1}, ${c.x} ${c.y}`); break;
      case "Z": parts.push("Z"); break;
    }
  }
  return parts.join(" ");
}

/**
 * Keeps only the first subpath of an SVG path `d` string (everything up to,
 * but not including, the second `M` command). `extractSvgPaths` legitimately
 * concatenates every shape in an uploaded SVG into one `d` string for
 * shapeFill's union-silhouette use case, but a text-path curve
 * needs a single open path — the phantom jump between subpaths would
 * otherwise inflate arc length and route glyphs through empty space.
 */
function firstSubpath(d: string): { d: string; hadMultiple: boolean } {
  const cmds = parseSvgPath(d);
  const secondMoveIndex = cmds.findIndex((c, i) => i > 0 && c.type === "M");
  if (secondMoveIndex === -1) return { d, hadMultiple: false };
  return { d: cmdsToD(cmds.slice(0, secondMoveIndex)), hadMultiple: true };
}

export type CurvePanelProps = {
  selectedBlock: TextPathBlock;
  /** The selected block's id, the suffix of every control id here. */
  selectedId: number | string;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  onDetachFromGuide?: () => void;
  onUpdateGuideAttachment?: (patch: Partial<GuideAttachment>) => void;
  /** Renderer-measured shrink per attached text; never saved. */
  guideShrink?: ReadonlyMap<number, number>;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * The Curve type panel: Edit Curve, the curve presets, SVG path upload, flip
 * and baseline offset — or, for text attached to a guide, the On guide
 * controls instead, since the guide owns the curve.
 */
export const CurvePanel: React.FC<CurvePanelProps> = ({
  selectedBlock,
  selectedId,
  onUpdateSelectedBlock,
  onDetachFromGuide,
  onUpdateGuideAttachment,
  guideShrink,
  isOpen,
  onToggle,
}) => {
  const handleTextPathSvgUpload = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".svg,image/svg+xml";

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const result = extractSvgPaths(e.target?.result as string, undefined, true);
        if (!result) {
          alert(
            "No supported shape elements found in SVG (path, rect, circle, ellipse, polygon, polyline)."
          );
          return;
        }

        // extractSvgPaths concatenates every matched shape into one `d`
        // string, which is correct for shapeFill (it wants the
        // union silhouette) but wrong for a text-path curve: the jump from
        // one subpath's end to the next subpath's `M` would be treated as a
        // real curve segment. Keep only the first subpath here.
        const { d: firstSubpathD, hadMultiple } = firstSubpath(result.pathData);
        if (hadMultiple) {
          alert(
            "This SVG has multiple shapes/subpaths — only the first one was used as the text path."
          );
        }
        onUpdateSelectedBlock({ textPathD: firstSubpathD });
      };
      reader.readAsText(file);
    };

    input.click();
  };

  return (
    <div className="sidebarPanel">
      <CollapsibleSection title="Curve" isOpen={isOpen} onToggle={onToggle}>
        {/* Attached to a guide: the guide owns the curve, so the
            curve-editing rows give way to the On guide controls. */}
        {selectedBlock.guide && onUpdateGuideAttachment && onDetachFromGuide ? (
          <GuideAttachmentPanel
            blockId={selectedBlock.id}
            attachment={selectedBlock.guide}
            shrink={guideShrink?.get(selectedBlock.id)}
            onChange={onUpdateGuideAttachment}
            onDetach={onDetachFromGuide}
          />
        ) : (
        <div className="sectionPanel">
          <button
            type="button"
            className="sidebarPillButton"
            style={
              selectedBlock.textPathEditMode
                ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                : undefined
            }
            onClick={() =>
              onUpdateSelectedBlock({ textPathEditMode: !selectedBlock.textPathEditMode })
            }
          >
            {selectedBlock.textPathEditMode ? "Done Editing Curve" : "Edit Curve"}
          </button>

          <SelectRow
            id={makeId("text-path-preset", selectedId)}
            name={makeId("textPathPreset", selectedId)}
            label="Preset"
            value="custom"
            onChange={(v) => {
              if (v === "arc") {
                onUpdateSelectedBlock({ textPathD: arcPathD(400, 120) });
              } else if (v === "wave") {
                onUpdateSelectedBlock({ textPathD: wavePathD(400, 120) });
              } else if (v === "circle") {
                onUpdateSelectedBlock({ textPathD: circlePathD(300, 300) });
              }
            }}
          >
            <option value="custom">Custom</option>
            <option value="arc">Arc</option>
            <option value="wave">Wave</option>
            <option value="circle">Circle</option>
          </SelectRow>

          <button
            type="button"
            className="sidebarPillButton"
            onClick={handleTextPathSvgUpload}
          >
            Upload SVG Path
          </button>

          <label className="field">
            <span className="fieldTitle">
              <input
                type="checkbox"
                checked={selectedBlock.textPathReversed ?? false}
                onChange={(e) =>
                  onUpdateSelectedBlock({ textPathReversed: e.target.checked })
                }
                style={{ marginRight: 6 }}
              />
              Flip direction
            </span>
          </label>

          <RangeRow
            id={makeId("text-path-baseline-offset", selectedId)}
            name={makeId("textPathBaselineOffset", selectedId)}
            label="Baseline offset"
            value={selectedBlock.textPathBaselineOffset ?? 0}
            min={-60}
            max={60}
            onChange={(v) => onUpdateSelectedBlock({ textPathBaselineOffset: v })}
            suffix={selectedBlock.textPathBaselineOffset ?? 0}
            fieldKey="textPathBaselineOffset"
          />
        </div>
        )}
      </CollapsibleSection>
    </div>
  );
};
