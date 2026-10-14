/** The word a fresh canvas starts with; also `DEFAULT_BLOCK.text` in App.tsx. */
export const STARTER_TEXT = "حرف";

export const startingText = (typed: string): string => typed.trim() || STARTER_TEXT;

/** The start screen shows only on a truly fresh load: a quick-save means the user has work to come back to. */
export const shouldShowStartScreen = (
  storage: { getItem(k: string): string | null },
  storageKey: string
): boolean => storage.getItem(storageKey) === null;
