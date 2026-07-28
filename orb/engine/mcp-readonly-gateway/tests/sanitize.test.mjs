import assert from 'node:assert/strict';
import test from 'node:test';
import { executionErrorDetails, workflowGraph, workflowSummary } from '../lib/workflow-analysis.mjs';
import { hasSensitiveMaterial, sanitizeText, sanitizeValue } from '../lib/sanitize.mjs';
import { FORBIDDEN_ROLE_PRIVILEGES, assertReadOnlyRolePrivileges } from '../lib/role-policy.mjs';

test('central sanitizer removes fake secret and PII categories', () => {
  const value = sanitizeValue({ authorization: 'Bearer fake-token-123456789', cookie: 'session=abc', password: 'fake-password', email: 'ana@example.test', phone: '+55 11 99999-9999', cpf: '123.456.789-09', url: 'https://example.test/file?X-Amz-Signature=fake', payload: { patient: 'Fake Person' }, safe: 'kept' });
  assert.deepEqual(value, { url: '[redacted-signed-url]', safe: 'kept' });
  assert.equal(hasSensitiveMaterial(value), false);
  assert.equal(sanitizeText('Bearer fake-token-123456789 ana@example.test 123.456.789-09'), '[redacted-secret] [redacted-email] [redacted-cpf]');
});

test('workflow graph excludes parameters and credentials', () => {
  const workflow = { id: 'wf-1', name: 'Meta Ads', nodes: [{ name: 'Webhook', type: 'n8n-nodes-base.webhook', position: [0, 0], parameters: { secret: 'nope' }, credentials: { httpBasicAuth: { id: 'secret' } } }, { name: 'Request', type: 'n8n-nodes-base.httpRequest', position: [200, 0], parameters: { headerParameters: { values: [{ name: 'Authorization', value: 'Bearer hidden' }] } } }], connections: { Webhook: { main: [[{ node: 'Request', type: 'main', index: 0 }]] } }, settings: {} };
  const graph = workflowGraph(workflow); const summary = workflowSummary(workflow);
  assert.equal(JSON.stringify(graph).includes('hidden'), false);
  assert.equal(JSON.stringify(graph).includes('secret'), false);
  assert.equal(summary.credential_reference_count, 1);
});

test('execution error reader returns only reduced sanitized diagnostics', () => {
  const result = executionErrorDetails(JSON.stringify({ lastNodeExecuted: 'HTTP Request', runData: { 'HTTP Request': [{ error: { message: 'Bearer abcdefghijkl ana@example.test failed', stack: 'Error: failure\n at test (file.js:1)', httpCode: 401 } }] } }));
  assert.equal(result.node, 'HTTP Request');
  assert.equal(result.http_status, 401);
  assert.equal(result.message.includes('abcdef'), false);
  assert.equal(result.message.includes('@example'), false);
});

test('central sanitizer covers transport secrets, clinical data, SQL and nested values', () => {
  const fake = {
    Authorization: 'Bearer fakeBearerValue123456789',
    headers: { Cookie: 'sid=fake', authorization: 'Basic fake' },
    url: 'https://user:fake-password@example.test/a?api_key=fake-key&signature=fake-signature',
    clientSecret: 'client_secret=fake-client-secret',
    refreshToken: 'refresh_token=fake-refresh-token',
    email: 'fake.person@example.test',
    phone: '(11) 99999-9999',
    cpf: '12345678909',
    whatsappPayload: { patientName: 'Fake Patient', clinicalData: 'Fake diagnosis and treatment' },
    sql: "SELECT * FROM patients WHERE cpf = '12345678909'",
    env: 'MCP_DB_PASSWORD=fake-db-password',
    nested: [{ message: 'Bearer fakeNestedToken123456789' }],
    safe: 'kept',
  };
  const value = sanitizeValue(fake);
  assert.equal(value.safe, 'kept');
  assert.equal(hasSensitiveMaterial(value), false);
  const text = sanitizeText('AUTHORIZATION: Bearer fakeToken123456789 api_key=fakeKey password=fakePass client_secret=fakeClient refresh_token=fakeRefresh https://user:pass@example.test/x?access_token=fake email fake@example.test phone (11) 99999-9999 cpf 123.456.789-09 SQL WHERE cpf = \'12345678909\' MCP_DB_PASSWORD=fake');
  assert.equal(hasSensitiveMaterial(text), false);
  assert.equal(text.includes('fakeToken123'), false);
  assert.equal(text.includes('fake@example.test'), false);
});

test('role policy rejects every forbidden privilege and inherited role', () => {
  const role = Object.fromEntries(FORBIDDEN_ROLE_PRIVILEGES.map((privilege) => [privilege, false]));
  role.rolinherit = false;
  role.rolcanlogin = true;
  assert.deepEqual(assertReadOnlyRolePrivileges(role), []);
  for (const privilege of FORBIDDEN_ROLE_PRIVILEGES) {
    assert.ok(assertReadOnlyRolePrivileges({ ...role, [privilege]: true }).includes(privilege));
  }
  assert.ok(assertReadOnlyRolePrivileges({ ...role, rolinherit: true }).includes('INHERIT'));
});
