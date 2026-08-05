import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { startHarmoniaWorker } from './server/harmonia/worker.js'
import { createWorkerHealthServer } from './server/workers/healthServer.js'

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const varDir = process.env.VAR_DIR || path.join(APP_ROOT, 'var')
const enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.CRM_CONTINUOUS_WORKERS_ENABLED || '').trim().toLowerCase())
const requestedMode = String(
    process.env.CRM_CONTINUOUS_WORKERS_MODE || process.env.HARMONIA_WORKER_MODE || '',
).trim()
const assistedConfirmed = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.CRM_CONTINUOUS_WORKERS_ASSISTED_CONFIRMED || '').trim().toLowerCase(),
)
const mode = !enabled ? 'disabled' : requestedMode || 'observe'
const effectiveMode = mode.toLowerCase() === 'assisted' && !assistedConfirmed ? 'observe' : mode

const worker = startHarmoniaWorker({ varDir, mode: effectiveMode, defaultMode: 'observe' })
const health = createWorkerHealthServer({ getStatus: worker.getStatus })

let shuttingDown = false
async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(JSON.stringify({ level: 'info', module: 'crm_continuous_workers', event: 'shutdown', signal }))
    try {
        await worker.stop()
        await health.close()
    } catch (error) {
        console.error(JSON.stringify({
            level: 'error',
            module: 'crm_continuous_workers',
            event: 'shutdown_failed',
            error: error?.message || String(error),
        }))
        process.exitCode = 1
    }
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

const address = await health.listen()
console.log(JSON.stringify({
    level: 'info',
    module: 'crm_continuous_workers',
    event: 'started',
    mode: effectiveMode,
    address,
    health: '/health',
    readiness: '/readiness',
}))
