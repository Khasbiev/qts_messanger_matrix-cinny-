import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  cacheDir: 'C:/vite-cache/qts-messenger',
  define: {
    global: 'globalThis',
    'process.env': '{}',
  },
  optimizeDeps: {
    include: ['matrix-js-sdk'],
  },
  build: {
    commonjsOptions: { transformMixedEsModules: true },
  },
})
