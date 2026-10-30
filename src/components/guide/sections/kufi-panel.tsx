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
        looks for the smallest square box your text fills; it can take several
        seconds for a long text. If you would rather choose, the size fields
        take any number from 3 up, and the line under them suggests sizes to
        try. Changing the size changes the whole arrangement, so set it before
        you fine-tune.
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
          text will not fill that size. Press one of the suggested sizes, or
          Fit.
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
          Other lines tell you why the last edit changed nothing, which letters
          were not drawn, and whether the outline will cut as a second line.
        </li>
      </ul>
      <p>
        Many texts will not fill any box. Texts of several short words with
        tall letters, such as the verse «لا يكلف الله نفسا إلا وسعها», work
        well; others, such as the Shahada, usually show "Too long" or "Too
        short" at every size for now.
      </p>

      <h4>Editing on the canvas</h4>
      <p>
        Select the panel and move over it. There are no modes: the letter under
        the pointer is outlined, and you simply act on it. Every edit is one
        undo step, and the rest of the panel re-arranges around it. If an edit
        cannot work, the stroke snaps back and the status line says why.
      </p>
      <ul>
        <li>
          <strong>Stretch.</strong> A small square appears on the end of a
          stroke that can grow. Drag it along the stroke to make it longer or
          shorter, a square at a time. A stroke with no free end shows the
          square on the stroke itself.
        </li>
        <li>
          <strong>Swap a letter's shape.</strong> Click a letter (press and
          release without moving) to change it to its next form. Forms that do
          not fit are skipped. A letter with a single form says so.
        </li>
        <li>
          <strong>Move a word.</strong> A word's first letter has a second
          small square, on the corner where the word begins. Drag it along the
          word's line to slide the word. On a tight panel there is often no
          room, so the word snaps back; nothing else moves to make space.
          Pressing the letter anywhere else moves the whole panel, or clicks
          it.
        </li>
        <li>
          <strong>Paint a square.</strong> Hold <strong>Alt</strong> and click a
          square to fill it or clear it, or drag to paint several: every square
          along the way is painted, however fast you move. A square that would
          make a solid 2×2 block flashes red and is refused. Use this last,
          because hand-painted squares are not rearranged when you change
          anything else. It needs a mouse or a trackpad with a keyboard; touch
          screens cannot paint.
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
