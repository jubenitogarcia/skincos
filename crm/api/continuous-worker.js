import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createContinuousWorkerService } from './server/workers/continuousService.js'

const APP_ROOT = path.dirname(fileURLToPath(import.meta.url))
const service = createContinuousWorkerService({
    varDir: process.env.VAR_DIR || path.join(APP_ROOT, 'var'),
})

let shuttingDown = false

async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(JSON.stringify({ level: 'info', module: 'crm_continuous_workers', event: 'shutdown', signal }))
    try {
        await service.stop()
    } catch (error) {
        console.error(JSON.stringify({
            level: 'error',
            module: 'crm_continuous_workers',
            event: 'shutdown_failed',
            error: error?.code || 'SHUTDOWN_FAILED',
        }))
        process.exitCode = 1
    }
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

const { address } = await service.start()
console.log(JSON.stringify({
    level: 'info',
    module: 'crm_continuous_workers',
    event: 'started',
    address,
    health: '/health',
    readiness: '/readiness',
    jobs: service.components.runner.jobs,
}))
