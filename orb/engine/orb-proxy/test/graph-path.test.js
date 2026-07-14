const assert = require('node:assert/strict');
const test = require('node:test');

const { normalizeGraphPath } = require('../graph-path');

test('accepts supported Graph resource paths', () => {
  assert.equal(normalizeGraphPath('oauth/access_token'), 'oauth/access_token');
  assert.equal(normalizeGraphPath('123456789/media_publish'), '123456789/media_publish');
  assert.equal(normalizeGraphPath('me/accounts'), 'me/accounts');
});

test('rejects absolute URLs and traversal-like paths', () => {
  assert.throws(() => normalizeGraphPath('https://attacker.invalid'), /Invalid Graph API path/);
  assert.throws(() => normalizeGraphPath('../metadata'), /Invalid Graph API path/);
  assert.throws(() => normalizeGraphPath('me/accounts?next=https://attacker.invalid'), /Invalid Graph API path/);
});
