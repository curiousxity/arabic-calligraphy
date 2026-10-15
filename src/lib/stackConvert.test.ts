/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { describe, it, expect, beforeAll } from "vitest";
import * as opentype from "opentype.js";
import type { HarfBuzzGlyph } from "./normalizeGlyphs";

// harfbuzzjs's package entrypoint (`index.js`) is CommonJS whose
// `module.exports` is itself `new Promise(...)` — Node's ESM/CJS interop
// treats a thenable default export as "auto-awaitable" during static
// `import`, which throws ("Method Promise.prototype.then called on
// incompatible receiver [object Module]") before any of this file's own
// code runs. Loading it via `require` (as harfbuzzjs's own README/tests
// do in Node) sidesteps that interop entirely — this is a Node-in-Vitest
// loading quirk specific to this package shape, unrelated to how the
// app itself loads it (the app is bundled by Vite/Rolldown, which
// doesn't have this issue).
const hbjsModule = createRequire(import.meta.url)("harfbuzzjs");
import { normalizeGlyphs } from "./normalizeGlyphs";

// harfbuzzjs's own module shape varies across bundlers/loaders (its main
// export can itself be the init promise, or wrapped in one or two levels
// of `{ default }` depending on how ESM/CJS interop resolves it) — this
// mirrors the resolution `harfbuzz.ts`'s own (private) `resolveHbLoader`
// performs, so the real WASM module loads the same way here as it does
// in the app.
function resolveHbLoader(mod: unknown): Promise<HbModule> {
  let m: unknown = mod;
  let rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec?.default !== undefined) m = rec.default;

  if (typeof m === "function") {
    return (m as () => Promise<HbModule> | HbModule)() as Promise<HbModule>;
  }
  rec = m && typeof m === "object" ? (m as Record<string, unknown>) : null;
  if (rec && typeof rec.then === "function") return m as Promise<HbModule>;

  throw new Error("Unable to resolve harfbuzzjs loader in test");
}

type HbModule = {
  createBlob: (data: ArrayBuffer | Uint8Array) => { destroy?: () => void };
  createFace: (blob: unknown, index: number) => { destroy?: () => void };
  createFont: (face: unknown) => {
    setScale?: (x: number, y: number) => void;
    destroy?: () => void;
  };
  createBuffer: () => {
    addText: (text: string) => void;
    guessSegmentProperties?: () => void;
    setDirection?: (direction: string) => void;
    setScript?: (script: string) => void;
    setLanguage?: (language: string) => void;
    json?: (font?: unknown) => unknown[];
    destroy?: () => void;
  };
  shape: (font: unknown, buffer: unknown, features?: string) => void;
};

const hbPromise = resolveHbLoader(hbjsModule);

/**
 * Shapes `text` with a real font via real harfbuzzjs, mirroring
 * `shapeText` in `harfbuzz.ts` (RTL direction, `arab` script, `ar`
 * language). Doesn't reuse `shapeText` itself because that function
 * fetches the font over the network (`fetch(fontUrl)`) — here the font
 * bytes come straight from `public/fonts/` via `fs`, which is the only
 * difference from the app's own shaping path.
 *
 * This is the fix for the bug this suite exists to catch (C1): the
 * previous version of this file hand-wrote `{ g, cl }` glyph objects
 * encoding an assumption about HarfBuzz's clustering that HarfBuzz does
 * not satisfy (one cluster per character) — the tests passed while the
 * feature was completely inert against real shaped text. Every glyph
 * used below comes from actually shaping real text with a real font.
 */
