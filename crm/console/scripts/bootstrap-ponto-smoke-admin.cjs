/* eslint-disable no-console */
/**
 * Bootstrap / repair the GitHub Actions smoke user so the Ponto UI Smoke workflow can run with mutate=true.
 *
 * What it does (idempotent):
 * 1) Uses an existing authenticated CRM session (storageState) to call `/api/admin/*`
 * 2) Ensures a dedicated admin user exists (`SMOKE_USERNAME`) with role GESTOR
 * 3) Rotates its password to a fresh random value
 * 4) Updates GitHub repo secrets:
 *    - PONTO_SMOKE_EMAIL
 *    - PONTO_SMOKE_PASSWORD
 *
 * Preconditions:
 * - You must already have a valid admin session saved at `output/playwright/storage-crm.json`.
 *   (You can create it by running `node crm/console/scripts/ponto-ui-smoke.cjs` once with HEADED=1 and logging in.)
 *
 * Safety:
 * - This script NEVER prints the generated password.
 */

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const { chromium } = require('playwright')

const REPO_ROOT = path.resolve(__dirname, '..', '..')
const ARTIFACT_DIR = path.join(REPO_ROOT, 'output', 'playwright')
const STORAGE_STATE_PATH = path.join(ARTIFACT_DIR, 'storage-crm.json')

const CRM_URL = process.env.CRM_URL || 'https://crm.skincos.com.br'
const SMOKE_USERNAME = String(process.env.SMOKE_USERNAME || 'ponto-smoke-bot').trim()
const SMOKE_EMAIL = String(process.env.SMOKE_EMAIL || 'ponto.smoke@skincos.com.br').trim()
const SMOKE_DISPLAY_NAME = String(process.env.SMOKE_DISPLAY_NAME || 'Ponto Smoke Bot').trim()

function die(msg) {
  console.error(`[bootstrap-ponto-smoke-admin] ${msg}`)
  process.exit(1)
}

function randomPassword(len = 20) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*'
  const bytes = new Uint32Array(len)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i] % alphabet.length]
  return out
}

