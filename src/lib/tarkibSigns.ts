/**
 * The vowel and hamza signs a tarkib places over and under its letters.
 * Task 9 of the tarkib plan fills this in; the composer already takes a set.
 * Pure; see .claude/rules/tarkib.md.
 */
import type { SvgCmd } from "./svgPath";

export type SignKey = "fatha" | "kasra" | "damma" | "shadda" | "sukun" | "fathatan" | "kasratan" | "dammatan" | "hamza" | "madda";
/** Each sign's shapes, library units. */
export type SignSet = Partial<Record<SignKey, { cmds: SvgCmd[]; w: number; h: number }[]>>;
