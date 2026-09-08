import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const REQUEST_TIMEOUT_MS = 15_000;

const API_RUNTIME = Object.freeze({
    label: 'api',
    script: 'skincos-api-staging',
    expectedPlainTextBindings: Object.freeze({
        ENVIRONMENT: 'staging',
        CRM_IDENTITY_ISSUER_CALLER_ENABLED: 'false',
        CRM_IDENTITY_ISSUER_CALLER_ID: 'crm-api-staging-v1',
    }),
});

const ISSUER_RUNTIME = Object.freeze({
    label: 'issuer',
    script: 'skincos-identity-crm-delivery-staging',
    expectedPlainTextBindings: Object.freeze({
        IDENTITY_CRM_DELIVERY_ENVIRONMENT: 'staging',
    }),
});

function fail(code) {
    throw new Error(code);
}

function activeVersion(deployment, runtime) {
    const versions = Array.isArray(deployment?.versions) ? deployment.versions : [];
    if (versions.length !== 1 || Number(versions[0]?.percentage) !== 100) {
        fail(`${runtime.label}_ACTIVE_DEPLOYMENT_INVALID`);
    }
    const version = String(versions[0]?.version_id || '').toLowerCase();
    if (!VERSION_ID_PATTERN.test(version)) fail(`${runtime.label}_ACTIVE_VERSION_INVALID`);
    return version;
}

function exactPlainTextBinding(versionDetail, runtime, activeVersionId, name, expected) {
    if (versionDetail?.success !== true || String(versionDetail?.result?.id || '').toLowerCase() !== activeVersionId) {
        fail(`${runtime.label}_VERSION_DETAIL_INVALID`);
    }
    const bindings = versionDetail?.result?.resources?.bindings;
    if (!Array.isArray(bindings)) fail(`${runtime.label}_VERSION_BINDINGS_INVALID`);
    const matches = bindings.filter((binding) => binding?.name === name);
    if (matches.length !== 1 || matches[0]?.type !== 'plain_text' || String(matches[0]?.text) !== expected) {
        fail(`${runtime.label}_${name}_MISMATCH`);
    }
}

function optionalPlainTextBinding(versionDetail, runtime, activeVersionId, name) {
    if (versionDetail?.success !== true || String(versionDetail?.result?.id || '').toLowerCase() !== activeVersionId) {
        fail(`${runtime.label}_VERSION_DETAIL_INVALID`);
    }
    const bindings = versionDetail?.result?.resources?.bindings;
    if (!Array.isArray(bindings)) fail(`${runtime.label}_VERSION_BINDINGS_INVALID`);
    const matches = bindings.filter((binding) => binding?.name === name);
    if (matches.length === 0) return null;
    if (matches.length !== 1 || matches[0]?.type !== 'plain_text') {
        fail(`${runtime.label}_${name}_MISMATCH`);
    }
    return String(matches[0]?.text);
}

function verifyRuntime(deployment, versionDetail, runtime) {
    const version = activeVersion(deployment, runtime);
    for (const [name, expected] of Object.entries(runtime.expectedPlainTextBindings)) {
        exactPlainTextBinding(versionDetail, runtime, version, name, expected);
    }
    return Object.freeze({
        script: runtime.script,
        activeVersion: version,
    });
}

/**
 * Verify public plain-text bindings on the exact active versions. Secret-text
 * bindings are never returned or written by this helper.
 */
