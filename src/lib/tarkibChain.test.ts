import { describe, expect, it } from "vitest";
import { loadTarkibLibrary } from "./tarkibSchema";
import { BRIDGE_RADIUS, bridgeRadius, chainPhraseOnLine, chainRun, defaultChoice, endFit, fittingVariants, FIT_SLACK, OVERLAP, pickTrims, variantsFor } from "./tarkibChain";
import { analyzePhrase } from "./tarkibText";
import { assembleStackOutlineReport, pieceTransform } from "./stackOutline";
import { toSegments, transformCmds } from "./stackGeometry";
import { outlineTangents } from "./stackJoin";
import { flattenContours } from "./strokeCuts";
import { pointInPolygon } from "./svgPath";
import { scoreLayout } from "./tarkibScore";
import type { StackPiece } from "../types";

const lib = await loadTarkibLibrary();
const NIB = { width: 48, minFraction: 0.5 };

describe("chainRun", () => {
  it("meets every pair at its anchors and splices whatever joins it made", () => {
    const run = analyzePhrase("حياتي").words[0].runs[0];          // ح ي ا: the alif ends the run
    const c = chainRun(lib, run, defaultChoice(lib, run)!, "a", 0);
    expect(c.meets).toHaveLength(c.pieces.filter((p) => p.role === "letter" && !p.parentId).length - 1);
    for (const m of c.meets) expect(Math.hypot(m.exit[0] - m.entry[0], m.exit[1] - m.entry[1])).toBeLessThan(3);
    expect(assembleStackOutlineReport(c.pieces, c.joins, NIB).skipped).toBe(0);
  });

  it("a stretch lengthens the run by the asked amount and adds a stretch join", () => {
    const s = [...lib.schema.values()].find((p) => p.stretch.length && p.letters.length === 1 && p.letters[0].form === "standalone" && !p.standIn)!;
    const char = Object.entries({ ba: "ب", seen: "س", sad: "ص", ta: "ط", fa: "ف", kaf: "ك", ya: "ى", nun: "ن", ra: "ر", waw: "و", qaf: "ق" })
      .find(([k]) => k === s.letters[0].skeleton)![1];
    const run = analyzePhrase(char).words[0].runs[0];
    const ch = { schemaIds: [s.id], climbs: [], stretch: {} };
    const plain = chainRun(lib, run, ch, "a", 0);
    const long = chainRun(lib, run, { ...ch, stretch: { a0: 96 } }, "a", 0);
    expect(long.width - plain.width).toBeCloseTo(96 * Math.abs(Math.cos(s.stretch[0].angle)), -1);
    expect(long.joins.length).toBe(plain.joins.length + 1);
  });

  it("keeps every dot clear of all the run's ink", () => {
    for (const text of ["أيمن", "حياتي", "تي", "بين"]) {
      const run = analyzePhrase(text).words.flatMap((w) => w.runs).find((r) => r.letters.length > 1)!;
      const c = chainRun(lib, run, defaultChoice(lib, run)!, "a", 0);
      const letters = c.pieces.filter((p) => p.role === "letter");
      const ink = letters.flatMap((p) => flattenContours(transformCmds(p.cmds, pieceTransform(p))) as [number, number][][]);
      for (const d of c.pieces.filter((p) => p.role === "mark")) {
        const centre: [number, number] = [d.x + d.pivot[0], d.y + d.pivot[1]];
        expect(ink.some((poly) => pointInPolygon(centre[0], centre[1], poly)), `${text} ${d.id}`).toBe(false);
      }
    }
  });

  it("puts the dots of a dotless tooth with it", () => {
    const run = analyzePhrase("تي").words[0].runs[0];
    const c = chainRun(lib, run, defaultChoice(lib, run)!, "a", 0);
    expect(c.pieces.filter((p) => p.role === "mark").length).toBeGreaterThanOrEqual(2);
  });
});

