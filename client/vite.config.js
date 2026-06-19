import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Vite copies public/sw.js verbatim, so it never goes through the JS
// transform pipeline. This stamps a per-build version into the copied
// file's __BUILD_ID__ placeholder after the build, so the service worker's
// cache name changes on every deploy and the browser picks up the update.
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist')
      const swPath = resolve(outDir, 'sw.js')
      const contents = readFileSync(swPath, 'utf8')
      writeFileSync(swPath, contents.replaceAll('__BUILD_ID__', String(Date.now())))
    }
  }
}

export default defineConfig({
  plugins: [react(), stampServiceWorker()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true }
    }
  },
  build: { outDir: 'dist' }
})
