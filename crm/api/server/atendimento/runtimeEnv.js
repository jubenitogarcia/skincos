import { readFile } from 'node:fs/promises'

const ENVIRONMENT_KEY = /^[A-Z][A-Z0-9_]{0,127}$/

function runtimeEnvError(code) {
    const error = new Error(code)
    error.code = code
    return error
}

/**
 * Parse a systemd-style key/value file without invoking a shell.  Values are
 * literal: `$()`, backticks, expansions and quotes can never execute while a
 * migration or smoke helper reads its one required secret.
 */
export function parseLiteralEnvironment(text, { allowedKeys = null } = {}) {
    const values = {}
    const allowed = allowedKeys ? new Set([...allowedKeys].map(String)) : null
    for (const [index, sourceLine] of String(text || '').split(/\r?\n/).entries()) {
        const line = sourceLine.trim()
        if (!line || line.startsWith('#')) continue
        const separator = line.indexOf('=')
        if (separator <= 0) throw runtimeEnvError(`ATENDIMENTO_RUNTIME_ENV_LINE_${index + 1}_INVALID`)
        const key = line.slice(0, separator).trim()
        if (!ENVIRONMENT_KEY.test(key)) throw runtimeEnvError(`ATENDIMENTO_RUNTIME_ENV_LINE_${index + 1}_INVALID`)
        let value = line.slice(separator + 1).trim()
        if ((value.startsWith('"') || value.startsWith("'"))) {
            const quote = value[0]
            if (value.length < 2 || !value.endsWith(quote)) throw runtimeEnvError(`ATENDIMENTO_RUNTIME_ENV_LINE_${index + 1}_INVALID`)
            value = value.slice(1, -1)
        }
        if (value.includes('\u0000') || value.includes('\n') || value.includes('\r')) {
            throw runtimeEnvError(`ATENDIMENTO_RUNTIME_ENV_LINE_${index + 1}_INVALID`)
        }
        if (!allowed || allowed.has(key)) values[key] = value
    }
    return values
}

export async function readLiteralEnvironment(filePath, options = {}) {
    const path = String(filePath || '').trim()
    if (!path.startsWith('/etc/skincos/') || path.includes('..')) throw runtimeEnvError('ATENDIMENTO_RUNTIME_ENV_PATH_INVALID')
    let text
    try {
        text = await readFile(path, 'utf8')
    } catch {
        throw runtimeEnvError('ATENDIMENTO_RUNTIME_ENV_UNREADABLE')
    }
    return parseLiteralEnvironment(text, options)
}

export const __testables = { runtimeEnvError }
