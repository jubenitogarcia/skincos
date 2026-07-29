import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: { alias: { '@': resolve(__dirname, '.') } },
  test: {
    environment: 'jsdom',
    include: ['tests/components/**/*.component.test.tsx'],
    setupFiles: ['./tests/components/setup.ts'],
  },
})
