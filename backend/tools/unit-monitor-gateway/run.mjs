import { spawn, spawnSync } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function getEnv(name, fallback = '') {
  return String(process.env[name] || fallback).trim()
}

function requireEnv(name) {
  const v = getEnv(name)
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

function checkBin(bin, args = ['-version']) {
  const r = spawnSync(bin, args, { stdio: 'ignore' })
  if (r.error) return false
  return r.status === 0 || r.status === 1
}

function getGitHead(repoRoot) {
  try {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' })
    const out = String(r.stdout || '').trim()
    return out || null
  } catch {
    return null
  }
}

async function waitForHealth(port, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`)
      if (r.ok) return true
    } catch {}
    await sleep(250)
  }
  return false
}

async function postJson(url, body, headers = {}) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(headers || {}) },
    body: body ? JSON.stringify(body) : '{}',
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 300)}`)
  return text
}

async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = dirname(__filename)
  const repoRoot = resolve(__dirname, '../../..')

  const tunnelToken = requireEnv('CLOUDFLARE_TUNNEL_TOKEN')
  const port = Number(getEnv('CRM_API_PORT', '8099') || 8099) || 8099
  const proxyToken = getEnv('CRM_UNIT_MONITOR_PROXY_TOKEN', '')
  const gatewayVersion = getGitHead(repoRoot)
  const startedAt = new Date().toISOString()

  const required = [
    { bin: 'ffmpeg', args: ['-version'] },
    { bin: 'ffprobe', args: ['-version'] },
    { bin: 'mediamtx', args: ['-version'] },
    { bin: 'cloudflared', args: ['-v'] },
  ]
  for (const r of required) {
    if (!checkBin(r.bin, r.args)) {
      throw new Error(`Missing dependency in PATH: ${r.bin}`)
    }
  }

  const requestId = (() => {
    try { return randomUUID() } catch { return String(Date.now()) }
  })()

  const actor = {
    id: 'gateway',
    name: 'Unit Monitor Gateway',
    email: 'gateway@local',
  }
  const actorB64 = Buffer.from(JSON.stringify(actor), 'utf8').toString('base64url')
  const actorTs = String(Date.now())
  const actorSig = proxyToken ? createHmac('sha256', proxyToken).update(`${actorTs}.${actorB64}`).digest('base64url') : ''

  const headers = {
    ...(proxyToken ? { 'x-unit-monitor-proxy-token': proxyToken } : {}),
    'x-request-id': requestId,
    'x-skincos-actor': actorB64,
    'x-skincos-actor-ts': actorTs,
    ...(actorSig ? { 'x-skincos-actor-sig': actorSig } : {}),
  }

  console.log(`[gateway] Starting crm-api on :${port}`)
  const apiProc = spawn(process.execPath, [resolve(repoRoot, 'backend/apps/crm-api/server.js')], {
    stdio: 'inherit',
    cwd: repoRoot,
    env: {
      ...process.env,
      CRM_API_PORT: String(port),
      PORT: String(port),
      SKINCOS_GATEWAY: '1',
      SKINCOS_GATEWAY_STARTED_AT: startedAt,
      ...(gatewayVersion ? { SKINCOS_GATEWAY_VERSION: gatewayVersion } : {}),
    },
  })

  const healthy = await waitForHealth(port)
  if (!healthy) {
    try { apiProc.kill() } catch {}
    throw new Error(`crm-api did not become healthy on :${port}`)
  }

  try {
    console.log('[gateway] Starting streaming (MediaMTX)...')
    await postJson(`http://127.0.0.1:${port}/api/unit-monitor/streaming/start`, {}, headers)
  } catch (e) {
    console.warn(`[gateway] WARN: failed to start streaming: ${e?.message || e}`)
  }

  console.log('[gateway] Starting Cloudflare Tunnel (Ctrl+C to stop)...')
  const tunnelProc = spawn('cloudflared', ['tunnel', 'run', '--token', tunnelToken], {
    stdio: 'inherit',
    env: { ...process.env },
  })

  let stopping = false
  const shutdown = async (code = 0) => {
    if (stopping) return
    stopping = true
    try {
      await postJson(`http://127.0.0.1:${port}/api/unit-monitor/streaming/stop`, {}, headers)
    } catch {}
    try { tunnelProc.kill() } catch {}
    try { apiProc.kill() } catch {}
    process.exit(code)
  }

  process.on('SIGINT', () => void shutdown(0))
  process.on('SIGTERM', () => void shutdown(0))

  tunnelProc.on('exit', (code) => void shutdown(code || 0))
  apiProc.on('exit', (code) => void shutdown(code || 0))
}

main().catch((e) => {
  console.error('[gateway] ERROR:', e?.message || e)
  process.exit(2)
})
