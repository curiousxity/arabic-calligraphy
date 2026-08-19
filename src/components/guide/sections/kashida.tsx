import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "kashida",
  title: "Stretching joins (kashida)",
  order: 35,
  keywords: [
    "kashida",
    "kasheeda",
    "tatweel",
    "elongation",
    "stretch",
    "extend",
    "lengthen",
    "join",
    "connect",
    "justify",
    "fit width",
    "مد",
    "تطويل",
    "كشيدة",
  ],
  Body: () => (
    <>
      <p>
        A <strong>kashida</strong> stretches the connecting stroke between two
        letters that join to each other — the classical way of widening a line
        so it fills its space, instead of adding gaps between words.
      </p>

      <h4>How to use it</h4>
      <p>
        Select a block and open <strong>Typography</strong>. The{" "}
        <strong>Kashida join</strong> menu lists every place in your text where
        two letters actually connect, each shown as the pair itself — «ب ـ س».
        Pick one, then use the − and + buttons to set how long that join should
        be, up to eight steps. The preview beside the buttons shows the pair at
        the length you have chosen.
      </p>
      <p>
        Only real joins are offered. A letter such as ر or د never extends
        forward to the next letter, and لا is a single fused shape rather than
        two joined letters, so neither is listed — stretching them is not
        something the script does.
      </p>

      <h4>Fitting a line to a width</h4>
      <p>
        Under the stepper, <strong>Fit to width</strong> does the same job
        automatically: give it a target width and it spreads kashida evenly
        across every join in the block until the line spans it. If you have set
        a page size, the target starts out as your page's margin box — the area
        your text is meant to fill — and <strong>Use page margin box</strong>{" "}
        puts it back if you have typed something else. With no page set, just
        type the width you want.
      </p>
      <p>
        It always stops <em>short</em> of the target rather than spilling past
        it, and it spreads the stretch across all the joins rather than pulling
        one of them out of shape. Running it twice with the same target changes
        nothing the second time — it works out the whole line from scratch each
        time rather than piling more on — and the whole fit is a single Undo.
      </p>
      <p>
        If your text is already wider than the target, kashida cannot help:
        elongation only ever adds width. The status line will say so, and a
        smaller font size is the fix. This is for plain text blocks — text
        inside a shape or along a curve is already scaled to fit what it sits
        in.
      </p>

      <h4>It changes your text</h4>
      <p>
        Lengthening a join inserts the elongation character (ـ) into the block's
        text, which is why the letters genuinely connect and the line genuinely
        gets wider. It behaves like anything else you type: Undo steps it back,
        and a saved project keeps it.
      </p>
      <p>
        Because it is a text change, <strong>apply your kashidas before</strong>{" "}
        you fine-tune individual marks or letters on the canvas. Those
        adjustments are pinned to a letter's position in the line, so inserting
        anything earlier in the text can shift them onto the wrong letter —
        exactly as retyping a word would.
      </p>

      <h4>What you may see in some fonts</h4>
      <p>
        A few fonts draw certain letter combinations as one designed shape, and
        stretching a join inside such a combination makes the font fall back to
        the plain letters — الله is the common example. That is the font doing
        what it was built to do, not a fault; pick a different join if you would
        rather keep the combined form.
      </p>
    </>
  ),
};
