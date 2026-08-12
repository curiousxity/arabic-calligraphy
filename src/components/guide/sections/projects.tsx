import type { GuideSection } from "../types";

export const section: GuideSection = {
  id: "projects",
  title: "Saving and undo",
  order: 90,
  keywords: [
    "save",
    "load",
    "open",
    "project",
    "file",
    "quick save",
    "named",
    "cloud",
    "sign in",
    "account",
    "local",
    "browser",
    "undo",
    "redo",
    "history",
    "thumbnails",
    "revert",
  ],
  Body: () => (
    <>
      <p>
        Saving lives in <strong>Project &amp; Export</strong> near the top of
        the sidebar. There are three ways to keep a piece, and they are not
        interchangeable.
      </p>

      <h4>Quick save</h4>
      <p>
        The save and load buttons at the top of the panel keep a single
        working copy in this browser, and each quick save overwrites the last
        one. It is a safety net, not an archive. This is also the copy that
        reopens automatically the next time you come back to HarfCanvas.
      </p>

      <h4>Named projects</h4>
      <p>
        Type a name and save it to keep several in-progress designs side by
        side. Each appears in the list below with a button to load it and one
        to delete it. Saving under a name you have already used replaces that
        project rather than making a second copy.
      </p>
      <p>
        If cloud saving has been set up, you can sign in with your email
        address — a link arrives in your inbox, there is no password — and a{" "}
        <strong>Local</strong> / <strong>Cloud</strong> switch appears above
        the name field to choose where the next save goes. Both lists are shown
        together, so a cloud project follows you between machines while a local
        one stays in this browser. If you see no sign-in option at all, cloud
        saving is not configured, and everything is local.
      </p>

      <h4>Project files</h4>
      <p>
        Download the project as a file and open it again later — the way to
        move work to another computer, hand it to someone else, or keep a
        dated copy of a finished piece. This is the only form of saving that
        does not depend on this browser.
      </p>

      <h4>Undo, redo, and history</h4>
      <p>
        Undo and redo sit in <strong>Block Controls</strong>, and answer to
        Ctrl+Z and Ctrl+Y. Beside them is a <strong>History</strong> button
        that opens a strip of thumbnails of earlier states, newest first —
        click one to jump straight back to it rather than stepping back one
        change at a time.
      </p>
      <p>
        History belongs to this session only. It is not written into a saved
        project or a downloaded file, and it starts empty when you reload the
        page — so if a version matters, save it under a name rather than
        trusting that you can undo your way back to it.
      </p>
    </>
  ),
};
