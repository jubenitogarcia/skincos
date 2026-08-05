import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('prepares the private reconciliation artifact directory before database work', async () => {
    const source = await readFile(
        new URL('../../../scripts/reconcile-client-registrations.mjs', import.meta.url),
        'utf8',
    )
    const prepareIndex = source.indexOf('const preparedOutputDirectory = await prepareIdentityMaterializationOutputDirectory({ outputDirectory })')
    const poolIndex = source.indexOf('const pool = new pg.Pool')
    const transactionIndex = source.indexOf("await client.query('begin')")
    const artifactWriteIndex = source.indexOf('await writeReconciliationArtifacts({')
    const commitIndex = source.indexOf("await client.query('commit')")

    assert.ok(prepareIndex >= 0)
    assert.ok(poolIndex >= 0)
    assert.ok(transactionIndex >= 0)
    assert.ok(artifactWriteIndex >= 0)
    assert.ok(commitIndex >= 0)
    assert.ok(prepareIndex < poolIndex)
    assert.ok(prepareIndex < transactionIndex)
    assert.ok(transactionIndex < artifactWriteIndex)
    assert.ok(artifactWriteIndex < commitIndex)
    assert.ok(source.includes("mode: 0o600, flag: 'wx'"))
})