async function shapeReal(
  text: string,
  fontFile: string
): Promise<{ glyphs: HarfBuzzGlyph[]; font: opentype.Font }> {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const fontPath = path.resolve(dir, "../../public/fonts", fontFile);
  const fontData = fs.readFileSync(fontPath);
  const arrayBuffer = fontData.buffer.slice(
    fontData.byteOffset,
    fontData.byteOffset + fontData.byteLength
  );
  const parsedFont = opentype.parse(arrayBuffer);
  const upm = parsedFont.unitsPerEm || 1000;

  const hb = await hbPromise;
  const blob = hb.createBlob(new Uint8Array(fontData));
  const face = hb.createFace(blob, 0);
  const font = hb.createFont(face);
  const buffer = hb.createBuffer();

  try {
    if (typeof font.setScale === "function") font.setScale(upm, upm);
    buffer.addText(text);
    if (typeof buffer.guessSegmentProperties === "function") {
      buffer.guessSegmentProperties();
    }
    if (typeof buffer.setDirection === "function") buffer.setDirection("rtl");
    if (typeof buffer.setScript === "function") buffer.setScript("arab");
    if (typeof buffer.setLanguage === "function") buffer.setLanguage("ar");

    hb.shape(font, buffer);

    let raw: unknown[] = [];
    if (typeof buffer.json === "function") {
      try {
        raw = buffer.json(font);
      } catch {
        raw = buffer.json();
      }
    }

    return { glyphs: normalizeGlyphs(raw as never), font: parsedFont };
  } finally {
    buffer.destroy?.();
    font.destroy?.();
    face.destroy?.();
    blob.destroy?.();
  }
}

import { convertRunToStack, runOutline, splitPieceAtCut, fillerShapes, teardropShape, bendCurveAt } from "./stackConvert";
import { arcBand } from "./stackCurve";
import { joinCenterline } from "./stackJoin";
import { transformFace } from "./stackGeometry";
import { pieceTransform } from "./stackOutline";
import { assembleStackOutline, assembleStackOutlineReport, chainOf } from "./stackOutline";
import { nibFloorFraction, nuqtaUnits } from "./nuqta";
import type { StackJoin, StackPiece } from "../types";
import { flattenContours, findCutZonesSwept, outlineBounds, toSvgCmds } from "./strokeCuts";
import { stackDetectOpts } from "./stackZones";
import { findDetachedMarks, splitContours } from "./detachedMarks";
import type { SvgCmd } from "./svgPath";

const area = (cmds: SvgCmd[]) =>
  flattenContours(cmds).reduce((sum, c) => {
    let a = 0;
    for (let i = 0; i + 1 < c.length; i++) a += c[i][0] * c[i + 1][1] - c[i + 1][0] * c[i][1];
    return sum + Math.abs(a) / 2;
  }, 0);

async function convert(text: string, fontFile: string) {
  const { glyphs, font } = await shapeReal(text, fontFile);
  const unitsPerEm = font.unitsPerEm || 1000;
  const input = {
    glyphs, font, unitsPerEm, shapableText: text, cutPlan: null, diacriticOverrides: [], fontSize: unitsPerEm,
    detachedMarkOverrides: [], fontFamily: fontFile.replace(/\.(ttf|otf)$/, ""),
  };
  return { input, result: convertRunToStack(input) };
}

