import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseAtendimentoStagingMigrationAction,
  runAtendimentoStagingMigration,
} from './migrate-atendimento-staging.mjs'

test('staging migration parser accepts exactly one explicit action', () => {
  assert.equal(parseAtendimentoStagingMigrationAction(['--dry-run']), 'dry-run')
  assert.equal(parseAtendimentoStagingMigrationAction(['--apply']), 'apply')
  assert.equal(parseAtendimentoStagingMigrationAction(['--rollback']), 'rollback')
  assert.throws(() => parseAtendimentoStagingMigrationAction([]), /exatamente uma ação/)
  assert.throws(() => parseAtendimentoStagingMigrationAction(['--apply', '--rollback']), /exatamente uma ação/)
})

test('staging migration runner rejects an unapproved destination before creating a pool', async () => {
  let created = false
  await assert.rejects(
    runAtendimentoStagingMigration({
      databaseUrl: 'postgresql://unsafe@remote.invalid/not_staging',
      action: 'apply',
      createPool: () => {
        created = true
        throw new Error('must not connect')
      },
    }),
    /DATABASE_URL deve apontar exclusivamente/,
  )
  assert.equal(created, false)
})
