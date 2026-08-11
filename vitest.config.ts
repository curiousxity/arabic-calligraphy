import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: {
      'opentype.js': path.resolve(
        __dirname,
        'node_modules/opentype.js/dist/opentype.module.js'
      ),
      'imagetracerjs': path.resolve(
        __dirname,
        'node_modules/imagetracerjs/imagetracer_v1.2.6.js'
      ),
    },
  },
})
