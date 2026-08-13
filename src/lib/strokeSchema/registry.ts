import type { GlyphDescription } from "./types";

// Every JSON file dropped into src/data/strokeSchemas/ is picked up
// automatically — adding a new letterform is just adding a file there, no
// registration step. Keyed by the file's own `glyph.unicode`/`glyph.joiningForm`
// fields (not filename), so this is robust to renames.
const modules = import.meta.glob<unknown>("../../data/strokeSchemas/*.json", {
  eager: true,
});

function extractDescription(mod: unknown): GlyphDescription | null {
  const candidate =
    mod && typeof mod === "object" && "default" in (mod as Record<string, unknown>)
      ? (mod as { default: unknown }).default
      : mod;

  if (candidate && typeof candidate === "object" && "glyph" in candidate) {
    return candidate as GlyphDescription;
  }

  return null;
}

function registryKey(codepointHex: string, form: string): string {
  return `${codepointHex.toUpperCase()}|${form}`;
}

/** Ligatures are keyed by their whole fused letter sequence, not a single codepoint — see baseLetterSequence in strokeSchema/types.ts. */
function ligatureKey(codepointHexSequence: string[]): string {
  return codepointHexSequence.map((c) => c.toUpperCase()).join("-");
}

const registry = new Map<string, GlyphDescription>();
const ligatureRegistry = new Map<string, GlyphDescription>();

for (const mod of Object.values(modules)) {
  const desc = extractDescription(mod);
  if (!desc) continue;

  if (desc.glyph.baseLetterSequence?.length) {
    ligatureRegistry.set(ligatureKey(desc.glyph.baseLetterSequence), desc);
    continue;
  }

  if (!desc.glyph.unicode) continue;
  registry.set(registryKey(desc.glyph.unicode, desc.glyph.joiningForm), desc);
}

/** Font-agnostic lookup: same (baseLetter, joiningForm) schema applies regardless of which font a block uses. */
export function getStrokeSchema(
  codepointHex: string,
  form: string
): GlyphDescription | undefined {
  return registry.get(registryKey(codepointHex, form));
}

/** Looks up a multi-letter ligature schema by its fused base-letter codepoint sequence (see glyphLookup.ts's cluster-span detection). */
export function getLigatureSchema(codepointHexSequence: string[]): GlyphDescription | undefined {
  return ligatureRegistry.get(ligatureKey(codepointHexSequence));
}

/** Every registered schema, for suites that assert a property across the whole authored set. */
export function allStrokeSchemas(): GlyphDescription[] {
  return Array.from(registry.values());
}
