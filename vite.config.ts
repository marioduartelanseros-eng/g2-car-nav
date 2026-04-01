import { defineConfig } from 'vite'

export default defineConfig({
  base: '/g2-car-nav/',
  server: {
    host: true,
    port: process.env.PORT ? parseInt(process.env.PORT) : 5173,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
  },
})
