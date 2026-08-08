import assert from 'node:assert/strict'
import { createHmac, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter, once } from 'node:events'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { createIsolatedAtendimentoRuntime } from '../../atendimentoRuntime.js'
import { installGracefulShutdown } from '../../gracefulShutdown.js'
import { createAtendimentoStore } from '../store.js'
import { readIsolatedAtendimentoRuntimeControl } from '../isolatedRuntimeControl.js'
import { createReplayProtectedActorVerifier, actorSignatureMessage } from '../isolatedActorAuth.js'
import { createPersistentReplayGuard } from '../replayProtection.js'
import { parseLiteralEnvironment } from '../runtimeEnv.js'

const RELEASE_SHA = 'a'.repeat(40)
// Keep the HMAC secret ephemeral so fixtures cannot resemble a reusable key.
const ACTOR_KEY = randomBytes(32).toString('base64url')
const READINESS_TOKEN = 'isolated-runtime-readiness-token'

function encode(value) {
    return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function signature({ timestamp, nonce, method = 'GET', requestPath, actor }) {
    return createHmac('sha256', ACTOR_KEY)
        .update(actorSignatureMessage({ timestamp, nonce, method, path: requestPath, encoded: actor }))
        .digest('base64url')
}

async function createFixture({ state = 'active' } = {}) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'atendimento-isolated-runtime-'))
    const control = path.join(dir, 'module-control.json')
    const replay = path.join(dir, 'replay.json')
    await fs.writeFile(control, JSON.stringify({
        schemaVersion: 1,
        module: 'atendimento',
        state,
        releaseSha: RELEASE_SHA,
        readOnly: true,
        commercialContactWritesEnabled: false,
        syntheticOnly: true,
    }), 'utf8')
    return {
        dir,
        control,
        replay,
        environment: {
            CRM_DOMAIN: 'atendimento',
            CRM_API_HOST: '127.0.0.1',
            CRM_API_PORT: '0',
            CRM_ATENDIMENTO_READ_ONLY: 'true',
            CRM_ATENDIMENTO_CLIENTES_ONLY: 'true',
            CRM_ATENDIMENTO_COMMERCIAL_WRITES_ENABLED: 'false',
            CRM_MODULE_CONTROL_FILE: control,
            ATENDIMENTO_RUNTIME_RELEASE_SHA: RELEASE_SHA,
            ATENDIMENTO_REPLAY_STATE_FILE: replay,
            ATENDIMENTO_ACTOR_HMAC_KEY: ACTOR_KEY,
            ATENDIMENTO_READINESS_TOKEN: READINESS_TOKEN,
            CRM_ATENDIMENTO_SCHEMA_MANAGED: 'true',
            CRM_ATENDIMENTO_EXPECTED_DATABASE: 'skincos_clientes_production',
            CRM_ATENDIMENTO_EXPECTED_DATABASE_USER: 'skincos_clientes_ro',
        },
        async cleanup() {
            await fs.rm(dir, { recursive: true, force: true })
        },
    }
}

async function startRuntime(fixture, readiness) {
    const store = {
        readiness,
        async close() {},
    }
    const runtime = createIsolatedAtendimentoRuntime({
        environment: fixture.environment,
        store,
        logger: { log() {} },
    })
    const server = await runtime.start()
    const address = server.address()
    assert.equal(typeof address, 'object')
    const baseUrl = `http://127.0.0.1:${address.port}`
    return {
        runtime,
        server,
        baseUrl,
        async close() {
            await new Promise((resolve) => server.close(resolve))
            await runtime.replayGuard.close()
        },
    }
}

test('isolated control rejects every attempt to weaken the read-only contract', async () => {
    const fixture = await createFixture()
    try {
        const healthy = readIsolatedAtendimentoRuntimeControl({ filePath: fixture.control, releaseSha: RELEASE_SHA })
        assert.equal(healthy.ready, true)
        await fs.writeFile(fixture.control, JSON.stringify({
            schemaVersion: 1,
            module: 'atendimento',
            state: 'active',
            releaseSha: RELEASE_SHA,
            readOnly: true,
            commercialContactWritesEnabled: true,
            syntheticOnly: true,
        }), 'utf8')
        const weakened = readIsolatedAtendimentoRuntimeControl({ filePath: fixture.control, releaseSha: RELEASE_SHA })
        assert.equal(weakened.ready, false)
        assert.equal(weakened.reason, 'MODULE_CONTROL_WRITE_GUARD_INVALID')
    } finally {
        await fixture.cleanup()
    }
})

