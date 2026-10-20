// Our ink, as the app draws it, for a side-by-side with the reference (scripts/pen/sidebyside.py).
//   npx tsx scripts/pen/ink.mjs OUT.json "phrase"      a phrase laid out on its line
//   npx tsx scripts/pen/ink.mjs OUT.json --form ID      one letter form at the origin
// Writes { rings: [[x, y], ...][] } in library units (NUQTA to the nuqta), y down, 0 on the line.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
const R = pathToFileURL(path.resolve("src/lib")).href + "/";
const { loadPenLibrary, formPaths, NUQTA, PEN } = await import(R + "penLibrary.ts");
const { defaultLayout, layoutGeometry } = await import(R + "penLayout.ts");
const { sweepPath, unionPolygons } = await import(R + "penSweep.ts");
const { fitPolygons } = await import(R + "penFit.ts");
const { flattenContours } = await import(R + "strokeCuts.ts");
const lib = loadPenLibrary();
const [out, a, b] = process.argv.slice(2);
let cmds;
if (a === "--form") {
  const f = formPaths(lib, b, [0, 0]);
  const inks = [...[f.body, f.exit, ...f.strokes, ...f.dots].filter(Boolean).map((p) => sweepPath(p, PEN)), ...f.drawn.map((d) => [d])];
  cmds = fitPolygons(unionPolygons(inks), 0.25);
} else {
  const lay = defaultLayout(lib, a);
  if ("missing" in lay) { console.error("no pen forms for", lay.missing.join(" ")); process.exit(1); }
  cmds = layoutGeometry(lib, lay).union;
}
fs.writeFileSync(out, JSON.stringify({ nuqta: NUQTA, rings: flattenContours(cmds, 24) }));
