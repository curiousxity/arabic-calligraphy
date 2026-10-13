import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "verse",
  title: "Setting verse and poetry",
  order: 34,
  keywords: [
    "verse",
    "poem",
    "poetry",
    "شعر",
    "بيت",
    "bayt",
    "beyt",
    "couplet",
    "misra",
    "مصراع",
    "lines",
    "multi-line",
    "justify",
    "justified",
    "width",
  ],
  Body: () => (
    <>
      <p>
        Poetry wants every line set to the same width, the way a scribe
        stretches a short line until its ends line up with its neighbours. Open{" "}
        <strong>New verse…</strong> in <strong>Block Controls</strong>, type
        the poem one line per line, and choose a layout:
      </p>
      <ul>
        <li>
          <strong>Stacked</strong> — one line under another.
        </li>
        <li>
          <strong>Bayt</strong> — two half-lines side by side, the first on
          the right, couplets stacked below one another.
        </li>
      </ul>

      <h4>How a line is made to fit</h4>
      <p>
        Every line is brought to the width of the longest one. A short line is
        stretched with kashida first, spread across its joins. If kashida alone
        can't reach, the rest is shared out as space between the word's pieces
        and between words. A line is never pushed past the width; the panel
        tells you if one couldn't quite reach it.
      </p>
      <p>
        Each line stays an ordinary text block, so you can still change its
        letter shapes, diacritics and strokes one by one. The lines move
        together when you drag one.
      </p>

      <h4>The Verse panel</h4>
      <p>
        Select any line to see the <strong>Verse</strong> panel under Content.
        Switch between stacked and bayt, or type a <strong>Verse width</strong>{" "}
        to set the lines to a width of your own. Leave it empty to match the
        longest line. A line too long for the width you type is made smaller to
        fit, and grows back if you widen it again. <strong>Line gap</strong>{" "}
        and <strong>Column gap</strong> are measured in multiples of the text
        size.
      </p>
      <p>
        After you edit a line's words, press <strong>Justify</strong> to set
        the verse again. It doesn't happen while you type, so kashida never
        appears in the middle of a word you're still writing. Every change in
        this panel is a single undo.
      </p>
    </>
  ),
};
