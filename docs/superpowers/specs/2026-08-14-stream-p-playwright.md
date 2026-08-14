# Stream P — Playwright e2e infrastructure

Branch: `stream/p-playwright` (worktree). Read
`2026-08-14-program-overview.md` first. Runs parallel with stream R;
**merges after R** and rebases so its tests describe the post-removal app.

## Why

`PROGRESS.md`'s verification-debt section is a catalogue of things only a
real browser can check: hover-mounted Konva overlays, drag gestures, and a
documented regression class where deleting one function argument silently
disables a whole feature while tsc, lint, unit tests and build all stay
green. Every phase-1+ stream owes an e2e test, so the harness lands first.

Synthetic-event history worth knowing: scripted *hovers* reach Konva's
hover-mounted handles; scripted *drags* previously fell through to the block
underneath — but those attempts used extension-injected synthetic events.
Playwright drives real CDP input (trusted events), so drags are expected to
work. **Verify this early** — a passing drag test is this stream's single
most valuable deliverable. If CDP drags also fall through, say so in the
report rather than shipping a test that asserts nothing.

## Design

- `npm i -D @playwright/test`; `npx playwright install chromium`. Chromium
  only for now.
- `playwright.config.ts`: `webServer` runs `npm run dev` (reuse existing
  server locally), `use: { viewport: { width: 1440, height: 900 } }`,
  testDir `e2e/`.
- `package.json` scripts: `"e2e": "playwright test"`,
  `"e2e:ui": "playwright test --ui"`.
- `e2e/` at repo root (not `src/` — vitest must not pick these up; confirm
  vitest's include glob doesn't match, and add an exclude if it does).

### The test bridge

Konva draws to one canvas; the DOM is opaque to assertions. Add
`src/lib/testBridge.ts`: in dev builds only (`import.meta.env.DEV`), expose
`window.__HARF__ = { getBlocks, getSelectedIds, getStage }` — wired from
`App.tsx` with a couple of lines (`useEffect` keeping refs current). Guarded
so production builds ship nothing. This is the only file outside `e2e/` and
config this stream touches in `src/`, and it is deliberately tiny.

Canvas *appearance* assertions use pixels, not the bridge: screenshot the
stage element and assert non-blank / compare regions. Keep pixel assertions
coarse (ink present / absent in a region), never exact-image, or font
rendering differences across machines will flake.

### Initial suite (`e2e/core.spec.ts` + friends)

1. **Boot** — app loads, no console errors (fail on any `console.error`).
2. **Type & render** — select the default block via bridge, type Arabic text
   in the Content textarea, assert the stage region gains ink.
3. **Drag a block** — mouse-drag on the block's canvas position; assert via
   bridge that `x/y` changed by roughly the drag delta. This is the
   trusted-drag proof.
4. **Hover overlay** — with a selected text block containing tashkeel, hover
   a mark's hit box (positions via bridge + block geometry); assert the
   diacritic handles mount (Konva node count or pixel probe).
5. **Handle drag** — drag the diacritic move handle vertically; assert the
   override took (bridge: block's `diacriticOverrides` changed). The other
   half of the trusted-drag proof, on the small-target case.
6. **Undo/redo** — mutate, undo, assert state reverted via bridge.
7. **Export** — click PNG export, assert a download event fires with a
   non-trivial byte length.

Write tests against features that survive stream R (diacritics, move &
scale, plain drag) — not the Morph panel. If running before R merges,
that's already the correct target set.

## Ownership

Exclusive: `e2e/**`, `playwright.config.ts`, `src/lib/testBridge.ts`.
Shared, small: `package.json` (devDependency + scripts), `App.tsx` (one
bridge-wiring `useEffect` — keep it to a single contiguous block),
`.gitignore` (playwright-report/, test-results/), `CLAUDE.md` (new short
"E2E tests" section documenting how to run and the bridge contract).

## Done

`npm run e2e` green locally from a clean checkout; suite runtime under two
minutes; `npm test` and `npm run build` unaffected; report says explicitly
whether trusted drags reach Konva handles.
