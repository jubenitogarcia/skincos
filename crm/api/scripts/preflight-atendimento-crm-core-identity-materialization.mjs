#!/usr/bin/env node
/**
 * Read-only schema admission for the Atendimento CRM Core identity source.
 * It intentionally has no apply, rollback, backfill, delivery, or role path.
 */
import { createPgPool } from '../server/harmonia/store/pg.js'
import {
    ATENDIMENTO_MIGRATION_TARGETS,
    isStrictAtendimentoMigrationDestination,
} from '../server/atendimento/migrationDestination.js'
import {
    preflightAtendimentoCrmCoreIdentityMaterialization,
} from '../server/atendimento/crmCoreIdentityMaterializationMigration.js'

export function parseAtendimentoCrmCoreIdentityMaterializationPreflightInvocation(args = []) {
    const values = Array.isArray(args) ? args.map(String) : []
    if (values.length !== 2 || values[0] !== '--target' || ![ATENDIMENTO_MIGRATION_TARGETS.STAGING, ATENDIMENTO_MIGRATION_TARGETS.PRODUCTION].includes(values[1])) {
        throw new Error('Use exatamente --target staging|production.')
    }
    return { target: values[1] }
}

async function main() {
    const { target } = parseAtendimentoCrmCoreIdentityMaterializationPreflightInvocation(process.argv.slice(2))
    const databaseUrl = String(process.env.DATABASE_URL || '').trim()
    if (!databaseUrl || !isStrictAtendimentoMigrationDestination(databaseUrl, target)) {
        throw new Error('DATABASE_URL deve apontar para o migrator dedicado, via loopback TLS, do alvo informado.')
    }
    const pool = createPgPool(databaseUrl, { max: 1 })
    try {
        const report = await preflightAtendimentoCrmCoreIdentityMaterialization({ pool, databaseUrl, target })
        process.stdout.write(`${JSON.stringify(report)}\n`)
    } finally {
        await pool.end()
    }
}

const entrypoint = new URL(import.meta.url).pathname
if (process.argv[1] && process.argv[1].replaceAll('\\', '/') === entrypoint) {
    main().catch((error) => {
        process.stderr.write(`${error instanceof Error ? error.message : 'ATENDIMENTO_CRM_CORE_IDENTITY_PREFLIGHT_FAILED'}\n`)
        process.exitCode = 1
    })
}
