import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    parseValidateAtendimentoStagingControlArgs,
    validateAtendimentoStagingControl,
} from './validate-atendimento-staging-control.mjs'

const RELEASE_SHA = 'a'.repeat(40)

function strictControl(overrides = {}) {
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

test('staging installer accepts only a strict matching read-only control', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atendimento-staging-control-'))
    const controlFile = path.join(directory, 'module-control.json')
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

    fs.writeFileSync(controlFile, JSON.stringify(strictControl()), 'utf8')
    assert.deepEqual(validateAtendimentoStagingControl({ releaseSha: RELEASE_SHA, filePath: controlFile }), {
        state: 'maintenance',
        releaseSha: RELEASE_SHA,
        readOnly: true,
        syntheticOnly: true,
    })

    fs.writeFileSync(controlFile, JSON.stringify(strictControl({ commercialContactWritesEnabled: true })), 'utf8')
    assert.throws(
        () => validateAtendimentoStagingControl({ releaseSha: RELEASE_SHA, filePath: controlFile }),
        (error) => error?.code === 'ATENDIMENTO_STAGING_CONTROL_INVALID',
    )

    fs.writeFileSync(controlFile, JSON.stringify(strictControl({ state: 'disabled' })), 'utf8')
    assert.throws(
        () => validateAtendimentoStagingControl({ releaseSha: RELEASE_SHA, filePath: controlFile }),
        (error) => error?.code === 'ATENDIMENTO_STAGING_CONTROL_STATE_NOT_INSTALLABLE',
    )
})

test('staging control CLI accepts only a literal full release SHA', () => {
    assert.equal(parseValidateAtendimentoStagingControlArgs(['--release-sha', RELEASE_SHA]), RELEASE_SHA)
    assert.deepEqual(parseValidateAtendimentoStagingControlArgs(['--release-sha', RELEASE_SHA, '--surface', 'full']), { releaseSha: RELEASE_SHA, surface: 'full' })
    assert.throws(
        () => parseValidateAtendimentoStagingControlArgs(['--release-sha', '../not-a-sha']),
        (error) => error?.code === 'ATENDIMENTO_STAGING_CONTROL_ARGUMENTS_INVALID',
    )
    assert.throws(
        () => parseValidateAtendimentoStagingControlArgs(['--control-file', '/tmp/control.json']),
        (error) => error?.code === 'ATENDIMENTO_STAGING_CONTROL_ARGUMENTS_INVALID',
    )
})
