import type { SpineTable, StrokeSpine } from "./types";

/**
 * One generated table per font, loaded on demand.
 *
 * Not eager, unlike strokeSchema/registry.ts: 15 fonts x ~120 glyphs x ~3
 * strokes is far too much to put in the main bundle, and a session uses one
 * or two fonts. Dropping a file into src/data/strokeSpines/ is still the whole
 * integration step — there is no list to edit.
 */
const modules = import.meta.glob<{ default: SpineTable }>("../../data/strokeSpines/*.json");

const cache = new Map<string, SpineTable | null>();
// In-flight promises, keyed the same way as `cache`, so two overlapping
// loadSpineTable() calls for the same font share one resolution instead of
// each awaiting its own import() and caching a distinct object.
const inFlight = new Map<string, Promise<SpineTable | null>>();

function modulePathFor(fontFamily: string): string | undefined {
  return Object.keys(modules).find((p) => p.endsWith(`/${fontFamily}.json`));
}

/**
 * The font's spine table, or `null` when it has none.
 *
 * `null` is the out-of-scope mechanism, exactly as `nuqtaEmRatio` returning
 * null already is — a font without a table offers no schema-backed stretch
 * handles rather than falling back to the proportional mapping this replaced.
 */
export async function loadSpineTable(fontFamily: string): Promise<SpineTable | null> {
  const cached = cache.get(fontFamily);
  if (cached !== undefined) return cached;

  const existing = inFlight.get(fontFamily);
  if (existing) return existing;

  const promise = (async () => {
    const path = modulePathFor(fontFamily);
    if (!path) {
      cache.set(fontFamily, null);
      return null;
    }

    const mod = await modules[path]();
    const table = mod.default ?? null;
    cache.set(fontFamily, table);
    return table;
  })();

  inFlight.set(fontFamily, promise);
  try {
    return await promise;
  } finally {
    inFlight.delete(fontFamily);
  }
}

/** Synchronous peek for render paths that must not await. Null until loadSpineTable has resolved. */
export function getSpineTableIfLoaded(fontFamily: string): SpineTable | null {
  return cache.get(fontFamily) ?? null;
}

export function getSpine(
  table: SpineTable | null,
  glyphId: number,
  strokeId: string,
  zoneIndex: number
): StrokeSpine | null {
  const entry = table?.glyphs[String(glyphId)];
  if (!entry) return null;
  return (
    entry.spines.find((s) => s.strokeId === strokeId && s.zoneIndex === zoneIndex) ?? null
  );
}
