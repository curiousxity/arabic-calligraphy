# Stack Arrange: Hug, Fill, Pull — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "Fill a guide shape" on a stack block produce a composition that follows the guide's silhouette: outer letters hug and lean into the edge, tashkeel ornaments busy the gaps, and straight upstrokes are drawn out toward the boundary.

**Architecture:** All geometry stays in the pure solver `src/lib/stackArrange.ts` (font units, never imports `./harfbuzz`). Three post-placement passes are added in order: tilt (inside bisection), stems, fillers (after bisection, at the found scale). The caller (`App.tsx`) supplies filler outlines from the block's font and strips old fillers; the zone detector gains a second sweep base so vertical stems are found by the hand tool and the arranger alike.

**Tech Stack:** TypeScript, Vitest, React 19, react-konva, opentype.js (outlines), harfbuzzjs (only in `App.tsx`'s cached `shapeText`).

**Spec:** `docs/superpowers/specs/2026-10-15-stack-arrange-fill-design.md`

## Global Constraints

- `src/lib/stackArrange.ts`, `stackConvert.ts`, `stackGeometry.ts`, `stackZones.ts`, `strokeCuts.ts` must never import `./harfbuzz` (Vitest cannot load it).
- Tunables are fractions of an em, as `const` at the top of `stackArrange.ts`: `MAX_TILT = Math.PI / 6`, `FILLER_CELL = 0.33`, `FILLER_GAP = 0.06`, `FILLER_SHRINK = 0.6`, `STEM_STEP = 0.02`, `STEM_MIN = 0.1`, `STEM_MAX = 3`.
- Fillers are `role: "mark"`, no `parentId`, `filler: true`, `faces: []`, ids `f1`, `f2`, …; `homeX/homeY` equal their landing `x/y`.
- Letters are never scaled individually; only the whole block's `fontSize` changes. Fillers may be shrunk uniformly by `FILLER_SHRINK`.
- Zone detector tolerances (`maxSlope`, `thicknessTolerance`, `maxEdgeBow`) are not changed. Live-text stroke cuts keep `baseAngles` default `[0]` and `minAspect` default `0`.
- The arranger returns everything through one value; the handler commits with one `updateBlock` (one history step). The arranger never calls `splitStackPiece` (it pushes its own history).
- Run after each task: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test` (and `npm run build` at the end of each phase). The pre-commit hook bumps `package.json`'s patch; expect it in every diff.
- Phases are independent deliverables: Phase 1 = Tasks 1–4, Phase 2 = Tasks 5–8, Phase 3 = Tasks 9–12. Stop after any phase and the app still works.

## Review Focus

1. **A re-run after the user has dragged fillers or caps by hand** must not duplicate them: fillers are stripped by flag, caps are slid not re-cut. Pinned in Task 7 (strip) and Task 10 (idempotence test).
2. **A guide much wider than tall** (one row of many letters) with hugging on: inner gaps may become huge. Expected: letters hug both edges and the fill pass fills the middle; nothing overlaps. Pinned in Task 1 (wide-row test asserts monotone x order and inside) and Task 5 (no filler overlaps ink).
3. **A font with no tashkeel at all** (custom upload): the teardrop alone must be used and the arrange must still succeed. Pinned in Task 6 (`fillerShapes` with fewer than two marks appends the teardrop) and Task 7 (catch around `shapeText` falls back to the teardrop).
4. **A stem whose free end points at another row's letters**: must not be pulled through ink. Pinned in Task 10 (march stops at obstacle contours; test with a blocked chimney).
5. **A square-ish blob** (a nuqta-sized rider or a short wide letter) swept at two bases could yield a zone *across* its stroke and cut it lengthwise. Pinned in Task 9 (`minAspect` test: a bar yields one zone, along its length).

---

### Task 1: Outer letters hug their own band (Phase 1)

**Files:**
- Modify: `src/lib/stackArrange.ts` (`placeRow`, lines 208–231; add `ownSpan` helper)
- Test: `src/lib/stackArrange.test.ts`

**Interfaces:**
- Consumes: existing `bandSpan(poly, top, bottom)`, `Group`, `Row`, `LETTER_GAP`, `MAX_SPREAD`.
- Produces: `function ownSpan(poly: readonly Pt[], g: Group, y: number): [number, number] | null` (module-private), used by Tasks 2 and 3. `placeRow` keeps its signature for now (`Map<string, Pt>`); Task 3 changes it.

- [ ] **Step 1: Write the failing tests**

Append inside `describe("arrangeStackInShape", …)` in `src/lib/stackArrange.test.ts`:

```ts
  it("hugs the shape with the outer letters of a row of three or more", () => {
    // One wide row: four 300-wide letters in a 1600×500 px ellipse.
    const r = arrangeStackInShape({ ...input(), shapePx: ellipse(1600, 500) })!;
    expect(r.rows).toBe(1);
    const scale = r.fontSize / UPM;
    const poly = ellipse(1600, 500).map(([x, y]) => [x / scale, y / scale] as [number, number]);
    const right = groupBox(r.pieces, "p0"), left = groupBox(r.pieces, "p3");
    const rs = bandSpan(poly, right.y1, right.y2)!, ls = bandSpan(poly, left.y1, left.y2)!;
    // Each outer letter's box sits one letter gap (0.08 em) inside the chord at its own band.
    expect(Math.abs(rs[1] - right.x2 - 80)).toBeLessThan(2);
    expect(Math.abs(left.x1 - ls[0] - 80)).toBeLessThan(2);
    // Inner letters sit between them with equal gaps.
    const b1 = groupBox(r.pieces, "p1"), b2 = groupBox(r.pieces, "p2");
    const g0 = right.x1 - b1.x2, g1 = b1.x1 - b2.x2, g2 = b2.x1 - left.x2;
    expect(Math.abs(g0 - g1)).toBeLessThan(1);
    expect(Math.abs(g1 - g2)).toBeLessThan(1);
  });

  it("keeps the spread cap for a row of two", () => {
    const { pieces, joins } = word();
    const two = pieces.filter((p) => p.id === "p0" || p.id === "p1" || p.id === "d1");
    const r = arrangeStackInShape({ pieces: two, joins, shapePx: ellipse(3000, 300), fontSize: 100, unitsPerEm: UPM })!;
    const a = groupBox(r.pieces, "p0"), b = groupBox(r.pieces, "p1");
    expect(a.x1 - b.x2).toBeLessThanOrEqual(1.0 * UPM + 1);
  });
```

- [ ] **Step 2: Run to verify the first fails**

Run: `npx vitest run src/lib/stackArrange.test.ts`
Expected: "hugs the shape…" FAILS (outer letters are capped at one em from each other, not at the edge); "keeps the spread cap…" passes already.

- [ ] **Step 3: Implement `ownSpan` and the n ≥ 3 branch of `placeRow`**

Replace `placeRow` in `src/lib/stackArrange.ts`:

```ts
/** The span the shape offers over one group's own band when its letter sits at `y`. */
function ownSpan(poly: readonly Pt[], g: Group, y: number): [number, number] | null {
  return bandSpan(poly, y + g.box.y1, y + g.box.y2);
}

/**
 * Each group's new letter position. A row of one or two is centred in the
 * row's span, its letters spread up to `MAX_SPREAD` apart. A row of three or
 * more hugs the shape: each outer letter is measured against its *own* band
 * (not the row's union band, which a tall neighbour narrows) and slid out to
 * one gap inside the chord there; the inner letters share the rest equally.
 */
function placeRow(row: Row, poly: readonly Pt[], upm: number): Map<string, Pt> {
  const out = new Map<string, Pt>();
  const b = row.bottom;
  const span = bandSpan(poly, b - height(row.box), b) ?? [row.box.x1, row.box.x2];
  const widths = row.groups.map((g) => width(g.box));
  const total = widths.reduce((s, w) => s + w, 0);
  const n = row.groups.length;
  const minGap = LETTER_GAP * upm;
  const y0 = b - row.box.y2; // row space y=0 lands here
  const ys = row.dys.map((dy) => y0 + dy);
  if (n <= 2) {
    let gap = n > 1 ? (span[1] - span[0] - total) / (n - 1) : 0;
    gap = Math.max(minGap, Math.min(gap, MAX_SPREAD * upm));
    const used = total + gap * (n - 1);
    let right = (span[0] + span[1]) / 2 + used / 2;
    row.groups.forEach((g, i) => { out.set(g.letter.id, [right - g.box.x2, ys[i]]); right -= widths[i] + gap; });
    return out;
  }
  const first = row.groups[0], last = row.groups[n - 1];
  const rightEdge = (ownSpan(poly, first, ys[0]) ?? span)[1] - minGap;
  const leftEdge = (ownSpan(poly, last, ys[n - 1]) ?? span)[0] + minGap;
  const innerTotal = widths.slice(1, n - 1).reduce((s, w) => s + w, 0);
  const free = rightEdge - widths[0] - (leftEdge + widths[n - 1]) - innerTotal;
  const gap = Math.max(minGap, free / (n - 1));
  let right = rightEdge;
  row.groups.forEach((g, i) => { out.set(g.letter.id, [right - g.box.x2, ys[i]]); right -= widths[i] + gap; });
  return out;
}
```

Also make `pack` reserve the two edge margins a hugging row will use, so bisection and placement agree on what fits. In `pack`, replace the `need` line with:

```ts
      // A row of three or more will sit one gap inside each edge; reserve it.
      const need = tryMembers.reduce((s, m) => s + width(m.box), 0) + gap * (tryMembers.length - 1) + (tryMembers.length >= 3 ? 2 * gap : 0);
```

and in `spreadRows`, the matching `need` becomes:

```ts
    const need = row.groups.reduce((s, g) => s + width(g.box), 0) + gap * (row.groups.length - 1) + (row.groups.length >= 3 ? 2 * gap : 0);
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackArrange.test.ts`
Expected: all pass, including the five pre-existing ones.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackArrange.ts src/lib/stackArrange.test.ts
git commit -m "Stack arrange: outer letters hug the shape at their own band"
```

---

### Task 2: Vertical nudge for outer letters (Phase 1)

**Files:**
- Modify: `src/lib/stackArrange.ts` (`placeRow`; add `NUDGE_STEPS`, `nudge`)
- Test: `src/lib/stackArrange.test.ts`

**Interfaces:**
- Consumes: `ownSpan` (Task 1).
- Produces: `function nudge(poly: readonly Pt[], g: Group, y: number): number` (module-private; returns a dy to add to the letter's y).

- [ ] **Step 1: Write the failing tests**

Add to the test file, above `describe("arrangeStackInShape"…`, a circle helper and a short/tall word:

```ts
/** A short, tall, short row on one baseline (order 0 rightmost). */
function shortTallShort() {
  const c = letter("q2", 2, 0, 300, 200);
  const b = letter("q1", 1, 400, 300, 400);
  const a = letter("q0", 0, 800, 300, 200);
  return { pieces: [c, b, a], joins: [] as StackJoin[] };
}
```

Append inside `describe("arrangeStackInShape"…`:

```ts
  it("nudges a short outer letter into the curve, and never in a rectangle", () => {
    const circle = ellipse(1400, 1400);
    const r = arrangeStackInShape({ ...shortTallShort(), shapePx: circle, fontSize: 100, unitsPerEm: UPM })!;
    const a = r.pieces.find((p) => p.id === "q0")!, b = r.pieces.find((p) => p.id === "q1")!, c = r.pieces.find((p) => p.id === "q2")!;
    // All three share a baseline before; in a circle's lower half the band
    // widens upward, so the short outer letters rise off the baseline.
    expect(a.y).toBeLessThan(b.y - 1);
    expect(c.y).toBeLessThan(b.y - 1);
    const rect: Array<[number, number]> = [[-700, -700], [700, -700], [700, 700], [-700, 700]];
    const r2 = arrangeStackInShape({ ...shortTallShort(), shapePx: rect, fontSize: 100, unitsPerEm: UPM })!;
    const a2 = r2.pieces.find((p) => p.id === "q0")!, b2 = r2.pieces.find((p) => p.id === "q1")!;
    expect(Math.abs(a2.y - b2.y)).toBeLessThan(1e-6);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/stackArrange.test.ts -t nudges`
Expected: FAIL on `a.y` vs `b.y` (equal today).

- [ ] **Step 3: Implement `nudge` and apply it to the outer letters**

Add below `CREEP`:

```ts
/** Steps either side of zero when an outer letter looks for a wider band
 *  within ±¼ of its own height. */
const NUDGE_STEPS = 4;
```

Add below `ownSpan`:

```ts
/** How far an outer letter should move vertically (± a quarter of its
 *  height) so its own band is widest; ties keep the smallest move. */
function nudge(poly: readonly Pt[], g: Group, y: number): number {
  const quarter = height(g.box) / 4;
  let bestDy = 0, bestW = -Infinity;
  for (let k = -NUDGE_STEPS; k <= NUDGE_STEPS; k++) {
    const dy = (k / NUDGE_STEPS) * quarter;
    const s = ownSpan(poly, g, y + dy);
    if (!s) continue;
    const w = s[1] - s[0];
    if (w > bestW + 1e-6 || (Math.abs(w - bestW) <= 1e-6 && Math.abs(dy) < Math.abs(bestDy))) { bestW = w; bestDy = dy; }
  }
  return bestDy;
}
```

In `placeRow`'s n ≥ 3 branch, before `rightEdge`/`leftEdge` are computed:

```ts
  ys[0] += nudge(poly, first, ys[0]);
  ys[n - 1] += nudge(poly, last, ys[n - 1]);
```

- [ ] **Step 4: Run all arrange tests**

Run: `npx vitest run src/lib/stackArrange.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackArrange.ts src/lib/stackArrange.test.ts
git commit -m "Stack arrange: outer letters nudge into the curve"
```

---

### Task 3: Outer letters tilt toward the edge, capped at 30° (Phase 1)

**Files:**
- Modify: `src/lib/stackArrange.ts` (`placeRow` return type, `arrangeAt`, `arrangeStackInShape`; add `MAX_TILT`, `edgeLean`, `fitsRotated`, `Placement`)
- Test: `src/lib/stackArrange.test.ts`

**Interfaces:**
- Consumes: `transformPt` from `./stackGeometry`; `pointInPolygon` from `./svgPath`; `chordAt`, `ownSpan`.
- Produces: `type Placement = { x: number; y: number; rotation: number }`; `placeRow` now returns `Map<string, Placement>`; `arrangeAt` returns `{ rows: Row[]; pos: Map<string, Placement> }`. Task 10 reads `pos`.

- [ ] **Step 1: Write the failing tests**

Add a parallelogram helper above the describe:

```ts
/** A parallelogram 1400 wide and 1000 tall whose sides lean right going up (about 27°). */
const PARALLELOGRAM: Array<[number, number]> = [[-700, 500], [700, 500], [1200, -500], [-200, -500]];
```

Append inside `describe("arrangeStackInShape"…`:

```ts
  it("tilts outer letters toward a leaning edge, never past 30°, and keeps them inside", () => {
    const r = arrangeStackInShape({ ...input(), shapePx: PARALLELOGRAM })!;
    const scale = r.fontSize / UPM;
    const letters = r.pieces.filter((p) => p.role === "letter" && p.parentId === undefined);
    const tilted = letters.filter((p) => Math.abs(p.rotation) > 0.1);
    expect(tilted.length).toBeGreaterThan(0);
    for (const p of letters) {
      expect(Math.abs(p.rotation)).toBeLessThanOrEqual(Math.PI / 6 + 1e-9);
      // Leaning right going up is a positive rotation (y-down frame).
      if (Math.abs(p.rotation) > 0.1) expect(p.rotation).toBeGreaterThan(0);
      const g = letterGroups(r.pieces).find((x) => x.letter.id === p.id)!;
      const t = { x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot };
      for (const c of [[g.box.x1, g.box.y1], [g.box.x2, g.box.y1], [g.box.x1, g.box.y2], [g.box.x2, g.box.y2]] as const) {
        const [wx, wy] = transformPt([c[0], c[1]], t);
        expect(pointInPolygon(wx * scale, wy * scale, PARALLELOGRAM), `${p.id} corner inside`).toBe(true);
      }
    }
  });

  it("does not tilt in a rectangle, and a rider turns with its letter", () => {
    const rect: Array<[number, number]> = [[-300, -900], [300, -900], [300, 900], [-300, 900]];
    const r = arrangeStackInShape({ ...input(), shapePx: rect })!;
    for (const p of r.pieces) expect(p.rotation).toBe(0);

    const r2 = arrangeStackInShape({ ...input(), shapePx: PARALLELOGRAM })!;
    const b = r2.pieces.find((p) => p.id === "p1")!, d = r2.pieces.find((p) => p.id === "d1")!;
    expect(d.rotation).toBe(b.rotation);
    // The dot's pivot stays the same distance from the letter's pivot as at conversion (110, -500 offset).
    const bp = [b.pivot[0] + b.x, b.pivot[1] + b.y], dp = [d.pivot[0] + d.x, d.pivot[1] + d.y];
    const before = Math.hypot(110 + 40 - 150, -500 - 40 + 200); // dot pivot (40,-40)+(110,-500) vs letter pivot (150,-200)
    expect(Math.hypot(dp[0] - bp[0], dp[1] - bp[1])).toBeCloseTo(before, 3);
  });
```

Add `import { transformPt, translateCmds } from "./stackGeometry";` (replace the existing `translateCmds` import line).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackArrange.test.ts -t tilt`
Expected: "tilts outer letters…" FAILS (no rotation yet). The rectangle half of the second test passes; the rider half fails only if rotation is nonzero, so it passes trivially until Step 3.

- [ ] **Step 3: Implement tilt**

Add the tunable below `NUDGE_STEPS`:

```ts
/** The most an outer letter leans toward the shape's edge. */
const MAX_TILT = Math.PI / 6;
```

Add `import { pointInPolygon } from "./svgPath";` and change the geometry import to `import { translateCmds, transformPt } from "./stackGeometry";`.

Add after `nudge`:

```ts
export type Placement = { x: number; y: number; rotation: number };

/** The signed angle from vertical of the boundary beside a group at `y`, on
 *  `side`; positive leans right going up (a positive piece rotation, y-down). */
function edgeLean(poly: readonly Pt[], g: Group, y: number, side: "left" | "right"): number {
  const h = height(g.box);
  const top = y + g.box.y1 + 0.01 * h, bottom = y + g.box.y2 - 0.01 * h;
  const ct = chordAt(poly, top), cb = chordAt(poly, bottom);
  if (!ct || !cb) return 0;
  const i = side === "right" ? 1 : 0;
  return Math.atan2(ct[i] - cb[i], bottom - top);
}

/** A group rotated by `rot` about its letter's pivot at (x, y): every box
 *  corner inside the shape and its rotated bounds clear of `neighbour`. */
function fitsRotated(poly: readonly Pt[], g: Group, x: number, y: number, rot: number, neighbour: Box | null, gap: number): boolean {
  const t = { x, y, rotation: rot, pivot: g.letter.pivot };
  const corners: Pt[] = [[g.box.x1, g.box.y1], [g.box.x2, g.box.y1], [g.box.x1, g.box.y2], [g.box.x2, g.box.y2]];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const c of corners) {
    const [wx, wy] = transformPt(c, t);
    if (!pointInPolygon(wx, wy, poly as Array<[number, number]>)) return false;
    x1 = Math.min(x1, wx); y1 = Math.min(y1, wy); x2 = Math.max(x2, wx); y2 = Math.max(y2, wy);
  }
  if (!neighbour) return true;
  const apart = x2 + gap <= neighbour.x1 || x1 - gap >= neighbour.x2 || y2 <= neighbour.y1 || y1 >= neighbour.y2;
  return apart;
}

/** The tilt an outer letter takes: the edge's lean, clamped, halved until it fits (or 0). */
function tiltFor(poly: readonly Pt[], g: Group, x: number, y: number, side: "left" | "right", neighbour: Box | null, gap: number): number {
  let rot = Math.max(-MAX_TILT, Math.min(MAX_TILT, edgeLean(poly, g, y, side)));
  for (let k = 0; k < 6 && Math.abs(rot) > 1e-3; k++) {
    if (fitsRotated(poly, g, x, y, rot, neighbour, gap)) return rot;
    rot /= 2;
  }
  return 0;
}
```

Change `placeRow` to return `Map<string, Placement>`: every `out.set(id, [x, y])` becomes `out.set(id, { x, y, rotation: 0 })`. Then, at the end of the function (both branches), before `return out`, add tilt for the outer letters when `n >= 2`:

```ts
  if (n >= 2) {
    const worldBox = (g: Group, p: Placement): Box =>
      ({ x1: g.box.x1 + p.x, y1: g.box.y1 + p.y, x2: g.box.x2 + p.x, y2: g.box.y2 + p.y });
    const pf = out.get(first.letter.id)!, pl = out.get(last.letter.id)!;
    const nf = n > 2 ? worldBox(row.groups[1], out.get(row.groups[1].letter.id)!) : worldBox(last, pl);
    const nl = n > 2 ? worldBox(row.groups[n - 2], out.get(row.groups[n - 2].letter.id)!) : worldBox(first, pf);
    pf.rotation = tiltFor(poly, first, pf.x, pf.y, "right", nf, minGap);
    pl.rotation = tiltFor(poly, last, pl.x, pl.y, "left", nl, minGap);
  }
```

(To make `first`/`last` available in the n ≤ 2 branch, hoist `const first = row.groups[0], last = row.groups[n - 1];` above the `if (n <= 2)`. Restructure so the tilt block runs once after either placement.)

Change `arrangeAt`'s `pos` to `Map<string, Placement>` and add a guard after placement so bisection sees a tilted/nudged failure:

```ts
  const pos = new Map<string, Placement>();
  for (const row of rows) {
    for (const [id, p] of placeRow(row, poly, upm)) pos.set(id, p);
  }
  for (const g of groups) {
    const p = pos.get(g.letter.id)!;
    if (!fitsRotated(poly, g, p.x, p.y, p.rotation, null, 0)) return null;
  }
  return { rows, pos };
```

In `arrangeStackInShape`, replace the `moved` loop:

```ts
  const moved = new Map<string, StackPiece>();
  for (const g of groups) {
    const pl = pos.get(g.letter.id)!;
    const dx = pl.x - g.letter.x, dy = pl.y - g.letter.y;
    const lp: Pt = [g.letter.pivot[0] + pl.x, g.letter.pivot[1] + pl.y];
    const c = Math.cos(pl.rotation), s = Math.sin(pl.rotation);
    for (const m of g.members) {
      const mx = m.x + dx, my = m.y + dy;
      if (m === g.letter || pl.rotation === 0) { moved.set(m.id, { ...m, x: mx, y: my, rotation: pl.rotation }); continue; }
      // A rider turns with its letter: its pivot swings about the letter's pivot.
      const vx = m.pivot[0] + mx - lp[0], vy = m.pivot[1] + my - lp[1];
      const nx = lp[0] + vx * c - vy * s, ny = lp[1] + vx * s + vy * c;
      moved.set(m.id, { ...m, x: nx - m.pivot[0], y: ny - m.pivot[1], rotation: pl.rotation });
    }
  }
```

- [ ] **Step 4: Run all arrange tests**

Run: `npx vitest run src/lib/stackArrange.test.ts`
Expected: PASS. If "puts every letter inside the shape" fails on a corner, the `0.98` shrink in that test hides sampling slop; check `fitsRotated` is using the unscaled poly in font units (it is called inside `arrangeAt`, where `poly` is already `shapePx / scale`).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackArrange.ts src/lib/stackArrange.test.ts
git commit -m "Stack arrange: outer letters lean into the edge, capped at 30°"
```

---

### Task 4: Phase 1 docs and verification

**Files:**
- Modify: `.claude/rules/stacked-compositions.md` ("Fill a guide shape" paragraph)
- Modify: `PROGRESS.md` (new dated entry under "## Shipped")

- [ ] **Step 1: Update the rules paragraph**

In `.claude/rules/stacked-compositions.md`, replace the sentence beginning "Rows are then spread over the shape's height" through "(their baseline)." with:

```
Rows are then spread over the shape's height with equal margins, each
lifted only as far as its band still takes it and never past the row
above. **Within a row of three or more, the outer letters hug the shape**:
each is measured against its *own* band (`ownSpan`; the row's union band is
narrowed by a tall neighbour), nudged up or down by up to a quarter of its
height to where that band is widest (`nudge`), slid to one gap inside the
chord, and **tilted toward the edge's lean** (`edgeLean`, clamped to
`MAX_TILT` = 30°, halved until its rotated corners fit, `fitsRotated`);
inner letters share the remaining width equally and stay upright. A row
of one or two is centred with the spread capped at one em and its two
letters tilted. A rider turns with its letter about the letter's pivot.
Bisection fits rows plus tilt (`arrangeAt` rejects a placement whose
rotated corners leave the shape).
```

- [ ] **Step 2: Add the PROGRESS entry**

Insert directly under `## Shipped` in `PROGRESS.md`:

```
### 2026-10-15 — Stack arrange follows the silhouette

- **Hug, nudge, tilt.** "Fill a guide shape" now measures the outer letter
  of each row against its own band, drops it into the curve, and leans it
  toward the edge up to 30°; inner letters share the rest. Spec:
  `docs/superpowers/specs/2026-10-15-stack-arrange-fill-design.md`; how
  it works and its tunables:
  [stacked-compositions.md](.claude/rules/stacked-compositions.md).
```

- [ ] **Step 3: Full verification loop**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add .claude/rules/stacked-compositions.md PROGRESS.md
git commit -m "Docs: stack arrange hugs, nudges and tilts"
```

---

### Task 5: Filler pass in the arranger (Phase 2)

**Files:**
- Modify: `src/types.ts:236-258` (`StackPiece` gains `filler?: true`)
- Modify: `src/lib/stackGeometry.ts` (add `scaleCmds`)
- Modify: `src/lib/stackArrange.ts` (`FillerShape`, `ArrangeInput.fillers`, `ArrangeResult.fillers`, `fillGaps`)
- Test: `src/lib/stackArrange.test.ts`, `src/lib/stackGeometry.test.ts`

**Interfaces:**
- Produces: `export type FillerShape = { cmds: SvgCmd[]; name: string }` (in `stackArrange.ts`); `ArrangeInput.fillers?: readonly FillerShape[]`; `ArrangeResult.fillers: number`; `export function scaleCmds(cmds: SvgCmd[], k: number): SvgCmd[]` (in `stackGeometry.ts`). Task 6 imports `FillerShape`; Task 7 passes `fillers`.
- Consumes: `pieceTransform` from `./stackOutline`, `flattenContours` from `./strokeCuts`, `cmdsCentre`, `transformCmds` from `./stackGeometry`, `pointInPolygon`.

- [ ] **Step 1: Add the field and write the failing tests**

In `src/types.ts`, inside `StackPiece` after `parentId?: string;`:

```ts
  /** Placed by "Fill a guide shape" to busy the gaps (tashkeel, ornaments);
   *  stripped on re-run and on Reset layout. */
  filler?: true;
```

In `src/lib/stackGeometry.test.ts` add:

```ts
describe("scaleCmds", () => {
  it("scales every coordinate about the origin", () => {
    const cmds: SvgCmd[] = [{ type: "M", x: 10, y: 20 }, { type: "Q", x1: 2, y1: 4, x: 6, y: 8 }, { type: "C", x1: 1, y1: 1, x2: 2, y2: 2, x: 3, y: 3 }, { type: "Z" }];
    expect(scaleCmds(cmds, 0.5)).toEqual([
      { type: "M", x: 5, y: 10 }, { type: "Q", x1: 1, y1: 2, x: 3, y: 4 }, { type: "C", x1: 0.5, y1: 0.5, x2: 1, y2: 1, x: 1.5, y: 1.5 }, { type: "Z" },
    ]);
  });
});
```

(Add `scaleCmds` to that file's import from `./stackGeometry`, and `SvgCmd` type import if missing.)

In `src/lib/stackArrange.test.ts` add a filler fixture above the describe and a new describe block:

```ts
const FILLERS: FillerShape[] = [
  { name: "dot", cmds: rect(60, 60) },
  { name: "fatha", cmds: rect(200, 50) },
];

/** Flattened world-space contours of a piece. */
const worldContours = (p: StackPiece) => flattenContours(transformCmds(p.cmds, { x: p.x, y: p.y, rotation: p.rotation, pivot: p.pivot }));

describe("fillers", () => {
  const shape = ellipse(300, 900);
  const base = () => ({ ...word(), shapePx: shape, fontSize: 100, unitsPerEm: UPM, fillers: FILLERS });

  it("busies a loose shape with marks that stay inside and off the ink", () => {
    const r = arrangeStackInShape(base())!;
    expect(r.fillers).toBeGreaterThan(0);
    const scale = r.fontSize / UPM;
    const fillers = r.pieces.filter((p) => p.filler);
    expect(fillers.length).toBe(r.fillers);
    const ink = r.pieces.filter((p) => !p.filler).flatMap(worldContours);
    const boxes = fillers.map((f) => outlineBounds(translateCmds(f.cmds, f.x, f.y)));
    fillers.forEach((f, i) => {
      expect(f.role).toBe("mark");
      expect(f.parentId).toBeUndefined();
      expect(f.homeX).toBe(f.x); expect(f.homeY).toBe(f.y);
      const b = boxes[i];
      const probes: Array<[number, number]> = [[b.x1, b.y1], [b.x2, b.y1], [b.x1, b.y2], [b.x2, b.y2], [(b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2]];
      for (const [x, y] of probes) {
        expect(pointInPolygon(x * scale, y * scale, shape), `${f.id} inside`).toBe(true);
        expect(ink.some((c) => pointInPolygon(x, y, c)), `${f.id} off the ink`).toBe(false);
      }
      for (let j = 0; j < i; j++) {
        const o = boxes[j];
        const apart = b.x2 <= o.x1 || b.x1 >= o.x2 || b.y2 <= o.y1 || b.y1 >= o.y2;
        expect(apart, `${f.id} vs ${fillers[j].id}`).toBe(true);
      }
    });
  });

  it("adds none to a shape the letters already fill, and is deterministic", () => {
    const one = letter("solo", 0, 0, 300, 400);
    const tight: Array<[number, number]> = [[-160, -210], [160, -210], [160, 210], [-160, 210]];
    const r = arrangeStackInShape({ pieces: [one], joins: [], shapePx: tight, fontSize: 1000, unitsPerEm: UPM, fillers: FILLERS })!;
    expect(r.fillers).toBe(0);
    const a = arrangeStackInShape(base())!, b = arrangeStackInShape(base())!;
    expect(a).toEqual(b);
  });

  it("adds no fillers when none are offered", () => {
    const r = arrangeStackInShape({ ...base(), fillers: undefined })!;
    expect(r.fillers).toBe(0);
    expect(r.pieces.some((p) => p.filler)).toBe(false);
  });
});
```

Update the test file's imports: `import { arrangeStackInShape, bandSpan, letterGroups, type FillerShape } from "./stackArrange";`, `import { flattenContours, outlineBounds } from "./strokeCuts";`, `import { transformCmds, transformPt, translateCmds } from "./stackGeometry";`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackArrange.test.ts src/lib/stackGeometry.test.ts`
Expected: FAIL (`FillerShape` not exported, `scaleCmds` missing, `fillers` undefined).

- [ ] **Step 3: Implement `scaleCmds`**

In `src/lib/stackGeometry.ts` after `translateCmds`:

```ts
/** Every coordinate multiplied by `k` (about the origin). */
export function scaleCmds(cmds: SvgCmd[], k: number): SvgCmd[] {
  return cmds.map((c) => {
    switch (c.type) {
      case "M": case "L": return { ...c, x: c.x * k, y: c.y * k };
      case "Q": return { ...c, x: c.x * k, y: c.y * k, x1: c.x1 * k, y1: c.y1 * k };
      case "C": return { ...c, x: c.x * k, y: c.y * k, x1: c.x1 * k, y1: c.y1 * k, x2: c.x2 * k, y2: c.y2 * k };
      default: return c;
    }
  });
}
```

- [ ] **Step 4: Implement the filler pass**

In `src/lib/stackArrange.ts`:

Imports become:

```ts
import type { StackPiece, StackJoin } from "../types";
import type { SvgCmd } from "./svgPath";
import { pointInPolygon } from "./svgPath";
import { outlineBounds, flattenContours, type Contour } from "./strokeCuts";
import { translateCmds, transformPt, transformCmds, scaleCmds, cmdsCentre } from "./stackGeometry";
import { pieceTransform } from "./stackOutline";
```

Tunables below `MAX_TILT`:

```ts
/** Filler grid cell, filler padding, and the one shrink step tried after natural size. */
const FILLER_CELL = 0.33;
const FILLER_GAP = 0.06;
const FILLER_SHRINK = 0.6;
```

Types:

```ts
/** An ornament the caller offers for the gaps: closed contours in font units
 *  at the block's unitsPerEm, origin anywhere. */
export type FillerShape = { cmds: SvgCmd[]; name: string };
```

`ArrangeInput` gains `fillers?: readonly FillerShape[];` with the doc comment `/** Ornaments for the gaps; omitted = no filler pass. */`. `ArrangeResult` gains `fillers: number;` (`/** Filler pieces added. */`).

The pass, placed after `arrangeAt`:

```ts
/**
 * Busy the gaps. The shape is scanned on a grid, bottom row first, right to
 * left; at each cell the candidates are tried in a rotation that starts at
 * the cell's index (so neighbours differ), each at natural size then shrunk.
 * A candidate is accepted when its padded box's four corners and centre are
 * inside the shape, none of them is inside any ink contour, and the box
 * overlaps no filler already placed. Deterministic for the same input.
 */
function fillGaps(
  poly: readonly Pt[], ink: readonly Contour[], fillers: readonly FillerShape[], upm: number, order: number
): StackPiece[] {
  if (fillers.length === 0) return [];
  const cell = FILLER_CELL * upm, pad = FILLER_GAP * upm;
  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cands = fillers.map((f) => ({ name: f.name, cmds: f.cmds, box: outlineBounds(f.cmds) }));
  const inside = (x: number, y: number) => pointInPolygon(x, y, poly as Array<[number, number]>);
  const onInk = (x: number, y: number) => ink.some((c) => pointInPolygon(x, y, c));
  const placed: Box[] = [];
  const out: StackPiece[] = [];
  let cellIndex = 0;
  for (let cy = maxY - cell / 2; cy > minY; cy -= cell) {
    for (let cx = maxX - cell / 2; cx > minX; cx -= cell, cellIndex++) {
      let hit = false;
      for (let k = 0; k < cands.length && !hit; k++) {
        const cand = cands[(cellIndex + k) % cands.length];
        for (const shrink of [1, FILLER_SHRINK]) {
          const cmds = shrink === 1 ? cand.cmds : scaleCmds(cand.cmds, shrink);
          const pivot = cmdsCentre(cmds);
          const x = cx - pivot[0], y = cy - pivot[1];
          const b = cand.box;
          const wb: Box = { x1: b.x1 * shrink + x - pad, y1: b.y1 * shrink + y - pad, x2: b.x2 * shrink + x + pad, y2: b.y2 * shrink + y + pad };
          const probes: Pt[] = [[wb.x1, wb.y1], [wb.x2, wb.y1], [wb.x1, wb.y2], [wb.x2, wb.y2], [cx, cy]];
          if (!probes.every(([px, py]) => inside(px, py))) continue;
          if (probes.some(([px, py]) => onInk(px, py))) continue;
          if (placed.some((o) => !(wb.x2 <= o.x1 || wb.x1 >= o.x2 || wb.y2 <= o.y1 || wb.y1 >= o.y2))) continue;
          placed.push(wb);
          out.push({
            id: `f${out.length + 1}`, cmds, x, y, rotation: 0, pivot, homeX: x, homeY: y,
            order, role: "mark", filler: true, faces: [],
          });
          hit = true;
          break;
        }
      }
    }
  }
  return out;
}

/** Every piece's ink as flattened world-space contours (font units). */
function inkContours(pieces: readonly StackPiece[]): Contour[] {
  return pieces.flatMap((p) => flattenContours(transformCmds(p.cmds, pieceTransform(p))));
}
```

In `arrangeStackInShape`, after the `moved` loop and before `return`:

```ts
  const arranged = input.pieces.filter((p) => !p.filler).map((p) => moved.get(p.id) ?? p);
  const polyFU = input.shapePx.map((p): Pt => [p[0] / (base * lo), p[1] / (base * lo)]);
  const maxOrder = groups.reduce((m, g) => Math.max(m, g.letter.order), 0);
  const fills = fillGaps(polyFU, inkContours(arranged), input.fillers ?? [], upm, maxOrder);
  return {
    pieces: [...arranged, ...fills],
    joins: input.joins.map((j) => ({ ...j, bow: 0, depth: 0 })),
    fontSize: input.fontSize * lo,
    rows: rows.length,
    fillers: fills.length,
  };
```

Note `input.pieces.filter((p) => !p.filler)`: the arranger itself drops incoming fillers, so a caller that forgets to strip still never accumulates them.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/stackArrange.test.ts src/lib/stackGeometry.test.ts`
Expected: PASS. If "busies a loose shape" reports a probe on ink, check that `inkContours` receives the *moved* pieces (world positions), not `input.pieces`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/types.ts src/lib/stackGeometry.ts src/lib/stackGeometry.test.ts src/lib/stackArrange.ts src/lib/stackArrange.test.ts
git commit -m "Stack arrange: fill the gaps with offered ornaments"
```

---

### Task 6: Filler outlines from the font (Phase 2)

**Files:**
- Modify: `src/lib/stackConvert.ts` (add `FILLER_MARKS`, `teardropShape`, `fillerShapes`)
- Test: `src/lib/stackConvert.test.ts`

**Interfaces:**
- Consumes: `FillerShape` from `./stackArrange`; `toSvgCmds` (already imported); `opentype.Font`.
- Produces: `export function fillerShapes(font: opentype.Font, upm: number, nibWidth: number): FillerShape[]`; `export function teardropShape(nibWidth: number): FillerShape`. Task 7 calls both.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/stackConvert.test.ts` (it already imports `fs`, `path`, `fileURLToPath`, `opentype`):

```ts
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
```

Add `fillerShapes, teardropShape` to the `./stackConvert` import.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackConvert.test.ts -t fillerShapes`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement**

In `src/lib/stackConvert.ts` add `import type { FillerShape } from "./stackArrange";` and append:

```ts
/** The marks offered as gap fillers, in the rotation the arranger cycles through. */
export const FILLER_MARKS: readonly { name: string; cp: number }[] = [
  { name: "fatha", cp: 0x064e }, { name: "kasra", cp: 0x0650 }, { name: "shadda", cp: 0x0651 },
  { name: "damma", cp: 0x064f }, { name: "sukun", cp: 0x0652 }, { name: "fathatan", cp: 0x064b },
  { name: "dammatan", cp: 0x064c }, { name: "kasratan", cp: 0x064d }, { name: "star", cp: 0x066d },
  { name: "dot", cp: 0x06ec },
];

/** A pen-drawn teardrop the nib's width across: a circle with a short tail
 *  rising to the upper right. The filler for fonts without tashkeel. */
export function teardropShape(nibWidth: number): FillerShape {
  const r = Math.max(nibWidth, 1) / 2;
  const k = 0.5523 * r;
  const cmds: SvgCmd[] = [
    { type: "M", x: r, y: 0 },
    { type: "C", x1: r, y1: k, x2: k, y2: r, x: 0, y: r },
    { type: "C", x1: -k, y1: r, x2: -r, y2: k, x: -r, y: 0 },
    { type: "C", x1: -r, y1: -k, x2: -k, y2: -r, x: 0, y: -r },
    { type: "C", x1: k, y1: -r, x2: 1.6 * r, y2: -1.6 * r, x: 1.8 * r, y: -2 * r },
    { type: "C", x1: 1.6 * r, y1: -1.2 * r, x2: r, y2: -0.6 * r, x: r, y: 0 },
    { type: "Z" },
  ];
  return { name: "teardrop", cmds };
}

/** The filler outlines a font offers: each of `FILLER_MARKS` the font
 *  actually draws (a real glyph with commands), plus the teardrop when fewer
 *  than two survive (Qahiri and RanaKufi carry only hamza-above). */
export function fillerShapes(font: opentype.Font, upm: number, nibWidth: number): FillerShape[] {
  const out: FillerShape[] = [];
  for (const m of FILLER_MARKS) {
    const g = font.charToGlyph(String.fromCodePoint(m.cp));
    if (!g || g.index === 0) continue;
    const cmds = toSvgCmds(g.getPath(0, 0, upm).commands);
    if (cmds.length < 3) continue;
    out.push({ name: m.name, cmds });
  }
  if (out.length < 2) out.push(teardropShape(nibWidth));
  return out;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackConvert.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackConvert.ts src/lib/stackConvert.test.ts
git commit -m "Stack: filler outlines from the block's font, teardrop fallback"
```

---

### Task 7: Async arrange handler, strip fillers, panel checkbox (Phase 2)

**Files:**
- Modify: `src/App.tsx` (`arrangeStackInGuide` ~line 2092; `resetStackLayout` ~line 2111; state next to `stackMoveTogether` line 735; Sidebar props ~line 3360; imports lines 51, 170, 172)
- Modify: `src/components/Sidebar.tsx` (props ~136–138, destructure ~374–376, `StackPanel` call ~1960)
- Modify: `src/components/sidebar/StackPanel.tsx`

**Interfaces:**
- Consumes: `arrangeStackInShape` (`fillers`), `fillerShapes`, `teardropShape`, `shapeText`, `resolveFontUrl`, `updateBlock(id, patch)`.
- Produces: App state `stackFillGaps: boolean` (default `true`); Sidebar props `stackFillGaps?: boolean`, `onStackFillGaps?: (v: boolean) => void`; StackPanel props `fillGaps: boolean`, `onFillGaps: (v: boolean) => void`.

- [ ] **Step 1: App state and imports**

In `src/App.tsx` below line 735:

```ts
  /** Editor preference, not block state: "Fill a guide shape" busies the gaps with tashkeel. */
  const [stackFillGaps, setStackFillGaps] = useState(true);
```

Change line 172 to `import { convertRunToStack, splitPieceAtCut, fillerShapes, teardropShape, type UnjoinedPair } from "./lib/stackConvert";` and line 51 to `import { arrangeStackInShape, type FillerShape } from "./lib/stackArrange";`.

- [ ] **Step 2: Rewrite the handler**

Replace `arrangeStackInGuide` with:

```ts
  /**
   * Arrange the selected stack's letters to fill a closed guide: rows from
   * the bottom up in reading order, outer letters hugging and leaning into
   * the edge, the block sized to the shape and moved onto the guide, and —
   * when "Fill gaps with tashkeel" is on — the gaps busied with the font's
   * own marks. Existing fillers are stripped first so a re-run never
   * accumulates them. One history step (updateBlock, by captured id: the
   * font load awaits, and the selection may move meanwhile).
   */
  const arrangeStackInGuide = async (guideId: number) => {
    if (!selectedBlock || !isStackBlock(selectedBlock)) return;
    const block = selectedBlock;
    const guide = blocks.find((b): b is GuideBlock => b.type === "guide" && b.id === guideId);
    if (!guide) return;
    const shapePx = containerPolygon(parseSvgPath(guide.guideD));
    if (!shapePx) { setExportStatus("That guide is not a closed shape, so there is nothing to fill."); return; }
    let fillers: FillerShape[] = [];
    let fontNote = "";
    if (stackFillGaps) {
      try {
        const shaped = await shapeText(block.source.text, resolveFontUrl(block.source.fontFamily));
        fillers = fillerShapes(shaped.font, block.unitsPerEm, block.nib.width);
      } catch {
        fillers = [teardropShape(block.nib.width)];
        fontNote = " (font unavailable; teardrops used)";
      }
    }
    const result = arrangeStackInShape({
      pieces: block.pieces.filter((p) => !p.filler), joins: block.joins, shapePx,
      fontSize: block.fontSize, unitsPerEm: block.unitsPerEm, fillers,
    });
    if (!result) { setExportStatus("Could not fit the letters inside that guide."); return; }
    updateBlock(block.id, {
      pieces: result.pieces, joins: result.joins, fontSize: result.fontSize,
      x: guide.x, y: guide.y, rotation: guide.rotation ?? 0,
    });
    const letters = result.pieces.filter((p) => p.role === "letter" && p.parentId === undefined).length;
    const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
    setExportStatus(
      `Arranged ${plural(letters, "letter")} in ${plural(result.rows, "row")} inside the guide` +
      (result.fillers > 0 ? `, ${plural(result.fillers, "ornament")} added` : "") + fontNote + "."
    );
  };
```

`updateBlock` is declared at line 1277, well above this handler, so the closure order rule in CLAUDE.md holds. `shapeText` and `resolveFontUrl` are already imported in `App.tsx` (used by the convert handler).

- [ ] **Step 3: Reset strips fillers**

Replace `resetStackLayout`:

```ts
  /** Stack layout back to its home arrangement; fillers go (home is the
   *  conversion, which had none). updateSelectedBlock pushes the one history step. */
  const resetStackLayout = () => {
    if (!selectedBlock || !isStackBlock(selectedBlock)) return;
    updateSelectedBlock({
      pieces: selectedBlock.pieces.filter((p) => !p.filler).map((p) => ({ ...p, x: p.homeX, y: p.homeY, rotation: 0 })),
      joins: selectedBlock.joins.map((j) => ({ ...j, bow: 0, depth: 0 })),
    });
  };
```

- [ ] **Step 4: Thread the preference to the panel**

`src/App.tsx` Sidebar call (near line 3360), after `onStackMoveTogether={setStackMoveTogether}`:

```tsx
        stackFillGaps={stackFillGaps}
        onStackFillGaps={setStackFillGaps}
```

`src/components/Sidebar.tsx` props type (after line 138):

```ts
  stackFillGaps?: boolean;
  onStackFillGaps?: (v: boolean) => void;
```

Destructure (after line 376): `stackFillGaps = true, onStackFillGaps,`.

`StackPanel` call (after `onMoveTogether=…`):

```tsx
                fillGaps={stackFillGaps}
                onFillGaps={(v) => onStackFillGaps?.(v)}
```

`src/components/sidebar/StackPanel.tsx`: add props `fillGaps: boolean; onFillGaps: (v: boolean) => void;` to the type and destructure; insert directly after the `SelectRow`/fallback block (before the explanatory paragraph):

```tsx
    <CheckboxRow
      id={`stack-${block.id}-fill-gaps`}
      label="Fill gaps with tashkeel"
      checked={fillGaps}
      onChange={onFillGaps}
    />
```

Replace the explanatory paragraph text with:

```
      Filling a guide lays the letters in rows from the bottom up, in reading order, leans the
      outer letters into the edge, and sizes the composition to the shape. With the box above
      checked, the gaps are busied with the font's own tashkeel. You can still drag, tilt and
      bend afterwards; Reset layout removes the ornaments.
```

- [ ] **Step 5: Verify in the browser**

Run: `npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test`, then `npm run dev`. Create a text block in Amiri reading الملك, convert it to a stack, add an almond guide, pick it under "Fill a guide shape". Expected: the status reads "Arranged 5 letters in N rows inside the guide, M ornaments added."; marks appear between letters and the edge; a re-run keeps the ornament count stable; Reset layout removes them; undo restores the arrangement. Repeat with the checkbox off: no ornaments.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/components/Sidebar.tsx src/components/sidebar/StackPanel.tsx
git commit -m "Stack panel: fill gaps with tashkeel; arrange strips and re-adds fillers"
```

---

### Task 8: Phase 2 docs and verification

**Files:**
- Modify: `.claude/rules/stacked-compositions.md`
- Modify: `PROGRESS.md`

- [ ] **Step 1: Rules paragraph**

Append to the "Fill a guide shape" paragraph (after the Phase 1 text from Task 4):

```
**Fillers** (`fillGaps`): when the panel's "Fill gaps with tashkeel" is on,
`App.tsx` loads the block's font through the cached `shapeText` and passes
`fillerShapes` (`stackConvert.ts`: the font's fatha, kasra, shadda, damma,
sukun, tanwin, star and dot, or a nib-width `teardropShape` when fewer than
two exist — Qahiri and RanaKufi). After letters are final the shape is
scanned on a `FILLER_CELL` grid, bottom row first, right to left; each cell
tries the candidates in a rotation starting at the cell index, at natural
size then `FILLER_SHRINK`, and accepts the first whose `FILLER_GAP`-padded
box has its corners and centre inside the shape, off every ink contour
(`pointInPolygon` on flattened pieces, so marks nest into bowls), and clear
of placed fillers. A filler is `role: "mark"` with no parent and
`filler: true`: it drags alone, has no ring or cut spans, exports with the
outline, and is **stripped** by the arranger, the handler and Reset layout,
so it never accumulates. The preference is `App.tsx` state like "Move
letters together", neither saved nor undoable.
```

- [ ] **Step 2: PROGRESS bullet**

Under the 2026-10-15 "Stack arrange follows the silhouette" entry add:

```
- **Fill gaps with tashkeel.** A checkbox in the Stack panel; the arranger
  busies the gaps with the font's own marks (teardrop fallback), placed
  off the ink by contour test. Re-runs replace them; Reset removes them.
```

- [ ] **Step 3: Full verification loop and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add .claude/rules/stacked-compositions.md PROGRESS.md
git commit -m "Docs: tashkeel fillers in stack arrange"
```

---

### Task 9: Zone sweep with a second base angle and an aspect floor (Phase 3)

**Files:**
- Modify: `src/lib/strokeCuts.ts` (`DetectOpts` ~171–189; `findCutZonesSwept` ~403–425)
- Modify: `src/lib/stackZones.ts` (add `stackDetectOpts`)
- Modify: `src/components/StackEditOverlay.tsx:137-141` (use `stackDetectOpts`)
- Test: `src/lib/strokeCuts.test.ts`, `src/lib/stackZones.test.ts`

**Interfaces:**
- Produces: `DetectOpts.baseAngles?: number[]` (default `[0]`), `DetectOpts.minAspect?: number` (default `0`); `export function stackDetectOpts(upm: number): DetectOpts` in `stackZones.ts` returning `{ ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40, baseAngles: [0, Math.PI / 2], minAspect: 1 }`. Task 10 and the overlay call it.

- [ ] **Step 1: Write the failing tests**

In `src/lib/strokeCuts.test.ts`, inside `describe("findCutZonesSwept"…`:

```ts
  it("finds a vertical stem with a second base angle, along its length not across it", () => {
    // A bar 60 thick and 300 tall. Swept about the baseline alone it yields a
    // zone *across* the stroke (a 60-wide run of constant 300 "thickness");
    // the aspect floor drops that, and the second base finds the stem itself.
    const vbar: SvgCmd[] = [
      { type: "M", x: 0, y: 0 }, { type: "L", x: 60, y: 0 }, { type: "L", x: 60, y: 300 }, { type: "L", x: 0, y: 300 }, { type: "Z" },
    ];
    const contours = flattenContours(vbar);
    expect(findCutZonesSwept(contours, meta, { ...DEFAULT_DETECT_OPTS, minAspect: 1 })).toHaveLength(0);
    const zones = findCutZonesSwept(contours, meta, { ...DEFAULT_DETECT_OPTS, baseAngles: [0, Math.PI / 2], minAspect: 1 });
    expect(zones).toHaveLength(1);
    expect(Math.abs(Math.abs(zones[0].angle) - Math.PI / 2)).toBeLessThanOrEqual(DEFAULT_DETECT_OPTS.angleStep + 1e-9);
    expect(zones[0].toX - zones[0].fromX).toBeGreaterThan(240);
    expect(zones[0].thickness).toBeCloseTo(60, 0);
  });

  it("is unchanged for the default options", () => {
    const t = (12 * Math.PI) / 180;
    const contours = flattenContours(rotateCmds(BAR, t));
    expect(findCutZonesSwept(contours, meta)).toHaveLength(1);
  });
```

In `src/lib/stackZones.test.ts` add:

```ts
describe("stackDetectOpts", () => {
  it("sweeps both bases with the stack's resolution and an aspect floor", () => {
    const o = stackDetectOpts(2000);
    expect(o.baseAngles).toEqual([0, Math.PI / 2]);
    expect(o.minAspect).toBe(1);
    expect(o.step).toBe(20);
    expect(o.minZoneWidth).toBe(50);
    expect(o.maxSlope).toBe(DEFAULT_DETECT_OPTS.maxSlope);
  });
});
```

(Import `stackDetectOpts` from `./stackZones` and `DEFAULT_DETECT_OPTS` from `./strokeCuts` in that file.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/strokeCuts.test.ts src/lib/stackZones.test.ts`
Expected: FAIL (type errors on `minAspect`/`baseAngles`, `stackDetectOpts` missing).

- [ ] **Step 3: Implement**

`src/lib/strokeCuts.ts`, `DetectOpts` gains:

```ts
  /** Stroke directions to sweep about, radians; each gets ±maxAngle. Default
   *  [0] (the baseline). Stack consumers add π/2 to find upstrokes. */
  baseAngles?: number[];
  /** A zone must be at least this many thicknesses long. 0 (default) keeps
   *  every zone; 1 drops the zone a sweep finds *across* a short stroke. */
  minAspect?: number;
```

`findCutZonesSwept` body:

```ts
  const steps = Math.floor(opts.maxAngle / opts.angleStep);
  const angles: number[] = [];
  for (const base of opts.baseAngles ?? [0]) {
    angles.push(base);
    for (let i = 1; i <= steps; i++) angles.push(base + i * opts.angleStep, base - i * opts.angleStep);
  }
  const minAspect = opts.minAspect ?? 0;
  const found: CutZone[] = [];
  for (const t of angles) {
    for (const z of findCutZones(rotateContours(contours, -t), meta, opts)) {
      if (z.toX - z.fromX < minAspect * z.thickness) continue;
      found.push({ ...z, angle: t });
    }
  }
  return dedupeZones(found, opts);
```

`src/lib/stackZones.ts` (import `DEFAULT_DETECT_OPTS, type DetectOpts` from `./strokeCuts`):

```ts
/** The detector options every stack consumer uses: the stack's resolution,
 *  both stroke directions (so an alif's stem is found), and an aspect floor
 *  so a sweep never offers a cut across a stroke. */
export function stackDetectOpts(upm: number): DetectOpts {
  return { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40, baseAngles: [0, Math.PI / 2], minAspect: 1 };
}
```

`src/components/StackEditOverlay.tsx` line 138: replace `const opts = { ...DEFAULT_DETECT_OPTS, step: upm / 100, minZoneWidth: upm / 40 };` with `const opts = stackDetectOpts(upm);`; add `stackDetectOpts` to the `../lib/stackZones` import and drop `DEFAULT_DETECT_OPTS` from the `../lib/strokeCuts` import if now unused.

- [ ] **Step 4: Run tests, then check by hand**

Run: `npx vitest run src/lib/strokeCuts.test.ts src/lib/stackZones.test.ts && npm test`
Expected: PASS. Then `npm run dev`: convert الملك in Amiri to a stack, hover the alif. Expected: a cut span is offered near the top of its stem; pressing and dragging upward draws it out with a straight join.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/strokeCuts.ts src/lib/strokeCuts.test.ts src/lib/stackZones.ts src/lib/stackZones.test.ts src/components/StackEditOverlay.tsx
git commit -m "Zone sweep: second base angle and aspect floor; stems reachable by hand"
```

---

### Task 10: Automatic stem pull in the arranger (Phase 3)

**Files:**
- Modify: `src/lib/stackArrange.ts` (`ArrangeInput.pullStems`, `ArrangeResult.stems`, `freeEnds`, `pullStems`)
- Test: `src/lib/stackArrange.test.ts`

**Interfaces:**
- Consumes: `splitPieceAtCut(pieces, joins, pieceId, cut)` from `./stackConvert` (harfbuzz-free, verified); `findCutZonesSwept`, `type CutZone` from `./strokeCuts`; `stackDetectOpts`, `pullSpans`, `spanProbes`, `clampCutX`, `fromZoneFrame` from `./stackZones`; `splitAtCut`, `transformPt`, `transformFace` from `./stackGeometry`.
- Produces: `ArrangeInput.pullStems?: boolean` (default `false`); `ArrangeResult.stems: number`. Task 11 passes `pullStems: true`.

- [ ] **Step 1: Write the failing tests**

Add fixtures above the describe in `src/lib/stackArrange.test.ts`:

```ts
/** A 400×700 room with a 300-wide, 800-tall chimney over its middle (px). */
const CHIMNEY: Array<[number, number]> = [
  [-200, 350], [200, 350], [200, -350], [150, -350], [150, -1150], [-150, -1150], [-150, -350], [-200, -350],
];
/** The same room with the chimney blocked a little way up by a ledge of ink: a 300×100 slab piece. */
function threeAlifs() {
  const c = letter("a2", 2, 0, 80, 600);
  const b = letter("a1", 1, 160, 80, 600);
  const a = letter("a0", 0, 320, 80, 600);
  return { pieces: [c, b, a], joins: [] as StackJoin[] };
}
```

Append a describe:

```ts
describe("stem pull", () => {
  const base = () => ({ ...threeAlifs(), shapePx: CHIMNEY, fontSize: 1000, unitsPerEm: UPM, pullStems: true });

  it("draws the middle alif up into the chimney and stops a gap short of its top", () => {
    const r = arrangeStackInShape(base())!;
    expect(r.stems).toBe(1);
    const cap = r.pieces.find((p) => p.parentId === "a1" && p.role === "letter")!;
    expect(cap).toBeDefined();
    expect(r.joins.some((j) => (j.from.pieceId === "a1" && j.to.pieceId === cap.id) || (j.to.pieceId === "a1" && j.from.pieceId === cap.id))).toBe(true);
    const scale = r.fontSize / UPM;
    const b = outlineBounds(transformCmds(cap.cmds, { x: cap.x, y: cap.y, rotation: cap.rotation, pivot: cap.pivot }));
    // Well into the chimney (its mouth is at y = -350 px), and inside it with its gap.
    expect(b.y1 * scale).toBeLessThan(-350 - 400);
    expect(b.y1 * scale).toBeGreaterThan(-1150);
    expect(pointInPolygon(b.x1 * scale, b.y1 * scale, CHIMNEY)).toBe(true);
    expect(pointInPolygon(b.x2 * scale, b.y1 * scale, CHIMNEY)).toBe(true);
    // The outer alifs, under the roof, are untouched.
    expect(r.pieces.filter((p) => p.parentId === "a0" || p.parentId === "a2")).toHaveLength(0);
  });

  it("is idempotent: a second run slides the cap rather than cutting again", () => {
    const first = arrangeStackInShape(base())!;
    const second = arrangeStackInShape({ ...base(), pieces: first.pieces, joins: first.joins, fontSize: first.fontSize })!;
    expect(second.pieces.filter((p) => p.parentId === "a1")).toHaveLength(1);
    expect(second.joins).toHaveLength(first.joins.length);
    expect(second.pieces.length).toBe(first.pieces.length);
  });

  it("never pulls through ink or when stems are off", () => {
    // A rider slab above the middle alif blocks the chimney's mouth.
    const { pieces, joins } = threeAlifs();
    const mid = pieces.find((p) => p.id === "a1")!;
    const slab: StackPiece = { ...letter("slab", 1, mid.x - 110, 300, 100), y: -700, role: "mark", parentId: "a1", pivot: [150, -50] };
    const r = arrangeStackInShape({ pieces: [...pieces, slab], joins, shapePx: CHIMNEY, fontSize: 1000, unitsPerEm: UPM, pullStems: true })!;
    expect(r.stems).toBe(0);
    const off = arrangeStackInShape({ ...base(), pullStems: false })!;
    expect(off.stems).toBe(0);
    expect(off.pieces.some((p) => p.parentId !== undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/lib/stackArrange.test.ts -t "stem pull"`
Expected: FAIL (`stems` undefined, no caps).

- [ ] **Step 3: Implement**

Imports added to `stackArrange.ts`:

```ts
import { findCutZonesSwept, type CutZone } from "./strokeCuts";
import { stackDetectOpts, pullSpans, spanProbes, fromZoneFrame } from "./stackZones";
import { splitAtCut, transformFace } from "./stackGeometry";
import { splitPieceAtCut } from "./stackConvert";
```

(Merge with the existing import lines from the same modules.)

Tunables below `FILLER_SHRINK`:

```ts
/** Stem pull: march step, the least pull worth a cut, and the most. All ems. */
const STEM_STEP = 0.02;
const STEM_MIN = 0.1;
const STEM_MAX = 3;
```

`ArrangeInput` gains `pullStems?: boolean;` (`/** Draw straight free stem ends out toward the boundary. Default false. */`); `ArrangeResult` gains `stems: number;` (`/** Stems cut and pulled (or existing caps slid). */`).

Code, after `inkContours`:

```ts
/** A straight stroke's free end: where to cut, and which way (piece-local unit) it points. */
type StemEnd = { cutX: number; angle: number; dir: Pt };

/** The free ends of a letter's straight strokes: each two-span zone's outer
 *  end that will split and has no face of the letter within a thickness. */
function freeEnds(letter: StackPiece, upm: number): StemEnd[] {
  const zones = findCutZonesSwept(flattenContours(letter.cmds), { glyphIndex: 0, cluster: 0 }, stackDetectOpts(upm));
  const out: StemEnd[] = [];
  for (const z of zones) {
    const spans = pullSpans(z);
    if (spans.length !== 2) continue;   // a stub: no end is clearly the free one
    const ends: { span: [number, number]; end: "from" | "to" }[] = [{ span: spans[0], end: "from" }, { span: spans[1], end: "to" }];
    for (const { span, end } of ends) {
      if (!spanProbes(z, span).every((cx) => splitAtCut(letter.cmds, { cutX: cx, angle: z.angle }) !== null)) continue;
      const tip = fromZoneFrame([end === "to" ? z.toX : z.fromX, z.centreY], z.angle);
      const blocked = letter.faces.some((f) => Math.hypot((f.a[0] + f.b[0]) / 2 - tip[0], (f.a[1] + f.b[1]) / 2 - tip[1]) < z.thickness);
      if (blocked) continue;
      const o = fromZoneFrame([0, 0], z.angle), u = fromZoneFrame([1, 0], z.angle);
      const sgn = end === "to" ? 1 : -1;
      out.push({ cutX: end === "to" ? span[0] : span[1], angle: z.angle, dir: [sgn * (u[0] - o[0]), sgn * (u[1] - o[1])] });
    }
  }
  return out;
}

const rotateVec = (v: Pt, a: number): Pt => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
const worldBounds = (p: StackPiece): Box => outlineBounds(transformCmds(p.cmds, pieceTransform(p)));

/** How far `cap` can move along `dir` (world unit) before its padded box
 *  leaves the shape or touches `obstacles`; in font units, capped. */
function marchDistance(poly: readonly Pt[], cap: StackPiece, dir: Pt, obstacles: readonly Contour[], upm: number): number {
  const step = STEM_STEP * upm, pad = LETTER_GAP * upm, max = STEM_MAX * upm;
  const b = worldBounds(cap);
  const clear = (d: number) => {
    const x1 = b.x1 - pad + dir[0] * d, x2 = b.x2 + pad + dir[0] * d, y1 = b.y1 - pad + dir[1] * d, y2 = b.y2 + pad + dir[1] * d;
    const probes: Pt[] = [[x1, y1], [x2, y1], [x1, y2], [x2, y2], [(x1 + x2) / 2, (y1 + y2) / 2]];
    return probes.every(([px, py]) => pointInPolygon(px, py, poly as Array<[number, number]>) && !obstacles.some((c) => pointInPolygon(px, py, c)));
  };
  let d = 0;
  while (d + step <= max && clear(d + step)) d += step;
  return d;
}

/**
 * Draw straight free stem ends out toward the boundary. For each letter: an
 * existing cap (a `letter` piece riding on it) is slid along its join's
 * axis; otherwise each free end is cut (`splitPieceAtCut`) and the cap
 * marched until a gap short of the shape or of any other ink. A cut that
 * could not move at least `STEM_MIN` is undone. Returns the new pieces and
 * joins and how many stems moved.
 */
function pullStemEnds(
  pieces: StackPiece[], joins: StackJoin[], letterIds: readonly string[], poly: readonly Pt[], upm: number
): { pieces: StackPiece[]; joins: StackJoin[]; stems: number } {
  let ps = pieces, js = joins, stems = 0;
  const contoursOf = (ids: Set<string>) => inkContours(ps.filter((p) => !ids.has(p.id)));
  for (const id of letterIds) {
    const letter = ps.find((p) => p.id === id)!;
    const caps = ps.filter((p) => p.parentId === id && p.role === "letter");
    if (caps.length > 0) {
      for (const cap of caps) {
        const j = js.find((x) => (x.from.pieceId === id && x.to.pieceId === cap.id) || (x.to.pieceId === id && x.from.pieceId === cap.id));
        if (!j) continue;
        const bodyRef = j.from.pieceId === id ? j.from : j.to, capRef = j.from.pieceId === id ? j.to : j.from;
        const A = transformFace(letter.faces[bodyRef.faceIndex], pieceTransform(letter)), B = transformFace(cap.faces[capRef.faceIndex], pieceTransform(cap));
        const vx = (B.a[0] + B.b[0] - A.a[0] - A.b[0]) / 2, vy = (B.a[1] + B.b[1] - A.a[1] - A.b[1]) / 2;
        const len = Math.hypot(vx, vy);
        const dir: Pt = len > 1e-6 ? [vx / len, vy / len] : rotateVec([0, -1], letter.rotation);
        const d = marchDistance(poly, cap, dir, contoursOf(new Set([id, cap.id])), upm);
        if (d < STEM_MIN * upm) continue;
        ps = ps.map((p) => (p.id === cap.id ? { ...p, x: p.x + dir[0] * d, y: p.y + dir[1] * d } : p));
        stems++;
      }
      continue;
    }
    for (const end of freeEnds(letter, upm)) {
      const split = splitPieceAtCut(ps, js, id, { cutX: end.cutX, angle: end.angle });
      if (!split) continue;
      const cap = split.pieces[split.pieces.length - 1];
      const body = split.pieces.find((p) => p.id === id)!;
      const dir = rotateVec(end.dir, letter.rotation);
      // The cap must be the fragment on the end's side; `splitPieceAtCut` picks by area.
      const cc = transformPt(cap.pivot, pieceTransform(cap)), bc = transformPt(body.pivot, pieceTransform(body));
      if ((cc[0] - bc[0]) * dir[0] + (cc[1] - bc[1]) * dir[1] <= 0) continue;
      const others = inkContours(split.pieces.filter((p) => p.id !== id && p.id !== cap.id));
      const d = marchDistance(poly, cap, dir, others, upm);
      if (d < STEM_MIN * upm) continue;
      ps = split.pieces.map((p) => (p.id === cap.id ? { ...p, x: p.x + dir[0] * d, y: p.y + dir[1] * d } : p));
      js = split.joins;
      stems++;
      break;   // one pull per letter per run; the next run slides it further
    }
  }
  return { pieces: ps, joins: js, stems };
}
```

In `arrangeStackInShape`, between `arranged`/`polyFU` and `fillGaps`:

```ts
  let arrangedPieces = arranged;
  let arrangedJoins: StackJoin[] = input.joins.map((j) => ({ ...j, bow: 0, depth: 0 }));
  let stems = 0;
  if (input.pullStems) {
    const r = pullStemEnds(arrangedPieces, arrangedJoins, groups.map((g) => g.letter.id), polyFU, upm);
    arrangedPieces = r.pieces; arrangedJoins = r.joins; stems = r.stems;
  }
  const fills = fillGaps(polyFU, inkContours(arrangedPieces), input.fillers ?? [], upm, maxOrder);
  return { pieces: [...arrangedPieces, ...fills], joins: arrangedJoins, fontSize: input.fontSize * lo, rows: rows.length, fillers: fills.length, stems };
```

Note `maxOrder` must be computed before this block; and the `joins` line previously in the return is replaced by `arrangedJoins`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stackArrange.test.ts`
Expected: PASS. If "draws the middle alif" finds `r.stems === 0`: log `freeEnds(letter, 1000)` for an 80×600 rect — a zone should appear with |angle| ≈ π/2 and two spans; if `spanProbes` fails, the probe cut sits on a vertex (shift `cutX` by `clampCutX` is already applied by `pullSpans` ends; check `splitAtCut`'s contour orientation with a `rect` built counter-clockwise as the fixture does). If the cap is on the wrong side, the `dir` sign is reversed: check `fromZoneFrame([1,0], angle)` maps zone +x to piece (cos a, sin a).

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint
git add src/lib/stackArrange.ts src/lib/stackArrange.test.ts
git commit -m "Stack arrange: draw straight stems out toward the boundary"
```

---

### Task 11: Handler passes stems; real-font pin of detector coverage (Phase 3)

**Files:**
- Modify: `src/App.tsx` (`arrangeStackInGuide` from Task 7)
- Modify: `src/components/sidebar/StackPanel.tsx` (copy)
- Test: `src/lib/stackConvert.test.ts`

- [ ] **Step 1: Pin font coverage**

Append to `src/lib/stackConvert.test.ts` (uses the file's existing `convert(text, fontFile)` helper):

```ts
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
```

Imports: `findCutZonesSwept` added to the `./strokeCuts` import; `import { stackDetectOpts } from "./stackZones";`.

- [ ] **Step 2: Run**

Run: `npx vitest run src/lib/stackConvert.test.ts -t "stem zones"`
Expected: PASS (these pin current behaviour; if UKIJ Diwani reports a zone, inspect its length — the spec's probe measured 30–50 per 1000, under the `0.1 * upm` floor).

- [ ] **Step 3: Handler and copy**

In `arrangeStackInGuide` (Task 7), add `pullStems: true,` to the `arrangeStackInShape` call, and extend the status:

```ts
      (result.fillers > 0 ? `, ${plural(result.fillers, "ornament")} added` : "") +
      (result.stems > 0 ? `, ${plural(result.stems, "stem")} lengthened` : "") + fontNote + "."
```

In `StackPanel.tsx`, replace the explanatory paragraph with:

```
      Filling a guide lays the letters in rows from the bottom up, in reading order, leans the
      outer letters into the edge, draws straight upstrokes out toward the boundary where the
      stroke is straight and even (a tapering stem is left alone), and sizes the composition to
      the shape. With the box above checked, the gaps are busied with the font's own tashkeel.
      You can still drag, tilt and bend afterwards; Reset layout removes the ornaments and
      returns pulled stems.
```

- [ ] **Step 4: Verify by hand**

`npm run dev`: Amiri الملك converted, a tall teardrop guide, Fill. Expected: status includes "1 stem lengthened" (or more); the alif reaches toward the tip; re-running keeps the cap count; Reset returns it. UKIJ Diwani: no stem message, nothing broken.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test
git add src/App.tsx src/components/sidebar/StackPanel.tsx src/lib/stackConvert.test.ts
git commit -m "Stack arrange: pull stems from the handler; pin detector coverage per font"
```

---

### Task 12: Phase 3 docs, deferred note, final verification

**Files:**
- Modify: `.claude/rules/stacked-compositions.md`, `.claude/rules/stroke-cuts.md`, `.claude/rules/deferred-features.md`, `PROGRESS.md`

- [ ] **Step 1: Rules**

Append to the "Fill a guide shape" paragraph in `stacked-compositions.md`:

```
**Stems** (`pullStemEnds`, after tilt, before fillers): each letter's
straight zones are found once with `stackDetectOpts` (both sweep bases,
aspect floor ≥ 1); a two-span zone's end that splits (`spanProbes`) and has
no face within a thickness is a free end. At the found scale the end is cut
(`splitPieceAtCut`, the cap confirmed to lie on the end's side) and the cap
marched along the stem's axis in `STEM_STEP` steps until its `LETTER_GAP`-
padded box would leave the shape or touch other ink; under `STEM_MIN` the
cut is dropped. A letter that already has a cap is **slid** along its join
axis instead, so re-runs are idempotent and a hand-pulled cap is the same
thing. One pull per letter per run. **Font-dependent by design**: the
detector wants even thickness, so Amiri and FatemiMaqala stems pull while
both Diwani faces and Thuluth taper and are left alone
(`stackConvert.test.ts` pins this); loosening the tolerance needs a
measurement script first (stroke-cuts.md). Reset returns caps to the cut
(`rebasePiece` keeps a cap's home at the letter's).
```

In `stroke-cuts.md`, add one line after the sentence about the fifteen rotations (around line 108):

```
`DetectOpts.baseAngles` (default `[0]`) adds further sweep bases — the stack
editor and arranger pass `[0, π/2]` (`stackDetectOpts`) so upstrokes are
found — and `minAspect` (default 0; stack passes 1) drops the zone a sweep
finds *across* a short stroke. Live-text cuts use neither.
```

In `deferred-features.md`, under "Bending letter bodies", add:

```
    Includes **widening the radius of a curved stroke** (asked 2026-10-15
    alongside stack arrange fillers; see
    `docs/superpowers/specs/2026-10-15-stack-arrange-fill-design.md`,
    "Out of scope"): a bowl has only an outline, no spine, so this is the
    same skeleton + nib work.
```

- [ ] **Step 2: PROGRESS bullet**

Under the 2026-10-15 entry:

```
- **Upstrokes reach for the edge.** The zone sweep gained a second base
  angle, so an alif's stem is cut-and-pullable by hand and the arranger
  pulls free stem ends toward the boundary. Font-dependent: Amiri and
  FatemiMaqala pull, the Diwani faces and Thuluth taper and do not —
  pinned in `stackConvert.test.ts`; see
  [stacked-compositions.md](.claude/rules/stacked-compositions.md).
```

- [ ] **Step 3: Full verification loop and commit**

```bash
npx tsc --noEmit -p tsconfig.app.json && npm run lint && npm test && npm run build
git add .claude/rules/stacked-compositions.md .claude/rules/stroke-cuts.md .claude/rules/deferred-features.md PROGRESS.md
git commit -m "Docs: stem pull, sweep bases, curve radius deferred"
```

---

## Self-review notes

- Spec coverage: Phase 1 §1–4 → Tasks 1–3; fit check → Task 3 `arrangeAt` guard; Phase 2 input/pass/outlines/panel/strip/reset/status → Tasks 5–7; Phase 3 sweep/overlay/free ends/march/idempotence/no history push → Tasks 9–11; data model → Task 5; tests → each task; docs → Tasks 4, 8, 12. One deviation from the spec: `splitPieceAtCut` is **not** moved into `stackGeometry.ts` — it depends on `rebasePiece` (`stackOutline.ts`), which imports `stackGeometry.ts`, so the move would create a cycle; `stackConvert.ts` is harfbuzz-free, so the arranger imports it directly. Record this in the rules paragraph (Task 12 text already names `splitPieceAtCut` without a module move).
- Type consistency: `Placement`, `FillerShape`, `ArrangeInput.{fillers,pullStems}`, `ArrangeResult.{fillers,stems}`, `stackDetectOpts(upm)`, `scaleCmds(cmds,k)`, `fillerShapes(font,upm,nibWidth)`, `teardropShape(nibWidth)` are named identically wherever used.
