import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/** Dedicated deployable Finance artifact. The CRM shell loads it by a stable URL. */
export default defineConfig({
  plugins: [react()],
  // Library builds do not receive Vite's application HTML replacement. Pin
  // React's browser bundle to production so it never evaluates Node's
  // `process.env.NODE_ENV` in the independently served artifact.
  define: { 'process.env.NODE_ENV': '"production"' },
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') }, dedupe: ['react', 'react-dom'] },
  build: {
    outDir: 'dist-finance',
    emptyOutDir: true,
    lib: { entry: resolve(import.meta.dirname, 'finance-remote/entry.tsx'), formats: ['es'], fileName: 'finance-module' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
