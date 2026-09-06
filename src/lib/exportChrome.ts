/**
 * The Konva `name` every editor-only node carries.
 *
 * "This node is chrome, not artwork" is a property of the node, so the node
 * is what declares it. `useExport`'s `withExportAdjustments` hides everything
 * carrying this name for the duration of a render, and needs to know nothing
 * about what any of them are.
 *
 * It replaces an allowlist of id prefixes in that hook, which every new
 * overlay had to remember to join — from a file its author had no other
 * reason to open, with a gold lattice or a page outline baked silently into
 * every PNG as the price of forgetting. Three prefixes had accumulated there.
 *
 * Nodes keep their ids as well: those are how a specific one is addressed
 * (`e2e/artboard.spec.ts` looks up `#artboard-chrome-outline`). This name is
 * only the "hide me on export" channel.
 */
export const EXPORT_HIDDEN = "export-hidden";
