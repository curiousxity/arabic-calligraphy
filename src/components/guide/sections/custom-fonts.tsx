import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "custom-fonts",
  title: "Using your own fonts",
  order: 32,
  keywords: [
    "font",
    "upload",
    "custom font",
    "install font",
    "ttf",
    "otf",
    "woff",
    "typeface",
    "khatt",
    "family",
    "licence",
    "license",
    "missing font",
  ],
  Body: () => (
    <>
      <p>
        The font list is not fixed. If you own an Arabic font the app doesn't
        ship with, you can add it yourself: select a text block, open{" "}
        <strong>Typography</strong>, and click{" "}
        <strong>Upload a font…</strong> under the font picker. Choose the file,
        give it a name, and it joins the list — marked{" "}
        <em>(uploaded)</em> — ready to use on any block.
      </p>

      <h4>Which files work</h4>
      <p>
        Uncompressed <strong>.ttf</strong> and <strong>.otf</strong> files.
        Web fonts — <strong>.woff</strong> and <strong>.woff2</strong> — are
        compressed and cannot be used here; if that is all you have, look for
        the desktop version of the same font. A file that isn't a font the app
        can read is refused with a message rather than half-added.
      </p>

      <h4>Two things to know before you upload</h4>
      <ul>
        <li>
          <strong>The Presets symbols won't appear.</strong> ﷺ and the other
          honorific symbols on the Presets row are custom glyphs that exist
          only in the fonts bundled with the app. In an uploaded font they
          show as empty boxes. Everything else — letters, tashkeel, kashida —
          works normally.
        </li>
        <li>
          <strong>Fonts are licensed.</strong> Making sure you have the right
          to use a font is up to you.
        </li>
      </ul>

      <h4>Where uploaded fonts live</h4>
      <p>
        In this browser, on this computer — nothing is uploaded anywhere. That
        has one consequence worth planning around: a project remembers{" "}
        <em>which</em> font each block uses, never the font itself. Open the
        same project on another computer, in another browser, or after
        clearing your browser data, and the app will tell you the font isn't
        available and draw those blocks in Noto Sans until you upload the file
        again. Keep the font file somewhere you can find it.
      </p>
      <p>
        Removing a font from the list works the same way: click the bin beside
        its name. Blocks still using it fall back to Noto Sans and say so, and
        adding the file again brings them straight back.
      </p>
    </>
  ),
};
