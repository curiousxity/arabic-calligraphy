// The authoring preview for the stroke library. Run:
//   npx --yes tsx scripts/pen/preview.mjs <formId>... [--phrase "أم أيمن"] [--out DIR] [--blank]
//
// Each form is drawn on its reference plate (scripts/pen/plates.json maps a
// form id to { file, originPx, pxPerNuqta, vector?, vectorAt? }, with file
// relative to HARF_PLATES) or, with no entry or --blank, on a blank sheet.
// The ink is red at half strength so overlaps deepen, the centre lines and
// nodes blue, and a vector-set piece named by `vector` grey underneath
// (placed at `vectorAt`, nuqta from the form's origin; the vector set is a
// reference only, never copied into penData). A phrase is drawn as the app
// draws it. PNGs land in --out (default .superpowers/pen-preview/, which
// git ignores). Plates are local research material and are never committed.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(DIR, "../..");
const PLATES = process.env.HARF_PLATES ?? "//monas/homes/monas/Mohammed/Calligraphy resources/plates";
const { loadPenLibrary, NUQTA } = await import("../../src/lib/penLibrary.ts");
const { previewForms, previewPhrase } = await import("../../src/lib/penPreview.ts");
const { MARK_GROUPS } = await import("../../src/lib/markLibraryData.ts");
const { parseSvgPath } = await import("../../src/lib/svgPath.ts");
const { flattenContours } = await import("../../src/lib/strokeCuts.ts");

const args = process.argv.slice(2);
let out = path.join(ROOT, ".superpowers/pen-preview");
let phrase = null, blank = false;
const ids = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") out = path.resolve(args[++i]);
  else if (args[i] === "--phrase") phrase = args[++i];
  else if (args[i] === "--blank") blank = true;
  else ids.push(args[i]);
}
if (!ids.length && !phrase) {
  console.error("usage: preview.mjs <formId>... [--phrase TEXT] [--out DIR] [--blank]");
  process.exit(2);
}

const lib = loadPenLibrary();
const plates = JSON.parse(fs.readFileSync(path.join(DIR, "plates.json"), "utf8"));
const items = [];
for (const id of ids) {
  if (!lib.forms.has(id)) { console.error(`no form ${id}`); process.exit(1); }
  const ref = blank ? null : plates[id] ?? null;
  const plate = ref ? { file: path.join(PLATES, ref.file), originPx: ref.originPx, pxPerNuqta: ref.pxPerNuqta } : null;
  const p = previewForms(lib, [id], plate);
  let underlay = [];
  if (ref?.vector) {
    const item = MARK_GROUPS.flatMap((g) => g.items).find((m) => m.id === ref.vector);
    if (!item) { console.error(`no vector piece ${ref.vector}`); process.exit(1); }
    // vector-set units are the library's (48 per pen): place at vectorAt (nuqta) from the form's origin
    const at = ref.vectorAt ?? [0, 0];
    const k = plate.pxPerNuqta / NUQTA;
    underlay = flattenContours(parseSvgPath(item.d), 16).map((c) => c.map(([x, y]) => [plate.originPx[0] + (x + at[0] * NUQTA) * k, plate.originPx[1] + (y + at[1] * NUQTA) * k]));
  }
  items.push({ name: id, plate: plate?.file ?? null, ...p, underlay });
}
if (phrase) {
  const p = previewPhrase(lib, phrase);
  if ("missing" in p) { console.error(`no pen forms yet for: ${p.missing.join(" ")}`); process.exit(1); }
  items.push({ name: `phrase-${phrase.replace(/\s+/g, "_")}`, plate: null, ...p, underlay: [] });
}

fs.mkdirSync(out, { recursive: true });
const json = path.join(out, "preview.json");
fs.writeFileSync(json, JSON.stringify({ items }));
const r = spawnSync("python", ["-I", "-X", "utf8", path.join(DIR, "overlay.py"), json, out], { stdio: "inherit" });
process.exit(r.status ?? 1);