describe("convertRunToStack", () => {
  beforeAll(async () => {
    const hb = await hbPromise;
    expect(typeof hb.shape).toBe("function");
  });

  // The measured join/unjoined split of مصبح per font (the review's probe).
  // Amiri was [1, 2] until a letter's dots left its body before the join
  // sweep (2026-10-14): the ب's dot sat across the join edge and made the
  // cut illegal, so removing it is what joins the other two pairs.
  const PINNED: Record<string, [number, number]> = {
    "UKIJDiwani.ttf": [3, 0], "Amiri.ttf": [3, 0], "NotoSans.ttf": [2, 1],
  };
  for (const fontFile of ["UKIJDiwani.ttf", "Amiri.ttf", "NotoSans.ttf"]) {
    it(`${fontFile}: one letter piece per base letter of مصبح, a join per adjacent pair or an unjoined report`, async () => {
      const { input, result } = await convert("مصبح", fontFile);
      const letters = result.pieces.filter((p) => p.role === "letter");
      expect(letters).toHaveLength(4);
      expect([result.joins.length, result.unjoined.length]).toEqual(PINNED[fontFile]);
      // Every join splices and the untouched bake reproduces the run's ink,
      // dots included — the joins are real cuts, not a detector artefact.
      const family = fontFile.replace(/\.ttf$/, "");
      const nib = { width: nuqtaUnits(family, input.unitsPerEm), minFraction: nibFloorFraction(family) };
      const { cmds: baked, skipped } = assembleStackOutlineReport(result.pieces, result.joins, nib);
      expect(skipped).toBe(0);
      const original = runOutline(input);
      expect(Math.abs(area(baked) - area(original)) / area(original)).toBeLessThan(0.005);
      for (const m of result.pieces.filter((p) => p.role === "mark")) {
        expect(letters.some((l) => l.id === m.parentId)).toBe(true);
      }
      // Reading order is text order.
      expect(letters.map((l) => l.order).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    });
  }

  // Kufi is one of the faces whose nuqta-scaled floor used to exceed its
  // connector (review I1); the floor now comes from the faces themselves.
  for (const fontFile of ["UKIJDiwani.ttf", "Amiri.ttf", "NotoSans.ttf", "Kufi.ttf"]) {
    it(`${fontFile}: converting and touching nothing reproduces the run's outline, with the real nib`, async () => {
      const { input, result } = await convert("محمد", fontFile);
      const family = fontFile.replace(/\.ttf$/, "");
      const nib = { width: nuqtaUnits(family, input.unitsPerEm), minFraction: nibFloorFraction(family) };
      const original = runOutline(input);
      const { cmds: baked, skipped } = assembleStackOutlineReport(result.pieces, result.joins, nib);
      // Every join's faces resolved to a bridge and spliced.
      // (Amiri's محمد has no cuttable join — its joins are the accepted
      // per-font limitation in stroke-cuts.md — so only its pieces are checked.)
      if (fontFile !== "Amiri.ttf") expect(result.joins.length).toBeGreaterThan(0);
      expect(skipped).toBe(0);
      expect(flattenContours(baked)).toHaveLength(flattenContours(original).length);
      expect(Math.abs(area(baked) - area(original)) / area(original)).toBeLessThan(0.005);
      // No spikes: with the floor taken from the faces, an untouched join
      // adds no points at all — the same count as with no floor.
      const points = (cmds: SvgCmd[]) => flattenContours(cmds).reduce((n, c) => n + c.length, 0);
      const unfloored = assembleStackOutlineReport(result.pieces, result.joins, { ...nib, minFraction: 0 }).cmds;
      expect(points(baked)).toBe(points(unfloored));
      // (Not the run's own count: splitting subdivides the segment a cut
      // crosses, so the baked outline can carry a few more points — UKIJ
      // 1047 vs 1027 — without any of them leaving the outline.)
    });
  }

  it("UKIJDiwani joins every adjacent pair of مصبح by a cut (the coverage sweep's 100%)", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    expect(result.unjoined).toHaveLength(0);
    expect(result.joins).toHaveLength(3);
  });

  it("a word with no joins converts to rigid pieces and an empty join list", async () => {
    const { input, result } = await convert("ادر", "Amiri.ttf");
    expect(result.joins).toHaveLength(0);
    expect(result.unjoined).toHaveLength(0);
    expect(area(assembleStackOutline(result.pieces, [], { width: 100, minFraction: 0.15 })))
      .toBeCloseTo(area(runOutline(input)), 0);
  });

  it("carries an existing tatweel into the earlier letter's piece", async () => {
    const { result } = await convert("مـصبح", "Amiri.ttf");
    const letters = result.pieces.filter((p) => p.role === "letter");
    expect(letters).toHaveLength(4);
  });

  it("a hidden mark is dropped and a lifted mark is lifted, in font units", async () => {
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const base = { glyphs, font, unitsPerEm: upm, shapableText: "بَ", cutPlan: null, fontSize: 100, detachedMarkOverrides: [], fontFamily: "Amiri" };
    const markIdx = glyphs.findIndex((g) => (g.ax ?? 0) === 0);
    expect(markIdx).toBeGreaterThanOrEqual(0);
    const plain = convertRunToStack({ ...base, diacriticOverrides: [] });
    const hidden = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, hidden: true }] });
    const lifted = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, offsetY: -10 }] });
    expect(hidden.pieces.filter((p) => p.role === "mark")).toHaveLength(plain.pieces.filter((p) => p.role === "mark").length - 1);
    // Conversion re-centres on the ink, and the mark is the topmost ink, so
    // compare the mark to its parent rather than to the block origin.
    const rel = (r: typeof plain) => {
      const m = r.pieces.find((p) => p.role === "mark")!;
      const parent = r.pieces.find((p) => p.id === m.parentId)!;
      return m.y - parent.y;
    };
    expect(rel(lifted) - rel(plain)).toBeCloseTo((-10 * upm) / 100, 6);
  });

  it("carries a tashkeel offsetX into the mark piece's x, in font units", async () => {
    const { glyphs, font } = await shapeReal("بَ", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const base = { glyphs, font, unitsPerEm: upm, shapableText: "بَ", cutPlan: null, fontSize: 100, detachedMarkOverrides: [], fontFamily: "Amiri" };
    const markIdx = glyphs.findIndex((g) => (g.ax ?? 0) === 0);
    const plain = convertRunToStack({ ...base, diacriticOverrides: [] });
    const moved = convertRunToStack({ ...base, diacriticOverrides: [{ glyphIndex: markIdx, offsetX: 10, offsetY: 0 }] });
    const rel = (r: typeof plain) => {
      const m = r.pieces.find((p) => p.role === "mark")!;
      const parent = r.pieces.find((p) => p.id === m.parentId)!;
      return m.x - parent.x;
    };
    expect(rel(moved) - rel(plain)).toBeCloseTo((10 * upm) / 100, 6);
  });

  it("splits a letter's dots into mark pieces riding on it, at their moved position", async () => {
    const { glyphs, font } = await shapeReal("ب", "Amiri.ttf");
    const upm = font.unitsPerEm || 1000;
    const detected = findDetachedMarks(glyphs, font, upm, new Set(), "Amiri");
    const [, [dot]] = [...detected.entries()][0];
    const input = {
      glyphs, font, unitsPerEm: upm, shapableText: "ب", cutPlan: null,
      diacriticOverrides: [], fontSize: 100, fontFamily: "Amiri",
      detachedMarkOverrides: [{ cluster: dot.cluster, glyphId: dot.glyphId, mark: dot.mark, dx: 80, dy: -60 }],
    };
    const plain = convertRunToStack({ ...input, detachedMarkOverrides: [] });
    const moved = convertRunToStack(input);
    const letter = (r: typeof plain) => r.pieces.find((p) => p.role === "letter")!;
    const mark = (r: typeof plain) => r.pieces.find((p) => p.role === "mark")!;
    expect(plain.pieces.filter((p) => p.role === "mark")).toHaveLength(1);
    expect(mark(plain).parentId).toBe(letter(plain).id);
    expect(mark(moved).x - letter(moved).x - (mark(plain).x - letter(plain).x)).toBeCloseTo(80, 6);
    expect(mark(moved).y - letter(moved).y - (mark(plain).y - letter(plain).y)).toBeCloseTo(-60, 6);
    // The letter piece keeps only the body.
    const rawContours = splitContours(toSvgCmds(font.glyphs.get(glyphs[0].g)!.getPath(0, 0, upm).commands)).length;
    expect(splitContours(letter(plain).cmds)).toHaveLength(rawContours - 1);
  });

  const resolves = (pieces: StackPiece[], joins: StackJoin[]) =>
    joins.every((j) => [j.from, j.to].every((r) => {
      const pc = pieces.find((x) => x.id === r.pieceId);
      return !!pc && r.faceIndex >= 0 && r.faceIndex < pc.faces.length;
    }));

  async function zonesOf(target: StackPiece) {
    const { findCutZonesSwept, DEFAULT_DETECT_OPTS } = await import("./strokeCuts");
    return findCutZonesSwept(flattenContours(target.cmds), { glyphIndex: 0, cluster: 0 },
      { ...DEFAULT_DETECT_OPTS, step: 10, minZoneWidth: 25 });
  }

  it("splitPieceAtCut makes a rider end cap with the same outline and valid joins", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    const nib = { width: 100, minFraction: 0.15 };
    const before = area(assembleStackOutline(result.pieces, result.joins, nib));
    expect(resolves(result.pieces, result.joins)).toBe(true);
    const target = result.pieces.find((p) => p.role === "letter")!;
    const zones = await zonesOf(target);
    expect(zones.length).toBeGreaterThan(0);
    const z = zones[0];
    const split = splitPieceAtCut(result.pieces, result.joins, target.id, { cutX: (z.fromX + z.toX) / 2, angle: z.angle });
    expect(split).not.toBeNull();
    expect(split!.pieces.length).toBe(result.pieces.length + 1);
    expect(split!.joins.length).toBe(result.joins.length + 1);
    expect(resolves(split!.pieces, split!.joins)).toBe(true);
    const after = area(assembleStackOutline(split!.pieces, split!.joins, nib));
    expect(Math.abs(after - before) / before).toBeLessThan(1e-4);

    const body = split!.pieces.find((p) => p.id === target.id)!;
    const cap = split!.pieces.find((p) => p.parentId === body.id && p.role === "letter")!;
    expect(cap).toBeDefined();
    expect(cap.order).toBe(body.order);
    // The cap is the smaller fragment.
    const bb = (p: StackPiece) => { const b = outlineBounds(p.cmds); return (b.x2 - b.x1) * (b.y2 - b.y1); };
    expect(bb(cap)).toBeLessThanOrEqual(bb(body));
    // Chains: body carries cap and later letters; alone carries the cap; cap carries only itself.
    const ps = split!.pieces;
    const withBody = chainOf(ps, body.id, false);
    expect(withBody).toContain(cap.id);
    for (const l of ps.filter((p) => p.role === "letter" && p.order > body.order)) expect(withBody).toContain(l.id);
    expect(chainOf(ps, body.id, true)).toContain(cap.id);
    expect(chainOf(ps, body.id, true).filter((id) => ps.find((p) => p.id === id)!.role === "letter").sort())
      .toEqual([body.id, cap.id].sort());
    expect(chainOf(ps, cap.id, false)).toEqual([cap.id]);
  });

  it("splitting the same body twice keeps piece and join ids unique", async () => {
    const { result } = await convert("مصبح", "UKIJDiwani.ttf");
    const target = result.pieces.find((p) => p.role === "letter")!;
    const zones = await zonesOf(target);
    let cur: { pieces: StackPiece[]; joins: StackJoin[] } = { pieces: result.pieces, joins: result.joins };
    let done = 0;
    for (const z of zones) {
      const cutX = (z.fromX + z.toX) / 2;
      const body = cur.pieces.find((p) => p.id === target.id)!;
      const next = splitPieceAtCut(cur.pieces, cur.joins, body.id, { cutX, angle: z.angle });
      if (!next) continue;
      cur = next;
      if (++done === 2) break;
    }
    expect(done).toBe(2);
    expect(new Set(cur.pieces.map((p) => p.id)).size).toBe(cur.pieces.length);
    expect(new Set(cur.joins.map((j) => j.id)).size).toBe(cur.joins.length);
    expect(resolves(cur.pieces, cur.joins)).toBe(true);
  });
});

