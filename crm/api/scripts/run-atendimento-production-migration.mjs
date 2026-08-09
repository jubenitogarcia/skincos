#!/usr/bin/env node
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'
import {
    parseAtendimentoProductionMigrationInvocation,
    runAtendimentoProductionMigration,
} from './migrate-atendimento-production.mjs'

const MIGRATOR_ENV_FILE = '/etc/skincos/crm-clientes-production-migrator.env'
const { action, releaseSha } = parseAtendimentoProductionMigrationInvocation(process.argv.slice(2))
const values = await readLiteralEnvironment(MIGRATOR_ENV_FILE, { allowedKeys: ['DATABASE_URL'] })
const databaseUrl = String(values.DATABASE_URL || '').trim()
if (!databaseUrl) {
    const error = new Error('ATENDIMENTO_PRODUCTION_MIGRATOR_DATABASE_URL_MISSING')
    error.code = 'ATENDIMENTO_PRODUCTION_MIGRATOR_DATABASE_URL_MISSING'
    throw error
}
const report = await runAtendimentoProductionMigration({ databaseUrl, action, releaseSha })
console.log(JSON.stringify(report, null, 2))
