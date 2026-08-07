#!/usr/bin/env node
import { readLiteralEnvironment } from '../server/atendimento/runtimeEnv.js'

// This fixed runner intentionally receives neither an environment-file path
// nor an executable from a service variable, GitHub Environment, or caller.
// It hands exactly one literal connection setting to the fixed quality refresh
// module; no shell parses the private value.
const MIGRATOR_ENV_FILE = '/etc/skincos/crm-atendimento-staging-migrator.env'

if (process.argv.slice(2).length !== 1 || process.argv[2] !== '--apply') {
    throw new Error('ATENDIMENTO_STAGING_QUALITY_ACTION_INVALID')
}

const values = await readLiteralEnvironment(MIGRATOR_ENV_FILE, { allowedKeys: ['DATABASE_URL'] })
const databaseUrl = String(values.DATABASE_URL || '').trim()
if (!databaseUrl) {
    const error = new Error('ATENDIMENTO_STAGING_QUALITY_DATABASE_URL_MISSING')
    error.code = 'ATENDIMENTO_STAGING_QUALITY_DATABASE_URL_MISSING'
    throw error
}

process.env.DATABASE_URL = databaseUrl
await import('./refresh-commercial-data-quality-staging.mjs')