describe("defaultChoice", () => {
  it("picks a plain alif: straight, neither the longest nor a curved display form", () => {
    const pick = defaultChoice(lib, analyzePhrase("ا").words[0].runs[0])!.schemaIds[0];
    const it = lib.items.get(lib.schema.get(pick)!.itemId)!;
    expect(it.w / it.h).toBeLessThan(0.15);
  });

  it("picks a typical piece, not the longest display form", () => {
    const run = analyzePhrase("ا").words[0].runs[0];
    const pick = defaultChoice(lib, run)!.schemaIds[0];
    const hs = lib.single.get("alif|standalone")!.filter((s) => s.itemId.startsWith("thuluth-v")).map((s) => lib.items.get(s.itemId)!.h).sort((a, b) => a - b);
    const h = lib.items.get(lib.schema.get(pick)!.itemId)!.h;
    expect(h).toBeGreaterThanOrEqual(hs[Math.floor(hs.length / 4)]);
    expect(h).toBeLessThanOrEqual(hs[Math.ceil((3 * hs.length) / 4) - 1]);
  });
});

describe("matching ends (a calligrapher picks the form drawn for its neighbour)", () => {
  const ymn = analyzePhrase("أيمن").words[0].runs[1];      // ي م ن
  it("after a meem, takes the nun drawn to follow a meem, not one drawn after a tooth", () => {
    // the bought set draws its finishing nuns per predecessor: 46-49 after a
    // tooth, 66 flat from the right, 67-68 after a meem's or ha's tail
    const meem = lib.schema.get("thuluth-v2-141")!;
    expect(endFit(meem, lib.schema.get("thuluth-v3-67")!)).toBeLessThan(endFit(meem, lib.schema.get("thuluth-v3-46")!));
    expect(defaultChoice(lib, ymn)!.schemaIds[2]).toBe("thuluth-v3-67");
  });
  it("offers the composer only variants whose ends fit their neighbours about as well", () => {
    const choice = defaultChoice(lib, ymn)!;
    const alts = fittingVariants(lib, ymn, choice, 2);
    const meem = lib.schema.get(choice.schemaIds[1])!;
    expect(alts.map((s) => s.id)).not.toContain("thuluth-v3-46");
    for (const s of alts) expect(endFit(meem, s)).toBeLessThanOrEqual(endFit(meem, lib.schema.get(choice.schemaIds[2])!) + FIT_SLACK);
  });
});

describe("typical forms", () => {
  it("does not pick a sheet's smallest form: a final nun reads as a nun, not a zay", () => {
    const run = analyzePhrase("أيمن").words[0].runs[1];        // ي م ن
    const ids = defaultChoice(lib, run)!.schemaIds;
    const nun = lib.items.get(lib.schema.get(ids[ids.length - 1])!.itemId)!;
    const ws = lib.single.get("nun|finishing")!.filter((s) => s.itemId.startsWith("thuluth-v")).map((s) => lib.items.get(s.itemId)!.w);
    expect(nun.w).toBeGreaterThan(Math.min(...ws));
  });
});

