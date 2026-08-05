import { promises as fs } from 'node:fs'
import path from 'node:path'

const TERMINATIONS = new Set(['in_progress', 'pagination_exhausted', 'page_limit', 'client_limit'])
const TRAVERSAL_OUTCOMES = new Set([
    'incomplete',
    'incomplete_failed',
    'limited',
    'visible_pagination_exhausted',
    'completed_without_visible_pagination_exhaustion',
])
const EXECUTION_STATES = new Set(['running', 'retrying', 'completed', 'failed'])
const LAUNCH_MODES = new Set(['fresh', 'explicit_resume', 'direct'])
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/
const CSV_SHA256 = /^sha256:[a-f0-9]{64}$/

function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function nonNegativeInteger(value) {
    return Number.isInteger(value) && value >= 0
}

function optionalPositiveInteger(value) {
    return value === null || (Number.isInteger(value) && value > 0)
}

function unverified(reason) {
    return {
        version: 1,
        sourceCoverageStatus: 'unverified',
        sourceCoverageReason: reason,
        artifactKind: 'unknown',
        runId: null,
        sourceMode: 'unknown',
        route: null,
        unitsRequested: [],
        unitOutcomes: {},
        sourceArtifact: { version: 1, csvSha256: null, csvRowCount: 0 },
        limits: { maxPages: null, maxClientsPerUnit: null },
        checkpoint: { initialRecords: 0, resumed: false },
        controlledSessionRecycles: 0,
        crashSessionRetries: 0,
        finalized: false,
        executionState: 'unverified',
        sourceTraversalUnbounded: false,
        uiScope: { filters: 'unverified', statusScope: 'unknown' },
        allVisiblePaginationExhausted: false,
        noClientErrors: false,
        freshStart: false,
        freshUnboundedNoErrorVisibleTraversal: false,
        traversalOutcome: 'incomplete',
        snapshotComplete: false,
        absenceIsRetirementEvidence: false,
        allHistoricalSemantics: 'not_proven',
    }
}

function normalizeUnitOutcomes(value, unitsRequested) {
    if (!isRecord(value)) return null
    const normalized = {}
    for (const unit of unitsRequested) {
        const item = value[unit]
        if (!isRecord(item) || !TERMINATIONS.has(item.termination) ||
            !nonNegativeInteger(item.initialCheckpointRecords) ||
            !nonNegativeInteger(item.pagesProcessed) ||
            !nonNegativeInteger(item.lastPageProcessed) ||
            !nonNegativeInteger(item.maxPageObserved) ||
            !nonNegativeInteger(item.recordsExportedThisRun) ||
            !nonNegativeInteger(item.clientsSkippedCheckpoint) ||
            !nonNegativeInteger(item.clientErrors) ||
            typeof item.visiblePaginationExhausted !== 'boolean' ||
            typeof item.traversalFinalized !== 'boolean') return null
        if (item.visiblePaginationExhausted !== (item.termination === 'pagination_exhausted')) return null
        if (item.traversalFinalized !== (item.termination !== 'in_progress')) return null
        normalized[unit] = {
            initialCheckpointRecords: item.initialCheckpointRecords,
            pagesProcessed: item.pagesProcessed,
            lastPageProcessed: item.lastPageProcessed,
            maxPageObserved: item.maxPageObserved,
            recordsExportedThisRun: item.recordsExportedThisRun,
            clientsSkippedCheckpoint: item.clientsSkippedCheckpoint,
            clientErrors: item.clientErrors,
            termination: item.termination,
            visiblePaginationExhausted: item.visiblePaginationExhausted,
            traversalFinalized: item.traversalFinalized,
        }
    }
    return normalized
}

/**
 * Normalize the Python sidecar to a small, PII-free contract.  It is
 * intentionally unable to represent an all-historical snapshot: the exporter
 * observes only the visible UI list and does not inspect its filter semantics.
 */
