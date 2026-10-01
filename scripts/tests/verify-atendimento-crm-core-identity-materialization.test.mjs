import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
    assertAtendimentoCrmCoreIdentityMaterializationCatalog,
} from '../verify-atendimento-crm-core-identity-materialization.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const catalogPath = path.join(root, 'docs/extraction/atendimento-crm-core-identity-materialization.json')
const scriptPath = path.join(root, 'scripts/verify-atendimento-crm-core-identity-materialization.mjs')

function catalog() {
    return JSON.parse(readFileSync(catalogPath, 'utf8'))
}

test('catalog binds the schema-only policy to the exact CRM Core exporter relation allowlist', () => {
    const summary = assertAtendimentoCrmCoreIdentityMaterializationCatalog(catalog())
    assert.equal(summary.migrationId, '20260910_atendimento_crm_core_identity_materialization_v1')
    assert.equal(summary.sourceSemantics, 'atendimento/crm-core/confirmed-unit-membership-source/v5')
    assert.deepEqual(summary.sourceRelationAllowlist, [
        'crm_atendimento.crm_core_identity_members',
        'crm_atendimento.crm_core_attendance_client_links',
        'crm_atendimento.attendances',
        'crm_atendimento.units',
    ])
    assert.equal(summary.productionBackfillAllowed, false)
    assert.equal(summary.writerAutomaticExecutionAllowed, false)
    assert.deepEqual(catalog().identityPolicy.approvedLinkMethods, [
        'operator_attested',
        'stable_source_reference',
        'reviewed_reconciliation',
    ])
    assert.equal(catalog().identityPolicy.revisionPolicy, 'monotonic')
    assert.equal(catalog().identityPolicy.sameRevisionEvidencePolicy, 'review-required')
})

test('catalog refuses source expansion, automatic application, and name-derived identity policy', () => {
    const financeRelation = catalog()
    financeRelation.projection.sourceRelationAllowlist.push('crm_caixa.sales')
    assert.throws(() => assertAtendimentoCrmCoreIdentityMaterializationCatalog(financeRelation), /PROJECTION_RELATION_ALLOWLIST_INVALID/)

    const automatic = catalog()
    automatic.migration.automaticApplicationAllowed = true
    assert.throws(() => assertAtendimentoCrmCoreIdentityMaterializationCatalog(automatic), /MIGRATION_NOT_FAIL_CLOSED/)

    const names = catalog()
    names.identityPolicy.uuidFromNameAllowed = true
    assert.throws(() => assertAtendimentoCrmCoreIdentityMaterializationCatalog(names), /IDENTITY_POLICY_NOT_FAIL_CLOSED/)

    const automaticWriter = catalog()
    automaticWriter.writer.automaticExecutionAllowed = true
    assert.throws(() => assertAtendimentoCrmCoreIdentityMaterializationCatalog(automaticWriter), /WRITER_NOT_FAIL_CLOSED/)
})

test('catalog verifier offers no migration or delivery operation', () => {
    const result = spawnSync(process.execPath, [scriptPath, '--apply'], { encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.equal(result.stdout, '')
    assert.match(result.stderr, /OPERATION_NOT_SUPPORTED/)
})
