import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTeamReadiness } from '../src/services/teamReadiness.js';

test('team readiness is disabled by default and exposes only safe requirement codes', () => {
  const result = buildTeamReadiness();

  assert.deepEqual(result, {
    ready: false,
    state: 'DISABLED',
    checks: {
      featureFlag: false,
      schema: false,
      workforceBinding: false,
      piiKey: false,
      inviteMailer: false,
    },
    missing: [
      'UNIFIED_TEAM_ENABLED',
      'TEAM_SCHEMA',
      'WORKFORCE_BINDING',
      'IDENTITY_PII_KEY',
      'INVITE_MAILER',
    ],
  });
});

test('schema failures take precedence over dependency failures', () => {
  const result = buildTeamReadiness({
    enabled: true,
    schemaReady: false,
    schemaMissing: ['ONBOARDING_USERNAME', 'ONBOARDING_USERNAME', 'TEAM_LINK_LEDGER'],
    workforceBinding: true,
    piiKey: true,
    inviteMailer: true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.state, 'MIGRATION_REQUIRED');
  assert.deepEqual(result.missing, ['ONBOARDING_USERNAME', 'TEAM_LINK_LEDGER']);
});

test('fully configured team readiness is ready without returning secret values', () => {
  const result = buildTeamReadiness({
    enabled: true,
    schemaReady: true,
    schemaMissing: [],
    workforceBinding: true,
    piiKey: true,
    inviteMailer: true,
  });

  assert.deepEqual(result, {
    ready: true,
    state: 'READY',
    checks: {
      featureFlag: true,
      schema: true,
      workforceBinding: true,
      piiKey: true,
      inviteMailer: true,
    },
    missing: [],
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|password|token|key_value/i);
});
