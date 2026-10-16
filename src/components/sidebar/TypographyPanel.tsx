import type { Block, GuideBlock, MirrorBlock, TextAlign } from "../../types";
import {
  LETTER_SPACING_MAX,
  LETTER_SPACING_MIN,
  WORD_SPACING_MAX,
  WORD_SPACING_MIN,
} from "../../lib/spacing";
import {
  findKashidaSlots,
  readKashida,
  MAX_KASHIDA_PER_SLOT,
  TATWEEL,
  type KashidaSlot,
} from "../../lib/tatweel";
import { supportsGlyphAlternates, supportsStyleSets } from "../../lib/blockCapabilities";
import {
  activeStyleSets,
  alternatePanelView,
  currentChoice,
  fallbackFeatureLabel,
  resolveAlternateTarget,
  type AlternateChoice,
  type AlternateTarget,
} from "../../lib/glyphAlternates";
import type { GlyphAlternatesState, StyleSetsState } from "../../hooks/useGlyphAlternates";
import type { TextStyle } from "../../lib/textStyles";
import type { Palette } from "../../lib/palettes";
import { PaletteSwatches } from "../PaletteSwatches";
import { CloseIcon } from "../Icons";
import { AlternateStrip } from "./AlternateStrip";
import { useKashidaSupport } from "../../hooks/useKashidaSupport";
import { makeId } from "./utils";
import { CheckboxRow, CollapsibleSection, ColorRow, OpacityRow, RangeRow, RotationRow, SelectRow } from "./FormControls";

