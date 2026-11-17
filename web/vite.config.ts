import { defineConfig } from 'vite'

// `base` lets the same build work at the domain root or under a GitHub Pages
// project path: set BASE_PATH=/repo-name/ in CI.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node' }
})
