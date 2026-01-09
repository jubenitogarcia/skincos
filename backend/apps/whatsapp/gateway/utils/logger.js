// Simple structured logger (Phase 1). Can be swapped for pino/winston later.
function log(level, message, meta = {}) {
    const entry = {
        ts: new Date().toISOString(),
        level,
        msg: message,
        ...meta
    };
    // Basic JSON output
    console.log(JSON.stringify(entry));
}

module.exports = {
    info: (m, meta) => log('info', m, meta),
    warn: (m, meta) => log('warn', m, meta),
    error: (m, meta) => log('error', m, meta)
};
