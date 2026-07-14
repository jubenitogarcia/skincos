const assert = require('node:assert/strict');
const test = require('node:test');

const { isAuthorizedToken, normalizeInstagramHandle } = require('../security.js');

test('accepts a normal Instagram handle and rejects traversal input', () => {
  assert.equal(normalizeInstagramHandle('skincos.oficial_1'), 'skincos.oficial_1');
  assert.throws(() => normalizeInstagramHandle('../outside'), /Invalid Instagram handle/);
  assert.throws(() => normalizeInstagramHandle('name/with/slash'), /Invalid Instagram handle/);
});

test('requires an exact configured administrative token', () => {
  assert.equal(isAuthorizedToken('private-token', 'private-token'), true);
  assert.equal(isAuthorizedToken('private-token', 'private-token-extra'), false);
  assert.equal(isAuthorizedToken('', 'private-token'), false);
  assert.equal(isAuthorizedToken('private-token', ''), false);
});
