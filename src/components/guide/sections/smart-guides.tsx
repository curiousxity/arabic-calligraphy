import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "smart-guides",
  title: "Aligning blocks",
  order: 40,
  keywords: [
    "snap",
    "align",
    "alignment",
    "guide",
    "guides",
    "edge",
    "edges",
    "ruler",
    "rulers",
    "grid",
    "gridlines",
    "distribute",
    "spacing",
  ],
  Body: () => (
    <>
      <p>
        Drag a block near another one and it settles into alignment on its own.
        A magenta dashed line appears for as long as the two are aligned and
        disappears the moment you let go — nothing is drawn on your finished
        piece, and nothing stays selected-looking afterwards.
      </p>

      <h3>What a block snaps to</h3>
      <p>
        Alignment follows what you can actually see: the left, right, top and
        bottom of a block's ink, and its middle in both directions. So you can
        set one line of text flush against the edge of a photograph, centre a
        title over an ornament, or rest two blocks on a shared baseline —
        including when one is centred and the other is not, which used to
        refuse to line up because the two were being measured from their
        anchor points rather than their visible extents.
      </p>
      <p>
        The edges of the sheet itself count too, so a block can be pulled flush
        to the artboard or centred on it.
      </p>
      <p>
        The magenta line runs only between the two blocks it concerns, which
        tells you at a glance which pair it has matched — useful on a crowded
        canvas where several blocks share a column.
      </p>

      <h3>Even spacing</h3>
      <p>
        Drag a block into the space between two others and, once the gap on
        each side is the same, a small bar appears in both gaps to tell you so.
        These are a reading, not a magnet — nothing is pulled into place by
        them, so you can settle a piece by eye and use them only as
        confirmation.
      </p>

      <h3>Your own guides</h3>
      <p>
        Turn on <strong>Show rulers</strong> in Background &amp; Grid, then
        click a ruler to drop a guide of your own. Drag a guide to move it, and
        double-click it to remove it. Guides you placed deliberately take
        priority: when a guide and a nearby block edge are equally close, the
        block goes to your guide. The <strong>Clear guides</strong> button
        removes them all at once.
      </p>

      <h3>The grid</h3>
      <p>
        <strong>Show gridlines</strong> draws the grid for reference only.{" "}
        <strong>Snap to gridlines</strong> is separate: it rounds a block onto
        the nearest grid intersection when you release it, which is what you
        want for a strict geometric layout and what you do not want for
        free composition. The grid never appears in an exported image.
      </p>

      <h3>Switching it off</h3>
      <p>
        For placement by eye — where a hair's difference is the point —
        untick <strong>Snap to block edges</strong> in Background &amp; Grid.
        Your own ruler guides still hold, and the grid still behaves as its own
        tickbox says, but blocks stop reaching for each other's edges. The
        setting lasts for the session and starts on again next time.
      </p>
    </>
  ),
};
