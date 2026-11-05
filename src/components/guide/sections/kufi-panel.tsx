import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "kufi-panel",
  title: "Square Kufi panel",
  order: 41,
  keywords: [
    "kufi",
    "square kufi",
    "kufic",
    "panel",
    "grid",
    "squares",
    "cells",
    "box",
    "fit",
    "laser",
    "laser cutting",
    "cut",
    "acrylic",
    "dots",
    "ijam",
    "stretch",
    "letter forms",
    "alternates",
    "tools",
    "move word",
    "paint",
    "centre",
    "centre word",
    "spiral",
    "start",
    "كوفي",
    "كوفي مربع",
    "إعجام",
  ],
  Body: () => (
    <>
      <p>
        A <strong>Kufi panel</strong> writes your text in square Kufi: every
        stroke and every gap is one square wide, and the words run round the
        frame of a box, clockwise from the bottom right, then in to the middle.
        It is drawn as one solid shape, so it is ready to cut.
      </p>

      <h4>Adding a panel</h4>
      <p>
        Press <strong>Add Kufi panel</strong> in Block Controls and click on the
        canvas. A new panel starts with the word «الله» and finds its own size.
        Type your text in <strong>Content</strong>; dots are drawn for you and
        any vowel marks you type are left out.
      </p>

      <h4>Size, and Fit</h4>
      <p>
        <strong>Width</strong> and <strong>Height</strong> in the Kufi panel
        section count squares. The text has to fill the box exactly, with no
        holes, so only some sizes work for a given text. <strong>Fit</strong>{" "}
        tries sizes near your text's own and gives you the first box it
        fills, which is not always the smallest; it can take several
        seconds for a long text. Some texts need a box that is not square, and
        Fit and the suggested sizes offer those too. A panel may be closed by a
        short straight bar along a line, where the letters leave a small gap. If you would rather choose, the size fields
        take any number from 3 up, and the line under them suggests sizes to
        try. While Fit is working the panel says <em>Finding a size…</em> and
        the Fit buttons wait for it. Changing the size changes the whole
        arrangement, so set it before you fine-tune.
      </p>

      <h4>The status line</h4>
      <p>It sits under the size fields and says what to do next:</p>
      <ul>
        <li>
          <strong>Arranging…</strong> The panel is still being worked out. You
          can keep working; it appears when ready.
        </li>
        <li>
          <strong>Too long for the box / Too short to fill a box.</strong> The
          text will not fill that size. The box stays on the canvas as a dashed
          frame with this message in it; with the panel selected, press one of
          the suggested sizes, or Fit, right there on the canvas. The frame is
          only a guide and is not exported.
        </li>
        <li>
          <strong>A pinned edit can't stay where it is at this size.</strong>{" "}
          A letter you stretched, swapped or moved is held at a place the new
          size does not have. Press <strong>Release hand edits</strong> beside
          it: the letters are free to find new places, and your stroke lengths
          and letter shapes are kept. (Undo works too, but takes back everything
          since.) The button is there whenever a panel has hand-placed letters.
        </li>
        <li>
          <strong>Painted cells leave a gap.</strong> Squares you painted by
          hand have left a hole or a solid block somewhere. The panel still
          shows; paint or undo to fix it.
        </li>
        <li>
          Other lines tell you which letters were not drawn, and whether the
          outline will cut as a second line.
        </li>
      </ul>
      <p>
        Several short words work well, such as «سبحان الله», «الله أكبر» and
        «قل هو الله أحد», and so does «لا يكلف الله نفسا إلا وسعها». The Shahada
        fills a box only with «الله» in the centre (below); short single words
        such as «محمد» usually show "Too long" or "Too short" at every size
        for now.
      </p>

      <h4>A word in the centre</h4>
      <p>
        The old spiral panels run their words round the frame and end with
        the last word alone in the middle. <strong>Centre word</strong> in the
        Kufi panel section does that: set it to <em>Last word</em> and the
        text's last word takes the core, upright or turned on its side,
        whichever fills it better, with the other words packed round it. Fit
        tries this by itself when nothing else fits, and then also starts the
        words at the top right, running down the right side first, as the
        Cairo panels do; <strong>Start</strong> lets you choose the corner
        either way. Switching the centre on or off lets every letter find a
        new place, so hand-placed letters are released (their shapes and
        stroke lengths are kept). The letters in the middle are the panel's
        own: they take no stretching, moving or painting. In these bands the
        word «محمد» takes the tall forms of the old Cairo panels, with the ح
        drawn as a hook embracing the letters after it, so the Shahada fills a
        box this way: shown here at 24×19, started at the top right, with
        «الله» in the middle. A longer text whose words all stand on tall
        strokes, such as «لا إله إلا الله» written twice, fills one too.
      </p>
      <svg
        viewBox="0 0 24 19"
        role="img"
        aria-label="A 24 by 19 square-Kufi panel: the Shahada round the frame, begun at the top right, with الله alone in the middle"
        style={{ display: "block", width: "100%", maxWidth: 288, margin: "8px auto 12px" }}
      >
        <path fill="currentColor" d="M0 0h3v1h-3zM4 0h9v1h-9zM14 0h3v1h-3zM18 0h6v1h-6zM0 1h1v1h-1zM4 1h1v1h-1zM6 1h1v1h-1zM8 1h1v1h-1zM10 1h1v1h-1zM14 1h1v1h-1zM21 1h1v1h-1zM23 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1zM4 2h1v1h-1zM6 2h1v1h-1zM8 2h1v1h-1zM10 2h3v1h-3zM14 2h1v1h-1zM16 2h1v1h-1zM18 2h6v1h-6zM10 3h1v1h-1zM12 3h1v1h-1zM14 3h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM4 4h1v1h-1zM6 4h7v1h-7zM14 4h1v1h-1zM16 4h8v1h-8zM0 5h1v1h-1zM2 5h1v1h-1zM4 5h1v1h-1zM0 6h3v1h-3zM4 6h1v1h-1zM6 6h12v1h-12zM19 6h5v1h-5zM0 7h1v1h-1zM4 7h1v1h-1zM13 7h1v1h-1zM15 7h1v1h-1zM17 7h1v1h-1zM23 7h1v1h-1zM0 8h3v1h-3zM4 8h1v1h-1zM6 8h6v1h-6zM13 8h1v1h-1zM15 8h1v1h-1zM17 8h1v1h-1zM19 8h5v1h-5zM0 9h1v1h-1zM2 9h1v1h-1zM4 9h1v1h-1zM11 9h1v1h-1zM13 9h1v1h-1zM15 9h1v1h-1zM17 9h1v1h-1zM19 9h1v1h-1zM21 9h1v1h-1zM23 9h1v1h-1zM0 10h3v1h-3zM4 10h1v1h-1zM6 10h6v1h-6zM13 10h1v1h-1zM15 10h1v1h-1zM17 10h1v1h-1zM19 10h1v1h-1zM21 10h1v1h-1zM23 10h1v1h-1zM0 11h1v1h-1zM2 11h1v1h-1zM4 11h1v1h-1zM6 11h1v1h-1zM11 11h1v1h-1zM13 11h1v1h-1zM15 11h1v1h-1zM17 11h1v1h-1zM19 11h1v1h-1zM21 11h1v1h-1zM23 11h1v1h-1zM0 12h1v1h-1zM2 12h1v1h-1zM4 12h1v1h-1zM6 12h12v1h-12zM19 12h1v1h-1zM21 12h3v1h-3zM0 13h1v1h-1zM4 13h1v1h-1zM0 14h5v1h-5zM6 14h3v1h-3zM10 14h1v1h-1zM12 14h1v1h-1zM14 14h1v1h-1zM16 14h8v1h-8zM0 15h1v1h-1zM8 15h1v1h-1zM10 15h1v1h-1zM12 15h1v1h-1zM0 16h1v1h-1zM2 16h3v1h-3zM6 16h3v1h-3zM10 16h1v1h-1zM12 16h1v1h-1zM14 16h1v1h-1zM16 16h4v1h-4zM21 16h3v1h-3zM0 17h3v1h-3zM4 17h1v1h-1zM6 17h1v1h-1zM8 17h1v1h-1zM10 17h1v1h-1zM12 17h1v1h-1zM14 17h1v1h-1zM19 17h3v1h-3zM23 17h1v1h-1zM0 18h1v1h-1zM2 18h3v1h-3zM6 18h7v1h-7zM14 18h1v1h-1zM16 18h4v1h-4zM21 18h3v1h-3z" />
      </svg>

      <h4>Editing on the canvas</h4>
      <p>
        Select the panel. At the top of the Kufi panel section is a row of four
        tools: <strong>Select</strong>, <strong>Stretch</strong>,{" "}
        <strong>Move word</strong> and <strong>Paint</strong>. The one picked
        is highlighted, and it decides what the canvas shows and what a click
        or drag does. Every edit is one undo step, and the rest of the panel
        re-arranges around it. If an edit cannot work, it snaps back and a
        short message appears beside the letter for a moment, saying why.
        Selecting another block puts the tools back to Select.
      </p>
      <ul>
        <li>
          <strong>Select</strong> (where you start). The letter under the
          pointer is outlined. Click a letter (press and release without
          moving) to pick it: its forms show in the sidebar and nothing
          changes. Click the picked letter again to change it to its next
          form; forms that do not fit are skipped, and a letter with a single
          form says so. Dragging a letter moves the whole panel.
        </li>
        <li>
          <strong>Stretch.</strong> Move over a letter and every stroke end of
          it that can grow or shrink shows a square, a whole cell in size; the
          one under the pointer is solid. Drag a square along its stroke to make
          the stroke longer or shorter, a square at a time. A stroke with no
          free end shows the square on the stroke itself. Once the panel has
          been checked (see <em>Other arrangements</em> below), squares show
          only on strokes that have a length that fits, faint squares mark
          those lengths while you drag, and a drag of a square or two jumps to
          the nearest length that fits. Clicking a letter here
          picks it without changing its form.
        </li>
        <li>
          <strong>Move word.</strong> Every word shows a small square on the
          corner where it begins. Drag it along the word's line to slide the
          word, two squares at a time. Other letters may shift to make room;
          while you drag, each one that shifts is outlined. On a tight panel
          there is often no room, so the word snaps back. Clicking a letter
          here picks it without changing its form.
        </li>
        <li>
          <strong>Paint.</strong> The square under the pointer is outlined.
          Click a square to fill it or clear it, or drag to paint several:
          every square along the way is painted, however fast you move. A
          square that would make a solid 2×2 block flashes red and is refused.
          Use this last, because hand-painted squares are not rearranged when
          you change anything else. Holding <strong>Alt</strong> paints the
          same way from any tool. Touch screens cannot paint.
        </li>
        <li>
          <strong>See a letter's forms.</strong> The letter you click is also
          shown in the Kufi panel section under <strong>Letter forms</strong>:
          every form of it, the one drawn now highlighted. Forms that fit here
          can be clicked to use them; the others are greyed out and say{" "}
          <em>Doesn't fit here</em>. Forms still being tried say{" "}
          <em>Checking…</em>; a form the check never reached says{" "}
          <em>Not checked</em>, and clicking the letter on the canvas skips it
          too. Clicking the empty part of the panel clears it.
        </li>
      </ul>
      <p>
        Letters you have stretched, swapped or moved stay where you put them
        when you change other things; <strong>Release hand edits</strong> in
        the Kufi panel section lets them move again. If you change the text,
        your edits follow their letters.
      </p>
      <p>
        You can type or paste the ligature characters «ﷲ» and «ﻻ» (and the
        other joined lam-alef characters): they are read as the letters they
        stand for.
      </p>

      <h4>Other arrangements</h4>
      <p>
        Under the status line, the <strong>Arrangements</strong> strip shows
        small pictures of other ways this text can fill the same box, each one
        change away from what you have: another form of one letter, or one
        stroke a square longer or shorter. The first picture is your current
        panel. Hover a picture to outline the squares that differ, and click it
        to use it; one undo brings the old panel back. It says{" "}
        <em>Looking…</em> while it searches, and{" "}
        <em>No other arrangement fits this box</em> when there is nothing to
        offer, which is common on a tight panel.
      </p>

      <h4>Dots belong to their letters</h4>
      <p>
        Dots are part of the letter, never decoration. A letter takes all of its
        dots, on the side where they belong (two below for ي, one above for ن,
        and so on), or none. A whole set of dots may sit one square along from
        the usual place, as in classical panels, but never split up. A single
        lone square may sometimes appear to fill a gap; it is never placed
        where it could be read as a dot.
      </p>

      <h4>Laser cutting and export</h4>
      <p>
        Export as PNG, JPEG, SVG or PDF as usual. The panel is exported as a
        single outline rather than a grid of squares. For laser cutting, keep
        the <strong>outline width at 0</strong> (a new panel starts that way):
        the file then has one path to cut. Any outline width above 0 adds a
        second path round the panel, which a cutter reads as a second cut.
      </p>
    </>
  ),
};
