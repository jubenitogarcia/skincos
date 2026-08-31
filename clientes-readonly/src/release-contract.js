export const CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION = 'clientes-readonly/staging-release/v1'

const SHA_PATTERN = /^[0-9a-f]{40}$/

function present(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function absent(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

function fullSha(value) {
  return typeof value === 'string' && SHA_PATTERN.test(value)
}

function validRestoreRollback(rollback, predecessorReleaseSha) {
  return rollback?.mode === 'restore-predecessor'
    && fullSha(rollback?.artifactSha)
    && rollback.artifactSha === predecessorReleaseSha
    && fullSha(rollback?.targetReleaseSha)
    && rollback.targetReleaseSha === predecessorReleaseSha
    && rollback.tested === true
    && present(rollback.workflow)
}

function validInitialDisableRollback(rollback, sourceSha) {
  return rollback?.mode === 'disable'
    && fullSha(rollback?.artifactSha)
    && rollback.artifactSha === sourceSha
    && rollback.tested === true
    && present(rollback.workflow)
}

/**
 * This is a release eligibility contract, not a publisher. A future owner may
 * add the sole deploy path only after every listed fact is true and recorded.
 */
export function assessClientesReadonlyStagingRelease(plan = {}, { expectedSourceSha } = {}) {
  const reasons = []
  if (plan.contract !== CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION) reasons.push('CLIENTES_RELEASE_CONTRACT_INVALID')
  if (plan.target !== 'staging') reasons.push('CLIENTES_RELEASE_TARGET_INVALID')
  if (!['deploy', 'rollback'].includes(plan.operation)) reasons.push('CLIENTES_RELEASE_OPERATION_INVALID')
  if (plan.enabled !== true) reasons.push('CLIENTES_RELEASE_DISABLED')
  if (plan.syntheticOnly !== true) reasons.push('CLIENTES_RELEASE_SYNTHETIC_ONLY_REQUIRED')
  if (!fullSha(plan.sourceSha)) reasons.push('CLIENTES_RELEASE_SOURCE_SHA_REQUIRED')
  if (expectedSourceSha !== undefined) {
    if (!fullSha(expectedSourceSha)) reasons.push('CLIENTES_RELEASE_EXPECTED_SOURCE_SHA_REQUIRED')
    else if (plan.sourceSha !== expectedSourceSha) reasons.push('CLIENTES_RELEASE_SOURCE_SHA_MISMATCH')
  }
  if (typeof plan.initialDeployment !== 'boolean') reasons.push('CLIENTES_RELEASE_INITIAL_DEPLOYMENT_REQUIRED')

  const initialDeployment = plan.initialDeployment === true
  if (initialDeployment) {
    if (!absent(plan.predecessorReleaseSha)) reasons.push('CLIENTES_RELEASE_INITIAL_PREDECESSOR_FORBIDDEN')
    if (!validInitialDisableRollback(plan.rollback, plan.sourceSha)) {
      reasons.push('CLIENTES_RELEASE_INITIAL_ROLLBACK_REQUIRED')
    }
  } else {
    if (!fullSha(plan.predecessorReleaseSha)) reasons.push('CLIENTES_RELEASE_PREDECESSOR_REQUIRED')
    if (!validRestoreRollback(plan.rollback, plan.predecessorReleaseSha)) {
      reasons.push('CLIENTES_RELEASE_ROLLBACK_REQUIRED')
    }
  }

  if (plan.singlePublisher !== true || !present(plan.publisher?.owner) || !present(plan.publisher?.workflow)) {
    reasons.push('CLIENTES_RELEASE_SINGLE_PUBLISHER_REQUIRED')
  }
  if (plan.publicRoute !== false) reasons.push('CLIENTES_RELEASE_PUBLIC_ROUTE_FORBIDDEN')
  if (plan.syntheticSmoke?.implemented !== true || plan.syntheticSmoke?.passed !== true) reasons.push('CLIENTES_RELEASE_SYNTHETIC_SMOKE_REQUIRED')
  if (plan.operation === 'rollback' && !initialDeployment && plan.rollback?.targetReleaseSha !== plan.predecessorReleaseSha) {
    reasons.push('CLIENTES_RELEASE_ROLLBACK_TARGET_INVALID')
  }
  if (plan.actorAdapter?.secretConfigured !== true || plan.actorAdapter?.replayStoreConfigured !== true || !present(plan.actorAdapter?.owner)) {
    reasons.push('CLIENTES_RELEASE_ACTOR_ADAPTER_REQUIRED')
  }
  if (plan.readModel?.serviceConfigured !== true
    || plan.readModel?.interfaceVersion !== 'clientes-readonly/read-model/v1'
    || !present(plan.readModel?.owner)
    || !present(plan.readModel?.dataOwner)
    || !present(plan.readModel?.migrationsOwner)) {
    reasons.push('CLIENTES_RELEASE_READ_MODEL_REQUIRED')
  }
  return Object.freeze({
    ok: reasons.length === 0,
    contract: CLIENTES_READONLY_STAGING_RELEASE_CONTRACT_VERSION,
    target: 'staging',
    reasons: Object.freeze(reasons),
  })
}
