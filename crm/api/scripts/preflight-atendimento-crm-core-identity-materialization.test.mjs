import assert from 'node:assert/strict'
import test from 'node:test'

import {
    parseAtendimentoCrmCoreIdentityMaterializationPreflightInvocation,
} from './preflight-atendimento-crm-core-identity-materialization.mjs'

test('identity materialization preflight accepts only a named managed target', () => {
    assert.deepEqual(
        parseAtendimentoCrmCoreIdentityMaterializationPreflightInvocation(['--target', 'staging']),
        { target: 'staging' },
    )
    assert.deepEqual(
        parseAtendimentoCrmCoreIdentityMaterializationPreflightInvocation(['--target', 'production']),
        { target: 'production' },
    )
    for (const args of [[], ['--apply'], ['--target', 'local'], ['--target', 'production', '--apply']]) {
        assert.throws(() => parseAtendimentoCrmCoreIdentityMaterializationPreflightInvocation(args), /Use exatamente/)
    }
})
