import type { Block, GuideBlock } from "../../types";
import { fillToCss, resolveFill, type BlockFill, type FillStop } from "../../lib/blockFill";
import { makeId } from "./utils";
import { CollapsibleSection, ColorRow, RangeRow, SelectRow } from "./FormControls";

export type EffectsPanelProps = {
  /** A guide has no Effects panel. */
  selectedBlock: Exclude<Block, GuideBlock>;
  isMobile: boolean;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  /** The selected block's gradient, if it has one. Undefined = flat `blockColor`. */
  blockFill?: BlockFill;
  /** The selected block's flat colour — what a solid fill reads and writes. */
  blockColor?: string;
  /** Undefined or a solid fill clears `fill` and writes `color` instead. */
  onSetBlockFill?: (fill: BlockFill | undefined) => void;
  fillPresets: { id: string; name: string; fill: BlockFill }[];
  /** Which tab is showing. Owned by Sidebar so it survives a reselection. */
  effectsTab: "outline" | "shadow";
  setEffectsTab: (tab: "outline" | "shadow") => void;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * The Effects panel: the ink fill (flat, gradients, metallic presets), then
 * the Outline and Shadow tabs.
 */
export const EffectsPanel: React.FC<EffectsPanelProps> = ({
  selectedBlock,
  isMobile,
  onUpdateSelectedBlock,
  blockFill,
  blockColor,
  onSetBlockFill,
  fillPresets,
  effectsTab,
  setEffectsTab,
  isOpen,
  onToggle,
}) => {
  // The suffix of every control id here.
  const selectedId = selectedBlock.id;
  return (
    <div className="sidebarPanel">
      <CollapsibleSection title="Effects" isOpen={isOpen} onToggle={onToggle}>
        <div className="sectionPanel">
          {/* ---- STREAM-F: ink & surface — Fill section ---- */}
          {/* Holds no state — the editor reads the block's own fill and
              writes a whole new one on every change. */}
          {(() => {
            const flat = blockColor ?? "#000000";
            const current = resolveFill(blockFill, flat);
            const stops: FillStop[] =
              current.type === "solid"
                ? [
                    { offset: 0, color: flat },
                    { offset: 1, color: "#ffffff" },
                  ]
                : current.stops;
            const angle = current.type === "linear" ? current.angle : 90;

            const write = (next: BlockFill) => onSetBlockFill?.(next);
            const writeStops = (nextStops: FillStop[]) =>
              write(
                current.type === "radial"
                  ? { type: "radial", stops: nextStops }
                  : { type: "linear", angle, stops: nextStops }
              );

            return (
              <>
                <SelectRow
                  id="block-fill-type"
                  name="blockFillType"
                  label="Fill"
                  value={current.type}
                  onChange={(v) => {
                    if (v === "solid") write({ type: "solid", color: flat });
                    else if (v === "radial") write({ type: "radial", stops });
                    else write({ type: "linear", angle, stops });
                  }}
                >
                  <option value="solid">Flat colour</option>
                  <option value="linear">Linear gradient</option>
                  <option value="radial">Radial gradient</option>
                </SelectRow>

                <div className="field">
                  <span className="fieldTitle">Metallics</span>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      // Grid/flex children default to min-width:auto and
                      // refuse to shrink — see CLAUDE.md's note on the
                      // sidebar's narrow width.
                      minWidth: 0,
                    }}
                  >
                    {fillPresets.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        title={preset.name}
                        aria-label={preset.name}
                        style={{
                          background: fillToCss(preset.fill),
                          width: 34,
                          height: 22,
                          minWidth: 0,
                          borderRadius: 4,
                          border: "1px solid var(--border-soft)",
                          cursor: "pointer",
                          padding: 0,
                        }}
                        onClick={() => write(preset.fill)}
                      />
                    ))}
                  </div>
                </div>

                {current.type === "solid" ? (
                  <div style={{ fontSize: 12, opacity: 0.7 }}>
                    Flat ink uses the block's colour, set under Typography.
                  </div>
                ) : (
                  <>
                    {current.type === "linear" && (
                      <RangeRow
                        id="block-fill-angle"
                        name="blockFillAngle"
                        label="Gradient angle"
                        value={angle}
                        min={0}
                        max={360}
                        step={1}
                        onChange={(v) => write({ type: "linear", angle: v, stops })}
                        suffix={`${angle}°`}
                      />
                    )}

                    <div className="field">
                      <span className="fieldTitle">Stops</span>
                      {stops.map((stop, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                            minWidth: 0,
                          }}
                        >
                          <input
                            type="color"
                            aria-label={`Stop ${i + 1} colour`}
                            value={stop.color}
                            onChange={(e) =>
                              writeStops(
                                stops.map((s, j) =>
                                  j === i ? { ...s, color: e.target.value } : s
                                )
                              )
                            }
                          />
                          <input
                            type="range"
                            aria-label={`Stop ${i + 1} position`}
                            style={{ flex: 1, minWidth: 0 }}
                            min={0}
                            max={100}
                            value={Math.round(stop.offset * 100)}
                            onChange={(e) =>
                              writeStops(
                                stops.map((s, j) =>
                                  j === i
                                    ? { ...s, offset: Number(e.target.value) / 100 }
                                    : s
                                )
                              )
                            }
                          />
                          <button
                            type="button"
                            className="sidebarPillButton"
                            aria-label={`Remove stop ${i + 1}`}
                            disabled={stops.length <= 2}
                            onClick={() =>
                              writeStops(stops.filter((_, j) => j !== i))
                            }
                          >
                            −
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="sidebarPillButton"
                        disabled={stops.length >= 4}
                        onClick={() =>
                          writeStops([
                            ...stops,
                            {
                              offset: 1,
                              color: stops[stops.length - 1]?.color ?? flat,
                            },
                          ])
                        }
                      >
                        Add stop
                      </button>
                    </div>
                  </>
                )}
              </>
            );
          })()}
          {/* ---- /STREAM-F ---- */}
          <div style={{ display: "flex", gap: 6 }}>
            {(
              [
                { key: "outline", label: "Outline" },
                { key: "shadow", label: "Shadow" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setEffectsTab(tab.key)}
                className="sidebarPillButton"
                style={
                  effectsTab === tab.key
                    ? { background: "var(--accent)", color: "var(--text-on-accent)" }
                    : undefined
                }
              >
                {tab.label}
              </button>
            ))}
          </div>

          {effectsTab === "outline" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              <ColorRow
                id={makeId("stroke-color", selectedId)}
                name={makeId("strokeColor", selectedId)}
                label="Outline color"
                value={selectedBlock.stroke}
                onChange={(v) => onUpdateSelectedBlock({ stroke: v })}
              />

              <RangeRow
                id={makeId("stroke-width", selectedId)}
                name={makeId("strokeWidth", selectedId)}
                label="Outline width"
                value={selectedBlock.strokeWidth ?? 0}
                // Fine steps at the thin end, where outlines are actually
                // used: the fill covers the stroke's inner half, so the
                // visible outline is half this value, and the old 1-px steps
                // up to 20 jumped straight past the useful range.
                min={0}
                max={8}
                step={0.1}
                onChange={(v) => onUpdateSelectedBlock({ strokeWidth: Math.round(v * 10) / 10 })}
                suffix={Number((selectedBlock.strokeWidth ?? 0).toFixed(1))}
                fieldKey="strokeWidth"
              />
            </div>
          )}

          {effectsTab === "shadow" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
              <ColorRow
                id={makeId("shadow-color", selectedId)}
                name={makeId("shadowColor", selectedId)}
                label="Shadow color"
                value={selectedBlock.shadowColor}
                onChange={(v) => onUpdateSelectedBlock({ shadowColor: v })}
              />

              <RangeRow
                id={makeId("shadow-blur", selectedId)}
                name={makeId("shadowBlur", selectedId)}
                label="Shadow blur"
                value={selectedBlock.shadowBlur ?? 0}
                min={0}
                max={60}
                onChange={(v) => onUpdateSelectedBlock({ shadowBlur: v })}
                suffix={selectedBlock.shadowBlur ?? 0}
                fieldKey="shadowBlur"
              />

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr",
                  gap: 10,
                  marginTop: 8,
                }}
              >
                <RangeRow
                  id={makeId("shadow-offset-x", selectedId)}
                  name={makeId("shadowOffsetX", selectedId)}
                  label="Shadow X"
                  value={selectedBlock.shadowOffsetX ?? 0}
                  min={-60}
                  max={60}
                  onChange={(v) => onUpdateSelectedBlock({ shadowOffsetX: v })}
                  suffix={selectedBlock.shadowOffsetX ?? 0}
                  fieldKey="shadowOffsetX"
                />

                <RangeRow
                  id={makeId("shadow-offset-y", selectedId)}
                  name={makeId("shadowOffsetY", selectedId)}
                  label="Shadow Y"
                  value={selectedBlock.shadowOffsetY ?? 0}
                  min={-60}
                  max={60}
                  onChange={(v) => onUpdateSelectedBlock({ shadowOffsetY: v })}
                  suffix={selectedBlock.shadowOffsetY ?? 0}
                  fieldKey="shadowOffsetY"
                />
              </div>

              <RangeRow
                id={makeId("shadow-opacity", selectedId)}
                name={makeId("shadowOpacity", selectedId)}
                label="Shadow opacity"
                value={selectedBlock.shadowOpacity ?? 0.35}
                min={0}
                max={1}
                step={0.05}
                onChange={(v) => onUpdateSelectedBlock({ shadowOpacity: v })}
                suffix={`${Math.round((selectedBlock.shadowOpacity ?? 0.35) * 100)}%`}
                fieldKey="shadowOpacity"
              />
            </div>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
};
