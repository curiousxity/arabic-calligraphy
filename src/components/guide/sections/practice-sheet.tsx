import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "practice-sheet",
  title: "Printing a practice sheet",
  order: 81,
  keywords: [
    "practice",
    "practise",
    "mashq",
    "tracing",
    "trace",
    "print",
    "worksheet",
    "nuqta",
    "nib",
    "qalam",
    "pen",
    "learn",
    "beginner",
  ],
  Body: () => (
    <>
      <p>
        Select a text block, open <strong>Export</strong>, and click{" "}
        <strong>Practice sheet…</strong>. You get a PDF to print: the text once
        in solid ink to study, a few times in faint grey to trace over, and then
        ruled lines to write it on your own.
      </p>

      <h4>Why it asks for your pen</h4>
      <p>
        Traditional Arabic calligraphy measures every letter in{" "}
        <em>nuqta</em> — the rhombic dot a reed pen makes when pressed to the
        page. An alif in Thuluth is about seven dots tall. Because the dot
        depends on the pen, the right size for a practice sheet depends on the
        pen too. Enter the width of your nib in millimetres and the sheet is
        scaled so that one square of the grid is one dot of <em>your</em> pen.
        If you don't have a specific pen yet, tick{" "}
        <strong>Set letter size directly</strong> and choose a letter height
        instead.
      </p>

      <h4>Reading the sheet</h4>
      <ul>
        <li>
          <strong>Model row.</strong> Solid black. Look at it; count the dots.
        </li>
        <li>
          <strong>Trace rows.</strong> Faint grey. Write over them with your
          pen, keeping the nib angle steady.
        </li>
        <li>
          <strong>Blank rows.</strong> Only the baseline and grid. Write from
          memory and compare with the model.
        </li>
      </ul>

      <h4>Check before you print</h4>
      <p>
        The dialog shows the sheet as it will print, and tells you in advance
        whether every row fits and whether the sheet had to shrink. If the
        rows you asked for don't all fit on the page, it says how many will be
        left off; lower the row counts or the nib width to fit them. A field
        that is out of range is flagged, and Download stays off until it is
        fixed.
      </p>

      <h4>If the sheet says it was shrunk</h4>
      <p>
        A long phrase at a wide nib will not fit across the page. Rather than
        break the line, the sheet is scaled down and the footer tells you the
        size the grid now represents. Use a shorter phrase, or a narrower pen,
        to practise at true size.
      </p>

      <h4>A very fine grid</h4>
      <p>
        With a small nib the dots are too close to print cleanly, so the grid
        is drawn every few dots instead and the footer says "grid every N
        nuqta". The letters keep their true size.
      </p>
    </>
  ),
};
