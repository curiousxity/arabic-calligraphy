import { expect, test, type Download, type Page } from "@playwright/test";
import {
  blockClientBox,
  collectConsoleErrors,
  getBlocks,
  gotoApp,
  inkPixels,
} from "./harf";

const STAGE_CANVAS = ".konvajs-content canvas";

async function openPanel(page: Page, name: RegExp) {
  const button = page.getByRole("button", { name });
  if ((await button.getAttribute("aria-expanded")) !== "true") await button.click();
}

/**
 * How many distinct colours appear in a page-space box of the live stage.
 *
 * This is the coarse "is it a gradient" question: flat ink over flat paper is
 * two colours plus a thin antialiased fringe, while a five-stop metallic is
 * hundreds. Deliberately not an image comparison — font rasterisation differs
 * between machines and would flake.
 */
async function distinctColors(
  page: Page,
  box: { x: number; y: number; width: number; height: number }
): Promise<number> {
  return page.evaluate(
    ({ sel, b }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(sel);
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = canvas.width / rect.width;
      const px = Math.max(0, Math.round((b.x - rect.left) * ratio));
      const py = Math.max(0, Math.round((b.y - rect.top) * ratio));
      const pw = Math.min(canvas.width - px, Math.round(b.width * ratio));
      const ph = Math.min(canvas.height - py, Math.round(b.height * ratio));
      if (pw <= 0 || ph <= 0) return 0;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return 0;
      const { data } = ctx.getImageData(px, py, pw, ph);
      const seen = new Set<number>();
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 16) continue;
        // Quantised to 3 bits per channel: antialiasing alone must not be
        // able to manufacture "lots of colours".
        seen.add(((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5));
      }
      return seen.size;
    },
    { sel: STAGE_CANVAS, b: box }
  );
}

/**
 * A new block follows the cursor until a click drops it (`beginPlacement` in
 * App.tsx), so adding one is always two steps.
 */
async function placeAtCanvas(page: Page, fx: number, fy: number) {
  const pt = await page.evaluate(
    ({ fx, fy }) => {
      const c = window.__HARF__!.getStage()!.container().getBoundingClientRect();
      return { x: c.left + c.width * fx, y: c.top + c.height * fy };
    },
    { fx, fy }
  );
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.click(pt.x, pt.y);
}

/** A page-space box in the top-left corner of the stage, clear of the text. */
async function paperCorner(page: Page) {
  return page.evaluate(() => {
    const c = window.__HARF__!.getStage()!.container().getBoundingClientRect();
    return { x: c.left + 8, y: c.top + 8, width: 120, height: 120 };
  });
}

async function bytesOf(download: Download): Promise<Buffer> {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function exportAndRead(page: Page, label: string): Promise<Buffer> {
  await openPanel(page, /Project & Export/);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: label, exact: true }).click(),
  ]);
  return bytesOf(download);
}

async function chooseSurface(page: Page, textureId: string) {
  await openPanel(page, /Artboard/);
  await page.locator("#artboard-surface").selectOption(textureId);
}

test("a metallic preset turns flat ink into a gradient", async ({ page }) => {
  await gotoApp(page);
  // This measures colours inside the block's own box, and a new document now
  // opens on textured paper — whose grain lands in that box and swamps the
  // count. Bare paper is the baseline this test wants: it is about ink.
  // Polled rather than read once: clearing the surface is a React state
  // change the canvas repaints a frame or more later.
  const [block] = await getBlocks(page);
  const box = await blockClientBox(page, block.id);
  await chooseSurface(page, "");
  // 30, not 20: the alignment grid draws as a one-device-pixel hairline at
  // any zoom, and a sub-pixel line antialiases into a few blend buckets that
  // a crisp 2.75px line at this zoom did not produce. The assertion that
  // carries the meaning is the +10 delta below; this only pins that the
  // baseline really is flat ink on flat paper.
  await expect.poll(() => distinctColors(page, box)).toBeLessThan(30);

  const before = await distinctColors(page, box);

  await openPanel(page, /Effects/);
  await page.getByRole("button", { name: "Gold leaf" }).click();

  // The document records a gradient; `color` is left alone, which is what
  // keeps every other consumer of it working.
  await expect.poll(async () => (await getBlocks(page))[0].fill?.type).toBe("linear");
  expect((await getBlocks(page))[0].color).toBe(block.color);

  await expect.poll(() => distinctColors(page, box)).toBeGreaterThan(before + 10);
});

