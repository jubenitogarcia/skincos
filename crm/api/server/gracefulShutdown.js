function log(logger, payload) {
    try { logger?.log?.(JSON.stringify(payload)) } catch { /* shutdown must not depend on logging */ }
}

/**
 * Close an HTTP listener before terminating its process.  The helper is kept
 * independent from the CRM HTTP entrypoint so an isolated runtime never needs
 * to import the monolithic server merely to inherit shutdown behavior.
 */
export function installGracefulShutdown({
    server,
    signalSource = process,
    exit = (code) => process.exit(code),
    logger = console,
    component = 'crm-runtime',
    timeoutMs = 15_000,
    onClosed = async () => {},
} = {}) {
    if (!server || typeof server.close !== 'function' || !signalSource?.once) {
        throw new Error('GRACEFUL_SHUTDOWN_SERVER_REQUIRED')
    }

    let shuttingDown = false
    const shutdown = async (signal = 'unknown') => {
        if (shuttingDown) return
        shuttingDown = true
        log(logger, { level: 'info', component, event: 'shutdown_started', signal: String(signal) })

        let timedOut = false
        const timeout = setTimeout(() => {
            timedOut = true
            server.closeIdleConnections?.()
            server.closeAllConnections?.()
        }, Math.max(100, Number(timeoutMs) || 15_000))
        timeout.unref?.()

        await new Promise((resolve) => {
            try { server.close(resolve) } catch { resolve() }
        })
        clearTimeout(timeout)
        try { await onClosed() } catch { /* preserve liveness during cleanup */ }
        log(logger, { level: 'info', component, event: 'shutdown_completed', timedOut })
        exit(timedOut ? 1 : 0)
    }

    signalSource.once('SIGTERM', () => { void shutdown('SIGTERM') })
    signalSource.once('SIGINT', () => { void shutdown('SIGINT') })
    return { shutdown }
}
