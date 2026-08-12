import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "export",
  title: "Saving and exporting",
  order: 80,
  keywords: [
    "export",
    "save",
    "png",
    "jpeg",
    "jpg",
    "svg",
    "pdf",
    "print",
    "clipboard",
    "copy",
    "preset",
    "transparent",
    "resolution",
    "scale",
  ],
  Body: () => (
    <>
      <p>
        Everything to do with getting your work out of the app lives in the
        <strong> Project &amp; Export</strong> panel, near the top of the sidebar.
        Exporting always captures the artwork itself — the alignment grid and any
        on-canvas editing handles are hidden automatically, and the picture is
        cropped tightly to your blocks rather than to the whole artboard. Your
        current zoom makes no difference to what comes out.
      </p>

      <h4>Choosing a format</h4>
      <ul>
        <li>
          <strong>PNG</strong> — the everyday choice. Sharp edges, and the only
          picture format here that can keep a see-through background.
        </li>
        <li>
          <strong>JPEG</strong> — smaller files, but no transparency and slight
          softening around fine strokes. Good for email and quick previews, less
          good for hairline diacritics.
        </li>
        <li>
          <strong>SVG</strong> — the letterforms stay as outlines, so the piece
          can be enlarged to any size — a wall panel, a vinyl cut — without ever
          going soft. This is what to hand a sign-maker or a printer.
        </li>
        <li>
          <strong>PDF</strong> — also stays sharp at any size, and is the format
          most print shops ask for. The page is sized to the artwork itself.
        </li>
      </ul>

      <h4>Transparent background</h4>
      <p>
        Tick <strong>Transparent background</strong> and the artboard colour is
        left out of PNG and SVG exports, so the piece can be placed over another
        image or a coloured card. JPEG and PDF have no way to record
        transparency, so they always keep the background — that is deliberate,
        not an oversight; without it they would come out with a black field
        behind the letters.
      </p>

      <h4>Scale</h4>
      <p>
        <strong>Scale</strong> multiplies the resolution of the picture formats.
        1× is fine for the web; 3× or more is what you want for print, or for
        anything that will be looked at closely. It has no effect on SVG, which
        has no fixed resolution to begin with.
      </p>

      <h4>Copy PNG</h4>
      <p>
        <strong>Copy PNG</strong> puts the artwork straight onto your clipboard,
        ready to paste into a message, a document, or a design app — no file
        saved, no trip through your downloads folder. Some browsers refuse this
        unless the page is served securely; when that happens you are told so in
        the panel rather than left wondering, and the ordinary PNG button does
        the same job through a file.
      </p>

      <h4>Export all</h4>
      <p>
        The four format buttons under the scale box decide what{" "}
        <strong>Export all</strong> writes. Tick the ones you want and press it
        once to get them all — the files arrive a moment apart, because browsers
        object to several downloads starting at the same instant.
      </p>

      <h4>Presets</h4>
      <p>
        A preset remembers a scale, the transparency setting, and which formats
        to write, under a name of your choosing. Set the controls the way you
        want them, type a name, and press <strong>Save preset</strong>; saving
        again under the same name replaces it.
      </p>
      <p>
        Picking a preset from the list loads its settings back into the controls
        so you can see what it will do, and <strong>Run</strong> exports with
        them. Three are there to begin with — Web @1x, Print @3x, and Print
        PDF — and you are free to delete or replace any of them.
      </p>
      <p>
        Presets are remembered in this browser on this machine. They are not part
        of a saved project, so they do not travel with a design you share or open
        somewhere else.
      </p>
    </>
  ),
};
