import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // just raise the warning threshold (kB); no functional change
    chunkSizeWarningLimit: 1200,
    // optional: put big libs into their own chunk
    rolldownOptions: {
      output: {
        // enable/ensure code splitting
        codeSplitting: true
      }
    }
  }
})