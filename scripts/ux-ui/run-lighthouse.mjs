import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const artifactDir = path.join(repositoryRoot, 'artifacts', 'lighthouse')
const baseURL = process.env.LIGHTHOUSE_URL || 'http://127.0.0.1:5173/'
const parsedBaseURL = new URL(baseURL)
const isLoopback = parsedBaseURL.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedBaseURL.hostname)

if (!isLoopback) {
  throw new Error('LIGHTHOUSE_URL must be an HTTP loopback URL for the local UX/UI baseline')
}

const shouldStartServer = !process.env.LIGHTHOUSE_URL
const require = createRequire(import.meta.url)

function resolveChromePath() {
  if (process.env.LIGHTHOUSE_CHROME_PATH) return process.env.LIGHTHOUSE_CHROME_PATH

  try {
    const { chromium } = require(path.join(repositoryRoot, 'crm/console/node_modules/playwright-core'))
    return chromium.executablePath()
  } catch {
    return undefined
  }
}

async function waitForLocalUrl(url) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error(`LIGHTHOUSE_TARGET_NOT_READY ${url}`)
}

function stopServer(server) {
  if (!server || server.killed) return

  // npm can launch Vite as a child process. On POSIX, terminate the process
  // group so a local audit never leaves a development server behind.
  if (process.platform !== 'win32' && server.pid) {
    try {
      process.kill(-server.pid, 'SIGTERM')
      return
    } catch {}
  }

  server.kill('SIGTERM')
}

async function generateLighthouseReports(url, reportPrefix) {
  const lighthouseModule = await import(pathToFileURL(path.join(repositoryRoot, 'website/node_modules/lighthouse/core/index.js')).href)
  const { launch } = require(path.join(repositoryRoot, 'website/node_modules/chrome-launcher'))
  const chrome = await launch({
    chromePath: resolveChromePath(),
    chromeFlags: ['--headless=new', '--no-sandbox'],
  })

  try {
    const result = await lighthouseModule.default(url, {
      port: chrome.port,
      output: ['html', 'json'],
      onlyCategories: ['performance', 'accessibility', 'best-practices'],
      logLevel: 'error',
    })
    const [htmlReport, jsonReport] = result.report
    await Promise.all([
      writeFile(`${reportPrefix}.report.html`, htmlReport),
      writeFile(`${reportPrefix}.report.json`, jsonReport),
    ])
  } finally {
    await chrome.kill()
  }
}

async function main() {
  await mkdir(artifactDir, { recursive: true })
  const server = shouldStartServer
    ? spawn('npm', ['--prefix', 'crm/console', 'run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173'], {
      cwd: repositoryRoot,
      detached: process.platform !== 'win32',
      stdio: 'pipe',
    })
    : undefined
  try {
    await waitForLocalUrl(baseURL)
    const reportPrefix = path.join(artifactDir, 'crm-auth')
    await generateLighthouseReports(baseURL, reportPrefix)
    await writeFile(path.join(artifactDir, 'metadata.json'), `${JSON.stringify({ baseURL, generatedAt: new Date().toISOString(), source: 'local CRM synthetic auth route' }, null, 2)}\n`)
  } finally {
    stopServer(server)
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error)
  process.exitCode = 1
})
