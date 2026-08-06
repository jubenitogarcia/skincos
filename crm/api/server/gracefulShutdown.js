export function installGracefulShutdown({
    server,
    signalSource = process,
    exit = (code) => process.exit(code),
    logger = console,
    component = 'crm-atendimento-production',
    timeoutMs = 15_000,
} = {}) {
    if (!server || !signalSource?.once) throw new Error('GRACEFUL_SHUTDOWN_SERVER_REQUIRED')
    let shuttingDown = false
    const shutdown = (signal) => {
        if (shuttingDown) return
        shuttingDown = true
        logger.log(JSON.stringify({ level: 'info', component, event: 'shutdown_started', signal: String(signal || 'unknown') }))
        server.close(() => {
            logger.log(JSON.stringify({ level: 'info', component, event: 'shutdown_completed' }))
            exit(0)
        })
        const timeout = setTimeout(() => {
            server.closeAllConnections?.()
            exit(1)
        }, timeoutMs)
        timeout.unref?.()
    }
    signalSource.once('SIGTERM', () => shutdown('SIGTERM'))
    signalSource.once('SIGINT', () => shutdown('SIGINT'))
    return { shutdown }
}
