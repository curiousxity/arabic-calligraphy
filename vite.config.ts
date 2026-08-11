import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
