#!/usr/bin/env node
import { createHmac, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

function usage() {
  console.error('Usage: atendimento-production-signed-smoke.mjs --env-file /etc/skincos/crm-clientes-production-readonly.env [--base-url http://127.0.0.1:8110] [--expected-release-sha <full-sha>]')
}

function parseArgs(argv) {
  const result = { envFile: '', baseUrl: 'http://127.0.0.1:8110', expectedReleaseSha: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--env-file') result.envFile = String(argv[++index] || '')
    else if (arg === '--base-url') result.baseUrl = String(argv[++index] || '')
    else if (arg === '--expected-release-sha') result.expectedReleaseSha = String(argv[++index] || '').trim().toLowerCase()
    else if (arg === '-h' || arg === '--help') { usage(); process.exit(0) }
    else { usage(); throw new Error('unknown_argument') }
  }
  if (!result.envFile) throw new Error('env_file_required')
  if (result.expectedReleaseSha && !/^[0-9a-f]{40}$/.test(result.expectedReleaseSha)) throw new Error('expected_release_sha_invalid')
  return result
}

function parseEnv(text) {
  const values = {}
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf('=')
    if (separator <= 0) continue
    const key = trimmed.slice(0, separator).trim()
    let value = trimmed.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function b64Url(input) {
  return Buffer.from(input).toString('base64url')
}

function signatureMessage(version, timestamp, nonce, method, path, actorB64) {
  if (version === '2') return `atendimento-actor/v2.${timestamp}.${nonce}.${method}.${path}.${actorB64}`
  return `${timestamp}.${actorB64}`
}

function sign(secret, message) {
  return createHmac('sha256', secret).update(message).digest('base64url')
}

async function request(baseUrl, env, actorB64, method, path, body, nonceOverride = '') {
  const version = String(env.CRM_ATENDIMENTO_ACTOR_SIGNATURE_VERSION || '2').trim()
  const timestamp = String(Date.now())
  const nonce = version === '2' ? (nonceOverride || randomUUID()) : ''
  const headers = { accept: 'application/json', 'x-crm-user': actorB64, 'x-crm-ts': timestamp }
  if (version === '2') {
    headers['x-crm-signature-version'] = version
    headers['x-crm-nonce'] = nonce
  }
  headers['x-crm-signature'] = sign(String(env.ATENDIMENTO_ACTOR_HMAC_KEY || ''), signatureMessage(version, timestamp, nonce, method, path, actorB64))
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  })
  return { response, nonce, headers }
}

const args = parseArgs(process.argv.slice(2))
const env = parseEnv(await readFile(args.envFile, 'utf8'))
const actorKey = String(env.ATENDIMENTO_ACTOR_HMAC_KEY || '')
if (!actorKey || actorKey.startsWith('__CONFIGURE_')) throw new Error('actor_key_not_configured')
const actor = { id: 'clientes-readonly-smoke', role: 'GESTOR', allowedModules: ['atendimento'] }
const actorB64 = b64Url(JSON.stringify(actor))
const baseUrl = new URL(args.baseUrl)
const health = await fetch(new URL('/api/atendimento/health', baseUrl), {
  headers: { accept: 'application/json' },
  signal: AbortSignal.timeout(10_000),
})
let healthPayload = {}
try { healthPayload = await health.clone().json() } catch { healthPayload = {} }
const observedReleaseSha = String(healthPayload?.moduleControl?.releaseSha || '').trim().toLowerCase()
const releaseShaMatches = !args.expectedReleaseSha || observedReleaseSha === args.expectedReleaseSha
const policy = await request(baseUrl, env, actorB64, 'GET', '/api/atendimento/commercial/policy')
const replay = await fetch(new URL('/api/atendimento/commercial/policy', baseUrl), {
  method: 'GET',
  headers: policy.headers,
  signal: AbortSignal.timeout(10_000),
})
const write = await request(baseUrl, env, actorB64, 'POST', '/api/atendimento/commercial/actions', {})
let writePayload = {}
try { writePayload = await write.response.clone().json() } catch { writePayload = {} }

const result = {
  healthStatus: health.status,
  healthPublic: health.status >= 200 && health.status < 300,
  releaseShaMatches,
  signedReadStatus: policy.response.status,
  signedRead: policy.response.status >= 200 && policy.response.status < 300,
  replayStatus: replay.status,
  replayRejected: replay.status === 401,
  writeStatus: write.response.status,
  writeRejected: write.response.status === 405 && writePayload.error === 'READ_ONLY_RUNTIME',
  signatureVersion: String(env.CRM_ATENDIMENTO_ACTOR_SIGNATURE_VERSION || '2'),
}
console.log(JSON.stringify(result))
if (!result.healthPublic || !result.releaseShaMatches || !result.signedRead || !result.replayRejected || !result.writeRejected) process.exitCode = 1
