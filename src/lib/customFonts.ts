import * as opentype from "opentype.js";

/**
 * User-uploaded fonts.
 *
 * Adding a font used to be a five-place source edit plus an offline nuqta
 * measurement. The Morph removal deleted the measured part, so a font is now
 * just "bytes HarfBuzz can shape plus a display name" — which is exactly what
 * an upload can supply at runtime. This module is the whole registry: it
 * stores the bytes, hands out a URL `shapeText` can fetch, and registers a
 * `FontFace` so the sidebar's dropdown can preview the family in itself.
 *
 * Deliberately free of any dependency on `./harfbuzz`: that module statically
 * imports `harfbuzzjs`, whose CJS/ESM shape throws under Vitest's Node loader
 * before any test code runs (the same reason `diacritics.ts` keeps its
 * distance). The one thing this module needs from it — invalidating the shape
 * cache when bytes change under a URL — arrives through
 * `setShapeCacheInvalidator`, wired once by `useShapedGlyphs.ts`.
 */

export type CustomFont = { key: string; label: string; addedAt: number };

type StoredFont = CustomFont & { bytes: ArrayBuffer };

const DB_NAME = "harfcanvas-fonts";
const DB_VERSION = 1;
const STORE = "fonts";

/**
 * Session-lifetime mirror of the store. It is both the fallback when
 * IndexedDB is unavailable (privacy mode, an unsupported browser) and the
 * authority for reads, so a write that IndexedDB rejects still behaves
 * normally until the tab closes — best-effort, like every other store in
 * this app, never a crash.
 */
const memoryStore = new Map<string, StoredFont>();

/** key → object URL. The synchronous half of the registry `resolveFontUrl` reads. */
const urlCache = new Map<string, string>();

/** key → the runtime FontFace added to `document.fonts`, so removal can undo it. */
const faceCache = new Map<string, FontFace>();

type ShapeCacheInvalidator = (fontUrl?: string) => void;
let invalidateShapeCache: ShapeCacheInvalidator = () => {};

/**
 * Installs the shape-cache invalidator. Called once by `useShapedGlyphs.ts`,
 * which already owns both sides of this seam; see the module comment for why
 * this is not a plain import of `clearShapeCache`.
 */
export function setShapeCacheInvalidator(fn: ShapeCacheInvalidator): void {
  invalidateShapeCache = fn;
}

// ---------------------------------------------------------------- IndexedDB

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      return resolve(null);
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const tx = db.transaction(STORE, mode);
          const request = run(tx.objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(null);
          tx.oncomplete = () => db.close();
        } catch {
          resolve(null);
        }
      })
  );
}

async function readAll(): Promise<StoredFont[]> {
  const rows = await withStore<StoredFont[]>("readonly", (s) => s.getAll() as IDBRequest<StoredFont[]>);
  const merged = new Map<string, StoredFont>();
  for (const row of rows ?? []) if (row?.key) merged.set(row.key, row);
  // The memory mirror wins: it holds anything this session wrote that
  // IndexedDB refused, and is never staler than the database.
  for (const [key, row] of memoryStore) merged.set(key, row);
  return [...merged.values()];
}

async function readOne(key: string): Promise<StoredFont | null> {
  const inMemory = memoryStore.get(key);
  if (inMemory) return inMemory;
  const row = await withStore<StoredFont>("readonly", (s) => s.get(key) as IDBRequest<StoredFont>);
  if (row?.key) memoryStore.set(row.key, row);
  return row?.key ? row : null;
}

// ------------------------------------------------------------ keys & labels

/**
 * A font family name reduced to a CSS-ident-safe, URL-safe slug. The result
 * is half of the storage key, and that key is also used verbatim as a CSS
 * `font-family` and as a block's `fontFamily`, so it may contain nothing
 * that would need quoting or escaping in either place.
 */
export function slugifyFamily(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  return slug || "font";
}

/** FNV-1a over the file's bytes, as 8 hex digits. Not a checksum for integrity — just an identity. */
export function hashBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hash = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * `custom-<slug>-<hash>`. The hash is what lets two versions of one family
 * coexist rather than silently overwriting each other, and what makes
 * re-uploading the *same* file idempotent.
 */
