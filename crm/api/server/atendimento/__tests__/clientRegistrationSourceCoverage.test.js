import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
    assertClientRegistrationSourceCoverageEligibleForApply,
    loadClientRegistrationSourceCoverage,
    normalizeClientRegistrationSourceCoverage,
} from '../clientRegistrationSourceCoverage.js'
import { fingerprintIdentityMaterializationSource } from '../identityMaterializationSafety.js'

const units = ['BarraShoppingSul', 'Novo Hamburgo']

function unitOutcome({ termination = 'pagination_exhausted', initialCheckpointRecords = 0 } = {}) {
    return {
        initialCheckpointRecords,
        pagesProcessed: 2,
        lastPageProcessed: 2,
        maxPageObserved: 2,
        recordsExportedThisRun: 4,
        clientsSkippedCheckpoint: initialCheckpointRecords,
        clientErrors: 0,
        termination,
        visiblePaginationExhausted: termination === 'pagination_exhausted',
        traversalFinalized: termination !== 'in_progress',
    }
}

function coverage(overrides = {}) {
    const unitOutcomes = Object.fromEntries(units.map((unit) => [unit, unitOutcome()]))
    return {
        version: 1,
        artifactKind: 'resume_checkpoint',
        runId: '20260805T010203004Z-abcdef123456',
        launchMode: 'fresh',
        sourceMode: 'ef_app_visible_ui',
        route: '/client/clientes/',
        unitsRequested: units,
        unitOutcomes,
        sourceArtifact: {
            version: 1,
            csvSha256: `sha256:${'a'.repeat(64)}`,
            csvRowCount: 1,
        },
        limits: { maxPages: null, maxClientsPerUnit: null },
        checkpoint: { initialRecords: 0, resumed: false },
        controlledSessionRecycles: 1,
        crashSessionRetries: 0,
        finalized: true,
        executionState: 'completed',
        sourceTraversalUnbounded: true,
        uiScope: { filters: 'unverified', statusScope: 'unknown' },
        allVisiblePaginationExhausted: true,
        noClientErrors: true,
        freshStart: true,
        freshUnboundedNoErrorVisibleTraversal: true,
        traversalOutcome: 'visible_pagination_exhausted',
        snapshotComplete: false,
        absenceIsRetirementEvidence: false,
        allHistoricalSemantics: 'not_proven',
        ...overrides,
    }
}

test('normalizes a fresh, unbounded visible traversal without promoting it to historical completeness', () => {
    const normalized = normalizeClientRegistrationSourceCoverage(coverage())

    assert.equal(normalized.sourceCoverageStatus, 'validated_conservative')
    assert.equal(normalized.freshUnboundedNoErrorVisibleTraversal, true)
    assert.equal(normalized.snapshotComplete, false)
    assert.equal(normalized.absenceIsRetirementEvidence, false)
    assert.equal(normalized.allHistoricalSemantics, 'not_proven')
    assert.doesNotThrow(() => assertClientRegistrationSourceCoverageEligibleForApply(normalized))
})

test('resumed or limited checkpoints remain valid evidence but are not eligible for apply', () => {
    const limitedUnitOutcomes = Object.fromEntries(units.map((unit) => [unit, unitOutcome({ termination: 'page_limit', initialCheckpointRecords: 2 })]))
    const normalized = normalizeClientRegistrationSourceCoverage(coverage({
        limits: { maxPages: 1, maxClientsPerUnit: null },
        checkpoint: { initialRecords: 4, resumed: true },
        unitOutcomes: limitedUnitOutcomes,
        sourceTraversalUnbounded: false,
        allVisiblePaginationExhausted: false,
        freshStart: false,
        freshUnboundedNoErrorVisibleTraversal: false,
        traversalOutcome: 'limited',
    }))

    assert.equal(normalized.sourceCoverageStatus, 'validated_conservative')
    assert.equal(normalized.checkpoint.resumed, true)
    assert.equal(normalized.traversalOutcome, 'limited')
    assert.throws(
        () => assertClientRegistrationSourceCoverageEligibleForApply(normalized),
        (error) => error?.code === 'CLIENT_REGISTRATION_SOURCE_COVERAGE_NOT_ELIGIBLE',
    )
})