test("switching back to flat ink drops the gradient again", async ({ page }) => {
  await gotoApp(page);
  await openPanel(page, /Effects/);
  await page.getByRole("button", { name: "Silver" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].fill?.type).toBe("linear");

  await page.locator("#block-fill-type").selectOption("solid");
  await expect.poll(async () => (await getBlocks(page))[0].fill).toBeUndefined();
});

test("a paper surface textures the page, and a tint recolours it", async ({ page }) => {
  await gotoApp(page);
  const corner = await paperCorner(page);

  // A new document now opens on washi, so bare paper has to be asked
  // for before it can be the baseline. Chosen explicitly rather than
  // assumed: that it is *reachable* is the half of this the default change
  // could break.
  await chooseSurface(page, "");
  await expect.poll(() => distinctColors(page, corner)).toBeLessThanOrEqual(2);

  await chooseSurface(page, "parchment");
  await expect.poll(() => distinctColors(page, corner)).toBeGreaterThan(3);

  const textured = await distinctColors(page, corner);
  await page.locator("#artboard-surface-tint").fill("#3a2a12");
  // A dark tint still has grain, and is unmistakably not the pale default.
  await expect.poll(() => distinctColors(page, corner)).toBeGreaterThan(1);
  await expect.poll(() => inkPixels(page, corner)).toBeGreaterThan(0);
  expect(textured).toBeGreaterThan(3);
});

test("the surface survives a reload, and an old save loads without one", async ({ page }) => {
  await gotoApp(page);
  await chooseSurface(page, "linen");
  const corner = await paperCorner(page);
  await expect.poll(() => distinctColors(page, corner)).toBeGreaterThan(3);

  // There is no autosave — the quick-save button is what writes the payload
  // this test then reloads from.
  await openPanel(page, /Project & Export/);
  await page.getByRole("button", { name: "Quick save" }).click();

  await page.reload();
  await page.waitForFunction(() => !!window.__HARF__?.getStage());
  await expect.poll(() => distinctColors(page, corner)).toBeGreaterThan(3);

  // Now stand in a payload of the kind written before this feature: no
  // `artboardSurface` key at all, and no `fill` on the block. It must load as
  // bare paper rather than inheriting the surface already on screen.
  const errors = collectConsoleErrors(page);
  await page.evaluate(() => {
    const raw = localStorage.getItem("calligraphy-layout-v2");
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    delete parsed.artboardSurface;
    localStorage.setItem("calligraphy-layout-v2", JSON.stringify(parsed));
  });
  await page.reload();
  await page.waitForFunction(() => !!window.__HARF__?.getStage());

  await expect.poll(() => inkPixels(page)).toBeGreaterThan(0);
  await expect.poll(() => distinctColors(page, corner)).toBeLessThanOrEqual(2);
  expect((await getBlocks(page))[0].fill).toBeUndefined();
  expect(errors).toEqual([]);
});

test("a PNG export with a surface differs from one without", async ({ page }) => {
  await gotoApp(page);
  // Transparency defaults on and drops the page rect — and with it the
  // texture, which is exactly the behaviour being pinned here.
  await openPanel(page, /Project & Export/);
  await page.getByLabel(/Transparent background/).uncheck();

  // "Plain" has to be asked for now that a new document opens on washi —
  // otherwise this compares washi against washi and reports no difference.
  await chooseSurface(page, "");
  const plain = await exportAndRead(page, "Export PNG");
  await chooseSurface(page, "washi");
  const textured = await exportAndRead(page, "Export PNG");

  expect(textured.equals(plain)).toBe(false);
});

/**
 * The spike this stream was asked to run before building any UI: does
 * `react-konva-to-svg` keep a canvas-gradient fill?
 *
 * It does — svgcanvas emits a real `<linearGradient>` def — but it reads
 * gradient coordinates in the document's *root* space rather than through the
 * transform in force when the fill happens. `lib/blockFill.ts` detects that
 * context and pre-multiplies the geometry, so nothing has to rasterize and
 * the Export panel needs no warning. This test is what stops that from
 * silently regressing into flat-filled letters.
 */
