import { useState } from "react";
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
  return (
    <div className="startScreen" data-testid="start-screen" role="dialog" aria-modal="true" aria-label="Choose a font to begin">
      <header className="startScreenHeader">
        <div>
          <h1 className="startScreenTitle">HarfCanvas</h1>
          <p className="startScreenSubtitle">Type a word. Choose how it should be written.</p>
        </div>
        <input
          className="startScreenInput"
          aria-label="Your text"
          dir="rtl"
          lang="ar"
          value={text}
          autoFocus
          onChange={(e) => setText(e.target.value)}
        />
        <button type="button" className="startScreenSkip" onClick={onSkip}>Skip</button>
      </header>
      <FontGallery
        text={startingText(text)}
        fonts={visibleFonts(fonts)}
        onPick={(font) => onPick(startingText(text), font)}
        autoFocus={false}
        testId="start-gallery"
      />
    </div>
  );
};
