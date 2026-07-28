import test from 'node:test'
import assert from 'node:assert/strict'

import {
    assertLocalMirrorDatabaseUrl,
    localMirrorPoolOptions,
} from './validate-local-atendimento-runtime.mjs'

test('accepts only the dedicated local socket database URL', () => {
    const url = 'postgresql:///skincos_crm_local?host=/var/run/postgresql'
    assert.equal(assertLocalMirrorDatabaseUrl(url), url)
    assert.throws(() => assertLocalMirrorDatabaseUrl('postgresql://admin@localhost/skincos_crm_local'), /CRM_LOCAL_DATABASE_URL_MUST_USE_LOCAL_SOCKET/)
})

test('pins the bootstrap pool to the local admin role', () => {
    const options = localMirrorPoolOptions('postgresql:///skincos_crm_local?host=/var/run/postgresql', 'admin')
    assert.deepEqual(options, {
        connectionString: 'postgresql:///skincos_crm_local?host=/var/run/postgresql',
        user: 'admin',
        max: 1,
    })
    assert.throws(() => localMirrorPoolOptions(options.connectionString, 'root'), /CRM_LOCAL_DATABASE_ROLE_MUST_BE_ADMIN/)
})
