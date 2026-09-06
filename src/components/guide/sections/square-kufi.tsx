import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "square-kufi",
  title: "Square kufi",
  order: 27,
  keywords: [
    "square",
    "kufi",
    "kufic",
    "murabba",
    "مربع",
    "كوفي",
    "banna",
    "بنائي",
    "grid",
    "lattice",
    "maze",
    "panel",
    "geometric",
    "tile",
    "brick",
    "architectural",
    "logo",
    "paint",
    "cells",
    "hand edit",
    "pixel",
    "boustrophedon",
    "snake",
    "snaking",
    "return line",
    "upside down",
    "rotated",
    "ox",
    "composition",
  ],
  Body: () => (
    <>
      <p>
        Square kufi — <span dir="rtl">الكوفي المربع</span>, also called the
        builder's kufi — sets a phrase as a woven pattern of right angles. It is
        the hand you see worked into brick and tile on mosque walls, where the
        letters and the spaces between them read as one field.
      </p>
      <p>
        Add one with the grid button in <strong>Block Controls → Add</strong>,
        then type Arabic into <strong>Content</strong> exactly as you would for
        any other block.
      </p>

      <h4>It is a construction, not a font</h4>
      <p>
        Every stroke is one square wide, and every gap between two strokes is
        one square. That single rule is what square kufi <em>is</em>, so it is
        not adjustable — and it is why the <strong>Font family</strong> picker
        disappears for this kind of block. The letters are drawn on the grid
        rather than fetched from a typeface, so no font applies. Size and colour
        still work as usual.
      </p>

      <h4>Making a panel</h4>
      <p>
        A fresh block runs the text as one long line. Press{" "}
        <strong>Fit to square</strong> in the <strong>Square Kufi</strong> panel
        and it wraps to whichever width comes out closest to a square — the
        composition the style is named for. From there, drag{" "}
        <strong>Panel width</strong> to taste; it is measured in squares, and
        setting it back to zero returns the single line.
      </p>
      <p>
        <strong>Line gap</strong> and <strong>Word gap</strong> are the two
        breathing dials. Widening the word gap is often what turns a crowded
        panel into a readable one, because in this hand the empty squares carry
        as much of the design as the filled ones. If a word is wider than the
        panel it will be split across two lines and its join broken; widen the
        panel to close it back up.
      </p>

      <h4>Making the reading snake</h4>
      <p>
        Set <strong>Composition</strong> to <strong>Boustrophedon</strong> and
        the panel stops being stacked lines. The first line reads right to left
        as usual; the second is turned a half turn so it carries on from where
        the first stopped, and the stroke turns the corner into it. The third
        turns back again, and so on down the panel. The name is the Greek for
        “as the ox ploughs”, and the classic square-kufi panels that read this
        way are doing exactly that.
      </p>
      <p>
        <strong>A return line is upside down, and that is right.</strong> Turn
        the panel — or your head — and it reads normally. The alternative would
        be to flip each line in a mirror, and a mirrored Arabic letter is not
        that letter any more; it is a shape with its tooth on the wrong side and
        its joins running backwards. So the letters are turned, never reflected.
      </p>
      <p>
        Two columns down each edge are kept empty for the turning stroke to run
        in, which is why the panel gets a little wider the moment you switch. A
        block that is still on one line has nothing to turn into, so switching
        wraps it to a square first — one step, and one undo.
      </p>
      <p>
        One thing to expect: because a turned line's tails point upward, the
        white space between lines is a little wider under an upright line than
        under a turned one. That is what turning a line with descenders does,
        not a spacing fault. <strong>Line gap</strong> adjusts both together.
      </p>

      <h4>What it leaves out</h4>
      <p>
        No dots and no tashkeel. Square kufi has always left them off and relied
        on the reader knowing the phrase, which is part of why it reads as
        pattern first and text second. Anything that is not an Arabic letter —
        digits, Latin, punctuation — has no square form and is skipped; the
        panel tells you when it has skipped something.
      </p>
      <p>
        Some letters that differ only by their dots are therefore drawn
        identically: ب, ت and ث share one shape, as do ج, ح and خ. That is
        correct for the style, not a limitation of the tool.
      </p>

      <h4>Finishing a panel by hand</h4>
      <p>
        The grid the app builds is a starting point. Tick{" "}
        <strong>Paint cells</strong> in the <strong>Square Kufi</strong> panel
        and a lattice appears over the block: click a square to fill it, click a
        filled one to cut it away, and drag to do several at once. A whole drag
        is one step, so a single undo takes back the stroke rather than one
        square of it.
      </p>
      <p>
        This is how a panel is actually finished — closing an awkward gap,
        squaring off a corner, tying two lines together. Painted squares are
        allowed to break the one-square rule the alphabet keeps: that is your
        judgement, not the app's.
      </p>
      <p>
        While <strong>Paint cells</strong> is on, the block cannot be dragged —
        the lattice takes the pointer. Turn it off to move the panel.
      </p>
      <p>
        Each square you paint is remembered against the <em>letter</em> nearest
        it, not against a position on the grid, so it travels with that letter
        when you rewrap the panel or change the gaps. The consequence is that
        retyping the word a square was painted on lets it go — the panel says
        how many were dropped when that happens. Get the text the way you want
        it first, then paint.
      </p>

      <h4>Two things worth trying</h4>
      <p>
        Square kufi mirrors beautifully. Select the block and press{" "}
        <strong>Add mirror</strong> or <strong>Add medallion</strong> — the
        right angles fold into each other far more cleanly than a cursive hand
        does, which is why so many historic panels are built this way.
      </p>
      <p>
        And because the whole composition is one merged shape, an outline or a
        metallic gradient runs around and across the entire panel rather than
        letter by letter. Try <strong>Effects → Lapis &amp; gold</strong> with a
        thin outline.
      </p>
    </>
  ),
};

export default section;
