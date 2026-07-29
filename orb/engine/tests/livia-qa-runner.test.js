'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  driveAuditForExecution,
  notificationForExecution,
  verifierEnvironment,
} = require('../scripts/livia/qa-runner');

test('qa audit passes only the selected Token Vault values to the independent verifier', () => {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'livia-qa-env-'));
  const fixture = path.join(fixtureDir, 'orb-business.env');
  try {
    fs.writeFileSync(fixture, [
      'TOKEN_VAULT_N8N_API_TOKEN=from-file',
      'UNRELATED_SECRET=must-not-be-forwarded',
      'TOKEN_VAULT_BASE_URL=https://token-vault.example.test',
    ].join('\n'));
    assert.deepEqual(verifierEnvironment({
      envFiles: [fixture],
      inherited: { TOKEN_VAULT_N8N_API_TOKEN: 'from-process', OTHER_VALUE: 'ignored' },
    }), {
      TOKEN_VAULT_BASE_URL: 'https://token-vault.example.test',
      TOKEN_VAULT_N8N_API_TOKEN: 'from-process',
    });
  } finally {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('qa audit reads the notification node that actually executed', () => {
  const result = notificationForExecution({
    'Inform Success (2)': [{ data: { main: [[{ json: { ok: true, result: { message_id: 42 } } }]] } }],
    'Inform Success (1)': [{ data: { main: [[{ json: { data: { status: 'pending' } } }]] } }],
  });
  assert.equal(result.nodeName, 'Inform Success (2)');
  assert.equal(result.notification.ok, true);
  assert.equal(result.notification.result.message_id, 42);
});

test('qa audit exposes legacy carousel Drive marks that silently omitted child files', () => {
  const runData = {
    'Attach Verified Publish Artifacts': [{ data: { main: [[{ json: { id: 'a', fileIds: ['a', 'b', 'c'] } }]] } }],
    'Update File': [{ data: { main: [[{ json: { id: 'a', properties: { published: 'true' } } }]] } }],
  };
  const audit = driveAuditForExecution(runData);
  assert.equal(audit.contract, 'legacy-single-mark');
  assert.equal(audit.state, 'incomplete');
  assert.deepEqual(audit.missingFileIds, ['b', 'c']);
});

test('qa audit accepts only a correlated full-group Drive readback', () => {
  const prepared = ['a', 'b'].map((id) => ({ json: { id } }));
  const runData = {
    'Prepare Drive Publication Marks': [{ data: { main: [prepared] } }],
    'Update File': [{ data: { main: [[
      { json: { id: 'a', properties: { published: 'true' } } },
      { json: { id: 'b', properties: { published: 'true' } } },
    ]] } }],
    'Assert Drive Published': [{ data: { main: [[{ json: { driveAudit: {
      state: 'verified', published: true, verifiedFileIds: ['a', 'b'],
    } } }]] } }],
  };
  const audit = driveAuditForExecution(runData);
  assert.equal(audit.contract, 'group-fanout-readback');
  assert.equal(audit.state, 'verified');
  assert.equal(audit.verifiedFileCount, 2);
});
