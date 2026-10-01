#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_CONTRACT,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID,
    ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS,
    ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY,
    ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION,
    ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT,
} from '../shared/crm-auth/atendimentoCrmCoreIdentityMaterializationPolicy.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const defaultCatalogPath = path.join(root, 'docs/extraction/atendimento-crm-core-identity-materialization.json')

function fail(code) {
    throw new Error(`ATENDIMENTO_CRM_CORE_IDENTITY_CATALOG_INVALID:${code}`)
}

function object(value, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code)
    return value
}

function exactKeys(value, expected, code) {
    const actual = Object.keys(value).sort()
    const keys = [...expected].sort()
    if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) fail(code)
}

function orderedStrings(value, code) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || !entry.trim()) || new Set(value).size !== value.length) {
        fail(code)
    }
    return value
}

function exactStrings(value, expected, code) {
    const actual = orderedStrings(value, code)
    if (actual.length !== expected.length || actual.some((entry, index) => entry !== expected[index])) fail(code)
    return actual
}

export function assertAtendimentoCrmCoreIdentityMaterializationCatalog(value) {
    const catalog = object(value, 'CATALOG_INVALID')
    exactKeys(catalog, ['contract', 'state', 'migration', 'identityPolicy', 'projection', 'writer'], 'CATALOG_KEYS_INVALID')
    if (catalog.contract !== 'skincos/atendimento-crm-core-identity-materialization/v2' || catalog.state !== 'schema-preparation-authorized') {
        fail('CATALOG_STATE_INVALID')
    }

    const migration = object(catalog.migration, 'MIGRATION_INVALID')
    exactKeys(migration, ['id', 'mode', 'automaticApplicationAllowed', 'dataMutationAllowed', 'rollback'], 'MIGRATION_KEYS_INVALID')
    if (migration.id !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_MIGRATION_ID
        || migration.mode !== 'additive-schema-only'
        || migration.automaticApplicationAllowed !== false
        || migration.dataMutationAllowed !== false
        || migration.rollback !== 'non-destructive-registry-only') {
        fail('MIGRATION_NOT_FAIL_CLOSED')
    }

    const identityPolicy = object(catalog.identityPolicy, 'IDENTITY_POLICY_INVALID')
    exactKeys(identityPolicy, ['version', 'sourceType', 'componentKeyTemplate', 'approvedLinkMethods', 'uuidFromNameAllowed', 'nameBasedAutomaticLinkAllowed', 'ambiguousLinkPolicy', 'reassignmentPolicy', 'revisionPolicy', 'sameRevisionEvidencePolicy'], 'IDENTITY_POLICY_KEYS_INVALID')
    if (identityPolicy.version !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.version
        || identityPolicy.sourceType !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.sourceType
        || identityPolicy.componentKeyTemplate !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.componentKeyTemplate
        || !Array.isArray(identityPolicy.approvedLinkMethods)
        || identityPolicy.approvedLinkMethods.length !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.approvedLinkMethods.length
        || identityPolicy.approvedLinkMethods.some((method, index) => method !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.approvedLinkMethods[index])
        || identityPolicy.uuidFromNameAllowed !== false
        || identityPolicy.nameBasedAutomaticLinkAllowed !== false
        || identityPolicy.ambiguousLinkPolicy !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.ambiguousLinkPolicy
        || identityPolicy.reassignmentPolicy !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.reassignmentPolicy
        || identityPolicy.revisionPolicy !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.revisionPolicy
        || identityPolicy.sameRevisionEvidencePolicy !== ATENDIMENTO_CRM_CORE_IDENTITY_RECONCILIATION_POLICY.sameRevisionEvidencePolicy) {
        fail('IDENTITY_POLICY_NOT_FAIL_CLOSED')
    }

    const projection = object(catalog.projection, 'PROJECTION_INVALID')
    exactKeys(projection, ['sourceSemantics', 'sourceRelationAllowlist', 'excludedSourceDomains', 'customerAttributesCopied', 'productionBackfillAllowed'], 'PROJECTION_KEYS_INVALID')
    if (projection.sourceSemantics !== ATENDIMENTO_CRM_CORE_IDENTITY_SOURCE_SEMANTICS_VERSION) fail('PROJECTION_SEMANTICS_INVALID')
    exactStrings(projection.sourceRelationAllowlist, ATENDIMENTO_CRM_CORE_ISOLATED_IDENTITY_PROJECTION_SOURCE_RELATIONS, 'PROJECTION_RELATION_ALLOWLIST_INVALID')
    exactStrings(projection.excludedSourceDomains, ['finance'], 'PROJECTION_DOMAIN_EXCLUSIONS_INVALID')
    if (projection.customerAttributesCopied !== false || projection.productionBackfillAllowed !== false) {
        fail('PROJECTION_NOT_FAIL_CLOSED')
    }

    const writer = object(catalog.writer, 'WRITER_INVALID')
    exactKeys(writer, ['contract', 'databaseRole', 'automaticExecutionAllowed', 'input', 'ledger', 'grants'], 'WRITER_KEYS_INVALID')
    if (writer.contract !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.version
        || writer.databaseRole !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.databaseRole
        || writer.automaticExecutionAllowed !== false
        || writer.input !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.input
        || writer.ledger !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.ledger
        || writer.grants !== ATENDIMENTO_CRM_CORE_IDENTITY_MATERIALIZATION_WRITER_CONTRACT.grants) {
        fail('WRITER_NOT_FAIL_CLOSED')
    }

    return Object.freeze({
        contract: catalog.contract,
        migrationId: migration.id,
        sourceSemantics: projection.sourceSemantics,
        sourceRelationAllowlist: Object.freeze([...projection.sourceRelationAllowlist]),
        productionBackfillAllowed: projection.productionBackfillAllowed,
        writerAutomaticExecutionAllowed: writer.automaticExecutionAllowed,
    })
}

export function readAtendimentoCrmCoreIdentityMaterializationCatalog(file = defaultCatalogPath) {
    let parsed
    try {
        parsed = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
    } catch {
        fail('CATALOG_READ_FAILED')
    }
    return assertAtendimentoCrmCoreIdentityMaterializationCatalog(parsed)
}

function parseArguments(args) {
    if (!Array.isArray(args) || args.length === 0) return defaultCatalogPath
    if (args.length === 2 && args[0] === '--catalog' && args[1] && !args[1].startsWith('-')) return args[1]
    fail('OPERATION_NOT_SUPPORTED')
}

function main() {
    process.stdout.write(`${JSON.stringify(readAtendimentoCrmCoreIdentityMaterializationCatalog(parseArguments(process.argv.slice(2))))}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main()
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : 'ATENDIMENTO_CRM_CORE_IDENTITY_CATALOG_INVALID'}\n`)
        process.exitCode = 1
    }
}
