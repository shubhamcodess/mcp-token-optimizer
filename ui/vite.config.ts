import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

// Built into dist/ui, served by the daemon. No CDN, no inline assets (the daemon's CSP only allows 'self').
export default defineConfig({
  root: import.meta.dirname,
  base: '/',
  plugins: [preact()],
  build: { outDir: '../dist/ui', emptyOutDir: true, assetsInlineLimit: 0, cssCodeSplit: false, sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
})
