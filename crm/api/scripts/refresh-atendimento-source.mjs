#!/usr/bin/env node
// Kept as a deliberately fail-closed compatibility entry point. Direct sheet
// imports bypass the durable ledger, proof, backup and per-source lock.
process.stderr.write(`${JSON.stringify({ ok: false, code: 'CLIENTES_SOURCE_LEGACY_REFRESH_DISABLED' })}\n`)
process.exitCode = 78
