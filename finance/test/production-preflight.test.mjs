import assert from 'node:assert/strict';
import test from 'node:test';
import { validateFinanceProductionPreflight } from '../../.github/scripts/finance-production-preflight.mjs';

const d1Id = '11111111-2222-4333-8444-555555555555';
const controlKvId = 'a'.repeat(32);
const releaseSha = 'b'.repeat(40);

function fixture(overrides = {}) {
  return {
    operation: 'deploy',
    releaseSha,
    deployEnabled: true,
    d1Id,
    controlKvId,
    githubBackupPassphrasePresent: true,
    githubServiceSecretPresent: true,
    d1: { uuid: d1Id, name: 'skincos-finance' },
    kv: { id: controlKvId, title: 'SKINCOS_FINANCE_PRODUCTION_FLAGS' },
    financeSettings: {
      bindings: [
        { name: 'DB', type: 'd1', id: d1Id, database_id: d1Id },
        { name: 'MODULE_CONTROL', type: 'kv_namespace', namespace_id: controlKvId },
        { name: 'ENVIRONMENT', type: 'plain_text', text: 'production' },
      ],
    },
    financeSecrets: [{ name: 'FINANCE_SERVICE_AUTH_SECRET', type: 'secret_text' }],
    financeDeployments: { deployments: [{ id: 'deployment-1' }] },
    financeSubdomain: { enabled: true, previews_enabled: false },
    accountSubdomain: { subdomain: 'skincos' },
    apiSettings: {
      bindings: [
        { name: 'FINANCE', type: 'service', service: 'skincos-finance', environment: 'production' },
      ],
    },
    apiSecrets: [{ name: 'FINANCE_SERVICE_AUTH_SECRET', type: 'secret_text' }],
    ...overrides,
  };
}

test('production preflight emits only sanitized attestation', () => {
  const report = validateFinanceProductionPreflight(fixture());
  assert.equal(report.result, 'passed');
  assert.equal(report.workerUrl, 'https://skincos-finance.skincos.workers.dev');
  assert.equal(report.secrets.valuesReadOrEmitted, false);
  assert.equal(JSON.stringify(report).includes('super-secret'), false);
});

test('production deploy fails closed when its release flag is not enabled', () => {
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({ deployEnabled: false })),
    /ENABLE_FINANCE_PRODUCTION_DEPLOY/,
  );
});

test('rollback remains possible with the deploy flag disabled but still requires attested resources', () => {
  const report = validateFinanceProductionPreflight(fixture({ operation: 'rollback', deployEnabled: false }));
  assert.equal(report.authorization.rollbackDoesNotRequireDeployFlag, true);
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({ operation: 'rollback', deployEnabled: false, financeDeployments: [] })),
    /rollback baseline/,
  );
});

test('production preflight rejects wrong resources, bindings and remote secrets', () => {
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({ d1: { uuid: d1Id, name: 'skincos-finance-staging' } })),
    /D1 id\/name/,
  );
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({ kv: { id: controlKvId, title: 'SKINCOS_FINANCE_STAGING_FLAGS' } })),
    /KV id\/title/,
  );
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({
      financeSettings: {
        bindings: [
          { name: 'DB', type: 'd1', id: '99999999-2222-4333-8444-555555555555' },
          { name: 'MODULE_CONTROL', type: 'kv_namespace', namespace_id: controlKvId },
          { name: 'ENVIRONMENT', type: 'plain_text', text: 'production' },
        ],
      },
    })),
    /DB binding/,
  );
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({
      apiSettings: { bindings: [{ name: 'FINANCE', type: 'service', service: 'skincos-finance-staging' }] },
    })),
    /skincos-api FINANCE binding/,
  );
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({ financeSecrets: [] })),
    /remote FINANCE_SERVICE_AUTH_SECRET/,
  );
  assert.throws(
    () => validateFinanceProductionPreflight(fixture({ apiSecrets: [] })),
    /API.*remote FINANCE_SERVICE_AUTH_SECRET/i,
  );
});
