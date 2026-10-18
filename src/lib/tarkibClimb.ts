/**
 * Which letters let the next one climb into the tier above (the composer's
 * climb move). Read from the panels (sheets 23, 27-30): the next letter rides
 * up off a letter whose stroke ends rising or flat at the top of its body, so
 * a pen can leave it upward. Pure data; see .claude/rules/tarkib.md.
 */
import type { PhraseLetter } from "./tarkibText";

/** Skeleton keys after which the next letter may climb. */
export const CLIMB_AFTER: ReadonlySet<string> = new Set(["jeem", "meem", "seen", "sad", "ain", "ha", "ba", "lam", "fa", "kaf"]);

/** May the letter after `prev` climb into the tier above? Only within a run
 *  (`next` joined to `prev`). */
export const canClimb = (prev: PhraseLetter, next: PhraseLetter): boolean =>
  CLIMB_AFTER.has(prev.skeleton) && (next.form === "middle" || next.form === "finishing");
