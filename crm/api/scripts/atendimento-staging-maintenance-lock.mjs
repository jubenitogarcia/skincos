// Keep this value compatible with the original full-run migration lock so a
// release using the older runner still excludes new staging mutation paths.
export const ATENDIMENTO_STAGING_MUTATION_LOCK_KEY = 'skincos:atendimento:staging:migrations:v1'
// Two sessions are needed by the full-run migration (gate + work). A third is
// reserved only so a competing fixed entrypoint can connect, observe the
// shared lock, and fail before any mutation rather than receive SQLSTATE 53300.
export const ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT = 3
export const ATENDIMENTO_STAGING_MIGRATION_POOL_MAX = 2
export const ATENDIMENTO_STAGING_QUALITY_REFRESH_POOL_MAX = 2
export const HARMONIA_STAGING_MIGRATION_POOL_MAX = 1

export async function acquireAtendimentoStagingMutationLock(client, unavailableCode) {
    const result = await client.query(
        'select pg_try_advisory_lock(hashtext($1)) as acquired',
        [ATENDIMENTO_STAGING_MUTATION_LOCK_KEY],
    )
    if (result?.rows?.[0]?.acquired !== true) {
        const error = new Error(unavailableCode)
        error.code = unavailableCode
        throw error
    }
}

export async function releaseAtendimentoStagingMutationLock(client) {
    await client.query(
        'select pg_advisory_unlock(hashtext($1))',
        [ATENDIMENTO_STAGING_MUTATION_LOCK_KEY],
    )
}

export async function assertAtendimentoStagingMigratorConnectionLimit(client) {
    const result = await client.query(
        'select rolconnlimit = $1 as valid from pg_roles where rolname = current_user',
        [ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT],
    )
    if (result?.rows?.[0]?.valid !== true) {
        const error = new Error('ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT_INVALID')
        error.code = 'ATENDIMENTO_STAGING_MIGRATOR_CONNECTION_LIMIT_INVALID'
        throw error
    }
}
