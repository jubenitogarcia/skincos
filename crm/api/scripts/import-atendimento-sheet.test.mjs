import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const script = fileURLToPath(new URL('./import-atendimento-sheet.mjs', import.meta.url))

test('retired importer has no source or database writer dependency', async () => {
    const source = await readFile(script, 'utf8')
    assert.doesNotMatch(source, /createAtendimentoStore|importAtendimentoFromGoogleSheet|createPgPool|DATABASE_URL|readAtendimentoSheet/)
})

test('legacy Atendimento sheet importer is retired even when write is requested', () => {
    for (const args of [[], ['--write']]) {
        const result = spawnSync(process.execPath, [script, ...args], {
            encoding: 'utf8',
            env: { PATH: process.env.PATH || '' },
        })
        assert.equal(result.status, 78)
        assert.equal(result.stdout, '')
        assert.deepEqual(JSON.parse(result.stderr), {
            ok: false,
            code: 'ATENDIMENTO_LEGACY_SHEET_IMPORT_RETIRED',
            replacement: 'npm run sync-atendimento-source -- --dry-run',
            writesDisabled: true,
        })
    }
})
