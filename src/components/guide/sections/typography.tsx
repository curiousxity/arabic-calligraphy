import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "typography",
  title: "Type and text",
  order: 30,
  keywords: [
    "font",
    "typeface",
    "size",
    "colour",
    "color",
    "alignment",
    "align",
    "line height",
    "leading",
    "opacity",
    "keyboard",
    "presets",
    "urdu",
    "farsi",
    "persian",
    "diacritic",
    "tashkeel",
    "harakat",
    "marks",
    "irab",
    "kashida",
    "warp",
    "outline",
    "shadow",
    "rotation",
  ],
  Body: () => (
    <>
      <h4>Content</h4>
      <p>
        Everything that puts characters into a block lives in one place. The
        right-to-left field at the top is the text itself. Below it,{" "}
        <strong>Arabic Keyboard</strong> opens a floating keyboard for typing
        without an Arabic layout, and four rows of buttons insert characters at
        the cursor:
      </p>
      <ul>
        <li>
          <strong>إِعْرَاب</strong> — the vowel marks and other tashkeel.
        </li>
        <li>
          <strong>Presets</strong> — honorific symbols such as ﷺ. These are
          built into every font here, so they render whichever typeface you
          have chosen.
        </li>
        <li>
          <strong>Specials</strong> — punctuation and ornaments.
        </li>
        <li>
          <strong>Urdu-Farsi Characters</strong> — the letters those languages
          add to the Arabic alphabet.
        </li>
      </ul>
      <p>
        <strong>Clear diacritics</strong> is destructive: it deletes every mark
        character from the text for good. It is not the same as adjusting how a
        mark looks — for that, see the mark handles under the glyph editing
        page, which never change the text and can be reset with{" "}
        <strong>Reset diacritic overrides</strong>.
      </p>

      <h4>Typography</h4>
      <p>
        The shared styling panel, shown for every block that contains text.
      </p>
      <ul>
        <li>
          <strong>Font family</strong> — sixteen faces, from formal Thuluth and
          Naskh to Kufi and Ruqaa. The list previews each name in its own
          typeface, so browse it rather than reading it.
        </li>
        <li>
          <strong>Font size</strong> — hidden for curve blocks, where the
          length of the curve sets the size instead.
        </li>
        <li>
          <strong>Text colour</strong> and <strong>Opacity</strong>.
        </li>
        <li>
          <strong>Alignment</strong> and <strong>Line height</strong> — line
          height matters most once your text runs to several lines and the
          marks above one line start crowding the line above.
        </li>
        <li>
          <strong>Horizontal warp</strong> and <strong>Vertical warp</strong> —
          a gentle overall distortion of a plain text block, separate from the
          per-letter tools.
        </li>
        <li>
          <strong>Kashida tool</strong> — for plain text blocks. Tick it, then
          drag the gold handle that appears between two connected letters on
          the canvas to lengthen the connector between them (tatweel).
        </li>
      </ul>
      <p>
        Double-clicking any slider in the sidebar resets it to its default.
      </p>

      <h4>Transform and Effects</h4>
      <p>
        <strong>Transform</strong> holds rotation — the one control every block
        type shares. <strong>Effects</strong> holds the outline (colour and
        width) and the shadow (colour, blur, horizontal and vertical offset,
        and opacity), on two tabs.
      </p>
      <p>
        The outline is drawn <em>outside</em> the letters rather than over
        them, so raising its width never thickens the letterform itself or
        closes up the counters inside a loop. Widths read thinner than you may
        expect from other tools for that reason — the number is the outline you
        see, not a band straddling the edge.
      </p>
    </>
  ),
};
