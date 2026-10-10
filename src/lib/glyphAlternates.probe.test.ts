/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect } from "vitest";
import { normalizeGlyphs, type HarfBuzzGlyph } from "./normalizeGlyphs";
import {
  fallbackFeatureLabel,
  probeAlternates,
  probeStyleSets,
  MAX_PROBE_LETTERS,
  type LetterAlternates,
} from "./glyphAlternates";

// Loaded via `require`, not a static import — see the long note in
// diacritics.test.ts: harfbuzzjs's thenable CJS export throws under
// Vitest's ESM loader before any test code runs.
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");

type HbFace = { getTableFeatureTags: (t: string) => string[]; destroy?: () => void };
type HbModule = {
  createBlob: (data: Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => HbFace;
  createFont: (face: unknown) => { setScale?: (x: number, y: number) => void; destroy?: () => void };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (d: string) => void;
    setScript?: (s: string) => void;
    setLanguage?: (l: string) => void;
    json: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown, features?: string) => void;
};

function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  if (typeof m === "function") return (m as () => Promise<HbModule>)();
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;
  throw new Error("Unable to resolve harfbuzzjs loader in test");
}

const hbPromise = resolveHbLoader(hbjsModule);

/** A real font opened once: its GSUB tags and a shape-with-features function. */
async function openFont(fontFile: string): Promise<{ tags: string[]; shape: (text: string) => (f: string) => HarfBuzzGlyph[] }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const bytes = fs.readFileSync(path.resolve(dir, "../../public/fonts", fontFile));
  const hb = await hbPromise;
  const face = hb.createFace(hb.createBlob(new Uint8Array(bytes)), 0);
  const font = hb.createFont(face);
  return {
    tags: face.getTableFeatureTags("GSUB"),
    shape: (text) => (features) => {
      const buffer = hb.createBuffer();
      try {
        buffer.addText(text);
        buffer.guessSegmentProperties?.();
        buffer.setDirection?.("rtl");
        buffer.setScript?.("arab");
        buffer.setLanguage?.("ar");
        hb.shape(font, buffer, features || undefined);
        return normalizeGlyphs(buffer.json(font) as never);
      } finally {
        buffer.destroy?.();
      }
    },
  };
}

async function probe(fontFile: string, text: string, maxLetters?: number): Promise<LetterAlternates[]> {
  const { tags, shape } = await openFont(fontFile);
  return probeAlternates({
    text,
    alternates: [],
    tags,
    shape: shape(text),
    labelFor: fallbackFeatureLabel,
    maxLetters,
  });
}

const featuresOf = (l: LetterAlternates | undefined) =>
  (l?.options ?? []).flatMap((o) => (o.choice ? [o.choice.feature] : []));

describe("probeAlternates (real HarfBuzz)", () => {
  it("finds Ruqaa's Looped Haa (ss01) on a medial heh, default first", async () => {
    const letters = await probe("Ruqaa.ttf", "هههه");
    const second = letters.find((l) => l.letter === 1);
    expect(second?.options[0].choice).toBeNull();
    expect(featuresOf(second)).toContain("ss01");
  });

  it("finds Ruqaa's justification alternate (jalt) on seen", async () => {
    const letters = await probe("Ruqaa.ttf", "سسس");
    expect(letters.some((l) => featuresOf(l).includes("jalt"))).toBe(true);
  });

  it("de-duplicates values that produce the same glyph (Ruqaa jalt=1 and jalt=2)", async () => {
    const letters = await probe("Ruqaa.ttf", "سسس");
    for (const l of letters) {
      const ids = l.options.map((o) => o.glyphId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("offers nothing in a font with no optional features (Thuluth)", async () => {
    expect(await probe("Thuluth.ttf", "هههه")).toEqual([]);
  });

  it("an option changes only its own letter", async () => {
    const text = "هههه";
    const { tags, shape } = await openFont("Ruqaa.ttf");
    const run = shape(text);
    const letters = probeAlternates({ text, alternates: [], tags, shape: run, labelFor: fallbackFeatureLabel });
    const target = letters.find((l) => l.letter === 1)!;
    const choice = target.options[1].choice!;
    const base = run("");
    const altered = run(`${choice.feature}[1:2]=${choice.value}`);
    for (let i = 0; i < base.length; i++) {
      if (base[i].cl === 1) continue;
      expect(altered[i].g).toBe(base[i].g);
    }
  });

  it("still finds a letter's alternates when it carries a mark", async () => {
    // Ruqaa has fatha, so it survives into the shaped text; the ordinal skips it.
    const letters = await probe("Ruqaa.ttf", "هَههه");
    expect(featuresOf(letters.find((l) => l.letter === 1))).toContain("ss01");
  });

  it("gives a letter swallowed into a ligature no options, without throwing", async () => {
    // Verified: Scheherazade shapes بلا as 931@1 311@0 — lam and alef merge
    // into one glyph at cluster 1, so the alef (letter 2, offset 2) has no
    // glyph of its own. (Amiri and Ruqaa keep two clusters; don't use them here.)
    const letters = await probe("Scheherazade.ttf", "بلا");
    const alef = letters.find((l) => l.letter === 2);
    expect(alef).toBeUndefined();
  });

  it("stops probing at the letter cap", async () => {
    const long = "ه".repeat(MAX_PROBE_LETTERS + 10);
    const letters = await probe("Ruqaa.ttf", long);
    expect(Math.max(...letters.map((l) => l.letter))).toBeLessThan(MAX_PROBE_LETTERS);
  });
});

describe("style sets (real HarfBuzz)", () => {
  it("offers only the sets that change a glyph in this text", async () => {
    const text = "هههه";
    const { tags, shape } = await openFont("Ruqaa.ttf");
    const sets = probeStyleSets({ text, tags, shape: shape(text), labelFor: fallbackFeatureLabel });
    const features = sets.map((s) => s.feature);
    expect(features).toContain("ss01"); // Looped Haa
    expect(features).not.toContain("ss03"); // Tailed Noon: no noon here
    expect(features.every((f) => /^ss\d\d$/.test(f))).toBe(true);
  });

  it("finds none in a font without sets", async () => {
    const text = "هههه";
    const { tags, shape } = await openFont("Thuluth.ttf");
    expect(probeStyleSets({ text, tags, shape: shape(text), labelFor: fallbackFeatureLabel })).toEqual([]);
  });

  it("a per-letter choice overrides a block set on its own letter only", async () => {
    const text = "هههه";
    const { shape } = await openFont("Ruqaa.ttf");
    const run = shape(text);
    const plain = run("");
    const withSet = run("ss01");
    const exempt = run("ss01,ss01[1:2]=0");
    const g = (glyphs: typeof plain, cl: number) => glyphs.find((x) => x.cl === cl)!.g;
    expect(g(withSet, 1)).not.toBe(g(plain, 1));
    expect(g(exempt, 1)).toBe(g(plain, 1)); // back to the plain glyph
    expect(g(exempt, 2)).toBe(g(withSet, 2)); // its neighbour keeps the set
  });

  it("offers 'Without style sets' on a letter the block's set changed", async () => {
    const text = "هههه";
    const { tags, shape } = await openFont("Ruqaa.ttf");
    const letters = probeAlternates({
      text,
      alternates: [],
      styleSets: ["ss01"],
      tags,
      shape: shape(text),
      labelFor: fallbackFeatureLabel,
    });
    const second = letters.find((l) => l.letter === 1)!;
    expect(second.options.map((o) => o.choice?.feature ?? null)).toContain("none");
    expect(second.options.find((o) => o.choice?.feature === "none")!.label).toBe("Without style sets");
  });
});
