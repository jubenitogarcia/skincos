import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isStrictLocalMirrorDestination } from './mirror.js'

export const CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID = '20260805_client_identity_materialization_schema_v1'
export const CLIENT_IDENTITY_MATERIALIZATION_TARGET = 'skincos_crm_local'
export const OPERATOR_RUNTIME_ROOT = '/mnt/c/CodexRuntime/operator/admin/skincos'

function safetyError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function isPrivateOperatorArtifactDescendant(root, resolved, { allowRoot = false } = {}) {
    const relative = path.relative(root, resolved)
    return (allowRoot && !relative) || (Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function resolvePrivateOperatorArtifactPath(value, errorCode, { allowRoot = false } = {}) {
    const root = path.resolve(OPERATOR_RUNTIME_ROOT)
    const resolved = path.resolve(String(value || ''))
    if (!isPrivateOperatorArtifactDescendant(root, resolved, { allowRoot })) throw safetyError(errorCode)
    return resolved
}

function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
    }
    return value
}

export function fingerprintIdentityMaterializationSource(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`
}

export function assertIdentityMaterializationDestination(databaseUrl) {
    if (!isStrictLocalMirrorDestination(databaseUrl)) {
        throw safetyError('IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
}

export async function assertIdentityMaterializationDatabase(client, databaseUrl) {
    assertIdentityMaterializationDestination(databaseUrl)
    const result = await client.query(`select current_database() as database_name, current_user as database_user,
        current_setting('transaction_read_only') as read_only`)
    const row = result.rows[0] || {}
    if (row.database_name !== CLIENT_IDENTITY_MATERIALIZATION_TARGET || row.database_user !== 'admin' || String(row.read_only).toLowerCase() === 'on') {
        throw safetyError('IDENTITY_MATERIALIZATION_DESTINATION_UNSAFE')
    }
}

export async function assertIdentityMaterializationSchemaReady(client) {
    const registry = await client.query(`select to_regclass('crm_atendimento.schema_migrations') as registry`)
    if (!registry.rows[0]?.registry) throw safetyError('IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_REQUIRED')
    const result = await client.query(`select id from crm_atendimento.schema_migrations
        where id=$1 and rolled_back_at is null`, [CLIENT_IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_ID])
    if (!result.rows[0]?.id) throw safetyError('IDENTITY_MATERIALIZATION_SCHEMA_MIGRATION_REQUIRED')
}

export async function assertIdentityMaterializationApplyCheckpoint({
    operation,
    confirmation,
    targetConfirmation,
    checkpointFile,
    sourceFingerprint,
}) {
    if (confirmation !== 'UNIFICAR') throw safetyError('IDENTITY_MATERIALIZATION_APPLY_CONFIRM_UNIFICAR_REQUIRED')
    if (targetConfirmation !== CLIENT_IDENTITY_MATERIALIZATION_TARGET) {
        throw safetyError('IDENTITY_MATERIALIZATION_APPLY_TARGET_CONFIRMATION_REQUIRED')
    }
    if (!checkpointFile) throw safetyError('IDENTITY_MATERIALIZATION_CHECKPOINT_REQUIRED')

    let checkpoint
    try {
        checkpoint = JSON.parse(await fs.readFile(checkpointFile, 'utf8'))
    } catch {
        throw safetyError('IDENTITY_MATERIALIZATION_CHECKPOINT_UNREADABLE')
    }
    if (checkpoint?.version !== 1 || checkpoint.operation !== operation ||
        checkpoint.target !== CLIENT_IDENTITY_MATERIALIZATION_TARGET ||
        checkpoint.sourceFingerprint !== sourceFingerprint) {
        throw safetyError('IDENTITY_MATERIALIZATION_CHECKPOINT_MISMATCH')
    }
    return checkpoint
}

export function identityMaterializationCheckpoint({ operation, sourceFingerprint }) {
    return {
        version: 1,
        operation,
        target: CLIENT_IDENTITY_MATERIALIZATION_TARGET,
        sourceFingerprint,
    }
}

export async function prepareIdentityMaterializationOutputDirectory({ outputDirectory, allowRoot = false, mkdir = fs.mkdir, realpath = fs.realpath }) {
    const resolved = resolvePrivateOperatorArtifactPath(
        outputDirectory,
        'IDENTITY_MATERIALIZATION_RECONCILIATION_OUTPUT_UNSAFE',
        { allowRoot },
    )
    await mkdir(resolved, { recursive: true, mode: 0o700 })
    const [physicalRoot, physicalOutput] = await Promise.all([
        realpath(OPERATOR_RUNTIME_ROOT),
        realpath(resolved),
    ])
    if (!isPrivateOperatorArtifactDescendant(physicalRoot, physicalOutput, { allowRoot })) {
        throw safetyError('IDENTITY_MATERIALIZATION_RECONCILIATION_OUTPUT_UNSAFE')
    }
    return physicalOutput
}

export async function writeIdentityMaterializationCheckpoint({ outputFile, checkpoint }) {
    if (!outputFile) return null
    const requested = resolvePrivateOperatorArtifactPath(outputFile, 'IDENTITY_MATERIALIZATION_CHECKPOINT_OUTPUT_UNSAFE')
    const privateDirectory = await prepareIdentityMaterializationOutputDirectory({ outputDirectory: path.dirname(requested), allowRoot: true })
    const resolved = path.join(privateDirectory, path.basename(requested))
    try {
        await fs.writeFile(resolved, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    } catch (error) {
        if (error?.code === 'EEXIST') throw safetyError('IDENTITY_MATERIALIZATION_CHECKPOINT_OUTPUT_EXISTS')
        throw error
    }
    return resolved
}
