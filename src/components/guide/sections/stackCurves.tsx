import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "stack-curves",
  title: "Bending a curve",
  order: 40,
  keywords: ["curve", "bowl", "radius", "bend", "widen", "round", "stacked", "stack", "join", "double-click", "bigger", "larger", "grow", "scale", "size", "shift"],
  Body: () => (
    <>
      <p>
        In a stacked composition, the round strokes of a letter — the bowl of a
        nun, the hook of a hah, the sweep of a ra — can be bent. Hover the
        letter and the top of each curve is outlined. Press there and drag:
        the curve is freed and follows your hand, opening wider or closing
        tighter, keeping the pen's weight as it goes.
      </p>
      <p>
        Once freed, the curve behaves like the joins between letters: drag it
        again to bend it further, and <strong>double-click</strong> it to put
        it back exactly as the font drew it. Undo also restores the letter.
      </p>
      <p>
        To make a curve <strong>bigger or smaller</strong>, hold{" "}
        <strong>Shift</strong> and drag it. One end stays where it is and the
        tail slides outward, so the whole curve grows like a larger copy of
        itself — same shape, same pen weight, wider radius. Drag back toward
        the fixed end to tighten it. On a curve between two letters, the later
        letter moves (with the letters after it, if "Move letters together" is
        on). Undo puts it back.
      </p>
      <p>
        Not every curve is offered. A stroke that runs into another, or whose
        weight changes sharply along the turn, is left alone — the tool only
        bends what it can redraw faithfully.
      </p>
    </>
  ),
};
