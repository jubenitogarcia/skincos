import test from 'node:test'
import assert from 'node:assert/strict'
import { backupDatabaseTarget, restoreDatabaseTarget } from '../sourceBackup.js'

test('backup and restore reject production-like or outside paths before invoking pg tools', async () => {
    await assert.rejects(() => backupDatabaseTarget({ databaseUrl: 'postgresql://prod.example/prod', target: 'local', sourceId: 'source.test', root: '/tmp/clientes-source-test' }), (error) => error.code === 'SOURCE_BACKUP_DATABASE_TARGET_INVALID')
    await assert.rejects(() => restoreDatabaseTarget({ databaseUrl: 'postgresql:///skincos_crm_local?host=/var/run/postgresql', target: 'local', backupRef: '/tmp/other.dump', root: '/tmp/clientes-source-test' }), (error) => error.code === 'SOURCE_ROLLBACK_PATH_UNSAFE')
})