export type TypographyPanelProps = {
  /** Mirror and Guide hide Typography. */
  selectedBlock: Exclude<Block, MirrorBlock | GuideBlock>;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  // Styles & palettes
  /** Saved text styles, local-only (never part of a project). */
  textStyles: TextStyle[];
  selectedTextStyleId: string;
  onSelectTextStyle?: (id: string) => void;
  /** Applies the selected style to every selected block, as one undo step. */
  onApplyTextStyle?: () => void;
  newTextStyleName: string;
  onChangeNewTextStyleName?: (name: string) => void;
  onSaveTextStyle?: () => void;
  onDeleteTextStyle?: () => void;
  /** Shipped palettes first, then the user's own. */
  palettes: Palette[];
  selectedPaletteId: string;
  onSelectPalette?: (id: string) => void;
  onPickPaletteColor?: (color: string) => void;
  onSavePaletteFromCanvas?: () => void;
  onDeletePalette?: () => void;
  canDeletePalette: boolean;
  // Kashida and fit to width
  kashidaSlotOrdinal: number;
  onSelectKashidaSlot?: (ordinal: number) => void;
  onSetKashidaAtSlot?: (slot: KashidaSlot, count: number) => void;
  /** Only what the user typed, not the effective target. */
  fitTargetOverride: number | null;
  /** The page's margin-box width, shown as the placeholder. Null in freeform. */
  fitTargetPageDefault: number | null;
  isFittingWidth: boolean;
  onChangeFitTargetWidth?: (width: number | null) => void;
  onFitToWidth?: (target: number) => void;
  // Letter shapes (Next Shape)
  styleSetsState?: StyleSetsState;
  onToggleStyleSet?: (blockId: number, tag: string) => void;
  glyphAlternatesState?: GlyphAlternatesState;
  alternateTarget?: AlternateTarget | null;
  onToggleGlyphAlternateMode?: (blockId: number) => void;
  onResetGlyphAlternates?: (blockId: number) => void;
  onPickGlyphAlternate?: (blockId: number, letter: number, choice: AlternateChoice | null) => void;
  // Stretch strokes, dots & marks
  onToggleStrokeCutMode?: (blockId: number) => void;
  onClearStrokeCuts?: (blockId: number) => void;
  onToggleDetachedMarkMode?: (blockId: number) => void;
  onClearDetachedMarks?: (blockId: number) => void;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * Typography, the shared styling panel (see .claude/rules/sidebar.md):
 * styles and palettes, kashida and fit to width, size, colour, opacity,
 * alignment and spacing, then Letter shapes, Stretch strokes, Dots & marks
 * and Rotation.
 */
export const TypographyPanel: React.FC<TypographyPanelProps> = ({
  selectedBlock,
  onUpdateSelectedBlock,
  textStyles,
  selectedTextStyleId,
  onSelectTextStyle,
  onApplyTextStyle,
  newTextStyleName,
  onChangeNewTextStyleName,
  onSaveTextStyle,
  onDeleteTextStyle,
  palettes,
  selectedPaletteId,
  onSelectPalette,
  onPickPaletteColor,
  onSavePaletteFromCanvas,
  onDeletePalette,
  canDeletePalette,
  kashidaSlotOrdinal,
  onSelectKashidaSlot,
  onSetKashidaAtSlot,
  fitTargetOverride,
  fitTargetPageDefault,
  isFittingWidth,
  onChangeFitTargetWidth,
  onFitToWidth,
  styleSetsState,
  onToggleStyleSet,
  glyphAlternatesState,
  alternateTarget,
  onToggleGlyphAlternateMode,
  onResetGlyphAlternates,
  onPickGlyphAlternate,
  onToggleStrokeCutMode,
  onClearStrokeCuts,
  onToggleDetachedMarkMode,
  onClearDetachedMarks,
  isOpen,
  onToggle,
}) => {
  // The suffix of every control id here.
  // Some fonts have no working tatweel (Jameel Noori, Gulzar, Blaka, Ruqaa);
  // see `fontSupportsKashida`. `null` until the one-off probe answers.
  const kashidaOk = useKashidaSupport(selectedBlock.fontFamily);
  const selectedId = selectedBlock.id;
  return (
    <div className="sidebarPanel">
      <CollapsibleSection title="Typography" isOpen={isOpen} onToggle={onToggle}>
        <div className="sectionPanel">
          {/* ---- STREAM-E: styles & palettes — Styles row ---- */}
          {/* Holds no state: the list, the selection and the name draft all
              live in App.tsx beside the other local stores. */}
          <div className="field">
            <span className="fieldTitle">Style</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <select
                value={selectedTextStyleId}
                onChange={(e) => onSelectTextStyle?.(e.target.value)}
                className="select"
                aria-label="Text style"
                style={{ minWidth: 0, flex: 1 }}
              >
                <option value="">
                  {textStyles.length === 0 ? "No saved styles" : "Style…"}
                </option>
                {textStyles.map((style) => (
                  <option key={style.id} value={style.id}>
                    {style.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onApplyTextStyle}
                disabled={!selectedTextStyleId}
                className="sidebarPillButton"
                style={{ flex: "0 0 auto", padding: "0 10px" }}
                title="Apply this style to every selected block"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={onDeleteTextStyle}
                disabled={!selectedTextStyleId}
                className="layerIconBtn"
                title="Delete this style"
                aria-label="Delete this style"
                style={{ color: "var(--danger)", flex: "0 0 auto" }}
              >
                <CloseIcon size={13} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                type="text"
                value={newTextStyleName}
                onChange={(e) => onChangeNewTextStyleName?.(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTextStyleName.trim()) onSaveTextStyle?.();
                }}
                placeholder="Style name…"
                aria-label="New text style name"
                className="hexInput"
                style={{ minWidth: 0, fontFamily: "inherit", letterSpacing: 0 }}
              />
              <button
                type="button"
                onClick={onSaveTextStyle}
                disabled={!newTextStyleName.trim()}
                className="sidebarPillButton"
                style={{ flex: "0 0 auto" }}
                title="Save this block's font, colour, outline and shadow as a style"
              >
                Save style
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              A style carries font, colour, outline and shadow — never the
              text or where the block sits. Styles stay in this browser.
            </div>
          </div>

          {palettes.length > 0 && (
            <PaletteSwatches
              palettes={palettes}
              selectedId={selectedPaletteId}
              onSelect={(id) => onSelectPalette?.(id)}
              value={selectedBlock.color}
              onPick={(color) => onPickPaletteColor?.(color)}
              onSaveFromCanvas={onSavePaletteFromCanvas}
              onDelete={onDeletePalette}
              canDelete={canDeletePalette}
            />
          )}
          {/* ---- /STREAM-E ---- */}
          {/* Everything this section needs is derived from the block's
              own text, so it holds no state of its own beyond the
              selected slot (which lives in App.tsx). */}
          {selectedBlock.type !== "stack" && (() => {
            const slots = findKashidaSlots(selectedBlock.text);
            if (slots.length === 0) {
              return (
                <div className="field">
                  <span className="fieldTitle">Kashida</span>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    No stretchable joins in this text — a kashida needs two
                    letters that join to each other.
                  </div>
                </div>
              );
            }
            // No working tatweel: hide the whole section, Fit to width
            // included, rather than explain it.
            if (kashidaOk === false) return null;

            // The ordinal is clamped rather than reset, so editing the
            // text (which changes how many slots there are) can never
            // point the stepper past the end of the list.
            const ordinal = Math.min(Math.max(0, kashidaSlotOrdinal), slots.length - 1);
            const slot = slots[ordinal];
            const counts = readKashida(selectedBlock.text, slots);
            const count = counts.get(slot.index) ?? 0;
            const setCount = (n: number) =>
              onSetKashidaAtSlot?.(slot, Math.min(MAX_KASHIDA_PER_SLOT, Math.max(0, n)));
            const slotLabel = (s: KashidaSlot) => `${s.before} ${TATWEEL} ${s.after}`;

            return (
              <>
                <SelectRow
                  id={makeId("kashida-slot", selectedId)}
                  name={makeId("kashidaSlot", selectedId)}
                  label="Kashida join"
                  value={String(ordinal)}
                  onChange={(v) => onSelectKashidaSlot?.(Number(v))}
                >
                  {slots.map((s, i) => (
                    <option key={`${s.index}-${i}`} value={String(i)}>
                      {`${i + 1}. ${slotLabel(s)}`}
                      {(counts.get(s.index) ?? 0) > 0 ? ` (${counts.get(s.index)})` : ""}
                    </option>
                  ))}
                </SelectRow>

                <div className="field">
                  <span className="fieldTitle">Stretch this join</span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <button
                      type="button"
                      className="sidebarCircleButton"
                      aria-label="Shorten kashida"
                      disabled={count === 0}
                      onClick={() => setCount(count - 1)}
                    >
                      −
                    </button>
                    <span
                      aria-label="Kashida length"
                      style={{
                        minWidth: 24,
                        textAlign: "center",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {count}
                    </span>
                    <button
                      type="button"
                      className="sidebarCircleButton"
                      aria-label="Lengthen kashida"
                      disabled={count >= MAX_KASHIDA_PER_SLOT}
                      onClick={() => setCount(count + 1)}
                    >
                      +
                    </button>
                    <span
                      dir="rtl"
                      style={{ flex: 1, minWidth: 0, fontSize: 16, textAlign: "center" }}
                    >
                      {slot.before}
                      {TATWEEL.repeat(Math.max(1, count))}
                      {slot.after}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                    Adds tatweel characters to the text itself, so the letters
                    really connect. Apply kashida before fine-tuning marks.
                  </div>
                </div>

                {/* Plain text only. A Shape Fill run is auto-scaled to
                    span its silhouette and a Curve run to span its
                    curve, so on those types a width target has nothing
                    to act on — the same reason `fontSize` is hidden for
                    a curve. */}
                {selectedBlock.type === "text" && (() => {
                  // The effective target is derived here rather than
                  // threaded in, so "what the box shows" and "what Fit
                  // uses" cannot disagree.
                  const effectiveTarget =
                    fitTargetOverride ?? fitTargetPageDefault;
                  const isFromPage =
                    fitTargetOverride === null && fitTargetPageDefault !== null;
                  return (
                  <div className="field">
                    <span className="fieldTitle">Fit to width</span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <input
                        id={makeId("fit-target", selectedId)}
                        type="number"
                        min={1}
                        step={1}
                        className="hexInput artboardNumberInput"
                        aria-label="Target width in pixels"
                        placeholder={
                          fitTargetPageDefault !== null
                            ? String(fitTargetPageDefault)
                            : "width in px"
                        }
                        value={fitTargetOverride ?? ""}
                        onChange={(e) => {
                          // A number input reports "" for most partial
                          // entries, but a paste can still produce
                          // something `Number` reads as NaN — which
                          // `??` would carry straight through to the
                          // value, stranding the field. Anything not a
                          // real number means "track the page" instead.
                          const value = Number(e.target.value.trim());
                          onChangeFitTargetWidth?.(
                            Number.isFinite(value) && value > 0 ? value : null
                          );
                        }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <button
                        type="button"
                        className="sidebarPillButton"
                        disabled={isFittingWidth || !effectiveTarget}
                        onClick={() => {
                          if (effectiveTarget) onFitToWidth?.(effectiveTarget);
                        }}
                      >
                        {isFittingWidth ? "Fitting…" : "Fit"}
                      </button>
                    </div>

                    {fitTargetPageDefault !== null && !isFromPage && (
                      <button
                        type="button"
                        className="sidebarSectionButton"
                        style={{ marginTop: 6 }}
                        onClick={() => onChangeFitTargetWidth?.(null)}
                      >
                        Use page margin box
                      </button>
                    )}

                    <div
                      style={{
                        fontSize: 11,
                        color: "var(--text-muted)",
                        marginTop: 4,
                      }}
                    >
                      {isFromPage
                        ? "Tracking the page's margin box. "
                        : fitTargetPageDefault !== null
                          ? ""
                          : "No page is set, so type a target. "}
                      Spreads kashida evenly across every join above until the
                      text spans the target — never past it. Replaces any
                      kashida already set.
                    </div>
                  </div>
                  );
                })()}
              </>
            );
          })()}
          {selectedBlock.type === "textPath" && !selectedBlock.guide ? (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              Letter size on a text-path block is set by the curve's length — drag the
              curve longer or shorter in Edit Curve mode, or change the text.
            </div>
          ) : (
            <RangeRow
              id={makeId("font-size", selectedId)}
              name={makeId("fontSize", selectedId)}
              label="Font size"
              value={selectedBlock.fontSize}
              min={selectedBlock.type === "shapeFill" ? 4 : 12}
              max={selectedBlock.type === "shapeFill" ? 400 : 200}
              onChange={(v) => onUpdateSelectedBlock({ fontSize: v })}
              suffix={`${Math.round(selectedBlock.fontSize)}px`}
              fieldKey="fontSize"
            />
          )}

          <ColorRow
            id={makeId("text-color", selectedId)}
            name={makeId("textColor", selectedId)}
            label="Text color"
            value={selectedBlock.color}
            onChange={(v) => onUpdateSelectedBlock({ color: v })}
          />

          <OpacityRow
            selectedId={selectedId}
            value={selectedBlock.opacity}
            onChange={(v) => onUpdateSelectedBlock({ opacity: v })}
          />

          {selectedBlock.type === "text" && (
            <SelectRow
              id={makeId("text-align", selectedId)}
              name={makeId("textAlign", selectedId)}
              label="Alignment"
              value={selectedBlock.align ?? "center"}
              onChange={(v) =>
                onUpdateSelectedBlock({ align: v as TextAlign })
              }
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </SelectRow>
          )}

          {selectedBlock.type === "text" && (
            <RangeRow
              id={makeId("line-height", selectedId)}
              name={makeId("lineHeight", selectedId)}
              label="Line height"
              value={selectedBlock.lineHeight ?? 1.2}
              min={0.8}
              max={3}
              step={0.05}
              onChange={(v) => onUpdateSelectedBlock({ lineHeight: v })}
              suffix={(selectedBlock.lineHeight ?? 1.2).toFixed(2)}
              fieldKey="lineHeight"
            />
          )}

          {selectedBlock.type === "text" && (
            <RangeRow
              id={makeId("letter-spacing", selectedId)}
              name={makeId("letterSpacing", selectedId)}
              label="Letter spacing"
              value={selectedBlock.letterSpacing ?? 0}
              min={LETTER_SPACING_MIN}
              max={LETTER_SPACING_MAX}
              step={0.01}
              onChange={(v) => onUpdateSelectedBlock({ letterSpacing: v })}
              suffix={(selectedBlock.letterSpacing ?? 0).toFixed(2)}
              fieldKey="letterSpacing"
            />
          )}

          {selectedBlock.type === "text" && (
            <RangeRow
              id={makeId("word-spacing", selectedId)}
              name={makeId("wordSpacing", selectedId)}
              label="Word spacing"
              value={selectedBlock.wordSpacing ?? 0}
              min={WORD_SPACING_MIN}
              max={WORD_SPACING_MAX}
              step={0.01}
              onChange={(v) => onUpdateSelectedBlock({ wordSpacing: v })}
              suffix={(selectedBlock.wordSpacing ?? 0).toFixed(2)}
              fieldKey="wordSpacing"
            />
          )}

          {supportsStyleSets(selectedBlock) && (
            <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
              <div className="sidebarSectionTitle">Letter shapes</div>

              {/* Block-wide style sets: every matching letter at once.
                  A set that is on stays listed even if the text no
                  longer uses it, so it can always be switched off. */}
              {(() => {
                const state = styleSetsState;
                const on = activeStyleSets(selectedBlock.styleSets);
                const listed = [
                  ...(state?.sets ?? []),
                  ...on
                    .filter((t) => !(state?.sets ?? []).some((x) => x.feature === t))
                    .map((t) => ({ feature: t, label: fallbackFeatureLabel({ feature: t, value: 1 }) })),
                ];
                const note = (text: string) => (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{text}</div>
                );
                if (listed.length === 0) {
                  if (!state || state.loading) return note("Looking for style sets…");
                  return note(
                    state.fontHasStyleSets
                      ? "No style set in this font changes this text"
                      : "No style sets in this font"
                  );
                }
                return (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", margin: "2px 0 4px" }}>
                      Style sets — applied to every matching letter
                    </div>
                    {listed.map((set) => (
                      <CheckboxRow
                        key={set.feature}
                        id={makeId(`style-set-${set.feature}`, selectedId)}
                        label={set.label}
                        checked={on.includes(set.feature)}
                        onChange={() => onToggleStyleSet?.(selectedBlock.id, set.feature)}
                      />
                    ))}
                  </div>
                );
              })()}

              {supportsGlyphAlternates(selectedBlock) && (<>
              <CheckboxRow
                id={makeId("glyph-alternate-mode", selectedId)}
                label="Alternate letter shapes"
                checked={!!selectedBlock.glyphAlternateMode}
                onChange={() => onToggleGlyphAlternateMode?.(selectedBlock.id)}
              />

              {selectedBlock.glyphAlternateMode && (() => {
                const state = glyphAlternatesState;
                const letter = resolveAlternateTarget(
                  alternateTarget,
                  selectedBlock.id,
                  selectedBlock.text
                );
                const note = (text: string) => (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{text}</div>
                );
                const view = alternatePanelView(
                  state && { ...state, hasFont: state.font !== null },
                  letter
                );
                if (view.kind === "loading") return note("Looking for alternate shapes…");
                if (view.kind === "noFontAlternates") return note("No alternate shapes in this font");
                if (view.kind === "noTextAlternates")
                  return note("No letter in this text has alternate shapes");
                if (view.kind === "prompt")
                  return note(
                    "Click an outlined letter to step through its shapes; Shift-click goes back."
                  );
                if (view.kind === "noLetterAlternates" || !state?.font)
                  return note("This letter has no alternates");
                const { target } = view;
                return (
                  <>
                    <AlternateStrip
                      font={state.font}
                      unitsPerEm={state.unitsPerEm}
                      options={target.options}
                      current={currentChoice(selectedBlock.glyphAlternates, target.letter)}
                      onPick={(choice: AlternateChoice | null) =>
                        onPickGlyphAlternate?.(selectedBlock.id, target.letter, choice)
                      }
                    />
                    {note("Changing a letter's shape removes any stroke stretch on it.")}
                  </>
                );
              })()}

              {(selectedBlock.glyphAlternates?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onResetGlyphAlternates?.(selectedBlock.id)}
                  className="sidebarSmallAction"
                  title="Return every letter to the font's usual shape"
                  style={{ background: "var(--bg-input)", marginTop: 8 }}
                >
                  Reset letter shapes
                </button>
              )}
              </>)}
            </div>
          )}

          {/* Plain text only: only ShapedText performs the outline
              surgery, so arming it elsewhere would show handles that
              stretch nothing. */}
          {selectedBlock.type === "text" && (
            <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
              <div className="sidebarSectionTitle">Stretch strokes</div>

              <CheckboxRow
                id={makeId("stroke-cut-mode", selectedId)}
                label="Stretch strokes"
                checked={!!selectedBlock.strokeCutEditMode}
                onChange={() => onToggleStrokeCutMode?.(selectedBlock.id)}
              />

              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                Hover a letter to find a straight stroke, then drag along it to
                lengthen the letter itself. Hold Alt to drag off the half-nuqta
                steps. Not every letter has one — it depends on how the font
                draws it.
              </div>

              {(selectedBlock.strokeCuts?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onClearStrokeCuts?.(selectedBlock.id)}
                  className="sidebarSmallAction"
                  title="Undo every stroke stretch on this block"
                  style={{ background: "var(--bg-input)", marginTop: 8 }}
                >
                  Reset stroke stretches
                </button>
              )}
            </div>
          )}

          {/* Text and Shape Fill: the two renderers that split a glyph's
              contours (supportsDetachedMarks). */}
          {(selectedBlock.type === "text" || selectedBlock.type === "shapeFill") && (
            <div style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 12 }}>
              <div className="sidebarSectionTitle">Dots & marks</div>

              <CheckboxRow
                id={makeId("detached-mark-mode", selectedId)}
                label="Move dots & marks"
                checked={!!selectedBlock.detachedMarkEditMode}
                onChange={() => onToggleDetachedMarkMode?.(selectedBlock.id)}
              />

              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                Hover a letter's dot, hamza or kaf stroke and drag it anywhere.
                Double-click the handle to put it back. Dots keep their size;
                a dot drawn touching its letter cannot be moved.
              </div>

              {(selectedBlock.detachedMarkOverrides?.length ?? 0) > 0 && (
                <button
                  type="button"
                  onClick={() => onClearDetachedMarks?.(selectedBlock.id)}
                  className="sidebarSmallAction"
                  title="Put every moved dot and mark back in its place"
                  style={{ background: "var(--bg-input)", marginTop: 8 }}
                >
                  Reset dots & marks
                </button>
              )}
            </div>
          )}

          {/* Attached text draws at its guide, so its own rotation is
              inert: the guide's Rotation row is the one that turns it. */}
          {!(selectedBlock.type === "textPath" && selectedBlock.guide) && (
            <RotationRow
              selectedId={selectedId}
              value={selectedBlock.rotation}
              onChange={(v) => onUpdateSelectedBlock({ rotation: v })}
            />
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
};
