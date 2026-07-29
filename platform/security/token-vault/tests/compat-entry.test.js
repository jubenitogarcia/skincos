import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteLegacyTokenMetadataRequest } from '../src/compat-entry.js';

test('rewrites the legacy token metadata route to the canonical token list route', () => {
  const input = new Request(
    'https://api.skincos.com.br/internal/token-vault/v1/token-metadata?active=true&limit=20',
    { headers: { Authorization: 'Bearer fixture' } },
  );

  const output = rewriteLegacyTokenMetadataRequest(input);
  const url = new URL(output.url);

  assert.equal(url.pathname, '/internal/token-vault/v1/tokens');
  assert.equal(url.searchParams.get('active'), 'true');
  assert.equal(url.searchParams.get('limit'), '20');
  assert.equal(output.headers.get('Authorization'), 'Bearer fixture');
});

test('leaves the canonical token list route unchanged', () => {
  const input = new Request('https://api.skincos.com.br/internal/token-vault/v1/tokens?active=true');
  assert.equal(rewriteLegacyTokenMetadataRequest(input), input);
});

test('does not rewrite mutating requests', () => {
  const input = new Request(
    'https://api.skincos.com.br/internal/token-vault/v1/token-metadata',
    { method: 'POST' },
  );
  assert.equal(rewriteLegacyTokenMetadataRequest(input), input);
});
