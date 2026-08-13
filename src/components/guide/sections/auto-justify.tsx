import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "auto-justify",
  title: "Stretching text to fit",
  order: 60,
  keywords: [
    "kashida",
    "tatweel",
    "justify",
    "stretch",
    "elongate",
    "fit",
    "width",
    "match",
    "margin",
  ],
  Body: () => (
    <>
      <p>
        In Arabic calligraphy a line is not fitted to a measure by spacing the words
        further apart — it is fitted by <em>elongating the letters themselves</em>. The
        connecting stroke between two joined letters is drawn longer, a body is drawn
        wider, and the line grows to fill its space without ever looking stretched. That
        elongation is the kashida.
      </p>

      <p>
        The app knows where each letter can honestly be elongated, and by how much,
        because every letterform carries its own description of its strokes: which are
        eligible for kashida, how far each may safely be drawn out, and which matter most
        when a line needs the extra length. A stroke that would distort if pulled is
        simply never pulled.
      </p>

      <h3>The Kashida dial</h3>
      <p>
        The Morph Glyph Editor's <strong>Kashida</strong> slider runs from 0 to 100 and
        spreads that one movement across every eligible stroke in the block at once.
        Strokes that carry more of the line's weight lengthen first and furthest; the
        smaller ones follow more gently. At 0 the letters sit exactly as the font drew
        them.
      </p>
      <p>
        Each stroke it moves still lands on a half-nuqta step, the same as when
        you stretch one by hand, so a line loosened by the dial keeps whole-unit
        proportions. If you would rather it moved freely, untick{" "}
        <strong>Snap strokes to nuqta</strong> in Background &amp; Grid.
      </p>

      <h3>Fitting to a width instead</h3>
      <p>
        Dialling by eye works, but it is guesswork when you have a width in mind. Under{" "}
        <strong>Typography → Fit width</strong>, two buttons name the width for you and
        let the app find the dial position that reaches it:
      </p>
      <ul>
        <li>
          <strong>Fit to composition</strong> — stretches the selected block to span
          everything else on the canvas, less the margin you set beside the buttons. The
          block being stretched is left out of that measurement, so the target does not
          run away from you as the block grows.
        </li>
        <li>
          <strong>Match block</strong> — select exactly two blocks and this stretches the
          one you are editing to the width of the other. Useful for stacking lines of a
          composition into an even column.
        </li>
      </ul>
      <p>
        Either way the result lands on the same Kashida dial, so you can nudge it
        afterwards, and Undo puts it back.
      </p>

      <h3>When a line runs out of stretch</h3>
      <p>
        A line cannot always reach the width you ask for. Every stroke has a limit past
        which the letterform would no longer be correct, and once all of them are at their
        limit the line is as long as it can honestly be. The app applies that maximum and
        tells you plainly how far it got — <em>Reached maximum stretch at 640px of
        812px</em> — rather than quietly doing nothing.
      </p>
      <p>
        If nothing moves at all, the block has no elongatable strokes yet. Add one from
        the Morph Glyph Editor: click a letter, and any stroke its letterform offers for
        kashida appears there.
      </p>

      <p>
        This is a deliberate, per-block action — you choose the line and the width. The
        app does not re-justify text as you type.
      </p>
    </>
  ),
};
