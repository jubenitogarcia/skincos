import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import express from 'express'

import { registerPontoRoutes } from '../pontoRoutes.js'

const PONTO_ENV_KEYS = [
  'NODE_ENV',
  'PONTO_LEGACY_RUNTIME_MODE',
  'PONTO_ADMIN_TOKEN',
  'PONTO_TEMPLATES_KEY',
  'PONTO_AUDIT_HMAC_KEY',
  'PONTO_PROXY_TOKEN',
  'PONTO_ACTOR_HMAC_KEY',
  'PONTO_REQUIRE_CONSENT'
]

async function withEnvironment(values, run) {
  const previous = new Map(PONTO_ENV_KEYS.map((key) => [key, process.env[key]]))
  try {
    for (const key of PONTO_ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key]
      else process.env[key] = values[key]
    }
    return await run()
  } finally {
    for (const key of PONTO_ENV_KEYS) {
      const value = previous.get(key)
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

async function startPontoServer(coreStateDir) {
  const app = express()
  app.use(express.json())
  registerPontoRoutes(app, { coreStateDir })
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address()
  return {
    request: (pathname, init) => fetch(`http://127.0.0.1:${port}${pathname}`, init),
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}

async function responseJson(response) {
  return { status: response.status, body: await response.json() }
}

async function exists(target) {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      if (await check()) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw lastError || new Error('Timed out waiting for Ponto runtime state')
}

async function withTempState(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ponto-legacy-runtime-mode-'))
  try {
    return await run({ root, coreStateDir: path.join(root, 'core') })
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }
}

test('legacy Ponto writer remains enabled by default', { concurrency: false }, async () => {
  await withEnvironment({
    NODE_ENV: 'test',
    PONTO_ADMIN_TOKEN: 'synthetic-admin-token'
  }, async () => {
    await withTempState(async ({ coreStateDir }) => {
      const runtime = await startPontoServer(coreStateDir)
      try {
        const created = await responseJson(await runtime.request('/api/ponto/admin/employees', {
          method: 'POST',
          headers: {
            authorization: 'Bearer synthetic-admin-token',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ name: 'Synthetic Employee', code: 'SYN-001', unit: 'synthetic' })
        }))

        assert.equal(created.status, 200)
        assert.equal(created.body.ok, true)
        await waitFor(() => exists(path.join(coreStateDir, 'ponto_store.v2.json')))
      } finally {
        await runtime.close()
      }
    })
  })
})

test('read-only mode rejects mutations before the legacy writer can create state', { concurrency: false }, async () => {
  await withEnvironment({
    NODE_ENV: 'test',
    PONTO_LEGACY_RUNTIME_MODE: 'read-only',
    PONTO_ADMIN_TOKEN: 'synthetic-admin-token'
  }, async () => {
    await withTempState(async ({ coreStateDir }) => {
      const runtime = await startPontoServer(coreStateDir)
      try {
        const mutations = [
          {
            method: 'POST',
            pathname: '/api/ponto/admin/employees',
            body: { name: 'Synthetic Employee', code: 'SYN-001', unit: 'synthetic' }
          },
          {
            method: 'PATCH',
            pathname: '/api/ponto/admin/employees/synthetic-employee',
            body: { name: 'Ignored in read-only mode' }
          },
          {
            method: 'DELETE',
            pathname: '/api/ponto/admin/employees/synthetic-employee'
          }
        ]
        for (const mutation of mutations) {
          const rejected = await responseJson(await runtime.request(mutation.pathname, {
            method: mutation.method,
            headers: {
              authorization: 'Bearer synthetic-admin-token',
              ...(mutation.body ? { 'content-type': 'application/json' } : {})
            },
            ...(mutation.body ? { body: JSON.stringify(mutation.body) } : {})
          }))

          assert.equal(rejected.status, 503)
          assert.deepEqual(rejected.body, {
            ok: false,
            error: 'PONTO_LEGACY_READ_ONLY',
            code: 'PONTO_LEGACY_READ_ONLY',
            mode: 'read-only',
            writesDisabled: true
          })
        }

        const health = await responseJson(await runtime.request('/api/ponto/health'))
        assert.equal(health.status, 200)
        assert.equal(health.body.legacyRuntimeMode, 'read-only')
        assert.equal(health.body.writesEnabled, false)

        await new Promise((resolve) => setTimeout(resolve, 600))
        assert.equal(await exists(coreStateDir), false)
      } finally {
        await runtime.close()
      }
    })
  })
})

test('read-only device reads do not update lastSeenAt or rewrite the legacy JSON store', { concurrency: false }, async () => {
  const deviceToken = 'synthetic-device-token'
  const seededState = {
    version: 2,
    employees: [],
    devices: [{
      id: 'synthetic-device',
      label: 'Synthetic terminal',
      unit: 'synthetic',
      tokenHash: createHash('sha256').update(deviceToken).digest('hex'),
      createdAt: '2026-01-01T00:00:00.000Z',
      revokedAt: null,
      lastSeenAt: null
    }],
    records: [],
    audit: { lastHash: null }
  }

  await withEnvironment({
    NODE_ENV: 'test',
    PONTO_LEGACY_RUNTIME_MODE: 'read-only'
  }, async () => {
    await withTempState(async ({ coreStateDir }) => {
      await fs.mkdir(coreStateDir, { recursive: true })
      const storeFile = path.join(coreStateDir, 'ponto_store.v2.json')
      await fs.writeFile(storeFile, JSON.stringify(seededState, null, 2))
      const before = await fs.readFile(storeFile, 'utf8')
      const runtime = await startPontoServer(coreStateDir)
      try {
        await waitFor(async () => {
          const health = await responseJson(await runtime.request('/api/ponto/health'))
          return health.status === 200 && health.body.devices === 1
        })

        const employees = await responseJson(await runtime.request('/api/ponto/device/employees', {
          headers: { authorization: `Device ${deviceToken}` }
        }))
        assert.equal(employees.status, 200)
        assert.equal(employees.body.ok, true)
        assert.equal(employees.body.device.lastSeenAt, null)

        await new Promise((resolve) => setTimeout(resolve, 600))
        assert.equal(await fs.readFile(storeFile, 'utf8'), before)
      } finally {
        await runtime.close()
      }
    })
  })
})

test('disabled mode and invalid configuration fail closed without creating legacy state', { concurrency: false }, async () => {
  for (const [configuredValue, configurationValid] of [['disabled', true], ['unexpected-value', false]]) {
    await withEnvironment({
      NODE_ENV: 'test',
      PONTO_LEGACY_RUNTIME_MODE: configuredValue,
      PONTO_ADMIN_TOKEN: 'synthetic-admin-token'
    }, async () => {
      await withTempState(async ({ coreStateDir }) => {
        const runtime = await startPontoServer(coreStateDir)
        try {
          const health = await responseJson(await runtime.request('/api/ponto/health'))
          assert.equal(health.status, 503)
          assert.deepEqual(health.body, {
            ok: false,
            error: 'PONTO_LEGACY_DISABLED',
            code: 'PONTO_LEGACY_DISABLED',
            mode: 'disabled',
            writesDisabled: true,
            ...(configurationValid ? {} : { configurationValid: false })
          })

          const blockedRead = await responseJson(await runtime.request('/api/ponto/admin/employees', {
            headers: { authorization: 'Bearer synthetic-admin-token' }
          }))
          assert.equal(blockedRead.status, 503)
          assert.deepEqual(blockedRead.body, health.body)
          assert.equal(await exists(coreStateDir), false)
        } finally {
          await runtime.close()
        }
      })
    })
  }
})
