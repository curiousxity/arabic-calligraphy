import { useEffect, useRef } from "react";
import { CollapsibleSection } from "./FormControls";
import { FontPickerField } from "../FontPickerDialog";
import { FontUploadButton, type FontUploadButtonProps } from "../FontUploadDialog";
import { TrashIcon } from "../Icons";
import { SAMPLE_FALLBACK, visibleFonts, type FontChoice } from "../../lib/fontCatalog";
import type { CustomFont } from "../../lib/customFonts";

export type FontPanelProps = {
  /** `makeId("font-family", selectedId)` — the gallery trigger's id. */
  id: string;
  /** The selected block's text; each card previews it. */
  text: string;
  /** The selected block's `fontFamily`. */
  value: string;
  /** `fontChoicesWith(customFonts)`. */
  fonts: FontChoice[];
  missingFontKey: string | null;
  describeFontKey: (key: string) => string;
  customFonts: CustomFont[];
  onChange: (value: string) => void;
  onAddCustomFont: FontUploadButtonProps["onAdd"];
  onRemoveCustomFont?: (key: string) => void;
  isOpen: boolean;
  onToggle: () => void;
};

/**
 * The first panel of the selected tier: the block's text in every face, one
 * click to switch. CSS previews, same as the gallery. The full genre-grouped
 * view is one button further (FontPickerField), and font upload lives here
 * because it is the app's only surface for managing the browser's font store.
 */
export const FontPanel: React.FC<FontPanelProps> = (p) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const sample = p.text.trim() || SAMPLE_FALLBACK;
  // Centre the current face by scrolling the strip itself, horizontally only.
  // `scrollIntoView` would also scroll every scrollable ancestor, so a font
  // change made while the sidebar is scrolled down (a style applied from
  // Typography, an undo, selecting another block) would jump the sidebar.
  useEffect(() => {
    const strip = stripRef.current;
    const card = activeRef.current;
    if (!strip || !card) return;
    // Measured as rects so the arithmetic holds whatever the offsetParent is.
    const s = strip.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    strip.scrollLeft += c.left - s.left - (s.width - c.width) / 2;
  }, [p.value]);

  return (
    <div className="sidebarPanel">
      <CollapsibleSection title="Font" isOpen={p.isOpen} onToggle={p.onToggle}>
        <div className="sectionPanel">
          {p.missingFontKey && (
            <div className="fontMissingNotice" role="status">
              Font '{p.describeFontKey(p.missingFontKey)}' isn't available in this browser — using Noto Sans.
              Upload the font file to get it back, or pick another font below.
            </div>
          )}
          <div ref={stripRef} className="fontStrip" data-testid="font-strip" role="group" aria-label="Fonts">
            {visibleFonts(p.fonts, p.value).map((font) => {
              const active = font.value === p.value;
              return (
                <button
                  key={font.value}
                  ref={active ? activeRef : undefined}
                  type="button"
                  className={active ? "fontStripCard fontStripCard--active" : "fontStripCard"}
                  data-font-key={font.value}
                  aria-pressed={active}
                  aria-label={font.label}
                  title={font.label}
                  onClick={() => {
                    if (!active) p.onChange(font.value);
                  }}
                >
                  <span className="fontStripSample" style={{ fontFamily: font.cssFamily }} dir="rtl" lang="ar">
                    {sample}
                  </span>
                </button>
              );
            })}
          </div>
          <FontPickerField
            id={p.id}
            label="Font family"
            value={p.value}
            text={p.text}
            fonts={p.fonts}
            onChange={p.onChange}
          />
          <div className="customFontRow">
            <FontUploadButton onAdd={p.onAddCustomFont} />
            {p.customFonts.length > 0 && (
              <ul className="customFontList">
                {p.customFonts.map((f) => (
                  <li className="customFontItem" key={f.key} data-font-key={f.key}>
                    <span className="customFontName" style={{ fontFamily: `'${f.key}'` }}>
                      {f.label}
                    </span>
                    <button
                      type="button"
                      className="sidebarCircleButton"
                      aria-label={`Remove uploaded font ${f.label}`}
                      onClick={() => p.onRemoveCustomFont?.(f.key)}
                    >
                      <TrashIcon size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CollapsibleSection>
    </div>
  );
};
