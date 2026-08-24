import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
// The FastAPI service (see ARCHITECTURE.md §4) is proxied so the browser makes
// same-origin requests and no CORS handling is needed locally.
const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173, proxy: apiProxy },
  // `preview` needs the same proxy, or a production build served locally
  // would fall back to the SPA index.html for every /api call.
  preview: { port: 4173, proxy: apiProxy },
})
