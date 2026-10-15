import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn } from 'node:child_process'
import { assertNativeAuthority } from './public-read-native-authority.mjs'
import { NATIVE_RESOURCES, NATIVE_WRANGLER_VERSION, nativeMessage, nativeDigest, assertNativeVersion, NATIVE_UUID, snapshotNativeData } from './public-read-native-manifest.mjs'
import { boundedProductionJson } from './public-read-production-http.mjs'
import { assertProductionAdapterPrivateSurface } from './public-read-production-private-surface.mjs'

const fail = code => { throw new Error(code) }
const validToken = /^[A-Za-z0-9_.-]{16,4096}$/
const cleanEnvironment = () => ({ PATH: '/usr/bin:/bin', HOME: os.homedir(), LANG: 'C.UTF-8',
  WRANGLER_SEND_METRICS: 'false', CI: 'true' })

export function resolveNativeWrangler(cliFile) {
  if (process.platform !== 'linux' || process.versions.node !== '22.23.1'
    || !path.isAbsolute(cliFile ?? '') || fs.realpathSync(cliFile) !== cliFile) fail('schedule_native_toolchain_invalid')
  const info = fs.statSync(cliFile)
  const packageFile = path.resolve(path.dirname(cliFile), '../package.json')
  const packageInfo = JSON.parse(fs.readFileSync(packageFile, 'utf8'))
  if (!info.isFile() || info.mode & 0o022 || packageInfo.name !== 'wrangler'
    || packageInfo.version !== NATIVE_WRANGLER_VERSION
    || path.resolve(path.dirname(packageFile), packageInfo.bin?.wrangler ?? '') !== cliFile
    || path.basename(path.dirname(cliFile)) !== 'bin') fail('schedule_native_toolchain_invalid')
  return cliFile
}

function toolchainDigest(cliFile) {
  const packageRoot = path.resolve(path.dirname(cliFile), '..')
  return nativeDigest([cliFile, path.join(packageRoot, 'package.json'), path.join(packageRoot, 'wrangler-dist/cli.js')]
    .map(file => nativeDigest(fs.readFileSync(file))).join(':'))
}

export function assertNativeMutationCommand(args, { operation, manifest, secrets }) {
  if (!Array.isArray(args) || args.some(item => typeof item !== 'string')) fail('schedule_native_mutation_scope_invalid')
  const config = { core: 'workforce/schedule/wrangler.toml', adapter: 'workforce/schedule/public-read.wrangler.toml' }
  const surface = operation.startsWith('core-') ? 'core' : 'adapter'
  const mode = operation === 'adapter-bootstrap-disabled' ? 'bootstrap-disabled'
    : operation === 'adapter-reconcile-disable' ? 'reconciled-disabled' : operation.endsWith('enable') ? 'ready' : 'disabled'
  const versionArgs = ['--config', config[surface], '--keep-vars', '--var', `SCHEDULE_PUBLIC_READ_ENABLED:${mode === 'ready'}`,
    '--var', `SCHEDULE_PUBLIC_READ_SOURCE_SHA:${manifest.sourceSha}`, '--var', `SCHEDULE_PUBLIC_READ_NATIVE_RELEASE_ID:${manifest.releaseId}`,
    '--var', `SCHEDULE_PUBLIC_READ_NATIVE_CONFIG_SHA256:${manifest.configDigest}`, '--message', nativeMessage(manifest, surface, mode)]
  const tag = `native-${surface}-${mode}-${manifest.releaseId}`
  const same = expected => JSON.stringify(args) === JSON.stringify(expected)
  let secretNames = null
  if (operation === 'adapter-bootstrap-disabled' && same(['deploy', ...versionArgs, '--secrets-file', '/dev/stdin'])) {
    secretNames = ['SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY', 'SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY']
  } else if (['core-enable', 'core-disable', 'adapter-enable', 'adapter-disable', 'adapter-reconcile-disable'].includes(operation)) {
    if (same(['versions', 'upload', ...versionArgs, '--tag', tag, '--secrets-file', '/dev/stdin'])) {
      secretNames = surface === 'core' ? ['SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY'] : ['SCHEDULE_PUBLIC_READ_CORE_HMAC_KEY', 'SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY']
    } else if (same(['versions', 'deploy', '--config', config[surface], '--version-tag', `${tag}@100%`, '--yes', '--message', nativeMessage(manifest, surface, mode)])) {
      if (secrets !== undefined) fail('schedule_native_mutation_scope_invalid')
      return surface
    }
  }
  if (secretNames === null && operation === 'adapter-enable') {
    // The full fixed command below binds name, source, UUID and a bounded
    // expiry; only its own three plain-text values can change the probe.
    const value = args.find(item => item.startsWith('PROBE_EXPIRES_AT_MS:'))
    const expiresAtMs = Number(value?.slice('PROBE_EXPIRES_AT_MS:'.length))
    if (Number.isSafeInteger(expiresAtMs) && expiresAtMs > Date.now() && expiresAtMs <= Date.now() + 30 * 60_000
      && expiresAtMs <= Date.parse(manifest.expiresAt)
      && same(['deploy', '--config', 'workforce/schedule/public-read-production-probe.wrangler.toml', '--name', manifest.probeWorker, '--keep-vars',
        '--var', `PROBE_SOURCE_SHA:${manifest.sourceSha}`, '--var', `PROBE_NATIVE_RELEASE_ID:${manifest.releaseId}`,
        '--var', `PROBE_EXPIRES_AT_MS:${expiresAtMs}`, '--message', nativeMessage(manifest, 'probe', 'probe'), '--secrets-file', '/dev/stdin'])) {
      secretNames = ['SCHEDULE_PUBLIC_READ_PROBE_HMAC_KEY', 'SCHEDULE_PUBLIC_READ_EDGE_HMAC_KEY']
    }
  }
  if (!secretNames || !secrets || Object.keys(secrets).length !== secretNames.length
    || secretNames.some(name => !/^[a-f0-9]{64}$/.test(secrets[name] ?? ''))) fail('schedule_native_mutation_scope_invalid')
  return surface
}