describe("fillerShapes", () => {
  const load = (file: string) => {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const buf = fs.readFileSync(path.resolve(dir, "../../public/fonts", file));
    return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  };

  it("takes the font's own tashkeel when it has them", () => {
    const font = load("Amiri.ttf");
    const shapes = fillerShapes(font, font.unitsPerEm, 100);
    const names = shapes.map((s) => s.name);
    expect(names).toContain("fatha");
    expect(names).toContain("shadda");
    expect(names).not.toContain("teardrop");
    expect(shapes.length).toBeGreaterThanOrEqual(5);
    for (const s of shapes) expect(s.cmds.length).toBeGreaterThan(2);
  });

  it("falls back to a nib-width teardrop when the font offers fewer than two marks", () => {
    const font = load("Qahiri.ttf");
    const shapes = fillerShapes(font, font.unitsPerEm, 120);
    expect(shapes.map((s) => s.name)).toContain("teardrop");
    const b = outlineBounds(teardropShape(120).cmds);
    expect(b.x2 - b.x1).toBeGreaterThan(100);
    expect(b.y2 - b.y1).toBeGreaterThan(100);
  });
});

describe("stem zones on converted pieces (pins the measured font-dependence)", () => {
  const stemZones = async (fontFile: string) => {
    const { input, result } = await convert("الملك", fontFile);
    const upm = input.unitsPerEm;
    const letters = result.pieces.filter((p) => p.role === "letter" && p.parentId === undefined);
    return letters.flatMap((p) =>
      findCutZonesSwept(flattenContours(p.cmds), { glyphIndex: 0, cluster: 0 }, stackDetectOpts(upm))
        .filter((z) => Math.abs(z.angle) > 1 && z.toX - z.fromX > 0.1 * upm)
    );
  };
  it("finds a usable upstroke in Amiri", async () => {
    expect((await stemZones("Amiri.ttf")).length).toBeGreaterThan(0);
  });
  it("finds none in UKIJ Diwani, whose stems taper", async () => {
    expect((await stemZones("UKIJDiwani.ttf")).length).toBe(0);
  });
});

