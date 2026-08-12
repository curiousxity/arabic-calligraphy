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
      // Same problem, same fix: imagetracerjs's package.json only has "main",
      // no "exports" field.
      // NOTE: imagetracerjs ships its entry file under a version-numbered
      // name, so this path is version-specific — package.json pins the dep
      // exactly ("1.2.6", no caret) and the two must be bumped together, or
      // an upgrade silently breaks resolution.
      'imagetracerjs': path.resolve(
        __dirname,
        'node_modules/imagetracerjs/imagetracer_v1.2.6.js'
      ),
    },
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
