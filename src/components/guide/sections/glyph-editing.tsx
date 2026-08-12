import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "glyph-editing",
  title: "Shaping individual letters",
  order: 70,
  keywords: [
    "glyph",
    "letter",
    "letterform",
    "morph",
    "stretch",
    "stroke",
    "kashida",
    "tatweel",
    "elongate",
    "move",
    "scale",
    "rig",
    "mask",
    "lasso",
    "band",
    "diacritic",
    "tashkeel",
    "harakat",
    "marks",
    "hide mark",
  ],
  Body: () => (
    <>
      <p>
        The <strong>Morph Glyph Editor</strong> is where a composition stops
        being typesetting and starts being calligraphy: it reshapes individual
        letters rather than the block as a whole. It appears as a panel beside
        the canvas whenever a text, Shape Fill, or Shape Warp block is
        selected, and tucks away to a tab you can click to bring it back. Its
        own <strong>?</strong> button opens a shorter reference of the same
        controls.
      </p>

      <h4>Stroke controls</h4>
      <p>
        Each letter is described by its anatomy — the body, an eye or loop, a
        tooth, a tail, a dot — and each of those strokes can be lengthened or
        shortened within a range the letterform can actually take.{" "}
        <strong>1.00 always means the letter's natural shape</strong>, so
        returning to it is never guesswork, and the <strong>×</strong> beside
        an active stroke resets it outright.
      </p>
      <ul>
        <li>
          On a <strong>plain text block</strong>, hover a letter on the canvas
          and drag the dot that appears. Each dot slides along that stroke's
          own direction, so you cannot drag it somewhere the letterform would
          not go. The panel keeps a number field beside each stroke for typing
          an exact value.
        </li>
        <li>
          On <strong>Shape Fill</strong> and <strong>Shape Warp</strong>{" "}
          blocks, use the sliders in the panel instead.
        </li>
      </ul>
      <p>
        Only letters whose shapes have been described in advance offer these
        controls. A letter that shows nothing simply has not been described
        yet — that is expected, not a fault.
      </p>
      <p>
        <strong>Options…</strong> under an active stroke reveals{" "}
        <strong>Band width</strong>, which widens or narrows the swath of the
        letter that moves with the stroke, and <strong>Masking</strong>, for
        the occasions when the editor grabbed the wrong part of a letter: with{" "}
        <strong>By stroke</strong> you click the outlines to include or exclude
        and press Done; with <strong>Lasso</strong> you draw a loop around the
        region by hand.
      </p>

      <h4>Kashida</h4>
      <p>
        When a block contains letters that can carry an elongation, the panel
        shows an <strong>Extend by</strong> dial from 0 to 100%. It is a single
        control spread across every eligible letter at once, each stretching in
        proportion to how much elongation that letterform is meant to bear —
        useful for loosening or tightening a whole line in one movement.
      </p>

      <h4>Move &amp; scale a letter</h4>
      <p>
        Tick <strong>Move &amp; scale glyph</strong>, then hover a letter on a
        plain text block. Three dots appear: one moves the letter bodily, one
        stretches it sideways, one stretches it vertically. Its neighbours
        never shift to make room, so you can overlap letters deliberately —
        which is exactly what a calligrapher wants and a word processor
        refuses. <strong>Reset glyph transforms</strong> undoes all of them for
        the block.
      </p>

      <h4>Rigs</h4>
      <p>
        Give a stretch a name and press <strong>Save as Rig…</strong> to turn
        it into a slider under <strong>Rigged Parameters</strong> that runs
        from −1 to 1 and applies to <em>every</em> occurrence of that same
        letter in the block — a way to keep repeated letters consistent
        instead of adjusting each one by hand.
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
        Letters on a curve cannot be reshaped this way yet: once a letter is
        rotated to follow a curve, these tools do not apply to it.
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
