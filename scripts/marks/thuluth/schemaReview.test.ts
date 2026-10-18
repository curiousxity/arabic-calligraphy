// Builds the join review page (schemaReview.html + the schema's data) for the
// letter forms a phrase needs. Run only on purpose:
//   SCHEMA_REVIEW_OUT=<file.html> [SCHEMA_REVIEW_PHRASE=<text>] npx vitest run scripts/marks/thuluth/schemaReview.test.ts
// It is a vitest file because the forms, stand-ins and anchors it shows are
// computed by src/lib/tarkibSchema.ts, and vitest is the TypeScript runner
// this repo has. Skipped in the normal suite.
import { it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { loadTarkibLibrary } from "../../../src/lib/tarkibSchema";
import { analyzePhrase } from "../../../src/lib/tarkibText";

const OUT = process.env.SCHEMA_REVIEW_OUT;
const PHRASE = process.env.SCHEMA_REVIEW_PHRASE ?? "أُمّ أَيْمَن الحُبّ حَيَاتِي";
const TITLES: Record<string, string> = { standalone: "standalone", starting: "starting", middle: "middle", finishing: "finishing" };

it.skipIf(!OUT)("writes the join review page", async () => {
  const lib = await loadTarkibLibrary();
  const seen = new Set<string>();
  const groups: unknown[] = [];
  for (const l of analyzePhrase(PHRASE).words.flatMap((w) => w.runs.flatMap((r) => r.letters))) {
    const k = `${l.skeleton}|${l.form}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const glyph = { standalone: l.char, starting: l.char + "ـ", middle: "ـ" + l.char + "ـ", finishing: "ـ" + l.char }[l.form];
    const pieces = [...(lib.single.get(k) ?? []), ...(lib.multi.get(k) ?? [])].map((s) => {
      const it = lib.items.get(s.itemId)!;
      return { uid: `${k}:${s.id}`, id: s.id, key: k, name: it.name, d: it.d, w: it.w, h: it.h, entry: s.entry, exit: s.exit,
        stretch: s.stretch, letters: s.letters, standIn: !!s.standIn };
    });
    groups.push({ glyph, title: `${l.skeleton} ${TITLES[l.form]}`, pieces });
  }
  const page = readFileSync("scripts/marks/thuluth/schemaReview.html", "utf8")
    .replace("__DATA__", JSON.stringify(groups).replaceAll("</", "<\\/"));
  writeFileSync(OUT!, page);
});
