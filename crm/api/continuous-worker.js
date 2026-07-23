#!/usr/bin/env node
import { startHarmoniaWorker } from './server/harmonia/worker.js'
import { createWorkerHealthServer } from './server/workers/healthServer.js'

const service = 'crm-continuous-workers'
const varDir = String(process.env.VAR_DIR || '/var/lib/skincos-runtime/crm/var').trim()
const port = Number.parseInt(String(process.env.CRM_CONTINUOUS_WORKER_PORT || '8102'), 10)
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('CRM_CONTINUOUS_WORKER_PORT must be a valid TCP port')

const harmonia = startHarmoniaWorker({ varDir })
const health = createWorkerHealthServer({ service, getStatus: () => harmonia.status() })
const address = await health.listen({ port })
console.log(JSON.stringify({ level: 'info', service, event: 'started', address, version: process.env.SOURCE_VERSION || 'unknown' }))

let stopping = false
async function stop(signal) {
    if (stopping) return
    stopping = true
    console.log(JSON.stringify({ level: 'info', service, event: 'stopping', signal }))
    harmonia.stop()
    await health.close()
    process.exit(0)
}

process.once('SIGINT', () => { void stop('SIGINT') })
process.once('SIGTERM', () => { void stop('SIGTERM') })
