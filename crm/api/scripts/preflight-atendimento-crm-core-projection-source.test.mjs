import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./preflight-atendimento-crm-core-projection-source.mjs', import.meta.url))

const result = spawnSync(process.execPath, [script, '--unexpected'], {
    encoding: 'utf8',
    env: {},
})

assert.notEqual(result.status, 0)
assert.match(result.stderr, /ATENDIMENTO_CRM_PROJECTION_SOURCE_METADATA_ARGUMENTS_INVALID/)
assert.equal(result.stdout, '')
