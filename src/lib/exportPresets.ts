/**
 * Saved export presets — a name plus the scale/background/format choices the
 * export buttons would otherwise need to be set by hand every time.
 *
 * Local-only by design: these describe how *this browser* likes to export,
 * not part of a project's contents, so they deliberately stay out of the
 * Supabase named-project store. Persistence follows the same best-effort
 * pattern as the other local stores (`harfcanvas-named-projects-v1`,
 * `harfcanvas-glyph-rigs-v1`) — every read and write is wrapped, because
 * localStorage throws in privacy mode and when the quota is exhausted, and
 * losing a preset is never worth breaking the editor over.
 */

export type ExportFormat = "png" | "jpeg" | "svg" | "pdf";

export type ExportPreset = {
  id: string;
  name: string;
  scale: number;
  transparent: boolean;
  formats: ExportFormat[];
};

export const EXPORT_PRESETS_KEY = "harfcanvas-export-presets-v1";

export const DEFAULT_PRESETS: ExportPreset[] = [
  { id: "web-1x", name: "Web @1x", scale: 1, transparent: true, formats: ["png"] },
  { id: "print-3x", name: "Print @3x", scale: 3, transparent: false, formats: ["png"] },
  { id: "print-pdf", name: "Print PDF", scale: 3, transparent: false, formats: ["pdf"] },
];

const VALID_FORMATS: ExportFormat[] = ["png", "jpeg", "svg", "pdf"];

const isExportPreset = (value: unknown): value is ExportPreset => {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ExportPreset>;
  return (
    typeof p.id === "string" &&
    p.id.length > 0 &&
    typeof p.name === "string" &&
    typeof p.scale === "number" &&
    Number.isFinite(p.scale) &&
    p.scale > 0 &&
    typeof p.transparent === "boolean" &&
    Array.isArray(p.formats) &&
    p.formats.length > 0 &&
    p.formats.every((f) => (VALID_FORMATS as string[]).includes(f as string))
  );
};

/** Reads the saved presets, falling back to {@link DEFAULT_PRESETS} on empty or unreadable storage. */
export function loadPresets(): ExportPreset[] {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_PRESETS;
    const raw = localStorage.getItem(EXPORT_PRESETS_KEY);
    if (!raw) return DEFAULT_PRESETS;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PRESETS;
    const presets = parsed.filter(isExportPreset);
    // An array that parsed but held nothing usable is corruption, not a
    // deliberately emptied list — a user who deletes every preset still gets
    // the defaults back, which is friendlier than an empty dropdown.
    return presets.length > 0 ? presets : DEFAULT_PRESETS;
  } catch {
    return DEFAULT_PRESETS;
  }
}

/** Best-effort persist; a storage failure is swallowed exactly as the other local stores do. */
export function savePresets(presets: ExportPreset[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(EXPORT_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // Privacy mode or quota — the presets simply don't survive this session.
  }
}

/** Replaces the entry sharing `preset`'s id, or appends it when the id is new. Pure. */
export function upsertPreset(presets: ExportPreset[], preset: ExportPreset): ExportPreset[] {
  const index = presets.findIndex((p) => p.id === preset.id);
  if (index === -1) return [...presets, preset];
  const next = [...presets];
  next[index] = preset;
  return next;
}

/** Drops the entry with `id`, leaving the rest in order. Pure. */
export function removePreset(presets: ExportPreset[], id: string): ExportPreset[] {
  return presets.filter((p) => p.id !== id);
}
