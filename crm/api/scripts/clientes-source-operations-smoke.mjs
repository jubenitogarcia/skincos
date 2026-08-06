#!/usr/bin/env node
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const worker = path.join(root, 'clientes-sources-worker.js')

async function get(port, pathname) {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
    return { status: response.status, payload: await response.json() }
}

async function waitFor(port, pathname, expectedStatus, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
        try {
            const result = await get(port, pathname)
            if (result.status === expectedStatus) return result
            lastError = new Error(`unexpected status ${result.status}`)
        } catch (error) { lastError = error }
        await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw lastError || new Error(`timeout waiting for ${pathname}`)
}

async function assertPortReleased(port) {
    await new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()))
    })
}

async function runCase({ name, databaseUrl, port, readiness }) {
    const child = spawn(process.execPath, [worker], {
        cwd: root,
        env: {
            ...process.env,
            DATABASE_URL: databaseUrl,
            CLIENTES_SOURCE_OPERATIONS_TARGET: 'local',
            CRM_CLIENTES_SOURCE_OPS_ENABLED: '1',
            CRM_CLIENTES_SOURCE_OPS_MODE: 'dry-run',
            CRM_CLIENTES_SOURCE_OPS_HOST: '127.0.0.1',
            CRM_CLIENTES_SOURCE_OPS_PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''; child.stdout.on('data', (chunk) => { output += String(chunk) }); child.stderr.on('data', (chunk) => { output += String(chunk) })
    try {
        const health = await waitFor(port, '/health', 200)
        const ready = await waitFor(port, '/readiness', readiness)
        if (health.status !== 200 || ready.status !== readiness) throw new Error(`${name} status contract failed`)
        const operational = readiness === 200 ? await waitFor(port, '/sources', 200) : null
        child.kill('SIGTERM')
        const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? signal)) })
        if (exitCode !== 0) throw new Error(`${name} did not stop cleanly: ${exitCode}`)
        await assertPortReleased(port)
        return { name, health: health.status, readiness: ready.status, sources: operational?.payload?.sources?.length ?? null, stopped: true }
    } catch (error) {
        child.kill('SIGTERM')
        await new Promise((resolve) => child.once('exit', resolve))
        throw new Error(`${name}: ${error.message}; output=${output.slice(-500)}`)
    }
}

const down = await runCase({ name: 'database-down', databaseUrl: 'postgresql://127.0.0.1:1/skincos_crm_local', port: 18103, readiness: 503 })
const upUrl = String(process.env.CLIENTES_SOURCE_SMOKE_DATABASE_URL || process.env.DATABASE_URL || '').trim()
let up = { name: 'database-up', skipped: true, reason: 'CLIENTES_SOURCE_SMOKE_DATABASE_URL not configured' }
if (upUrl) up = await runCase({ name: 'database-up', databaseUrl: upUrl, port: 18104, readiness: 200 })
console.log(JSON.stringify({ down, up }, null, 2))
