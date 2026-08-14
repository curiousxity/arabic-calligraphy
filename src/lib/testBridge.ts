import type Konva from "konva";
import type { Block } from "../types";

/**
 * The read-only surface the Playwright suite drives the editor through.
 *
 * Konva draws everything to a single `<canvas>`, so the DOM tells an e2e
 * test almost nothing about the artboard: there is no element per block to
 * assert on, and no way to ask where a glyph landed. This bridge is the
 * minimum needed to close that gap — editor state (`getBlocks`,
 * `getSelectedIds`) plus the live stage, from which a test can resolve any
 * node's on-screen rectangle via Konva's own `getClientRect`.
 *
 * It is deliberately *read-only*. Nothing here mutates state: tests drive
 * the app the way a user does (real clicks, real drags, real typing) and
 * use the bridge only to check what happened. Adding a setter here would
 * let a test pass while the interaction it claims to cover is broken.
 *
 * Appearance assertions do not belong here either — those read pixels off
 * the stage canvas (see `e2e/harf.ts`).
 */
export type HarfTestBridge = {
  getBlocks: () => Block[];
  getSelectedIds: () => number[];
  getStage: () => Konva.Stage | null;
};

declare global {
  interface Window {
    __HARF__?: HarfTestBridge;
  }
}

/**
 * Publishes `window.__HARF__` in dev builds only, returning an uninstaller
 * so the caller can use it directly as a `useEffect` body.
 *
 * `import.meta.env.DEV` is substituted with a literal `false` by Vite in a
 * production build, so the assignment below becomes unreachable and is
 * dropped — a production bundle ships no bridge, not a disabled one.
 */
export function installTestBridge(bridge: HarfTestBridge): () => void {
  if (!import.meta.env.DEV || typeof window === "undefined") return () => {};
  window.__HARF__ = bridge;
  return () => {
    if (window.__HARF__ === bridge) delete window.__HARF__;
  };
}