export function normalizeClientRegistrationSourceCoverage(value) {
    if (!isRecord(value)) return unverified('sidecar_missing_or_malformed')
    if (value.version !== 1 || value.artifactKind !== 'resume_checkpoint' ||
        value.sourceMode !== 'ef_app_visible_ui' || value.route !== '/client/clientes/' ||
        typeof value.runId !== 'string' || !RUN_ID.test(value.runId) ||
        typeof value.launchMode !== 'string' || !LAUNCH_MODES.has(value.launchMode) ||
        !Array.isArray(value.unitsRequested) || value.unitsRequested.length === 0 ||
        value.unitsRequested.some((unit) => typeof unit !== 'string' || !unit.trim() || unit.length > 80) ||
        !isRecord(value.limits) || !optionalPositiveInteger(value.limits.maxPages) ||
        !optionalPositiveInteger(value.limits.maxClientsPerUnit) ||
        !isRecord(value.sourceArtifact) || value.sourceArtifact.version !== 1 ||
        typeof value.sourceArtifact.csvSha256 !== 'string' || !CSV_SHA256.test(value.sourceArtifact.csvSha256) ||
        !nonNegativeInteger(value.sourceArtifact.csvRowCount) ||
        !isRecord(value.checkpoint) || !nonNegativeInteger(value.checkpoint.initialRecords) ||
        typeof value.checkpoint.resumed !== 'boolean' ||
        !nonNegativeInteger(value.controlledSessionRecycles) ||
        (value.crashSessionRetries !== undefined && !nonNegativeInteger(value.crashSessionRetries)) ||
        typeof value.finalized !== 'boolean' || !EXECUTION_STATES.has(value.executionState) ||
        typeof value.sourceTraversalUnbounded !== 'boolean' ||
        !isRecord(value.uiScope) || value.uiScope.filters !== 'unverified' || value.uiScope.statusScope !== 'unknown' ||
        typeof value.allVisiblePaginationExhausted !== 'boolean' || typeof value.noClientErrors !== 'boolean' ||
        typeof value.freshStart !== 'boolean' || typeof value.freshUnboundedNoErrorVisibleTraversal !== 'boolean' ||
        !TRAVERSAL_OUTCOMES.has(value.traversalOutcome) ||
        value.snapshotComplete !== false || value.absenceIsRetirementEvidence !== false ||
        value.allHistoricalSemantics !== 'not_proven') return unverified('sidecar_contract_invalid')

    const unitsRequested = [...new Set(value.unitsRequested.map((unit) => unit.trim()))]
    if (unitsRequested.length !== value.unitsRequested.length) return unverified('sidecar_contract_invalid')
    const unitOutcomes = normalizeUnitOutcomes(value.unitOutcomes, unitsRequested)
    if (!unitOutcomes) return unverified('sidecar_contract_invalid')
    if (value.sourceTraversalUnbounded !== (value.limits.maxPages === null && value.limits.maxClientsPerUnit === null)) {
        return unverified('sidecar_contract_invalid')
    }

    const allVisiblePaginationExhausted = unitsRequested.every((unit) => unitOutcomes[unit].termination === 'pagination_exhausted')
    if (value.allVisiblePaginationExhausted !== allVisiblePaginationExhausted) return unverified('sidecar_contract_invalid')
    const noClientErrors = unitsRequested.every((unit) => unitOutcomes[unit].clientErrors === 0)
    // A zero-row explicit resume is still a resume.  Only the shared launcher
    // assigns `fresh` after allocating a new private run directory, so direct
    // invocation and explicit resume remain useful evidence but cannot make a
    // materialization eligible merely because their CSV started empty.
    const freshStart = value.launchMode === 'fresh' && !value.checkpoint.resumed
    if (value.noClientErrors !== noClientErrors || value.freshStart !== freshStart) {
        return unverified('sidecar_contract_invalid')
    }
    const limited = unitsRequested.some((unit) => ['page_limit', 'client_limit'].includes(unitOutcomes[unit].termination))
    const expectedTraversalOutcome = value.executionState === 'failed'
        ? 'incomplete_failed'
        : !value.finalized
            ? 'incomplete'
            : limited
                ? 'limited'
                : allVisiblePaginationExhausted
                    ? 'visible_pagination_exhausted'
                    : 'completed_without_visible_pagination_exhaustion'
    if (value.traversalOutcome !== expectedTraversalOutcome) return unverified('sidecar_contract_invalid')
    const freshUnboundedNoErrorVisibleTraversal = Boolean(
        value.finalized && value.executionState === 'completed' && value.freshStart &&
        value.sourceTraversalUnbounded && noClientErrors && allVisiblePaginationExhausted,
    )
    if (value.freshUnboundedNoErrorVisibleTraversal !== freshUnboundedNoErrorVisibleTraversal) {
        return unverified('sidecar_contract_invalid')
    }

    return {
        version: 1,
        sourceCoverageStatus: 'validated_conservative',
        artifactKind: 'resume_checkpoint',
        runId: value.runId,
        launchMode: value.launchMode,
        sourceMode: value.sourceMode,
        route: value.route,
        unitsRequested,
        unitOutcomes,
        sourceArtifact: {
            version: 1,
            csvSha256: value.sourceArtifact.csvSha256,
            csvRowCount: value.sourceArtifact.csvRowCount,
        },
        limits: {
            maxPages: value.limits.maxPages,
            maxClientsPerUnit: value.limits.maxClientsPerUnit,
        },
        checkpoint: {
            initialRecords: value.checkpoint.initialRecords,
            resumed: value.checkpoint.resumed,
        },
        controlledSessionRecycles: value.controlledSessionRecycles,
        crashSessionRetries: value.crashSessionRetries || 0,
        finalized: value.finalized,
        executionState: value.executionState,
        sourceTraversalUnbounded: value.sourceTraversalUnbounded,
        uiScope: { filters: 'unverified', statusScope: 'unknown' },
        allVisiblePaginationExhausted,
        noClientErrors,
        freshStart: value.freshStart,
        freshUnboundedNoErrorVisibleTraversal,
        traversalOutcome: value.traversalOutcome,
        // Invariant: source pagination never becomes a historical-retirement
        // assertion merely because it was fresh, unbounded and error-free.
        snapshotComplete: false,
        absenceIsRetirementEvidence: false,
        allHistoricalSemantics: 'not_proven',
    }
}

