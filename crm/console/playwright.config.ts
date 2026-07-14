import { defineConfig } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'
const headed = process.env.HEADED === '1' || process.env.HEADED === 'true' || process.env.PWDEBUG === '1'
const isCodex =
  process.env.CODEX_SHELL === '1' ||
  process.env.CODEX_CI === '1' ||
  process.env.CODEX_INTERNAL_ORIGINATOR_OVERRIDE === 'Codex Desktop'
const keepArtifacts = process.env.PLAYWRIGHT_KEEP_ARTIFACTS === '1'
type TraceSetting = 'off' | 'on' | 'retain-on-failure' | 'on-first-retry' | 'on-all-retries' | 'retry-with-trace'
type ScreenshotSetting = 'off' | 'on' | 'only-on-failure'
const allowedTraceModes = new Set<TraceSetting>([
  'off',
  'on',
  'retain-on-failure',
  'on-first-retry',
  'on-all-retries',
  'retry-with-trace',
])
const allowedScreenshotModes = new Set<ScreenshotSetting>(['off', 'on', 'only-on-failure'])
const envTrace = process.env.PLAYWRIGHT_TRACE as TraceSetting | undefined
const envScreenshot = process.env.PLAYWRIGHT_SCREENSHOT as ScreenshotSetting | undefined
const traceMode: TraceSetting =
  envTrace && allowedTraceModes.has(envTrace) ? envTrace : isCodex && !keepArtifacts ? 'off' : 'retain-on-failure'
const screenshotMode: ScreenshotSetting =
  envScreenshot && allowedScreenshotModes.has(envScreenshot)
    ? envScreenshot
    : isCodex && !keepArtifacts
      ? 'off'
      : 'only-on-failure'

export default defineConfig({
  testDir: './e2e',
  // Keep Playwright artifacts outside `crm/console/` to avoid dev-server watchers (Tailwind/Vite)
  // tripping over rapidly-created/deleted trace resource files during E2E runs.
  outputDir: '../.playwright-output',
  workers: process.env.CI || isCodex ? 1 : undefined,
  timeout: 60000,
  use: {
    baseURL,
    headless: !headed,
    trace: traceMode,
    screenshot: screenshotMode,
    launchOptions: {
      args: [
        '--disable-dev-shm-usage',
        '--disable-features=Translate,BackForwardCache',
        ...(headed ? [] : ['--disable-gpu']),
      ],
    },
  }
})
