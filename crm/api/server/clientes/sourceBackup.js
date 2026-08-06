import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const DEFAULT_BACKUP_ROOT = '/var/backups/skincos/clientes/source-operations'
const SOURCE_BACKUP_SCHEMAS = Object.freeze({
    'atendimento.local_mirror': ['crm_atendimento'],
    'atendimento.google_sheet': ['crm_atendimento'],
    'cadastro.gerencia_google_sheet': ['crm_atendimento'],
    'vendas.caixa_google_sheet': ['crm_atendimento', 'crm_caixa'],
    'leads.supplemental_google_sheet': ['crm_atendimento'],
})

function backupError(code) {
    const error = new Error(code)
    error.code = code
    error.retryable = false
    return error
}

function safeTarget(target) {
    const value = String(target || '').trim().toLowerCase()
    if (value !== 'local' && value !== 'staging') throw backupError('SOURCE_BACKUP_TARGET_INVALID')
    return value
}

function safeDatabaseTarget(databaseUrl, target) {
    const raw = String(databaseUrl || '').trim()
    try {
        const url = new URL(raw)
        const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
        if (target === 'local') {
            const socket = url.searchParams.get('host') || ''
            if (url.protocol !== 'postgresql:' || database !== 'skincos_crm_local') throw backupError('SOURCE_BACKUP_DATABASE_TARGET_INVALID')
            if (url.hostname && !['127.0.0.1', '::1', 'localhost'].includes(url.hostname) && !socket.startsWith('/var/run/postgresql')) throw backupError('SOURCE_BACKUP_DATABASE_TARGET_INVALID')
            return
        }
        if (url.protocol !== 'postgresql:' || database !== 'skincos_staging' || !['127.0.0.1', '::1'].includes(url.hostname)) throw backupError('SOURCE_BACKUP_DATABASE_TARGET_INVALID')
    } catch (error) {
        if (error?.code === 'SOURCE_BACKUP_DATABASE_TARGET_INVALID') throw error
        throw backupError('SOURCE_BACKUP_DATABASE_TARGET_INVALID')
    }
}

export async function backupDatabaseTarget({ databaseUrl, target, sourceId, root = process.env.CRM_CLIENTES_SOURCE_BACKUP_ROOT || DEFAULT_BACKUP_ROOT } = {}) {
    const safe = safeTarget(target)
    const url = String(databaseUrl || '').trim()
    if (!url) throw backupError('SOURCE_BACKUP_DATABASE_URL_MISSING')
    safeDatabaseTarget(url, safe)
    const directory = path.resolve(String(root || DEFAULT_BACKUP_ROOT))
    await fs.mkdir(directory, { recursive: true, mode: 0o750 })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const safeSource = String(sourceId || 'source').replace(/[^a-z0-9_.-]/gi, '_')
    const output = path.join(directory, `${safe}-${safeSource}-${stamp}.dump`)
    const schemas = SOURCE_BACKUP_SCHEMAS[sourceId] || ['crm_atendimento']
    await execFileAsync('pg_dump', [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        ...schemas.flatMap((schema) => ['--schema', schema]),
        `--file=${output}`,
        url,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 })
    const stat = await fs.stat(output)
    if (!stat.isFile() || stat.size <= 0) throw backupError('SOURCE_BACKUP_EMPTY')
    return output
}

export async function restoreDatabaseTarget({ databaseUrl, backupRef, target = 'local', root = process.env.CRM_CLIENTES_SOURCE_BACKUP_ROOT || DEFAULT_BACKUP_ROOT } = {}) {
    const safe = safeTarget(target)
    const url = String(databaseUrl || '').trim()
    if (!url) throw backupError('SOURCE_ROLLBACK_DATABASE_URL_MISSING')
    safeDatabaseTarget(url, safe)
    const rootPath = path.resolve(String(root || DEFAULT_BACKUP_ROOT))
    const backup = path.resolve(String(backupRef || ''))
    if (!url || !backupRef) throw backupError('SOURCE_ROLLBACK_INPUT_MISSING')
    if (backup !== rootPath && !backup.startsWith(`${rootPath}${path.sep}`)) throw backupError('SOURCE_ROLLBACK_PATH_UNSAFE')
    if (!backup.toLowerCase().endsWith('.dump')) throw backupError('SOURCE_ROLLBACK_PATH_UNSAFE')
    const stat = await fs.stat(backup).catch(() => null)
    if (!stat?.isFile() || stat.size <= 0) throw backupError('SOURCE_ROLLBACK_BACKUP_MISSING')
    await execFileAsync('pg_restore', [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        `--dbname=${url}`,
        backup,
    ], { windowsHide: true, maxBuffer: 1024 * 1024 })
    return { restored: true }
}
