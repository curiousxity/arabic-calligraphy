import type { StackBlock } from "../../types";

/**
 * The Stack type panel: the baked spelling (read-only) and the way into the
 * editor window, where every stack control and gesture lives
 * (StackEditorDialog). Double-clicking the composition on the canvas opens
 * the same window.
 */
export const StackPanel: React.FC<{
  block: StackBlock;
  onEdit: () => void;
}> = ({ block, onEdit }) => (
  <div className="sectionPanel">
    <p className="guideEmpty" dir="rtl">{block.source.text}</p>
    <p className="guideEmpty">
      {block.tarkib ? "Composed from the Thuluth pen pieces." : `Baked from ${block.source.fontFamily}.`} The
      spelling cannot be edited here — undo the conversion, or convert a fresh text block.
    </p>
    <p className="guideEmpty">
      Move, tilt, bend and arrange the letters in the editor window. Double-click the
      composition on the canvas, or press the button below.
    </p>
    {/* A locked block cannot be edited (the canvas double-click refuses too). */}
    <button type="button" className="sidebarSmallAction" aria-label="Edit composition" disabled={block.locked} onClick={onEdit}>
      Edit composition
    </button>
  </div>
);