// Bounded, private stdio. No child/provider diagnostics or secret values are
// printed or copied into receipts; uncertain mutation failures are terminal.
export async function runNativeProcess(args, { cwd, input, timeoutMs = 180000, maxBytes = 2 * 1024 * 1024, env = cleanEnvironment() } = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderrBytes = 0, done = false
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value) }
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('schedule_native_process_failed')) }, timeoutMs)
    child.stdout.on('data', bytes => { stdout += bytes.toString('utf8'); if (Buffer.byteLength(stdout) > maxBytes) { child.kill('SIGKILL'); finish(new Error('schedule_native_process_failed')) } })
    child.stderr.on('data', bytes => { stderrBytes += bytes.length; if (stderrBytes > maxBytes) { child.kill('SIGKILL'); finish(new Error('schedule_native_process_failed')) } })
    child.on('error', () => finish(new Error('schedule_native_process_failed')))
    child.on('close', code => finish(code === 0 ? null : new Error('schedule_native_process_failed'), { stdout, exitCode: code }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

export function createNativeTransport({ cliFile, root, manifest, journal, authority }) {
  manifest = snapshotNativeData(manifest)
  const boundAuthority = assertNativeAuthority(authority)
  if (JSON.stringify(boundAuthority.manifest) !== JSON.stringify(manifest)) fail('schedule_native_authority_destination_mismatch')
  const cli = resolveNativeWrangler(cliFile)
  const cliDigest = toolchainDigest(cli)
  const cleanupOnly = authority && assertNativeAuthority(authority).operation === 'reconcile-probe'
  const assertCurrent = () => { if (!cleanupOnly && Date.parse(manifest.expiresAt) <= Date.now()) fail('schedule_native_manifest_expired') }
  const token = async () => {
    assertCurrent()
    if (toolchainDigest(resolveNativeWrangler(cli)) !== cliDigest) fail('schedule_native_toolchain_changed')
    const result = await runNativeProcess([cli, 'auth', 'token', '--json'], { cwd: root, timeoutMs: 30000, maxBytes: 32768 })
    let auth
    try { auth = JSON.parse(result.stdout) } catch { fail('schedule_native_credentials_unavailable') }
    if (!['oauth', 'api_token'].includes(auth.type) || !validToken.test(auth.token ?? '')) fail('schedule_native_credentials_unavailable')
    return auth.token
  }
  const api = async (pathname, { allowMissing = false, mutation = false } = {}) => {
    assertCurrent()
    if (!/^\/accounts\/[a-f0-9]{32}\/workers\/scripts\/[a-z0-9-]+(?:\/(?:deployments|settings|subdomain|versions\/[a-f0-9-]{36}))?$/.test(pathname)
      || !pathname.startsWith(`/accounts/${manifest.accountId}/workers/scripts/`)) fail('schedule_native_http_path_invalid')
    const credential = await token()
    if (mutation) { assertNativeAuthority(authority); await authority.check(); assertCurrent() }
    const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
      method: mutation ? 'DELETE' : 'GET', headers: { authorization: `Bearer ${credential}`, accept: 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    })
    if (response.status === 404 && allowMissing && !mutation) return null
    const payload = await boundedProductionJson(response)
    if (!response.ok || payload.success !== true) fail(mutation ? 'schedule_native_mutation_unknown' : 'schedule_native_readback_failed')
    return payload.result
  }
  return Object.freeze({
    get(pathname, options = {}) {
      const selected = snapshotNativeData(options)
      if (Object.keys(selected).some(name => name !== 'allowMissing')
        || selected.allowMissing !== undefined && typeof selected.allowMissing !== 'boolean') fail('schedule_native_read_options_invalid')
      return api(pathname, { allowMissing: selected.allowMissing === true })
    },
    async privateAdapter() { assertCurrent(); const apiToken = await token(); return await assertProductionAdapterPrivateSurface({ accountId: manifest.accountId, apiToken }) },
    async mutateWrangler(args, options) {
      const copiedArgs = snapshotNativeData(args)
      const selected = snapshotNativeData(options)
      if (Object.keys(selected).some(key => !['phase', 'secrets'].includes(key))) fail('schedule_native_mutation_scope_invalid')
      const { secrets, phase } = selected
      const identity = assertNativeAuthority(authority)
      assertNativeMutationCommand(copiedArgs, { operation: identity.operation, manifest, secrets })
      assertCurrent()
      const lease = await authority.check()
      journal.append(`${phase}-started`, { lease })
      const apiToken = await token()
      // Credential refresh may take time: validate the real remote lease and
      // release window again immediately before the mutating child is spawned.
      await authority.check(); assertCurrent()
      try {
        return await runNativeProcess([cli, ...copiedArgs], { cwd: root,
          input: secrets === undefined ? undefined : JSON.stringify(secrets),
          env: { ...cleanEnvironment(), CLOUDFLARE_ACCOUNT_ID: NATIVE_RESOURCES.accountId, CLOUDFLARE_API_TOKEN: apiToken } })
      } catch { journal.append(`${phase}-unknown`, { retryAllowed: false }); fail('schedule_native_mutation_unknown') }
    },
    async deleteOwnedProbe({ expectedVersionId, expiresAtMs }) {
      const identity = assertNativeAuthority(authority)
      if (!['adapter-enable', 'reconcile-probe'].includes(identity.operation)) fail('schedule_native_mutation_scope_invalid')
      if (!NATIVE_UUID.test(expectedVersionId ?? '') || !Number.isSafeInteger(expiresAtMs)) fail('schedule_native_probe_ownership_invalid')
      if (identity.operation === 'reconcile-probe' && expiresAtMs > Date.now()) fail('schedule_native_probe_not_expired')
      const base = `/accounts/${manifest.accountId}/workers/scripts/${manifest.probeWorker}`
      const deployments = await api(`${base}/deployments`)
      const deployment = deployments?.deployments?.[0]
      const version = await api(`${base}/versions/${expectedVersionId}`)
      assertNativeVersion(deployment, version, { manifest, surface: 'probe', mode: 'probe', expectedVersionId, expiresAtMs })
      const lease = await authority.check()
      journal.append('probe-delete-started', { lease })
      try { await api(`/accounts/${manifest.accountId}/workers/scripts/${manifest.probeWorker}`, { mutation: true }) }
      catch { journal.append('probe-delete-unknown', { retryAllowed: false }); fail('schedule_native_mutation_unknown') }
      if (await api(`/accounts/${manifest.accountId}/workers/scripts/${manifest.probeWorker}/settings`, { allowMissing: true }) !== null) fail('schedule_native_probe_cleanup_failed')
      journal.append('probe-deleted', { absent: true })
    },
  })
}
