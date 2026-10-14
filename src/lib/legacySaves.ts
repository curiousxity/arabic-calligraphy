import type { Block } from "../types";

/**
 * Block types that no longer exist. A save from before each removal can still
 * carry them; nothing renders them, so they are dropped on load rather than
 * left to occupy the layer list. See .claude/rules/removed-subsystems.md.
 */
export const REMOVED_BLOCK_TYPES = ["shapeWarp", "squareKufi"] as const;

/** Per-block fields of removed subsystems, stripped so old saves load byte-clean. */
export const REMOVED_BLOCK_FIELDS = [
  // Morph Glyph Editor, removed 2026-08-14.
  "glyphEdits", "glyphRigValues", "glyphMaskEdit", "glyphEditTool", "selectedGlyphIndex", "kashidaAmount", "kashidaEditMode",
  // Per-glyph move, scale & rotate, removed 2026-10-10.
  "glyphTransforms", "glyphTransformMode",
  // Square Kufi, removed 2026-10-14.
  "kufiColumns", "kufiComposition", "kufiLineGap", "kufiWordGap", "kufiCellEdits", "kufiCellEditMode",
] as const;

export function sanitizeLegacyBlocks(blocks: unknown[]): Block[] {
  return blocks
    .filter((b): b is Record<string, unknown> => !!b && typeof b === "object")
    .filter((b) => !(REMOVED_BLOCK_TYPES as readonly string[]).includes(String(b.type)))
    .map((b) => {
      const next = { ...b };
      for (const field of REMOVED_BLOCK_FIELDS) delete next[field];
      return next as unknown as Block;
    });
}
