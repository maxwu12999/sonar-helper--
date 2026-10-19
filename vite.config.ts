import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        analysisWorkerClient: fileURLToPath(
          new URL('./src/workers/analysisWorkerBuildEntry.ts', import.meta.url),
        ),
      },
      preserveEntrySignatures: 'exports-only',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
})
