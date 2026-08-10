const READINESS_STATES = Object.freeze([
  'DISABLED',
  'MIGRATION_REQUIRED',
  'DEPENDENCY_DEGRADED',
  'READY',
]);

const CHECK_LABELS = Object.freeze({
  featureFlag: 'UNIFIED_TEAM_ENABLED',
  schema: 'TEAM_SCHEMA',
  workforceBinding: 'WORKFORCE_BINDING',
  piiKey: 'IDENTITY_PII_KEY',
  inviteMailer: 'INVITE_MAILER',
});

function bool(value) {
  return value === true;
}

/**
 * Build a PII-free readiness contract for the authenticated Users/Equipe
 * surface. This reports configuration shape only; it never returns secret
 * material and never probes or mutates an external service.
 */
export function buildTeamReadiness({
  enabled = false,
  schemaReady = false,
  schemaMissing = [],
  workforceBinding = false,
  piiKey = false,
  inviteMailer = false,
} = {}) {
  const checks = {
    featureFlag: bool(enabled),
    schema: bool(schemaReady),
    workforceBinding: bool(workforceBinding),
    piiKey: bool(piiKey),
    inviteMailer: bool(inviteMailer),
  };
  const missing = [];
  if (!checks.featureFlag) missing.push(CHECK_LABELS.featureFlag);
  if (!checks.schema) {
    const normalizedSchemaMissing = Array.from(new Set((Array.isArray(schemaMissing) ? schemaMissing : [])
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean)));
    missing.push(...(normalizedSchemaMissing.length ? normalizedSchemaMissing : [CHECK_LABELS.schema]));
  }
  if (!checks.workforceBinding) missing.push(CHECK_LABELS.workforceBinding);
  if (!checks.piiKey) missing.push(CHECK_LABELS.piiKey);
  if (!checks.inviteMailer) missing.push(CHECK_LABELS.inviteMailer);

  let state = 'READY';
  if (!checks.featureFlag) state = 'DISABLED';
  else if (!checks.schema) state = 'MIGRATION_REQUIRED';
  else if (missing.length) state = 'DEPENDENCY_DEGRADED';

  return {
    ready: state === 'READY',
    state: READINESS_STATES.includes(state) ? state : 'DEPENDENCY_DEGRADED',
    checks,
    missing: Array.from(new Set(missing)),
  };
}

export { READINESS_STATES };
