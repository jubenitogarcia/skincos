export const CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION = 'clientes-readonly/staging-release/v1'
export const CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION = 'clientes-readonly/staging-release-evidence/v1'

const SHA_PATTERN = /^[0-9a-f]{40}$/

function record(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function present(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function absent(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

function fullSha(value) {
  return typeof value === 'string' && SHA_PATTERN.test(value)
}

function rollbackUsesDeclaredPublisher(rollback, publisher) {
  return present(rollback?.workflow)
    && present(publisher?.workflow)
    && rollback.workflow === publisher.workflow
}

function validRestoreRollback(rollback, predecessorReleaseSha, publisher) {
  return rollback?.mode === 'restore-predecessor'
    && fullSha(rollback?.artifactSha)
    && rollback.artifactSha === predecessorReleaseSha
    && fullSha(rollback?.targetReleaseSha)
    && rollback.targetReleaseSha === predecessorReleaseSha
    && rollback.tested === true
    && rollbackUsesDeclaredPublisher(rollback, publisher)
}

function validInitialDisableRollback(rollback, sourceSha, publisher) {
  return rollback?.mode === 'disable'
    && fullSha(rollback?.artifactSha)
    && rollback.artifactSha === sourceSha
    && rollback.tested === true
    && rollbackUsesDeclaredPublisher(rollback, publisher)
}

function sourceShaFromEvidence(releaseEvidence, expectedSourceSha, expectedSourceTree, reasons) {
  if (!record(releaseEvidence)) {
    reasons.push('CLIENTES_RELEASE_EVIDENCE_REQUIRED')
    if (expectedSourceSha !== undefined && !fullSha(expectedSourceSha)) {
      reasons.push('CLIENTES_RELEASE_EXPECTED_SOURCE_SHA_REQUIRED')
    }
    if (expectedSourceTree !== undefined && !fullSha(expectedSourceTree)) {
      reasons.push('CLIENTES_RELEASE_EXPECTED_SOURCE_TREE_REQUIRED')
    }
    return ''
  }
  if (releaseEvidence.contract !== CLIENTES_READONLY_STAGING_RELEASE_EVIDENCE_CONTRACT_VERSION) {
    reasons.push('CLIENTES_RELEASE_EVIDENCE_CONTRACT_INVALID')
  }
  if (releaseEvidence.target !== 'staging') reasons.push('CLIENTES_RELEASE_EVIDENCE_TARGET_INVALID')
  if (!fullSha(releaseEvidence.sourceSha)) reasons.push('CLIENTES_RELEASE_EVIDENCE_SOURCE_SHA_REQUIRED')
  if (!fullSha(releaseEvidence.sourceTree)) reasons.push('CLIENTES_RELEASE_EVIDENCE_SOURCE_TREE_REQUIRED')
  if (expectedSourceSha !== undefined) {
    if (!fullSha(expectedSourceSha)) reasons.push('CLIENTES_RELEASE_EXPECTED_SOURCE_SHA_REQUIRED')
    else if (releaseEvidence.sourceSha !== expectedSourceSha) reasons.push('CLIENTES_RELEASE_SOURCE_SHA_MISMATCH')
  }
  if (expectedSourceTree !== undefined) {
    if (!fullSha(expectedSourceTree)) reasons.push('CLIENTES_RELEASE_EXPECTED_SOURCE_TREE_REQUIRED')
    else if (releaseEvidence.sourceTree !== expectedSourceTree) reasons.push('CLIENTES_RELEASE_SOURCE_TREE_MISMATCH')
  }
  return fullSha(releaseEvidence.sourceSha) ? releaseEvidence.sourceSha : ''
}

/**
 * The committed plan is only a versioned policy/pre-cut declaration. Current
 * release identity, smoke and rollback facts must arrive as independently
 * generated evidence so a checked-in JSON file never needs to self-reference
 * the commit that contains it.
 */
export function assessClientesReadonlyStagingRelease(plan = {}, { expectedSourceSha, expectedSourceTree, releaseEvidence } = {}) {
  const reasons = []
  if (!record(plan)) reasons.push('CLIENTES_RELEASE_PLAN_INVALID')
  if (Object.hasOwn(plan || {}, 'sourceSha')) reasons.push('CLIENTES_RELEASE_PLAN_SOURCE_IDENTITY_FORBIDDEN')
  if (plan?.contract !== CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION) reasons.push('CLIENTES_RELEASE_CONTRACT_INVALID')
  if (plan?.target !== 'staging') reasons.push('CLIENTES_RELEASE_TARGET_INVALID')
  if (plan?.enabled !== true) reasons.push('CLIENTES_RELEASE_DISABLED')
  if (plan?.syntheticOnly !== true) reasons.push('CLIENTES_RELEASE_SYNTHETIC_ONLY_REQUIRED')

  const sourceSha = sourceShaFromEvidence(releaseEvidence, expectedSourceSha, expectedSourceTree, reasons)
  const operation = releaseEvidence?.operation
  if (!['deploy', 'rollback'].includes(operation)) reasons.push('CLIENTES_RELEASE_OPERATION_INVALID')
  if (typeof releaseEvidence?.initialDeployment !== 'boolean') reasons.push('CLIENTES_RELEASE_INITIAL_DEPLOYMENT_REQUIRED')

  const initialDeployment = releaseEvidence?.initialDeployment === true
  const predecessorReleaseSha = releaseEvidence?.predecessorReleaseSha
  const rollback = releaseEvidence?.rollback
  if (initialDeployment) {
    if (!absent(predecessorReleaseSha)) reasons.push('CLIENTES_RELEASE_INITIAL_PREDECESSOR_FORBIDDEN')
    if (!validInitialDisableRollback(rollback, sourceSha, plan?.publisher)) {
      reasons.push('CLIENTES_RELEASE_INITIAL_ROLLBACK_REQUIRED')
    }
  } else {
    if (!fullSha(predecessorReleaseSha)) reasons.push('CLIENTES_RELEASE_PREDECESSOR_REQUIRED')
    else if (predecessorReleaseSha === sourceSha) reasons.push('CLIENTES_RELEASE_PREDECESSOR_MUST_DIFFER')
    if (!validRestoreRollback(rollback, predecessorReleaseSha, plan?.publisher)) {
      reasons.push('CLIENTES_RELEASE_ROLLBACK_REQUIRED')
    }
  }

  if (plan?.singlePublisher !== true || !present(plan?.publisher?.owner) || !present(plan?.publisher?.workflow)) {
    reasons.push('CLIENTES_RELEASE_SINGLE_PUBLISHER_REQUIRED')
  }
  if (!rollbackUsesDeclaredPublisher(rollback, plan?.publisher)) {
    reasons.push('CLIENTES_RELEASE_ROLLBACK_PUBLISHER_MISMATCH')
  }
  if (plan?.publicRoute !== false) reasons.push('CLIENTES_RELEASE_PUBLIC_ROUTE_FORBIDDEN')
  if (releaseEvidence?.syntheticSmoke?.implemented !== true
    || releaseEvidence?.syntheticSmoke?.passed !== true
    || releaseEvidence?.syntheticSmoke?.sourceSha !== sourceSha) {
    reasons.push('CLIENTES_RELEASE_SYNTHETIC_SMOKE_REQUIRED')
  }
  if (operation === 'rollback' && !initialDeployment && rollback?.targetReleaseSha !== predecessorReleaseSha) {
    reasons.push('CLIENTES_RELEASE_ROLLBACK_TARGET_INVALID')
  }
  if (plan?.actorAdapter?.secretConfigured !== true || plan?.actorAdapter?.replayStoreConfigured !== true || !present(plan?.actorAdapter?.owner)) {
    reasons.push('CLIENTES_RELEASE_ACTOR_ADAPTER_REQUIRED')
  }
  if (plan?.readModel?.serviceConfigured !== true
    || plan?.readModel?.interfaceVersion !== 'clientes-readonly/read-model/v1'
    || !present(plan?.readModel?.owner)
    || !present(plan?.readModel?.dataOwner)
    || !present(plan?.readModel?.migrationsOwner)) {
    reasons.push('CLIENTES_RELEASE_READ_MODEL_REQUIRED')
  }
  return Object.freeze({
    ok: reasons.length === 0,
    contract: CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
    target: 'staging',
    reasons: Object.freeze(reasons),
  })
}
