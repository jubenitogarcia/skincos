import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    parseValidateAtendimentoProductionControlArgs,
    validateAtendimentoProductionControl,
} from './validate-atendimento-production-control.mjs'

const RELEASE_SHA = 'b'.repeat(40)

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

test('production installer accepts only a strict matching read-only control', (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atendimento-production-control-'))
    const controlFile = path.join(directory, 'module-control.json')
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }))

    fs.writeFileSync(controlFile, JSON.stringify(strictControl()), 'utf8')
    assert.deepEqual(validateAtendimentoProductionControl({ releaseSha: RELEASE_SHA, filePath: controlFile }), {
        state: 'maintenance',
        releaseSha: RELEASE_SHA,
        readOnly: true,
        syntheticOnly: true,
    })

    fs.writeFileSync(controlFile, JSON.stringify(strictControl({ commercialContactWritesEnabled: true })), 'utf8')
    assert.throws(
        () => validateAtendimentoProductionControl({ releaseSha: RELEASE_SHA, filePath: controlFile }),
        (error) => error?.code === 'ATENDIMENTO_PRODUCTION_CONTROL_INVALID',
    )

    fs.writeFileSync(controlFile, JSON.stringify(strictControl({ state: 'disabled' })), 'utf8')
    assert.throws(
        () => validateAtendimentoProductionControl({ releaseSha: RELEASE_SHA, filePath: controlFile }),
        (error) => error?.code === 'ATENDIMENTO_PRODUCTION_CONTROL_STATE_NOT_INSTALLABLE',
    )
})

test('production control CLI accepts only a literal full release SHA', () => {
    assert.equal(parseValidateAtendimentoProductionControlArgs(['--release-sha', RELEASE_SHA]), RELEASE_SHA)
    assert.throws(
        () => parseValidateAtendimentoProductionControlArgs(['--release-sha', '../not-a-sha']),
        (error) => error?.code === 'ATENDIMENTO_PRODUCTION_CONTROL_ARGUMENTS_INVALID',
    )
    assert.throws(
        () => parseValidateAtendimentoProductionControlArgs(['--control-file', '/tmp/control.json']),
        (error) => error?.code === 'ATENDIMENTO_PRODUCTION_CONTROL_ARGUMENTS_INVALID',
    )
})
