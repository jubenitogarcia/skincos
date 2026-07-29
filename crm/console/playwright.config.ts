import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
const artifactRoot = path.resolve(process.env.PLAYWRIGHT_ARTIFACT_DIR || '../../artifacts/playwright')
const startLocalServer = process.env.E2E_START_SERVER === '1'
const configDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  testDir: './e2e',
  // Keep artifacts outside `crm/console/` so Vite never watches trace resources.
  outputDir: path.join(artifactRoot, 'test-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(artifactRoot, 'html'), open: 'never' }],
    ['json', { outputFile: path.join(artifactRoot, 'results.json') }],
  ],
  snapshotPathTemplate: '{testDir}/visual/__snapshots__/{testFilePath}/{projectName}/{arg}{ext}',
  workers: process.env.CI || isCodex ? 1 : undefined,
  timeout: 60000,
  use: {
    baseURL,
    headless: !headed,
    trace: traceMode,
    screenshot: screenshotMode,
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        '--disable-dev-shm-usage',
        '--disable-features=Translate,BackForwardCache',
        ...(headed ? [] : ['--disable-gpu']),
      ],
    },
  },
  projects: [
    { name: 'chromium-desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'chromium-notebook', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    { name: 'chromium-tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } } },
    { name: 'chromium-mobile', use: { ...devices['iPhone 13'], browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
  webServer: startLocalServer
    ? {
        command: 'npm run dev -- --host 127.0.0.1 --port 5173',
        url: baseURL,
        cwd: configDir,
        reuseExistingServer: !process.env.CI,
        stdout: 'ignore',
        stderr: 'pipe',
      }
    : undefined,
})
