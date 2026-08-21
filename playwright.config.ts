import { defineConfig, devices } from "@playwright/test";

// Overridable so the suite can still run when another project already holds
// 5173. `reuseExistingServer` is the reason this matters: with a *foreign*
// dev server on the port, Playwright happily reuses it and every test times
// out against someone else's app rather than failing loudly.
const PORT = Number(process.env.HARF_E2E_PORT ?? 5173);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * End-to-end suite. Chromium only for now — the point of this harness is to
 * exercise Konva's canvas overlays with *trusted* input events, which is a
 * property of driving a real browser over CDP rather than of any particular
 * engine.
 *
 * The viewport is pinned at 1440x900 because the editor's layout is
 * width-sensitive: `App.tsx` switches to a mobile layout at <=768px and
 * hides the right-hand panel with it, so a narrower default would silently
 * change which controls the tests can reach.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  timeout: 45_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1440, height: 900 },
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    // `--strictPort` so a port collision fails loudly instead of Vite
    // quietly moving to 5174 and Playwright waiting out its timeout on a
    // URL nothing is serving.
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
