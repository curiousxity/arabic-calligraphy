/**
 * A page surface. One module per texture in this folder, each default-
 * exporting a `TextureDef`; `lib`-side code globs the folder, so dropping a
 * file in is the whole integration step — there is no list to edit.
 */
export type TextureDef = {
  id: string;
  name: string;
  nameAr?: string;
  /**
   * Tile edge in px. Bigger reads as less repetitive but costs a square of
   * that in generation time; 256 is the point where the eye stops finding
   * the repeat on a full page.
   */
  size: number;
  /** Paper colour used when the surface has no explicit tint. */
  defaultTint: string;
  /**
   * Luminance modulation at (u, v) in tile-relative [0, 1) coordinates,
   * roughly in [-1, 1]: negative darkens the tint, positive lightens it.
   * Must wrap seamlessly — see `_noise.ts`.
   */
  grain(u: number, v: number): number;
};