describe("joins (the user: smooth joints are essential)", () => {
  it("bridges every trimmed meeting without a twist: the two edges never cross", () => {
    for (const text of ["أيمن", "الحب", "حياتي", "محمد"]) for (const run of analyzePhrase(text).words.flatMap((w) => w.runs)) {
      if (run.letters.length < 2) continue;
      const c = chainRun(lib, run, defaultChoice(lib, run)!, "p", 0);
      const byId = new Map(c.pieces.map((p) => [p.id, p]));
      for (const j of c.joins) {
        if (j.land) continue;   // a landing has a face at one end only: its own test above
        const A = byId.get(j.from.pieceId)!, B = byId.get(j.to.pieceId)!;
        const fa = A.faces[j.from.faceIndex], fb = B.faces[j.to.faceIndex];
        const w = (p: [number, number], q: StackPiece): [number, number] => [p[0] + q.x, p[1] + q.y];
        const [p1, p2, q1, q2] = [w(fa.a, A), w(fb.a, B), w(fa.b, A), w(fb.b, B)];
        const side = (o: [number, number], p: [number, number], q: [number, number]) => Math.sign((p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]));
        const cross = side(p1, p2, q1) !== side(p1, p2, q2) && side(q1, q2, p1) !== side(q1, q2, p2);
        expect(cross, `${text} ${j.id}`).toBe(false);
      }
    }
  });

  it("lands a trimmed exit on an entry that cannot be trimmed: the ya of أيمن flows onto the meem's head as one stroke", () => {
    // a middle meem's head cannot be trimmed without its window, so the ya
    // only touched it, its flat end standing a quarter pen above the head
    // (a 66-degree corner). Now the ya is trimmed and a bridge lands its
    // top edge on the head's outline, the bottom edge diving into the ink.
    const run = analyzePhrase("أَيْمَن").words[0].runs.find((r) => r.letters.length >= 3)!;
    const c = chainRun(lib, run, defaultChoice(lib, run)!, "p", 0);
    const j = c.joins.find((x) => x.from.pieceId === "p0" && x.to.pieceId === "p1")!;
    expect(j?.land).toBe(true);
    const ya = c.pieces.find((p) => p.id === "p0")!, meem = c.pieces.find((p) => p.id === "p1")!;
    const f = ya.faces[j.from.faceIndex];
    expect(f).toBeDefined();
    const rep = assembleStackOutlineReport(c.pieces, c.joins, NIB);
    expect(rep.skipped).toBe(0);
    const outline = flattenContours(rep.cmds, 256);
    const head = flattenContours(transformCmds(meem.cmds, pieceTransform(meem)), 256);
    const inHead = (p: number[]) => head.reduce((n, k) => n + (pointInPolygon(p[0], p[1], k as Array<[number, number]>) ? 1 : 0), 0) % 2 === 1;
    const nearestEdge = (p: number[]) => {
      let best = { d: Infinity, dir: [1, 0] };
      for (const k of head) for (let i = 0; i < k.length; i++) {
        const a = k[i], b = k[(i + 1) % k.length], e = [b[0] - a[0], b[1] - a[1]], L = Math.hypot(e[0], e[1]) || 1;
        const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * e[0] + (p[1] - a[1]) * e[1]) / (L * L)));
        const d = Math.hypot(a[0] + e[0] * t - p[0], a[1] + e[1] * t - p[1]);
        if (d < best.d) best = { d, dir: [e[0] / L, e[1] / L] };
      }
      return best;
    };
    // the ya's corner standing clear of the head
    const corner = [f.a, f.b].map((e) => [e[0] + ya.x, e[1] + ya.y]).find((w) => !inHead(w))!;
    expect(corner).toBeDefined();
    const raw = outline.find((k) => k.some((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-3))!;
    const i0 = raw.findIndex((p) => Math.hypot(p[0] - corner[0], p[1] - corner[1]) < 1e-3);
    // walk from the corner the way the bridge goes (away from the ya's own
    // outline: the side whose next point is not on the ya), two units a step
    const yaPts = flattenContours(transformCmds(ya.cmds, pieceTransform(ya)), 256).flat();
    const onYa = (p: number[]) => yaPts.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-3);
    const dir = onYa(raw[(i0 + 1) % raw.length]) ? -1 : 1;
    const along = (d: 1 | -1, n: number) => {
      const pts: number[][] = [];
      let prev = raw[i0], need = 2;
      for (let k = 1; pts.length < n && k < raw.length; k++) {
        const q = raw[(i0 + d * k + raw.length * 4) % raw.length];
        let dd = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
        while (dd >= need && pts.length < n) {
          const t = need / dd;
          prev = [prev[0] + (q[0] - prev[0]) * t, prev[1] + (q[1] - prev[1]) * t];
          pts.push(prev); dd -= need; need = 2;
        }
        need -= dd; prev = q;
      }
      return pts;
    };
    // the bridge ends where the drawn outline reaches the head's outline
    // (the landing is a point of the head's own outline); then the head's
    // outline carries on from there
    let iq = -1;
    for (let k = 1; k < raw.length; k++) {
      const q = raw[(i0 + dir * k + raw.length * 4) % raw.length];
      if (nearestEdge(q).d < 0.02) { iq = (i0 + dir * k + raw.length * 4) % raw.length; break; }
      if (inHead(q) && nearestEdge(q).d > 1) break;
    }
    expect(iq, "the bridge reaches the head").toBeGreaterThanOrEqual(0);
    const q = raw[iq];
    // the bridge, two units a step from the corner, ending at the landing
    const bridge = along(dir, 80).filter((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 1 && Math.hypot(p[0] - corner[0], p[1] - corner[1]) < Math.hypot(q[0] - corner[0], q[1] - corner[1]));
    expect(bridge.length).toBeGreaterThan(3);
    // the head's outline beyond the landing, two units a step, the way the bridge travels
    const travel = [q[0] - bridge[bridge.length - 1][0], q[1] - bridge[bridge.length - 1][1]];
    const hk = head.find((k) => k.some((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.02))!;
    const hi = hk.findIndex((p) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.02);
    const hdir = (hk[(hi + 1) % hk.length][0] - q[0]) * travel[0] + (hk[(hi + 1) % hk.length][1] - q[1]) * travel[1] > 0 ? 1 : -1;
    const after: number[][] = [];
    let prev = q, need = 2;
    for (let k = 1; after.length < 3 && k < hk.length; k++) {
      const p = hk[(hi + hdir * k + hk.length * 4) % hk.length];
      let dd = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      while (dd >= need && after.length < 3) {
        const t = need / dd;
        prev = [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t];
        after.push(prev); dd -= need; need = 2;
      }
      need -= dd; prev = p;
    }
    const turnDeg = (u: number[], v: number[]) => (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])))) * 180) / Math.PI;
    // three steps back along the ya, the corner, the bridge, the landing, three steps on along the head
    const ring = [...along(-dir as 1 | -1, 3).reverse(), raw[i0], ...bridge, q, ...after];
    const turns = ring.slice(1, -1).map((_, k) => {
      const u = [ring[k + 1][0] - ring[k][0], ring[k + 1][1] - ring[k][1]], v = [ring[k + 2][0] - ring[k + 1][0], ring[k + 2][1] - ring[k + 1][1]];
      return turnDeg(u, v);
    });
    // no corner anywhere, the two seams included: the outline turns at no
    // point more than 4 degrees beyond what it turns beside it (the seam
    // test's measure). A bend turns evenly; a corner turns at one point.
    for (let k = 1; k + 1 < turns.length; k++)
      expect(turns[k] - Math.max(turns[k - 1], turns[k + 1]), `step ${k} of ${turns.map((t) => t.toFixed(1)).join(" ")}`).toBeLessThan(4);
  });

  it("leaves no corner where a bridge meets a letter: the drawn outline turns there no more than beside it", () => {
    // the user: "in a proper joint, you should not be able to tell there was
    // a joint at all". Bridges offset from a centre line met the letters'
    // edges at 3 to 35 degrees.
    let seams = 0;
    for (const run of analyzePhrase("أُمّ أَيْمَن الحُبّ حَيَاتِي").words.flatMap((w) => w.runs)) {
      if (run.letters.length < 2) continue;
      const c = chainRun(lib, run, defaultChoice(lib, run)!, "p", 0);
      // finely flattened: the test reads the outline's curves, not its facets
      const outline = flattenContours(assembleStackOutlineReport(c.pieces, c.joins, NIB).cmds, 256);
      const byId = new Map(c.pieces.map((p) => [p.id, p]));
      for (const j of c.joins) {
        if (j.land) continue;   // a landing has a face at one end only: its own test above
        for (const [pid, fi] of [[j.from.pieceId, j.from.faceIndex], [j.to.pieceId, j.to.faceIndex]] as const) {
          const q = byId.get(pid)!, f = q.faces[fi];
          for (const e of [f.a, f.b]) {
            const w: [number, number] = [e[0] + q.x, e[1] + q.y];
            for (const raw of outline) {
              const i = raw.findIndex((p) => Math.hypot(p[0] - w[0], p[1] - w[1]) < 1e-3);
              if (i < 0) continue;
              // the outline as the eye reads it: points two units (1/24 of a
              // pen) apart along it. A split leaves slivers a hundredth of a
              // unit long at a cut, and a cut beside a corner the designer drew
              // leaves a stub a third of a unit long; a corner at the seam
              // itself turns as sharply at any spacing (it was 10 to 34 degrees).
              const along = (dir: 1 | -1, n: number) => {
                const pts: number[][] = [];
                let prev = raw[i], need = 2;
                for (let k = 1; pts.length < n && k < raw.length; k++) {
                  const q = raw[(i + dir * k + raw.length * 4) % raw.length];
                  let d = Math.hypot(q[0] - prev[0], q[1] - prev[1]);
                  while (d >= need && pts.length < n) {
                    const t = need / d;
                    prev = [prev[0] + (q[0] - prev[0]) * t, prev[1] + (q[1] - prev[1]) * t];
                    pts.push(prev); d -= need; need = 2;
                  }
                  need -= d; prev = q;
                }
                return pts;
              };
              const ring = [...along(-1, 3).reverse(), raw[i], ...along(1, 3)];
              const at = (k: number) => ring[3 + k];
              const turn = (k: number) => {
                const u = [at(k)[0] - at(k - 1)[0], at(k)[1] - at(k - 1)[1]], v = [at(k + 1)[0] - at(k)[0], at(k + 1)[1] - at(k)[1]];
                return (Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / Math.hypot(u[0], u[1]) / Math.hypot(v[0], v[1])))) * 180) / Math.PI;
              };
              expect(turn(0) - Math.max(turn(-1), turn(1)), `${run.letters.map((l) => l.char).join("")} ${j.id} ${pid}`).toBeLessThan(4);
              seams++;
              break;
            }
          }
        }
      }
    }
    expect(seams).toBeGreaterThanOrEqual(16);
  });

  it("bends no bridge of the first target tighter than BRIDGE_RADIUS where some trims allow it", () => {
    // ha into a flat-entry ba, trimmed shallow, bent its inner edge at a
    // radius of 6 units: a visible pinch. The lam into the ha has no trims
    // that bend so gently, and keeps its shallow pair.
    let n = 0;
    for (const run of analyzePhrase("أُمّ أَيْمَن الحُبّ حَيَاتِي").words.flatMap((w) => w.runs)) {
      if (run.letters.length < 2) continue;
      const ch = defaultChoice(lib, run)!, c = chainRun(lib, run, ch, "p", 0);
      const byId = new Map(c.pieces.map((p) => [p.id, p]));
      for (const j of c.joins) {
        if (j.land) continue;   // a landing has a face at one end only: its own test above
        const A = byId.get(j.from.pieceId)!, B = byId.get(j.to.pieceId)!;
        const at = (f: StackPiece["faces"][number], q: StackPiece) => ({ ...f, a: [f.a[0] + q.x, f.a[1] + q.y] as [number, number], b: [f.b[0] + q.x, f.b[1] + q.y] as [number, number] });
        const k = Number(j.from.pieceId.slice(1));
        const p = lib.schema.get(ch.schemaIds[k])!, q = lib.schema.get(ch.schemaIds[k + 1])!;
        const w = [Math.cos(p.exit!.angle), Math.sin(p.exit!.angle)];
        const off: [number, number] = [p.exit!.point[0] - w[0] * OVERLAP - q.entry!.point[0], p.exit!.point[1] - w[1] * OVERLAP - q.entry!.point[1]];
        if (pickTrims(p.exit!.options ?? [p.exit!.face!], q.entry!.options ?? [q.entry!.face!], off).miss > 0) continue;
        // the bridge as drawn: seam edges along the letters' outlines where they work
        const pool = c.pieces.flatMap((q) => toSegments(transformCmds(q.cmds, pieceTransform(q))));
        const fa = at(A.faces[j.from.faceIndex], A), fb = at(B.faces[j.to.faceIndex], B);
        expect(bridgeRadius(fa, fb, outlineTangents(pool, fa) ?? undefined, outlineTangents(pool, fb) ?? undefined), j.id).toBeGreaterThanOrEqual(BRIDGE_RADIUS);
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(4);
  });
});