test("an SVG export keeps a gradient as a real gradient", async ({ page }) => {
  await gotoApp(page);
  await openPanel(page, /Effects/);
  await page.getByRole("button", { name: "Gold leaf" }).click();
  await expect.poll(async () => (await getBlocks(page))[0].fill?.type).toBe("linear");

  const svg = (await exportAndRead(page, "Export SVG")).toString("utf8");
  const grad = svg.match(/<linearGradient[^>]*>/)?.[0];
  expect(grad).toBeTruthy();
  // The metallic's own stops, not a flattened average of them.
  expect(svg.toLowerCase()).toContain("#fbf3c0");

  // And it has to land *on* the artwork. The whole reason `blockFill.ts`
  // treats this context specially is that svgcanvas reads gradient
  // coordinates in root space; get that wrong and the def is still here but
  // the letters come out a flat end-stop colour.
  const num = (attr: string) => Number(/(-?[\d.]+)px/.exec(
    new RegExp(`${attr}="([^"]+)"`).exec(grad!)![1]
  )![1]);
  const [, vx, vy, vw, vh] = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/
    .exec(svg)!
    .map(Number);
  const midX = (num("x1") + num("x2")) / 2;
  const midY = (num("y1") + num("y2")) / 2;
  expect(Math.hypot(num("x2") - num("x1"), num("y2") - num("y1"))).toBeGreaterThan(10);
  expect(midX).toBeGreaterThanOrEqual(vx);
  expect(midX).toBeLessThanOrEqual(vx + vw);
  expect(midY).toBeGreaterThanOrEqual(vy);
  expect(midY).toBeLessThanOrEqual(vy + vh);
});

/**
 * The other two renderers. Both fill inside per-glyph transforms — a tile's
 * row scale, or a rotation onto a curve tangent — so a gradient reaching them
 * unaided would restart inside every letter instead of spanning the block.
 * Each gets its own test with its own empty patch of canvas, because the
 * measurement is "how varied are the pixels here" and an overlapping
 * neighbour would answer for it.
 */
test("a gradient reaches a Shape Fill block", async ({ page }) => {
  await gotoApp(page);
  // Flat paper: this asserts a *delta* in colour count, and a textured
  // surface inflates the baseline until the gradient can no longer clear it.
  await chooseSurface(page, "");

  // The ornament picker builds a shapeFill block with no file dialog.
  await page.getByRole("button", { name: "Add ornament" }).click();
  await page.getByRole("button", { name: /^Fill with text: / }).first().click();
  await placeAtCanvas(page, 0.5, 0.62);
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "shapeFill"))
    .toBe(true);

  const block = (await getBlocks(page)).find((b) => b.type === "shapeFill")!;
  const box = await blockClientBox(page, block.id);
  const before = await distinctColors(page, box);

  await openPanel(page, /Effects/);
  await page.getByRole("button", { name: "Copper" }).click();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === block.id)?.fill?.type)
    .toBe("linear");
  await expect.poll(() => distinctColors(page, box)).toBeGreaterThan(before + 10);
});

test("a gradient reaches a Curve block", async ({ page }) => {
  await gotoApp(page);
  // Flat paper: this asserts a *delta* in colour count, and a textured
  // surface inflates the baseline until the gradient can no longer clear it.
  await chooseSurface(page, "");

  await page.getByRole("button", { name: "Add curved text" }).click();
  await placeAtCanvas(page, 0.5, 0.75);
  await expect
    .poll(async () => (await getBlocks(page)).some((b) => b.type === "textPath"))
    .toBe(true);

  const block = (await getBlocks(page)).find((b) => b.type === "textPath")!;
  const box = await blockClientBox(page, block.id);
  const before = await distinctColors(page, box);

  await openPanel(page, /Effects/);
  await page.getByRole("button", { name: "Lapis & gold" }).click();
  await expect
    .poll(async () => (await getBlocks(page)).find((b) => b.id === block.id)?.fill?.type)
    .toBe("radial");
  await expect.poll(() => distinctColors(page, box)).toBeGreaterThan(before + 10);
});
