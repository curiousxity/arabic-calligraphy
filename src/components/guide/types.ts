import type { ComponentType } from "react";

/**
 * One page of the in-app user guide.
 *
 * Sections are plain TSX modules dropped into `./sections/` — see
 * `registry.ts`, which globs that folder so adding a page needs no
 * registration step anywhere. Deliberately not markdown: rendering markdown
 * would mean a new dependency, and these pages want the app's own components
 * and CSS custom properties more than they want prose formatting.
 */
export type GuideSection = {
  /** Stable slug, unique across sections. Used as the list key. */
  id: string;
  /** Shown in the section list and as the page heading. */
  title: string;
  /** Sort position in the section list. Gaps are intentional — see below. */
  order: number;
  /**
   * Extra search terms the filter matches besides `title`, for the words a
   * user would actually type. A page titled "Marks" should list "tashkeel",
   * "harakat", and "diacritic" here.
   */
  keywords: string[];
  /** The page body. Rendered inside the drawer's scrolling pane. */
  Body: ComponentType;
};

/** A section module is expected to export its section as `section`. */
export type GuideSectionModule = {
  section: GuideSection;
};
