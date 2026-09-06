import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "glyph-editing",
  title: "Shaping individual letters",
  order: 70,
  keywords: [
    "glyph",
    "letter",
    "letterform",
    "move",
    "scale",
    "stretch",
    "rotate",
    "rotation",
    "turn",
    "tilt",
    "angle",
    "overlap",
    "diacritic",
    "tashkeel",
    "harakat",
    "marks",
    "hide mark",
  ],
  Body: () => (
    <>
      <p>
        Two tools work on a single letter rather than the block as a whole:
        one moves, scales and turns a letter, the other adjusts a mark sitting
        above or below it. Both live on the canvas — you hover the letter and
        small handles appear.
      </p>

      <h4>Move, scale &amp; turn a letter</h4>
      <p>
        On a plain text block, open <strong>Typography</strong> and tick{" "}
        <strong>Move, scale &amp; rotate glyph</strong>, then hover a letter.
        Four dots appear: one moves the letter bodily, one stretches it
        sideways, one stretches it vertically, and one — set out past the
        letter's upper corner — turns it. A letter turns about its own centre,
        so it stays where you put it. Its neighbours never shift to make room,
        so you can overlap letters deliberately — which is exactly what a
        calligrapher wants and a word processor refuses.{" "}
        <strong>Reset glyph moves, scales &amp; turns</strong> undoes all of them for
        the block.
      </p>
      <p>
        A letter stretched more in one direction than the other is stretched
        along the block's own axes, not along the letter's, so turning such a
        letter shears it a little. At equal stretch — which is nearly always —
        there is no difference.
      </p>
      <p>
        A moved, stretched or turned letter does not change the width the
        block reports, so a letter pushed outward can overhang the page margin
        and <strong>Fit to width</strong> will not count it. Fit the line
        first, then shape the letters.
      </p>
      <h4>On a Shape Fill block</h4>
      <p>
        The same tick-box works on a Shape Fill block, with one difference
        worth knowing before you reach for it. A Shape Fill tiles your words
        across the silhouette, so the same letter is drawn over and over —
        and an adjustment belongs to the <em>letter</em>, not to the copy you
        happened to grab. Move or turn one and{" "}
        <strong>every repetition of that letter changes with it</strong>. The
        handles appear on a single designated tile near the middle of the
        shape, which may not be the one you were looking at.
      </p>
      <p>
        While the tick-box is on, the shape itself cannot be dragged — the
        handles have the canvas. Untick it to move the block again.
      </p>
      <p>
        Curve blocks are the exception: once a letter is rotated to follow a
        curve, the dots do not appear.
      </p>

      <h4>Adjusting marks</h4>
      <p>
        Hover a diacritic on a selected block and three small handles appear:
        drag one to move the mark up or down, drag another to resize it, and
        click the third to hide that one mark. These only change how the mark
        is <em>drawn</em> — the character stays in your text, which is why{" "}
        <strong>Reset diacritic overrides</strong> can always put things back.
        Hiding a mark does not reflow the letters around it.
      </p>
      <p>
        On a Shape Fill block the marks are behind a <strong>Diacritic tool</strong>{" "}
        tick-box, because a tiled shape can contain hundreds of copies of the
        same mark and showing handles on all of them would bury the artwork.
        For the same reason, adjusting a mark there adjusts{" "}
        <strong>every tiled repetition of it</strong> at once — the adjustment
        belongs to the letter, not to the copy.
      </p>
      <p>
        Letters on a curve cannot be adjusted this way: once a letter is
        rotated to follow a curve, neither tool applies to it.
      </p>

      <h4>One thing to know before you start</h4>
      <p>
        These adjustments are attached to a letter's position in the text. If
        you go back and edit wording <em>before</em> a letter you have
        hand-adjusted, the adjustment can land on a neighbouring letter
        instead. Settle the wording first, then fine-tune. Everything here is
        undoable if it does go astray.
      </p>
    </>
  ),
};
