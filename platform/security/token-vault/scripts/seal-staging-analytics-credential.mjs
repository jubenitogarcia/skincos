import assert from 'node:assert/strict';
import fs from 'node:fs';

function requireEnvironment(name) {
  const value = String(process.env[name] || '').trim();
  assert.ok(value, `${name} is required`);
  return value;
}

const accessToken = fs.readFileSync(0, 'utf8').trim();
const bootstrapToken = requireEnvironment('BOOTSTRAP_TOKEN');
const accountId = requireEnvironment('INSTAGRAM_ACCOUNT_ID');
const baseUrl = requireEnvironment('BASE_URL');
const bootstrapFile = requireEnvironment('BOOTSTRAP_FILE');
const evidenceFile = requireEnvironment('EVIDENCE_FILE');
const credentialRef = 'ig-analytics-staging-shadow-v1';

assert.ok(accessToken.length >= 20 && accessToken.length <= 4096 && !/\s/.test(accessToken), 'invalid private Meta token input');
assert.match(accountId, /^\d{1,40}$/, 'invalid Instagram professional account identifier');

const response = await fetch(`${baseUrl}/v1/analytics/staging-bootstrap`, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${bootstrapToken}`,
    accept: 'application/json',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    access_token: accessToken,
    credential_ref: credentialRef,
    instagram_business_account_id: accountId,
  }),
  signal: AbortSignal.timeout(12_000),
});
const body = await response.json().catch(() => null);
const sealed = response.status === 201 && body?.ok === true && body?.bootstrap === 'sealed';
const alreadySealed = response.status === 409 && body?.error === 'bootstrap_already_sealed';
assert.ok(sealed || alreadySealed, 'staging Meta credential bootstrap did not seal or confirm the expected credential');
assert.equal(body?.provider === undefined || body.provider === 'meta-graph', true);

const serialized = JSON.stringify(body);
assert.equal(serialized.includes(accessToken), false, 'bootstrap response must not return the Meta token');
assert.equal(serialized.includes(accountId), false, 'bootstrap response must not return the account identifier');
assert.equal(serialized.includes(credentialRef), false, 'bootstrap response must not return the internal credential reference');

const result = {
  status: response.status,
  outcome: sealed ? 'sealed' : 'already_sealed',
  request_id: body?.requestId,
};
assert.equal(typeof result.request_id, 'string');
fs.writeFileSync(bootstrapFile, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });

const evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8'));
evidence.staging_credential_bootstrap = result;
fs.writeFileSync(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
