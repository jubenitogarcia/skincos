#!/usr/bin/env node
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'
import {
    parseAtendimentoStagingMigrationInvocation,
    runAtendimentoStagingMigration,
} from './migrate-atendimento-staging.mjs'

// Fixed private location.  This runner deliberately does not accept an env
// file, URL, command, or executable path from an operator or GitHub variable.
const MIGRATOR_ENV_FILE = '/etc/skincos/crm-atendimento-staging-migrator.env'

const { action, releaseSha } = parseAtendimentoStagingMigrationInvocation(process.argv.slice(2))
const values = await readLiteralEnvironment(MIGRATOR_ENV_FILE, { allowedKeys: ['DATABASE_URL'] })
const databaseUrl = String(values.DATABASE_URL || '').trim()
if (!databaseUrl) {
    const error = new Error('ATENDIMENTO_STAGING_MIGRATOR_DATABASE_URL_MISSING')
    error.code = 'ATENDIMENTO_STAGING_MIGRATOR_DATABASE_URL_MISSING'
    throw error
}

const report = await runAtendimentoStagingMigration({
    databaseUrl,
    action,
    releaseSha,
})
console.log(JSON.stringify(report, null, 2))