describe("bendCurveAt", () => {
  /** A bowl (radius 110, 20 thick, 0.15π–0.85π) with a 20-thick bar welded to each end, as one piece. */
  const bowlWithArms = (): StackPiece => {
    const band = arcBand(100, 120, Math.PI * 0.15, Math.PI * 0.85);
    const endR = [Math.cos(Math.PI * 0.15) * 110, Math.sin(Math.PI * 0.15) * 110];
    const endL = [Math.cos(Math.PI * 0.85) * 110, Math.sin(Math.PI * 0.85) * 110];
    const arm = (x: number, y: number, dir: 1 | -1): SvgCmd[] => [
      { type: "M", x, y: y - 10 }, { type: "L", x: x + dir * 150, y: y - 10 }, { type: "L", x: x + dir * 150, y: y + 10 }, { type: "L", x, y: y + 10 }, { type: "Z" },
    ];
    const cmds = [...band, ...arm(endR[0] - 5, endR[1], 1), ...arm(endL[0] + 5, endL[1], -1)];
    return { id: "b", cmds, x: 0, y: 0, rotation: 0, pivot: [0, 60], homeX: 0, homeY: 0, order: 0, role: "letter", faces: [] };
  };
  const nib = { width: 20, minFraction: 0.5 };

  it("frees the bowl into a join that reproduces it, with a rest bend and a width profile", () => {
    const piece = bowlWithArms();
    const before = area(assembleStackOutline([piece], [], nib));
    const r = bendCurveAt([piece], [], "b", [0, 110])!;
    expect(r).not.toBeNull();
    expect(r.pieces).toHaveLength(2);
    const body = r.pieces.find((p) => p.id === "b")!, far = r.pieces.find((p) => p.id !== "b")!;
    expect(far.parentId).toBe("b");
    expect(r.joins).toHaveLength(1);
    const j = r.joins[0];
    expect(j.id).toBe(r.joinId);
    expect(j.rest).toEqual({ bow: j.bow, depth: j.depth });
    expect(j.profile).toHaveLength(16);
    expect(j.profile![0]).toBeCloseTo(1, 6); expect(j.profile![15]).toBeCloseTo(1, 6);
    const after = area(assembleStackOutline(r.pieces, r.joins, nib));
    expect(Math.abs(after - before) / before).toBeLessThan(0.05);
    const A = transformFace(body.faces[j.from.faceIndex], pieceTransform(body)), B = transformFace(far.faces[j.to.faceIndex], pieceTransform(far));
    const cl = joinCenterline(A, B, j.bow, j.depth ?? 0);
    const mid = [0.125 * cl[0][0] + 0.375 * cl[1][0] + 0.375 * cl[2][0] + 0.125 * cl[3][0], 0.125 * cl[0][1] + 0.375 * cl[1][1] + 0.375 * cl[2][1] + 0.125 * cl[3][1]];
    expect(Math.hypot(mid[0] - 0, mid[1] - 110)).toBeLessThan(6);
  });

  it("widens when depth grows, and the input is untouched", () => {
    const piece = bowlWithArms();
    const snapshot = JSON.stringify(piece);
    const r = bendCurveAt([piece], [], "b", [0, 110])!;
    expect(JSON.stringify(piece)).toBe(snapshot);
    const j = r.joins[0];
    const h = (joins: StackJoin[]) => { const b = outlineBounds(assembleStackOutline(r.pieces, joins, nib)); return b.y2 - b.y1; };
    expect(h([{ ...j, depth: (j.depth ?? 0) + 0.5 }])).toBeGreaterThan(h(r.joins) + 5);
  });

  it("keeps the body id off the arc when the arc is the largest fragment", () => {
    const band = arcBand(100, 120, Math.PI * 0.1, Math.PI * 0.9);
    const endR = [Math.cos(Math.PI * 0.1) * 110, Math.sin(Math.PI * 0.1) * 110];
    const endL = [Math.cos(Math.PI * 0.9) * 110, Math.sin(Math.PI * 0.9) * 110];
    const stub = (x: number, y: number, dir: 1 | -1): SvgCmd[] => [
      { type: "M", x, y: y - 10 }, { type: "L", x: x + dir * 40, y: y - 10 }, { type: "L", x: x + dir * 40, y: y + 10 }, { type: "L", x, y: y + 10 }, { type: "Z" },
    ];
    const piece: StackPiece = { id: "r", cmds: [...band, ...stub(endR[0] - 5, endR[1], 1), ...stub(endL[0] + 5, endL[1], -1)], x: 0, y: 0, rotation: 0, pivot: [0, 60], homeX: 0, homeY: 0, order: 0, role: "letter", faces: [] };
    const neighbour: StackPiece = { id: "n", cmds: stub(200, 20, 1), x: 0, y: 0, rotation: 0, pivot: [220, 20], homeX: 0, homeY: 0, order: 1, role: "letter", faces: [{ a: [200, 10], b: [200, 30], tangent: Math.PI }] };
    const r = bendCurveAt([piece, neighbour], [], "r", [0, 110])!;
    expect(r).not.toBeNull();
    expect(r.pieces.some((p) => p.id === "r")).toBe(true);
    const kept = r.pieces.find((p) => p.id === "r")!;
    expect(area(kept.cmds)).toBeLessThan(2000);
    expect(r.pieces.some((p) => area(p.cmds) > 5000)).toBe(false);
  });

  it("holds identity however the two cut faces happen to be ordered", () => {
    // Mirror and rotate the fixture: the two cuts' point orders then fall
    // every which way, and a join whose faces disagree twists into a
    // figure-eight that cancels its own area.
    const flipX = (cmds: SvgCmd[]): SvgCmd[] => cmds.map((c) => ("x" in c ? { ...c, x: -c.x, ...("x1" in c ? { x1: -c.x1 } : {}), ...("x2" in c ? { x2: -c.x2 } : {}) } : c)) as SvgCmd[];
    const flipY = (cmds: SvgCmd[]): SvgCmd[] => cmds.map((c) => ("y" in c ? { ...c, y: -c.y, ...("y1" in c ? { y1: -c.y1 } : {}), ...("y2" in c ? { y2: -c.y2 } : {}) } : c)) as SvgCmd[];
    const base = bowlWithArms();
    const variants: Array<[string, StackPiece, [number, number]]> = [
      ["flipX", { ...base, cmds: flipX(base.cmds), pivot: [0, 60] }, [0, 110]],
      ["flipY", { ...base, cmds: flipY(base.cmds), pivot: [0, -60] }, [0, -110]],
      ["flipXY", { ...base, cmds: flipY(flipX(base.cmds)), pivot: [0, -60] }, [0, -110]],
      ["rot", { ...base, rotation: 0.7 }, [0, 110]],
    ];
    for (const [name, piece, press] of variants) {
      const before = area(assembleStackOutline([piece], [], nib));
      const r = bendCurveAt([piece], [], piece.id, press);
      expect(r, name).not.toBeNull();
      const after = area(assembleStackOutline(r!.pieces, r!.joins, nib));
      expect(Math.abs(after - before) / before, name).toBeLessThan(0.05);
    }
  });

  it("returns null off a curve", () => {
    const bar: StackPiece = { id: "s", cmds: [{ type: "M", x: 0, y: -10 }, { type: "L", x: 300, y: -10 }, { type: "L", x: 300, y: 10 }, { type: "L", x: 0, y: 10 }, { type: "Z" }], x: 0, y: 0, rotation: 0, pivot: [150, 0], homeX: 0, homeY: 0, order: 0, role: "letter", faces: [] };
    expect(bendCurveAt([bar], [], "s", [150, 0])).toBeNull();
  });
});