function gh(args, input) {
  const res = spawnSync('gh', args, {
    encoding: 'utf-8',
    input: input === undefined ? undefined : String(input),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (res.status !== 0) {
    const err = String(res.stderr || res.stdout || '').trim()
    die(`gh ${args.join(' ')} failed${err ? `: ${err}` : ''}`)
  }
  return String(res.stdout || '').trim()
}

function resolveRepo() {
  const direct = String(process.env.GITHUB_REPO || '').trim()
  if (direct) return direct
  return gh(['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'])
}

async function main() {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true })
  if (!fs.existsSync(STORAGE_STATE_PATH)) {
    die(`Missing storage state: ${STORAGE_STATE_PATH}`)
  }

  const repo = resolveRepo()

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-extensions',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--disable-dev-shm-usage',
      '--disable-features=Translate,BackForwardCache',
      '--mute-audio',
      '--disable-gpu',
    ],
  })
  const context = await browser.newContext({
    viewport: { width: 1365, height: 860 },
    storageState: STORAGE_STATE_PATH,
  })
  await context.route('**/*', async (route) => {
    const type = route.request().resourceType()
    if (type === 'image' || type === 'media' || type === 'font') return route.abort()
    return route.continue()
  })

  try {
    const req = context.request

    // IMPORTANT: don't load the SPA. It may call /api/auth/me in the background and rotate CSRF mid-run.
    const authRes = await req.get(`${CRM_URL}/api/auth/me`)
    const authText = await authRes.text()
    let authJson = null
    try { authJson = authText ? JSON.parse(authText) : null } catch { authJson = null }
    const auth = {
      ok: authRes.ok(),
      status: authRes.status(),
      username: String(authJson?.user?.username || ''),
      role: String(authJson?.user?.role || '').toUpperCase(),
      csrfToken: String(authJson?.csrfToken || '').trim(),
      json: authJson,
    }

    if (!auth.ok) {
      die(`Not authenticated (or session expired): /api/auth/me HTTP ${auth.status}`)
    }
    if (!(auth.role === 'GESTOR' || auth.role === 'GERENTE')) {
      die(`Current session is not admin enough (role=${auth.role || 'unknown'}).`)
    }
    if (!auth.csrfToken) die('Missing csrfToken from /api/auth/me; cannot perform admin mutations.')

    const password = randomPassword(22)

    // Prefer create; if already exists, update role + reset password.
    const createRes = await req.post(`${CRM_URL}/api/crm/admin/users`, {
      headers: { 'x-csrf-token': auth.csrfToken },
      data: {
        username: SMOKE_USERNAME,
        email: SMOKE_EMAIL,
        displayName: SMOKE_DISPLAY_NAME,
        role: 'GESTOR',
        allowedUnits: [],
        allowedModules: [],
        ativo: true,
        password,
      },
    })
    const createdText = await createRes.text()
    let createdJson = null
    try { createdJson = createdText ? JSON.parse(createdText) : null } catch { createdJson = null }
    const created = { ok: createRes.ok(), status: createRes.status(), json: createdJson, text: String(createdText || '').slice(0, 240) }

    if (!created.ok) {
      const err = String(created?.json?.error || created?.json?.code || '').trim()
      if (created.status !== 409 || err !== 'USERNAME_TAKEN') {
        die(`Failed to create smoke user: HTTP ${created.status}${created.text ? ` • ${created.text}` : ''}`)
      }

      const updatedRes = await req.put(`${CRM_URL}/api/crm/admin/users/${encodeURIComponent(SMOKE_USERNAME)}`, {
        headers: { 'x-csrf-token': auth.csrfToken },
        data: {
          email: SMOKE_EMAIL,
          displayName: SMOKE_DISPLAY_NAME,
          role: 'GESTOR',
          allowedUnits: [],
          allowedModules: [],
          ativo: true,
        },
      })
      const updatedText = await updatedRes.text()
      let updatedJson = null
      try { updatedJson = updatedText ? JSON.parse(updatedText) : null } catch { updatedJson = null }
      const updated = { ok: updatedRes.ok(), status: updatedRes.status(), json: updatedJson, text: String(updatedText || '').slice(0, 240) }
      if (!updated.ok) die(`Failed to update smoke user: HTTP ${updated.status}${updated.text ? ` • ${updated.text}` : ''}`)

      const resetRes = await req.post(`${CRM_URL}/api/crm/admin/users/${encodeURIComponent(SMOKE_USERNAME)}/reset-password`, {
        headers: { 'x-csrf-token': auth.csrfToken },
        data: { newPassword: password },
      })
      const resetText = await resetRes.text()
      let resetJson = null
      try { resetJson = resetText ? JSON.parse(resetText) : null } catch { resetJson = null }
      const reset = { ok: resetRes.ok(), status: resetRes.status(), json: resetJson, text: String(resetText || '').slice(0, 240) }
      if (!reset.ok) die(`Failed to reset smoke password: HTTP ${reset.status}${reset.text ? ` • ${reset.text}` : ''}`)
    }

    // Update GitHub secrets without echoing values.
    // `gh secret set` reads the value from stdin when `--body` isn't provided.
    gh(['secret', 'set', 'PONTO_SMOKE_EMAIL', '--repo', repo], `${SMOKE_EMAIL}\n`)
    gh(['secret', 'set', 'PONTO_SMOKE_PASSWORD', '--repo', repo], `${password}\n`)

    console.log(`[bootstrap-ponto-smoke-admin] OK: smoke user ensured and repo secrets updated for ${repo}.`)
    console.log(`[bootstrap-ponto-smoke-admin] Next: run "Ponto UI Smoke (prod)" with mutate=true.`)
  } finally {
    await context.close().catch(() => {})
    await browser.close().catch(() => {})
  }
}

main().catch((e) => die(e?.stack || e?.message || String(e)))
