import { expect, test, type Browser, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { blockClientBox, getBlocks, gotoApp, settleFrames, type Box, type Point } from "../harf";

/**
 * Records the Add-button demo GIFs in public/demos/. Not part of `npm run e2e`
 * (playwright.config.ts ignores this folder); run it on purpose with
 *
 *   npm run demos:record
 *
 * Needs ffmpeg on PATH. Each test records a video, then crops it to the
 * blocks on the canvas and converts it with a generated palette.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const OUT = path.join(ROOT, "public/demos");
const TMP = path.join(ROOT, "test-results/demo-videos");
const SIZE = { width: 400, height: 300 };
const VIEWPORT = { width: 1440, height: 900 };
/** Right edge of the sidebar and top of the zoom toolbar; crops stay clear of both. */
const CANVAS_LEFT = 372;
const CANVAS_BOTTOM = 830;

// Playwright's video has no pointer, so draw one that follows the real events.
const CURSOR = `
addEventListener("DOMContentLoaded", () => {
  const c = document.createElement("div");
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-8.4L21 10z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  Object.assign(c.style, { position: "fixed", left: "-100px", top: "-100px", zIndex: 99999, pointerEvents: "none", transform: "translate(-3px,-2px)" });
  const ring = document.createElement("div");
  Object.assign(ring.style, { position: "absolute", left: "-8px", top: "-8px", width: "22px", height: "22px", borderRadius: "50%", background: "rgba(56,189,248,0.35)", opacity: 0 });
  c.prepend(ring);
  document.body.appendChild(c);
  const at = (e) => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; };
  addEventListener("pointermove", at, true);
  addEventListener("pointerdown", (e) => { at(e); ring.style.opacity = 1; }, true);
  addEventListener("pointerup", () => { ring.style.opacity = 0; }, true);
});`;

async function glide(page: Page, to: Point, ms = 600) {
  await page.mouse.move(to.x, to.y, { steps: Math.max(8, Math.round(ms / 16)) });
  await settleFrames(page);
}

/** Page-space point at a fraction of the stage. */
function stagePoint(page: Page, fx: number, fy: number): Promise<Point> {
  return page.evaluate(
    ({ fx, fy }) => {
      const c = window.__HARF__!.getStage()!.container().getBoundingClientRect();
      return { x: c.left + c.width * fx, y: c.top + c.height * fy };
    },
    { fx, fy }
  );
}

/** A 4:3 crop around the blocks other than `skip`, clear of the sidebar. */
async function cropAroundBlocks(page: Page, skip: Set<number>): Promise<Box> {
  const blocks = (await getBlocks(page)).filter((b) => !skip.has(b.id));
  const boxes = await Promise.all(blocks.map((b) => blockClientBox(page, b.id)));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  let w = Math.max(SIZE.width, (x1 - x0) * 1.3, (y1 - y0) * 1.3 * (4 / 3));
  w = Math.min(w, VIEWPORT.width - CANVAS_LEFT);
  const h = Math.min(CANVAS_BOTTOM, w * 0.75);
  w = h / 0.75;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const x = Math.min(Math.max(CANVAS_LEFT, cx - w / 2), VIEWPORT.width - w);
  const y = Math.min(Math.max(0, cy - h / 2), CANVAS_BOTTOM - h);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/**
 * Opens a recording context, runs `setup` off camera, then `act` on camera,
 * and writes public/demos/<name>.gif cropped to the blocks `act` added
 * (or to every block, with `frameAll`).
 */
async function record(
  browser: Browser,
  name: string,
  setup: (page: Page) => Promise<void>,
  act: (page: Page) => Promise<void>,
  { frameAll = false } = {}
) {
  mkdirSync(TMP, { recursive: true });
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: TMP, size: VIEWPORT },
  });
  await ctx.addInitScript(CURSOR);
  const page = await ctx.newPage();
  const t0 = Date.now();
  await gotoApp(page);
  await setup(page);
  const skip = new Set(frameAll ? [] : (await getBlocks(page)).map((b) => b.id));
  await page.mouse.move(VIEWPORT.width - 10, VIEWPORT.height - 10);
  await page.waitForTimeout(300);
  const start = (Date.now() - t0) / 1000;
  await page.waitForTimeout(400);
  await act(page);
  await page.waitForTimeout(1200);
  const end = (Date.now() - t0) / 1000;
  const crop = await cropAroundBlocks(page, skip);
  const video = page.video()!;
  await ctx.close();
  const src = await video.path();

  const vf =
    `fps=12,crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},` +
    `scale=${SIZE.width}:${SIZE.height}:flags=lanczos`;
  const palette = path.join(TMP, `${name}-palette.png`);
  const trim = ["-ss", String(start), "-to", String(end)];
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y", ...trim, "-i", src,
    "-vf", `${vf},palettegen=stats_mode=diff`, palette,
  ]);
  execFileSync("ffmpeg", [
    "-loglevel", "error", "-y", ...trim, "-i", src, "-i", palette,
    "-lavfi", `${vf}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    path.join(OUT, `${name}.gif`),
  ]);
  rmSync(src);
}

async function zoomOut(page: Page, steps: number) {
  for (let i = 0; i < steps; i++) {
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.waitForTimeout(150);
  }
}

/** Zooms out so the starter block and the copy placed beside it both fit. */
const roomForCopy = (page: Page) => zoomOut(page, 3);

/** `clearCanvas` after zooming out, for blocks too big to frame at the default zoom. */
const clearCanvasAt = (steps: number) => async (page: Page) => {
  await zoomOut(page, steps);
  await clearCanvas(page);
};

/**
 * Pans the starter block out of view, so the new one is alone in the frame.
 * (The app never lets the canvas go empty, so deleting it isn't an option.)
 */
async function clearCanvas(page: Page) {
  const from = await stagePoint(page, 0.5, 0.9);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(from.x, from.y - 560, { steps: 20 });
  await page.mouse.up({ button: "middle" });
  await settleFrames(page);
}

/** Glides in so the placement ghost follows the pointer, then clicks to drop it. */
async function place(page: Page, fx = 0.55, fy = 0.5) {
  const to = await stagePoint(page, fx, fy);
  await page.mouse.move(to.x - 160, to.y + 90);
  await glide(page, to, 1100);
  await page.waitForTimeout(250);
  await page.mouse.click(to.x, to.y);
}

test.setTimeout(120_000);

test("add text", async ({ browser }) => {
  await record(browser, "add-text", clearCanvas, async (page) => {
    await page.getByRole("button", { name: "Add text", exact: true }).click();
    await place(page);
  });
});

test("add shape fill", async ({ browser }) => {
  await record(browser, "add-shape-fill", clearCanvasAt(3), async (page) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add shape fill" }).click();
    await (await chooser).setFiles(path.join(HERE, "circle.svg"));
    await place(page);
  });
});

test("add curved text", async ({ browser }) => {
  await record(browser, "add-curved-text", clearCanvasAt(2), async (page) => {
    await page.getByRole("button", { name: "Add curved text" }).click();
    await place(page);
  });
});

test("add square kufi", async ({ browser }) => {
  await record(browser, "add-square-kufi", clearCanvas, async (page) => {
    await page.getByRole("button", { name: "Add square kufi" }).click();
    await place(page);
  });
});

test("add image", async ({ browser }) => {
  await record(browser, "add-image", clearCanvas, async (page) => {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Add image" }).click();
    await (await chooser).setFiles(path.join(ROOT, "public/logo-icon.png"));
    await place(page);
  });
});

test("add ornament", async ({ browser }) => {
  await record(browser, "add-ornament", clearCanvasAt(4), async (page) => {
    await page.getByRole("button", { name: "Add ornament" }).click();
    await page.getByRole("button", { name: /^Fill with text: / }).first().click();
    await place(page);
  });
});

test("add mirror", async ({ browser }) => {
  await record(browser, "add-mirror", roomForCopy, async (page) => {
    await page.getByRole("button", { name: "Add mirror" }).click();
    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);
  }, { frameAll: true });
});

test("add medallion", async ({ browser }) => {
  await record(browser, "add-medallion", roomForCopy, async (page) => {
    await page.getByRole("button", { name: "Add medallion" }).click();
    await expect.poll(async () => (await getBlocks(page)).length).toBe(2);
  }, { frameAll: true });
});
