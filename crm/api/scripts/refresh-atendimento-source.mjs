#!/usr/bin/env node
import { createPgPool } from '../server/harmonia/store/pg.js'
import { importAtendimentoFromGoogleSheet } from '../server/atendimento/importer.js'
import { createAtendimentoStore } from '../server/atendimento/store.js'
import {
    assertClientesSourceRefreshDatabaseIdentity,
    assertClientesSourceRefreshDatabaseUrl,
    normalizeClientesSourceRefreshAction,
    normalizeClientesSourceRefreshTarget,
    sourceRefreshActor,
    summarizeClientesSourceRefresh,
} from '../server/atendimento/sourceRefresh.js'

const args = new Set(process.argv.slice(2))
const selectedActions = ['--dry-run', '--apply'].filter((flag) => args.has(flag))
if (selectedActions.length > 1 || args.size !== selectedActions.length) {
    throw new Error('Use exatamente --dry-run ou --apply.')
}

const action = normalizeClientesSourceRefreshAction(selectedActions[0] === '--apply' ? 'apply' : 'dry-run')
const target = normalizeClientesSourceRefreshTarget(process.env.CRM_CLIENTES_SOURCE_REFRESH_TARGET)
const databaseUrl = String(process.env.DATABASE_URL || '').trim()
assertClientesSourceRefreshDatabaseUrl(databaseUrl, target)

if (action === 'apply' && !['1', 'true', 'yes', 'on'].includes(
    String(process.env.CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED || '').trim().toLowerCase(),
)) {
    throw new Error('CRM_CLIENTES_SOURCE_REFRESH_APPLY_CONFIRMED=1 is required for --apply.')
}

const pool = createPgPool(databaseUrl)
if (!pool) throw new Error('DATABASE_URL_NOT_CONFIGURED')

let lockClient
try {
    lockClient = await pool.connect()
    const identityResult = await lockClient.query(`select current_database() as database_name, current_user`)
    const identity = assertClientesSourceRefreshDatabaseIdentity(identityResult.rows[0], target)
    await lockClient.query(`select pg_advisory_lock(hashtext('skincos:clientes:source-refresh'))`)

    const store = createAtendimentoStore({ pool, databaseUrl, schemaManaged: true })
    const result = await importAtendimentoFromGoogleSheet(store, {
        actor: sourceRefreshActor(target),
        dryRun: action === 'dry-run',
    })
    process.stdout.write(`${JSON.stringify(summarizeClientesSourceRefresh({ target, action, identity, result }))}\n`)
} finally {
    if (lockClient) {
        try { await lockClient.query(`select pg_advisory_unlock(hashtext('skincos:clientes:source-refresh'))`) } catch { /* preserve original result */ }
        lockClient.release()
    }
    await pool.end()
}
