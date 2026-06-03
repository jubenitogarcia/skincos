import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'
const headed = process.env.HEADED === '1' || process.env.HEADED === 'true' || process.env.PWDEBUG === '1'

export default defineConfig({
  testDir: './e2e',
  // Keep Playwright artifacts outside `frontend/` to avoid dev-server watchers (Tailwind/Vite)
  // tripping over rapidly-created/deleted trace resource files during E2E runs.
  outputDir: '../.playwright-output',
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000,
  use: {
    baseURL,
    headless: !headed,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  }
})
