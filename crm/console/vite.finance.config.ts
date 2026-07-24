import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { defineConfig } from 'vite'

/** Dedicated deployable Finance artifact. The CRM shell loads it by a stable URL. */
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': resolve(import.meta.dirname, '.') }, dedupe: ['react', 'react-dom'] },
  build: {
    outDir: 'dist-finance',
    emptyOutDir: true,
    lib: { entry: resolve(import.meta.dirname, 'finance-remote/entry.tsx'), formats: ['es'], fileName: 'finance-module' },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
