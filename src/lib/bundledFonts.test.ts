/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import * as opentype from "opentype.js";
import { PRESETS } from "./presets";

/**
 * Every bundled font, checked through the same two libraries the app uses:
 * HarfBuzz must shape Arabic with it and opentype.js must hand back outlines
 * for what HarfBuzz chose. Either half failing renders a font that looks
 * selectable but draws nothing — Rana Kufi shipped upstream as CFF2, which
 * opentype.js cannot read at all, and only a check like this one says so.
 *
 * The registry is read from source text, not imported: `useShapedGlyphs.ts`
 * pulls in `./harfbuzz`, whose static harfbuzzjs import throws under
 * Vitest's Node loader (see CLAUDE.md). Reading it as text also lets this
 * suite hold the four registration places to each other — see
 * .claude/rules/bundled-fonts.md.
 */

// See diacritics.test.ts for why harfbuzzjs is loaded via `require`.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbModule = {
  createBlob: (data: Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => { setScale?: (x: number, y: number) => void; destroy?: () => void };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (d: string) => void;
    setScript?: (s: string) => void;
    json?: (font?: unknown) => { g: number }[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown) => void;
};

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  for (let i = 0; i < 2; i++) {
    const rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
    if (rec?.default !== undefined) m = rec.default;
  }
  if (typeof m === "function") return (m as () => Promise<HbModule>)();
  const rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;
  throw new Error("Unable to resolve harfbuzzjs loader in test");
}
const hbPromise = resolveHbLoader(hbjsModule);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** `FONT_URLS` as written in useShapedGlyphs.ts: key → file name. */
function registeredFonts(): Map<string, string> {
  const src = read("src/hooks/useShapedGlyphs.ts");
  const body = src.slice(src.indexOf("export const FONT_URLS"), src.indexOf("};", src.indexOf("export const FONT_URLS")));
  return new Map(
    [...body.matchAll(/^\s*(\w+):\s*"\/fonts\/([^"]+)"/gm)].map((m) => [m[1], m[2]])
  );
}

/**
 * Fonts whose licence forbids merging the honorific glyphs in — they ship
 * with the Presets buttons drawing missing-glyph boxes, on purpose. Every
 * other font must carry all of them. Reasons in each font's -LICENSE.txt.
 */
const SHIPS_WITHOUT_HONORIFICS = new Set(["Rabat", "Raqq", "RanaKufi"]);

async function shapedGlyphIds(fontBytes: Buffer, text: string): Promise<number[]> {
  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontBytes));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();
  try {
    buffer.addText(text);
    buffer.guessSegmentProperties?.();
    buffer.setDirection?.("rtl");
    buffer.setScript?.("arab");
    hb.shape(font, buffer);
    return (buffer.json?.(font) ?? []).map((g) => g.g);
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

describe("bundled fonts", () => {
  const fonts = registeredFonts();

  it("finds the registry", () => {
    expect(fonts.size).toBeGreaterThanOrEqual(20);
  });

  it("registers every FONT_URLS entry in @font-face and the picker", () => {
    const css = read("src/index.css");
    const sidebar = read("src/lib/fontCatalog.ts");
    // Noto Sans predates this check: its picker preview names the system
    // family 'Noto Sans Arabic' rather than a bundled @font-face.
    const noFace = [...fonts]
      .filter(([key, file]) => key !== "NotoSans" && !css.includes(`url("/fonts/${file}")`))
      .map(([key]) => key);
    const notInPicker = [...fonts.keys()].filter((key) => !sidebar.includes(`value: "${key}"`));
    expect(noFace, "missing @font-face").toEqual([]);
    expect(notInPicker, "missing from FONT_OPTIONS").toEqual([]);
  });

  for (const [key, file] of registeredFonts()) {
    it(`${key}: HarfBuzz shapes Arabic and opentype.js draws it`, async () => {
      const bytes = fs.readFileSync(path.join(ROOT, "public/fonts", file));
      const parsed = opentype.parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );

      const ids = await shapedGlyphIds(bytes, "محمد");
      expect(ids.length).toBeGreaterThan(0);
      expect(ids, "no .notdef in a plain Arabic name").not.toContain(0);
      for (const id of ids) {
        expect(parsed.glyphs.get(id).path.commands.length, `outline of glyph ${id}`).toBeGreaterThan(0);
      }
    });

    const honorifics = SHIPS_WITHOUT_HONORIFICS.has(key)
      ? "absent by licence"
      : key === "Scheherazade"
        ? "8 of 10 (known gap)"
        : "merged";
    it(`${key}: honorific Presets glyphs ${honorifics}`, () => {
      const bytes = fs.readFileSync(path.join(ROOT, "public/fonts", file));
      const parsed = opentype.parse(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      );
      const mapped = PRESETS.filter((ch) => parsed.charToGlyphIndex(ch) > 0);
      // Scheherazade is short two (U+E841/E842) from before this suite
      // existed — PROGRESS.md, Known limitations.
      const expected = SHIPS_WITHOUT_HONORIFICS.has(key) ? 0 : key === "Scheherazade" ? 8 : PRESETS.length;
      expect(mapped.length).toBe(expected);
    });
  }
});
