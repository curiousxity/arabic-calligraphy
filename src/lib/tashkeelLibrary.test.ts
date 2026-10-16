/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import { FONT_OPTIONS } from "./fontCatalog";
import { BASIC_GROUP, FONT_EXTRAS, MORE_GROUPS, fontHasAll, tashkeelGroupsFor } from "./tashkeelLibrary";
import { ARABIC_DIACRITIC_RE } from "./diacritics";

// Same as bundledFonts.test.ts: harfbuzzjs via require, and FONT_URLS read
// from source text, because importing useShapedGlyphs.ts pulls in ./harfbuzz.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

const dir = path.dirname(fileURLToPath(import.meta.url));
const fontsDir = path.resolve(dir, "../../public/fonts");
const registry = fs.readFileSync(path.resolve(dir, "../hooks/useShapedGlyphs.ts"), "utf8");
const fontFile = (key: string): string => {
  const m = registry.match(new RegExp(`\\b${key}: "/fonts/([^"]+)"`));
  if (!m) throw new Error(`no FONT_URLS entry for ${key}`);
  return path.join(fontsDir, m[1]);
};
const fontCache = new Map<string, opentype.Font>();
const loadFont = (key: string): opentype.Font => {
  if (!fontCache.has(key)) {
    const data = fs.readFileSync(fontFile(key));
    fontCache.set(key, opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)));
  }
  return fontCache.get(key)!;
};

const ids = (key: string) => tashkeelGroupsFor(loadFont(key), key).map((g) => g.id);

describe("tashkeel library catalogue", () => {
  const all = [BASIC_GROUP, ...MORE_GROUPS, ...Object.values(FONT_EXTRAS)];

  it("never lists the same insertion twice", () => {
    const texts = all.flatMap((g) => g.items.map((it) => it.text));
    expect(new Set(texts).size).toBe(texts.length);
  });

  // A standard mark outside ARABIC_DIACRITIC_RE would escape both
  // stripUnsupportedDiacritics and the per-instance diacritic handles.
  it("offers only marks the rest of the app recognises as diacritics", () => {
    for (const g of [BASIC_GROUP, ...MORE_GROUPS]) {
      for (const it of g.items) {
        for (const ch of it.text) expect(ARABIC_DIACRITIC_RE.test(ch), `${it.name}`).toBe(true);
      }
    }
  });

  it("keys font extras by real font keys whose files carry every glyph", () => {
    for (const [key, group] of Object.entries(FONT_EXTRAS)) {
      expect(FONT_OPTIONS.some((f) => f.value === key), key).toBe(true);
      for (const it of group.items) expect(fontHasAll(loadFont(key), it.text), `${key} ${it.name}`).toBe(true);
    }
  });
});

describe("tashkeelGroupsFor (real fonts)", () => {
  it("offers everything while the font is unknown", () => {
    expect(tashkeelGroupsFor(null, "Amiri").map((g) => g.id)).toEqual(["basic", ...MORE_GROUPS.map((g) => g.id)]);
  });

  it("gives a full-coverage font every standard group", () => {
    expect(ids("Amiri")).toEqual(["basic", "shadda", "other", "quranic", "waqf", "honorific"]);
    const basic = tashkeelGroupsFor(loadFont("Amiri"), "Amiri")[0];
    expect(basic.items).toHaveLength(BASIC_GROUP.items.length);
  });

  it("drops groups a font cannot draw at all", () => {
    // Qahiri and Rana Kufi carry no harakat (see bundled-fonts.md).
    expect(ids("Qahiri")).not.toContain("basic");
    expect(ids("RanaKufi")).not.toContain("basic");
    // Thuluth has the harakat and their shadda pairs but no stop signs.
    expect(ids("Thuluth")).toEqual(expect.arrayContaining(["basic", "shadda"]));
    expect(ids("Thuluth")).not.toContain("waqf");
  });

  it("puts a font's own extras right after the basic marks", () => {
    expect(ids("Urdu").slice(0, 2)).toEqual(["basic", "font-extras"]);
    expect(ids("Amiri")).not.toContain("font-extras");
  });
});

// The Urdu extras' note says "end of a word": check the claim with real
// HarfBuzz. A PUA character is non-joining, so it must leave a word-final
// letter's shape alone (and it would break a join in mid-word).
describe("Jameel Noori honorific extras", () => {
  type HbGlyph = { g: number };
  const shape = async (text: string): Promise<number[]> => {
    let m: unknown = hbjsModule;
    while (m && typeof m === "object" && "default" in (m as object)) m = (m as { default: unknown }).default;
    const hb = await (typeof m === "function" ? (m as () => unknown)() : m) as {
      createBlob(b: Uint8Array): unknown; createFace(b: unknown, i: number): unknown; createFont(f: unknown): unknown;
      createBuffer(): { addText(t: string): void; guessSegmentProperties(): void; json(): HbGlyph[]; destroy(): void };
      shape(f: unknown, b: unknown): void;
    };
    const font = hb.createFont(hb.createFace(hb.createBlob(new Uint8Array(fs.readFileSync(fontFile("Urdu")))), 0));
    const buf = hb.createBuffer();
    buf.addText(text);
    buf.guessSegmentProperties();
    hb.shape(font, buf);
    const out = buf.json().map((g) => g.g);
    buf.destroy();
    return out;
  };

  it("leaves the word's letters unchanged at the end of a word", async () => {
    const word = "علی"; // علی
    for (const it of FONT_EXTRAS.Urdu.items) {
      const plain = await shape(word);
      const marked = await shape(word + it.text);
      expect(marked.length).toBe(plain.length + 1);
      // RTL output is visual order: the mark comes first, then the word.
      expect(marked.slice(1)).toEqual(plain);
    }
  });
});
