/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  addCustomFont,
  customFontKey,
  customFontUrl,
  describeFontKey,
  getCustomFontUrl,
  hashBytes,
  inspectFontFile,
  isCustomFontKey,
  isFontUnavailable,
  listCustomFonts,
  pickFontUrl,
  primeCustomFonts,
  removeCustomFont,
  resetCustomFontsForTest,
  setShapeCacheInvalidator,
  slugifyFamily,
} from "./customFonts";

// Real font bytes, not a fixture: validation is `opentype.parse` itself, so a
// hand-written buffer would test the shape of the mock rather than whether a
// font this app can actually shape is accepted. (Same rule the diacritics
// suite follows for shaping — see CLAUDE.md.)
const FONT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public/fonts"
);

const readFont = (name: string) => new Uint8Array(fs.readFileSync(path.join(FONT_DIR, name))).buffer;

const fileFrom = (bytes: ArrayBuffer, name: string) => new File([bytes], name);

const AMIRI = readFont("Amiri.ttf");
const LATEEF = readFont("Lateef.ttf");

beforeEach(() => {
  resetCustomFontsForTest();
  setShapeCacheInvalidator(() => {});
});

describe("slugifyFamily", () => {
  it("reduces a family name to a CSS-ident-safe slug", () => {
    expect(slugifyFamily("Noto Naskh Arabic")).toBe("noto-naskh-arabic");
    expect(slugifyFamily("  Amiri  ")).toBe("amiri");
    expect(slugifyFamily("Scheherazade New 2.0")).toBe("scheherazade-new-2-0");
  });

  it("never returns an empty or hyphen-edged slug", () => {
    expect(slugifyFamily("")).toBe("font");
    expect(slugifyFamily("!!!")).toBe("font");
    expect(slugifyFamily("---x---")).toBe("x");
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugifyFamily("A very long family name indeed for one font");
    expect(slug.length).toBeLessThanOrEqual(24);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("customFontKey", () => {
  it("is stable for the same bytes and differs for different bytes", () => {
    expect(customFontKey("Amiri", AMIRI)).toBe(customFontKey("Amiri", AMIRI));
    expect(customFontKey("Amiri", AMIRI)).not.toBe(customFontKey("Amiri", LATEEF));
  });

  it("keeps two versions of one family apart", () => {
    // Same declared family, different bytes — the point of hashing the file.
    expect(customFontKey("Naskh", AMIRI)).not.toBe(customFontKey("Naskh", LATEEF));
  });

  it("is recognisable as custom and safe to use as a CSS family name", () => {
    const key = customFontKey("Amiri", AMIRI);
    expect(isCustomFontKey(key)).toBe(true);
    expect(key).toMatch(/^custom-[a-z0-9-]+-[0-9a-f]{8}$/);
  });

  it("hashes to eight hex digits", () => {
    expect(hashBytes(AMIRI)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("describeFontKey", () => {
  it("recovers a readable family from a custom key", () => {
    expect(describeFontKey("custom-noto-naskh-arabic-1a2b3c4d")).toBe("Noto Naskh Arabic");
  });

  it("shows anything else verbatim", () => {
    expect(describeFontKey("FatemiMaqala")).toBe("FatemiMaqala");
    expect(describeFontKey("custom-but-not-really")).toBe("custom-but-not-really");
  });
});

describe("inspectFontFile", () => {
  it("accepts a real font and reads its family name", async () => {
    const result = await inspectFontFile(fileFrom(AMIRI, "Amiri.ttf"));
    if ("error" in result) throw new Error(`expected the font to parse: ${result.error}`);
    expect(result.label.toLowerCase()).toContain("amiri");
    expect(result.key).toBe(customFontKey(result.label, AMIRI));
  });

  it("rejects a truncated copy of that same font", async () => {
    const truncated = AMIRI.slice(0, 512);
    const result = await inspectFontFile(fileFrom(truncated, "Amiri.ttf"));
    expect("error" in result).toBe(true);
  });

  it("rejects bytes that are not a font at all", async () => {
    const garbage = new Uint8Array(4096).fill(0x41).buffer;
    const result = await inspectFontFile(fileFrom(garbage, "notes.txt"));
    expect("error" in result).toBe(true);
  });

  it("rejects an empty file", async () => {
    const result = await inspectFontFile(fileFrom(new ArrayBuffer(0), "empty.ttf"));
    expect("error" in result).toBe(true);
  });
});

describe("the registry", () => {
  it("stores an uploaded font, lists it, and resolves a URL for it", async () => {
    const added = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"));
    if ("error" in added) throw new Error(added.error);

    expect(await listCustomFonts()).toEqual([added]);
    expect(customFontUrl(added.key)).toBeTruthy();
    expect(await getCustomFontUrl(added.key)).toBe(customFontUrl(added.key));
  });

  it("honours an explicit label without changing the key", async () => {
    const auto = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"));
    const named = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"), "My Naskh");
    if ("error" in auto || "error" in named) throw new Error("expected both adds to succeed");

    expect(named.label).toBe("My Naskh");
    expect(named.key).toBe(auto.key);
    expect(await listCustomFonts()).toHaveLength(1);
  });

  it("clears the shape cache for the old URL when bytes are replaced under a key", async () => {
    const invalidate = vi.fn();
    setShapeCacheInvalidator(invalidate);

    const first = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"));
    if ("error" in first) throw new Error(first.error);
    const firstUrl = customFontUrl(first.key);

    await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"), "Renamed");

    expect(invalidate).toHaveBeenCalledWith(firstUrl);
    expect(customFontUrl(first.key)).not.toBe(firstUrl);
  });

  it("keeps two fonts apart and removes only the one asked for", async () => {
    const a = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"));
    const b = await addCustomFont(fileFrom(LATEEF, "Lateef.ttf"));
    if ("error" in a || "error" in b) throw new Error("expected both adds to succeed");

    await removeCustomFont(a.key);

    expect(await listCustomFonts()).toEqual([b]);
    expect(customFontUrl(a.key)).toBeNull();
    expect(customFontUrl(b.key)).toBeTruthy();
  });

  it("revokes and invalidates on removal", async () => {
    const invalidate = vi.fn();
    const added = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"));
    if ("error" in added) throw new Error(added.error);
    const url = customFontUrl(added.key);

    setShapeCacheInvalidator(invalidate);
    await removeCustomFont(added.key);

    expect(invalidate).toHaveBeenCalledWith(url);
    expect(await getCustomFontUrl(added.key)).toBeNull();
  });

  it("primes what the session already holds", async () => {
    const added = await addCustomFont(fileFrom(AMIRI, "Amiri.ttf"));
    if ("error" in added) throw new Error(added.error);

    expect(await primeCustomFonts()).toEqual([added]);
    expect(customFontUrl(added.key)).toBeTruthy();
  });
});

describe("pickFontUrl", () => {
  const builtIns = { NotoSans: "/fonts/NotoSans.ttf", Amiri: "/fonts/Amiri.ttf" };
  const lookup = (key: string) => (key === "custom-x-0000ffff" ? "blob:custom-x" : null);

  it("prefers a built-in", () => {
    expect(pickFontUrl("Amiri", builtIns, "NotoSans", lookup)).toBe("/fonts/Amiri.ttf");
  });

  it("falls through to the custom registry", () => {
    expect(pickFontUrl("custom-x-0000ffff", builtIns, "NotoSans", lookup)).toBe("blob:custom-x");
  });

  it("falls back to the fallback family when nothing resolves", () => {
    expect(pickFontUrl("custom-gone-12345678", builtIns, "NotoSans", lookup)).toBe(
      "/fonts/NotoSans.ttf"
    );
  });

  it("reports an unresolvable family as unavailable, and a resolvable one as not", () => {
    expect(isFontUnavailable("custom-gone-12345678", builtIns, lookup)).toBe(true);
    expect(isFontUnavailable("custom-x-0000ffff", builtIns, lookup)).toBe(false);
    expect(isFontUnavailable("Amiri", builtIns, lookup)).toBe(false);
  });
});
