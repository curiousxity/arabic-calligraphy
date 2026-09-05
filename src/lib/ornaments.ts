/**
 * The built-in ornament & frame library.
 *
 * Each ornament is a TS module in `src/data/ornaments/`, auto-loaded here —
 * the same reasoning as the guide-section registry: dropping a file in the
 * folder is the whole integration step, there is no list to keep in sync,
 * and the geometry stays typed and tree-shakeable instead of living in raw
 * `.svg` assets that would need a loader.
 */

export type OrnamentDef = {
  /** Stable slug, unique across the library. Used as the React key. */
  id: string;
  name: string;
  /** Arabic name, shown under the English one in the picker. */
  nameAr: string;
  /** Free-form grouping/search terms, e.g. "frame", "star", "arch". */
  tags: string[];
  /** The coordinate box every string in `paths` is drawn in. */
  viewBox: { w: number; h: number };
  /** One or more SVG path `d` strings, drawn together as one silhouette. */
  paths: string[];
};

const modules = import.meta.glob<unknown>("../data/ornaments/*.ts", {
  eager: true,
});

function extractOrnament(mod: unknown): OrnamentDef | null {
  if (!mod || typeof mod !== "object") return null;

  const candidate = (mod as { default?: unknown }).default;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof (candidate as OrnamentDef).id !== "string" ||
    !Array.isArray((candidate as OrnamentDef).paths) ||
    (candidate as OrnamentDef).paths.length === 0
  ) {
    return null;
  }

  return candidate as OrnamentDef;
}

/**
 * Every ornament, sorted by id.
 *
 * Computed once at module load — the glob is eager and the set is fixed at
 * build time. Modules in the folder that export no ornament (the shared
 * `_geometry.ts` helpers) are skipped rather than erroring, which is what
 * lets helpers live beside the data they build.
 */
const ORNAMENTS: OrnamentDef[] = Object.values(modules)
  .map(extractOrnament)
  .filter((o): o is OrnamentDef => o !== null)
  .sort((a, b) => a.id.localeCompare(b.id));

export function listOrnaments(): OrnamentDef[] {
  return ORNAMENTS;
}

export function getOrnament(id: string): OrnamentDef | undefined {
  return ORNAMENTS.find((o) => o.id === id);
}

/** An ornament's paths joined into the single `d` string Shape Fill wants. */
export function ornamentPathData(def: OrnamentDef): string {
  return def.paths.join(" ");
}

/**
 * A standalone SVG document for `def`, filled with `fill`.
 *
 * `evenodd` because several ornaments are rings: their holes are cut with a
 * coincident bridge (see `_geometry.ts`'s `ringPath`), which reads correctly
 * under either rule, but even-odd is the one that also does the right thing
 * if a future ornament uses a plain second subpath.
 *
 * Deliberately ASCII-only — no Arabic name, no comment — because
 * `ornamentSvgDataUrl` base64s it with `btoa`, which throws on any codepoint
 * above U+00FF.
 */
export function ornamentSvgMarkup(def: OrnamentDef, fill: string): string {
  const { w, h } = def.viewBox;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="0 0 ${w} ${h}">` +
    def.paths
      .map((d) => `<path d="${d}" fill="${fill}" fill-rule="evenodd"/>`)
      .join("") +
    `</svg>`
  );
}

/** The same markup as a base64 data URL, which `ImageBlock` can render directly. */
export function ornamentSvgDataUrl(def: OrnamentDef, fill: string): string {
  return `data:image/svg+xml;base64,${btoa(ornamentSvgMarkup(def, fill))}`;
}

/**
 * Palette offered for an ornament's baked-in colour.
 *
 * A frame is inserted as a rasterized image, so the colour is chosen *before*
 * insert and cannot be changed afterwards — hence offering the app's own
 * accents up front rather than leaving the user to discover the limitation.
 *
 * It lives here, beside `ornamentSvgDataUrl`, because both surfaces that bake
 * a colour into an ornament read it: the shape picker and the name-design
 * wizard's frame step. Two copies drifted the moment either was edited.
 */
export const ORNAMENT_FILL_SWATCHES = [
  "#1e3a5f",
  "#c9a227",
  "#8c1c13",
  "#1f5f4a",
  "#2b2b2b",
  "#f5f0e6",
];

/** The gold both surfaces open on. */
export const DEFAULT_ORNAMENT_FILL = ORNAMENT_FILL_SWATCHES[1];
