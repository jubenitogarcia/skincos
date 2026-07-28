import pg from 'pg'
import { createAtendimentoStore } from '../server/atendimento/store.js'

function fail(message) {
    console.error(JSON.stringify({
        level: 'error',
        component: 'crm-local-atendimento',
        event: 'bootstrap-failed',
        message,
    }))
    process.exitCode = 1
}

export function assertLocalMirrorDatabaseUrl(value) {
    const raw = String(value || '').trim()
    if (!raw) throw new Error('DATABASE_URL_not_configured')
    const url = new URL(raw)
    const socketPath = url.searchParams.get('host')
    if (
        url.protocol !== 'postgresql:' ||
        url.hostname ||
        url.port ||
        url.username ||
        url.password ||
        url.pathname !== '/skincos_crm_local' ||
        socketPath !== '/var/run/postgresql'
    ) {
        throw new Error('CRM_LOCAL_DATABASE_URL_MUST_USE_LOCAL_SOCKET')
    }
    return raw
}

async function main() {
    const databaseUrl = assertLocalMirrorDatabaseUrl(process.env.DATABASE_URL)
    const probe = new pg.Pool({ connectionString: databaseUrl, max: 1 })
    try {
        const identity = await probe.query('select current_user as role, current_database() as database')
        const row = identity.rows[0] || {}
        if (row.role !== 'admin' || row.database !== 'skincos_crm_local') {
            throw new Error('CRM_LOCAL_DATABASE_IDENTITY_MISMATCH')
        }
        const store = createAtendimentoStore({ databaseUrl })
        await store.migrate()
        console.log(JSON.stringify({
            level: 'info',
            component: 'crm-local-atendimento',
            event: 'bootstrap-ready',
            targetCommit: /^[0-9a-f]{40}$/i.test(String(process.env.CRM_LOCAL_TARGET_COMMIT || ''))
                ? String(process.env.CRM_LOCAL_TARGET_COMMIT).toLowerCase()
                : 'unknown',
            role: row.role,
            database: row.database,
        }))
    } finally {
        await probe.end()
    }
}

main().catch((error) => fail(String(error?.message || error || 'ERROR')))