export async function loadClientRegistrationSourceCoverage({ inputFile, sidecarFile = '', sourceArtifact = null }) {
    const candidate = sidecarFile || path.join(path.dirname(inputFile), 'cadastro_clientes_espacofacial_resumo.json')
    try {
        const sidecar = JSON.parse(await fs.readFile(candidate, 'utf8'))
        const reportedCsv = String(sidecar?.outputs?.csv || '').trim()
        if (!reportedCsv || path.resolve(reportedCsv) !== path.resolve(inputFile)) {
            return normalizeClientRegistrationSourceCoverage(null)
        }
        const normalized = normalizeClientRegistrationSourceCoverage(sidecar.sourceCoverage)
        if (normalized.sourceCoverageStatus !== 'validated_conservative' || !isRecord(sourceArtifact) ||
            normalized.sourceArtifact.csvSha256 !== sourceArtifact.csvSha256 ||
            normalized.sourceArtifact.csvRowCount !== sourceArtifact.csvRowCount) {
            return unverified('sidecar_csv_mismatch')
        }
        return normalized
    } catch {
        return normalizeClientRegistrationSourceCoverage(null)
    }
}

export function assertClientRegistrationSourceCoverageEligibleForApply(sourceCoverage) {
    if (sourceCoverage?.sourceCoverageStatus !== 'validated_conservative') {
        const error = new Error('CLIENT_REGISTRATION_SOURCE_COVERAGE_REQUIRED')
        error.code = error.message
        throw error
    }
    if (!sourceCoverage.freshUnboundedNoErrorVisibleTraversal) {
        const error = new Error('CLIENT_REGISTRATION_SOURCE_COVERAGE_NOT_ELIGIBLE')
        error.code = error.message
        throw error
    }
}