test('an explicit resume with an empty checkpoint cannot masquerade as a fresh apply source', () => {
    const normalized = normalizeClientRegistrationSourceCoverage(coverage({
        launchMode: 'explicit_resume',
        checkpoint: { initialRecords: 0, resumed: false },
        freshStart: false,
        freshUnboundedNoErrorVisibleTraversal: false,
    }))

    assert.equal(normalized.sourceCoverageStatus, 'validated_conservative')
    assert.equal(normalized.freshStart, false)
    assert.throws(
        () => assertClientRegistrationSourceCoverageEligibleForApply(normalized),
        (error) => error?.code === 'CLIENT_REGISTRATION_SOURCE_COVERAGE_NOT_ELIGIBLE',
    )
})

test('missing, malformed, or optimistic sidecars fail closed and change the source fingerprint', () => {
    const valid = normalizeClientRegistrationSourceCoverage(coverage())
    const malformed = normalizeClientRegistrationSourceCoverage({ ...coverage(), snapshotComplete: true })
    const missing = normalizeClientRegistrationSourceCoverage(null)

    assert.equal(malformed.sourceCoverageStatus, 'unverified')
    assert.equal(missing.sourceCoverageStatus, 'unverified')
    assert.throws(
        () => assertClientRegistrationSourceCoverageEligibleForApply(malformed),
        (error) => error?.code === 'CLIENT_REGISTRATION_SOURCE_COVERAGE_REQUIRED',
    )
    assert.notEqual(
        fingerprintIdentityMaterializationSource({ registrationRows: [{ id: 'one' }], sourceCoverage: valid }),
        fingerprintIdentityMaterializationSource({ registrationRows: [{ id: 'one' }], sourceCoverage: malformed }),
    )
})

test('loads only a sidecar that attests to the exact CSV path', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'skincos-client-registration-coverage-'))
    const csvFile = path.join(directory, 'cadastro_clientes_espacofacial.csv')
    const sidecarFile = path.join(directory, 'cadastro_clientes_espacofacial_resumo.json')
    try {
        await fs.writeFile(csvFile, 'Cliente ID\none\n')
        const csv = await fs.readFile(csvFile)
        const sourceArtifact = {
            version: 1,
            csvSha256: `sha256:${createHash('sha256').update(csv).digest('hex')}`,
            csvRowCount: 1,
        }
        await fs.writeFile(sidecarFile, JSON.stringify({ outputs: { csv: csvFile }, sourceCoverage: coverage({ sourceArtifact }) }))
        const loaded = await loadClientRegistrationSourceCoverage({ inputFile: csvFile, sourceArtifact })
        assert.equal(loaded.sourceCoverageStatus, 'validated_conservative')

        await fs.writeFile(sidecarFile, JSON.stringify({
            outputs: { csv: csvFile },
            sourceCoverage: coverage({ sourceArtifact: { ...sourceArtifact, csvSha256: `sha256:${'b'.repeat(64)}` } }),
        }))
        const hashMismatch = await loadClientRegistrationSourceCoverage({ inputFile: csvFile, sourceArtifact })
        assert.equal(hashMismatch.sourceCoverageStatus, 'unverified')

        await fs.writeFile(sidecarFile, JSON.stringify({ outputs: { csv: path.join(directory, 'other.csv') }, sourceCoverage: coverage() }))
        const mismatched = await loadClientRegistrationSourceCoverage({ inputFile: csvFile, sourceArtifact })
        assert.equal(mismatched.sourceCoverageStatus, 'unverified')
    } finally {
        await fs.rm(directory, { recursive: true, force: true })
    }
})
