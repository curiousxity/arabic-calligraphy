import { useEffect, useRef } from "react";
import { groupByGenre, SAMPLE_FALLBACK, type FontChoice } from "../lib/fontCatalog";

export type FontGalleryProps = {
  text: string;
  value?: string;
  fonts: FontChoice[];
  onPick: (value: string) => void;
  autoFocus?: boolean;
  testId?: string;
};

/**
 * The block's text written in every font, under genre headings. Previews are
 * CSS `@font-face`, not canvas: the browser shapes Arabic natively, so a
 * gallery of every style costs no HarfBuzz shaping. Shared by the picker
 * dialog, the start screen and the sidebar strip's full view.
 */
export const FontGallery: React.FC<FontGalleryProps> = ({
  text,
  value,
  fonts,
  onPick,
  autoFocus = true,
  testId = "font-picker",
}) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const sample = text.trim() || SAMPLE_FALLBACK;

  useEffect(() => {
    const active = activeRef.current;
    if (!active) return;
    active.scrollIntoView({ block: "center" });
    if (autoFocus) active.focus({ preventScroll: true });
  }, [autoFocus]);

  return (
    <div className="fontPickerBody" data-testid={testId}>
      {groupByGenre(fonts).map((group) => (
        // `--cards` lets the start screen size each genre from its card count
        // rather than from its content (see index.css, .startScreen).
        <section
          key={group.genre}
          aria-label={group.genre}
          style={{ "--cards": group.fonts.length } as React.CSSProperties}
        >
          <h3 className="fontPickerGenre">{group.genre}</h3>
          <div className="fontPickerGrid">
            {group.fonts.map((font) => {
              const active = font.value === value;
              return (
                <button
                  key={font.value}
                  ref={active ? activeRef : undefined}
                  type="button"
                  className={active ? "fontPickerCard fontPickerCard--active" : "fontPickerCard"}
                  data-font-key={font.value}
                  aria-pressed={active}
                  onClick={() => onPick(font.value)}
                >
                  <span className="fontPickerSample" style={{ fontFamily: font.cssFamily }} dir="rtl" lang="ar">
                    {sample}
                  </span>
                  <span className="fontPickerLabel">{font.label}</span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
