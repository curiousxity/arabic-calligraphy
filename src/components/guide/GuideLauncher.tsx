import React, { useState } from "react";
import { HelpIcon } from "../Icons";
import { GuideDrawer } from "./GuideDrawer";

export type GuideLauncherProps = {
  /** Matches App.tsx's own breakpoint, threaded through to the drawer. */
  isMobile: boolean;
};

/**
 * The "?" button in the sidebar header, plus the drawer it opens.
 *
 * Button and drawer live together so the sidebar needs one element rather
 * than a button, a piece of state, and a conditional mount. Open state is
 * local on purpose: reading the guide is not an edit, so it must not reach
 * undo history or a saved project. Focus returns to this button on close —
 * the drawer restores whatever was focused when it mounted.
 */
export const GuideLauncher: React.FC<GuideLauncherProps> = ({ isMobile }) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="layerIconBtn"
        style={{ position: "absolute", top: 8, insetInlineStart: 8 }}
        title="Open the user guide"
        aria-label="Open the user guide"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <HelpIcon size={15} />
      </button>
      <GuideDrawer
        open={open}
        onClose={() => setOpen(false)}
        isMobile={isMobile}
      />
    </>
  );
};

export default GuideLauncher;
