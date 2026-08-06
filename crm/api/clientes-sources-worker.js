#!/usr/bin/env node
import { createClientesSourceOperationsService } from './server/clientes/sourceService.js'

const service = createClientesSourceOperationsService()
let shuttingDown = false

async function shutdown(signal) {
    if (shuttingDown) return
    shuttingDown = true
    try {
        await service.stop()
        console.log(JSON.stringify({ level: 'info', module: 'crm_clientes_source_operations', event: 'shutdown', signal }))
    } catch {
        console.error(JSON.stringify({ level: 'error', module: 'crm_clientes_source_operations', event: 'shutdown_failed' }))
        process.exitCode = 1
    }
}

process.once('SIGINT', () => { void shutdown('SIGINT') })
process.once('SIGTERM', () => { void shutdown('SIGTERM') })

const address = await service.start()
console.log(JSON.stringify({
    level: 'info',
    module: 'crm_clientes_source_operations',
    event: 'started',
    target: service.health().target,
    mode: service.health().mode,
    address,
    health: '/health',
    readiness: '/readiness',
    sources: '/sources',
}))
