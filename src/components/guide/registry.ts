import type { GuideSection } from "./types";

// Every .tsx file dropped into src/components/guide/sections/ is picked up
// automatically — adding a guide page is just adding a file there, with no
// index to edit. An auto-loaded folder means independent contributors never
// collide over a shared registration list.
const modules = import.meta.glob<unknown>("./sections/*.tsx", { eager: true });

function extractSection(mod: unknown): GuideSection | null {
  if (!mod || typeof mod !== "object") return null;

  const candidate = (mod as { section?: unknown }).section;
  if (
    candidate &&
    typeof candidate === "object" &&
    "id" in candidate &&
    "Body" in candidate
  ) {
    return candidate as GuideSection;
  }

  return null;
}

/**
 * Every guide section, sorted by `order` then `title`.
 *
 * Computed once at module load — the glob is eager and the section set is
 * fixed at build time, so there is nothing to recompute per render.
 */
export const guideSections: GuideSection[] = Object.values(modules)
  .map(extractSection)
  .filter((s): s is GuideSection => s !== null)
  .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

/**
 * Sections matching `query` against title and keywords, case-insensitively.
 * An empty or whitespace-only query returns everything.
 */
export function filterGuideSections(
  sections: GuideSection[],
  query: string
): GuideSection[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return sections;

  return sections.filter(
    (s) =>
      s.title.toLowerCase().includes(needle) ||
      s.keywords.some((k) => k.toLowerCase().includes(needle))
  );
}
