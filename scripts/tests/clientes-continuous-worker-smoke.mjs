#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const apiRoot = path.join(root, 'crm', 'api')
const entrypoint = path.join(apiRoot, 'continuous-worker.js')
const configuredSmokeDatabaseUrl = String(process.env.CLIENTES_SMOKE_DATABASE_URL || '').trim()
const databaseUp = Boolean(configuredSmokeDatabaseUrl)
if (databaseUp && configuredSmokeDatabaseUrl !== 'postgresql:///skincos_crm_local?host=/var/run/postgresql') {
    throw new Error('CLIENTES_SMOKE_DATABASE_URL only accepts the local skincos_crm_local socket')
}
const child = spawn(process.execPath, [entrypoint], {
    cwd: apiRoot,
    env: {
        ...process.env,
        CRM_CONTINUOUS_WORKERS_ENABLED: '1',
        CRM_CONTINUOUS_WORKERS_MODE: 'observe',
        CRM_CONTINUOUS_JOBS_ENABLED: '0',
        CRM_CONTINUOUS_WORKER_HOST: '127.0.0.1',
        CRM_CONTINUOUS_WORKER_PORT: '0',
        DATABASE_URL: configuredSmokeDatabaseUrl || 'postgresql://127.0.0.1:1/skincos_smoke?connect_timeout=1',
        PGCONNECT_TIMEOUT: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (chunk) => { output += String(chunk) })
child.stderr.on('data', (chunk) => { output += String(chunk) })

async function waitForStarted() {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
        const line = output.split(/\r?\n/).find((value) => value.includes('"event":"started"'))
        if (line) return JSON.parse(line)
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    child.kill('SIGTERM')
    throw new Error(`continuous worker did not start: ${output.slice(-1000)}`)
}

async function waitForHttp(url, expectedStatus) {
    const deadline = Date.now() + 10_000
    while (Date.now() < deadline) {
        try {
            const response = await fetch(url)
            if (response.status === expectedStatus) return response
        } catch {
            // The listener may still be binding.
        }
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`expected HTTP ${expectedStatus}: ${url}; output=${output.slice(-1000)}`)
}

try {
    const started = await waitForStarted()
    const port = Number(started.address?.port)
    assert.ok(Number.isInteger(port) && port > 0)
    const base = `http://127.0.0.1:${port}`
    const health = await waitForHttp(`${base}/health`, 200)
    const healthBody = await health.json()
    assert.equal(healthBody.ok, true)
    const readiness = await waitForHttp(`${base}/readiness`, databaseUp ? 200 : 503)
    assert.equal(readiness.status, databaseUp ? 200 : 503)

    child.kill('SIGTERM')
    const [exitCode, signal] = await once(child, 'exit')
    assert.equal(exitCode, 0, output)
    assert.equal(signal, null)
    let released = false
    try {
        await fetch(`${base}/health`)
    } catch {
        released = true
    }
    assert.equal(released, true, 'health port remained open after SIGTERM')
    process.stdout.write(JSON.stringify({ ok: true, checks: ['health-200', databaseUp ? 'readiness-200-db-up' : 'readiness-503-db-down', 'sigterm-port-release'] }) + '\n')
} finally {
    if (child.exitCode === null) child.kill('SIGTERM')
}
