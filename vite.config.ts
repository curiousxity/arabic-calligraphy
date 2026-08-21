/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // package.json is the single source of truth for the version the
    // sidebar shows, so bumping it there is the whole release step.
    // `define` substitutes this literally into the source, so the value
    // has to be JSON-stringified — injecting a bare 0.1.0 would be
    // parsed as tokens, not a string, and fail the build.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      // opentype.js has no "exports" field, which causes Rolldown (Vite 8) to
      // fail resolution. Point directly to its pre-built ESM module file.
      'opentype.js': path.resolve(
        __dirname,
        'node_modules/opentype.js/dist/opentype.module.js'
      ),
    },
  },
  test: {
    // Vitest's default include glob matches `e2e/*.spec.ts`, and a
    // Playwright spec loaded under vitest fails in a way that reads like a
    // broken test rather than a misrouted one. `e2e/` belongs to
    // `playwright.config.ts`; everything else stays at vitest's defaults.
    //
    // The leading `**/` is load-bearing: a bare `e2e/**` only matches the
    // suite at the project root, so a git worktree inside the repo — and
    // `.claude/worktrees/` is where Claude Code puts them by default — has
    // its *copy* of the suite collected too. That reads as 12 failing test
    // files and roughly double the test count, which looks like the merge
    // you just made broke something rather than like a second checkout
    // being scanned. Hit and fixed on 2026-08-21.
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        codeSplitting: true,
      },
    },
  },
})
