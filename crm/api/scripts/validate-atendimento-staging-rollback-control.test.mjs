import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    parseAtendimentoStagingRollbackControlArgs,
    validateAtendimentoStagingRollbackControl,
} from './validate-atendimento-staging-rollback-control.mjs'

const RELEASE_SHA = 'a'.repeat(40)
const BACKUP_NAME = '20260808T200000Z-module-control.Ab3D9e.json'

function strictMaintenanceControl(overrides = {}) {
    return {
        schemaVersion: 1,
        module: 'atendimento',
        state: 'maintenance',
        releaseSha: RELEASE_SHA,
        readOnly: true,
        commercialContactWritesEnabled: false,
        syntheticOnly: true,
        ...overrides,
    }
}

test('rollback control accepts only a fixed private maintenance snapshot for its release', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atendimento-staging-rollback-control-'))
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
    fs.writeFileSync(path.join(directory, BACKUP_NAME), JSON.stringify(strictMaintenanceControl()), 'utf8')

    assert.deepEqual(await validateAtendimentoStagingRollbackControl({
        releaseSha: RELEASE_SHA,
        backupName: BACKUP_NAME,
        backupRoot: directory,
    }), {
        backupName: BACKUP_NAME,
        state: 'maintenance',
        releaseSha: RELEASE_SHA,
        readOnly: true,
        syntheticOnly: true,
    })

    fs.writeFileSync(path.join(directory, BACKUP_NAME), JSON.stringify(strictMaintenanceControl({ state: 'active' })), 'utf8')
    await assert.rejects(
        () => validateAtendimentoStagingRollbackControl({
            releaseSha: RELEASE_SHA,
            backupName: BACKUP_NAME,
            backupRoot: directory,
        }),
        (error) => error?.code === 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_NOT_MAINTENANCE',
    )
})

test('rollback control CLI rejects traversal, aliases and incomplete arguments', () => {
    assert.deepEqual(parseAtendimentoStagingRollbackControlArgs([
        '--release-sha', RELEASE_SHA,
        '--backup-name', BACKUP_NAME,
    ]), { releaseSha: RELEASE_SHA, backupName: BACKUP_NAME })
    for (const args of [
        ['--release-sha', RELEASE_SHA, '--backup-name', '../module-control.json'],
        ['--release-sha', RELEASE_SHA, '--backup-name', '20260808T200000Z-module-control.json'],
        ['--release-sha', RELEASE_SHA, '--backup-name', BACKUP_NAME, '--backup-name', BACKUP_NAME],
        ['--release-sha', RELEASE_SHA],
    ]) {
        assert.throws(
            () => parseAtendimentoStagingRollbackControlArgs(args),
            (error) => error?.code === 'ATENDIMENTO_STAGING_ROLLBACK_CONTROL_ARGUMENTS_INVALID',
        )
    }
})