describe("alif use (the user, 2026-10-18)", () => {
  const alif = analyzePhrase("ا").words[0].runs[0].letters[0];
  const ids = (opening: boolean) => variantsFor(lib, alif, opening).map((s) => s.itemId);
  it("never offers the footed alifs, a special case", () => {
    for (const o of [false, true]) for (const id of ["thuluth-v1-15", "thuluth-v1-21", "thuluth-v1-22"]) expect(ids(o)).not.toContain(id);
  });
  it("offers the curved alifs only as the opening letter", () => {
    expect(ids(false)).not.toContain("thuluth-v1-23");
    expect(ids(true)).toContain("thuluth-v1-23");
  });
});

describe("sources", () => {
  it("prefers the first vector set, and takes a second-set piece only where the first has no real form", () => {
    const run = analyzePhrase("الحب").words[0].runs[1];     // ل ح ب: the ح is middle
    const ids = defaultChoice(lib, run)!.schemaIds;
    expect(ids[0].startsWith("thuluth-v")).toBe(true);                  // starting lam: the first set has it
    expect(lib.schema.get(ids[1])!.itemId.startsWith("thuluth-w3-")).toBe(true);   // middle ha: only the second set
  });

  it("takes the first set's alif though the scans hold more alifs", () => {
    const pick = defaultChoice(lib, analyzePhrase("ا").words[0].runs[0])!.schemaIds[0];
    expect(pick.startsWith("thuluth-v")).toBe(true);
  });
});