test('liveness remains public while database readiness fails and internal interfaces stay private', async () => {
    const fixture = await createFixture()
    const running = await startRuntime(fixture, async () => ({ ok: false, databaseReachable: false }))
    try {
        const health = await fetch(`${running.baseUrl}/health`)
        assert.equal(health.status, 200)
        assert.deepEqual(await health.json(), {
            ok: true,
            service: 'crm-atendimento-runtime',
            readOnlyRuntime: true,
            control: {
                configured: true,
                ready: true,
                state: 'active',
                releaseMatched: true,
                releaseSha: RELEASE_SHA,
                readOnly: true,
                syntheticOnly: true,
            },
        })

        const hiddenReadiness = await fetch(`${running.baseUrl}/internal/readiness`)
        assert.equal(hiddenReadiness.status, 404)
        const readiness = await fetch(`${running.baseUrl}/internal/readiness`, {
            headers: { 'x-atendimento-readiness-token': READINESS_TOKEN },
        })
        assert.equal(readiness.status, 503)
        assert.deepEqual(await readiness.json(), { ok: false, error: 'DEPENDENCY_UNAVAILABLE' })

        const write = await fetch(`${running.baseUrl}/api/atendimento/commercial/actions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{not-valid-json',
        })
        assert.equal(write.status, 405)
        assert.deepEqual(await write.json(), { ok: false, error: 'READ_ONLY_RUNTIME' })
    } finally {
        await running.close()
        await fixture.cleanup()
    }
})

test('readiness returns 200 only after the read-only database contract succeeds', async () => {
    const fixture = await createFixture()
    const running = await startRuntime(fixture, async () => ({
        ok: true,
        databaseReachable: true,
        databaseIdentity: true,
        schemaReady: true,
        sourceOperationsReady: true,
        clinicalApprovalReady: true,
        transactionReadOnly: true,
        migrationRegistryReadable: true,
        persistentWritePrivilegesBlocked: true,
        persistentPiiReadPrivilegesBlocked: true,
    }))
    try {
        const readiness = await fetch(`${running.baseUrl}/internal/readiness`, {
            headers: { 'x-atendimento-readiness-token': READINESS_TOKEN },
        })
        assert.equal(readiness.status, 200)
        assert.deepEqual(await readiness.json(), {
            ok: true,
            databaseReachable: true,
            databaseIdentity: true,
            schemaReady: true,
            sourceOperationsReady: true,
            clinicalApprovalReady: true,
            transactionReadOnly: true,
            migrationRegistryReadable: true,
            persistentWritePrivilegesBlocked: true,
            persistentPiiReadPrivilegesBlocked: true,
            replayProtectionReady: true,
        })
    } finally {
        await running.close()
        await fixture.cleanup()
    }
})

test('store readiness requires the expected database, app role, schema and read-only session', async () => {
    const queries = []
    const store = createAtendimentoStore({
        schemaManaged: true,
        expectedDatabase: 'skincos_clientes_production',
        expectedDatabaseUser: 'skincos_clientes_ro',
        pool: {
            async query(sql) {
                queries.push(sql)
                return {
                    rows: [{
                        database_name: 'skincos_clientes_production',
                        database_user: 'skincos_clientes_ro',
                        session_database_user: 'skincos_clientes_ro',
                        transaction_read_only: true,
                        migrations_read: true,
                        persistent_write_privileges_blocked: true,
                        persistent_pii_read_privileges_blocked: true,
                        migrations_table: true,
                        identities_table: true,
                        commercial_policy_table: true,
                        source_operations_table: true,
                        clinical_approval_table: true,
                    }],
                }
            },
            async end() {},
        },
    })
    const ready = await store.readiness()
    assert.equal(ready.ok, true)
    assert.equal(ready.transactionReadOnly, true)
    assert.equal(ready.persistentWritePrivilegesBlocked, true)
    assert.equal(ready.persistentPiiReadPrivilegesBlocked, true)
    assert.match(queries[0], /current_database\(\)/)
    assert.match(queries[0], /and current_setting\('default_transaction_read_only', true\) = 'on'/)
    assert.match(queries[0], /has_table_privilege\(current_user, c\.oid, 'INSERT'\)/)
    assert.match(queries[0], /session_user as session_database_user/)
    assert.match(queries[0], /pg_has_role\(current_user, candidate\.oid, 'SET'\)/)
    assert.match(queries[0], /p\.prosecdef/)
    assert.match(queries[0], /n\.nspname in \('harmonia', 'crm_caixa'\)/)
    assert.match(queries[0], /clientes_source_operation_runs/)
    assert.match(queries[0], /clinical_approval\.rules/)

    const writableStore = createAtendimentoStore({
        schemaManaged: true,
        expectedDatabase: 'skincos_clientes_production',
        expectedDatabaseUser: 'skincos_clientes_ro',
        pool: {
            async query() {
                return {
                    rows: [{
                        database_name: 'skincos_clientes_production',
                        database_user: 'skincos_clientes_ro',
                        session_database_user: 'skincos_clientes_ro',
                        transaction_read_only: true,
                        migrations_read: true,
                        persistent_write_privileges_blocked: false,
                        persistent_pii_read_privileges_blocked: true,
                        migrations_table: true,
                        identities_table: true,
                        commercial_policy_table: true,
                        source_operations_table: true,
                        clinical_approval_table: true,
                    }],
                }
            },
            async end() {},
        },
    })
    const writable = await writableStore.readiness()
    assert.equal(writable.ok, false)
    assert.equal(writable.persistentWritePrivilegesBlocked, false)

    const assumedRoleStore = createAtendimentoStore({
        schemaManaged: true,
        expectedDatabase: 'skincos_clientes_production',
        expectedDatabaseUser: 'skincos_clientes_ro',
        pool: {
            async query() {
                return {
                    rows: [{
                        database_name: 'skincos_clientes_production',
                        database_user: 'skincos_clientes_ro',
                        session_database_user: 'skincos_staging_migrator_login',
                        transaction_read_only: true,
                        migrations_read: true,
                        persistent_write_privileges_blocked: true,
                        persistent_pii_read_privileges_blocked: true,
                        migrations_table: true,
                        identities_table: true,
                        commercial_policy_table: true,
                        source_operations_table: true,
                        clinical_approval_table: true,
                    }],
                }
            },
            async end() {},
        },
    })
    const assumedRole = await assumedRoleStore.readiness()
    assert.equal(assumedRole.ok, false)
    assert.equal(assumedRole.databaseIdentity, false)
})

test('store readiness fails closed when the application role retains source-system PII reads', async () => {
    const store = createAtendimentoStore({
        schemaManaged: true,
        expectedDatabase: 'skincos_clientes_production',
        expectedDatabaseUser: 'skincos_clientes_ro',
        pool: {
            async query() {
                return {
                    rows: [{
                        database_name: 'skincos_clientes_production',
                        database_user: 'skincos_clientes_ro',
                        session_database_user: 'skincos_clientes_ro',
                        transaction_read_only: true,
                        migrations_read: true,
                        persistent_write_privileges_blocked: true,
                        persistent_pii_read_privileges_blocked: false,
                        migrations_table: true,
                        identities_table: true,
                        commercial_policy_table: true,
                        source_operations_table: true,
                        clinical_approval_table: true,
                    }],
                }
            },
            async end() {},
        },
    })
    const readiness = await store.readiness()
    assert.equal(readiness.ok, false)
    assert.equal(readiness.persistentPiiReadPrivilegesBlocked, false)
})

test('isolated runtime rejects commercial reads before source-system PII can be queried', async () => {
    const fixture = await createFixture()
    const running = await startRuntime(fixture, async () => ({
        ok: true,
        databaseReachable: true,
        databaseIdentity: true,
        schemaReady: true,
        sourceOperationsReady: true,
        clinicalApprovalReady: true,
        transactionReadOnly: true,
        migrationRegistryReadable: true,
        persistentWritePrivilegesBlocked: true,
        persistentPiiReadPrivilegesBlocked: true,
    }))
    try {
        const actor = encode({ id: 'synthetic-actor', role: 'GESTOR', allowedUnits: ['synthetic-unit'] })
        const timestamp = String(Date.now())
        const nonce = 'C'.repeat(32)
        const requestPath = '/api/atendimento/commercial/overview?unit=synthetic-unit'
        const response = await fetch(running.baseUrl + requestPath, {
            headers: {
                'x-crm-user': actor,
                'x-crm-ts': timestamp,
                'x-crm-nonce': nonce,
                'x-crm-signature-version': '2',
                'x-crm-signature': signature({ timestamp, nonce, requestPath, actor }),
            },
        })
        assert.equal(response.status, 503)
        assert.deepEqual(await response.json(), { ok: false, error: 'COMMERCIAL_READS_DISABLED' })
    } finally {
        await running.close()
        await fixture.cleanup()
    }
})

test('v2 actor nonces survive a restart and reject a replay', async () => {
    const fixture = await createFixture()
    const actor = encode({ id: 'synthetic-actor', role: 'GESTOR', allowedUnits: ['synthetic-unit'] })
    const timestamp = String(Date.now())
    const nonce = 'N'.repeat(32)
    const requestPath = '/api/atendimento/commercial/policy?unit=synthetic-unit'
    const request = {
        method: 'GET',
        originalUrl: requestPath,
        headers: {
            'x-crm-user': actor,
            'x-crm-ts': timestamp,
            'x-crm-nonce': nonce,
            'x-crm-signature-version': '2',
            'x-crm-signature': signature({ timestamp, nonce, requestPath, actor }),
        },
    }
    const guard = createPersistentReplayGuard({ statePath: fixture.replay })
    await guard.start()
    const verifier = createReplayProtectedActorVerifier({ actorHmacKey: ACTOR_KEY, replayGuard: guard })
    try {
        assert.equal((await verifier(request))?.id, 'synthetic-actor')
        assert.equal(await verifier(request), null)
    } finally {
        await guard.close()
    }
    const restarted = createPersistentReplayGuard({ statePath: fixture.replay })
    await restarted.start()
    try {
        const verifierAfterRestart = createReplayProtectedActorVerifier({ actorHmacKey: ACTOR_KEY, replayGuard: restarted })
        assert.equal(await verifierAfterRestart(request), null)
    } finally {
        await restarted.close()
        await fixture.cleanup()
    }
})

test('replay ledger holds one runtime lock and recovers only a proven stale directory', async () => {
    const fixture = await createFixture()
    const first = createPersistentReplayGuard({ statePath: fixture.replay })
    const second = createPersistentReplayGuard({ statePath: fixture.replay })
    try {
        assert.equal((await first.start()).ready, true)
        assert.equal((await second.start()).ready, false)
        assert.equal(second.getStatus().error, 'ATENDIMENTO_REPLAY_LOCK_UNAVAILABLE')
        await first.close()
        assert.equal((await second.start()).ready, true)
        await second.close()

        await fs.mkdir(`${fixture.replay}.lock`, { mode: 0o700 })
        await fs.writeFile(`${fixture.replay}.lock/owner.json`, JSON.stringify({
            version: 1,
            pid: 99_999_999,
            token: 'proven-stale-lock',
        }), 'utf8')
        const recovered = createPersistentReplayGuard({ statePath: fixture.replay })
        assert.equal((await recovered.start()).ready, true)
        await recovered.close()
    } finally {
        await first.close()
        await second.close()
        await fixture.cleanup()
    }
})

test('literal environment parsing never evaluates shell syntax', () => {
    const parsed = parseLiteralEnvironment([
        'DATABASE_URL="postgresql://example"',
        'UNRELATED=$(touch /tmp/never-executed)',
    ].join('\n'), { allowedKeys: ['DATABASE_URL', 'UNRELATED'] })
    assert.equal(parsed.UNRELATED, '$(touch /tmp/never-executed)')
    assert.equal(parsed.DATABASE_URL, 'postgresql://example')
})

test('SIGTERM closes the isolated listener and releases its port', async () => {
    const fixture = await createFixture()
    const running = await startRuntime(fixture, async () => ({ ok: true }))
    try {
        const address = running.server.address()
        assert.equal(typeof address, 'object')
        const port = Number(address.port)
        const signalSource = new EventEmitter()
        const exited = new Promise((resolve) => {
            installGracefulShutdown({
                server: running.server,
                signalSource,
                exit: resolve,
                logger: { log() {} },
                component: 'crm-atendimento-runtime',
                onClosed: async () => running.runtime.replayGuard.close(),
            })
        })
        assert.ok(Number.isInteger(port) && port > 0)
        assert.equal((await fetch(`http://127.0.0.1:${port}/health`)).status, 200)
        signalSource.emit('SIGTERM')
        const exitCode = await exited
        assert.equal(exitCode, 0)
        const probe = http.createServer()
        await new Promise((resolve, reject) => probe.listen(port, '127.0.0.1', resolve).once('error', reject))
        await new Promise((resolve) => probe.close(resolve))
    } finally {
        await running.close()
        await fixture.cleanup()
    }
})

test('standalone entrypoint enforces the signed synthetic probe contract and releases its listener', { timeout: 60_000 }, async () => {
    const fixture = await createFixture()
    const entrypoint = fileURLToPath(new URL('../../atendimentoRuntime.js', import.meta.url))
    const child = spawn(process.execPath, [entrypoint], {
        // Keep this process proof independent from the test runner's dynamic
        // environment; the runtime must start solely from its explicit unit
        // configuration and never from NODE_OPTIONS or a shell overlay.
        env: fixture.environment,
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    try {
        const listening = await new Promise((resolve, reject) => {
            let settled = false
            const settle = (callback, value) => {
                if (settled) return
                settled = true
                clearTimeout(timeout)
                child.off('exit', exited)
                callback(value)
            }
            const inspect = () => {
                const event = output.split(/\r?\n/).map((line) => {
                    try { return JSON.parse(line) } catch { return null }
                }).find((value) => value?.event === 'listening')
                if (event) settle(resolve, event)
            }
            const exited = (code, signal) => settle(reject, new Error(`entrypoint exited before listening: code=${code} signal=${signal} output=${output}`))
            const timeout = setTimeout(() => settle(reject, new Error(`entrypoint did not listen: ${output}`)), 45_000)
            child.stdout.setEncoding('utf8')
            child.stderr.setEncoding('utf8')
            child.stdout.on('data', (chunk) => { output += chunk; inspect() })
            child.stderr.on('data', (chunk) => { output += chunk; inspect() })
            child.once('error', (error) => settle(reject, error))
            child.once('exit', exited)
        })
        const port = Number(listening.port)
        assert.ok(Number.isInteger(port) && port > 0)
        const baseUrl = `http://127.0.0.1:${port}`
        assert.equal((await fetch(`${baseUrl}/health`)).status, 200)

        const actor = encode({ id: 'staging-smoke-synthetic', role: 'GESTOR', allowedModules: ['atendimento'] })
        const timestamp = String(Date.now())
        const nonce = 'S'.repeat(32)
        const requestPath = '/api/atendimento/__staging-smoke__/signature-replay'
        const headers = {
            'x-crm-user': actor,
            'x-crm-ts': timestamp,
            'x-crm-nonce': nonce,
            'x-crm-signature-version': '2',
            'x-crm-signature': signature({ timestamp, nonce, requestPath, actor }),
        }
        const accepted = await fetch(baseUrl + requestPath, { headers })
        assert.equal(accepted.status, 404)
        assert.deepEqual(await accepted.json(), { ok: false, error: 'CLIENTES_SURFACE_ONLY' })

        const replay = await fetch(baseUrl + requestPath, { headers })
        assert.equal(replay.status, 401)
        assert.deepEqual(await replay.json(), { ok: false, error: 'UNAUTHORIZED' })

        const writePath = '/api/atendimento/__staging-smoke__/write-guard'
        const writeNonce = 'W'.repeat(32)
        const write = await fetch(baseUrl + writePath, {
            method: 'POST',
            headers: {
                'x-crm-user': actor,
                'x-crm-ts': timestamp,
                'x-crm-nonce': writeNonce,
                'x-crm-signature-version': '2',
                'x-crm-signature': signature({ timestamp, nonce: writeNonce, method: 'POST', requestPath: writePath, actor }),
            },
        })
        assert.equal(write.status, 405)
        assert.deepEqual(await write.json(), { ok: false, error: 'READ_ONLY_RUNTIME' })

        child.kill('SIGTERM')
        const [exitCode, signal] = await once(child, 'exit')
        assert.equal(signal, null)
        assert.equal(exitCode, 0)
        const probe = http.createServer()
        await new Promise((resolve, reject) => probe.listen(port, '127.0.0.1', resolve).once('error', reject))
        await new Promise((resolve) => probe.close(resolve))
    } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        await fixture.cleanup()
    }
})
