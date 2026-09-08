import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyActiveRuntimeState } from '../crm-identity-staging-caller-runtime-readback.mjs';

const apiVersion = '11111111-1111-4111-8111-111111111111';
const issuerVersion = '22222222-2222-4222-8222-222222222222';

function deployment(version) {
    return { versions: [{ version_id: version, percentage: 100 }] };
}

function plainText(name, text) {
    return { name, type: 'plain_text', text };
}

function versionDetail(id, bindings) {
    return { success: true, result: { id, resources: { bindings } } };
}

function disabledState(overrides = {}) {
    const apiBindings = [
        plainText('ENVIRONMENT', 'staging'),
        plainText('CRM_IDENTITY_ISSUER_CALLER_ENABLED', 'false'),
        plainText('CRM_IDENTITY_ISSUER_CALLER_ID', 'crm-api-staging-v1'),
    ];
    const issuerBindings = [
        plainText('IDENTITY_CRM_DELIVERY_ENABLED', 'false'),
        plainText('IDENTITY_CRM_DELIVERY_ENVIRONMENT', 'staging'),
        plainText('IDENTITY_CRM_DELIVERY_CALLER_ENABLED', 'false'),
        plainText('IDENTITY_CRM_DELIVERY_CALLER_ID', 'crm-api-staging-v1'),
    ];
    return {
        apiDeployment: deployment(apiVersion),
        issuerDeployment: deployment(issuerVersion),
        apiVersionDetail: versionDetail(apiVersion, apiBindings),
        issuerVersionDetail: versionDetail(issuerVersion, issuerBindings),
        ...overrides,
    };
}

test('accepts only the exact active disabled public caller bindings', () => {
    const report = verifyActiveRuntimeState(disabledState());

    assert.deepEqual(report, {
        schemaVersion: 1,
        state: 'disabled',
        observation: 'exact-active-worker-version-bindings',
        api: {
            script: 'skincos-api-staging',
            activeVersion: apiVersion,
            callerEnabled: false,
            callerId: 'crm-api-staging-v1',
        },
        issuer: {
            script: 'skincos-identity-crm-delivery-staging',
            activeVersion: issuerVersion,
            deliveryEnabled: false,
            callerEnabled: false,
            callerId: 'crm-api-staging-v1',
        },
    });
});

test('preserves an already-enabled delivery issuer while the isolated caller is absent', () => {
    const state = disabledState();
    state.issuerVersionDetail.result.resources.bindings = [
        plainText('IDENTITY_CRM_DELIVERY_ENABLED', 'true'),
        plainText('IDENTITY_CRM_DELIVERY_ENVIRONMENT', 'staging'),
    ];

    const report = verifyActiveRuntimeState(state);

    assert.equal(report.issuer.deliveryEnabled, true);
    assert.equal(report.issuer.callerEnabled, false);
    assert.equal(report.issuer.callerId, 'crm-api-staging-v1');
});

test('rejects an active API version with an enabled caller before any bootstrap receipt can be written', () => {
    const state = disabledState();
    state.apiVersionDetail.result.resources.bindings[1].text = 'true';

    assert.throws(() => verifyActiveRuntimeState(state), /api_CRM_IDENTITY_ISSUER_CALLER_ENABLED_MISMATCH/);
});

test('accepts a missing disabled caller binding but rejects secret or mismatched bindings', () => {
  const missing = disabledState();
  missing.issuerVersionDetail.result.resources.bindings = missing.issuerVersionDetail.result.resources.bindings
    .filter((binding) => binding.name !== 'IDENTITY_CRM_DELIVERY_CALLER_ENABLED');
  assert.equal(verifyActiveRuntimeState(missing).issuer.callerEnabled, false);

  const secret = disabledState();
  secret.apiVersionDetail.result.resources.bindings[1] = { name: 'CRM_IDENTITY_ISSUER_CALLER_ENABLED', type: 'secret_text' };
  assert.throws(() => verifyActiveRuntimeState(secret), /api_CRM_IDENTITY_ISSUER_CALLER_ENABLED_MISMATCH/);

  const issuerEnabled = disabledState();
  issuerEnabled.issuerVersionDetail.result.resources.bindings[2].text = 'true';
  assert.throws(() => verifyActiveRuntimeState(issuerEnabled), /issuer_IDENTITY_CRM_DELIVERY_CALLER_ENABLED_MISMATCH/);

  const issuerId = disabledState();
  issuerId.issuerVersionDetail.result.resources.bindings[3].text = 'another-caller';
  assert.throws(() => verifyActiveRuntimeState(issuerId), /issuer_IDENTITY_CRM_DELIVERY_CALLER_ID_MISMATCH/);

  const wrongVersion = disabledState();
    wrongVersion.apiVersionDetail.result.id = issuerVersion;
    assert.throws(() => verifyActiveRuntimeState(wrongVersion), /api_VERSION_DETAIL_INVALID/);
});