describe("dotted pieces", () => {
  it("never draws a letter with another letter's dots", () => {
    for (const text of ["الحب", "حياتي", "خبز", "جبل"]) {
      for (const run of analyzePhrase(text).words.flatMap((w) => w.runs)) {
        const ch = defaultChoice(lib, run)!;
        let k = 0;
        for (const id of ch.schemaIds) {
          const s = lib.schema.get(id)!;
          s.letters.forEach((l, i) => { if (s.ownDots) expect(l.char, `${text} ${id}`).toBe(run.letters[k + i].char); });
          k += s.letters.length;
        }
      }
    }
  });
});

describe("chainPhraseOnLine", () => {
  it("reads right to left: no later letter sits right of an earlier one, unless stacked above it", () => {
    for (const text of ["أيمن", "حياتي", "أُمّ أَيْمَن الحُبّ حَيَاتِي"]) {
      const r = chainPhraseOnLine(lib, text);
      if ("error" in r) throw new Error(r.error);
      const order = r.pieces.filter((p) => p.role === "letter" && !p.parentId).sort((a, b) => a.order - b.order).map((p) => p.id);
      expect(scoreLayout({ pieces: r.pieces, joins: r.joins, nib: NIB, shape: [[-1, -1], [1, -1], [1, 1]], readingOrder: order, stretchUsed: {} }).order, text).toBe(0);
    }
  });

  it("composes the first target, every letter there", () => {
    const r = chainPhraseOnLine(lib, "أُمّ أَيْمَن الحُبّ حَيَاتِي");
    if ("error" in r) throw new Error(r.error);
    expect(r.pieceIds.length).toBeGreaterThanOrEqual(10);
    expect(assembleStackOutlineReport(r.pieces, r.joins, NIB).skipped).toBe(0);
  });

  it("refuses a phrase with letters it cannot draw, naming them", () => {
    expect(chainPhraseOnLine(lib, "حب 7")).toEqual({ error: "unsupported", letters: ["7"] });
  });
});


