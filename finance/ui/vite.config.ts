import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const packageRoot = dirname(fileURLToPath(import.meta.url))

/** Dedicated deployable Finance artifact. The CRM shell loads it by a stable URL. */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Library builds do not receive Vite's application HTML replacement. Pin
  // React's browser bundle to production so it never evaluates Node's
  // `process.env.NODE_ENV` in the independently served artifact.
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: { alias: { '@': resolve(packageRoot, 'src') }, dedupe: ['react', 'react-dom'] },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: { entry: resolve(packageRoot, 'src/entry.tsx'), formats: ['es'], fileName: 'finance-module' },
    rollupOptions: { output: { codeSplitting: false } },
  },
})
