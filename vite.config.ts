import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3030,
    proxy: {
      '/assistant': { target: 'http://localhost:8080', changeOrigin: true },
      '/csv-import': { target: 'http://localhost:8080', changeOrigin: true },
      '/query': { target: 'http://localhost:8080', changeOrigin: true },
    },
  },
})
