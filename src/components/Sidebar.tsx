import React, { useState } from "react";
import { ArabicKeyboard } from "./ArabicKeyboard";
import { DIACRITICS, SPECIALS, PERSIAN, URDU, PRESETS } from "./SidebarPresets";

type Block = {
  id: number;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontFamily: string;
  fontStyle?: "normal" | "bold" | "italic" | "bold italic";
  opacity?: number;
  shadowColor?: string;
  shadowBlur?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowOpacity?: number;
  stroke?: string;
  strokeWidth?: number;
  locked?: boolean;
  rotation?: number;
};

export type SidebarProps = {
  blocks: Block[];
  selectedBlock?: Block;
  showGrid: boolean;
  snapToGrid: boolean;
  isMobile: boolean;
  width: number;
  canvasPresetId: string;
  onChangeCanvasPreset: (id: string) => void;
  backgroundColor: string;
  onChangeBackgroundColor: (color: string) => void;
  onAddBlock: () => void;
  onAddCircleBlock?: () => void;
  onDuplicateBlock: () => void;
  onDeleteBlock: () => void;
  onExportPNG: () => void;
  onExportSVG: () => void;
  onExportPDF: () => void;
  onSaveLayout: () => void;
  onLoadLayout: () => void;
  onToggleGrid: (v: boolean) => void;
  onToggleSnap: (v: boolean) => void;
  onSelectBlock: (id: number | null) => void;
  onUpdateSelectedBlock: (patch: Partial<Block>) => void;
  showKeyboard: boolean;
  onToggleKeyboard: () => void;
  onClearDiacritics: (block: Block) => void;
  onInsertPreset: (value: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
};

const SelectRow = ({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) => (
  <label className="field">
    <span className="fieldTitle">{label}</span>
    <div className="shell">
      <select value={value} onChange={(e) => onChange(e.target.value)} className="select">
        {children}
      </select>
    </div>
  </label>
);

const ColorRow = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <label className="field">
    <span className="fieldTitle">{label}</span>
    <input
      type="color"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="sidebarColorInput"
    />
  </label>
);

const RangeRow = ({
  label,
  value,
  min,
  max,
  step,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) => (
  <label className="field">
    <span className="fieldTitle">
      {label}{" "}
      {suffix ? (
        <span style={{ color: "#6b7280", fontWeight: 500 }}>{suffix}</span>
      ) : null}
    </span>
    <input
      type="range"
      min={min}
      max={max}
      step={step ?? 1}
      value={value}
      onChange={(e) =>
        onChange(step ? parseFloat(e.target.value) : parseInt(e.target.value, 10))
      }
      className="rangeInput"
    />
  </label>
);

const PresetKeyboard = ({
  title,
  rows,
  onPick,
}: {
  title: string;
  rows: string[][];
  onPick: (value: string) => void;
}) => (
  <div className="sidebarPresetKeyboard">
    <div className="sidebarPresetKeyboardTitle">{title}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} className="sidebarPresetKeyboardRow">
          {row.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={`sidebarPresetKeyboardKey ${
                key.length > 1 ? "sidebarPresetKeyboardKeyWide" : ""
              }`}
            >
              {key}
            </button>
          ))}
        </div>
      ))}
    </div>
  </div>
);
// ... ColorRow, RangeRow, PresetKeyboard unchanged ...

