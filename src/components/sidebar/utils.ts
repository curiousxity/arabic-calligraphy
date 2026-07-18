export const makeId = (base: string, suffix?: string | number | null) =>
  suffix != null ? `${base}-${suffix}` : base;
