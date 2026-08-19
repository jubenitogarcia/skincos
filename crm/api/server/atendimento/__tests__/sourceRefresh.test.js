import test from 'node:test'
import assert from 'node:assert/strict'

import {
    assertClientesSourceRefreshDatabaseIdentity,
    assertClientesSourceRefreshDatabaseUrl,
    normalizeClientesSourceRefreshAction,
    normalizeClientesSourceRefreshTarget,
    sourceRefreshActor,
    summarizeClientesSourceRefresh,
} from '../sourceRefresh.js'

test('normalizes only the explicit Clientes source refresh targets and actions', () => {
    assert.equal(normalizeClientesSourceRefreshTarget(' STAGING '), 'staging')
    assert.equal(normalizeClientesSourceRefreshAction('dry-run'), 'dry-run')
    assert.throws(() => normalizeClientesSourceRefreshTarget('local'), { code: 'CLIENTES_SOURCE_REFRESH_TARGET_INVALID' })
    assert.throws(() => normalizeClientesSourceRefreshAction('write'), { code: 'CLIENTES_SOURCE_REFRESH_ACTION_INVALID' })
})

test('accepts only the target-bound production and staging database URL shapes', () => {
    assert.deepEqual(
        assertClientesSourceRefreshDatabaseUrl(
            'postgresql://skincos_clientes_migrator_login:synthetic@127.0.0.1:5432/skincos_clientes_production?sslmode=require&uselibpqcompat=true',
            'production',
        ),
        { target: 'production', database: 'skincos_clientes_production' },
    )
    assert.deepEqual(
        assertClientesSourceRefreshDatabaseUrl(
            'postgresql://skincos_staging_migrator_login:secret@127.0.0.1:5432/skincos_staging?sslmode=require&uselibpqcompat=true',
            'staging',
        ),
        { target: 'staging', database: 'skincos_staging' },
    )
    assert.throws(() => assertClientesSourceRefreshDatabaseUrl(
        'postgresql://admin:secret@127.0.0.1:5432/skincos_clientes_production?sslmode=require',
        'production',
    ), { code: 'CLIENTES_SOURCE_REFRESH_PRODUCTION_DATABASE_UNSAFE' })
})

test('requires the expected database identity before source refresh', () => {
    assert.deepEqual(
        assertClientesSourceRefreshDatabaseIdentity({ database_name: 'skincos_clientes_production', current_user: 'skincos_clientes_migrator_login' }, 'production'),
        { target: 'production', database: 'skincos_clientes_production', user: 'skincos_clientes_migrator_login' },
    )
    assert.deepEqual(
        assertClientesSourceRefreshDatabaseIdentity({ database_name: 'skincos_staging', current_user: 'skincos_staging_migrator_login' }, 'staging'),
        { target: 'staging', database: 'skincos_staging', user: 'skincos_staging_migrator_login' },
    )
    assert.throws(() => assertClientesSourceRefreshDatabaseIdentity({ database_name: 'skincos_staging', current_user: 'postgres' }, 'staging'), { code: 'CLIENTES_SOURCE_REFRESH_STAGING_IDENTITY_UNSAFE' })
    assert.throws(() => assertClientesSourceRefreshDatabaseIdentity({ database_name: 'skincos_staging', current_user: 'skincos_staging_app' }, 'staging'), { code: 'CLIENTES_SOURCE_REFRESH_STAGING_IDENTITY_UNSAFE' })
})

test('uses a non-person actor and emits only aggregate refresh evidence', () => {
    assert.deepEqual(sourceRefreshActor('production'), {
        id: 'clientes-source-refresh-production',
        username: 'clientes-source-refresh-production',
        role: 'ADMIN',
        allowedModules: ['atendimento'],
    })
    assert.deepEqual(summarizeClientesSourceRefresh({
        target: 'staging',
        action: 'apply',
        identity: { database: 'skincos_staging', user: 'skincos_staging_app' },
        result: {
            dryRun: false,
            records: 3,
            inserted: 1,
            updated: 2,
            skipped: 0,
            importBatchId: 'batch-1',
            spreadsheetId: 'sheet-1',
            tabs: ['Novo Hamburgo'],
        },
    }), {
        ok: true,
        target: 'staging',
        action: 'apply',
        database: 'skincos_staging',
        databaseUser: 'skincos_staging_app',
        dryRun: false,
        records: 3,
        inserted: 1,
        updated: 2,
        skipped: 0,
        importBatchId: 'batch-1',
        spreadsheetId: 'sheet-1',
        tabs: ['Novo Hamburgo'],
    })
})