export const Sidebar: React.FC<SidebarProps> = ({
  blocks,
  selectedBlock,
  showGrid,
  snapToGrid,
  isMobile,
  width,
  canvasPresetId,
  onChangeCanvasPreset,
  backgroundColor,
  onChangeBackgroundColor,
  onAddBlock,
  onAddCircleBlock,
  onDuplicateBlock,
  onDeleteBlock,
  onExportPNG,
  onExportSVG,
  onExportPDF,
  onSaveLayout,
  onLoadLayout,
  onToggleGrid,
  onToggleSnap,
  onSelectBlock,
  onUpdateSelectedBlock,
  showKeyboard,
  onToggleKeyboard,
  onClearDiacritics,
  onInsertPreset,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}) => {
  const [showStyling, setShowStyling] = useState(false);
  const [showHelpers, setShowHelpers] = useState(false);
  const [showFileActions, setShowFileActions] = useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [cursorPosition, setCursorPosition] = useState<number>(0);
  const selectedText = selectedBlock?.text ?? "";
  const selectedOpacity = selectedBlock?.opacity ?? 1;
  const selectedShadowOpacity = selectedBlock?.shadowOpacity ?? 0.35;
  const selectedRotation = selectedBlock?.rotation ?? 0;

  const updateText = (text: string) => {
    if (selectedBlock) onUpdateSelectedBlock({ text });
  };

  const activeBlockLabel = selectedBlock ? `Block ${selectedBlock.id}` : "Block";

  const handleKeyboardKey = (k: string) => {
    if (!selectedBlock) return;
    const before = selectedText.substring(0, cursorPosition);
    const after = selectedText.substring(cursorPosition);
    const newText = before + k + after;
    const newPos = cursorPosition + k.length;
    onUpdateSelectedBlock({ text: newText });
    setCursorPosition(newPos);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  const handleKeyboardSpace = () => handleKeyboardKey(" ");

  const handleKeyboardBackspace = () => {
    if (!selectedBlock || cursorPosition === 0) return;
    const before = selectedText.substring(0, cursorPosition - 1);
    const after = selectedText.substring(cursorPosition);
    const newText = before + after;
    const newPos = cursorPosition - 1;
    onUpdateSelectedBlock({ text: newText });
    setCursorPosition(newPos);
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  };

  return (
    <div
      style={{
        width,
        height: "100%",
        padding: 0,
        boxSizing: "border-box",
        borderRight: isMobile ? "none" : "1px solid #dbe2ea",
        borderBottom: isMobile ? "1px solid #dbe2ea" : "none",
        background: "linear-gradient(180deg, #e8edf2 0%, #dde3ea 100%)",
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        position: "relative",
        flexShrink: 0,
        overflowY: "auto",
        overflowX: "hidden",
      }}
    >
      <div className="sidebarInner">
        <div className="sidebarPanel">
          <h2
            className="sidebarTitle"
            style={{
              fontSize: isMobile ? 18 : 20,
              textAlign: "center",
              color: "#111827",
              letterSpacing: "-0.02em",
            }}
          >
            Mohammed's Calligraphy
          </h2>
        </div>

        <div className="sidebarPanel">
          <div className="sidebarSectionTitle">Block Controls</div>

          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <button
              type="button"
              onClick={onDeleteBlock}
              disabled={!selectedBlock || blocks.length === 0}
              className="sidebarCircleButton"
            >
              -
            </button>
            <button
              type="button"
              onClick={onDuplicateBlock}
              disabled={!selectedBlock}
              className="sidebarCircleButton"
            >
              II
            </button>
            <button
              type="button"
              onClick={onAddBlock}
              className="sidebarCircleButton"
              title="Add text block"
            >
              +
            </button>
            {onAddCircleBlock && (
              <button
                type="button"
                onClick={onAddCircleBlock}
                className="sidebarCircleButton"
                title="Add circle text"
              >
                ⭕
              </button>
            )}
          </div>

          <div style={{ height: 10 }} />

          <div style={{ display: "flex", justifyContent: "center", gap: 12 }}>
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              className="sidebarCircleButton"
              aria-label="Undo"
            >
              ↶
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              className="sidebarCircleButton"
              aria-label="Redo"
            >
              ↷
            </button>
          </div>
		  
        </div>

        {selectedBlock && (
          <div className="sidebarPanel">
            <div className="sidebarSectionTitle">{activeBlockLabel}</div>
            <textarea
              ref={textareaRef}
              className="sidebarTextarea"
              value={selectedText}
              onChange={(e) => updateText(e.target.value)}
              onSelect={(e) => {
                setCursorPosition(e.currentTarget.selectionStart ?? 0);
              }}
              placeholder="Select a text block to edit..."
            />
          </div>
        )}

        {selectedBlock && (
          <div className="sidebarPanel">
            <button
              type="button"
              onClick={() => setShowStyling((v) => !v)}
              className="sidebarSectionButton"
            >
              <span>Styling</span>
              <span>{showStyling ? "−" : "+"}</span>
            </button>

            {showStyling && (
              <div className="sectionPanel">
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                  <SelectRow
                    label="Font family"
                    value={selectedBlock.fontFamily}
                    onChange={(value) => onUpdateSelectedBlock({ fontFamily: value })}
                  >
                    <option value="AlFatemi">Al Fatemi</option>
                    <option value="FatemiMaqala">Fatemi Maqala</option>
                    <option value="TahaNaskhRegular">Taha Naskh</option>
                    <option value="Kufi">Kufi</option>
                    <option value="Kufi2">Kufi2</option>
                    <option value="Thuluth">Thuluth</option>
					<option value="ThuluthDeco">Thuluth Deco</option>
                    <option value="Wessam">Wessam</option>
                    <option value="Yekan">Yekan</option>
                    <option value="NotoSans">Noto Sans</option>
                    <option value="Lateef">Lateef</option>
                    <option value="Amiri">Amiri</option>
                    <option value="Ruqaa">Ruqaa</option>
                    <option value="Qahiri">Qahiri</option>
                    <option value="Urdu">Urdu</option>
                  </SelectRow>

                  <SelectRow
                    label="Font style"
                    value={selectedBlock.fontStyle ?? "normal"}
                    onChange={(value) => onUpdateSelectedBlock({ fontStyle: value as Block["fontStyle"] })}
                  >
                    <option value="normal">Normal</option>
                    <option value="bold">Bold</option>
                    <option value="italic">Italic</option>
                    <option value="bold italic">Bold italic</option>
                  </SelectRow>
                </div>

				<RangeRow
				  label="Font size"
				  value={selectedBlock.fontSize}
				  min={24}
				  max={160}
				  onChange={(value) => onUpdateSelectedBlock({ fontSize: value })}
				/>

				<div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
				  <ColorRow
					label="Text color"
					value={selectedBlock.color}
					onChange={(value) => onUpdateSelectedBlock({ color: value })}
				/>
				  <RangeRow
					label="Opacity"
					value={selectedOpacity}
					min={0.1}
					max={1}
					step={0.05}
					onChange={(value) => onUpdateSelectedBlock({ opacity: value })}
					suffix={`${Math.round(selectedOpacity * 100)}%`}
				/>
				</div>

				{/* Rotation section */}
				<div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
				  <div className="sidebarSectionTitle">Rotation</div>
				  <RangeRow
					label="Rotation"
					value={selectedRotation}
					min={-180}
					max={180}
					step={1}
					onChange={(value) => onUpdateSelectedBlock({ rotation: value })}
					suffix={`${selectedRotation}°`}
				/>
				</div>

				{/* Stroke section */}
				<div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
				  <div className="sidebarSectionTitle">Stroke</div>
				  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
					<ColorRow
					  label="Stroke color"
					  value={selectedBlock.stroke ?? "#000000"}
					  onChange={(value) => onUpdateSelectedBlock({ stroke: value })}
				/>
					<RangeRow
					  label="Stroke width"
					  value={selectedBlock.strokeWidth ?? 0}
					  min={0}
					  max={14}
					  onChange={(value) => onUpdateSelectedBlock({ strokeWidth: value })}
				/>
				  </div>
				</div>                <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
                  <div className="sidebarSectionTitle">Shadow</div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10 }}>
                    <ColorRow
                      label="Shadow color"
                      value={selectedBlock.shadowColor ?? "#000000"}
                      onChange={(value) => onUpdateSelectedBlock({ shadowColor: value })}
                    />
                    <RangeRow
                      label="Shadow blur"
                      value={selectedBlock.shadowBlur ?? 0}
                      min={0}
                      max={40}
                      onChange={(value) => onUpdateSelectedBlock({ shadowBlur: value })}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 10, marginTop: 10 }}>
                    <RangeRow
                      label="Shadow X"
                      value={selectedBlock.shadowOffsetX ?? 0}
                      min={-40}
                      max={40}
                      onChange={(value) => onUpdateSelectedBlock({ shadowOffsetX: value })}
                    />
                    <RangeRow
                      label="Shadow Y"
                      value={selectedBlock.shadowOffsetY ?? 0}
                      min={-40}
                      max={40}
                      onChange={(value) => onUpdateSelectedBlock({ shadowOffsetY: value })}
                    />
                  </div>

                  <RangeRow
                    label="Shadow opacity"
                    value={selectedShadowOpacity}
                    min={0}
                    max={1}
                    step={0.05}
                    onChange={(value) => onUpdateSelectedBlock({ shadowOpacity: value })}
                    suffix={`${Math.round(selectedShadowOpacity * 100)}%`}
                  />
                </div>
				{selectedBlock?.type === "circlePath" && (
				  <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12, marginTop: 8 }}>
					<div className="sidebarSectionTitle">Circle Path</div>

					{/* Top/Bottom toggle */}
					<div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
					  <button
						type="button"
						className="sidebarSmallAction"
						style={{
						  flex: 1,
						  background:
							selectedBlock.arcPosition === "top" ? "#111827" : "#f3f4f6",
						  color: selectedBlock.arcPosition === "top" ? "#ffffff" : "#111827",
						}}
						onClick={() => onUpdateSelectedBlock({ arcPosition: "top" })}
					  >
						Top
					  </button>
					  <button
						type="button"
						className="sidebarSmallAction"
						style={{
						  flex: 1,
						  background:
							selectedBlock.arcPosition === "bottom" ? "#111827" : "#f3f4f6",
						  color: selectedBlock.arcPosition === "bottom" ? "#ffffff" : "#111827",
						}}
						onClick={() => onUpdateSelectedBlock({ arcPosition: "bottom" })}
					  >
						Bottom
					  </button>
					</div>

					{/* Radius */}
					<RangeRow
					  label="Radius"
					  value={selectedBlock.radius ?? 250}
					  min={50}
					  max={800}
					  onChange={(value) => onUpdateSelectedBlock({ radius: value })}
					  suffix={`${selectedBlock.radius ?? 250}px`}
					/>

					{/* Start/End angles */}
					<RangeRow
					  label="Start angle"
					  value={selectedBlock.startAngle ?? -160}
					  min={-360}
					  max={360}
					  onChange={(value) => onUpdateSelectedBlock({ startAngle: value })}
					  suffix={`${selectedBlock.startAngle ?? -160}°`}
					/>
					<RangeRow
					  label="End angle"
					  value={selectedBlock.endAngle ?? -20}
					  min={-360}
					  max={360}
					  onChange={(value) => onUpdateSelectedBlock({ endAngle: value })}
					  suffix={`${selectedBlock.endAngle ?? -20}°`}
					/>

					{/* Letter spacing */}
					<RangeRow
					  label="Letter spacing"
					  value={selectedBlock.letterSpacing ?? 1}
					  min={0.5}
					  max={2}
					  step={0.05}
					  onChange={(value) => onUpdateSelectedBlock({ letterSpacing: value })}
					  suffix={`${(selectedBlock.letterSpacing ?? 1).toFixed(2)}×`}
					/>
				  </div>
				)}
              </div>
            )}
          </div>
        )}

        <div className="sidebarPanel">
          <button type="button" onClick={onToggleKeyboard} className="sidebarSectionButton">
            <span>Arabic Keyboard</span>
            <span>{showKeyboard ? "−" : "+"}</span>
          </button>

          {showKeyboard && (
            <div className="keyboardWrap">
              <ArabicKeyboard
                onKey={handleKeyboardKey}
                onSpace={handleKeyboardSpace}
                onBackspace={handleKeyboardBackspace}
                style={{ width: "100%" }}
              />
            </div>
          )}
        </div>

        <div className="sidebarPanel">
          <button type="button" onClick={() => setShowHelpers((v) => !v)} className="sidebarSectionButton">
            <span>Arabic Helpers</span>
            <span>{showHelpers ? "−" : "+"}</span>
          </button>

          {showHelpers && (
            <div className="sectionPanel">
              <PresetKeyboard title="Diacritics" rows={[DIACRITICS.slice(0, 6), DIACRITICS.slice(6)]} onPick={handleKeyboardKey} />
              <button
                type="button"
                onClick={() => selectedBlock && onClearDiacritics(selectedBlock)}
                className="sidebarSmallAction"
                style={{ background: "#f9fafb" }}
              >
                Clear diacritics
              </button>
              <PresetKeyboard title="Presets" rows={[PRESETS.slice(0, 5), PRESETS.slice(5)]} onPick={onInsertPreset} />
              <PresetKeyboard title="Specials" rows={[SPECIALS.slice(0, 6), SPECIALS.slice(6)]} onPick={onInsertPreset} />
              <PresetKeyboard title="Persian" rows={[PERSIAN.slice(0, 6), PERSIAN.slice(6)]} onPick={onInsertPreset} />
              <PresetKeyboard title="Urdu" rows={[URDU.slice(0, 6), URDU.slice(6)]} onPick={onInsertPreset} />
            </div>
          )}
        </div>

        <div className="sidebarPanel">
          <button type="button" onClick={() => setShowFileActions((v) => !v)} className="sidebarSectionButton">
            <span>Save Export</span>
            <span>{showFileActions ? "−" : "+"}</span>
          </button>

		{showFileActions && (
		  <div
			style={{ display: "flex", justifyContent: "center", gap: 12, flexWrap: "wrap" }}
		  >
			<button
			  type="button"
			  onClick={onExportPNG}
			  className="sidebarCircleButton sidebarCircleButton--light"
			  aria-label="Export PNG"
			>
			  PNG
			</button>
			<button
			  type="button"
			  onClick={onExportSVG}
			  className="sidebarCircleButton sidebarCircleButton--light"
			  aria-label="Export SVG"
			>
			  SVG
			</button>
			<button
			  type="button"
			  onClick={onExportPDF}
			  className="sidebarCircleButton sidebarCircleButton--light"
			  aria-label="Export PDF"
			>
			  PDF
			</button>
			<button
			  type="button"
			  onClick={onSaveLayout}
			  className="sidebarCircleButton"
			  aria-label="Save layout"
			>
			  💾
			</button>
			<button
			  type="button"
			  onClick={onLoadLayout}
			  className="sidebarCircleButton"
			  aria-label="Load layout"
			>
			  📂
			</button>
		  </div>
		)}
        </div>

        <div className="sidebarPanel">
          <div className="sidebarSectionTitle">Canvas</div>
          <div className="sidebarSectionTitle">Size</div>
          <div className="shell">
            <select
              value={canvasPresetId}
              onChange={(e) => onChangeCanvasPreset(e.target.value)}
              className="select"
            >
              <option value="story">Story</option>
              <option value="square">Instagram Square</option>
              <option value="a4">Print A4</option>
            </select>
          </div>

          <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 12 }}>
            <div className="sidebarSectionTitle">Background Color</div>
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => onChangeBackgroundColor(e.target.value)}
              className="sidebarColorInput"
            />
          </div>

          <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
            <label className="checkboxRow">
              <input type="checkbox" checked={showGrid} onChange={(e) => onToggleGrid(e.target.checked)} />
              Show gridlines
            </label>
            <label className="checkboxRow">
              <input type="checkbox" checked={snapToGrid} onChange={(e) => onToggleSnap(e.target.checked)} />
              Snap text to gridlines
            </label>
          </div>
        </div>

        <p style={{ fontSize: 12, color: "#6b7280", margin: "0 4px 8px" }}>
          Use the controls and keyboard to build your composition.
        </p>
      </div>
    </div>
  );
};

export default Sidebar;
