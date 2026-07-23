import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { createPgPool, strictTlsConfig } from '../postgres/pool.js'

test('PostgreSQL refuses a pool without CA and server identity', () => {
    assert.throws(
        () => strictTlsConfig('postgresql://app:pass@db.staging.example/skincos'),
        /POSTGRES_TLS_CA_AND_SERVER_NAME_REQUIRED/,
    )
})

test('domain pool applies the isolated default limit with strict TLS', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'skincos-pg-ca-'))
    const certificate = path.join(directory, 'ca.pem')
    fs.writeFileSync(certificate, 'test-ca')
    const pool = createPgPool('postgresql://app:pass@db.staging.example/skincos?application_name=test', {
        domain: 'harmonia',
        env: { PGTLS_CA_FILE: certificate, PGTLS_SERVER_NAME: 'db.staging.example' },
    })
    assert.equal(pool.options.max, 4)
    assert.equal(pool.options.ssl.rejectUnauthorized, true)
    await pool.end()
    fs.rmSync(directory, { recursive: true, force: true })
})