export function verifyActiveRuntimeState({ apiDeployment, issuerDeployment, apiVersionDetail, issuerVersionDetail }) {
    const api = verifyRuntime(apiDeployment, apiVersionDetail, API_RUNTIME);
    const issuer = verifyRuntime(issuerDeployment, issuerVersionDetail, ISSUER_RUNTIME);
    const deliveryEnabled = optionalPlainTextBinding(
        issuerVersionDetail,
        ISSUER_RUNTIME,
        issuer.activeVersion,
        'IDENTITY_CRM_DELIVERY_ENABLED',
    );
    if (deliveryEnabled !== 'true' && deliveryEnabled !== 'false') {
        fail('issuer_IDENTITY_CRM_DELIVERY_ENABLED_MISMATCH');
    }
    const callerEnabled = optionalPlainTextBinding(
        issuerVersionDetail,
        ISSUER_RUNTIME,
        issuer.activeVersion,
        'IDENTITY_CRM_DELIVERY_CALLER_ENABLED',
    );
    if (callerEnabled !== null && callerEnabled !== 'false') {
        fail('issuer_IDENTITY_CRM_DELIVERY_CALLER_ENABLED_MISMATCH');
    }
    const callerId = optionalPlainTextBinding(
        issuerVersionDetail,
        ISSUER_RUNTIME,
        issuer.activeVersion,
        'IDENTITY_CRM_DELIVERY_CALLER_ID',
    );
    if (callerId !== null && callerId !== 'crm-api-staging-v1') {
        fail('issuer_IDENTITY_CRM_DELIVERY_CALLER_ID_MISMATCH');
    }
    return Object.freeze({
        schemaVersion: 1,
        state: 'disabled',
        observation: 'exact-active-worker-version-bindings',
        api: Object.freeze({
            ...api,
            callerEnabled: false,
            callerId: 'crm-api-staging-v1',
        }),
        issuer: Object.freeze({
            ...issuer,
            deliveryEnabled: deliveryEnabled === 'true',
            callerEnabled: false,
            // A missing caller id is safe while the caller is disabled; the
            // expected id becomes explicit as soon as the isolated caller is
            // provisioned and enabled.
            callerId: callerId ?? 'crm-api-staging-v1',
        }),
    });
}

async function fetchVersionDetail(fetchImpl, accountId, token, runtime, version) {
    const response = await fetchImpl(
        `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/workers/scripts/${encodeURIComponent(runtime.script)}/versions/${encodeURIComponent(version)}`,
        {
            headers: {
                accept: 'application/json',
                authorization: `Bearer ${token}`,
            },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
    );
    if (!response.ok) fail(`${runtime.label}_VERSION_READBACK_FAILED`);
    try {
        return await response.json();
    } catch {
        fail(`${runtime.label}_VERSION_READBACK_INVALID`);
    }
}

export async function readActiveRuntimeState({ apiDeployment, issuerDeployment, accountId, token, fetchImpl = globalThis.fetch }) {
    if (!ACCOUNT_ID_PATTERN.test(String(accountId || ''))) fail('CLOUDFLARE_ACCOUNT_ID_INVALID');
    if (typeof token !== 'string' || token.length === 0) fail('CLOUDFLARE_API_TOKEN_MISSING');
    if (typeof fetchImpl !== 'function') fail('CLOUDFLARE_FETCH_UNAVAILABLE');

    const apiVersion = activeVersion(apiDeployment, API_RUNTIME);
    const issuerVersion = activeVersion(issuerDeployment, ISSUER_RUNTIME);
    const [apiVersionDetail, issuerVersionDetail] = await Promise.all([
        fetchVersionDetail(fetchImpl, accountId, token, API_RUNTIME, apiVersion),
        fetchVersionDetail(fetchImpl, accountId, token, ISSUER_RUNTIME, issuerVersion),
    ]);
    return verifyActiveRuntimeState({ apiDeployment, issuerDeployment, apiVersionDetail, issuerVersionDetail });
}

async function readJson(path) {
    return JSON.parse(await readFile(path, 'utf8'));
}

const invokedDirectly = process.argv[1]
    && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
    const [apiDeploymentPath, issuerDeploymentPath] = process.argv.slice(2);
    try {
        if (!apiDeploymentPath || !issuerDeploymentPath || process.argv.length !== 4) fail('USAGE');
        const [apiDeployment, issuerDeployment] = await Promise.all([
            readJson(apiDeploymentPath),
            readJson(issuerDeploymentPath),
        ]);
        const report = await readActiveRuntimeState({
            apiDeployment,
            issuerDeployment,
            accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
            token: process.env.CLOUDFLARE_API_TOKEN,
        });
        process.stdout.write(`${JSON.stringify(report)}\n`);
    } catch (error) {
        const code = error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'READBACK_FAILED';
        process.stderr.write(`CRM Identity staging runtime readback failed: ${code}\n`);
        process.exitCode = 1;
    }
}
