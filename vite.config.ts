import { defineConfig } from 'vite'

export default defineConfig({
  base: '/g2-car-nav/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
})
