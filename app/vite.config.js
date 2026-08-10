import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { offlineServiceWorker } from './vite-plugin-offline-sw.js'

// https://vite.dev/config/
export default defineConfig({
  // sw.js is generated from the real bundle at build time — see the plugin.
  plugins: [react(), offlineServiceWorker()],
  server: {
    open: false,
    host: '127.0.0.1',
    port: 5173,
  },
})