export function customFontKey(family: string, bytes: ArrayBuffer): string {
  return `custom-${slugifyFamily(family)}-${hashBytes(bytes)}`;
}

export function isCustomFontKey(key: string): boolean {
  return key.startsWith("custom-");
}

/**
 * A readable name for a font key that nothing can resolve — the only case
 * where a key is ever shown to a user, since a font that *is* available is
 * named by its stored label. Recovers the family from the slug half of a
 * custom key; anything else (a built-in that has been renamed away, a
 * hand-edited save) is shown verbatim.
 */
export function describeFontKey(key: string): string {
  const match = /^custom-(.+)-[0-9a-f]{8}$/.exec(key);
  if (!match) return key;
  return match[1]
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

type OpenTypeNames = Record<string, Record<string, string> | undefined>;

/** Best available human name from the font's `name` table, else the filename. */
function familyNameFrom(font: opentype.Font, fallback: string): string {
  const names = (font.names ?? {}) as unknown as OpenTypeNames;
  for (const field of ["preferredFamily", "fontFamily", "fullName"]) {
    const entry = names[field];
    if (!entry) continue;
    const value = entry.en ?? Object.values(entry)[0];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

// -------------------------------------------------------------- object URLs

function makeObjectUrl(bytes: ArrayBuffer): string | null {
  try {
    return URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
  } catch {
    return null;
  }
}

function revokeObjectUrl(url: string): void {
  try {
    URL.revokeObjectURL(url);
  } catch {
    // Non-browser or already revoked — nothing to undo.
  }
}

/**
 * Registers the bytes as a CSS `FontFace` under the font's own key, which is
 * what makes an uploaded font previewable in the sidebar dropdown. This is
 * the runtime replacement for the `@font-face` rule in `index.css` that a
 * bundled font needs.
 */
function registerFontFace(key: string, bytes: ArrayBuffer): void {
  if (typeof document === "undefined" || typeof FontFace === "undefined") return;
  try {
    // A copy: `FontFace` may keep the buffer, and the stored record's own
    // ArrayBuffer is handed out again for the object URL.
    const face = new FontFace(key, bytes.slice(0));
    faceCache.set(key, face);
    face
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {
        faceCache.delete(key);
      });
  } catch {
    // A browser without the FontFace constructor loses the preview only —
    // shaping goes through HarfBuzz and the object URL regardless.
  }
}

function unregisterFontFace(key: string): void {
  const face = faceCache.get(key);
  if (!face) return;
  faceCache.delete(key);
  try {
    document.fonts.delete(face);
  } catch {
    // Never loaded, or no document — nothing to remove.
  }
}

function activate(row: StoredFont): void {
  if (!urlCache.has(row.key)) {
    const url = makeObjectUrl(row.bytes);
    if (url) urlCache.set(row.key, url);
  }
  if (!faceCache.has(row.key)) registerFontFace(row.key, row.bytes);
}

function deactivate(key: string): void {
  const url = urlCache.get(key);
  if (url) {
    urlCache.delete(key);
    // The bytes behind this URL are going away or being replaced, and
    // `shapeText` caches by `text|fontUrl` — the documented requirement.
    invalidateShapeCache(url);
    revokeObjectUrl(url);
  }
  unregisterFontFace(key);
}

// ------------------------------------------------------------------- public

const stripBytes = ({ key, label, addedAt }: StoredFont): CustomFont => ({ key, label, addedAt });

/**
 * Parses a candidate file without storing it: the dialog needs the family
 * name to prefill its label field, and needs the rejection message before
 * the user commits.
 */
export async function inspectFontFile(
  file: File
): Promise<{ bytes: ArrayBuffer; label: string; key: string } | { error: string }> {
  let bytes: ArrayBuffer;
  try {
    bytes = await file.arrayBuffer();
  } catch {
    return { error: "That file could not be read." };
  }
  if (bytes.byteLength === 0) return { error: "That file is empty." };

  let font: opentype.Font;
  try {
    font = opentype.parse(bytes);
  } catch {
    return {
      error:
        "That file isn't a font this app can read. Upload an uncompressed .ttf or .otf — " +
        "web fonts (.woff, .woff2) are compressed and can't be shaped here.",
    };
  }
  if (!font.glyphs || font.glyphs.length === 0) {
    return { error: "That font has no glyphs in it." };
  }

  const fallback = file.name.replace(/\.[^.]+$/, "") || "Uploaded font";
  const label = familyNameFrom(font, fallback);
  return { bytes, label, key: customFontKey(label, bytes) };
}

/**
 * Validates, stores, and activates an uploaded font. `label` overrides the
 * name read from the font's own `name` table; the key never depends on it,
 * so renaming an upload cannot fork it into a second entry.
 */
export async function addCustomFont(
  file: File,
  label?: string
): Promise<CustomFont | { error: string }> {
  const inspected = await inspectFontFile(file);
  if ("error" in inspected) return inspected;

  const { bytes, key } = inspected;
  const row: StoredFont = {
    key,
    label: (label ?? inspected.label).trim() || inspected.label,
    addedAt: Date.now(),
    bytes,
  };

  // Re-adding an existing key replaces the bytes under a URL that shaped
  // results are cached against, so the old URL and FontFace go first.
  deactivate(key);

  memoryStore.set(key, row);
  await withStore("readwrite", (s) => s.put(row) as IDBRequest);
  activate(row);

  return stripBytes(row);
}

export async function listCustomFonts(): Promise<CustomFont[]> {
  const rows = await readAll();
  return rows.sort((a, b) => a.addedAt - b.addedAt).map(stripBytes);
}

export async function removeCustomFont(key: string): Promise<void> {
  deactivate(key);
  memoryStore.delete(key);
  await withStore("readwrite", (s) => s.delete(key) as IDBRequest);
}

/**
 * Loads every stored font, creates its object URL and registers its
 * FontFace, and reports what is now available. Called once at boot: until it
 * resolves, `customFontUrl` answers `null` for everything and a block on a
 * custom font renders in the Noto Sans fallback for a frame or two.
 */
export async function primeCustomFonts(): Promise<CustomFont[]> {
  const rows = await readAll();
  for (const row of rows) {
    memoryStore.set(row.key, row);
    activate(row);
  }
  return rows.sort((a, b) => a.addedAt - b.addedAt).map(stripBytes);
}

/**
 * The synchronous lookup the render path needs — `useShapedGlyphs` computes
 * a font URL during render, so this cannot be async. Answers only for fonts
 * already activated by `primeCustomFonts` or `addCustomFont`.
 */
export function customFontUrl(key: string): string | null {
  return urlCache.get(key) ?? null;
}

/** Async form: activates the font on demand if it is stored but not yet primed. */
export async function getCustomFontUrl(key: string): Promise<string | null> {
  const cached = urlCache.get(key);
  if (cached) return cached;
  const row = await readOne(key);
  if (!row) return null;
  activate(row);
  return urlCache.get(key) ?? null;
}

/**
 * Font-URL precedence: built-ins first, then the custom registry, then the
 * fallback family. Custom keys are namespaced (`custom-…`) so a built-in can
 * never be shadowed, but the order is stated explicitly rather than relying
 * on that.
 *
 * `lookup` is a parameter so this stays testable without a browser: the
 * default is the module's own registry.
 */
export function pickFontUrl(
  fontFamily: string,
  builtIns: Record<string, string>,
  fallbackKey: string,
  lookup: (key: string) => string | null = customFontUrl
): string {
  return builtIns[fontFamily] ?? lookup(fontFamily) ?? builtIns[fallbackKey];
}

/** True when nothing can shape this family — a saved project naming a font this browser doesn't have. */
export function isFontUnavailable(
  fontFamily: string,
  builtIns: Record<string, string>,
  lookup: (key: string) => string | null = customFontUrl
): boolean {
  return !builtIns[fontFamily] && !lookup(fontFamily);
}

/** Test seam: drops every activation and cached record from this session. */
export function resetCustomFontsForTest(): void {
  for (const key of [...urlCache.keys()]) deactivate(key);
  memoryStore.clear();
}
