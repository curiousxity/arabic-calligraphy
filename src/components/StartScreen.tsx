import { useDeferredValue, useRef, useState } from "react";
import { ArabicKeyboard } from "./sidebar/ArabicKeyboard";
import { KeyboardIcon } from "./Icons";
import { FontGallery } from "./FontGallery";
import { startingText, STARTER_TEXT } from "../lib/startScreen";
import { visibleFonts, type FontChoice } from "../lib/fontCatalog";

export type StartScreenProps = {
  fonts: FontChoice[];
  onPick: (text: string, fontFamily: string) => void;
  onSkip: () => void;
};

/**
 * The front door: type a word, see it in every face, pick one, start editing.
 * A fixed overlay above the mounted editor rather than a replacement for it,
 * so App.tsx's hydration and fit-to-view effects run exactly as before.
 */
export const StartScreen: React.FC<StartScreenProps> = ({ fonts, onPick, onSkip }) => {
  const [text, setText] = useState(STARTER_TEXT);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // On-screen keys edit at the field's caret (or replace its selection), then
  // put the caret back after what they typed, as a real keyboard would.
  const edit = (change: (before: string, after: string) => [string, string]) => {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const [before, after] = change(text.slice(0, start), text.slice(end));
    setText(before + after);
    requestAnimationFrame(() => {
      el?.focus({ preventScroll: true });
      el?.setSelectionRange(before.length, before.length);
    });
  };
  // The field answers every keystroke at once; the twenty-odd previews,
  // each a native shaping pass, catch up a beat behind.
  const galleryText = useDeferredValue(startingText(text));
  return (
    // Keys pressed inside the overlay stay inside it: the editor's window
    // listeners (CanvasStage's Space-to-pan calls preventDefault) would
    // otherwise swallow Space before it can activate a card or Skip.
    <div
      className="startScreen"
      data-testid="start-screen"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a font to begin"
      onKeyDown={(e) => e.stopPropagation()}
    >
      <header className="startScreenHeader">
        <div>
          <h1 className="startScreenTitle">HarfCanvas</h1>
          <p className="startScreenSubtitle">Type a word. Choose how it should be written.</p>
        </div>
        <input
          ref={inputRef}
          className="startScreenInput"
          aria-label="Your text"
          dir="rtl"
          lang="ar"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className={showKeyboard ? "startScreenKeyboardBtn startScreenKeyboardBtn--on" : "startScreenKeyboardBtn"}
          onClick={() => setShowKeyboard((v) => !v)}
          aria-pressed={showKeyboard}
          aria-label="Arabic keyboard"
          title="Show an on-screen Arabic keyboard, for typing without an Arabic layout"
        >
          <KeyboardIcon size={22} />
        </button>
        <button type="button" className="startScreenSkip" onClick={onSkip}>Skip</button>
      </header>
      {showKeyboard && (
        <div className="startScreenKeyboard">
          <ArabicKeyboard
            onInsert={(v) => edit((b, a) => [b + v, a])}
            onBackspace={() =>
              edit((b, a) =>
                // With a selection, the field already holds before/after
                // around it, so Backspace only drops the selection.
                (inputRef.current?.selectionStart ?? 0) !== (inputRef.current?.selectionEnd ?? 0)
                  ? [b, a]
                  : [Array.from(b).slice(0, -1).join(""), a]
              )
            }
          />
        </div>
      )}
      <FontGallery
        text={galleryText}
        fonts={visibleFonts(fonts)}
        onPick={(font) => onPick(startingText(text), font)}
        autoFocus={false}
        testId="start-gallery"
      />
    </div>
  );
};
