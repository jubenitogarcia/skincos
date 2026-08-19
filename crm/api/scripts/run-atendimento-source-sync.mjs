#!/usr/bin/env node
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    normalizeAtendimentoSourceSyncAction,
    runAtendimentoSourceSync,
} from '../server/atendimento/sourceSync.js'

const ENV_FILE = '/etc/skincos/crm-atendimento-source-sync.env'
const ENV_KEYS = [
    'DATABASE_URL',
    'CRM_ATENDIMENTO_SOURCE_SYNC_TARGET',
    'CRM_ATENDIMENTO_SOURCE_SYNC_ACTION',
    'CRM_ATENDIMENTO_SOURCE_SYNC_APPLY_CONFIRMED',
    'ATENDIMENTO_GOOGLE_SHEET_ID',
    'ATENDIMENTO_GOOGLE_SA_FILE',
]
const args = process.argv.slice(2)
const actions = args.filter((value) => value === '--dry-run' || value === '--apply')
if (args.length !== actions.length || actions.length > 1) {
    throw new Error('Use apenas --dry-run ou --apply.')
}

const fileEnv = await readLiteralEnvironment(ENV_FILE, { allowedKeys: ENV_KEYS })
const env = { ...fileEnv, ...process.env }
const action = normalizeAtendimentoSourceSyncAction(actions[0] ? actions[0].slice(2) : env.CRM_ATENDIMENTO_SOURCE_SYNC_ACTION || 'dry-run')
const pool = createPgPool(env.DATABASE_URL)
if (!pool) throw new Error('ATENDIMENTO_SOURCE_SYNC_DATABASE_UNAVAILABLE')

try {
    const report = await runAtendimentoSourceSync({
        pool,
        databaseUrl: env.DATABASE_URL,
        target: env.CRM_ATENDIMENTO_SOURCE_SYNC_TARGET,
        action,
        applyConfirmed: env.CRM_ATENDIMENTO_SOURCE_SYNC_APPLY_CONFIRMED,
        spreadsheetId: env.ATENDIMENTO_GOOGLE_SHEET_ID,
        serviceAccountFile: env.ATENDIMENTO_GOOGLE_SA_FILE,
    })
    process.stdout.write(`${JSON.stringify(report)}\n`)
} catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,100}$/.test(String(error?.code || ''))
        ? error.code
        : 'ATENDIMENTO_SOURCE_SYNC_FAILED'
    process.stderr.write(`${JSON.stringify({ ok: false, code })}\n`)
    process.exitCode = 1
} finally {
    await pool.end()
}
