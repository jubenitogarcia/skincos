import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const NONCE = /^[A-Za-z0-9_-]{16,128}$/

function failure(code) {
    const error = new Error(code)
    error.code = code
    return error
}

function nonceHash(nonce) {
    return createHash('sha256').update(String(nonce)).digest('hex')
}

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return pid === process.pid
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return error?.code !== 'ESRCH'
    }
}

function safeState(value) {
    if (!value || typeof value !== 'object' || value.version !== 1 || !value.entries || typeof value.entries !== 'object') {
        throw failure('ATENDIMENTO_REPLAY_STATE_INVALID')
    }
    const entries = {}
    // The state file is private, but treat a corrupted or unexpectedly large
    // file as unavailable rather than allowing a restart to consume arbitrary
    // memory.  A healthy runtime prunes to its configured capacity on every
    // start and consume.
    let seen = 0
    for (const [key, expiresAt] of Object.entries(value.entries)) {
        seen += 1
        if (seen > 100_000) throw failure('ATENDIMENTO_REPLAY_STATE_INVALID')
        if (/^[0-9a-f]{64}$/.test(key) && Number.isFinite(expiresAt)) entries[key] = Number(expiresAt)
    }
    return { version: 1, entries }
}

export function createPersistentReplayGuard({
    statePath,
    fsImpl = fs,
    clock = () => Date.now(),
    maxEntries = 10_000,
} = {}) {
    const resolvedPath = String(statePath || '').trim()
    const lockPath = resolvedPath ? `${resolvedPath}.lock` : ''
    let state = { version: 1, entries: {} }
    let ready = false
    let lastError = 'ATENDIMENTO_REPLAY_STATE_NOT_CONFIGURED'
    let lockToken = null
    let chain = Promise.resolve()

    const enqueue = (work) => {
        const next = chain.then(work, work)
        chain = next.catch(() => undefined)
        return next
    }

    async function createLockDirectory() {
        const token = randomUUID()
        await fsImpl.mkdir(lockPath, { mode: 0o700 })
        try {
            await fsImpl.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({ version: 1, pid: process.pid, token }), {
                encoding: 'utf8',
                mode: 0o600,
            })
        } catch (error) {
            try { await fsImpl.rm(lockPath, { recursive: true, force: true }) } catch { /* fail closed below */ }
            throw error
        }
        lockToken = token
    }

    async function acquireLock() {
        if (!resolvedPath || !path.isAbsolute(resolvedPath)) throw failure('ATENDIMENTO_REPLAY_STATE_PATH_INVALID')
        try {
            await createLockDirectory()
            return
        } catch (error) {
            if (error?.code !== 'EEXIST') throw failure('ATENDIMENTO_REPLAY_LOCK_UNAVAILABLE')
        }

        let existing = null
        try { existing = JSON.parse(await fsImpl.readFile(path.join(lockPath, 'owner.json'), 'utf8')) } catch { /* malformed locks fail closed */ }
        const existingPid = Number(existing?.pid)
        if (!existing || !Number.isInteger(existingPid) || existingPid <= 0 || isProcessAlive(existingPid)) {
            throw failure('ATENDIMENTO_REPLAY_LOCK_UNAVAILABLE')
        }

        // Rename, rather than unlink, a stale lock.  A contender can only
        // create its own directory after the rename; if it wins that race our
        // mkdir fails and this process remains fail-closed.  We never delete a
        // path that might have been re-acquired by another runtime.
        const stalePath = `${lockPath}.stale.${process.pid}.${randomUUID()}`
        try { await fsImpl.rename(lockPath, stalePath) } catch { throw failure('ATENDIMENTO_REPLAY_LOCK_UNAVAILABLE') }
        try {
            await createLockDirectory()
        } catch {
            throw failure('ATENDIMENTO_REPLAY_LOCK_UNAVAILABLE')
        } finally {
            try { await fsImpl.rm(stalePath, { recursive: true, force: true }) } catch { /* stale artifact has no authority */ }
        }
    }

    async function persist() {
        const temporary = `${resolvedPath}.${process.pid}.tmp`
        await fsImpl.writeFile(temporary, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
        await fsImpl.rename(temporary, resolvedPath)
    }

    function prune(now) {
        for (const [key, expiresAt] of Object.entries(state.entries)) {
            if (!Number.isFinite(expiresAt) || expiresAt <= now) delete state.entries[key]
        }
        const overflow = Object.entries(state.entries)
            .sort((left, right) => left[1] - right[1])
            .slice(0, Math.max(0, Object.keys(state.entries).length - Math.max(1, Number(maxEntries) || 1)))
        for (const [key] of overflow) delete state.entries[key]
    }

    async function start() {
        return enqueue(async () => {
            ready = false
            lastError = null
            try {
                if (!resolvedPath || !path.isAbsolute(resolvedPath)) throw failure('ATENDIMENTO_REPLAY_STATE_PATH_INVALID')
                await fsImpl.access(path.dirname(resolvedPath))
                await acquireLock()
                try {
                    state = safeState(JSON.parse(await fsImpl.readFile(resolvedPath, 'utf8')))
                } catch (error) {
                    if (error?.code === 'ENOENT') {
                        state = { version: 1, entries: {} }
                        await persist()
                    } else {
                        throw error
                    }
                }
                prune(Number(clock()))
                await persist()
                ready = true
                return getStatus()
            } catch (error) {
                ready = false
                lastError = String(error?.code || 'ATENDIMENTO_REPLAY_UNAVAILABLE')
                await releaseLock()
                return getStatus()
            }
        })
    }

    async function consume(nonce, expiresAt) {
        return enqueue(async () => {
            if (!ready) throw failure(lastError || 'ATENDIMENTO_REPLAY_UNAVAILABLE')
            if (!NONCE.test(String(nonce || ''))) throw failure('ATENDIMENTO_NONCE_INVALID')
            const now = Number(clock())
            const expiry = Number(expiresAt)
            if (!Number.isFinite(expiry) || expiry <= now) throw failure('ATENDIMENTO_NONCE_EXPIRED')
            prune(now)
            const key = nonceHash(nonce)
            if (state.entries[key]) return false
            state.entries[key] = expiry
            await persist()
            return true
        })
    }

    async function releaseLock() {
        const token = lockToken
        lockToken = null
        if (!lockPath || !token) return
        // If an operator had to remove the lock during an outage, do not allow
        // this old process to delete a newly acquired lock on shutdown.
        try {
            const owner = JSON.parse(await fsImpl.readFile(path.join(lockPath, 'owner.json'), 'utf8'))
            if (owner?.pid !== process.pid || owner?.token !== token) return
            await fsImpl.rm(lockPath, { recursive: true, force: true })
        } catch { /* best effort, never remove an unknown lock */ }
    }

    async function close() {
        await enqueue(async () => {
            ready = false
            await releaseLock()
        })
    }

    function getStatus() {
        return { ready, error: ready ? null : (lastError || 'ATENDIMENTO_REPLAY_UNAVAILABLE') }
    }

    return { start, consume, close, getStatus }
}

export const __testables = { nonceHash, safeState }
