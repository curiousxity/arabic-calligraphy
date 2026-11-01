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
        and short single words such as «محمد» usually show "Too long" or "Too
        short" at every size for now.
      </p>

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
